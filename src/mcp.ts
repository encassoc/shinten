#!/usr/bin/env node
// shinten-mcp: the opening side as an MCP server, for the agent of whoever
// does the work. The private key is a file named by SHINTEN_KEY; the
// server opens envelopes with it and never writes the plaintext anywhere.
// SHINTEN_RECIPIENTS, if set, names the approved public keys (a JWK Set):
// envelopes not sealed to exactly those are refused.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFile } from 'node:fs/promises';
import { isMain } from './main.js';
import type { JWK } from 'jose';
import { z } from 'zod';
import { open, profileOf, recipientsOf, seal, type Sealed } from './envelope.js';
import { toPublic } from './keys.js';
import { profiles } from './profile.js';
import { recipientsFrom } from './watch.js';

const sealedSchema = {
  clear: z.record(z.string(), z.string()).describe('The clear fields stored beside the envelope'),
  envelope: z.record(z.string(), z.unknown()).describe('The envelope, as stored (JWE JSON serialization)'),
};

/** Builds the server over a private key file. */
export function openerServer(keyPath: string | undefined, recipientsPath: string | undefined = process.env.SHINTEN_RECIPIENTS): McpServer {
  const server = new McpServer({ name: 'shinten', version: '0.2.3' });
  const approved = async (): Promise<JWK[] | undefined> => (recipientsPath ? recipientsFrom(await readFile(recipientsPath, 'utf8')) : undefined);
  const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v, null, 2) }] });
  const key = async (): Promise<JWK> => {
    if (!keyPath) throw new Error('SHINTEN_KEY must name the private key file');
    return JSON.parse(await readFile(keyPath, 'utf8')) as JWK;
  };

  server.registerTool(
    'profiles',
    { title: 'Profiles', description: 'The profiles and which fields each leaves in the clear.', outputSchema: { profiles: z.array(z.object({ name: z.string(), clear: z.array(z.string()), required: z.array(z.string()), description: z.string() })) } },
    async () => {
      const out = { profiles: Object.values(profiles) };
      return { ...text(out), structuredContent: out };
    },
  );

  server.registerTool(
    'inspect',
    {
      title: 'Inspect an envelope',
      description: 'What an envelope is: its profile, its clear fields and the recipients it is sealed to. Opens nothing.',
      inputSchema: sealedSchema,
      outputSchema: { profile: z.string(), version: z.number(), clear: z.record(z.string(), z.string()), recipients: z.array(z.string()), keys: z.array(z.string()).optional() },
    },
    async (sealed) => {
      const s = sealed as unknown as Sealed;
      const out = { ...profileOf(s.envelope), clear: s.clear, recipients: recipientsOf(s.envelope) };
      return { ...text(out), structuredContent: out };
    },
  );

  server.registerTool(
    'open',
    {
      title: 'Open an envelope',
      description:
        'Open an envelope with this device’s private key and return every field as the user typed it. Use it only at the moment the work needs the content, and do not store what comes back. When approved keys are configured, an envelope sealed to any other key is refused: the keys published for the form may have been replaced, so stop and tell the person.',
      inputSchema: sealedSchema,
      outputSchema: { profile: z.string(), kid: z.string(), fields: z.record(z.string(), z.string()) },
    },
    async (sealed) => {
      const keys = await approved();
      const out = await open(sealed as unknown as Sealed, await key(), keys ? { recipients: keys } : {});
      return { ...text(out), structuredContent: { ...out } };
    },
  );

  server.registerTool(
    'seal',
    {
      title: 'Seal fields',
      description: 'Seal fields under a profile to recipients (public JWKs). With no recipients, seals to this device’s own key.',
      inputSchema: {
        profile: z.string(),
        fields: z.record(z.string(), z.string()),
        recipients: z.array(z.record(z.string(), z.unknown())).optional().describe('Public JWKs of the recipients'),
      },
      outputSchema: sealedSchema,
    },
    async ({ profile, fields, recipients }) => {
      const to = recipients?.length ? (recipients as JWK[]) : [toPublic(await key())];
      const out = await seal(profile, fields, to);
      return { ...text(out), structuredContent: { ...out } };
    },
  );

  return server;
}

if (isMain(import.meta.url)) {
  openerServer(process.env.SHINTEN_KEY)
    .connect(new StdioServerTransport())
    .catch((e: Error) => {
      console.error(e.message);
      process.exit(1);
    });
}
