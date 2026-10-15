// Choosing a scribe's tools from the official catalog, grouped.
import { GROUP_LABELS, TOOL_CATALOG, type ToolGroup } from '../../lib/src/tools.ts';

const GROUPS: ToolGroup[] = ['think', 'solana', 'scribes', 'propose'];

export function ToolPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const toggle = (t: string, on: boolean) => onChange(on ? [...value, t] : value.filter((x) => x !== t));
  return (
    <div className="toolpicker">
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
