import { DxfWriter, LWPolylineFlags, LayerFlags, point2d, point3d, rad2deg } from '@tarikjabiri/dxf';
import type { Drawing } from '../../core/document/Drawing';
import type { Entity } from '../../core/entities/types';
import { DRAWING_TO_DXF_UNITS, nearestAci, parseHex, ACI_PALETTE } from './units';

export interface DxfExportResult {
  readonly text: string;
  /** Things that were changed or approximated during export. Shown to the user. */
  readonly warnings: string[];
}

/**
 * Writes the drawing as DXF (AutoCAD R2007 / AC1021 layout written by the library).
 *
 * Supported entities: LINE, CIRCLE, ARC, LWPOLYLINE. Explicit entity colours are
 * written as true colour (group 420) and are exact. Layer colours must use the
 * ACI table, so non-palette layer colours are approximated and reported.
 */
export function exportDxf(drawing: Drawing): DxfExportResult {
  const warnings: string[] = [];
  const writer = new DxfWriter();
  writer.setUnits(DRAWING_TO_DXF_UNITS[drawing.units]);

  for (const layer of drawing.layers()) {
    const aci = nearestAci(layer.color);
    if (ACI_PALETTE[aci] !== layer.color.toLowerCase()) {
      warnings.push(`Layer "${layer.name}" colour ${layer.color} was approximated to an AutoCAD palette colour.`);
    }
    let flags = LayerFlags.None;
    if (!layer.visible) flags |= LayerFlags.Frozen;
    if (layer.locked) flags |= LayerFlags.Locked;
    writer.addLayer(layer.name, aci, 'CONTINUOUS', flags);
  }

  for (const entity of drawing.entities()) {
    const options = {
      layerName: entity.layer,
      ...(entity.color ? { trueColor: String(hexToInt(entity.color)) } : {}),
    };
    addEntity(writer, entity, options);
  }

  return { text: writer.stringify(), warnings };
}

/** `#rrggbb` to the 0xRRGGBB integer that DXF group 420 expects. */
function hexToInt(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return (r << 16) | (g << 8) | b;
}

function addEntity(
  writer: DxfWriter,
  entity: Entity,
  options: { layerName: string; trueColor?: string },
): void {
  switch (entity.type) {
    case 'line':
      writer.addLine(point3d(entity.start.x, entity.start.y), point3d(entity.end.x, entity.end.y), options);
      return;
    case 'circle':
      writer.addCircle(point3d(entity.center.x, entity.center.y), entity.radius, options);
      return;
    case 'arc':
      // DXF stores arc angles in degrees, counter-clockwise from start to end.
      writer.addArc(
        point3d(entity.center.x, entity.center.y),
        entity.radius,
        rad2deg(entity.startAngle),
        rad2deg(entity.endAngle),
        options,
      );
      return;
    case 'polyline':
      writer.addLWPolyline(
        entity.vertices.map((v) => ({ point: point2d(v.x, v.y) })),
        { ...options, flags: entity.closed ? LWPolylineFlags.Closed : LWPolylineFlags.None },
      );
      return;
  }
}
