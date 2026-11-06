import { GeneralEncrypt, generalDecrypt, importJWK, type GeneralJWE, type JWK } from 'jose';
import { ALG, ENC, toPublic } from './keys.js';
import { profile, split, type Profile } from './profile.js';

/** The `typ` of an envelope and the version of its contents. */
export const TYP = 'shinten';
export const VERSION = 1;

/** Fields of a form that were sealed, as stored and transmitted. */
export interface Envelope extends GeneralJWE {}

/** What the browser hands the server: the clear fields as ordinary form values, and the envelope. */
export interface Sealed {
  clear: { [field: string]: string };
  envelope: Envelope;
}

/** What the recipient gets back. */
export interface Opened {
  profile: string;
  /** Every field, clear and sealed, as the user typed it. */
  fields: { [field: string]: string };
  /** The recipient key that opened it. */
  kid: string;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function fromBase64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function sameBytes(a: Uint8Array | undefined, b: Uint8Array): boolean {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number);
  return diff === 0;
}

/** The clear fields, encoded so that both sides derive the same bytes to bind to the envelope. */
export function bindClear(clear: { [field: string]: string }): Uint8Array {
  const sorted = Object.keys(clear)
    .sort()
    .map((k) => [k, clear[k]]);
  return enc.encode(JSON.stringify(sorted));
}

/**
 * Seals a form's values for the recipients, under a profile. The sealed
 * fields go into a JWE with one recipient per key; the clear fields are
 * returned beside it and bound to the envelope as additional authenticated
 * data, so that a stored postal code cannot be swapped for another without
 * the envelope refusing to open.
 */
export async function seal(profileName: string, values: { [field: string]: string }, recipients: JWK[]): Promise<Sealed> {
  const p = profile(profileName);
  if (recipients.length === 0) throw new Error('at least one recipient is required');
  const { clear, sealed } = split(p, values);
  const e = new GeneralEncrypt(enc.encode(JSON.stringify(sealed)))
    .setProtectedHeader({ enc: ENC, typ: TYP, cty: 'application/json', shinten: { v: VERSION, profile: p.name, clear: Object.keys(clear).sort() } })
    .setAdditionalAuthenticatedData(bindClear(clear));
  for (const r of recipients) {
    const pub = toPublic(r);
    if (!pub.kid) throw new Error('every recipient key needs a kid');
    e.addRecipient(await importJWK(pub, ALG)).setUnprotectedHeader({ alg: ALG, kid: pub.kid });
  }
  return { clear, envelope: await e.encrypt() };
}

/** The recipients an envelope is sealed to, by kid. */
export function recipientsOf(envelope: Envelope): string[] {
  return envelope.recipients.map((r) => String((r.header as { kid?: string } | undefined)?.kid ?? ''));
}

/** The profile an envelope was sealed under, read without opening it. */
export function profileOf(envelope: Envelope): { profile: string; clear: string[]; version: number } {
  const header = JSON.parse(dec.decode(fromBase64url(envelope.protected ?? ''))) as { typ?: string; shinten?: { v: number; profile: string; clear: string[] } };
  if (header.typ !== TYP || !header.shinten) throw new Error('not a shinten envelope');
  return { profile: header.shinten.profile, clear: header.shinten.clear, version: header.shinten.v };
}

/**
 * Opens an envelope with a recipient's private key, checking that the
 * clear fields presented are the ones the envelope was sealed beside.
 */
export async function open(sealed: Sealed, privateJwk: JWK): Promise<Opened> {
  if (!privateJwk.kid) throw new Error('the private key needs a kid');
  const kids = recipientsOf(sealed.envelope);
  if (!kids.includes(privateJwk.kid)) throw new Error(`this envelope is not sealed to ${privateJwk.kid}; recipients: ${kids.join(', ')}`);
  const { plaintext, protectedHeader, additionalAuthenticatedData } = await generalDecrypt(sealed.envelope, await importJWK(privateJwk, ALG));
  const meta = (protectedHeader as { typ?: string; shinten?: { v: number; profile: string } }) ?? {};
  if (meta.typ !== TYP || !meta.shinten) throw new Error('not a shinten envelope');
  if (meta.shinten.v !== VERSION) throw new Error(`envelope version ${meta.shinten.v} is not supported`);
  if (!sameBytes(additionalAuthenticatedData, bindClear(sealed.clear))) {
    throw new Error('the clear fields presented are not the ones this envelope was sealed beside');
  }
  const fields = JSON.parse(dec.decode(plaintext)) as { [field: string]: string };
  return { profile: meta.shinten.profile, fields: { ...sealed.clear, ...fields }, kid: privateJwk.kid };
}

/** The profile definition, re-exported for callers that only import this module. */
export type { Profile };
