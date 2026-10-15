// A scribe's reply with light formatting: **bold**, `code`, [links](https://…), "- " bullets and "#"
// headings. Built as React elements (never as HTML), so a reply can't inject anything into the page.
import type { ReactNode } from 'react';

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let last = 0, i = 0;
  for (let m; (m = re.exec(text));) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}.${i++}`;
    if (m[1] !== undefined) out.push(<b key={k}>{m[1]}</b>);
    else if (m[2] !== undefined) out.push(<code key={k}>{m[2]}</code>);
    else out.push(<a key={k} href={m[4]} target="_blank" rel="noopener noreferrer">{m[3]}</a>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Rich({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: ReactNode[] = [];
  const flush = () => { if (list.length) { blocks.push(<ul key={`l${blocks.length}`}>{list}</ul>); list = []; } };
  text.split('\n').forEach((line, n) => {
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (bullet) { list.push(<li key={n}>{inline(bullet[1], `${n}`)}</li>); return; }
    flush();
    const head = /^#{1,4}\s+(.*)$/.exec(line);
    if (head) blocks.push(<div key={n} className="rich-head">{inline(head[1], `${n}`)}</div>);
    else if (line.trim()) blocks.push(<p key={n}>{inline(line, `${n}`)}</p>);
  });
  flush();
  return <div className="rich">{blocks}</div>;
}
