# shinten

**User input that stays sealed on every server, and opens only where the work is done.**

Shinten (親展, "shin-ten") is the mark on a Japanese envelope meaning
"to be opened by the addressee only". This library does the same for web
forms: the browser seals what the user types to the public key of whoever
will act on it, and every server in between, the website, its database,
its backups, its integrations, holds the sealed field and cannot open it.
It opens only at the point of use: the shipping desk that prints the
label, the staff member who answers the inquiry.

Transport encryption protects data in transit. Shinten protects it at
rest, in the one place breaches actually happen: the systems that keep
old form submissions and order records for years. A leak of a sealed
field is a leak of ciphertext.

[日本語](README.ja.md)

- Profiles for the common cases: `shipping` (name, address and phone
  sealed; postal code in the clear for shipping fees) and `inquiry`
  (message and reply address sealed; category in the clear for routing).
  A field a profile does not know is sealed, never leaked.
- A standard format: JWE (JSON serialization) with ECDH-ES+A256KW on
  P-256 keys as JWKs, one recipient per key, so that a backup key can
  always open what a lost key cannot. The clear fields are bound to the
  envelope as additional authenticated data: a swapped postal code refuses
  to open.
- Keys stay with the people who do the work, on their own devices. No
  vault, no key service, nothing for anyone else to hold.
- Opens where it is needed: a library, a CLI, or an MCP server for the
  agent of whoever does the work.

## In a page

Publish the recipients' public keys as a JWK Set, and mark the form:

```html
<form method="post" action="/order"
      data-shinten-profile="shipping"
      data-shinten-keys="/.well-known/shinten.json">
  <input name="postalCode"> <input name="name"> <input name="address"> <input name="phone">
  <button>Order</button>
</form>
<script src="https://unpkg.com/shinten/dist/shinten.browser.js"></script>
```

On submit, the sealed inputs are left out of the submission and a hidden
`shinten` field carries the envelope. The server stores `postalCode` and
`shinten`, and never sees the rest. From a bundler, `import { sealForm } from 'shinten/form'`.

## On the server

Nothing to install. Store the clear fields and the envelope as they
arrive; the envelope is a JSON document. Keep them together: the envelope
opens only beside the clear fields it was sealed with.

## Where the work is done

```ts
import { open } from 'shinten';
const { fields } = await open({ clear: { postalCode }, envelope }, privateJwk);
```

```sh
shinten keygen -o desk.json                       # a recipient key, readable by you only (keep it on the device; publish its public half)
shinten open -k desk.json sealed.json             # {"profile":"shipping","fields":{...}}
shinten inspect sealed.json                       # profile, clear fields and recipients, without opening
shinten seal -p inquiry -k keys.json values.json  # seal from the command line
```

The MCP server does the same for an agent. The private key is the file
named by `SHINTEN_KEY`; the server opens envelopes with it and writes the
plaintext nowhere.

```json
{ "mcpServers": { "shinten": { "command": "shinten-mcp", "env": { "SHINTEN_KEY": "/path/to/desk.json" } } } }
```

| Tool | Does |
|---|---|
| `profiles` | The profiles and which fields each leaves in the clear |
| `inspect` | Profile, clear fields and recipients of an envelope, without opening it |
| `open` | Open an envelope with this device's key |
| `seal` | Seal fields under a profile to recipients, or to this device's own key |

## What it protects, and what it does not

A sealed field survives every leak of data at rest: database dumps,
backups, exports, an old plugin's tables, a compromised SaaS account. Those
are most breaches.

It does not survive a server that is compromised at the moment of input
and serves a modified page, which can read the field before it is sealed.
Subresource integrity and a content security policy narrow that window;
they do not close it. Seal the keys document the same way you would any
other asset.

A lost private key loses every envelope sealed to it alone. Always seal to
a second recipient: a backup key kept offline, or a key split among
several people.

## Prior art

AWS CloudFront field-level encryption (2017) and US patent 9,058,603
(Zappos, filed 2011, now expired) describe the same arrangement: public-key
encryption of form fields at the edge, ciphertext through every tier,
decryption only where the private key is. Shinten packages it for
ordinary sites, with the opening side and key custody included.

## Development

```sh
npm install
npm test
```

## License

Apache-2.0
