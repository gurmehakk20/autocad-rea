import type { ReportContent } from '../../app/actions';

interface Props {
  readonly content: ReportContent;
  readonly onClose: () => void;
}

/** Lists warnings from import or export so no data loss happens silently. */
export function ReportDialog({ content, onClose }: Props) {
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="report-title">{content.title}</h2>
        <p className="muted">
          {content.lines.length} item{content.lines.length === 1 ? '' : 's'} need your attention. Unsupported data was not imported or was changed as described.
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
