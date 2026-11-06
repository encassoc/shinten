#!/usr/bin/env node
// shinten: seal user input to the key of whoever will act on it.
//
//   shinten keygen                                 a recipient key pair, as JSON
//   shinten profiles                               the profiles and their clear fields
//   shinten seal -p PROFILE -k keys.json [values.json]
//   shinten open -k private.json [sealed.json]
//
// `keys.json` is a JWK Set of the recipients' public keys, or one key.
// `values.json` is {"field": "value", ...}; `sealed.json` is what `seal`
// prints: {"clear": {...}, "envelope": {...}}. Documents are read from a
// file argument or standard input.
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import type { JWK } from 'jose';
import { open, profileOf, recipientsOf, seal, type Sealed } from './envelope.js';
import { generateKey, toPublic } from './keys.js';
import { profiles } from './profile.js';

async function read(path: string | undefined): Promise<string> {
  if (path && path !== '-') return readFile(path, 'utf8');
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

/** Recipients from a JWK Set, a list, or a single key; private keys are reduced to their public half. */
export function recipientsFrom(json: string): JWK[] {
  const v = JSON.parse(json) as JWK | JWK[] | { keys: JWK[] };
  const list = Array.isArray(v) ? v : 'keys' in v && Array.isArray(v.keys) ? v.keys : [v as JWK];
  return list.map(toPublic);
}

function need(v: string | undefined, flag: string): string {
  if (!v) throw new Error(`${flag} is required`);
  return v;
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case 'keygen': {
      const k = await generateKey();
      console.log(JSON.stringify(k.privateJwk));
      return 0;
    }
    case 'profiles': {
      for (const p of Object.values(profiles)) console.log(`${p.name}\n  clear: ${p.clear.join(', ') || '(none)'}\n  required: ${p.required.join(', ')}\n  ${p.description}`);
      return 0;
    }
    case 'seal': {
      const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { profile: { type: 'string', short: 'p' }, keys: { type: 'string', short: 'k' } } });
      const recipients = recipientsFrom(await readFile(need(values.keys, '--keys'), 'utf8'));
      const input = JSON.parse(await read(positionals[0])) as { [field: string]: string };
      console.log(JSON.stringify(await seal(need(values.profile, '--profile'), input, recipients)));
      return 0;
    }
    case 'open': {
      const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { key: { type: 'string', short: 'k' } } });
      const key = JSON.parse(await readFile(need(values.key, '--key'), 'utf8')) as JWK;
      const sealed = JSON.parse(await read(positionals[0])) as Sealed;
      console.log(JSON.stringify(await open(sealed, key)));
      return 0;
    }
    case 'inspect': {
      const { positionals } = parseArgs({ args: rest, allowPositionals: true });
      const sealed = JSON.parse(await read(positionals[0])) as Sealed;
      console.log(JSON.stringify({ ...profileOf(sealed.envelope), recipients: recipientsOf(sealed.envelope), clear: sealed.clear }));
      return 0;
    }
    default:
      console.error('usage: shinten keygen | profiles | seal | open | inspect');
      return 2;
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e: Error) => {
      console.error(e.message);
      process.exit(1);
    },
  );
}
