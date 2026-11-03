// SNS 用の画像 og.png（1200x630）。押し合いの一番近い場面を撮って、右に駅名標風のタイトルを重ねる。node og.mjs
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { MUTE_LAUNCH, muteContext } from './mute.mjs'
const PORT = 6100 + Math.floor(Math.random() * 800), srv = spawn(process.execPath, ['server.mjs'], { cwd: import.meta.dirname, env: { ...process.env, PORT: String(PORT) } })
await new Promise(r => setTimeout(r, 400))
const b = await chromium.launch({ ...MUTE_LAUNCH, args: [...MUTE_LAUNCH.args, '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const ctx = await b.newContext({ viewport: { width: 1200, height: 630 }, locale: 'ja-JP' }); await muteContext(ctx)
const p = await ctx.newPage()
await p.goto(`http://localhost:${PORT}/`); await p.waitForFunction(() => window.__rhReady, null, { timeout: 30000 })
await p.evaluate(() => { rh.start(+(new URLSearchParams(location.search).get('s') || 1001)); rh.dbg.pause(true); window.__bot = 'shove'; window.__bot = 'mix'; rh.dbg.step(420); for (let i = 0; i < 400 && !(rh.w.player.grab && rh.w.player.grabT > 20); i++) rh.dbg.step(1); rh.dbg.render() })
await p.evaluate(() => {
  document.getElementById('hud').classList.add('hidden'); document.getElementById('squeeze').style.transform = 'none'; document.getElementById('fxVig').style.opacity = 0
  const d = document.createElement('div')
  d.innerHTML = `<div style="position:fixed;right:44px;top:56px;z-index:50;background:#f7f7f4;padding:20px 28px 0;transform:rotate(-1.5deg);box-shadow:0 14px 34px rgba(0,0,0,.45);font-family:'M PLUS 1p',sans-serif">
   <div style="font-size:16px;font-weight:800;letter-spacing:.2em;color:#555">MAN-IN DENSHA NI NORIKOME</div>
   <div style="font-size:62px;font-weight:900;line-height:1.15;color:#1b1b1b;white-space:nowrap">満員電車に乗り込め</div>
   <div style="margin:10px -28px 0;background:#16794f;color:#fff;font-weight:800;font-size:20px;padding:8px 28px 10px;display:flex;justify-content:space-between"><span>じたく</span><span>かいしゃまえ</span></div></div>
   <div style="position:fixed;right:52px;top:300px;z-index:50;background:#0e0e0d;border:5px solid #3b3d40;border-top-width:8px;padding:10px 18px;font-family:'DotGothic16',monospace;color:#ff9a2a;font-size:34px;white-space:nowrap">駆け込み乗車はおやめください</div>
   <div style="position:fixed;left:44px;bottom:40px;z-index:50;color:#fff;font-family:'M PLUS 1p',sans-serif;font-weight:900;font-size:34px;text-shadow:0 2px 10px rgba(0,0,0,.9)">押してつかんで乗り込む3Dバカゲー</div>`
  document.body.appendChild(d)
})
await p.addStyleTag({ content: '#squeeze{transform:none!important}#fxVig{display:none!important}' }); await p.waitForTimeout(500)
await p.screenshot({ path: 'og.png' })
await b.close(); srv.kill()
