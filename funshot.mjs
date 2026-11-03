// 笑える場面のスクショ（縦と横）。node funshot.mjs
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { MUTE_LAUNCH, muteContext } from './mute.mjs'
const PORT = 6100 + Math.floor(Math.random() * 800), srv = spawn(process.execPath, ['server.mjs'], { cwd: import.meta.dirname, env: { ...process.env, PORT: String(PORT) } }); await new Promise(r => setTimeout(r, 400))
const b = await chromium.launch({ ...MUTE_LAUNCH, args: [...MUTE_LAUNCH.args, '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const step = (p, n) => p.evaluate(n => { for (let i = 0; i < n; i++) rh.dbg.step(1) }, n)
for (const [W, H, tag] of [[390, 844, 'phone'], [844, 390, 'land']]) {
  const ctx = await b.newContext({ viewport: { width: W, height: H }, locale: 'ja-JP', hasTouch: true, isMobile: true }); await muteContext(ctx)
  const p = await ctx.newPage(); await p.goto(`http://localhost:${PORT}/`); await p.waitForFunction(() => window.__rhReady, null, { timeout: 30000 })
  // 1) 投げた客が吹っ飛ぶ
  await p.evaluate(() => { rh.start(1002, { lying: true }); rh.dbg.pause(true); window.__bot = 'grab'; for (let i = 0; i < 1600; i++) { rh.dbg.step(1); if (rh.w.bodies.some(b => b.tumble > 0.45 && b.tumble < 0.6)) break } })
  await p.screenshot({ path: `shots/fun-throw-${tag}.png` })
  await step(p, 70); await p.screenshot({ path: `shots/fun-stars-${tag}.png` })
  // 2) 駅員「ぬぅん！」
  await p.evaluate(() => { while (rh.w.step < 1260) rh.dbg.step(1) }); await step(p, 120); await p.screenshot({ path: `shots/fun-staff-${tag}.png` })
  // 3) 乗れた後: ドアの窓にむぎゅっ
  await p.evaluate(() => { rh.start(1001); rh.dbg.pause(true); window.__bot = 'shove'; while (rh.w.phase === 'play') rh.dbg.step(1) })
  await step(p, 70); await p.screenshot({ path: `shots/fun-squish-${tag}.png` })
  // 4) 挟まって靴が残る → 遅延証明書
  await p.evaluate(() => { rh.start(3000); rh.dbg.pause(true); window.__bot = 'walk'; while (rh.w.phase === 'play') rh.dbg.step(1) })
  await step(p, 50); await p.screenshot({ path: `shots/fun-shoe-${tag}.png` })
  await p.evaluate(() => { rh.dbg.runToEnd(); window.__bot = null }); await p.screenshot({ path: `shots/fun-cert-${tag}.png` })
  await ctx.close()
}
await b.close(); srv.kill()
