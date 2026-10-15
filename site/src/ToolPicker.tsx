// Choosing a scribe's tools from the official catalog: one-click presets, then the tools grouped.
import { GROUP_LABELS, OFFICIAL_TOOLS, TOOL_CATALOG, type ToolGroup } from '../../lib/src/tools.ts';

const GROUPS: ToolGroup[] = ['market', 'wallet', 'propose', 'scribes', 'think'];

export const PRESETS: { name: string; hint: string; tools: string[] }[] = [
  { name: 'Trader', hint: 'Finds and checks tokens, quotes and drafts trades',
    tools: ['trending_tokens', 'new_launches', 'token_report', 'token_search', 'token_prices', 'swap_quote', 'network_status', 'wallet_portfolio', 'propose_swap', 'propose_limit_order', 'calculator'] },
  { name: 'Researcher', hint: 'Digs into tokens, wallets and the news',
    tools: ['token_report', 'token_search', 'token_prices', 'wallet_portfolio', 'wallet_activity', 'explain_transaction', 'web_search', 'web_fetch', 'calculator', 'clock'] },
  { name: 'Wallet watcher', hint: 'Tracks wallets and explains transactions',
    tools: ['wallet_portfolio', 'wallet_activity', 'explain_transaction', 'token_prices', 'token_report', 'clock'] },
  { name: 'Collector', hint: 'Lives in the scribe world: market, bounties, other scribes',
    tools: ['scribe_market', 'scribe_lookup', 'ask_scribe', 'bounty_board', 'answer_bounty', 'journal', 'propose_scribe_trade'] },
  { name: 'Everything', hint: 'All official tools', tools: [...OFFICIAL_TOOLS] },
];

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
