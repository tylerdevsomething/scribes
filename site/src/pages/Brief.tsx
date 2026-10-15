import { useMemo, useState, type ReactNode } from 'react';
import { BRAIN_TEMPLATE, DEFAULT_BRIEF, personalityTemplate, writeBrief, type BriefOptions } from '../brief.ts';
import { ToolPicker } from '../ToolPicker.tsx';

const PACKAGERS: { id: BriefOptions['packager']; title: string; hint: string }[] = [
  { id: 'coding', title: 'A coding agent', hint: 'Claude Code, Cursor… — it writes the files itself' },
  { id: 'chat', title: 'A chat assistant', hint: 'Claude, ChatGPT… — it replies with the files' },
  { id: 'framework', title: 'An agent framework', hint: 'ElizaOS, LangChain, custom — export a character' },
  { id: 'self', title: 'Me', hint: 'I will fill it in myself' },
];
const BRAINS: { id: BriefOptions['brain']; title: string; hint: string }[] = [
  { id: 'either', title: 'Let it choose', hint: 'Both options in the brief' },
  { id: 'open', title: 'An open model', hint: 'Inscribed .gguf — fully on-chain' },
  { id: 'claude', title: 'Claude', hint: 'Bound brain — smartest, uses tools' },
];
const EXAMPLES = [
  { file: 'mott.json', name: 'Mott', what: 'A gruff lighthouse keeper' },
  { file: 'wren.json', name: 'Wren', what: 'A storyteller, with a tool and a memory' },
  { file: 'sable.json', name: 'Sable', what: 'A precise Solana explainer' },
];

function download(name: string, text: string, type = 'text/markdown') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function BriefPage() {
  const [o, setO] = useState<BriefOptions>(DEFAULT_BRIEF);
  const [copied, setCopied] = useState(false);
  const text = useMemo(() => writeBrief(o), [o]);
  const set = <K extends keyof BriefOptions>(k: K, v: BriefOptions[K]) => setO({ ...o, [k]: v });
  const copy = () => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });

  return (
    <div style={{ padding: '40px 0 72px' }}>
      <div className="eyebrow">For your agent</div>
      <h1>The scribe brief</h1>
      <p className="muted" style={{ fontSize: 17, maxWidth: 720 }}>Tell us who is packaging the scribe and what its brain should be. The brief below rewrites itself — copy it, or download it, and hand it to your agent.</p>

      <div className="brief-layout">
        <div className="brief-options">
          <div className="opt">
            <div className="opt-title">Who is packaging it?</div>
            <div className="cards2">
              {PACKAGERS.map((p) => (
                <button key={p.id} className={`pick ${o.packager === p.id ? 'on' : ''}`} onClick={() => set('packager', p.id)}>
                  <b>{p.title}</b><small>{p.hint}</small>
                </button>
              ))}
            </div>
          </div>

          <div className="opt">
            <div className="opt-title">Its brain</div>
            <div className="cards2 three">
              {BRAINS.map((b) => (
                <button key={b.id} className={`pick ${o.brain === b.id ? 'on' : ''}`} onClick={() => set('brain', b.id)}>
                  <b>{b.title}</b><small>{b.hint}</small>
                </button>
              ))}
            </div>
          </div>

          <div className="opt">
            <div className="opt-title">Suggest tools <span className="muted">· they run when the brain is Claude</span></div>
            <ToolPicker value={o.tools} onChange={(v) => set('tools', v)} />
          </div>

          <div className="opt">
            <div className="opt-title">Include</div>
            <div className="toggles">
              <label className={o.memory ? 'on' : ''}><input type="checkbox" checked={o.memory} onChange={(e) => set('memory', e.target.checked)} />Memories</label>
              <label className={o.picture ? 'on' : ''}><input type="checkbox" checked={o.picture} onChange={(e) => set('picture', e.target.checked)} />A picture</label>
            </div>
          </div>

          <div className="opt">
            <div className="opt-title">Starter files</div>
            <div className="row">
              <button className="small" onClick={() => download('personality.json', personalityTemplate(o), 'application/json')}>personality.json template</button>
              <button className="small" onClick={() => download('brain.json', BRAIN_TEMPLATE, 'application/json')}>brain.json (Claude)</button>
            </div>
          </div>

          <div className="opt">
            <div className="opt-title">Examples</div>
            <ul className="examples">
              {EXAMPLES.map((e) => (
                <li key={e.file}><a href={`/examples/${e.file}`} download={e.file}>{e.name}</a><span className="muted"> — {e.what}</span></li>
              ))}
            </ul>
          </div>

          <div className="notice info">Rather not involve an agent? <a href="#/create">Write a scribe right on the site</a> — it takes a minute.</div>
        </div>

        <div className="brief-output">
          <div className="brief-bar">
            <div className="seg">
              <button className={o.format === 'full' ? 'on' : ''} onClick={() => set('format', 'full')}>Full brief</button>
              <button className={o.format === 'short' ? 'on' : ''} onClick={() => set('format', 'short')}>One-paragraph prompt</button>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <button className="small primary" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
              <button className="small" onClick={() => download(o.format === 'short' ? 'scribe-prompt.txt' : 'scribe-brief.md', text, o.format === 'short' ? 'text/plain' : 'text/markdown')}>Download</button>
            </div>
          </div>
          <div className="doc">{o.format === 'short' ? <p>{text}</p> : markdown(text.replace(/^# .*\n+/, ''))}</div>
        </div>
      </div>
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
    if (l.trimStart().startsWith('```')) {
      const indent = l.length - l.trimStart().length; // a fence inside a list item is indented
      const code: string[] = [];
      while (++i < lines.length && !lines[i].trimStart().startsWith('```')) code.push(lines[i].slice(Math.min(indent, lines[i].length - lines[i].trimStart().length)));
      out.push(<pre key={i}><code>{code.join('\n')}</code></pre>);
    } else if (l.startsWith('## ')) out.push(<h2 key={i}>{inline(l.slice(3))}</h2>);
    else if (l.startsWith('### ')) out.push(<h3 key={i}>{inline(l.slice(4))}</h3>);
    else if (l.startsWith('- ')) {
      out.push(<ul key={i}><li>{inline(l.slice(2))}</li></ul>);
    } else if (l.trim()) {
      const para = [l];
      while (i + 1 < lines.length && lines[i + 1].trim() && !/^(#|- |\s*```)/.test(lines[i + 1])) para.push(lines[++i]);
      out.push(<p key={i}>{inline(para.join(' ').trim())}</p>);
    }
  }
  return out;
}
