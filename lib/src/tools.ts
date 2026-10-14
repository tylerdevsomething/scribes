// The official scribe tools, the parts shared by the site and tests (no browser or chain access here).

export const OFFICIAL_TOOLS = ['calculator', 'read_wallet', 'web_search', 'propose_transfer'] as const;

// Personality tool names are free text: match them loosely to the official set.
export function enabledTools(declared: string[] | undefined): string[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
  const want = new Set((declared ?? []).map(norm));
  return OFFICIAL_TOOLS.filter((t) => want.has(norm(t)) || (t === 'web_search' && want.has('search')) || (t === 'read_wallet' && want.has('wallet')));
}

// Arithmetic only: a tiny parser, never eval.
export function calculate(expr: string): number {
  const tokens = expr.replace(/\s+/g, '').match(/\d+(?:\.\d+)?|[-+*/^()]/g);
  if (!tokens || tokens.join('') !== expr.replace(/\s+/g, '')) throw new Error('only numbers and + - * / ^ ( ) are allowed');
  let i = 0;
  const peek = () => tokens[i];
  const prim = (): number => {
    const t = tokens[i++];
    if (t === '(') { const v = sum(); if (tokens[i++] !== ')') throw new Error('missing )'); return v; }
    if (t === '-') return -prim();
    const v = Number(t);
    if (!Number.isFinite(v)) throw new Error('bad number');
    return v;
  };
  const pow = (): number => { const b = prim(); if (peek() === '^') { i++; return b ** pow(); } return b; };
  const prod = (): number => { let v = pow(); while (peek() === '*' || peek() === '/') v = tokens[i++] === '*' ? v * pow() : v / pow(); return v; };
  const sum = (): number => { let v = prod(); while (peek() === '+' || peek() === '-') v = tokens[i++] === '+' ? v + prod() : v - prod(); return v; };
  const v = sum();
  if (i !== tokens.length) throw new Error('unexpected input');
  return v;
}

