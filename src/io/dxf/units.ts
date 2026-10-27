import { Units } from '@tarikjabiri/dxf';
import type { DrawingUnits } from '../../core/document/Drawing';

/** DXF $INSUNITS codes that OpenDraft understands. Other codes are reported and imported as unitless. */
export const INSUNITS_TO_DRAWING: Record<number, DrawingUnits> = {
  0: 'unitless',
  1: 'inch',
  2: 'foot',
  4: 'mm',
  5: 'cm',
  6: 'm',
};

export const DRAWING_TO_DXF_UNITS: Record<DrawingUnits, Units> = {
  unitless: Units.Unitless,
  inch: Units.Inches,
  foot: Units.Feet,
  mm: Units.Millimeters,
  cm: Units.Centimeters,
  m: Units.Meters,
};

/**
 * The AutoCAD Colour Index entries used for layers. Only the seven primary
 * colours are mapped to exact hex values, because the full 256-entry table is
 * not needed for the supported subset. Other indices are approximated and reported.
 */
export const ACI_PALETTE: Record<number, string> = {
  1: '#ff0000',
  2: '#ffff00',
  3: '#00ff00',
  4: '#00ffff',
  5: '#0000ff',
  6: '#ff00ff',
  7: '#e6e6e6',
  8: '#808080',
  9: '#c0c0c0',
};

/** Nearest primary ACI colour (1–7) for an arbitrary hex colour. */
export function nearestAci(hex: string): number {
  const target = parseHex(hex);
  let best = 7;
  let bestDistance = Infinity;
  for (let index = 1; index <= 7; index++) {
    const candidate = parseHex(ACI_PALETTE[index]!);
    const d = (candidate[0] - target[0]) ** 2 + (candidate[1] - target[1]) ** 2 + (candidate[2] - target[2]) ** 2;
    if (d < bestDistance) {
      bestDistance = d;
      best = index;
    }
  }
  return best;
}

export function parseHex(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex(rgb: number): string {
  return `#${(rgb & 0xffffff).toString(16).padStart(6, '0')}`;
}
