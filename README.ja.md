# shinten

**どのサーバーでも暗号化したまま保存され、業務の場所でだけ復号される入力。**

名前は、宛名の本人だけが開封すべき封書に付ける表示「親展」から取りました。
このライブラリは、Webフォームに入力された内容を、ブラウザの中で「それを使って
仕事をする人」の公開鍵で暗号化します。途中のサーバー、つまりWebサイト、データベース、
バックアップ、連携先は、暗号文を保持するだけで復号できません。復号するのは
内容を使う場所だけです。送り状を印字する出荷担当、問い合わせに答える担当者の端末です。

通信路の暗号化は転送中を守ります。shinten は保存中を守ります。漏洩が実際に
起きるのは、何年も前のフォーム入力や注文を保持し続けるシステムだからです。
暗号化した項目が漏れても、漏れるのは暗号文です。

[English](README.md)

- 典型的な用途のプロファイル: `shipping`(氏名、住所、電話番号を暗号化し、送料計算の
  ために郵便番号は平文のまま)と `inquiry`(本文と返信先を暗号化し、振り分けのために
  分類は平文のまま)。プロファイルが知らない項目は必ず暗号化され、平文で漏れることは
  ありません。
- 標準形式: JWE(JSON シリアライズ)、P-256 の JWK に対する ECDH-ES+A256KW、
  鍵ごとに一つの宛先。宛先を複数にしておけば、鍵を一つ失ってもバックアップ鍵で
  復号できます。平文の項目は追加認証データとして暗号文に結びつけられ、郵便番号を
  差し替えると復号できません。
- 鍵は仕事をする人の手元の端末に置きます。ボールトも鍵サービスもなく、他の誰も
  何も預かりません。
- 復号する場所に合わせて、ライブラリ、CLI、または仕事をする人のエージェント向けの
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

送信時に、暗号化する項目は送信から外され、隠し項目 `shinten` が暗号文を運びます。
サーバーは `postalCode` と `shinten` を保存し、他は一切見ません。バンドラーから
使うなら `import { sealForm } from 'shinten/form'` です。

## サーバー側

何も入れるものはありません。平文の項目と暗号文を、届いたまま保存してください。
暗号文は JSON です。二つは一緒に保管します。暗号文は、暗号化したときの平文の項目と
組にしたときだけ復号できます。

## 仕事をする場所

API では暗号化を `seal`、復号を `open`、暗号文を `envelope` と呼びます。

```ts
import { open } from 'shinten';
const { fields } = await open({ clear: { postalCode }, envelope }, privateJwk, { recipients: approvedKeys });
```

```sh
shinten keygen -o desk.json                       # 宛先の鍵。所有者だけが読める(端末に置き、公開鍵だけを公開する)
shinten open -k desk.json -r approved.json sealed.json   # 復号する。{"profile":"shipping","fields":{...}}
shinten watch -r approved.json https://shop.example/.well-known/shinten.json   # サイトが承認した鍵以外を配っていたら終了コード1
shinten inspect sealed.json                       # 復号せずに、プロファイルと平文項目と宛先を見る
shinten seal -p inquiry -k keys.json values.json  # コマンドラインから暗号化する
```

MCPサーバーはエージェント向けに同じことをします。秘密鍵は `SHINTEN_KEY` で
指すファイルで、サーバーはそれで復号し、平文をどこにも書きません。
`SHINTEN_RECIPIENTS` で承認した鍵を指します。

```json
{ "mcpServers": { "shinten": { "command": "shinten-mcp", "env": { "SHINTEN_KEY": "/path/to/desk.json", "SHINTEN_RECIPIENTS": "/path/to/approved.json" } } } }
```

| ツール | 内容 |
|---|---|
| `profiles` | プロファイルと、それぞれが平文に残す項目 |
| `inspect` | 暗号文のプロファイル、平文項目、宛先を、復号せずに見る |
| `open` | この端末の秘密鍵で復号する |
| `seal` | プロファイルに従って宛先(または自分の鍵)に暗号化する |

## 守るもの、守らないもの

暗号化した項目は、保存データのあらゆる漏洩に耐えます。データベースのダンプ、
バックアップ、エクスポート、古いプラグインのテーブル、乗っ取られたSaaSアカウント。
漏洩の大半はこれです。

フォームが暗号化に使う公開鍵はサイトが配るので、サイトを握った人は鍵を差し替えられます。
自分の鍵を足すことも、一つを入れ替えることもでき、以後のフォームはその鍵でも
暗号化します。shinten はサイトを信じる代わりに、これが必ず表に出るようにします。

- 暗号文は、認証された保護ヘッダーに、暗号化に使った鍵そのもの(RFC 7638 の拇印)を
  記録します。`kid` はただのラベルで、真似できます。
- 復号する側は承認した鍵(`approved.json`、JWK Set)を持ち、それを渡して復号します。
  他の鍵でも暗号化された暗号文や、承認した鍵が欠けた暗号文は `RecipientError` で
  拒否されます。差し替えは、その鍵一覧で暗号化された最初の注文で見つかります。
  一部の訪問者にだけ偽の鍵を配っていても同じです。
- `shinten watch` は、サイトが配る鍵の一覧を、サイトの外から承認した鍵と突き合わせます。
  注文が来る前に差し替えを見つけられます。定期的に実行してください。

入力の瞬間に改ざんされたページが配られる場合には耐えません。鍵とは関係なく、
暗号化する前に読まれるからです。Subresource Integrity と Content Security Policy で
その窓は狭くなりますが、閉じはしません。閉じるには、入力欄をサイトが管理しない
場所から出す必要があります。復号する側か中立な第三者のドメインの iframe で、
決済ページのホスト型入力欄と同じ方式です。

秘密鍵を失うと、その鍵だけで暗号化した内容はすべて復号できなくなります。必ず二つ目の
宛先にも暗号化してください。オフラインに置いたバックアップ鍵か、複数人で分割した鍵です。

## 例

[examples/web-shop](examples/web-shop/) は架空のネットショップのデモです。ブラウザで
暗号化される注文フォーム、漏洩を想定したデータベースの中身、復号して削除する出荷担当の
端末、各手順の記録とその連署、出荷担当の端末が気付くサイトの乗っ取りまでを見られます。
流れは[約2分の動画](examples/web-shop/demo.mp4)で見られます。

## 先行例

AWS CloudFront の field-level encryption(2017年)と、米国特許 9,058,603
(Zappos、2011年出願、失効済み)が同じ構成を記述しています。フォーム項目の
公開鍵暗号化、全階層を通る暗号文、秘密鍵のある場所だけでの復号です。shinten は
これを普通のサイト向けに、復号する側と鍵の扱いまで含めて一つにまとめたものです。

## 関連

[kangoh](https://kangoh.com/) は、会員登録も顧客データベースもなしで、小さなお店
どうしの共通ポイントを運営するためのオープンソースです。同じ「持たない」設計の
姉妹プロジェクトです。

## 開発

```sh
npm install
npm test
```

## ライセンス

Apache-2.0
