import { useEffect, useRef } from 'react';
import type { ReportContent } from '../../app/actions';

interface Props {
  readonly content: ReportContent;
  readonly onClose: () => void;
}

/** Lists warnings or errors from import, open or export so nothing is lost silently. */
export function ReportDialog({ content, onClose }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Return focus to whatever had it before the dialog opened.
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      // Keep Tab inside the dialog: a modal must not let focus reach the page behind it.
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (!dialogRef.current?.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      previous?.focus();
    };
  }, [onClose]);

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="report-title">{content.title}</h2>
        <p className="muted">
          {content.intro ??
            `${content.lines.length} item${content.lines.length === 1 ? '' : 's'} need your attention. Unsupported data was not imported or was changed as described.`}
        </p>
        <ul className="report-list">
          {content.lines.map((line, i) => (
            <li key={`${i}-${line}`}>{line}</li>
          ))}
        </ul>
        <div className="dialog-actions">
          <button type="button" onClick={onClose} autoFocus>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
