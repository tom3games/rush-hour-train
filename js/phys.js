// 押し合いの計算（床の平面の2D）。前作「まもなくドアが閉まります」の自作 Verlet をそのまま移した
// 単位は前作と同じ px（1280x720 の盤面）。3D の表示は game.js が px から m に直して描く
// DOM に触らないので、Node の sim.mjs でも同じ計算で bot を回せる
export const W = 1280, H = 720, STEP = 1000 / 60
export const CAR = { l: 110, r: 1170, t: 60, wall: 330 }   // 車内の範囲。wall がホームとの境の壁の中心
export const WT = 9                                       // 壁の厚みの半分
export const GC = 640, GH = 78                            // ドアの中心と開口の半分
export const ROUND = 30 * 60                              // 30秒
export const CLOSE_STEPS = 50                             // ドアが閉まり切るまで
const DAMP = 0.84
// 難しさの調整値（前作で bot の乗車率から決めた値。検証からも書き換える）
export const T = { rowGap: 30, colGap: 38, doorZone: 200, fill: 0.85, npcIm: 0.6, homeK: 0.01, homeMax: 0.6, drift: 0, moveAcc: 0.5, sleepIm: 0.22, sleepK: 0.03, vipChance: 0.12, cap: 80, faceIn: 0.75, shoveF: 11, staffF: 0.7, lyingChance: 0.07, dragAcc: 0.28, stunDrop: 90, stunThrow: 160 }   // shoveF・staffF は変な客込みで bot が前作並み（押す約6割・歩くだけ0）になるよう 2026-11-03 に調整

const STATIC = [
  { x0: -200, y0: -200, x1: W + 200, y1: CAR.t },
  { x0: -200, y0: -200, x1: CAR.l, y1: CAR.wall + WT },
  { x0: CAR.r, y0: -200, x1: W + 200, y1: CAR.wall + WT },
  { x0: CAR.l, y0: CAR.wall - WT, x1: GC - GH, y1: CAR.wall + WT },
  { x0: GC + GH, y0: CAR.wall - WT, x1: CAR.r, y1: CAR.wall + WT },
  { x0: CAR.l + 30, y0: CAR.t, x1: CAR.r - 30, y1: CAR.t + 34 },   // 座席
  { x0: -200, y0: H - 12, x1: W + 200, y1: H + 200 },
  { x0: -200, y0: -200, x1: 0, y1: H + 200 },
  { x0: W, y0: -200, x1: W + 200, y1: H + 200 },
]
const opts_lying = w => w.forceLying
export const POLES = [{ x: GC - 120, y: CAR.wall - 70, r: 7 }, { x: GC + 120, y: CAR.wall - 70, r: 7 }]

export function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0
    let t = Math.imul(a ^ a >>> 15, 1 | a)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}

// 1回分の世界。new World(seed) から step(input) を 60Hz で呼ぶ
export class World {
  constructor(seed = 1, opts = {}) {
    this.seed = seed
    this.rng = mulberry32(seed)
    this.bodies = []; this.parts = []; this.cons = []; this.pid = 0
    this.door = 0; this.doorPhase = 'open'; this.trainX = 0; this.trainV = 0; this.step = 0
    this.phase = 'play'; this.departT = 0; this.staff = null; this.vip = null
    this.ev = []          // 描画と音に渡す出来事（毎フレーム game.js が読んで空にする）
    this.grid = new Map()
    this.result = null
    this.forceVip = opts.vip
    this.forceNoSpecial = opts.noSpecial
    this.forceLying = opts.lying
    this.build()
  }
  rnd(a, b) { return a + (b - a) * this.rng() }
  pick(a) { return a[Math.floor(this.rng() * a.length)] }

  P(x, y, r, im, body) {
    const p = { id: this.pid++, x, y, px: x, py: y, ax: 0, ay: 0, r, im, body, frozen: false }
    this.parts.push(p); body.all.push(p); return p
  }
  link(a, b, s = 1) { this.cons.push({ a, b, d: Math.hypot(a.x - b.x, a.y - b.y), s }) }

  makePerson(x, y, ang, kind, type = 'commuter') {
    const b = { id: this.bodies.length, kind, type, all: [], home: { x, y }, dir: { x: Math.cos(ang), y: Math.sin(ang) },
      shoveCd: 0, shoveAnim: 0, shoves: 0, held: 0, outcome: null, caught: false, ejected: false, look: 0, sayCd: 0, hitT: 0, vx: 0, vy: 0 }
    const fx = Math.cos(ang), fy = Math.sin(ang), sx = -fy, sy = fx
    const im = kind === 'npc' ? (type === 'sleep' ? T.sleepIm : T.npcIm) : 1
    b.head = this.P(x + fx * 3, y + fy * 3, 11, im, b)
    b.ls = this.P(x + sx * 16, y + sy * 16, 11, im, b)
    b.rs = this.P(x - sx * 16, y - sy * 16, 11, im, b)
    b.le = this.P(b.ls.x + fx * 12 + sx * 4, b.ls.y + fy * 12 + sy * 4, 5, im * 1.6, b)
    b.lh = this.P(b.le.x + fx * 12, b.le.y + fy * 12, 6, im * 1.6, b)
    b.re = this.P(b.rs.x + fx * 12 - sx * 4, b.rs.y + fy * 12 - sy * 4, 5, im * 1.6, b)
    b.rh = this.P(b.re.x + fx * 12, b.re.y + fy * 12, 6, im * 1.6, b)
    const L = (a, c, s) => this.link(a, c, s)
    L(b.head, b.ls); L(b.head, b.rs); L(b.ls, b.rs)
    L(b.ls, b.le); L(b.le, b.lh); L(b.rs, b.re); L(b.re, b.rh)
    L(b.le, b.head, 0.04); L(b.re, b.head, 0.04)
    if (type === 'pack') {   // 背中のリュック。体の後ろにもう1つ玉が増えて場所を取る
      b.pack = this.P(x - fx * 17, y - fy * 17, 13, im, b)
      L(b.pack, b.ls); L(b.pack, b.rs); L(b.pack, b.head, 0.5)
    }
    b.core = [b.head, b.ls, b.rs]
    this.bodies.push(b)
    return b
  }

  build() {
    // 乗客を車内に詰める（ドア付近は必ず満員。前作で「乱数配置だと歩くだけで乗れる」を潰した方式）
    const near = []
    for (let row = 0, y = CAR.t + 56; y <= CAR.wall - 24; y += T.rowGap, row++) {
      for (let x = CAR.l + 24 + (row % 2) * T.colGap / 2; x <= CAR.r - 24; x += T.colGap) {
        const nearDoor = Math.abs(x - GC) < T.doorZone
        if (!nearDoor && this.rng() > T.fill) continue
        if (POLES.some(q => (q.x - x) ** 2 + (q.y - y) ** 2 < 28 * 28)) continue
        // 大半はドアに背中を向けて車内の奥を向く（後ろから見ると背中が並ぶ）
        const ang = this.rng() < T.faceIn ? -Math.PI / 2 + this.rnd(-0.8, 0.8) : this.rnd(0, Math.PI * 2)
        const b = this.makePerson(x + this.rnd(-4, 4), y + this.rnd(-3, 3), ang, 'npc')
        b.look = Math.floor(this.rng() * 1000)
        if (nearDoor && y > CAR.wall - 150) near.push(b)
      }
    }
    // 変な客を毎回くじで入れる（ドアの近くにいる人を置き換える）
    const swap = (type, chance) => {
      if (this.rng() > chance || !near.length) return null
      const i = Math.floor(this.rng() * near.length), b = near.splice(i, 1)[0]
      return this.retype(b, type)
    }
    const no = this.forceNoSpecial   // 検証用: true で変な客なし
    if (no !== true && no !== 'sleep') swap('sleep', 0.75)
    if (no !== true && no !== 'pack') { swap('pack', 0.85); swap('pack', 0.4) }
    if (no !== true) { swap('dufu', 0.7); swap('perfume', 0.65); swap('bento', 0.5); swap('board', 0.35) }
    // ホームから一緒に乗り込む客
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1
      const b = this.makePerson(GC + side * this.rnd(160, 300), CAR.wall + this.rnd(110, 210), -Math.PI / 2, 'rival', 'rival')
      b.look = Math.floor(this.rng() * 1000)
      if (i === 1 && this.rng() < 0.5) b.type = 'tourist'   // スーツケースの観光客（見た目と言葉だけ）
    }
    // レア: ドアの前のホームで寝そべる人（重くて動かない障害物）
    if (no !== true && (opts_lying(this) ?? this.rng() < T.lyingChance)) {
      const b = this.makePerson(GC + this.rnd(-45, 45), CAR.wall + 62, 0, 'npc', 'lying')
      for (const q of b.all) q.im = T.sleepIm
      this.lying = b
    }
    // レア: 全員がよけて道ができる謎の人
    const vip = this.forceVip != null ? this.forceVip : this.rng() < T.vipChance
    if (vip) {
      this.vip = this.makePerson(GC + 70, CAR.wall + 260, -Math.PI / 2, 'vip', 'vip')
      this.vip.wait = 4 * 60 + Math.floor(this.rng() * 120)
    }
    // プレイヤー
    this.player = this.makePerson(GC, H - 250, -Math.PI / 2, 'p1', 'player')
    this.player.shoveCd = 30
  }

  // ばらばらにした玉を作り直さずに種類だけ変える（体重・リュック）
  retype(b, type) {
    b.type = type
    if (type === 'sleep') for (const p of b.all) p.im = (p === b.head || p === b.ls || p === b.rs) ? T.sleepIm : T.sleepIm * 1.6
    if (type === 'pack') {
      // 背中側（向きの逆）にリュックの玉を足す
      const c = mid(b), fx = b.dir.x, fy = b.dir.y
      b.pack = this.P(c.x - fx * 17, c.y - fy * 17, 13, b.head.im, b)
      this.link(b.pack, b.ls); this.link(b.pack, b.rs); this.link(b.pack, b.head, 0.5)
    }
    return b
  }

  // ---------------------------------------------------------------- 物理
  doorRects() {
    if (this.door <= 0) return []
    const ext = GH * this.door
    return [
      { x0: GC - GH, y0: CAR.wall - WT, x1: GC - GH + ext, y1: CAR.wall + WT },
      { x0: GC + GH - ext, y0: CAR.wall - WT, x1: GC + GH, y1: CAR.wall + WT },
    ]
  }
  buildGrid() {
    const g = this.grid; g.clear()
    for (const p of this.parts) {
      const k = ((p.x / 40) | 0) * 4096 + ((p.y / 40) | 0)
      let a = g.get(k); if (!a) { a = []; g.set(k, a) } a.push(p)
    }
  }
  collideAll() {
    const g = this.grid
    for (const a of this.parts) {
      const gx = (a.x / 40) | 0, gy = (a.y / 40) | 0
      for (let ix = gx - 1; ix <= gx + 1; ix++) for (let iy = gy - 1; iy <= gy + 1; iy++) {
        const cell = g.get(ix * 4096 + iy); if (!cell) continue
        for (const b of cell) {
          if (b.id <= a.id || b.body === a.body) continue
          const wa = a.frozen ? 0 : a.im, wb = b.frozen ? 0 : b.im, ws = wa + wb
          if (!ws) continue
          const dx = b.x - a.x, dy = b.y - a.y, rr = a.r + b.r, d2 = dx * dx + dy * dy
          if (d2 >= rr * rr || d2 < 1e-9) continue
          const d = Math.sqrt(d2), pen = (rr - d) / d * 0.8
          a.x -= dx * pen * wa / ws; a.y -= dy * pen * wa / ws
          b.x += dx * pen * wb / ws; b.y += dy * pen * wb / ws
        }
      }
    }
  }
  solveCons() {
    for (const c of this.cons) {
      const { a, b } = c
      const wa = a.frozen ? 0 : a.im, wb = b.frozen ? 0 : b.im, ws = wa + wb
      if (!ws) continue
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1e-6
      const k = (d - c.d) / d * c.s
      a.x += dx * k * wa / ws; a.y += dy * k * wa / ws
      b.x -= dx * k * wb / ws; b.y -= dy * k * wb / ws
    }
  }
  bounds() {
    const doors = this.doorRects()
    for (const p of this.parts) {
      if (p.frozen) continue
      for (const R of STATIC) pushOutRect(p, R)
      for (const R of doors) pushOutRect(p, R)
      for (const q of POLES) {
        const dx = p.x - q.x, dy = p.y - q.y, rr = p.r + q.r, d2 = dx * dx + dy * dy
        if (d2 < rr * rr && d2 > 1e-9) { const d = Math.sqrt(d2), k = (rr - d) / d; p.x += dx * k; p.y += dy * k }
      }
      if (p.body.kind === 'staff' && p.y < CAR.wall + 30) p.y = CAR.wall + 30   // 駅員は乗らない
    }
  }
  physStep() {
    for (const p of this.parts) {
      if (p.frozen) { p.ax = p.ay = 0; continue }
      const vx = (p.x - p.px) * DAMP, vy = (p.y - p.py) * DAMP
      p.px = p.x; p.py = p.y
      p.x += vx + p.ax; p.y += vy + p.ay
      p.ax = p.ay = 0
    }
    this.buildGrid()
    for (let it = 0; it < 5; it++) { this.solveCons(); this.collideAll(); this.bounds() }
  }

  // ---------------------------------------------------------------- 操作
  shove(b) {
    const c = b.head, dir = b.dir
    const hit = new Map()
    for (const q of this.parts) {
      if (q.body === b || q.frozen) continue
      const dx = q.x - c.x, dy = q.y - c.y, d = Math.hypot(dx, dy)
      if (d > 82 || d < 1e-3) continue
      const dot = (dx * dir.x + dy * dir.y) / d
      if (dot < -0.3) continue
      const f = (1 - d / 82) * T.shoveF * (0.6 + 0.4 * Math.max(0, dot)) * q.im
      q.x += dx / d * f; q.y += dy / d * f
      if (q.body.kind !== 'staff') hit.set(q.body, (hit.get(q.body) || 0) + f)
    }
    for (const p of b.core) { p.x -= dir.x * 1.5; p.y -= dir.y * 1.5 }
    b.lh.x += dir.x * 9; b.lh.y += dir.y * 9; b.rh.x += dir.x * 9; b.rh.y += dir.y * 9
    b.shoveCd = 36; b.shoveAnim = 10; b.shoves++
    let top = null, tf = 0
    for (const [o, f] of hit) { o.hitT = 18; if (f > tf) { tf = f; top = o } }
    this.ev.push({ t: 'shove', by: b, top, n: hit.size, f: tf })
  }

  control(inp) {
    const b = this.player
    if (b.shoveCd > 0) b.shoveCd--
    if (b.shoveAnim > 0) b.shoveAnim--
    if (b.core[0].frozen || (b.caught && this.phase === 'play') || !inp) { if (b.grab) this.releaseGrab(b, false); return }
    let { x, y } = inp; const len = Math.hypot(x, y)
    if (len > 1) { x /= len; y /= len }
    if (len > 0.2) {
      const n = Math.hypot(x, y); b.dir = { x: x / n, y: y / n }
      for (const p of b.core) { p.ax += x * T.moveAcc; p.ay += y * T.moveAcc }
      b.head.ax += x * 0.12; b.head.ay += y * 0.12
      b.lh.ax += b.dir.x * 0.25; b.lh.ay += b.dir.y * 0.25
      b.rh.ax += b.dir.x * 0.25; b.rh.ay += b.dir.y * 0.25
    } else if (inp.face) b.dir = inp.face   // 止まっている時は見ている向きに押す
    if (inp.shove && b.shoveCd <= 0 && this.phase === 'play') this.shove(b)
    // つかむ（前作 f508970 / 399e928）: つかんでいる間は手が相手にくっつき、歩くと引きずる。離すと進む向きに投げる
    const want = !!inp.grab && this.phase === 'play'
    if (want && !b.grab && !b.grabHeld) this.tryGrab(b)
    b.grabHeld = want
    if (!want && b.grab) this.releaseGrab(b, len > 0.2)
    if (b.grab) {
      const g = b.grab, q = g.target
      if (q.frozen || Math.hypot(g.hand.x - q.x, g.hand.y - q.y) > 46) this.releaseGrab(b, false)
      else {
        b.grabT++
        const heavy = q.body.type === 'sleep' || q.body.type === 'lying'
        if (!heavy) q.body.held = 3   // つかまれている間は踏ん張れない（寝ている人は重くて動かない）
        const k = heavy ? T.dragAcc * 0.12 : T.dragAcc
        if (len > 0.2) for (const p of q.body.core) { p.ax += x * k; p.ay += y * k }
      }
    }
  }

  tryGrab(b) {
    const rx = b.head.x + b.dir.x * 26, ry = b.head.y + b.dir.y * 26
    let best = null, bd = 46, fail = null
    for (const q of this.parts) {
      if (q.body === b || q.frozen) continue
      const d = Math.hypot(q.x - rx, q.y - ry)
      if (d >= bd) continue
      if (q.body.kind === 'staff' || q.body.type === 'vip') { if (!fail || d < fail.d) fail = { b: q.body, d }; continue }   // 駅員と謎の人はつかめない
      bd = d; best = q
    }
    if (!best) { b.grabTry = (b.grabTry || 0) + 1; this.ev.push({ t: 'grabFail', target: fail && fail.b }); return }
    const hand = Math.hypot(b.lh.x - best.x, b.lh.y - best.y) < Math.hypot(b.rh.x - best.x, b.rh.y - best.y) ? b.lh : b.rh
    const con = { a: hand, b: best, d: hand.r + best.r - 4, s: 0.7 }
    this.cons.push(con)
    b.grab = { hand, target: best, con }; b.grabT = 0; b.grabs = (b.grabs || 0) + 1
    this.ev.push({ t: 'grab', target: best.body })
  }
  releaseGrab(b, throwIt) {
    const g = b.grab; if (!g) return
    const i = this.cons.indexOf(g.con); if (i >= 0) this.cons.splice(i, 1)
    const tb = g.target.body, heavyT = tb.type === 'sleep' || tb.type === 'lying', thrown = throwIt && b.grabT > 8 && !g.target.frozen && !heavyT
    if (thrown) { for (const p of tb.all) { if (p.frozen) continue; p.x += b.dir.x * 8; p.y += b.dir.y * 8 } b.throws = (b.throws || 0) + 1 }
    // 離された客はしばらくふらつく。ホームに出された客は立ち直ってから乗り直しに来る
    if (!g.target.frozen && !heavyT) {
      tb.held = thrown ? T.stunThrow : T.stunDrop
      if (tb.kind === 'npc' && mid(tb).y > CAR.wall + 5) { tb.kind = 'rival'; tb.held = Math.max(tb.held, T.stunThrow); tb.out = true }
    }
    b.grab = null
    this.ev.push({ t: 'release', target: tb, thrown })
  }

  ai() {
    const vip = this.vip
    for (const b of this.bodies) {
      if (b.core[0].frozen) continue
      if (b.sayCd > 0) b.sayCd--
      if (b.hitT > 0) b.hitT--
      const c = mid(b)
      if (b.held > 0) { b.held--; continue }
      if (b.kind === 'npc') {
        const heavy = b.type === 'sleep' || b.type === 'lying'
        const k = heavy ? T.sleepK : T.homeK, mx = heavy ? T.homeMax * 2 : T.homeMax
        let ax = (b.home.x - c.x) * k, ay = (b.home.y - c.y) * k
        const m = Math.hypot(ax, ay); if (m > mx) { ax *= mx / m; ay *= mx / m }
        for (const p of b.core) { p.ax += ax; p.ay += ay }
        if (b.home.y > CAR.wall - 20 && b.type !== 'lying') b.home.y = CAR.wall - 40   // ホームに押し出されたら戻ろうとする
        // 謎の人が近づくと、みんなが左右に身を引いて道を空ける
        if (vip && vip.walking && !heavy) {
          const v = mid(vip), dx = c.x - v.x, dy = c.y - v.y
          if (dy < 30 && dy > -150 && Math.abs(dx) < 70) {
            const s = dx === 0 ? (b.id % 2 ? 1 : -1) : Math.sign(dx)
            for (const p of b.core) p.ax += s * 0.9
            b.home.x = c.x + s * 6
            if (!b.yielded) { b.yielded = true; this.ev.push({ t: 'yield', b }) }
          }
        }
      } else if (b.kind === 'rival') {
        if (c.y < CAR.wall - 25) { b.kind = 'npc'; b.home = { x: c.x, y: c.y }; continue }
        const tx = c.y > CAR.wall + 40 ? GC + (c.x - GC) * 0.3 : GC, ty = CAR.wall - 60
        const dx = tx - c.x, dy = ty - c.y, d = Math.hypot(dx, dy) || 1
        for (const p of b.core) { p.ax += dx / d * 0.3; p.ay += dy / d * 0.3 }
        b.dir = { x: dx / d, y: dy / d }
      } else if (b.kind === 'vip') {
        if (b.wait > 0) { b.wait--; if (b.wait === 0) { b.walking = true; this.ev.push({ t: 'vip' }) } continue }
        const tx = GC + 10, ty = CAR.t + 80
        const dx = tx - c.x, dy = ty - c.y, d = Math.hypot(dx, dy) || 1
        if (d < 30 || (c.y < CAR.wall - 120)) { b.kind = 'npc'; b.home = { x: c.x, y: c.y }; b.walking = false; continue }
        for (const p of b.core) { p.ax += dx / d * 0.32; p.ay += dy / d * 0.32 }
        b.dir = { x: dx / d, y: dy / d }
      } else if (b.kind === 'staff') {
        let best = null, bd = 1e9
        for (const o of this.bodies) {
          if (o.kind !== 'p1' && o.kind !== 'rival') continue
          if (o.core[0].frozen) continue
          const oc = mid(o)
          if (oc.y < CAR.wall - 5 || oc.y > CAR.wall + 220 || Math.abs(oc.x - GC) > 220) continue
          const d = Math.abs(oc.x - GC) + (oc.y - CAR.wall)
          if (d < bd) { bd = d; best = o }
        }
        b.target = best
        if (best) {
          const oc = mid(best), tx = oc.x, ty = oc.y + 40
          const dx = tx - c.x, dy = ty - c.y, d = Math.hypot(dx, dy) || 1
          for (const p of b.core) { p.ax += dx / d * 0.55; p.ay += dy / d * 0.55 }
          b.dir = { x: 0, y: -1 }
          if (d < 50) {
            const ex = GC - oc.x, ey = CAR.wall - 50 - oc.y, ed = Math.hypot(ex, ey) || 1
            for (const p of best.core) { p.ax += ex / ed * T.staffF; p.ay += ey / ed * T.staffF }
            b.lh.ax += ex / ed * 0.6; b.lh.ay += ey / ed * 0.6; b.rh.ax += ex / ed * 0.6; b.rh.ay += ey / ed * 0.6
            if (!b.pushing) { b.pushing = true; this.ev.push({ t: 'staffPush', target: best }) }
          } else b.pushing = false
        }
      }
    }
  }

  // 閉まりかけのドアに体がかかっていたら挟まる
  caughtCheck() {
    const half = GH * (1 - this.door)
    if (half > 34) return []
    const b = this.player
    if (b.caught) return []
    return b.all.some(p => Math.abs(p.x - GC) < half + p.r && Math.abs(p.y - CAR.wall) < WT + p.r) ? [b] : []
  }
  eject(b) {
    if (b.grab) this.releaseGrab(b, false)
    b.ejected = true
    const kick = this.rnd(-6, 6)
    for (const p of b.all) { p.px = p.x; p.py = p.y; p.y += 30; p.x += kick }
    b.ls.x += 14; b.rs.x -= 14; b.lh.y += 12; b.rh.y += 12
    this.ev.push({ t: 'eject' })
  }
  closeDoorsFinal() {
    if (this.player.grab) this.releaseGrab(this.player, false)
    this.door = 1
    let n = 0
    for (const b of this.bodies) {
      const c = mid(b)
      if (c.y < CAR.wall - 2 && !b.caught) {
        for (const p of b.all) { p.frozen = true; if (p.y > CAR.wall - WT - p.r) p.y = CAR.wall - WT - p.r - 1; p.px = p.x; p.py = p.y }
        if (!b.outcome) b.outcome = 'in'
        n++
      } else {
        for (const p of b.all) if (p.y < CAR.wall + WT + p.r) { p.y = CAR.wall + WT + p.r + 1; p.py = p.y }
        if (!b.outcome) b.outcome = 'left'
      }
    }
    this.inCount = n
    this.doorPhase = 'closed'
    this.phase = 'depart'; this.departT = 0
    this.ev.push({ t: 'closed', in: this.player.outcome === 'in' })
  }
  doorStep() {
    const remain = ROUND - this.step
    if (this.doorPhase === 'open') {
      if (remain === 10 * 60) {
        this.staff = this.makePerson(GC + 30, H - 40, -Math.PI / 2, 'staff', 'staff')
        this.ev.push({ t: 'staff' })
      }
      if (remain === 8 * 60) this.ev.push({ t: 'bell' })
      if (remain === 5 * 60) this.ev.push({ t: 'closing' })
      if (remain <= CLOSE_STEPS) { this.doorPhase = 'closing'; this.doorT = 0; this.ev.push({ t: 'doorMove' }) }
    }
    if (this.doorPhase === 'closing') {
      this.doorT++; this.door = Math.min(1, this.doorT / CLOSE_STEPS)
      const caught = this.caughtCheck()
      if (caught.length) {
        caught.forEach(b => { b.caught = true; b.outcome = 'ejected' })
        this.doorPhase = 'reopen'
        this.ev.push({ t: 'caught' })
      } else if (this.door >= 1) this.closeDoorsFinal()
    } else if (this.doorPhase === 'reopen') {
      this.door -= 0.04
      if (this.door <= 0.35) {
        this.door = 0.35
        const b = this.player; if (b.caught && !b.ejected) this.eject(b)
        this.doorPhase = 'closing2'
      }
    } else if (this.doorPhase === 'closing2') {
      this.door += 1 / 30
      for (const b of this.caughtCheck()) { b.caught = true; b.outcome = 'ejected'; this.eject(b) }
      if (this.door >= 1) this.closeDoorsFinal()
    }
  }

  // 60Hz で1回
  tick(inp) {
    if (this.phase === 'play' || this.phase === 'depart') this.control(inp)
    this.ai()
    if (this.phase === 'play') { this.step++; this.doorStep() }
    this.physStep()
    for (const b of this.bodies) { const c = mid(b); b.vx = c.x - (b.cx ?? c.x); b.vy = c.y - (b.cy ?? c.y); b.cx = c.x; b.cy = c.y }
    if (this.phase === 'depart') {
      this.departT++
      if (this.departT > 40) { this.trainV += 0.12; this.trainX += this.trainV }
      if (this.departT > 190 && !this.result) this.finish()
    }
  }

  finish() {
    const o = this.player.outcome
    const inN = this.inCount
    this.result = { outcome: o, rate: Math.round(inN / T.cap * 100), shoves: this.player.shoves, inN }
    this.phase = 'result'
  }

  // 乗れているか（体の中心が車内）
  inside(b = this.player) { return mid(b).y < CAR.wall - 2 }
  // 体のまわりの混み具合（混雑の演出に使う）
  crowdAt(b = this.player, R = 46) {
    const c = b.head; let n = 0
    for (const p of this.parts) { if (p.body === b) continue; const dx = p.x - c.x, dy = p.y - c.y; if (dx * dx + dy * dy < R * R) n++ }
    return n
  }
}

export const mid = (b) => ({ x: (b.ls.x + b.rs.x) / 2, y: (b.ls.y + b.rs.y) / 2 })

function pushOutRect(p, R) {
  const cx = Math.max(R.x0, Math.min(p.x, R.x1)), cy = Math.max(R.y0, Math.min(p.y, R.y1))
  const dx = p.x - cx, dy = p.y - cy, d2 = dx * dx + dy * dy
  if (d2 > p.r * p.r) return
  if (d2 > 1e-6) {
    const d = Math.sqrt(d2), k = (p.r - d) / d
    p.x += dx * k; p.y += dy * k
  } else {
    const l = p.x - R.x0 + p.r, r = R.x1 - p.x + p.r, t = p.y - R.y0 + p.r, bb = R.y1 - p.y + p.r
    const m = Math.min(l, r, t, bb)
    if (m === l) p.x -= l; else if (m === r) p.x += r; else if (m === t) p.y -= t; else p.y += bb
  }
}

// bot: ドアの少し奥を目指して進む。shove=true で押し続ける
export function botInput(w, mode) {
  if (mode === 'idle') return { x: 0, y: 0, shove: false }
  const b = w.player, m = mid(b), tx = GC, ty = CAR.wall - 110
  const dx = tx - m.x, dy = ty - m.y, d = Math.hypot(dx, dy) || 1
  if (mode !== 'grab' && mode !== 'mix') return { x: dx / d, y: dy / d, shove: mode === 'shove' }
  // つかんでどける bot: ドアの前で詰まったら、前の人をつかんでホーム側の横へ引きずり出して投げる。押しは使わない（mix は押しも使う）
  const st = b.bot || (b.bot = { t: 0, stuck: 0, ly: m.y })
  st.t++
  if (b.grab) {
    // 後ろ斜め（ドアから離れる横方向）へ引く。40ステップで投げる
    const side = mid(b.grab.target.body).x < GC ? -1 : 1
    if (b.grabT > 40) return { x: side, y: 0.6, grab: false, shove: false }
    return { x: side * 0.7, y: 0.7, grab: true, shove: false }
  }
  if (st.t % 30 === 0) { st.stuck = Math.abs(m.y - st.ly) < 6 ? st.stuck + 1 : 0; st.ly = m.y }
  const want = st.stuck >= 1 && m.y < CAR.wall + 80
  if (want) st.stuck = 0
  return { x: dx / d, y: dy / d, grab: want, shove: mode === 'mix' }
}
