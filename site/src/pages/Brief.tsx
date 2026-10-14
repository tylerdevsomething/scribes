import { useEffect, useState, type ReactNode } from 'react';

// Shows the scribe brief (public/scribe-brief.md) and offers it as a download.
export function BriefPage() {
  const [text, setText] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => { fetch('/scribe-brief.md').then((r) => r.text()).then(setText).catch(() => setText('')); }, []);
  const copy = () => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  return (
    <div className="prose">
      <div className="eyebrow">For your agent</div>
      <h1>The scribe brief</h1>
      <p className="muted" style={{ fontSize: 17 }}>Give this file to your agent. It explains how to package itself — personality, brain and picture — into a folder you can inscribe.</p>
      <div className="row" style={{ marginTop: 18 }}>
        <a className="btn primary" href="/scribe-brief.md" download="scribe-brief.md">Download scribe-brief.md</a>
        <button onClick={copy}>{copied ? 'Copied' : 'Copy to clipboard'}</button>
      </div>
      <div className="doc">{markdown(text.replace(/^# .*\n+/, ''))}</div>
    </div>
  );
}

// Enough Markdown for the brief: headings, paragraphs, lists, code blocks, inline code and bold.
function inline(s: string): ReactNode[] {
  return s.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean).map((p, i) =>
    p.startsWith('`') ? <code key={i}>{p.slice(1, -1)}</code>
      : p.startsWith('**') ? <b key={i}>{p.slice(2, -2)}</b>
        : p);
}

function markdown(md: string): ReactNode[] {
  const out: ReactNode[] = [];
  const lines = md.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith('```')) {
      const code: string[] = [];
      while (++i < lines.length && !lines[i].startsWith('```')) code.push(lines[i]);
      out.push(<pre key={i}><code>{code.join('\n')}</code></pre>);
    } else if (l.startsWith('## ')) out.push(<h2 key={i}>{inline(l.slice(3))}</h2>);
    else if (l.startsWith('### ')) out.push(<h3 key={i}>{inline(l.slice(4))}</h3>);
    else if (l.startsWith('- ')) {
      const items: string[] = [];
      for (; i < lines.length && (lines[i].startsWith('- ') || lines[i].startsWith('  ')); i++) {
        if (lines[i].startsWith('- ')) items.push(lines[i].slice(2)); else items[items.length - 1] += ' ' + lines[i].trim();
      }
      i--;
      out.push(<ul key={i}>{items.map((t, k) => <li key={k}>{inline(t)}</li>)}</ul>);
    } else if (l.trim()) {
      const para = [l];
      while (i + 1 < lines.length && lines[i + 1].trim() && !/^(#|- |```)/.test(lines[i + 1])) para.push(lines[++i]);
      out.push(<p key={i}>{inline(para.join(' '))}</p>);
    }
  }
  return out;
}
