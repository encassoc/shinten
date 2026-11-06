import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

const run = promisify(execFile);
const cli = (...args: string[]) => run(process.execPath, ['dist/src/cli.js', ...args]);

test('keygen, seal, inspect and open compose on the command line', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'shinten-'));
  const desk = (await cli('keygen')).stdout.trim();
  const backup = (await cli('keygen')).stdout.trim();
  await writeFile(join(dir, 'desk.json'), desk);
  const { d: _d, ...deskPub } = JSON.parse(desk);
  const { d: _e, ...backupPub } = JSON.parse(backup);
  await writeFile(join(dir, 'keys.json'), JSON.stringify({ keys: [deskPub, backupPub] }));
  await writeFile(join(dir, 'order.json'), JSON.stringify({ name: 'A', address: 'B', postalCode: '100-0001' }));
  const sealed = (await cli('seal', '-p', 'shipping', '-k', join(dir, 'keys.json'), join(dir, 'order.json'))).stdout;
  await writeFile(join(dir, 'sealed.json'), sealed);
  const info = JSON.parse((await cli('inspect', join(dir, 'sealed.json'))).stdout);
  assert.equal(info.profile, 'shipping');
  assert.equal(info.recipients.length, 2);
  const opened = JSON.parse((await cli('open', '-k', join(dir, 'desk.json'), join(dir, 'sealed.json'))).stdout);
  assert.deepEqual(opened.fields, { name: 'A', address: 'B', postalCode: '100-0001' });
  assert.match((await cli('profiles')).stdout, /shipping[\s\S]*inquiry/);
});
