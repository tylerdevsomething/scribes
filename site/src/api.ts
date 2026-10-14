// The indexer API. Types mirror indexer/src/indexer.ts and indexer/src/uploads.ts.
import type { ScribeView } from '../../indexer/src/indexer.ts';
import type { CheckReport } from '../../indexer/src/uploads.ts';
import { API } from './config.ts';

export type { ScribeView, CheckReport };

async function call<T>(method: string, path: string, body?: unknown, raw?: Blob): Promise<T> {
  const res = await fetch(API + path, {
    method,
    headers: raw ? { 'content-type': 'application/octet-stream' } : body === undefined ? undefined : { 'content-type': 'application/json' },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const j = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
  return j as T;
}

export const getScribes = () => call<ScribeView[]>('GET', '/scribes');
export const getScribe = (address: string) => call<ScribeView>('GET', `/scribe/${address}`);
export const fileUrl = (sha: string) => `${API}/files/${sha}`;

export type UploadPhase =
  | { phase: 'uploading' }
  | { phase: 'checked'; report: CheckReport }
  | { phase: 'awaiting-signature'; report: CheckReport }
  | { phase: 'inscribing'; report: CheckReport; done: number; total: number }
  | { phase: 'done'; report: CheckReport; signature: string }
  | { phase: 'failed'; error: string };

export const newUpload = () => call<{ id: string }>('POST', '/uploads');
export const putPart = (id: string, part: string, name: string, file: Blob) => call('PUT', `/uploads/${id}/${part}/${encodeURIComponent(name)}`, undefined, file);
export const checkUpload = (id: string) => call<CheckReport>('POST', `/uploads/${id}/check`);
export const checkout = (id: string, owner: string) => call<{ tx: string; scribe: string }>('POST', `/uploads/${id}/checkout`, { owner });
export const submitted = (id: string, signature: string) => call<UploadPhase>('POST', `/uploads/${id}/submitted`, { signature });
export const uploadStatus = (id: string) => call<UploadPhase>('GET', `/uploads/${id}`);
