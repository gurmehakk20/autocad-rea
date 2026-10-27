import { DEFAULT_LAYER_NAME, Drawing, type DrawingUnits, type Layer, type Mutation } from '../core/document/Drawing';
import { unionEntityBounds } from '../core/entities/geometry';
import type { EntityId } from '../core/entities/types';
import { History } from '../core/history/History';
import { type Vec2, distance } from '../core/geometry/vector';
import { DEFAULT_SNAP_SETTINGS, type SnapResult, type SnapSettings, findSnap } from '../core/snapping/snap';
import { Selection, selectableIds } from '../core/selection/selection';
import { createTool, TOOL_INFO } from '../core/tools/factory';
import { editableSelectionIds } from '../core/tools/modify-tools';
import type { Preview, Tool, ToolContext, ToolId } from '../core/tools/types';
import { DrawingFileError, parseDrawing, serializeDrawing } from '../io/serialization/native';
import { DxfFileError, importDxf } from '../io/dxf/read';
import { exportDxf } from '../io/dxf/write';
import { type Camera, DEFAULT_CAMERA, type ViewSize, fitBounds, panByPixels, screenToWorld, zoomAtPixel } from '../viewport/camera';
import { type ParsedInput, parseInput } from './input-parse';

/** Screen-space pixels that a press must travel before it counts as a drag. */
const DRAG_START_PX = 4;
/** Capture radius for picking and snapping, in screen pixels. */
const PICK_PX = 8;
const LOG_LIMIT = 200;
const LAYER_COLORS = ['#e6e6e6', '#ff5f56', '#ffbd2e', '#27c93f', '#4da3ff', '#c678dd', '#56d4dd', '#f0a070'];

export interface RubberBand {
  readonly a: Vec2;
  readonly b: Vec2;
  readonly crossing: boolean;
}

/** Everything the renderer needs for one frame. Built fresh each time, never mutated. */
export interface RenderState {
  readonly drawing: Drawing;
  readonly camera: Camera;
  readonly selection: ReadonlySet<EntityId>;
  readonly preview: Preview | null;
  readonly snap: SnapResult | null;
  readonly cursor: Vec2 | null;
  readonly rubberBand: RubberBand | null;
  readonly gridSize: number;
  readonly gridVisible: boolean;
}

type Listener = () => void;

export class EditorSession {
  drawing = new Drawing();
  history = new History(this.drawing);
  readonly selection = new Selection();
  snap: SnapSettings = { ...DEFAULT_SNAP_SETTINGS };
  gridVisible = true;
  activeLayerName = DEFAULT_LAYER_NAME;
  fileName: string | null = null;
  view: ViewSize = { width: 800, height: 600 };

  private cameraState: Camera = DEFAULT_CAMERA;
  private toolState: Tool;
  private cursorWorld: Vec2 | null = null;
  private snapState: SnapResult | null = null;
  private pressed: { screen: Vec2; world: Vec2; shift: boolean; dragging: boolean } | null = null;
  private panning: { screen: Vec2 } | null = null;
  private spaceHeld = false;
  private logLines: string[] = [];
  private viewListeners = new Set<Listener>();
  private uiListeners = new Set<Listener>();
  private uiVersion = 0;

  constructor() {
    this.toolState = createTool('select', this.toolContext());
  }

  // ---- subscriptions -------------------------------------------------------

  /** Frequent channel: fires on pointer movement, pans and every redraw-worthy change. */
  subscribeView(listener: Listener): () => void {
    this.viewListeners.add(listener);
    return () => this.viewListeners.delete(listener);
  }

  /** Infrequent channel for React: fires only on state changes the panels display. */
  subscribeUi(listener: Listener): () => void {
    this.uiListeners.add(listener);
    return () => this.uiListeners.delete(listener);
  }

  getUiVersion = (): number => this.uiVersion;

  private emitView(): void {
    for (const listener of this.viewListeners) listener();
  }

  private emitAll(): void {
    this.uiVersion += 1;
    this.emitView();
    for (const listener of this.uiListeners) listener();
  }

  // ---- read access -----------------------------------------------------------

  get camera(): Camera {
    return this.cameraState;
  }

  get tool(): Tool {
    return this.toolState;
  }

  get toolId(): ToolId {
    return this.toolState.id;
  }

  get cursor(): Vec2 | null {
    return this.cursorWorld;
  }

  get snapResult(): SnapResult | null {
    return this.snapState;
  }

  get log(): readonly string[] {
    return this.logLines;
  }

  get isDirty(): boolean {
    return this.history.isDirty;
  }

  get pickTolerance(): number {
    return PICK_PX / this.cameraState.zoom;
  }

  renderState(): RenderState {
    const press = this.pressed;
    const rubberBand =
      press?.dragging && this.cursorWorld
        ? { a: press.world, b: this.cursorWorld, crossing: this.cursorWorld.x < press.world.x }
        : null;
    return {
      drawing: this.drawing,
      camera: this.cameraState,
      selection: new Set(this.selection.toArray()),
      preview: this.cursorWorld && this.toolState.wantsPoint ? this.toolState.preview(this.snapState?.point ?? this.cursorWorld) : null,
      snap: this.snapState,
      cursor: this.cursorWorld,
      rubberBand,
      gridSize: this.snap.gridSize,
      gridVisible: this.gridVisible,
    };
  }

  layerNames(): string[] {
    return this.drawing.layers().map((l) => l.name);
  }

  // ---- view and pointer ------------------------------------------------------

  setViewSize(width: number, height: number): void {
    if (width === this.view.width && height === this.view.height) return;
    this.view = { width, height };
    this.emitView();
  }

  setSpaceHeld(held: boolean): void {
    this.spaceHeld = held;
  }

  /** Pointer movement in screen pixels relative to the canvas. */
  pointerMove(screen: Vec2): void {
    if (this.panning) {
      this.cameraState = panByPixels(this.cameraState, screen.x - this.panning.screen.x, screen.y - this.panning.screen.y);
      this.panning = { screen };
    }
    this.cursorWorld = this.toWorld(screen);
    this.snapState = this.toolState.wantsPoint ? this.resolvePoint(this.cursorWorld) : null;
    if (this.pressed && !this.pressed.dragging && distance(this.pressed.screen, screen) > DRAG_START_PX) {
      this.pressed = { ...this.pressed, dragging: true };
    }
    this.emitView();
  }

  pointerDown(screen: Vec2, button: number, shift: boolean): void {
    if (button === 1 || (button === 0 && this.spaceHeld)) {
      this.panning = { screen };
      return;
    }
    if (button !== 0) return;
    const world = this.toWorld(screen);
    this.pressed = { screen, world, shift, dragging: false };
  }

  pointerUp(screen: Vec2): void {
    if (this.panning) {
      this.panning = null;
      return;
    }
    const press = this.pressed;
    this.pressed = null;
    if (!press) return;
    const world = this.toWorld(screen);
    if (press.dragging && this.toolState.drag) {
      this.toolState.drag(press.world, world, press.shift);
    } else {
      const point = this.toolState.wantsPoint ? this.resolvePoint(world).point : world;
      this.toolState.pick(point, press.shift);
    }
    this.afterToolAction();
  }

  /** Mouse wheel. Positive deltaY zooms out, matching common CAD behaviour. */
  wheel(screen: Vec2, deltaY: number): void {
    const factor = deltaY < 0 ? 1.15 : 1 / 1.15;
    this.cameraState = zoomAtPixel(this.cameraState, this.view, screen.x, screen.y, factor);
    this.cursorWorld = this.toWorld(screen);
    this.emitView();
  }

  zoomExtents(): void {
    const bounds = unionEntityBounds(this.drawing.entities());
    if (!bounds) {
      this.cameraState = DEFAULT_CAMERA;
      this.message('Drawing is empty. View reset to the origin.');
    } else {
      this.cameraState = fitBounds(bounds, this.view);
    }
    this.emitView();
  }

  private toWorld(screen: Vec2): Vec2 {
    return screenToWorld(this.cameraState, this.view, screen.x, screen.y);
  }

  /** Object snap, then grid, then ortho. The tool's moving selection is excluded from snapping. */
  private resolvePoint(raw: Vec2): SnapResult {
    const excluded = this.toolState.id === 'move' || this.toolState.id === 'copy' || this.toolState.id === 'rotate'
      ? new Set(editableSelectionIds(this.toolContext()))
      : undefined;
    return findSnap({
      drawing: this.drawing,
      cursor: raw,
      tolerance: this.pickTolerance,
      settings: this.snap,
      base: this.toolState.basePoint,
      exclude: excluded,
    });
  }

  // ---- tools and commands ----------------------------------------------------

  setTool(id: ToolId): void {
    this.toolState = createTool(id, this.toolContext());
    this.snapState = null;
    this.message(this.toolState.prompt());
    this.emitAll();
  }

  /** Enter key: finish the current tool step. */
  confirm(): void {
    this.toolState.confirm();
    this.afterToolAction();
  }

  /** Escape key: abandon the current step, or return to Select. Select clears the selection. */
  cancel(): void {
    const wasSelect = this.toolState.id === 'select';
    this.toolState.cancel();
    if (wasSelect) this.selection.clear();
    this.afterToolAction();
  }

  /** Typed input from the command line, a point, a number, or a command name. */
  submitCommand(text: string): void {
    const trimmed = text.trim();
    if (trimmed !== '') this.logLines = [...this.logLines, `> ${trimmed}`].slice(-LOG_LIMIT);
    const parsed: ParsedInput = parseInput(trimmed, this.toolState.basePoint);
    this.handleParsed(parsed);
    this.emitAll();
  }

  private handleParsed(parsed: ParsedInput): void {
    switch (parsed.kind) {
      case 'empty':
        this.confirm();
        return;
      case 'invalid':
        this.message(parsed.reason);
        return;
      case 'point':
        if (!this.toolState.wantsPoint) {
          this.message('No point is expected in this step.');
          return;
        }
        this.toolState.pick(parsed.point, false);
        this.afterToolAction();
        return;
      case 'number': {
        if (this.toolState.submitNumber?.(parsed.value)) {
          this.afterToolAction();
          return;
        }
        this.message(`Number ${parsed.value} is not expected here. Enter a point (x,y) or a command.`);
        return;
      }
      case 'text':
        this.runCommandName(parsed.text);
        return;
    }
  }

  private runCommandName(name: string): void {
    const tool = TOOL_INFO.find((t) => t.alias === name || t.label.toUpperCase() === name);
    if (tool) {
      this.setTool(tool.id);
      return;
    }
    switch (name) {
      case 'E':
      case 'ERASE':
      case 'DELETE':
        this.deleteSelection();
        return;
      case 'U':
      case 'UNDO':
        this.undo();
        return;
      case 'REDO':
        this.redo();
        return;
      case 'ZE':
      case 'ZOOM':
        this.zoomExtents();
        return;
      case 'GRID':
        this.toggleGrid();
        return;
      case 'SNAP':
        this.setSnap({ grid: !this.snap.grid });
        return;
      case 'ESC':
        this.cancel();
        return;
      default:
        this.message(`Unknown command "${name}". Try L, C, REC, PL, A, M, CO, RO, E, U or ZE.`);
    }
  }

  private afterToolAction(): void {
    if (this.toolState.finished) {
      this.toolState = createTool('select', this.toolContext());
      this.snapState = null;
    }
    this.emitAll();
  }

  toolContext(): ToolContext {
    return {
      drawing: this.drawing,
      history: this.history,
      selection: this.selection,
      activeLayer: () => this.activeLayerName,
      pickTolerance: () => this.pickTolerance,
      notify: (message) => this.message(message),
    };
  }

  message(text: string): void {
    this.logLines = [...this.logLines, text].slice(-LOG_LIMIT);
    this.uiVersion += 1;
    for (const listener of this.uiListeners) listener();
  }

  // ---- editing ---------------------------------------------------------------

  undo(): void {
    const entry = this.history.undo();
    this.selection.prune(this.drawing);
    this.message(entry ? `Undo: ${entry.label}` : 'Nothing to undo.');
    this.emitAll();
  }

  redo(): void {
    const entry = this.history.redo();
    this.selection.prune(this.drawing);
    this.message(entry ? `Redo: ${entry.label}` : 'Nothing to redo.');
    this.emitAll();
  }

  selectAll(): void {
    this.selection.replace(selectableIds(this.drawing));
    this.emitAll();
  }

  deleteSelection(): void {
    const ids = editableSelectionIds(this.toolContext());
    if (ids.length === 0) {
      this.message('Nothing selected to delete.');
      this.emitAll();
      return;
    }
    const mutations: Mutation[] = ids.map((id) => ({ kind: 'remove', id }));
    this.execute({ kind: 'batch', mutations }, 'Delete');
    this.selection.clear();
    this.message(`Deleted ${ids.length} entit${ids.length === 1 ? 'y' : 'ies'}.`);
    this.emitAll();
  }

  /** Runs a mutation through history, reporting any validation failure to the log. */
  private execute(mutation: Mutation, label: string): boolean {
    try {
      this.history.execute(mutation, label);
      return true;
    } catch (error) {
      this.message(error instanceof Error ? error.message : 'Operation failed.');
      return false;
    }
  }

  setSelectionLayer(layer: string): void {
    const ids = editableSelectionIds(this.toolContext());
    if (ids.length === 0) return;
    const mutations: Mutation[] = [];
    for (const id of ids) {
      const entity = this.drawing.getEntity(id)!;
      mutations.push({ kind: 'replace', entity: { ...entity, layer } });
    }
    if (this.execute({ kind: 'batch', mutations }, 'Change layer')) this.emitAll();
  }

  setSelectionColor(color: string | null): void {
    const ids = editableSelectionIds(this.toolContext());
    if (ids.length === 0) return;
    const mutations: Mutation[] = ids.map((id) => {
      const entity = this.drawing.getEntity(id)!;
      return { kind: 'replace', entity: { ...entity, color } } as Mutation;
    });
    if (this.execute({ kind: 'batch', mutations }, 'Change colour')) this.emitAll();
  }

  // ---- layers ----------------------------------------------------------------

  addLayer(name: string): void {
    const trimmed = name.trim();
    if (trimmed === '') return this.message('Layer name cannot be empty.');
    if (this.drawing.getLayer(trimmed)) return this.message(`Layer "${trimmed}" already exists.`);
    const color = LAYER_COLORS[this.drawing.layers().length % LAYER_COLORS.length]!;
    const layer: Layer = { name: trimmed, color, visible: true, locked: false };
    if (this.execute({ kind: 'put-layer', layer }, 'New layer')) {
      this.activeLayerName = trimmed;
      this.emitAll();
    }
  }

  updateLayer(name: string, patch: Partial<Pick<Layer, 'visible' | 'locked' | 'color'>>): void {
    const current = this.drawing.getLayer(name);
    if (!current) return;
    const next: Layer = { ...current, ...patch };
    if (this.execute({ kind: 'put-layer', layer: next }, 'Layer properties')) this.emitAll();
  }

  renameLayer(oldName: string, newName: string): void {
    const trimmed = newName.trim();
    const current = this.drawing.getLayer(oldName);
    if (!current || trimmed === oldName) return;
    if (trimmed === '') return this.message('Layer name cannot be empty.');
    if (this.drawing.getLayer(trimmed)) return this.message(`Layer "${trimmed}" already exists.`);
    if (oldName === DEFAULT_LAYER_NAME) return this.message('Layer 0 cannot be renamed.');
    const mutations: Mutation[] = [{ kind: 'put-layer', layer: { ...current, name: trimmed } }];
    for (const entity of this.drawing.entitiesOnLayer(oldName)) {
      mutations.push({ kind: 'replace', entity: { ...entity, layer: trimmed } });
    }
    mutations.push({ kind: 'delete-layer', name: oldName });
    if (this.execute({ kind: 'batch', mutations }, 'Rename layer')) {
      if (this.activeLayerName === oldName) this.activeLayerName = trimmed;
      this.emitAll();
    }
  }

  deleteLayer(name: string): void {
    if (name === DEFAULT_LAYER_NAME) return this.message('Layer 0 cannot be deleted.');
    if (!this.drawing.getLayer(name)) return;
    const moved = this.drawing.entitiesOnLayer(name);
    const mutations: Mutation[] = moved.map((entity) => ({
      kind: 'replace',
      entity: { ...entity, layer: DEFAULT_LAYER_NAME },
    }));
    mutations.push({ kind: 'delete-layer', name });
    if (this.execute({ kind: 'batch', mutations }, 'Delete layer')) {
      if (this.activeLayerName === name) this.activeLayerName = DEFAULT_LAYER_NAME;
      if (moved.length > 0) this.message(`Moved ${moved.length} entities to layer 0.`);
      this.emitAll();
    }
  }

  setActiveLayer(name: string): void {
    if (!this.drawing.getLayer(name)) return;
    this.activeLayerName = name;
    this.emitAll();
  }

  setUnits(units: DrawingUnits): void {
    if (this.execute({ kind: 'set-units', units }, 'Units')) this.emitAll();
  }

  // ---- display settings --------------------------------------------------------

  toggleGrid(): void {
    this.gridVisible = !this.gridVisible;
    this.message(`Grid ${this.gridVisible ? 'shown' : 'hidden'}.`);
    this.emitAll();
  }

  setSnap(patch: Partial<SnapSettings>): void {
    if (patch.gridSize !== undefined && !(patch.gridSize > 0)) {
      this.message('Grid spacing must be positive.');
      return;
    }
    this.snap = { ...this.snap, ...patch };
    this.emitAll();
  }

  // ---- documents ---------------------------------------------------------------

  newDocument(): void {
    this.replaceDrawing(new Drawing(), null);
    this.message('New drawing.');
  }

  loadNativeText(text: string, fileName: string): void {
    try {
      this.replaceDrawing(parseDrawing(text), fileName);
      this.message(`Opened ${fileName}.`);
    } catch (error) {
      if (error instanceof DrawingFileError) this.message(`Cannot open ${fileName}: ${error.message}`);
      else throw error;
    }
  }

  /** Imports DXF. Returns the warnings so the UI can show them in a report. */
  loadDxfText(text: string, fileName: string): string[] {
    try {
      const result = importDxf(text);
      this.replaceDrawing(result.drawing, null);
      this.message(`Imported ${result.imported} entities from ${fileName}; ${result.skipped} skipped.`);
      return result.warnings;
    } catch (error) {
      if (error instanceof DxfFileError) this.message(`Cannot import ${fileName}: ${error.message}`);
      else throw error;
      return [];
    }
  }

  serializeNative(): string {
    return serializeDrawing(this.drawing);
  }

  exportDxfText(): { text: string; warnings: string[] } {
    return exportDxf(this.drawing);
  }

  markSaved(fileName: string | null): void {
    this.history.markSaved();
    if (fileName) this.fileName = fileName;
    this.emitAll();
  }

  private replaceDrawing(drawing: Drawing, fileName: string | null): void {
    this.drawing = drawing;
    this.history = new History(drawing);
    this.history.markSaved();
    this.selection.clear();
    this.activeLayerName = DEFAULT_LAYER_NAME;
    this.fileName = fileName;
    this.pressed = null;
    this.toolState = createTool('select', this.toolContext());
    this.snapState = null;
    this.cameraState = this.cameraForDrawing(drawing);
    this.emitAll();
  }

  private cameraForDrawing(drawing: Drawing): Camera {
    const bounds = unionEntityBounds(drawing.entities());
    return bounds ? fitBounds(bounds, this.view) : DEFAULT_CAMERA;
  }
}
