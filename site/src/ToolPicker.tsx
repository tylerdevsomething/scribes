// Choosing a scribe's tools from the official catalog: one-click presets, then the tools grouped.
import { ACTIVE_TOOLS as TOOL_CATALOG, PRESETS, type ToolGroup } from '../../lib/src/tools.ts';

const GROUPS: ToolGroup[] = ['market', 'wallet', 'propose', 'scribes', 'think'];
// each group's name and, in brackets, what it is, worded like the details fields
const NAMES: Record<ToolGroup, [string, string]> = {
  market: ['market', 'tokens, prices and trades'], wallet: ['wallets', 'what a wallet holds and has done'],
  propose: ['actions', 'drafts a visitor approves in their own wallet'], scribes: ['scribes', 'other scribes and their market'],
  think: ['thinking & the web', 'sums, the date and the web'],
};


// only: offer just these tools (and the presets cut down to them)
export function ToolPicker({ value, onChange, only }: { value: string[]; onChange: (v: string[]) => void; only?: string[] }) {
  // the library tool is not picked: it comes with a library file (create: the library step)
  const catalog = (only ? TOOL_CATALOG.filter((t) => only.includes(t.name)) : TOOL_CATALOG).filter((t) => t.name !== 'library');
  const presets = only ? PRESETS.map((p) => ({ ...p, tools: p.tools.filter((t) => only.includes(t)) })).filter((p) => p.tools.length >= 3) : PRESETS;
  const toggle = (t: string, on: boolean) => onChange(on ? [...value, t] : value.filter((x) => x !== t));
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
  return (
    <div className="toolpicker">
      <div className="tgroup-head"><span>presets <em>(a ready set of tools for one kind of agent)</em></span></div>
      <div className="presets">
        {presets.map((p) => (
          <button type="button" key={p.name} className={`preset ${same(value, p.tools) ? 'on' : ''}`} title={p.hint} onClick={() => onChange(same(value, p.tools) ? [] : [...p.tools])}>
            <b>{p.name}</b><small>{p.hint}</small>
          </button>
        ))}
      </div>
      {GROUPS.map((g) => {
        const tools = catalog.filter((t) => t.group === g);
        if (!tools.length) return null;
        const all = tools.every((t) => value.includes(t.name));
        return (
          <div key={g} className="tgroup">
            {/* each group: its name, a plain select all / clear, then every tool as a framed box like the cards above */}
            <div className="tgroup-head">
              <span>{NAMES[g][0]} <em>({NAMES[g][1]})</em></span>
              <button type="button" className="tgroup-all" onClick={() => onChange(all ? value.filter((v) => !tools.some((t) => t.name === v)) : [...new Set([...value, ...tools.map((t) => t.name)])])}>{all ? 'clear' : 'select all'}</button>
            </div>
            <div className="tool-cards">
              {tools.map((t) => {
                const on = value.includes(t.name);
                return (
                  <button type="button" key={t.name} role="checkbox" aria-checked={on} className={`tool-card${on ? ' on' : ''}`} onClick={() => toggle(t.name, !on)}>
                    {on && <i className="corner-tick" aria-hidden="true" />}<b>{t.label}</b><span>{t.summary.replace(/;/g, ',')}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
