import { GeneralEncrypt, calculateJwkThumbprint, generalDecrypt, importJWK, type GeneralJWE, type JWK } from 'jose';
import { ALG, ENC, toPublic } from './keys.js';
import { profile, profiles, split, type Profile } from './profile.js';

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
  // The keys sealed to, by thumbprint, in the protected header: whoever opens
  // can check them against the keys they approved, so that a key list
  // replaced on the site is found at the first envelope sealed with it.
  const keys = (await Promise.all(recipients.map(thumbprint))).sort();
  const e = new GeneralEncrypt(enc.encode(JSON.stringify(sealed)))
    .setProtectedHeader({ enc: ENC, typ: TYP, cty: 'application/json', shinten: { v: VERSION, profile: p.name, clear: Object.keys(clear).sort(), keys } })
    .setAdditionalAuthenticatedData(bindClear(clear));
  for (const r of recipients) {
    const pub = toPublic(r);
    if (!pub.kid) throw new Error('every recipient key needs a kid');
    e.addRecipient(await importJWK(pub, ALG)).setUnprotectedHeader({ alg: ALG, kid: pub.kid });
  }
  return { clear, envelope: await e.encrypt() };
}

/** The RFC 7638 thumbprint of a key's public half: what an envelope names its recipients by. */
export function thumbprint(jwk: JWK): Promise<string> {
  return calculateJwkThumbprint(toPublic(jwk));
}

/** An envelope sealed to keys other than the ones approved: the published keys may have been replaced. */
export class RecipientError extends Error {
  constructor(
    message: string,
    /** Thumbprints sealed to that were not approved. */
    readonly extra: string[],
    /** Approved thumbprints the envelope was not sealed to. */
    readonly missing: string[],
  ) {
    super(message);
    this.name = 'RecipientError';
  }
}

export interface OpenOptions {
  /**
   * The recipients' public keys as the opening side approved them. The
   * envelope must be sealed to exactly these, or it is not opened: a key
   * list replaced on the site, adding a key or swapping one, shows here.
   */
  recipients?: JWK[];
}

/** The recipients an envelope is sealed to, by kid. */
export function recipientsOf(envelope: Envelope): string[] {
  return envelope.recipients.map((r) => String((r.header as { kid?: string } | undefined)?.kid ?? ''));
}

/** The profile an envelope was sealed under, read without opening it. */
export function profileOf(envelope: Envelope): { profile: string; clear: string[]; version: number; keys?: string[] } {
  const header = JSON.parse(dec.decode(fromBase64url(envelope.protected ?? ''))) as { typ?: string; shinten?: { v: number; profile: string; clear: string[]; keys?: string[] } };
  if (header.typ !== TYP || !header.shinten) throw new Error('not a shinten envelope');
  return { profile: header.shinten.profile, clear: header.shinten.clear, version: header.shinten.v, ...(header.shinten.keys ? { keys: header.shinten.keys } : {}) };
}

/**
 * Opens an envelope with a recipient's private key, checking that the
 * clear fields presented are the ones the envelope was sealed beside and,
 * with `opts.recipients`, that it was sealed to exactly the approved keys.
 */
export async function open(sealed: Sealed, privateJwk: JWK, opts: OpenOptions = {}): Promise<Opened> {
  if (!privateJwk.kid) throw new Error('the private key needs a kid');
  const kids = recipientsOf(sealed.envelope);
  if (!kids.includes(privateJwk.kid)) throw new Error(`this envelope is not sealed to ${privateJwk.kid}; recipients: ${kids.join(', ')}`);
  const { plaintext, protectedHeader, additionalAuthenticatedData } = await generalDecrypt(sealed.envelope, await importJWK(privateJwk, ALG));
  const meta = (protectedHeader as { typ?: string; shinten?: { v: number; profile: string; clear?: string[]; keys?: unknown } }) ?? {};
  if (meta.typ !== TYP || !meta.shinten) throw new Error('not a shinten envelope');
  if (meta.shinten.v !== VERSION) throw new Error(`envelope version ${meta.shinten.v} is not supported`);
  if (!sameBytes(additionalAuthenticatedData, bindClear(sealed.clear))) {
    throw new Error('the clear fields presented are not the ones this envelope was sealed beside');
  }
  await checkRecipients(sealed.envelope, meta.shinten.keys, privateJwk, opts.recipients);
  const declared = [...(meta.shinten.clear ?? [])].sort().join('\n');
  if (declared !== Object.keys(sealed.clear).sort().join('\n')) throw new Error('the clear fields presented are not the ones the envelope declares');
  const fields = sealedFields(dec.decode(plaintext));
  // A field is either clear or sealed, never both: otherwise the sealed value
  // would silently replace the clear one the site acted on (a postal code
  // charged for one zone, a label printed for another). An envelope can be
  // built by hand with the public key, so this is checked here, not trusted
  // to seal().
  const known = profiles[meta.shinten.profile];
  for (const k of Object.keys(fields)) {
    if (Object.hasOwn(sealed.clear, k)) throw new Error(`field ${k} is both in the clear and sealed; refusing to open`);
    if (known?.clear.includes(k)) throw new Error(`field ${k} is clear in the ${known.name} profile but was sealed; refusing to open`);
  }
  return { profile: meta.shinten.profile, fields: { ...sealed.clear, ...fields }, kid: privateJwk.kid };
}

/**
 * Checks the keys an envelope declares, from its authenticated header,
 * against its recipients, the key opening it and, if given, the approved
 * keys. Envelopes sealed before keys were declared open only without
 * approved keys.
 */
async function checkRecipients(envelope: Envelope, declared: unknown, privateJwk: JWK, approved: JWK[] | undefined): Promise<void> {
  if (declared !== undefined) {
    if (!Array.isArray(declared) || declared.some((k) => typeof k !== 'string') || declared.length !== envelope.recipients.length) {
      throw new Error("the envelope's recipients do not match the keys it declares");
    }
    if (!declared.includes(await thumbprint(privateJwk))) throw new Error('this key is not among the keys the envelope declares');
  }
  if (!approved) return;
  if (declared === undefined) {
    throw new RecipientError('the envelope does not say which keys it was sealed to (sealed by shinten before 0.2, or by hand); it cannot be checked against the approved keys', [], []);
  }
  const keys = declared as string[];
  const ok = new Set(await Promise.all(approved.map(thumbprint)));
  const extra = keys.filter((k) => !ok.has(k));
  const missing = [...ok].filter((k) => !keys.includes(k));
  if (extra.length || missing.length) {
    const parts = [extra.length ? `sealed to keys you did not approve: ${extra.join(', ')}` : '', missing.length ? `not sealed to approved keys: ${missing.join(', ')}` : ''];
    throw new RecipientError(`${parts.filter(Boolean).join('; ')}. The keys published for the form may have been replaced; stop and check them.`, extra, missing);
  }
}

/** The sealed fields: a JSON object of strings, and nothing else. */
function sealedFields(json: string): { [field: string]: string } {
  const v = JSON.parse(json) as unknown;
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('the sealed contents are not an object of fields');
  for (const [k, x] of Object.entries(v)) {
    if (typeof x !== 'string') throw new Error(`sealed field ${k} is not a string`);
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') throw new Error(`sealed field name ${k} is not allowed`);
  }
  return v as { [field: string]: string };
}

/** The profile definition, re-exported for callers that only import this module. */
export type { Profile };
