import { TOOL_INFO } from '../core/tools/factory';
import { session, useSessionVersion } from '../state/session';

/** Vertical tool palette. The active tool is highlighted. Shortcuts are shown on hover. */
export function Toolbar() {
  useSessionVersion();
  const active = session.toolId;
  return (
    <nav className="toolbar" aria-label="Drawing tools">
      {TOOL_INFO.map((tool) => (
        <button
          key={tool.id}
          type="button"
          className={tool.id === active ? 'tool active' : 'tool'}
          aria-pressed={tool.id === active}
          onClick={() => session.setTool(tool.id)}
          title={`${tool.label}${tool.shortcut ? ` (${tool.shortcut})` : ''}`}
        >
          <span className="tool-alias">{tool.alias}</span>
          <span className="tool-label">{tool.label}</span>
        </button>
      ))}
    </nav>
  );
}
