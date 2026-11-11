# Example: an order form that leaks nothing readable

A fictional shop, in Japanese, built on the published packages: shinten
encrypts the order form in the browser, [shinten-ship](https://github.com/eucassoc/shinten-ship)
decrypts on the shipping desk and writes the carrier's label file, and
[deedlog](https://github.com/eucassoc/deedlog) records each step in a chain
that two witnesses cosign.

[demo.mp4](demo.mp4) (2 minutes) walks through it.

## Run it

Node 20 or later, and Go to install `dlog`:

```sh
go install github.com/eucassoc/deedlog/cmd/dlog@latest

cd examples/web-shop
npm install
npm start          # http://127.0.0.1:8800/
```

If `dlog` is not on your `PATH`, set `DLOG=/path/to/dlog`. The demo writes
its keys and chain to `state/` (or `STATE`) and starts two witnesses on ports
8811 and 8812. Every start, and 「最初から」, begins from nothing.

## What it shows

The bar at the bottom switches between the pages.

1. **お客さまの画面**: the shop's order form. Name, address and phone are
   encrypted in the browser to the shipping desk's key and a backup key,
   which the site serves at `/.well-known/shinten.json`. The postal code
   stays in clear, for the shipping fee.
2. **管理画面**: the shop's server holds the postal code and ciphertext.
3. **漏洩を想定**: the `orders` table as it would leave in a breach. The key to
   decrypt it is not on the server.
4. **出荷担当の端末**: the desk decrypts and writes a Yamato B2 Cloud import
   file, then deletes it once the labels are printed.
5. **運用証跡**: receipt, decryption and deletion as deedlog records, with no
   personal data in them. 「記録を検証する」 signs a checkpoint, has both
   witnesses cosign it and runs `dlog verify`.
6. **サイトが乗っ取られる**: the site starts serving an extra key, as a takeover
   would. The next order is encrypted to it as well, so the desk finds a key
   it never approved, writes no labels, and the stop is recorded.

## Files

| File | |
|---|---|
| [server.mjs](server.mjs) | The shop's server, the desk and the trail |
| [app.html](app.html) | All pages; the form loads `shinten.browser.js` |
| [title.html](title.html) | Title cards for the video |
| [record.cjs](record.cjs) | Records the video with Playwright: `node record.cjs OUTDIR` |

The shop, people and addresses are fictional.
