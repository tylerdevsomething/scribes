// Choosing a scribe's tools from the official catalog: one-click presets, then the tools grouped.
import { ACTIVE_TOOLS as TOOL_CATALOG, GROUP_LABELS, PRESETS, type ToolGroup } from '../../lib/src/tools.ts';

const GROUPS: ToolGroup[] = ['market', 'wallet', 'propose', 'scribes', 'think'];


export function ToolPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const toggle = (t: string, on: boolean) => onChange(on ? [...value, t] : value.filter((x) => x !== t));
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
  return (
    <div className="toolpicker">
      <div className="presets">
        {PRESETS.map((p) => (
          <button type="button" key={p.name} className={`preset ${same(value, p.tools) ? 'on' : ''}`} title={p.hint} onClick={() => onChange(same(value, p.tools) ? [] : [...p.tools])}>
            <b>{p.name}</b><small>{p.hint}</small>
          </button>
        ))}
      </div>
      {GROUPS.map((g) => {
        const tools = TOOL_CATALOG.filter((t) => t.group === g);
        const all = tools.every((t) => value.includes(t.name));
        return (
          <div key={g} className="tgroup">
            <div className="tgroup-head">
              <span>{GROUP_LABELS[g]}</span>
              <button type="button" className="link" onClick={() => onChange(all ? value.filter((v) => !tools.some((t) => t.name === v)) : [...new Set([...value, ...tools.map((t) => t.name)])])}>{all ? 'none' : 'all'}</button>
            </div>
            <div className="toggles">
              {tools.map((t) => (
                <label key={t.name} className={value.includes(t.name) ? 'on' : ''} title={t.summary}>
                  <input type="checkbox" checked={value.includes(t.name)} onChange={(e) => toggle(t.name, e.target.checked)} />{t.label}
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
