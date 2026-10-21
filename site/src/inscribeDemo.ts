// Development only (never in a build): #/create?demo plays the inscribe window through a whole inscription of pip
// with made up timing and no wallet, and #/create?demo=gold does it with verification. Nothing is sent anywhere.
import type { CheckReport, ScribeView, UploadPhase } from './api.ts';
import type { Drive } from './InscribeWindow.tsx';

export const DEMO_WALLET = '7Qd2FvKpN8sXbT3mWz9RcJ4hYeLuA6oGiV1nPq5tDkSx';
const SCRIBE = '6hcKGM83CBk7K2iwDTsRmHGoU4LQ5EY6wFuyfEocgXvt';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const demoReport: CheckReport = {
  ok: true, problems: [], name: 'pip', brain: null, files: [], attributes: null, model: null, link: null, scribe: SCRIBE,
  quote: { chunks: 10713, inscriptionLamports: 0, recordRentLamports: 0, birthFeeLamports: 0, modelRecordRentLamports: 0, royaltyLamports: 10_000_000, networkFeeLamports: 0, totalLamports: 12_500_000 } as CheckReport['quote'],
};

export function demoDrive(setPhase: (p: UploadPhase) => void): Drive {
  return {
    async sign() {
      await wait(900);
      const total = 10713, t0 = Date.now(), ms = 5200;
      const step = () => {
        const k = Math.min(1, (Date.now() - t0) / ms);
        if (k < 1) { setPhase({ phase: 'inscribing', report: demoReport, done: Math.round(total * k), total }); setTimeout(step, 60); }
        else setPhase({ phase: 'done', report: demoReport, signature: '5Xni4hRrDemoBirthBlockSignature1111111111111111111111111111xDFz' });
      };
      step();
      return { phase: 'inscribing', report: demoReport, done: 0, total };
    },
    async scribe() { await wait(300); return { address: SCRIBE, birthNumber: 1 } as ScribeView; },
    async checks() { await wait(1400); return { ok: true, checks: [], reply: null, pass: { verifier: '', message: '', signature: '' } }; },
    async burn() { await wait(1500); return 'demo-burn'; },
    async balance() { return 10n ** 12n; },
  };
}
