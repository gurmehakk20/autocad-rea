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
      {specs.map((spec) => {
        const actual = readField(entity, spec.field)!;
        return <NumberField key={`${entity.id}:${spec.field}`} entityId={entity.id} spec={spec} actual={actual} shown={formatFieldValue(actual)} />;
      })}
    </div>
  );
}

function NumberField({ entityId, spec, actual, shown }: { entityId: string; spec: FieldSpec; actual: number; shown: string }) {
  const [text, setText] = useState(shown);
  const [error, setError] = useState<string | null>(null);
  /** True once the user has typed in the field. Only then can leaving it change anything. */
  const [edited, setEdited] = useState(false);
  // Follow the drawing when the value changes underneath, such as after undo or a drag. Done during render
  // so the input keeps focus, which a changing `key` would not.
  const [seen, setSeen] = useState(shown);
  if (seen !== shown) {
    setSeen(shown);
    setText(shown);
    setError(null);
    setEdited(false);
  }

  const inputId = `geometry-${entityId}-${spec.field}`;
  const errorId = `${inputId}-error`;

  /**
   * Commits what the user typed. A field they only focused and left is not committed, because its text is a rounded
   * display and writing it back would change the geometry. A typed value is compared with the real value, not the
   * display, so typing 0 over a displayed 0 that is really 1e-13 still sets it to 0.
   */
  const commit = () => {
    if (!edited) {
      setError(null);
      return;
    }
    const parsed = parseFieldNumber(text);
    if (!parsed.ok) {
      setError(parsed.reason);
      return;
    }
    if (parsed.value === actual) {
      setText(shown);
      setEdited(false);
      setError(null);
      return;
    }
    const refusal = session.editGeometry(entityId, spec.field, parsed.value);
    setError(refusal);
    if (refusal === null) {
      setEdited(false);
      // Show what was stored. An angle such as 360 is stored as 0, and the field should say so.
      const stored = session.drawing.getEntity(entityId);
      const value = stored ? readField(stored, spec.field) : null;
      if (value !== null) setText(formatFieldValue(value));
    }
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
      setEdited(false);
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
          // React does not call onChange when the text is the same as before, such as typing 0 over a displayed 0 whose
          // real value is 1e-13. The native input event still fires, and it means the user typed.
          onInput={() => setEdited(true)}
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
