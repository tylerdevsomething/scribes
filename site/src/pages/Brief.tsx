// The scribe brief: instructions for an AI agent someone already has. The agent reads it, writes its own
// personality.json and packs a folder, which is dropped in on Inscribe (packaged folder). The brief is the
// same one Inscribe downloads, so the two never disagree.
import { useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_BRIEF, writeBrief } from '../brief.ts';
import { Folio } from '../Hero.tsx';

function download(name: string, text: string, type = 'text/markdown') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function BriefPage() {
  const [copied, setCopied] = useState(false);
  // an open model only: the inscribe form no longer offers claude
  const text = useMemo(() => writeBrief({ ...DEFAULT_BRIEF, brain: 'open' }), []);
  const copy = () => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); });

  return (
    <Folio className="folio-hero stage">
      <div className="scene scene-models scene-brief">
        <div className="models-paras brief-head">
          <h1 className="hero-title">the scribe brief</h1>
          <p>The scribe brief is a set of instructions for an AI agent you already have. Your agent reads it, writes its own personality.json and packs a folder you can inscribe.</p>
        </div>

        {/* three steps, each a framed block with the one thing to do in it */}
        <div className="brief-steps">
          <div className="brief-step"><i className="c2" />
            <h3 className="sec-head"><i>1</i>get the brief</h3>
            <div className="brief-step-go">
              <button type="button" className="show-all on" onClick={() => download('scribe-brief.md', text)}>download brief</button>
              <button type="button" className={`show-all${copied ? ' on' : ''}`} onClick={copy}>{copied && <i className="corner-tick" aria-hidden="true" />}{copied ? 'copied' : 'copy brief'}</button>
            </div>
          </div>
          <i className="stat-link red" />
          <div className="brief-step red"><i className="c2" />
            <h3 className="sec-head"><i>2</i>give it to your agent</h3>
            <p>paste it into a chat, or drop the file into any ai agent. it writes the files for you.</p>
          </div>
          <i className="stat-link" />
          <div className="brief-step"><i className="c2" />
            <h3 className="sec-head"><i>3</i>inscribe the folder</h3>
            <p>choose packaged folder and drop in what your agent made.</p>
            <div className="brief-step-go">
              <a className="show-all on" href="#/create">go to inscribe</a>
            </div>
          </div>
        </div>

        <h3 className="sec-head brief-read">read the brief<em>(the same for every agent, nothing to fill in)</em></h3>
        <div className="brief-doc"><i className="c2" />{markdown(text.replace(/^# .*\n+/, ''))}</div>
      </div>
    </Folio>
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
    } else if (l.startsWith('## ')) {
      const m = l.slice(3).match(/^(?:(\d+)\.\s+)?(.*?)(?:\s+\(([^)]+)\))?$/)!;
      out.push(<h3 key={i} className="sec-head">{m[1] && <i>{m[1]}</i>}<span>{inline(m[2])}</span>{m[3] && <em>({m[3]})</em>}</h3>);
    }
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
