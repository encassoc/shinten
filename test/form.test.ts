// The browser module without a browser: the pure parts, and that the bundle builds and parses.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { open } from '../src/envelope.js';
import { seal } from '../src/form.js';
import { generateKey } from '../src/keys.js';

test('the form module seals with the same envelope the library opens', async () => {
  const desk = await generateKey();
  const s = await seal('shipping', { name: 'A', address: 'B', postalCode: '1' }, [desk.publicJwk]);
  assert.deepEqual((await open(s, desk.privateJwk)).fields, { name: 'A', address: 'B', postalCode: '1' });
});

test('the browser bundle exists, defines the global and contains no Node-only APIs', async () => {
  const js = await readFile('dist/shinten.browser.js', 'utf8');
  assert.match(js, /var shinten\s*=/);
  assert.doesNotMatch(js, /require\("node:/);
  assert.doesNotMatch(js, /\bBuffer\.from\(/);
});
