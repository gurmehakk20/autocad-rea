import { useState } from 'react';
import { DEFAULT_LAYER_NAME } from '../../core/document/Drawing';
import { session, useSessionVersion } from '../../state/session';

/** Layer manager: active layer, visibility, locking, colour, rename and delete. */
export function LayerPanel() {
  useSessionVersion();
  const [newName, setNewName] = useState('');
  const layers = session.drawing.layers();
  const active = session.activeLayerName;

  const onAdd = () => {
    session.addLayer(newName);
    setNewName('');
  };

  return (
    <section className="panel" aria-label="Layers">
      <h2 className="panel-title">Layers</h2>
      <ul className="layer-list">
        {layers.map((layer) => (
          <LayerRow key={layer.name} name={layer.name} active={layer.name === active} />
        ))}
      </ul>
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          onAdd();
        }}
      >
        <input
          aria-label="New layer name"
          placeholder="New layer name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button type="submit" disabled={newName.trim() === ''}>
          Add
        </button>
      </form>
    </section>
  );
}

function LayerRow({ name, active }: { name: string; active: boolean }) {
  const layer = session.drawing.getLayer(name)!;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  const commitRename = () => {
    setEditing(false);
    session.renameLayer(name, draft);
    setDraft(name);
  };

  return (
    <li className={active ? 'layer-row active' : 'layer-row'}>
      <button
        type="button"
        className="layer-select"
        onClick={() => session.setActiveLayer(name)}
        onDoubleClick={() => name !== DEFAULT_LAYER_NAME && setEditing(true)}
        title={active ? 'Active layer (double-click to rename)' : 'Make active'}
        aria-pressed={active}
      >
        {editing ? (
          <input
            autoFocus
            aria-label={`Rename layer ${name}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') {
                setDraft(name);
                setEditing(false);
              }
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="layer-name">{name}</span>
        )}
      </button>
      <button
        type="button"
        className={layer.visible ? 'mini on' : 'mini'}
        aria-pressed={layer.visible}
        onClick={() => session.updateLayer(name, { visible: !layer.visible })}
        title="Visibility"
      >
        {layer.visible ? 'On' : 'Off'}
      </button>
      <button
        type="button"
        className={layer.locked ? 'mini on' : 'mini'}
        aria-pressed={layer.locked}
        onClick={() => session.updateLayer(name, { locked: !layer.locked })}
        title="Lock editing"
      >
        {layer.locked ? 'Locked' : 'Lock'}
      </button>
      <input
        type="color"
        className="swatch"
        aria-label={`Colour of layer ${name}`}
        value={layer.color}
        onChange={(e) => session.updateLayer(name, { color: e.target.value })}
      />
      <button
        type="button"
        className="mini"
        onClick={() => session.deleteLayer(name)}
        disabled={name === DEFAULT_LAYER_NAME}
        title={name === DEFAULT_LAYER_NAME ? 'Layer 0 cannot be deleted' : 'Delete layer (entities move to layer 0)'}
      >
        Del
      </button>
    </li>
  );
}
