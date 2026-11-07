// 遊び中の fps。スマホ相当（390x844・タッチ・LOW 設定）で、CPU を絞らない時と4倍遅くした時を測る。node fps.mjs
import './mute-auto.mjs'  // テスト中は絶対に音を出さない（playwright を無音に差し替え）
import { chromium, webkit } from 'playwright'
import { spawn, execSync } from 'node:child_process'
import { MUTE_LAUNCH, muteContext } from './mute.mjs'
const PORT = 6100 + Math.floor(Math.random() * 800), srv = spawn(process.execPath, ['server.mjs'], { cwd: import.meta.dirname, env: { ...process.env, PORT: String(PORT) } })
await new Promise(r => setTimeout(r, 400))
console.log('電源:', execSync('pmset -g batt').toString().split('\n')[0])
const meas = p => p.evaluate(() => new Promise(res => { let n = 0, worst = 0, lt = performance.now(); const t0 = lt; const f = () => { const t = performance.now(); worst = Math.max(worst, t - lt); lt = t; n++; if (t - t0 < 5000) requestAnimationFrame(f); else res({ fps: +(n / 5).toFixed(1), worstMs: Math.round(worst) }) }; requestAnimationFrame(f) }))
for (const [name, bt] of [['chromium', chromium], ['webkit', webkit]]) {
  const b = await bt.launch(bt === chromium ? { ...MUTE_LAUNCH, args: [...MUTE_LAUNCH.args, '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] } : {})
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: bt === chromium, hasTouch: true }); await muteContext(ctx)
  const p = await ctx.newPage()
  await p.goto(`http://localhost:${PORT}/`); await p.waitForFunction(() => window.__rhReady, null, { timeout: 30000 })
  const empty = await meas(p)
  await p.evaluate(() => { rh.start(1001); window.__bot = 'shove' })
  await p.waitForTimeout(8000)   // 押し合いの最中（車内に入りかけ）
  const play = await meas(p)
  let slow = null
  if (bt === chromium) {
    const cdp = await ctx.newCDPSession(p); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    await p.evaluate(() => { rh.start(1001); window.__bot = 'shove' }); await p.waitForTimeout(8000)
    slow = await meas(p)
    const phys = await p.evaluate(() => { const t0 = performance.now(); for (let i = 0; i < 60; i++) rh.w.tick(null); return +((performance.now() - t0) / 60).toFixed(2) })
    slow.physMsPerStep = phys
  }
  const info = await p.evaluate(() => ({ low: rh.LOW, people: rh.visCount, calls: rh.renderer.info.render.calls, tris: rh.renderer.info.render.triangles }))
  console.log(name, JSON.stringify({ title: empty, play, cpu4x: slow, ...info }))
  await b.close()
}
srv.kill()
