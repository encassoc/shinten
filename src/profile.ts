/**
 * A profile says which fields of a form may stay in the clear. Everything
 * else is sealed: a field the profile does not know is sealed, never
 * leaked. The clear fields are the ones the site needs to do its work
 * before the envelope is opened, and nothing more.
 */
export interface Profile {
  name: string;
  description: string;
  /** Fields that stay readable on the server. */
  clear: string[];
  /** Sealed fields that must be present. */
  required: string[];
}

export const profiles: { [name: string]: Profile } = {
  shipping: {
    name: 'shipping',
    description: 'A delivery address. The postal code stays in the clear for shipping fees and delivery zones; name, address and phone are sealed and open at the shipping desk.',
    clear: ['postalCode'],
    required: ['name', 'address'],
  },
  inquiry: {
    name: 'inquiry',
    description: 'A contact form. The category stays in the clear for routing; the message, the reply address and the name are sealed and open on the device of whoever answers.',
    clear: ['category'],
    required: ['message'],
  },
};

export function profile(name: string): Profile {
  const p = profiles[name];
  if (!p) throw new Error(`unknown profile ${JSON.stringify(name)}; known: ${Object.keys(profiles).join(', ')}`);
  return p;
}

export interface Split {
  clear: { [field: string]: string };
  sealed: { [field: string]: string };
}

/** Divides a form's values into the fields that stay clear and the fields to seal. */
export function split(p: Profile, values: { [field: string]: string }): Split {
  const out: Split = { clear: {}, sealed: {} };
  for (const [k, v] of Object.entries(values)) {
    if (p.clear.includes(k)) out.clear[k] = v;
    else out.sealed[k] = v;
  }
  for (const k of p.required) {
    if (!out.sealed[k]) throw new Error(`profile ${p.name}: ${k} is required`);
  }
  return out;
}
