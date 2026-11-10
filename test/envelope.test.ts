import assert from 'node:assert/strict';
import { test } from 'node:test';
import { open, profileOf, recipientsOf, seal } from '../src/envelope.js';
import { generateKey, toPublic } from '../src/keys.js';

const order = { name: '山田 太郎', address: '東京都千代田区1-1-1', phone: '090-0000-0000', postalCode: '100-0001', note: 'leave at door' };

test('a shipping address seals to the desk and opens there, postal code in the clear', async () => {
  const desk = await generateKey();
  const s = await seal('shipping', order, [desk.publicJwk]);
  assert.deepEqual(s.clear, { postalCode: '100-0001' });
  assert.deepEqual(recipientsOf(s.envelope), [desk.kid]);
  assert.deepEqual(profileOf(s.envelope), { profile: 'shipping', clear: ['postalCode'], version: 1 });
  const text = JSON.stringify(s.envelope);
  for (const v of ['山田', '千代田', '090-0000', 'leave at door']) assert.ok(!text.includes(v), `${v} leaked`);
  const o = await open(s, desk.privateJwk);
  assert.deepEqual(o.fields, order);
  assert.equal(o.profile, 'shipping');
  assert.equal(o.kid, desk.kid);
});

test('several recipients: any of them opens it, and a backup key is just another recipient', async () => {
  const desk = await generateKey();
  const backup = await generateKey();
  const stranger = await generateKey();
  const s = await seal('shipping', order, [desk.publicJwk, backup.publicJwk]);
  assert.deepEqual((await open(s, backup.privateJwk)).fields, order);
  assert.deepEqual((await open(s, desk.privateJwk)).fields, order);
  await assert.rejects(open(s, stranger.privateJwk), /not sealed to/);
});

test('the clear fields are bound: a swapped postal code refuses to open', async () => {
  const desk = await generateKey();
  const s = await seal('shipping', order, [desk.publicJwk]);
  await assert.rejects(open({ ...s, clear: { postalCode: '150-0001' } }, desk.privateJwk), /not the ones this envelope was sealed beside/);
  await assert.rejects(open({ ...s, clear: {} }, desk.privateJwk), /not the ones/);
});

test('an inquiry seals the message and reply address; the category routes it', async () => {
  const staff = await generateKey();
  const s = await seal('inquiry', { category: 'billing', message: 'My invoice is wrong', email: 'me@example.com' }, [staff.publicJwk]);
  assert.deepEqual(s.clear, { category: 'billing' });
  assert.ok(!JSON.stringify(s.envelope).includes('example.com'));
  assert.equal((await open(s, staff.privateJwk)).fields.email, 'me@example.com');
  await assert.rejects(seal('inquiry', { category: 'billing' }, [staff.publicJwk]), /message is required/);
  await assert.rejects(seal('nope', {}, [staff.publicJwk]), /unknown profile/);
  await assert.rejects(seal('inquiry', { message: 'x' }, []), /at least one recipient/);
});

test('a tampered envelope does not open', async () => {
  const desk = await generateKey();
  const s = await seal('shipping', order, [desk.publicJwk]);
  const broken = { ...s, envelope: { ...s.envelope, ciphertext: s.envelope.ciphertext.slice(0, -2) + 'AA' } };
  await assert.rejects(open(broken, desk.privateJwk));
});

test('a field cannot be both clear and sealed: a hand-built envelope that tries is refused', async () => {
  const { GeneralEncrypt, importJWK } = await import('jose');
  const { bindClear, TYP, VERSION } = await import('../src/envelope.js');
  const desk = await generateKey();
  const pub = toPublic(desk.privateJwk);
  const build = async (clear: { [k: string]: string }, inside: unknown, declared = Object.keys(clear)) =>
    new GeneralEncrypt(new TextEncoder().encode(JSON.stringify(inside)))
      .setProtectedHeader({ enc: 'A256GCM', typ: TYP, cty: 'application/json', shinten: { v: VERSION, profile: 'shipping', clear: declared } })
      .setAdditionalAuthenticatedData(bindClear(clear))
      .addRecipient(await importJWK(pub, 'ECDH-ES+A256KW'))
      .setUnprotectedHeader({ alg: 'ECDH-ES+A256KW', kid: pub.kid as string })
      .encrypt();
  // The shop charges shipping on 100-0001; the label would have gone to 900-0001.
  const clear = { postalCode: '100-0001' };
  const swapped = await build(clear, { name: 'A', address: 'Naha', postalCode: '900-0001' });
  await assert.rejects(open({ clear, envelope: swapped }, desk.privateJwk), /postalCode is both in the clear and sealed/);
  // Sealing a field the profile keeps clear, with nothing in the clear, is refused too.
  const hidden = await build({}, { name: 'A', address: 'Naha', postalCode: '900-0001' });
  await assert.rejects(open({ clear: {}, envelope: hidden }, desk.privateJwk), /postalCode is clear in the shipping profile/);
  // Clear fields presented that the envelope does not declare.
  const undeclared = await build(clear, { name: 'A', address: 'Naha' }, []);
  await assert.rejects(open({ clear, envelope: undeclared }, desk.privateJwk), /not the ones the envelope declares/);
  // Contents that are not an object of strings.
  for (const bad of [['x'], { name: 1 }, 'text']) {
    await assert.rejects(open({ clear, envelope: await build(clear, bad) }, desk.privateJwk), /not an object of fields|not a string/);
  }
  // What seal() makes still opens.
  const good = await build(clear, { name: 'A', address: 'Naha' });
  assert.deepEqual((await open({ clear, envelope: good }, desk.privateJwk)).fields, { postalCode: '100-0001', name: 'A', address: 'Naha' });
});
