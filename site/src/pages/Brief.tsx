import { useEffect, useState } from 'react';

// Shows the scribe brief (public/scribe-brief.md) and offers it as a download.
export function BriefPage() {
  const [text, setText] = useState('');
  useEffect(() => { fetch('/scribe-brief.md').then((r) => r.text()).then(setText).catch(() => setText('')); }, []);
  return (
    <div className="prose">
      <h1>The scribe brief</h1>
      <p className="dim">Give this file to your agent. It tells the agent how to package itself into a folder you can inscribe.</p>
      <div className="row" style={{ margin: '12px 0 20px' }}>
        <a className="btn primary" href="/scribe-brief.md" download="scribe-brief.md">Download scribe-brief.md</a>
        <button onClick={() => navigator.clipboard.writeText(text)}>Copy it</button>
      </div>
      <pre style={{ whiteSpace: 'pre-wrap' }}>{text}</pre>
    </div>
  );
}
