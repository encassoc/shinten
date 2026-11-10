# shinten

**どのサーバーでも封をしたまま保存され、業務の場所でだけ開く入力。**

親展は、封書の宛名の本人だけが開封すべきことを示す表示です。このライブラリは
Webフォームに同じことをします。利用者が入力した内容を、ブラウザが「それを使って
仕事をする人」の公開鍵で封じます。途中のサーバー、つまりWebサイト、データベース、
バックアップ、連携先は、封をした項目を保持するだけで開けません。開くのは
使う場所だけです。送り状を印字する出荷担当、問い合わせに答える担当者の端末です。

通信路の暗号化は転送中を守ります。shinten は保存中を守ります。漏洩が実際に
起きるのは、何年も前のフォーム入力や注文を保持し続けるシステムだからです。
封をした項目が漏れても、漏れるのは暗号文です。

[English](README.md)

- 典型的な用途のプロファイル: `shipping`(氏名、住所、電話番号を封じ、送料計算の
  ために郵便番号は平文)と `inquiry`(本文と返信先を封じ、振り分けのために分類は
  平文)。プロファイルが知らない項目は封じられ、漏れることはありません。
- 標準形式: JWE(JSON シリアライズ)、P-256 の JWK に対する ECDH-ES+A256KW、
  鍵ごとに一つの宛先。失った鍵の代わりにバックアップ鍵で開けます。平文の項目は
  追加認証データとして封筒に結びつけられ、郵便番号を差し替えると開きません。
- 鍵は仕事をする人の手元の端末に置きます。ボールトも鍵サービスもなく、他の誰も
  何も預かりません。
- 開く場所に合わせて、ライブラリ、CLI、または仕事をする人のエージェント向けの
  MCPサーバー。

## ページ側

宛先の公開鍵を JWK Set として公開し、フォームに印を付けます。

```html
<form method="post" action="/order"
      data-shinten-profile="shipping"
      data-shinten-keys="/.well-known/shinten.json">
  <input name="postalCode"> <input name="name"> <input name="address"> <input name="phone">
  <button>注文</button>
</form>
<script src="https://unpkg.com/shinten/dist/shinten.browser.js"></script>
```

送信時に、封じる項目は送信から外され、隠し項目 `shinten` が封筒を運びます。
サーバーは `postalCode` と `shinten` を保存し、他は一切見ません。バンドラーから
使うなら `import { sealForm } from 'shinten/form'` です。

## サーバー側

何も入れるものはありません。平文の項目と封筒を、届いたまま保存してください。
封筒は JSON です。二つは一緒に保管します。封筒は、封じたときの平文の項目と
並べたときだけ開きます。

## 仕事をする場所

```ts
import { open } from 'shinten';
const { fields } = await open({ clear: { postalCode }, envelope }, privateJwk, { recipients: approvedKeys });
```

```sh
shinten keygen -o desk.json                       # 宛先の鍵。所有者だけが読める(端末に置き、公開側だけを公開する)
shinten open -k desk.json -r approved.json sealed.json   # {"profile":"shipping","fields":{...}}
shinten watch -r approved.json https://shop.example/.well-known/shinten.json   # サイトが承認した鍵以外を配っていたら終了コード1
shinten inspect sealed.json                       # 開かずに、プロファイルと平文項目と宛先を見る
shinten seal -p inquiry -k keys.json values.json  # コマンドラインから封じる
```

MCPサーバーはエージェント向けに同じことをします。秘密鍵は `SHINTEN_KEY` で
指すファイルで、サーバーはそれで封筒を開き、平文をどこにも書きません。
`SHINTEN_RECIPIENTS` で承認した鍵を指します。

```json
{ "mcpServers": { "shinten": { "command": "shinten-mcp", "env": { "SHINTEN_KEY": "/path/to/desk.json", "SHINTEN_RECIPIENTS": "/path/to/approved.json" } } } }
```

| ツール | 内容 |
|---|---|
| `profiles` | プロファイルと、それぞれが平文に残す項目 |
| `inspect` | 封筒のプロファイル、平文項目、宛先を、開かずに見る |
| `open` | この端末の鍵で封筒を開く |
| `seal` | プロファイルに従って宛先(または自分の鍵)に封じる |

## 守るもの、守らないもの

封じた項目は、保存データのあらゆる漏洩に耐えます。データベースのダンプ、
バックアップ、エクスポート、古いプラグインのテーブル、乗っ取られたSaaSアカウント。
漏洩の大半はこれです。

フォームが封じる宛先の鍵はサイトが配るので、サイトを握った人は鍵を差し替えられます。
自分の鍵を足すことも、一つを入れ替えることもでき、以後のフォームはその鍵にも
封じます。shinten はサイトを信じる代わりに、これが必ず表に出るようにします。

- 封筒は、認証された保護ヘッダーに、封じた鍵そのもの(RFC 7638 の拇印)を記録します。
  `kid` はただのラベルで、真似できます。
- 開ける側は承認した鍵(`approved.json`、JWK Set)を持ち、それを渡して開きます。
  他の鍵にも封じられた封筒や、承認した鍵が欠けた封筒は `RecipientError` で拒否されます。
  差し替えは、それで封じた最初の注文で見つかります。一部の訪問者にだけ偽の鍵を
  配っていても同じです。
- `shinten watch` は、サイトが配る鍵の一覧を、サイトの外から承認した鍵と突き合わせます。
  注文が来る前に差し替えを見つけられます。定期的に実行してください。

入力の瞬間に改ざんされたページが配られる場合には耐えません。鍵とは関係なく、
封じる前に読まれるからです。Subresource Integrity と Content Security Policy で
その窓は狭くなりますが、閉じはしません。閉じるには、入力欄をサイトが管理しない
場所から出す必要があります。開ける側か中立な第三者のドメインの iframe で、
決済ページのホスト型入力欄と同じ方式です。

秘密鍵を失うと、その鍵だけに封じた封筒はすべて開けなくなります。必ず二つ目の
宛先にも封じてください。オフラインに置いたバックアップ鍵か、複数人で分割した鍵です。

## 先行例

AWS CloudFront の field-level encryption(2017年)と、米国特許 9,058,603
(Zappos、2011年出願、失効済み)が同じ構成を記述しています。フォーム項目の
公開鍵暗号化、全階層を通る暗号文、秘密鍵のある場所だけでの復号です。shinten は
これを普通のサイト向けに、開く側と鍵の扱いまで含めて一つにまとめたものです。

## 開発

```sh
npm install
npm test
```

## ライセンス

Apache-2.0
