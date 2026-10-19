// What a birth record holds, shown twice side by side: on the left as an agent's birth certificate, on the
// right as the 199 bytes the Scribes program actually stores in the scribe's account, in the order
// programs/scribes lays them out. The manifest hash is red in both, so you can see one is the other.
// An example for the home page under the birth block paragraph, not a real scribe.

// the program that writes every birth record (declare_id in programs/scribes)
const PROGRAM = '6BRHHJARif6TZJKjuJr8k7vFTr9gUxp7C5KaGMZBRBRD';

// the example's picture, as if its owner had uploaded one: an armoured knight in the site's dots, plume and
// cross in red; b is a blue dot, r a red one
export const KNIGHT = [
  '..........rrrr..........', '.........rrrrrr.........', '........rrr..rrr........', '...........rr...........',
  '......bbbbbbbbbbbb......', '.....bbbbbbbbbbbbbb.....', '....bbbbbbbbbbbbbbbb....', '....bbbbbbbbbbbbbbbb....',
  '....bbbbbbbbbbbbbbbb....', '....b......bb......b....', '....b......bb......b....', '....bbbbbbbbbbbbbbbb....',
  '....bbbbbbbbbbbbbbbb....', '....bbbbbbbbbbb.b.bb....', '....bbbbbbbbbbbbbbbb....', '....bbbbbbbbbbb.b.bb....',
  '....bbbbbbbbbbbbbbbb....', '.....bbbbbbbbbbbbbb.....', '......bbbbbbbbbbbb......', '........bbbbbbbb........',
  '...bbbbbbbbbbbbbbbbbb...', '..bbbbbbbbbbbbbbbbbbbb..', '.bbbbbbbbbbrrbbbbbbbbbb.', 'bbbbbbbbbrrrrrrbbbbbbbbb',
  'bbbbbbbbbbbrrbbbbbbbbbbb', 'bbbbbbbbbbbrrbbbbbbbbbbb',
];

export function Knight() {
  return (
    <svg viewBox="-2 -1 28 28" role="img" aria-label="an armoured knight">
      {KNIGHT.flatMap((row, y) => [...row].map((d, x) => d === '.' ? null : <circle key={`${x}.${y}`} cx={x + .5} cy={y + .5} r={.36} fill={d === 'r' ? 'var(--green)' : 'var(--purple)'} />))}
    </svg>
  );
}

const EXAMPLE = {
  model: 'c3608933…a58627',
  head: [['name', 'sir byte'], ['model', 'smollm2 360m, 229.7 mb']],
  fields: [
    ['birth no.', '42'], ['born', '18/10/2026'],
    ['slot', '512,004,217'], ['record', '5WQA…UCGq', 'case'],
    ['writer', 'FoZF…vDyg', 'case'], ['owner', '2Ghd…jSAc', 'case'],
    ['manifest', '3fa1c09e…b72d4c', 'hot'], ['chunks', '248,783'],
  ],
};

// the same scribe as account data: the Scribe struct field by field, little endian, 199 bytes
const WRITER = 'dbf0ccdf0e2476dfaba894126d0c9ac35267e781c7fa31104c394d334ffe1a3f';
const ACCOUNT: [string, boolean?][] = [
  ['b48b258589fb9b98'], // anchor discriminator for Scribe
  ['12e157e6ca5569fddde0182d4f9d89ed6e5820fd3ab0dce240ac90b931f59291'], // owner
  ['3fa1c09ead77139e70e8b43a77db15f3a2e88c4c69e21742f95e5b35cdb72d4c', true], // manifest sha-256
  ['94030000'], // manifest size, 916
  [WRITER], // writer
  ['c3608933eb6e5763b87f769bda40c204dc158333668c7af214644fe39da58627'], // model sha-256
  ['2900000000000000'], // birth number, 41 (shown as 42)
  ['7990841e00000000'], // birth slot, 512,004,217
  ['0100'], // autograph, verified
  ['0000000000000000'], // verified slot
  ['fe'], // bump
  [WRITER], // model writer
];
const BYTES = ACCOUNT.flatMap(([hex, hot]) => hex.match(/../g)!.map((b) => [b, !!hot] as const));
const ROWS = Array.from({ length: Math.ceil(BYTES.length / 12) }, (_, i) => BYTES.slice(i * 12, i * 12 + 12));

export function BirthRecord() {
  const F = ({ k, v, x }: { k: string; v: string; x?: string }) => <div className={`cert-field${x ? ` ${x}` : ''}`}><span className="k">{k}</span><span className="v">{v}</span></div>;
  return (
    <div className="cert-pair">
      <div className="cert">
        <i className="cert-c" />
        <h3>birth record</h3>
        <div className="cert-who">
          <div className="cert-seal"><Knight /></div>
          <div>{EXAMPLE.head.map(([k, v]) => <F key={k} k={k} v={v} />)}</div>
        </div>
        <div className="cert-fields">{EXAMPLE.fields.map(([k, v, x]) => <F key={k} k={k} v={v} x={x} />)}</div>
        <div className="cert-foot">
          <div className="cert-sign"><div className="line">{`${PROGRAM.slice(0, 6)}…${PROGRAM.slice(-6)}`}</div><span className="k">scribes program</span></div>
          {/* the autograph is the model's mark: the sha-256 of the model it was first born on */}
          <div className="cert-stamp"><b>autograph</b><span>{EXAMPLE.model}</span></div>
        </div>
      </div>
      <i className="cert-link" aria-hidden="true" />
      <div className="cert cert-bytes">
        <i className="cert-c" />
        <h3>on chain</h3>
        <div className="cert-sub">scribe account, {BYTES.length} bytes</div>
        <div className="hex">
          {ROWS.map((row, i) => (
            <div key={i}><span className="off">{(i * 12).toString(16).padStart(3, '0')}</span>{row.map(([b, hot], j) => <span key={j} className={hot ? 'hot' : undefined}>{b}</span>)}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
