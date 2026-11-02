import { World, botInput, T } from './js/phys.js'
const [mode, ns, n0, n1, tj] = process.argv.slice(2); if (tj) Object.assign(T, JSON.parse(tj))
let ok = 0, ej = 0
for (let s = +n0; s < +n1; s++) { const w = new World(1000 + s, { vip: false, noSpecial: ns === 'all' ? true : ns === 'none' ? undefined : ns }); let g = 0; while (w.phase !== 'result' && g++ < 4000) w.tick(botInput(w, mode)); if (w.result.outcome === 'in') ok++; if (w.result.outcome === 'ejected') ej++ }
console.log(mode, ns, tj || '', `${ok}/${n1 - n0}`, 'ej', ej)
