import { writeFileSync } from 'node:fs';
import { arch, cpus, platform, release, totalmem } from 'node:os';
import { describe, it } from 'vitest';
import { History } from '../../src/core/history/History';
import { Drawing } from '../../src/core/document/Drawing';
import type { Entity } from '../../src/core/entities/types';
import { vec2 } from '../../src/core/geometry/vector';
import { DEFAULT_SNAP_SETTINGS, findSnap } from '../../src/core/snapping/snap';
import { pickEntity, selectByRectangle } from '../../src/core/selection/selection';
import { importDxf } from '../../src/io/dxf/read';
import { exportDxf } from '../../src/io/dxf/write';
import { parseDrawing, serializeDrawing } from '../../src/io/serialization/native';

/**
 * Micro-benchmarks for the hot paths. These are not pass/fail checks. They write
 * median timings to docs/BENCHMARKS.md together with the machine they ran on.
 * Run with `npm run bench`.
 */
const SIZES = [1_000, 10_000, 100_000];
const WARMUP = 3;
/** From this size on, operations that touch the whole drawing run 5 samples of 2 calls instead of 15 of 10. */
const HEAVY_SIZE = 100_000;
const SAMPLES = 15;
const ITERATIONS = 10;

/** Deterministic drawing: alternating short lines and small circles on a square grid. */
function buildDrawing(n: number): Drawing {
  const d = new Drawing();
  const side = Math.ceil(Math.sqrt(n));
  for (let i = 0; i < n; i++) {
    const x = (i % side) * 10;
    const y = Math.floor(i / side) * 10;
    const entity: Entity =
      i % 2 === 0
        ? { id: d.nextId(), type: 'line', layer: '0', color: null, start: vec2(x, y), end: vec2(x + 6, y + 3) }
        : { id: d.nextId(), type: 'circle', layer: '0', color: null, center: vec2(x + 4, y + 4), radius: 2 };
    d.apply({ kind: 'insert', entity, index: d.entityCount });
  }
  return d;
}

/** Select-all, Delete, then Ctrl+Z, through the same batch mutations the session uses. */
function deleteAllAndUndo(drawing: Drawing): void {
  const history = new History(drawing);
  const ids = drawing.entities().map((e) => e.id);
  history.execute({ kind: 'batch', mutations: ids.map((id) => ({ kind: 'remove' as const, id })) }, 'Delete');
  history.undo();
}

/** Median milliseconds per call over SAMPLES runs of ITERATIONS calls each. */
function medianMs(fn: () => unknown, samplesCount = SAMPLES, iterations = ITERATIONS): number {
  for (let i = 0; i < WARMUP; i++) fn();
  const samples: number[] = [];
  for (let s = 0; s < samplesCount; s++) {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) fn();
    samples.push((performance.now() - start) / iterations);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)]!;
}

function environmentLines(): string[] {
  const cpu = cpus();
  return [
    `- CPU: ${cpu[0]?.model.trim() ?? 'unknown'} (${cpu.length} logical cores)`,
    `- OS: ${platform()} ${release()} (${arch()})`,
    `- RAM: ${(totalmem() / 1024 ** 3).toFixed(1)} GB`,
    `- Node: ${process.version}`,
  ];
}

describe('geometry and file benchmarks', () => {
  it('measures median timings and writes docs/BENCHMARKS.md', () => {
    const rows: string[] = [];
    for (const n of SIZES) {
      const drawing = buildDrawing(n);
      const side = Math.ceil(Math.sqrt(n));
      const cursor = vec2(side * 5, side * 5);
      const dxf = exportDxf(drawing).text;
      const native = serializeDrawing(drawing);

      const ops: Array<[string, () => unknown]> = [
        ['pick entity', () => pickEntity(drawing, cursor, 0.5)],
        ['object snap', () => findSnap({ drawing, cursor, tolerance: 0.5, settings: DEFAULT_SNAP_SETTINGS })],
        ['window select 50x50', () => selectByRectangle(drawing, vec2(0, 0), vec2(50, 50), 'window')],
        ['delete all and undo', () => deleteAllAndUndo(drawing)],
        ['export DXF', () => exportDxf(drawing)],
        ['import DXF', () => importDxf(dxf)],
        ['serialize JSON', () => serializeDrawing(drawing)],
        ['parse JSON', () => parseDrawing(native)],
      ];
      for (const [name, fn] of ops) {
        // Whole-file operations take hundreds of milliseconds at this size, so they get fewer repetitions.
        const heavy = n >= HEAVY_SIZE && !['pick entity', 'object snap', 'window select 50x50'].includes(name);
        rows.push(`| ${n} | ${name} | ${(heavy ? medianMs(fn, 5, 2) : medianMs(fn)).toFixed(3)} |`);
      }
    }

    // Worst case for snapping: many entities overlap under the cursor, so intersections are tested pair by pair.
    for (const cluster of [50, 200, 500]) {
      const drawing = buildDrawing(10_000);
      const centre = vec2(250, 250);
      for (let i = 0; i < cluster; i++) {
        const entity: Entity = {
          id: drawing.nextId(),
          type: 'circle',
          layer: '0',
          color: null,
          center: vec2(centre.x + ((i * 7) % 11) * 0.05, centre.y + ((i * 13) % 11) * 0.05),
          radius: 5 + (i % 7) * 0.01,
        };
        drawing.apply({ kind: 'insert', entity, index: drawing.entityCount });
      }
      const onRing = vec2(centre.x + 5, centre.y);
      const label = `10000 + ${cluster} overlapping circles`;
      rows.push(`| ${label} | pick entity | ${medianMs(() => pickEntity(drawing, onRing, 0.5)).toFixed(3)} |`);
      rows.push(`| ${label} | object snap | ${medianMs(() => findSnap({ drawing, cursor: onRing, tolerance: 0.5, settings: DEFAULT_SNAP_SETTINGS }), 5, 2).toFixed(3)} |`);
    }

    // Big shapes that only surround the cursor: their bounds contain it, but they are far from it.
    for (const rings of [200, 500]) {
      const drawing = buildDrawing(10_000);
      for (let i = 1; i <= rings; i++) {
        const entity: Entity = { id: drawing.nextId(), type: 'circle', layer: '0', color: null, center: vec2(250, 250), radius: i * 2 };
        drawing.apply({ kind: 'insert', entity, index: drawing.entityCount });
      }
      const onRing = vec2(250 + 2 * Math.floor(rings / 2), 250);
      const label = `10000 + ${rings} concentric circles`;
      rows.push(`| ${label} | object snap | ${medianMs(() => findSnap({ drawing, cursor: onRing, tolerance: 0.5, settings: DEFAULT_SNAP_SETTINGS }), 5, 2).toFixed(3)} |`);
    }

    const report = [
      '# Benchmark results',
      '',
      'Generated by `npm run bench`. Numbers depend on the machine, so treat them as a baseline for this environment, not a guarantee.',
      '',
      '## Environment',
      '',
      ...environmentLines(),
      '',
      `Each value is the median of ${SAMPLES} samples of ${ITERATIONS} calls, after ${WARMUP} warm-up runs. At ${HEAVY_SIZE} entities the operations that touch the whole drawing (everything except pick, snap and window select) use 5 samples of 2 calls.`,
      '',
      '| Entities | Operation | Median ms |',
      '|---|---|---|',
      ...rows,
      '',
    ].join('\n');
    writeFileSync('docs/BENCHMARKS.md', report);
  }, 600_000);
});
