import { type KeyboardEvent, useState } from 'react';
import { type FieldSpec, editableFields, formatFieldValue, readField } from '../../core/entities/edit';
import type { Entity } from '../../core/entities/types';
import { parseFieldNumber } from '../../state/input-parse';
import { session } from '../../state/session';

/** Number fields for the geometry of the selected line, circle or arc. Polylines have none until vertex editing exists. */
export function GeometryFields({ entity }: { entity: Entity }) {
  const specs = editableFields(entity);
  if (specs.length === 0) return null;
  return (
    <div className="geometry-fields">
      {specs.map((spec) => (
        <NumberField
          key={`${entity.id}:${spec.field}`}
          entityId={entity.id}
          spec={spec}
          shown={formatFieldValue(readField(entity, spec.field)!)}
        />
      ))}
    </div>
  );
}

function NumberField({ entityId, spec, shown }: { entityId: string; spec: FieldSpec; shown: string }) {
  const [text, setText] = useState(shown);
  const [error, setError] = useState<string | null>(null);
  // Follow the drawing when the value changes underneath, such as after undo or a drag. Done during render
  // so the input keeps focus, which a changing `key` would not.
  const [seen, setSeen] = useState(shown);
  if (seen !== shown) {
    setSeen(shown);
    setText(shown);
    setError(null);
  }

  const inputId = `geometry-${entityId}-${spec.field}`;
  const errorId = `${inputId}-error`;

  /** Commits only a changed value. Leaving a field untouched must not rewrite the geometry. */
  const commit = () => {
    if (text === shown) {
      setError(null);
      return;
    }
    const parsed = parseFieldNumber(text);
    if (!parsed.ok) {
      setError(parsed.reason);
      return;
    }
    if (parsed.value === Number(shown)) {
      setText(shown);
      setError(null);
      return;
    }
    setError(session.editGeometry(entityId, spec.field, parsed.value));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      // Revert this field only. The app-wide Escape would also clear the selection.
      e.stopPropagation();
      setText(shown);
      setError(null);
    }
  };

  return (
    <div className="field">
      <label htmlFor={inputId}>{spec.label}</label>
      <div className="row">
        <input
          id={inputId}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={text}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
        />
        {spec.unit && <span className="muted">{spec.unit}</span>}
      </div>
      {error && (
        <span id={errorId} role="alert" className="field-error">
          {error}
        </span>
      )}
    </div>
  );
}
