// その場の確認用スクショ。node shot.mjs [w] [h] [webkit]
import './mute-auto.mjs'  // テスト中は絶対に音を出さない（playwright を無音に差し替え）
import { chromium, webkit } from 'playwright'
import { spawn } from 'node:child_process'
import { MUTE_LAUNCH, muteContext } from './mute.mjs'
const [W = 390, H = 844, eng] = process.argv.slice(2)
const PORT = 6100 + Math.floor(Math.random() * 800), srv = spawn(process.execPath, ['server.mjs'], { cwd: import.meta.dirname, env: { ...process.env, PORT: String(PORT) } })
await new Promise(r => setTimeout(r, 400))
const bt = eng === 'webkit' ? webkit : chromium
const b = await bt.launch(bt === chromium ? { ...MUTE_LAUNCH, args: [...MUTE_LAUNCH.args, '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] } : {})
const ctx = await b.newContext({ viewport: { width: +W, height: +H }, locale: 'ja-JP', hasTouch: +W < 900, isMobile: bt === chromium && +W < 900 }); await muteContext(ctx)
const p = await ctx.newPage(); const errs = []
p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ' ' + m.text()) })
await p.goto(`http://localhost:${PORT}/`)
await p.screenshot({ path: 'shots/s-loading.png' })
await p.waitForFunction(() => window.__rhReady, null, { timeout: 30000 }).catch(e => { console.log('NOT READY', errs.join('\n')); process.exit(1) })
await p.waitForTimeout(600)
await p.screenshot({ path: 'shots/s-title.png' })
const SEED = +(process.env.SEED || 1001)
await p.evaluate(s => { rh.start(s); rh.dbg.pause(true); window.__bot = 'shove'; rh.dbg.step(60) }, SEED)
await p.screenshot({ path: 'shots/s-start.png' })
await p.evaluate(() => { rh.dbg.step(840) })
await p.screenshot({ path: 'shots/s-push.png' })
await p.evaluate(() => { rh.dbg.step(1030) })
await p.screenshot({ path: 'shots/s-close.png' })
await p.evaluate(() => { for (let i = 0; i < 60; i++) rh.dbg.step(1) })
await p.screenshot({ path: 'shots/s-depart.png' })
await p.evaluate(() => { rh.dbg.runToEnd() })
await p.screenshot({ path: 'shots/s-result.png' })
console.log(JSON.stringify(await p.evaluate(() => ({ r: rh.w.result, vis: rh.visCount, pool: rh.pool, calls: rh.renderer.info.render.calls, tris: rh.renderer.info.render.triangles }))))
console.log(errs.join('\n'))
await b.close(); srv.kill()
