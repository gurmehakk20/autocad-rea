import { type FormEvent, type KeyboardEvent, useState } from 'react';
import { session, useSessionVersion } from '../../state/session';

/** Command input at the bottom. Accepts tool names, aliases, typed coordinates and numbers. */
export function CommandLine() {
  useSessionVersion();
  const [text, setText] = useState('');
  const recent = session.log.slice(-6);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    session.submitCommand(text);
    setText('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // Escape also reaches the app-wide handler, which cancels the tool. Discard unsent text here too.
    if (e.key === 'Escape') {
      setText('');
      session.endRecall();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const recalled = e.key === 'ArrowUp' ? session.recallPrevious(text) : session.recallNext();
      if (recalled !== null) {
        e.preventDefault();
        setText(recalled);
      }
    } else if (e.key === 'Tab' && !e.shiftKey) {
      // Tab only completes a command name. Anywhere else it must move focus on, or keyboard users get stuck here.
      const completed = session.completeInput(text);
      if (completed !== null) {
        e.preventDefault();
        setText(completed);
      }
    }
  };

  return (
    <section className="command" aria-label="Command line">
      <div className="command-history" aria-live="polite">
        {recent.map((line, i) => (
          <div key={`${i}-${line}`} className="command-line-entry">
            {line}
          </div>
        ))}
      </div>
      <form className="command-form" onSubmit={onSubmit}>
        <span className="command-prompt">{session.tool.prompt()}</span>
        <input
          aria-label="Command input"
          autoComplete="off"
          spellCheck={false}
          placeholder="Command, x,y  @dx,dy  @dist<angle  or number"
          value={text}
          onChange={(e) => {
            session.endRecall();
            setText(e.target.value);
          }}
          onKeyDown={onKeyDown}
        />
      </form>
    </section>
  );
}
