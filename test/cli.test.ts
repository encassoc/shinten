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

test('the CLI runs through a symlink, as npm installs a bin', async () => {
  const { symlink } = await import('node:fs/promises');
  const { resolve } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'shinten-bin-'));
  const link = join(dir, 'shinten');
  await symlink(resolve('dist/src/cli.js'), link);
  const { stdout } = await run(process.execPath, [link, 'profiles']);
  assert.match(stdout, /shipping/);
});

test('keygen writes the private key readable by its owner only, redirected or with -o', async () => {
  const { openSync, closeSync, statSync, readFileSync } = await import('node:fs');
  const { spawnSync } = await import('node:child_process');
  const dir = await mkdtemp(join(tmpdir(), 'shinten-key-'));
  // As `shinten keygen > desk.json` would: the shell creates the file for everyone to read.
  const redirected = join(dir, 'desk.json');
  const fd = openSync(redirected, 'w', 0o644);
  spawnSync(process.execPath, ['dist/src/cli.js', 'keygen'], { stdio: ['ignore', fd, 'inherit'] });
  closeSync(fd);
  assert.equal(statSync(redirected).mode & 0o777, 0o600);
  assert.ok(JSON.parse(readFileSync(redirected, 'utf8')).d);
  const out = join(dir, 'backup.json');
  await cli('keygen', '-o', out);
  assert.equal(statSync(out).mode & 0o777, 0o600);
  // -o never overwrites a key.
  await assert.rejects(cli('keygen', '-o', out), /EEXIST|exists/);
});
