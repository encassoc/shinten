// The browser side: seal a form before it leaves the page.
//
//   <form method="post" action="/order"
//         data-shinten-profile="shipping"
//         data-shinten-keys="/.well-known/shinten.json">
//
// On submit, every field the profile does not list as clear is sealed to
// the recipients' public keys, the sealed inputs are left out of the
// submission, and a hidden `shinten` field carries the envelope. The server
// stores the clear fields and the envelope; it never sees the rest.
//
// The keys document is a JWK Set ({"keys": [...]}) of the recipients'
// public keys, served by the site. `data-shinten-keys` may also hold the
// JWK Set inline as JSON.
import type { JWK } from 'jose';
import { seal, type Sealed } from './envelope.js';

export { seal } from './envelope.js';
export { profiles } from './profile.js';

/** The name of the hidden input that carries the envelope. */
export const FIELD = 'shinten';

export interface SealFormOptions {
  profile: string;
  recipients: JWK[];
  /** Name of the hidden input for the envelope; `shinten` by default. */
  field?: string;
}

/** Reads a form's named inputs as strings, the way the server would receive them. */
export function valuesOf(form: HTMLFormElement): { [field: string]: string } {
  const out: { [field: string]: string } = {};
  for (const [k, v] of new FormData(form).entries()) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

/**
 * Seals a form in place: sealed inputs are disabled so that they are not
 * submitted, and the envelope is added as a hidden input. Returns what
 * was sealed. Call it from a submit handler, then submit the form.
 */
export async function sealForm(form: HTMLFormElement, opts: SealFormOptions): Promise<Sealed> {
  const sealed = await seal(opts.profile, valuesOf(form), opts.recipients);
  const clear = new Set(Object.keys(sealed.clear));
  for (const el of Array.from(form.elements)) {
    const input = el as HTMLInputElement;
    if (input.name && input.name !== (opts.field ?? FIELD) && !clear.has(input.name)) input.disabled = true;
  }
  let hidden = form.querySelector<HTMLInputElement>(`input[name="${opts.field ?? FIELD}"]`);
  if (!hidden) {
    hidden = document.createElement('input');
    hidden.type = 'hidden';
    hidden.name = opts.field ?? FIELD;
    form.appendChild(hidden);
  }
  hidden.value = JSON.stringify(sealed.envelope);
  return sealed;
}

/** Loads the recipients from a `data-shinten-keys` value: a URL to a JWK Set, or the set inline. */
export async function loadRecipients(keys: string): Promise<JWK[]> {
  const text = keys.trim().startsWith('{') ? keys : await (await fetch(keys, { credentials: 'same-origin' })).text();
  const set = JSON.parse(text) as { keys?: JWK[] };
  if (!Array.isArray(set.keys) || set.keys.length === 0) throw new Error('the keys document holds no recipients');
  return set.keys;
}

/** Wires every form on the page that carries `data-shinten-profile`. */
export function autoSeal(root: ParentNode = document): void {
  for (const form of Array.from(root.querySelectorAll<HTMLFormElement>('form[data-shinten-profile]'))) {
    let sealedOnce = false;
    form.addEventListener('submit', (ev) => {
      if (sealedOnce) return;
      ev.preventDefault();
      const profile = form.dataset.shintenProfile ?? '';
      const keys = form.dataset.shintenKeys ?? '';
      loadRecipients(keys)
        .then((recipients) => sealForm(form, { profile, recipients }))
        .then(() => {
          sealedOnce = true;
          form.requestSubmit();
        })
        .catch((e: Error) => {
          form.dispatchEvent(new CustomEvent('shinten:error', { detail: e }));
          console.error('shinten:', e.message);
        });
    });
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => autoSeal());
  else autoSeal();
}
