// bot で乗れる割合を測る。node sim.mjs [回数=24]
// 押す bot（人間の連打と同じ 0.6秒に1回）/ 歩くだけ / 何もしない を種を変えて回す
import { World, botInput } from './js/phys.js'
const N = +(process.argv[2] || 24)
const run = (mode, seed, vip) => { const w = new World(seed, { vip }); let g = 0; while (w.phase !== 'result' && g++ < 4000) w.tick(botInput(w, mode)); return w.result }
const out = {}
for (const mode of ['shove', 'walk', 'idle']) for (const vip of [false, true]) {
  let ok = 0, ej = 0, rate = 0
  for (let s = 0; s < N; s++) { const r = run(mode, 1000 + s, vip); if (r.outcome === 'in') ok++; if (r.outcome === 'ejected') ej++; rate += r.rate }
  out[mode + (vip ? '+謎の人' : '')] = { 乗れた: `${ok}/${N}`, 挟まり: ej, 乗車率平均: Math.round(rate / N) }
}
console.log(JSON.stringify(out, null, 1))
