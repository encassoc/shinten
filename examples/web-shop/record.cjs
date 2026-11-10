// Records the demo at 1280x720: title, the order, the admin screen, a leak, the
// shipping desk, the trail and its verification, a hijacked key, the stop, the end.
const { chromium } = require('playwright');
// Usage: node record.cjs OUTDIR, with the server running.
const base = process.env.BASE ?? 'http://127.0.0.1:8800';
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: process.argv[2], size: { width: 1280, height: 720 } } });
  const p = await ctx.newPage();
  const wait = (ms) => p.waitForTimeout(ms);
  const cap = async (t, ms) => { await p.evaluate((x) => window.caption?.(x), t); if (ms) await wait(ms); };
  let mx = 640, my = 360;
  const to = async (sel) => {
    const inBar = await p.locator(sel).first().evaluate((el) => !!el.closest('.bar'));
    if (!inBar) {
      await p.locator(sel).first().evaluate((el) => { const r = el.getBoundingClientRect(); if (r.top < 70 || r.bottom > window.innerHeight - 170) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); });
      await wait(450);
    }
    const bb = await p.locator(sel).first().boundingBox();
    const x = bb.x + bb.width / 2, y = bb.y + bb.height / 2;
    await p.mouse.move(x, y, { steps: 18 }); mx = x; my = y; await wait(250);
  };
  const click = async (sel) => { await to(sel); await p.mouse.down(); await wait(90); await p.mouse.up(); };
  const type = async (sel, text) => { await click(sel); await p.locator(sel).pressSequentially(text, { delay: 55 }); await wait(200); };
  const hl = async (sel) => p.evaluate((s) => { const el = document.querySelector(s); el?.classList.remove('hl'); void el?.offsetWidth; el?.classList.add('hl'); }, sel);
  await fetch(base + '/api/reset', { method: 'POST' });

  // Title
  await p.goto(base + '/title?card=start'); await wait(5200);

  // 1. Order on a fictional shop
  await p.goto(base + '/'); await p.mouse.move(mx, my); await wait(600);
  await cap('架空のネットショップ。注文フォームに shinten を組み込んでいます', 4200);
  await cap('お客さまは、いつも通りお届け先を入力するだけです');
  await type('#f-name', '山田 太郎');
  await type('#f-postal', '108-0023');
  await type('#f-address', '東京都港区芝浦9-9-9 サンプルハイツ101');
  await type('#f-phone', '090-0000-1234');
  await cap('「注文を確定する」を押した瞬間、お名前・ご住所・お電話番号をこのブラウザで暗号化します', 3200);
  await click('#submit'); await wait(1200);
  await cap('お店のサーバーに届くのは、暗号文だけ。郵便番号だけは送料計算のために暗号化しません', 4800);

  // 2. Admin screen
  await cap(''); await click('[data-go=admin]'); await wait(700);
  await cap('お店の管理画面。お届け先は暗号文のまま保管されています', 2400);
  await to('#a-rows .cipher'); await hl('#a-rows .cipher'); await wait(2800);

  // 3. Leak
  await cap(''); await click('[data-go=dump]'); await wait(700);
  await cap('もしデータベースが丸ごと持ち出されても、出てくるのは郵便番号と暗号文だけ。<br>復号する鍵は、このサーバーにはありません', 6000);

  // 4. Shipping desk
  await cap(''); await click('[data-go=desk]'); await wait(700);
  await cap('復号できるのは、秘密鍵を持つ出荷担当の端末だけです（shinten-ship）', 4200);
  await click('#mk'); await wait(700); await p.evaluate(() => window.lift('#desk-out')); await wait(500);
  await cap('その場で復号して、配送会社（ヤマト運輸 B2クラウド）の取込ファイルを作ります', 5000);
  await cap('');
  await click('#purge'); await wait(600); await p.evaluate(() => window.lift('#desk-out')); await wait(300);
  await cap('印刷が済んだら取込ファイルを削除。お届け先は、また暗号文の中だけになります', 4800);

  // 5. Trail
  await cap(''); await click('[data-go=trail]'); await wait(700);
  await cap('受付・復号・削除が、記録に残ります（deedlog）。記録に個人情報は入りません', 5200);
  await cap('');
  await click('#vf'); await p.waitForSelector('#vf-out .alert', { timeout: 15000 }); await p.evaluate(() => window.lift('#vf-out')); await wait(700);
  await cap('運営者の署名と、独立した第三者の副署。<br>記録が書き換えられていないことを、外から確かめられます', 5800);

  // 6. Hijack
  await cap('');
  await wait(400);
  await cap('では、サイトが乗っ取られて、暗号化に使う公開鍵が差し替えられたら？', 3200);
  await click('#hijack'); await wait(1200);
  await cap(''); await click('[data-go=shop]'); await wait(600);
  await cap('乗っ取られたサイトで、次のお客さまが注文します');
  await type('#f-name', '佐藤 花子');
  await type('#f-postal', '108-0023');
  await type('#f-address', '東京都港区芝浦9-8-7 サンプルコート202');
  await click('#submit'); await wait(1600);
  await cap(''); await click('[data-go=desk]'); await wait(700);
  await cap('サイトが配っている公開鍵に、見知らぬ鍵が紛れ込んでいます', 2000);
  await to('#k-served .bad'); await hl('#k-served .bad'); await wait(1800);
  await cap('');
  await click('#mk'); await wait(700); await p.evaluate(() => window.lift('#desk-out')); await wait(500);
  await cap('承認していない鍵で暗号化された注文を見つけ、送り状を1枚も作らずに止まります', 5600);
  await cap(''); await click('[data-go=trail]'); await wait(700);
  await cap('止めたことも、記録に残ります', 3800);
  await cap('');

  // End
  await p.goto(base + '/title?card=end'); await wait(6500);
  await ctx.close(); await b.close();
})();
