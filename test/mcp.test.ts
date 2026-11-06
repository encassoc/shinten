import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { seal } from '../src/envelope.js';
import { generateKey } from '../src/keys.js';

async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const r = await client.callTool({ name, arguments: args });
  if (r.isError) throw new Error((r.content as { text?: string }[])[0]?.text ?? 'tool error');
  return r.structuredContent as Record<string, unknown>;
}

test('the opening side runs as an MCP server over a key file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'shinten-'));
  const staff = await generateKey();
  const keyPath = join(dir, 'staff.json');
  await writeFile(keyPath, JSON.stringify(staff.privateJwk));
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ['dist/src/mcp.js'], env: { ...(process.env as Record<string, string>), SHINTEN_KEY: keyPath } }));
  try {
    assert.deepEqual((await client.listTools()).tools.map((t) => t.name).sort(), ['inspect', 'open', 'profiles', 'seal']);
    const sealed = await seal('inquiry', { category: 'billing', message: 'hello', email: 'me@example.com' }, [staff.publicJwk]);
    const info = await call(client, 'inspect', sealed as unknown as Record<string, unknown>);
    assert.equal(info.profile, 'inquiry');
    const opened = await call(client, 'open', sealed as unknown as Record<string, unknown>);
    assert.deepEqual(opened.fields, { category: 'billing', message: 'hello', email: 'me@example.com' });
    // Sealing without recipients uses the device's own key, and opens again.
    const own = await call(client, 'seal', { profile: 'inquiry', fields: { message: 'note to self' } });
    assert.deepEqual((await call(client, 'open', own)).fields, { message: 'note to self' });
  } finally {
    await client.close();
  }
});
