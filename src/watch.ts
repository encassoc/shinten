// Watching the keys a site publishes for its forms. A site that is broken
// into, or an insider, can replace the key list so that forms seal to a key
// they hold. The opening side compares what the site serves with the keys it
// approved, regularly and from outside the site.
import type { JWK } from 'jose';
import { thumbprint } from './envelope.js';
import { toPublic } from './keys.js';

export interface KeyCheck {
  /** True when the site serves exactly the approved keys. */
  ok: boolean;
  /** Thumbprints the site serves that were not approved. */
  extra: string[];
  /** Approved thumbprints the site does not serve. */
  missing: string[];
}

/** Recipients from a JWK Set, a list, or a single key; private keys are reduced to their public half. */
export function recipientsFrom(json: string): JWK[] {
  const v = JSON.parse(json) as JWK | JWK[] | { keys: JWK[] };
  const list = Array.isArray(v) ? v : 'keys' in v && Array.isArray(v.keys) ? v.keys : [v as JWK];
  return list.map(toPublic);
}

/** Compares the keys a site serves with the approved ones. */
export async function compareKeys(served: JWK[], approved: JWK[]): Promise<KeyCheck> {
  const s = new Set(await Promise.all(served.map(thumbprint)));
  const a = new Set(await Promise.all(approved.map(thumbprint)));
  const extra = [...s].filter((k) => !a.has(k));
  const missing = [...a].filter((k) => !s.has(k));
  return { ok: extra.length === 0 && missing.length === 0, extra, missing };
}

/** Fetches the key list a site serves for its forms and compares it with the approved keys. */
export async function watchKeys(url: string, approved: JWK[], timeoutMs = 10_000): Promise<KeyCheck> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return compareKeys(recipientsFrom(await res.text()), approved);
}
