import type { Bounds } from '../geometry/bounds';

/**
 * Dynamic R-tree over axis-aligned boxes, keyed by string id.
 *
 * Why a tree and not a grid: entity sizes differ by many orders of magnitude and
 * coordinates are unbounded, so a uniform grid either puts a long line into
 * millions of cells or puts everything into one. See ADR 0007.
 *
 * - Insert chooses the subtree with the least area growth and splits full nodes
 *   with the quadratic split (Guttman, 1984).
 * - `load` packs a whole set at once with sort-tile-recursive, which gives a better
 *   tree than repeated inserts and is used when a drawing is loaded.
 * - Remove tightens boxes on the way up and drops emptied nodes. It does not
 *   re-insert underfull nodes, so a long run of removals leaves a looser tree. That
 *   costs query speed, never correctness, and `load` rebuilds it.
 *
 * Boxes are closed intervals: touching boxes intersect. The tree does not interpret
 * the boxes; callers pad them for tolerances.
 */

const MAX_ENTRIES = 16;
const MIN_ENTRIES = 6;

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface Entry extends Box {
  readonly id: string;
  node: Node;
}

interface Node extends Box {
  leaf: boolean;
  parent: Node | null;
  entries: Entry[];
  children: Node[];
}

export class RTree {
  private root: Node = emptyLeaf();
  private readonly entries = new Map<string, Entry>();

  get size(): number {
    return this.entries.size;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  /** Smallest box holding everything in the tree, or null when it is empty. */
  get extent(): Bounds | null {
    if (this.entries.size === 0) return null;
    const { minX, minY, maxX, maxY } = this.root;
    return { minX, minY, maxX, maxY };
  }

  clear(): void {
    this.root = emptyLeaf();
    this.entries.clear();
  }

  insert(id: string, bounds: Bounds): void {
    if (this.entries.has(id)) throw new Error(`Spatial index already holds "${id}".`);
    const leaf = this.chooseLeaf(bounds);
    const entry: Entry = { id, node: leaf, minX: bounds.minX, minY: bounds.minY, maxX: bounds.maxX, maxY: bounds.maxY };
    leaf.entries.push(entry);
    this.entries.set(id, entry);
    for (let n: Node | null = leaf; n; n = n.parent) extend(n, entry);
    this.splitUpwards(leaf);
  }

  remove(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`Spatial index does not hold "${id}".`);
    const leaf = entry.node;
    leaf.entries.splice(leaf.entries.indexOf(entry), 1);
    this.entries.delete(id);

    let n: Node | null = leaf;
    while (n) {
      const parent: Node | null = n.parent;
      if (parent && itemCount(n) === 0) parent.children.splice(parent.children.indexOf(n), 1);
      else recalc(n);
      n = parent;
    }
    while (!this.root.leaf && this.root.children.length === 1) {
      this.root = this.root.children[0]!;
      this.root.parent = null;
    }
    if (!this.root.leaf && this.root.children.length === 0) this.root = emptyLeaf();
  }

  /** Calls `visit` once for every stored box that intersects `query`. Order is unspecified. */
  search(query: Bounds, visit: (id: string) => void): void {
    if (!hits(this.root, query)) return;
    const stack: Node[] = [this.root];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (node.leaf) {
        for (const entry of node.entries) if (hits(entry, query)) visit(entry.id);
      } else {
        for (const child of node.children) if (hits(child, query)) stack.push(child);
      }
    }
  }

  /** Replaces the contents with `items`, packed with sort-tile-recursive. Ids must be unique. */
  load(items: readonly { readonly id: string; readonly bounds: Bounds }[]): void {
    this.clear();
    if (items.length === 0) return;
    const entries: Entry[] = items.map(({ id, bounds }) => {
      if (this.entries.has(id)) throw new Error(`Spatial index already holds "${id}".`);
      const entry = { id, node: undefined as unknown as Node, minX: bounds.minX, minY: bounds.minY, maxX: bounds.maxX, maxY: bounds.maxY };
      this.entries.set(id, entry);
      return entry;
    });

    let level: Node[] = pack(entries, (group) => {
      const node = emptyLeaf();
      node.entries = group;
      for (const entry of group) entry.node = node;
      recalc(node);
      return node;
    });
    while (level.length > 1) {
      level = pack(level, (group) => {
        const node = emptyLeaf();
        node.leaf = false;
        node.children = group;
        for (const child of group) child.parent = node;
        recalc(node);
        return node;
      });
    }
    this.root = level[0]!;
    this.root.parent = null;
  }

  private chooseLeaf(box: Box): Node {
    let node = this.root;
    while (!node.leaf) {
      let best = node.children[0]!;
      let bestGrowth = Infinity;
      let bestArea = Infinity;
      for (const child of node.children) {
        const childArea = area(child);
        const growth = unionArea(child, box) - childArea;
        if (growth < bestGrowth || (growth === bestGrowth && childArea < bestArea)) {
          best = child;
          bestGrowth = growth;
          bestArea = childArea;
        }
      }
      node = best;
    }
    return node;
  }

  /** Splits `node` while it is over capacity, pushing the overflow up toward the root. */
  private splitUpwards(node: Node): void {
    let current: Node | null = node;
    while (current && itemCount(current) > MAX_ENTRIES) {
      const sibling = emptyLeaf();
      sibling.leaf = current.leaf;
      if (current.leaf) {
        const [keep, move] = quadraticSplit(current.entries);
        current.entries = keep;
        sibling.entries = move;
        for (const entry of move) entry.node = sibling;
      } else {
        const [keep, move] = quadraticSplit(current.children);
        current.children = keep;
        sibling.children = move;
        for (const child of move) child.parent = sibling;
      }
      recalc(current);
      recalc(sibling);

      const parent: Node | null = current.parent;
      if (parent) {
        sibling.parent = parent;
        parent.children.push(sibling);
      } else {
        const root = emptyLeaf();
        root.leaf = false;
        root.children = [current, sibling];
        current.parent = root;
        sibling.parent = root;
        recalc(root);
        this.root = root;
      }
      current = parent;
    }
  }
}

function emptyLeaf(): Node {
  return { leaf: true, parent: null, entries: [], children: [], minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

function itemCount(node: Node): number {
  return node.leaf ? node.entries.length : node.children.length;
}

function area(b: Box): number {
  return (b.maxX - b.minX) * (b.maxY - b.minY);
}

function unionArea(a: Box, b: Box): number {
  return (Math.max(a.maxX, b.maxX) - Math.min(a.minX, b.minX)) * (Math.max(a.maxY, b.maxY) - Math.min(a.minY, b.minY));
}

function hits(a: Box, b: Box): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

function extend(target: Box, b: Box): void {
  if (b.minX < target.minX) target.minX = b.minX;
  if (b.minY < target.minY) target.minY = b.minY;
  if (b.maxX > target.maxX) target.maxX = b.maxX;
  if (b.maxY > target.maxY) target.maxY = b.maxY;
}

/** Recomputes a node's box from its contents. An empty node gets an empty (inverted) box that intersects nothing. */
function recalc(node: Node): void {
  node.minX = Infinity;
  node.minY = Infinity;
  node.maxX = -Infinity;
  node.maxY = -Infinity;
  if (node.leaf) for (const entry of node.entries) extend(node, entry);
  else for (const child of node.children) extend(node, child);
}

/** Guttman's quadratic split: seed with the pair that wastes the most area, then assign the rest greedily. */
function quadraticSplit<T extends Box>(items: readonly T[]): [T[], T[]] {
  let seedA = 0;
  let seedB = 1;
  let worst = -Infinity;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const waste = unionArea(items[i]!, items[j]!) - area(items[i]!) - area(items[j]!);
      if (waste > worst) {
        worst = waste;
        seedA = i;
        seedB = j;
      }
    }
  }

  const groupA: T[] = [items[seedA]!];
  const groupB: T[] = [items[seedB]!];
  const boxA: Box = { ...items[seedA]! };
  const boxB: Box = { ...items[seedB]! };
  const rest = items.filter((_, i) => i !== seedA && i !== seedB);

  const add = (group: T[], box: Box, item: T): void => {
    group.push(item);
    extend(box, item);
  };

  while (rest.length > 0) {
    // A group that needs every remaining item to reach the minimum takes them all.
    if (groupA.length + rest.length === MIN_ENTRIES) {
      for (const item of rest) add(groupA, boxA, item);
      break;
    }
    if (groupB.length + rest.length === MIN_ENTRIES) {
      for (const item of rest) add(groupB, boxB, item);
      break;
    }

    // Take the item with the strongest preference for one group.
    let pick = 0;
    let strongest = -1;
    for (let i = 0; i < rest.length; i++) {
      const preference = Math.abs(unionArea(boxA, rest[i]!) - area(boxA) - (unionArea(boxB, rest[i]!) - area(boxB)));
      if (preference > strongest) {
        strongest = preference;
        pick = i;
      }
    }
    const [item] = rest.splice(pick, 1);
    const growthA = unionArea(boxA, item!) - area(boxA);
    const growthB = unionArea(boxB, item!) - area(boxB);
    const toA =
      growthA < growthB ||
      (growthA === growthB && (area(boxA) < area(boxB) || (area(boxA) === area(boxB) && groupA.length <= groupB.length)));
    if (toA) add(groupA, boxA, item!);
    else add(groupB, boxB, item!);
  }
  return [groupA, groupB];
}

/** One level of sort-tile-recursive packing: vertical slices by x, then runs of MAX_ENTRIES by y inside each slice. */
function pack<T extends Box>(items: T[], make: (group: T[]) => Node): Node[] {
  const nodeCount = Math.ceil(items.length / MAX_ENTRIES);
  const sliceCount = Math.ceil(Math.sqrt(nodeCount));
  const sliceSize = sliceCount * MAX_ENTRIES;
  const byX = [...items].sort((a, b) => a.minX + a.maxX - (b.minX + b.maxX));
  const nodes: Node[] = [];
  for (let i = 0; i < byX.length; i += sliceSize) {
    const slice = byX.slice(i, i + sliceSize).sort((a, b) => a.minY + a.maxY - (b.minY + b.maxY));
    for (let j = 0; j < slice.length; j += MAX_ENTRIES) nodes.push(make(slice.slice(j, j + MAX_ENTRIES)));
  }
  return nodes;
}
