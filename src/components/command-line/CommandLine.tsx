import { type FormEvent, useState } from 'react';
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
          onChange={(e) => setText(e.target.value)}
        />
      </form>
    </section>
  );
}
