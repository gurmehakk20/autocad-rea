import { DRAWING_UNITS, type DrawingUnits } from '../../core/document/Drawing';
import { ENTITY_LABELS, type Entity } from '../../core/entities/types';
import { arcSweep } from '../../core/geometry/arc';
import { session, useSessionVersion } from '../../state/session';

const fmt = (n: number) => (Math.abs(n) < 5e-10 ? '0' : Number(n.toFixed(4)).toString());

const UNIT_LABELS: Record<DrawingUnits, string> = {
  unitless: 'Unitless',
  inch: 'Inches',
  foot: 'Feet',
  mm: 'Millimetres',
  cm: 'Centimetres',
  m: 'Metres',
};

/** Context-sensitive properties: selection details and editable layer and colour, or drawing settings when nothing is selected. */
export function PropertiesPanel() {
  useSessionVersion();
  const entities = session.selection
    .toArray()
    .map((id) => session.drawing.getEntity(id))
    .filter((e): e is Entity => !!e);

  if (entities.length === 0) {
    return (
      <section className="panel" aria-label="Properties">
        <h2 className="panel-title">Properties</h2>
        <p className="muted">Nothing selected. Pick an object to edit its layer and colour.</p>
        <label className="field">
          <span>Drawing units</span>
          <select value={session.drawing.units} onChange={(e) => session.setUnits(e.target.value as DrawingUnits)}>
            {DRAWING_UNITS.map((u) => (
              <option key={u} value={u}>
                {UNIT_LABELS[u]}
              </option>
            ))}
          </select>
        </label>
        <dl className="facts">
          <dt>Entities</dt>
          <dd>{session.drawing.entityCount}</dd>
          <dt>Layers</dt>
          <dd>{session.drawing.layers().length}</dd>
        </dl>
      </section>
    );
  }

  const single = entities.length === 1 ? entities[0]! : null;
  const commonLayer = entities.every((e) => e.layer === entities[0]!.layer) ? entities[0]!.layer : '';
  const commonColor = entities.every((e) => e.color === entities[0]!.color) ? entities[0]!.color : undefined;

  return (
    <section className="panel" aria-label="Properties">
      <h2 className="panel-title">
        {single ? ENTITY_LABELS[single.type] : `${entities.length} objects`}
      </h2>
      <label className="field">
        <span>Layer</span>
        <select value={commonLayer} onChange={(e) => session.setSelectionLayer(e.target.value)}>
          {commonLayer === '' && <option value="">Mixed</option>}
          {session.drawing.layers().map((l) => (
            <option key={l.name} value={l.name}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      <div className="field">
        <span>Colour</span>
        <div className="row">
          <label className="check">
            <input
              type="checkbox"
              checked={commonColor === null}
              onChange={(e) => session.setSelectionColor(e.target.checked ? null : '#e6e6e6')}
            />
            By layer
          </label>
          {commonColor !== null && (
            <input
              type="color"
              aria-label="Entity colour"
              value={commonColor ?? '#e6e6e6'}
              onChange={(e) => session.setSelectionColor(e.target.value)}
            />
          )}
        </div>
      </div>
      {single && <Geometry entity={single} />}
    </section>
  );
}

function Geometry({ entity }: { entity: Entity }) {
  switch (entity.type) {
    case 'line':
      return (
        <dl className="facts">
          <dt>Start</dt>
          <dd>{fmt(entity.start.x)}, {fmt(entity.start.y)}</dd>
          <dt>End</dt>
          <dd>{fmt(entity.end.x)}, {fmt(entity.end.y)}</dd>
          <dt>Length</dt>
          <dd>{fmt(Math.hypot(entity.end.x - entity.start.x, entity.end.y - entity.start.y))}</dd>
        </dl>
      );
    case 'circle':
      return (
        <dl className="facts">
          <dt>Centre</dt>
          <dd>{fmt(entity.center.x)}, {fmt(entity.center.y)}</dd>
          <dt>Radius</dt>
          <dd>{fmt(entity.radius)}</dd>
        </dl>
      );
    case 'arc':
      return (
        <dl className="facts">
          <dt>Centre</dt>
          <dd>{fmt(entity.center.x)}, {fmt(entity.center.y)}</dd>
          <dt>Radius</dt>
          <dd>{fmt(entity.radius)}</dd>
          <dt>Sweep</dt>
          <dd>{fmt((arcSweep(entity) * 180) / Math.PI)}°</dd>
        </dl>
      );
    case 'polyline':
      return (
        <dl className="facts">
          <dt>Vertices</dt>
          <dd>{entity.vertices.length}</dd>
          <dt>Closed</dt>
          <dd>{entity.closed ? 'Yes' : 'No'}</dd>
        </dl>
      );
  }
}
