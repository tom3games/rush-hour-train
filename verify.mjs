import { MUTE_LAUNCH, muteContext } from './mute.mjs'
// 自分で壊す検証。node verify.mjs（音は出さない）
import { chromium, webkit } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import net from 'node:net'
import { World, botInput } from './js/phys.js'
const ROOT = import.meta.dirname
mkdirSync(ROOT + '/shots', { recursive: true })
// port は毎回空きを探す（ほかのゲームの検証が 5390 を使っていて、別のゲームのページを開いて止まった）
const PORT = await new Promise(res => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)) }) })
const server = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) } })
await new Promise(r => setTimeout(r, 400))
const URL0 = `http://localhost:${PORT}/`
let pass = 0, fail = 0
const results = []
async function t(name, fn) {
  try { const r = await fn(); if (r === false) throw new Error('false'); pass++; results.push(`ok   ${name}${r && r !== true ? '  ' + JSON.stringify(r) : ''}`) }
  catch (e) { fail++; results.push(`FAIL ${name}  ${e.message.split('\n')[0]}`) }
}
const expect = (c, msg) => { if (!c) throw new Error(msg) }
const GPU = { ...MUTE_LAUNCH, args: [...MUTE_LAUNCH.args, '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] }
async function open(browser, opts = {}, wait = true) {
  const ctx = await browser.newContext({ locale: 'ja-JP', viewport: { width: 390, height: 844 }, ...opts })
  await muteContext(ctx)
  await ctx.addInitScript(() => { try { localStorage.clear() } catch (e) {} })
  const p = await ctx.newPage(); p.errs = []
  p.on('pageerror', e => p.errs.push('pageerror ' + e.message))
  p.on('console', m => { if (m.type() === 'error') p.errs.push('console ' + m.text()) })
  // three の FileLoader は進み具合を数えるため本体を読み替え、元のリクエストが ERR_ABORTED と報告される（中身は届いている。読み込み完了の検査で別に確かめる）
  p.on('requestfailed', r => { if (!/fonts\.(googleapis|gstatic)/.test(r.url()) && !(/\.glb$/.test(r.url()) && /ABORTED/.test(r.failure() && r.failure().errorText))) p.errs.push('reqfail ' + r.url().split('/').pop() + ' ' + (r.failure() && r.failure().errorText)) })
  await p.goto(URL0)
  if (wait) await p.waitForFunction(() => window.__rhReady, null, { timeout: 30000 })
  return p
}
const overflow = p => p.evaluate(() => {
  const W = document.documentElement.clientWidth, bad = []
  for (const el of document.querySelectorAll('section:not(.hidden) *')) {
    if (el.closest('.hidden') || (el.checkVisibility && !el.checkVisibility({ visibilityProperty: true }))) continue
    const r = el.getBoundingClientRect(); if (r.width && (r.right > W + 1 || r.left < -1)) bad.push((el.id || el.className || el.tagName) + ':' + Math.round(r.left) + '-' + Math.round(r.right))
  }
  return { sw: document.documentElement.scrollWidth, W, bad: bad.slice(0, 5) }
})
const fit = q => q.evaluate(() => {
  const H = innerHeight, de = document.documentElement, over = []
  if (de.scrollHeight > H + 1) over.push('page:' + de.scrollHeight)
  for (const el of document.querySelectorAll('section:not(.hidden) button, section:not(.hidden) a, section:not(.hidden) canvas, section:not(.hidden) .led')) { if (!el.offsetParent || el.closest('.hidden')) continue; const r = el.getBoundingClientRect(); if (r.bottom > H + 1 || r.top < -1) over.push((el.id || el.className) + ':' + Math.round(r.top) + '-' + Math.round(r.bottom)) }
  return { H, over: over.slice(0, 6) }
})
// 遊び中に出ている文字（掲示板の1行・吹き出し）の数
const texts = p => p.evaluate(() => {
  const vis = el => el && !el.classList.contains('hidden') && el.offsetParent && el.textContent.trim()
  return [document.getElementById('ledText'), document.getElementById('say')].filter(vis).length + [...document.querySelectorAll('#hud .hint')].filter(vis).length
})
const SIZES = [[360, 640, 'small'], [390, 844, 'phone'], [844, 390, 'land'], [667, 375, 'land-se'], [768, 1024, 'tab'], [1440, 900, 'pc']]

const browser = await chromium.launch(GPU)
// ---- 読み込み画面
await t('読み込み画面: 最初に電光掲示板が出て、読み込み後に消える', async () => {
  const p = await open(browser, {}, false)
  const first = await p.evaluate(() => { const l = document.getElementById('loading'); return { shown: getComputedStyle(l).display !== 'none' && getComputedStyle(l).opacity === '1', text: document.getElementById('loadText').textContent, ready: !!window.__rhReady } })
  await p.waitForFunction(() => window.__rhReady, null, { timeout: 30000 })
  const after = await p.evaluate(() => ({ hidden: document.getElementById('loading').classList.contains('hidden'), bar: document.getElementById('loadBar').style.width }))
  await p.context().close()
  expect(first.shown && !first.ready && first.text.length >= 6 && first.text.length <= 14 && after.hidden && after.bar === '100%', JSON.stringify({ first, after }))
  return { text: first.text, bar: after.bar }
})
const p = await open(browser)
await t('起動時にエラーが出ない', async () => { expect(p.errs.length === 0, p.errs.join('|')) })
await t('ブラウザの拡大が起きない（viewport・ピンチ・Ctrl+ホイール・Ctrl+プラス）', async () => {
  const r = await p.evaluate(() => {
    const vp = document.querySelector('meta[name=viewport]').content
    const g = new Event('gesturestart', { cancelable: true }); document.dispatchEvent(g)
    const w = new WheelEvent('wheel', { ctrlKey: true, deltaY: -10, bubbles: true, cancelable: true }); window.dispatchEvent(w)
    const k = new KeyboardEvent('keydown', { key: '+', ctrlKey: true, bubbles: true, cancelable: true }); window.dispatchEvent(k)
    return { vp, gesture: g.defaultPrevented, wheel: w.defaultPrevented, key: k.defaultPrevented, ta: getComputedStyle(document.documentElement).touchAction, us: getComputedStyle(document.body).userSelect }
  })
  expect(/user-scalable=no/.test(r.vp) && r.gesture && r.wheel && r.key && r.ta === 'manipulation' && r.us === 'none', JSON.stringify(r))
})
await t('OGP 一式がある', async () => {
  const r = await p.evaluate(() => ['og:title', 'og:description', 'og:image', 'og:url', 'og:type'].map(k => !!document.querySelector(`meta[property="${k}"]`)).concat(!!document.querySelector('meta[name="twitter:card"]')))
  expect(r.every(Boolean), JSON.stringify(r))
})
await t('タイトル → 乗る で遊びが始まり、無音のまま（__muteOk）', async () => {
  await p.click('#btnStart')
  const r = await p.evaluate(() => ({ mode: rh.mode, hud: !document.getElementById('hud').classList.contains('hidden'), mute: window.__muteOk(), calls: window.__soundCalls }))
  expect(r.mode === 'play' && r.hud && r.mute, JSON.stringify(r)); return r
})
await t('押す: Space 1回で1回押し、画面が縮む・ズーム・手が出る（ヒットストップ）', async () => {
  await p.evaluate(() => rh.dbg.pause(true))
  await p.keyboard.press('Space')
  const r = await p.evaluate(() => { rh.dbg.step(40); return { shoves: rh.w.player.shoves, s: rh.dbg.state } })
  // 押した直後の演出を測るため、もう1回押してすぐ見る
  const r2 = await p.evaluate(() => { rh.dbg.step(60); rh.dbg.push(); rh.dbg.step(1); const s = rh.dbg.state; return { shoves: rh.w.player.shoves, squeeze: s.squeezeK, fov: s.fovKick, hit: s.hitStop } })
  expect(r.shoves === 1 && r2.shoves === 2 && r2.squeeze > 0.5 && r2.fov < -2 && r2.hit > 0, JSON.stringify({ r, r2 })); return r2
})
await t('押しボタンを押しっぱなしにしても連発しない（1回押すごとに1回）', async () => {
  const r = await p.evaluate(() => { const n0 = rh.w.player.shoves; rh.dbg.step(120); return rh.w.player.shoves - n0 })
  expect(r === 0, r)
})
await t('視点: 自分の斜め後ろ・高めから。自分が画面の中に見え、屋根は切り取られている', async () => {
  const r = await p.evaluate(() => {
    rh.start(1001); rh.dbg.pause(true); window.__bot = 'shove'; for (let i = 0; i < 300; i++) rh.dbg.step(1); window.__bot = null
    const c = rh.camera.position, pl = rh.w.player, m = { x: (pl.ls.x + pl.rs.x) / 2, y: (pl.ls.y + pl.rs.y) / 2 }
    const px = (m.x - 640) * 0.02, pz = (m.y - 330) * 0.02
    const v = new rh.THREE.Vector3(px, 0.9, pz).project(rh.camera)
    return { camY: +c.y.toFixed(2), behind: +(c.z - pz).toFixed(2), dist: +Math.hypot(c.x - px, c.z - pz).toFixed(2), ndc: [+v.x.toFixed(2), +v.y.toFixed(2)], meVisible: rh.me.group.visible, roofCut: rh.W.cut.every(o => !o.visible), cutN: rh.W.cut.length }
  })
  expect(r.camY > 2.4 && r.behind > 1.5 && r.dist < 5 && Math.abs(r.ndc[0]) < 0.8 && Math.abs(r.ndc[1]) < 0.85 && r.meVisible && r.roofCut && r.cutN > 5, JSON.stringify(r)); return r
})
await t('視点: カメラと自分の間にいる人は透けて、自分が隠れない', async () => {
  const r = await p.evaluate(() => { let faded = 0, n = 0; for (let i = 0; i < 400; i++) { rh.dbg.step(1); for (const q of rh.peopleShown) { n++; if (q.fade < 1) faded++ } } return { faded, n } })
  expect(r.faded > 0, JSON.stringify(r)); return r
})
await t('つかむ（PC）: G を押している間つかみ、引きずり、離すと投げる。離された客はふらつく', async () => {
  const r = await p.evaluate(() => {
    rh.start(1001); rh.dbg.pause(true); window.__bot = 'walk'; rh.dbg.step(240); window.__bot = null
    rh.dbg.input({ x: 0, y: 0, grab: true, face: { x: 0, y: -1 } }); rh.dbg.step(2)
    const g = rh.w.player.grab, tgt = g && g.target.body, y0 = tgt && (tgt.ls.y + tgt.rs.y) / 2
    rh.dbg.input({ x: 0.3, y: 1, grab: true }); rh.dbg.step(30)
    const y1 = tgt && (tgt.ls.y + tgt.rs.y) / 2
    rh.dbg.input({ x: 0.3, y: 1, grab: false }); rh.dbg.step(1)
    const out = { grabbed: !!g, type: tgt && tgt.type, dragged: tgt ? +(y1 - y0).toFixed(1) : 0, released: !rh.w.player.grab, throws: rh.w.player.throws || 0, held: tgt ? tgt.held : 0 }
    rh.dbg.input(null); return out
  })
  expect(r.grabbed && r.dragged > 5 && r.released && r.throws === 1 && r.held > 60, JSON.stringify(r)); return r
})
await t('つかむ: 駅員と謎の人はつかめない・寝ているおっさんは重くて動かない', async () => {
  const r = await p.evaluate(() => {
    const w = rh.w
    // 手の届く点（頭の前26px）を相手の頭に合わせてつかみ、40ステップ引く。寝ている人と普通の客で比べる
    const pull = (pick) => {
      rh.start(1001); rh.dbg.pause(true)
      const t = pick(rh.w), pl = rh.w.player, hx = pl.head.x, hy = pl.head.y
      for (const q of pl.all) { q.x = q.px = t.head.x + (q.x - hx); q.y = q.py = t.head.y + 26 + (q.y - hy) }
      rh.dbg.input({ x: 0, y: 0, grab: true, face: { x: 0, y: -1 } }); rh.dbg.step(1)
      const got = rh.w.player.grab && rh.w.player.grab.target.body
      const y0 = (t.ls.y + t.rs.y) / 2; rh.dbg.input({ x: 0, y: 1, grab: true }); rh.dbg.step(40)
      const moved = (t.ls.y + t.rs.y) / 2 - y0; rh.dbg.input(null); rh.dbg.step(1)
      return { type: got && got.type, moved: +moved.toFixed(1) }
    }
    const sl = pull(w => w.bodies.find(b => b.type === 'sleep'))
    const cm = pull(w => w.bodies.filter(b => b.type === 'commuter' && b.kind === 'npc').sort((a, b) => Math.abs(a.head.x - 640) + Math.abs(a.head.y - 300) - Math.abs(b.head.x - 640) - Math.abs(b.head.y - 300))[0])
    const gs = sl.type, sleepMoved = sl.moved
    // 謎の人
    rh.start(5000, { vip: true }); rh.dbg.pause(true)
    const vip = rh.w.vip, pl2 = rh.w.player
    const c = { x: (vip.ls.x + vip.rs.x) / 2, y: (vip.ls.y + vip.rs.y) / 2 }, hx = pl2.head.x, hy = pl2.head.y
    for (const q of pl2.all) { q.x = q.px = c.x + (q.x - hx); q.y = q.py = c.y + 36 + (q.y - hy) }
    rh.dbg.input({ x: 0, y: 0, grab: true, face: { x: 0, y: -1 } }); rh.dbg.step(1)
    const vipGrab = rh.w.player.grab ? rh.w.player.grab.target.body.type : null
    rh.dbg.input(null)
    return { gs, sleepMoved, commuter: cm, vipGrab }
  })
  expect(r.gs === 'sleep' && r.commuter.type === 'commuter' && r.sleepMoved < r.commuter.moved * 0.5 && r.vipGrab !== 'vip', JSON.stringify(r)); return r
})
await t('つかむ: ホームに投げ出された客は立ち直って乗り直しに来る', async () => {
  const r = await p.evaluate(() => {
    rh.start(1002); rh.dbg.pause(true); window.__bot = 'grab'
    let out = null
    for (let i = 0; i < 1200 && !out; i++) { rh.dbg.step(1); out = rh.w.bodies.find(b => b.out) }
    window.__bot = 'idle'
    if (!out) return null
    const y0 = (out.ls.y + out.rs.y) / 2; rh.dbg.step(400); const y1 = (out.ls.y + out.rs.y) / 2
    window.__bot = null
    return { kind: out.kind, y0: Math.round(y0 - 330), y1: Math.round(y1 - 330) }
  })
  expect(r && r.y0 > 0 && r.y1 < r.y0 - 20, JSON.stringify(r)); return r
})
await t('笑い: 投げた客はくるくる吹っ飛び、そのあと頭の上に星が回る', async () => {
  const r = await p.evaluate(() => {
    rh.start(1002); rh.dbg.pause(true); window.__bot = 'grab'
    let flew = null, maxY = 0
    for (let i = 0; i < 1600 && !flew; i++) { rh.dbg.step(1); flew = rh.w.bodies.find(b => b.tumble > 0) }
    for (let i = 0; i < 30 && flew; i++) { rh.dbg.step(1); const q = rh.peopleOf(flew); if (q) maxY = Math.max(maxY, q.group.position.y) }
    let starsMax = 0; for (let i = 0; i < 60; i++) { rh.dbg.step(1); starsMax = Math.max(starsMax, rh.starsN) }
    window.__bot = null; return { flew: !!flew, maxY: +maxY.toFixed(2), starsMax }
  })
  expect(r.flew && r.maxY > 0.4 && r.starsMax >= 3, JSON.stringify(r)); return r
})
await t('笑い: 車内放送がだんだん崩れる（閉まらない…が出る）', async () => {
  const r = await p.evaluate(() => { rh.start(1001); rh.dbg.pause(true); window.__bot = 'idle'; const seen = []; while (rh.w.phase === 'play') { rh.dbg.step(1); const t = document.getElementById('ledText').textContent; if (seen[seen.length - 1] !== t) seen.push(t) } window.__bot = null; return seen.filter(s => /…/.test(s)) })
  expect(r.some(s => /閉まらない/.test(s)) && r.length >= 4, JSON.stringify(r)); return r
})
await t('笑い: 乗れたら、ホームからドアの窓に押し付けられた顔を映す', async () => {
  const r = await p.evaluate(() => { rh.start(1001); rh.dbg.pause(true); window.__bot = 'shove'; while (rh.w.phase === 'play') rh.dbg.step(1); for (let i = 0; i < 60; i++) rh.dbg.step(1); window.__bot = null
    const sq = rh.peopleShown.filter(q => q.lean.scale.z < 0.6 && q.fade === 1).length
    return { in: rh.w.player.outcome, sq, camZ: +rh.camera.position.z.toFixed(2) } })
  expect(r.in === 'in' && r.sq >= 2 && r.camZ > 2, JSON.stringify(r)); return r
})
await t('笑い: 挟まると靴が片方ホームに残る・レアな寝そべる人はつかんでも動かない', async () => {
  const r = await p.evaluate(() => {
    rh.start(3000); rh.dbg.pause(true); window.__bot = 'walk'; while (rh.w.phase === 'play') rh.dbg.step(1); const shoe = rh.shoeShown && rh.w.player.outcome === 'ejected'
    rh.start(1001, { lying: true }); rh.dbg.pause(true); window.__bot = null
    const ly = rh.w.lying, pl = rh.w.player, hx = pl.head.x, hy = pl.head.y
    for (const q of pl.all) { q.x = q.px = ly.head.x + (q.x - hx); q.y = q.py = ly.head.y + 26 + (q.y - hy) }
    rh.dbg.input({ x: 0, y: 0, grab: true, face: { x: 0, y: -1 } }); rh.dbg.step(1)
    const got = rh.w.player.grab && rh.w.player.grab.target.body.type
    const y0 = (ly.ls.y + ly.rs.y) / 2; rh.dbg.input({ x: 0, y: 1, grab: true }); rh.dbg.step(40); rh.dbg.input({ x: 0, y: 1, grab: false }); rh.dbg.step(1)
    const moved = (ly.ls.y + ly.rs.y) / 2 - y0; rh.dbg.input(null)
    return { shoe, got, moved: +moved.toFixed(1), thrown: rh.w.player.throws || 0 }
  })
  expect(r.shoe && r.got === 'lying' && Math.abs(r.moved) < 10 && r.thrown === 0, JSON.stringify(r)); return r
})
await t('PC ではタッチのボタン（押す・つかむ）を出さない', async () => {
  const r = await p.evaluate(() => getComputedStyle(document.getElementById('touch')).display)
  expect(r === 'none', r)
})
await t('Node の計算とブラウザの計算が同じ結果（同じ種・同じ bot。乗車率は±3%）', async () => {
  const out = []
  for (const seed of [1001, 1004]) {
    const w = new World(seed); let g = 0; while (w.phase !== 'result' && g++ < 4000) w.tick(botInput(w, 'shove'))
    const b = await p.evaluate(s => { rh.start(s); rh.dbg.pause(true); window.__bot = 'shove'; rh.dbg.runToEnd(); window.__bot = null; return { o: rh.w.result.outcome, r: rh.w.result.rate, sh: rh.w.result.shoves } }, seed)
    out.push([seed, w.result.outcome, b.o, w.result.shoves, b.sh, w.result.rate, b.r])
    // Node と Chromium は V8 の版が違い、Math.hypot などの末尾の桁がずれて混雑の中で増える（1500ステップで小数第2位）。結果と押した回数が同じで、乗車率の差が3%以内なら同じ計算とみなす
    expect(w.result.outcome === b.o && w.result.shoves === b.sh && Math.abs(w.result.rate - b.r) <= 3, JSON.stringify(out))
  }
  return out
})
await t('bot（ブラウザ）: 押すだけ・つかんでどけるだけの bot は乗れる・歩くだけと何もしないは乗れない', async () => {
  const r = await p.evaluate(() => {
    const out = {}
    for (const m of ['shove', 'grab', 'walk', 'idle']) {
      let ok = 0
      for (let s = 0; s < 8; s++) { rh.start(2000 + s, { vip: false }); rh.dbg.pause(true); window.__bot = m; rh.dbg.runToEnd(); if (rh.w.result.outcome === 'in') ok++ }
      out[m] = ok
    }
    window.__bot = null; return out
  })
  expect(r.shove >= 3 && r.grab >= 1 && r.walk <= 1 && r.idle === 0, JSON.stringify(r)); return r
})
await t('残り10秒で駅員が出る・掲示板に案内・駅員が押す', async () => {
  const r = await p.evaluate(() => { rh.start(2101, { vip: false }); rh.dbg.pause(true); window.__bot = 'walk'; rh.dbg.step(1200 + 2); const a = { staff: !!rh.w.staff, led: document.getElementById('ledText').textContent }; rh.dbg.step(400); a.pushed = rh.w.staff.pushing || rh.w.staff.target != null; window.__bot = null; return a })
  expect(r.staff && /駅員/.test(r.led) && r.pushed, JSON.stringify(r)); return r
})
await t('挟まる: 「駆け込み乗車はおやめください」・ヒットストップ・赤い光・弾き出されて遅延証明書', async () => {
  // ドアの真ん中で止まる bot（歩くだけで敷居に立つ）
  const r = await p.evaluate(() => {
    for (let s = 0; s < 20; s++) {
      rh.start(3000 + s, { vip: false }); rh.dbg.pause(true); window.__bot = 'walk'
      let caughtAt = null
      while (rh.w.phase === 'play') { rh.dbg.step(1); if (rh.w.player.caught && !caughtAt) { caughtAt = { led: document.getElementById('ledText').textContent, s: rh.dbg.state } } }
      if (caughtAt) { rh.dbg.runToEnd(); window.__bot = null; return { seed: 3000 + s, led: caughtAt.led, hit: caughtAt.s.hitStop, flash: caughtAt.s.flashA, red: document.getElementById('fxFlash').classList.contains('red'), out: rh.w.result.outcome, mode: rh.mode } }
    }
    return null
  })
  expect(r && /駆け込み/.test(r.led) && r.hit > 0.05 && r.flash > 0.3 && r.red && r.out === 'ejected' && r.mode === 'result', JSON.stringify(r)); return r
})
await p.screenshot({ path: ROOT + '/shots/v-cert-ejected.png' })
await t('結果: 乗れたら定期券・乗車率が出る・Xでポストの文に乗車率', async () => {
  const r = await p.evaluate(() => { rh.start(1001); rh.dbg.pause(true); window.__bot = 'shove'; rh.dbg.runToEnd(); window.__bot = null; return { o: rh.w.result.outcome, rate: rh.w.result.rate, post: decodeURIComponent(document.getElementById('btnPost').href), shown: !document.getElementById('result').classList.contains('hidden') } })
  expect(r.o === 'in' && r.rate >= 150 && r.rate <= 280 && r.post.includes(r.rate + '%') && r.post.includes('#満員電車ゲーム') && r.shown, JSON.stringify(r)); return { rate: r.rate }
})
await p.screenshot({ path: ROOT + '/shots/v-pass.png' })
await t('何もしない通しは乗れず、遅延証明書の理由が「ホームで立っていた」', async () => {
  const r = await p.evaluate(() => { rh.start(1001); rh.dbg.pause(true); window.__bot = 'idle'; rh.dbg.runToEnd(); window.__bot = null; return { o: rh.w.result.outcome, sh: rh.w.result.shoves } })
  // 画像の中の文字は読めないので、理由を決める条件を確かめる
  expect(r.o === 'left' && r.sh === 0, JSON.stringify(r)); return r
})
await p.screenshot({ path: ROOT + '/shots/v-cert-idle.png' })
await t('結果の画像（定期券・遅延証明書）が描けている', async () => {
  const v = await p.evaluate(() => { const c = document.getElementById('ticket'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let s = 0, s2 = 0, n = 0; for (let i = 0; i < d.length; i += 4 * 17) { const l = d[i] * .3 + d[i + 1] * .59 + d[i + 2] * .11; s += l; s2 += l * l; n++ } return Math.round(s2 / n - (s / n) ** 2) })
  expect(v > 200, v); return v
})
await t('変な客: デュフフの人はデュフフしか言わない・毎回くじで出る', async () => {
  const r = await p.evaluate(() => {
    const ok = window.RH_LINES.ja.dufu.every(l => l.includes('デュフ')) && window.RH_LINES.en.dufu.every(l => /Dufu/.test(l))
    const kinds = {}
    for (let s = 0; s < 12; s++) { rh.start(4000 + s); for (const b of rh.w.bodies) kinds[b.type] = (kinds[b.type] || 0) + 1 }
    rh.toTitle(); return { ok, kinds }
  })
  expect(r.ok && r.kinds.dufu >= 6 && r.kinds.sleep >= 6 && r.kinds.pack >= 6 && r.kinds.perfume >= 5 && r.kinds.bento >= 3 && r.kinds.board >= 2, JSON.stringify(r)); return r.kinds
})
await t('変な客: 押すと一言（吹き出し）。寝ているおっさんは押しても動きにくい', async () => {
  const r = await p.evaluate(() => {
    rh.start(1001); rh.dbg.pause(true); window.__bot = 'shove'
    let said = '', saidMax = 0
    for (let i = 0; i < 1500; i++) { rh.dbg.step(1); const s = rh.dbg.state.say; if (s && !said) said = s }
    window.__bot = null
    const sl = rh.w.bodies.find(b => b.type === 'sleep'), c = rh.w.bodies.find(b => b.type === 'commuter' && b.kind === 'npc')
    return { said, sleepIm: sl && sl.head.im, im: c.head.im }
  })
  expect(r.said && r.sleepIm < r.im, JSON.stringify(r)); return r
})
await t('変な客: 香水の人に近いと画面がうっすら紫', async () => {
  const r = await p.evaluate(() => {
    rh.start(1003); rh.dbg.pause(true)
    const pf = rh.w.bodies.find(b => b.type === 'perfume'), pl = rh.w.player
    const c = { x: (pf.ls.x + pf.rs.x) / 2, y: (pf.ls.y + pf.rs.y) / 2 }, hx = pl.head.x, hy = pl.head.y
    for (const q of pl.all) { q.x = q.px = c.x + (q.x - hx); q.y = q.py = c.y + 55 + (q.y - hy) }
    rh.dbg.step(1)
    return { pf: rh.dbg.state.perfume, op: +document.getElementById('fxPerfume').style.opacity }
  })
  expect(r.pf > 0.2 && r.op > 0.1, JSON.stringify(r)); return r
})
await p.screenshot({ path: ROOT + '/shots/v-perfume.png' })
await t('レアな謎の人: 歩き出すと掲示板に「車内中ほどへお進みください」・まわりがよける', async () => {
  const r = await p.evaluate(() => {
    rh.start(5000, { vip: true }); rh.dbg.pause(true)
    let led = '', yielded = 0
    for (let i = 0; i < 700; i++) { rh.dbg.step(1); const l = document.getElementById('ledText').textContent; if (/中ほど/.test(l)) led = l }
    yielded = rh.w.bodies.filter(b => b.yielded).length
    return { led, yielded }
  })
  expect(r.led && r.yielded >= 3, JSON.stringify(r)); return r
})
await p.screenshot({ path: ROOT + '/shots/v-vip.png' })
await t('遊び中に同時に出る文字は2つまか（掲示板＋吹き出し）', async () => {
  let mx = 0
  await p.evaluate(() => { rh.start(1008); rh.dbg.pause(true); window.__bot = 'shove' })
  for (let i = 0; i < 60; i++) { await p.evaluate(() => rh.dbg.step(30)); mx = Math.max(mx, await texts(p)); if (await p.evaluate(() => rh.mode) !== 'play') break }
  await p.evaluate(() => { window.__bot = null })
  expect(mx <= 2, mx); return mx
})
await t('吹き出しは 0.9秒＋1字0.09秒 以上出る', async () => {
  const r = await p.evaluate(() => { rh.start(1008); rh.dbg.pause(true); window.__bot = 'shove'; let t0 = null, txt = '', n = 0; for (let i = 0; i < 1600; i++) { rh.dbg.step(1); const s = rh.dbg.state.say; if (s && !t0) { t0 = i; txt = s } if (t0 != null && s === txt) n = i - t0 + 1; if (t0 != null && s !== txt) break } window.__bot = null; return { txt, sec: n / 60 } })
  expect(r.txt && r.sec >= 0.9 + r.txt.length * 0.09 - 0.05, JSON.stringify(r)); return r
})
await t('英語: タイトル・掲示板・結果が英語になる', async () => {
  const r = await p.evaluate(() => { rh.setLang('en'); rh.toTitle(); const h = document.querySelector('#title h1').textContent; rh.start(1001); rh.dbg.pause(true); rh.dbg.step(5); const led = document.getElementById('ledText').textContent; window.__bot = 'idle'; rh.dbg.runToEnd(); window.__bot = null; const post = decodeURIComponent(document.getElementById('btnPost').href); rh.setLang('ja'); return { h, led, post } })
  expect(/Train/.test(r.h) && /bound|OFFICE/i.test(r.led) && /missed/.test(r.post), JSON.stringify(r)); return r
})
await t('通しでエラーが出ていない', async () => { expect(p.errs.length === 0, p.errs.join('|')) })
await p.context().close()

// ---- 6サイズ × 全画面
for (const [w, h, name] of SIZES) {
  const touch = w < 900
  const q = await open(browser, { viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch && w < 800 })
  const views = {}
  views.title = await fit(q); await q.screenshot({ path: `${ROOT}/shots/fit-${name}-title.png` })
  await q.click('#btnHow'); views.how = await fit(q); await q.screenshot({ path: `${ROOT}/shots/fit-${name}-how.png` })
  await q.click('#btnOk'); await q.click('#btnStart'); await q.evaluate(() => { rh.dbg.pause(true); window.__bot = 'shove'; rh.dbg.step(700) })
  views.play = await fit(q); await q.screenshot({ path: `${ROOT}/shots/fit-${name}-play.png` })
  await q.evaluate(() => { rh.dbg.runToEnd(); window.__bot = null })
  views.result = await fit(q); await q.screenshot({ path: `${ROOT}/shots/fit-${name}-result.png` })
  for (const [v, r] of Object.entries(views)) await t(`一画面に収まる ${name} ${w}x${h} ${v}`, async () => { expect(!r.over.length, JSON.stringify(r)) })
  await t(`${name}: はみ出し・エラーなし`, async () => { const o = await overflow(q); expect(o.sw <= o.W && !o.bad.length && !q.errs.length, JSON.stringify(o) + q.errs.join('|')) })
  await q.context().close()
}
await browser.close()

// ---- WebKit（iPhone 相当）でタッチの通し
const wb = await webkit.launch(), wp = await open(wb, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
await t('WebKit: 2本指の touchmove を止める', async () => {
  const r = await wp.evaluate(() => { const e = new Event('touchmove', { cancelable: true, bubbles: true }); Object.defineProperty(e, 'touches', { value: [{}, {}] }); document.body.dispatchEvent(e); return e.defaultPrevented })
  expect(r, r)
})
await t('WebKit: タップで始まり、スティックで進み、手のボタンで押せる', async () => {
  await wp.tap('#btnStart')
  const vis = await wp.evaluate(() => !document.getElementById('touch').classList.contains('hidden'))
  const y0 = await wp.evaluate(() => rh.w.player.head.y)
  // 左側をなぞって前へ（ポインタで再現）
  await wp.evaluate(() => {
    const z = document.getElementById('stickZone'), r = z.getBoundingClientRect(), x = r.left + 80, y = r.bottom - 120
    const ev = (t, yy) => z.dispatchEvent(new PointerEvent(t, { pointerId: 7, clientX: x, clientY: yy, bubbles: true, pointerType: 'touch' }))
    ev('pointerdown', y); ev('pointermove', y - 60)
  })
  await wp.waitForTimeout(1200)
  const y1 = await wp.evaluate(() => rh.w.player.head.y)
  await wp.tap('#btnPush'); await wp.waitForTimeout(300)
  const sh = await wp.evaluate(() => rh.w.player.shoves)
  expect(vis && y1 < y0 - 10 && sh >= 1, JSON.stringify({ vis, y0, y1, sh })); return { moved: Math.round(y0 - y1), shoves: sh }
})
await t('WebKit: にぎる手のボタンはスイッチ式（1回でつかむ・もう1回で離す）', async () => {
  const r = await wp.evaluate(() => { rh.dbg.pause(true); window.__bot = 'walk'; rh.dbg.step(200); window.__bot = null; return 1 })
  await wp.tap('#btnGrab')
  const a = await wp.evaluate(() => { rh.dbg.step(3); return { on: document.getElementById('btnGrab').classList.contains('on'), grab: !!rh.w.player.grab } })
  await wp.evaluate(() => rh.dbg.step(60))
  const b = await wp.evaluate(() => ({ still: !!rh.w.player.grab }))
  await wp.tap('#btnGrab')
  const c = await wp.evaluate(() => { rh.dbg.step(2); return { on: document.getElementById('btnGrab').classList.contains('on'), grab: !!rh.w.player.grab } })
  await wp.evaluate(() => rh.dbg.pause(false))
  expect(a.on && a.grab && b.still && !c.on && !c.grab, JSON.stringify({ a, b, c })); return { a, c }
})
await wp.screenshot({ path: ROOT + '/shots/v-webkit-play.png' })
await t('WebKit: 実際には無音（タップで始めた後）', async () => { const r = await wp.evaluate(() => window.__muteOk()); expect(r, r) })
await t('WebKit: エラーなし', async () => { expect(wp.errs.length === 0, wp.errs.join('|')) })
await wb.close()
server.kill()
console.log(results.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
