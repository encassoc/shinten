import assert from 'node:assert/strict';
import { test } from 'node:test';
import { open, profileOf, recipientsOf, seal } from '../src/envelope.js';
import { generateKey } from '../src/keys.js';

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
