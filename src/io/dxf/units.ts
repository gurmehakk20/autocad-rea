import { Units } from '@tarikjabiri/dxf';
import type { DrawingUnits } from '../../core/document/Drawing';
import { ACI_TABLE } from './aci';

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
 * Index 7 is drawn white on a dark background and black on a light one. This workspace is dark and draws
 * default linework in this off-white, so index 7 maps to it rather than to the table's pure white.
 */
const ACI_SEVEN = '#e6e6e6';

/**
 * Display colour of each ACI index 1 to 255 (`aci.ts`, with index 7 as above). Index 0 (ByBlock) and 256
 * (ByLayer) are not colours and are absent. Index 250 is black in the source palette and is hard to see on
 * the dark workspace; it is kept as the palette defines it.
 */
export const ACI_PALETTE: Record<number, string> = Object.fromEntries(
  ACI_TABLE.map((hex, index) => [index, index === 7 ? ACI_SEVEN : hex]).slice(1),
);

/** The ACI index whose colour is closest to `hex`. An exact match wins, and the lowest index wins a tie. */
export function nearestAci(hex: string): number {
  const target = parseHex(hex);
  let best = 7;
  let bestDistance = Infinity;
  for (let index = 1; index <= 255; index++) {
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
