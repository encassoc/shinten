import assert from 'node:assert/strict';
import { test } from 'node:test';
import { profile, split } from '../src/profile.js';

test('fields a profile does not know are sealed, never left in the clear', () => {
  const s = split(profile('shipping'), { postalCode: '1', name: 'a', address: 'b', myNumber: '123456789012', note: 'n' });
  assert.deepEqual(Object.keys(s.clear), ['postalCode']);
  assert.deepEqual(Object.keys(s.sealed).sort(), ['address', 'myNumber', 'name', 'note']);
});

test('required sealed fields are enforced', () => {
  assert.throws(() => split(profile('shipping'), { postalCode: '1', name: 'a' }), /address is required/);
  assert.throws(() => split(profile('inquiry'), { category: 'x', message: '' }), /message is required/);
});
