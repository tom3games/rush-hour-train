// 駅と電車の3D。素材は全部その場で描く（canvas の模様）。外部の画像は読まない
// 盤面 px から m は S。ドアの中心が x=0、車両の壁（ドアの位置）が z=0、車内は z<0、ホームは z>0
import * as THREE from 'three'
import { CAR, GC, GH, WT, POLES } from './phys.js?v=3'

export const S = 0.02   // 人（Kenney Mini を 1.45 倍）の横幅が盤面の肩幅 54px に合う縮尺
export const wx = x => (x - GC) * S
export const wz = y => (y - CAR.wall) * S
const X0 = wx(CAR.l), X1 = wx(CAR.r), ZF = wz(CAR.t), ZW = WT * S
const DOOR_W = GH * S, DOOR_H = 1.95, CEIL = 2.45, WIN0 = 0.92, WIN1 = 1.78, ROOF = 2.75

function cv(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t }
function noise(x, w, h, n, a, col = '0,0,0') { for (let i = 0; i < n; i++) { x.fillStyle = `rgba(${col},${Math.random() * a})`; x.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2) } }
const M = (o) => new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0, ...o })
function box(w, h, d, mat, x, y, z, parent) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); parent.add(m); return m }

export function buildWorld(scene, Q) {
  const W = {}
  // ---------------------------------------------------------------- 光（朝。ホーム側から日が差す）
  scene.background = new THREE.Color(0xc9d3dc)
  scene.fog = new THREE.Fog(0xc9d3dc, 14, 40)
  scene.add(new THREE.HemisphereLight(0xf4f1ea, 0x6b665e, 1.5))
  const sun = new THREE.DirectionalLight(0xffe2b8, 1.6); sun.position.set(-4, 7, 9); scene.add(sun)
  const inner = new THREE.PointLight(0xeef4ff, 6, 9, 1.6); inner.position.set(0, 2.2, -1.7)

  // ---------------------------------------------------------------- ホーム
  const conc = cv(256, 256, (x, w, h) => { x.fillStyle = '#a9a7a1'; x.fillRect(0, 0, w, h); noise(x, w, h, 2600, 0.12); noise(x, w, h, 900, 0.1, '255,255,255'); x.strokeStyle = 'rgba(0,0,0,.12)'; x.lineWidth = 2; x.strokeRect(0, 0, w, h) })
  conc.wrapS = conc.wrapT = THREE.RepeatWrapping; conc.repeat.set(14, 4)
  const PD = wz(720) + 1.2
  const plat = new THREE.Mesh(new THREE.PlaneGeometry(60, PD), M({ map: conc, roughness: 0.95 })); plat.rotation.x = -Math.PI / 2; plat.position.set(0, 0, PD / 2); scene.add(plat)
  // 点字ブロック（黄色）と白線
  const tact = cv(64, 64, (x, w, h) => { x.fillStyle = '#e2b62a'; x.fillRect(0, 0, w, h); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { x.fillStyle = '#c99c18'; x.beginPath(); x.arc(8 + i * 16, 8 + j * 16, 4.6, 0, 7); x.fill(); x.fillStyle = '#f0cd4c'; x.beginPath(); x.arc(7 + i * 16, 7 + j * 16, 2, 0, 7); x.fill() } })
  tact.wrapS = tact.wrapT = THREE.RepeatWrapping; tact.repeat.set(150, 1)
  const tp = new THREE.Mesh(new THREE.PlaneGeometry(60, 0.4), M({ map: tact })); tp.rotation.x = -Math.PI / 2; tp.position.set(0, 0.004, 1.2); scene.add(tp)
  const edge = new THREE.Mesh(new THREE.PlaneGeometry(60, 0.08), M({ color: 0xf2f0ea })); edge.rotation.x = -Math.PI / 2; edge.position.set(0, 0.004, 0.42); scene.add(edge)
  // 乗車位置の足あと
  const foot = cv(128, 128, (x, w, h) => { x.fillStyle = 'rgba(0,0,0,0)'; x.clearRect(0, 0, w, h); x.fillStyle = '#2f5ea8'; for (const [cx, cy] of [[40, 70], [88, 58]]) { x.beginPath(); x.ellipse(cx, cy, 15, 30, 0, 0, 7); x.fill() } })
  for (const s of [-1, 1]) for (let k = 0; k < 3; k++) { const f = new THREE.Mesh(new THREE.PlaneGeometry(0.38, 0.38), M({ map: foot, transparent: true })); f.rotation.x = -Math.PI / 2; f.position.set(s * 1.1, 0.005, 1.9 + k * 0.6); scene.add(f) }
  // 屋根・柱・奥の壁
  const pillarM = M({ color: 0xd8d6d0 })
  // 屋根は高め（遊び中のカメラが 4.2m まで上がる）
  for (const x of [-9, 9]) box(0.4, 5, 0.4, pillarM, x, 2.5, PD * 0.55, scene)
  box(60, 0.18, PD, M({ color: 0x8b9096 }), 0, 5, PD / 2 + 0.3, scene)
  for (let i = -4; i <= 4; i++) box(1.6, 0.05, 0.14, M({ color: 0xffffff, emissive: 0xf4f8ff, emissiveIntensity: 1.2 }), i * 5, 4.89, PD * 0.4, scene)
  const wallT = cv(512, 128, (x, w, h) => { x.fillStyle = '#d9d5cc'; x.fillRect(0, 0, w, h); x.fillStyle = '#c6c1b6'; for (let i = 0; i < w; i += 32) x.fillRect(i, 0, 2, h); noise(x, w, h, 600, 0.08) })
  wallT.wrapS = THREE.RepeatWrapping; wallT.repeat.set(5, 1)
  box(60, 5, 0.2, M({ map: wallT }), 0, 2.5, PD, scene)
  // 駅名標（ホームの奥の壁に1枚）
  const sign = cv(512, 192, (x, w, h) => {
    x.fillStyle = '#f7f7f4'; x.fillRect(0, 0, w, h)
    x.fillStyle = '#16794f'; x.fillRect(0, 118, w, 16)
    x.fillStyle = '#1b1b1b'; x.textAlign = 'center'; x.font = '900 60px "M PLUS 1p",sans-serif'; x.fillText('かいしゃまえ', w / 2, 80)
    x.font = '700 22px "M PLUS 1p",sans-serif'; x.fillText('会社前  KAISHAMAE', w / 2, 108)
    x.font = '700 20px "M PLUS 1p",sans-serif'; x.textAlign = 'left'; x.fillText('じたく', 18, 168); x.textAlign = 'right'; x.fillText('しゃたく', w - 18, 168)
  })
  const sg = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.9), M({ map: sign, roughness: 0.5 })); sg.position.set(-3.2, 2.2, PD - 0.11); sg.rotation.y = Math.PI; scene.add(sg)
  // ホームのベンチ
  const bench = M({ color: 0x7a8a99 })
  box(2.2, 0.08, 0.45, bench, 3.5, 0.45, PD - 0.6, scene); box(2.2, 0.5, 0.06, bench, 3.5, 0.75, PD - 0.35, scene)

  // ---------------------------------------------------------------- 電車（W.train に入れて発車で動かす）
  const train = W.train = new THREE.Group(); scene.add(train)
  train.add(inner)
  // 外板（ステンレス）と帯
  const steel = cv(256, 256, (x, w, h) => { const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#dfe3e6'); g.addColorStop(0.5, '#c4c9cd'); g.addColorStop(1, '#d6dadd'); x.fillStyle = g; x.fillRect(0, 0, w, h); for (let i = 0; i < w; i += 3) { x.fillStyle = `rgba(255,255,255,${Math.random() * 0.08})`; x.fillRect(i, 0, 1, h) } })
  const skin = M({ map: steel, metalness: 0.55, roughness: 0.38 })
  const band = M({ color: 0x1f8a5b, roughness: 0.6 })
  const glass = new THREE.MeshStandardMaterial({ color: 0x1d2a33, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.32 })
  const zo = ZW   // 外側の面
  // 窓のある壁: 下の腰板・上の幕板・窓の間の柱。ドアの左右に2枚ずつ窓
  const wallSeg = (xa, xb) => {
    const cx = (xa + xb) / 2, w = xb - xa
    box(w, WIN0, ZW * 2, skin, cx, WIN0 / 2, 0, train)
    box(w, ROOF - WIN1, ZW * 2, skin, cx, (WIN1 + ROOF) / 2, 0, train)
    box(w, 0.12, 0.02, band, cx, WIN0 - 0.14, zo + 0.012, train)
    box(w, 0.06, 0.02, band, cx, WIN1 + 0.12, zo + 0.012, train)
    const n = Math.max(1, Math.round(w / 1.6)), pw = 0.18
    for (let i = 0; i <= n; i++) { const px = xa + (w * i) / n; box(pw, WIN1 - WIN0, ZW * 2, skin, Math.min(xb - pw / 2, Math.max(xa + pw / 2, px)), (WIN0 + WIN1) / 2, 0, train) }
    const g = new THREE.Mesh(new THREE.PlaneGeometry(w, WIN1 - WIN0), glass); g.position.set(cx, (WIN0 + WIN1) / 2, 0.02); train.add(g)
  }
  const dl = -DOOR_W, dr = DOOR_W
  wallSeg(X0 - 0.3, dl - 0.05); wallSeg(dr + 0.05, X1 + 0.3)
  box(DOOR_W * 2 + 0.1, ROOF - DOOR_H, ZW * 2, skin, 0, (DOOR_H + ROOF) / 2, 0, train)   // ドアの上
  box(0.05, DOOR_H, ZW * 2, M({ color: 0x3a3d40 }), dl - 0.025, DOOR_H / 2, 0, train)
  box(0.05, DOOR_H, ZW * 2, M({ color: 0x3a3d40 }), dr + 0.025, DOOR_H / 2, 0, train)
  box(DOOR_W * 2, 0.03, ZW * 2, M({ color: 0x8d9093, metalness: 0.7, roughness: 0.3 }), 0, 0.015, 0, train)   // 敷居
  // ドアの上の行き先と車内表示（オレンジの LED）
  const led = cv(256, 48, (x, w, h) => { x.fillStyle = '#121212'; x.fillRect(0, 0, w, h); x.fillStyle = '#ff9a2a'; x.font = '700 30px "DotGothic16",monospace'; x.textAlign = 'center'; x.fillText('各停 会社前', w / 2, 35) })
  const ledM = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.17), new THREE.MeshBasicMaterial({ map: led })); ledM.position.set(0, DOOR_H + 0.3, zo + 0.01); train.add(ledM)
  const ledIn = ledM.clone(); ledIn.position.set(0, DOOR_H + 0.18, -ZW - 0.01); ledIn.rotation.y = Math.PI; train.add(ledIn)
  // 屋根
  box(X1 - X0 + 0.6, 0.12, -ZF + 0.5, M({ color: 0x9aa0a6 }), 0, ROOF, ZF / 2, train)
  // 隣の車両（同じ形を並べる）
  for (const s of [-1, 1]) {
    const nx = s * (X1 - X0 + 0.9)
    const nb = box(X1 - X0 + 0.6, ROOF, -ZF + 0.3, skin, nx, ROOF / 2, ZF / 2, train)
    box(X1 - X0 + 0.6, 0.12, 0.02, band, nx, WIN0 - 0.14, zo + 0.02, train)
    for (let i = -3; i <= 3; i++) { const g = new THREE.Mesh(new THREE.PlaneGeometry(1.2, WIN1 - WIN0), M({ color: 0x29343c, roughness: 0.1, metalness: 0.3 })); g.position.set(nx + i * 1.8, (WIN0 + WIN1) / 2, zo + 0.03); train.add(g) }
  }
  // ドア（2枚。開いている時は戸袋に入る）
  const doorT = cv(128, 256, (x, w, h) => {
    x.fillStyle = '#cfd3d6'; x.fillRect(0, 0, w, h); for (let i = 0; i < w; i += 3) { x.fillStyle = `rgba(255,255,255,${Math.random() * 0.1})`; x.fillRect(i, 0, 1, h) }
    x.clearRect(18, 34, w - 36, 92); x.fillStyle = 'rgba(40,55,65,.22)'; x.fillRect(18, 34, w - 36, 92); x.fillStyle = 'rgba(255,255,255,.18)'; x.fillRect(22, 38, 12, 84)   // 窓は透ける（閉まった後、押し付けられた顔が見える）
    x.fillStyle = '#e6c33a'; x.fillRect(20, 150, w - 40, 6)
  })
  const doorM = M({ map: doorT, metalness: 0.4, roughness: 0.4, transparent: true, alphaTest: 0.05 })
  const mkDoor = s => { const g = new THREE.Group(); const d = box(DOOR_W, DOOR_H, 0.05, doorM, 0, DOOR_H / 2, 0, g); box(0.035, DOOR_H, 0.07, M({ color: 0x151515, roughness: 1 }), -s * DOOR_W / 2, DOOR_H / 2, 0, g); g.position.z = -0.03; train.add(g); return g }
  W.doorL = mkDoor(-1); W.doorR = mkDoor(1)
  W.setDoor = k => { W.doorL.position.x = -DOOR_W * 1.5 + DOOR_W * k; W.doorR.position.x = DOOR_W * 1.5 - DOOR_W * k }

  // ---------------------------------------------------------------- 車内
  const floorT = cv(128, 128, (x, w, h) => { x.fillStyle = '#7b8088'; x.fillRect(0, 0, w, h); noise(x, w, h, 900, 0.25, '255,255,255'); noise(x, w, h, 900, 0.2) })
  floorT.wrapS = floorT.wrapT = THREE.RepeatWrapping; floorT.repeat.set(12, 3)
  const fl = new THREE.Mesh(new THREE.PlaneGeometry(X1 - X0, -ZF), M({ map: floorT })); fl.rotation.x = -Math.PI / 2; fl.position.set(0, 0.002, ZF / 2); train.add(fl)
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(X1 - X0, -ZF), M({ color: 0xf3f3ef, side: THREE.DoubleSide })); ceil.rotation.x = Math.PI / 2; ceil.position.set(0, CEIL, ZF / 2); train.add(ceil)
  for (const z of [ZF * 0.3, ZF * 0.72]) box(X1 - X0 - 0.6, 0.04, 0.16, new THREE.MeshBasicMaterial({ color: 0xf6fbff }), 0, CEIL - 0.03, z, train)
  // 奥の壁（窓の外は向かいのホーム。発車すると流れる）
  const far = W.farTex = cv(1024, 128, (x, w, h) => {
    x.fillStyle = '#bcc7cf'; x.fillRect(0, 0, w, h)
    for (let i = 0; i < 30; i++) { const bw = 20 + Math.random() * 60, bh = 30 + Math.random() * 80; x.fillStyle = `hsl(210,8%,${55 + Math.random() * 20}%)`; x.fillRect(Math.random() * w, h - bh, bw, bh) }
    x.fillStyle = '#8f8a80'; x.fillRect(0, h - 26, w, 26); x.fillStyle = '#d8b030'; x.fillRect(0, h - 26, w, 4)
    for (let i = 0; i < 40; i++) { x.fillStyle = `hsl(${200 + Math.random() * 40},10%,${20 + Math.random() * 20}%)`; const px = Math.random() * w; x.fillRect(px, h - 52, 7, 26); x.beginPath(); x.arc(px + 3.5, h - 57, 5, 0, 7); x.fill() }
  })
  far.wrapS = THREE.RepeatWrapping; far.repeat.set(2, 1)
  const outside = new THREE.Mesh(new THREE.PlaneGeometry(X1 - X0, WIN1 - WIN0), new THREE.MeshBasicMaterial({ map: far, fog: false })); outside.position.set(0, (WIN0 + WIN1) / 2, ZF - 0.25); train.add(outside)
  const inWall = M({ color: 0xe9e6dc })
  box(X1 - X0, WIN0, 0.08, inWall, 0, WIN0 / 2, ZF - 0.04, train)
  box(X1 - X0, CEIL - WIN1, 0.08, inWall, 0, (WIN1 + CEIL) / 2, ZF - 0.04, train)
  for (let i = 0; i <= 6; i++) box(0.22, WIN1 - WIN0, 0.08, inWall, X0 + (X1 - X0) * i / 6, (WIN0 + WIN1) / 2, ZF - 0.04, train)
  // 長い座席（青）と座っている人は game.js で置く
  const seatM = M({ color: 0x3a5e8a, roughness: 1 })
  box(X1 - X0 - 0.8, 0.12, 0.44, seatM, 0, 0.42, ZF + 0.22, train)
  box(X1 - X0 - 0.8, 0.42, 0.1, seatM, 0, 0.7, ZF + 0.05, train)
  box(X1 - X0 - 0.8, 0.36, 0.4, M({ color: 0x5c6066 }), 0, 0.18, ZF + 0.24, train)
  // 手すりの柱（盤面の POLES と同じ位置）
  const poleM = M({ color: 0xe0b84a, metalness: 0.6, roughness: 0.3 })
  for (const q of POLES) { const p = new THREE.Mesh(new THREE.CylinderGeometry(q.r * S, q.r * S, CEIL, 10), poleM); p.position.set(wx(q.x), CEIL / 2, wz(q.y)); train.add(p) }
  // つり革（2列）。発車で揺れる
  const barM = M({ color: 0xbfc4c8, metalness: 0.7, roughness: 0.3 })
  W.straps = []
  for (const z of [ZF * 0.25, ZF * 0.75]) {
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, X1 - X0 - 0.4, 8), barM); bar.rotation.z = Math.PI / 2; bar.position.set(0, CEIL - 0.12, z); train.add(bar)
    const n = 30, beltG = new THREE.BoxGeometry(0.035, 0.3, 0.012), ringG = new THREE.TorusGeometry(0.075, 0.014, 6, 16)
    const belt = new THREE.InstancedMesh(beltG, M({ color: 0x2d4f8a }), n), ring = new THREE.InstancedMesh(ringG, M({ color: 0xf2f2ee, roughness: 0.5 }), n)
    train.add(belt, ring)
    W.straps.push({ belt, ring, z, n })
  }
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1)
  W.swing = (ang, t) => {
    for (const st of W.straps) for (let i = 0; i < st.n; i++) {
      const x = X0 + 0.5 + (X1 - X0 - 1) * i / (st.n - 1), a = ang + Math.sin(t * 1.7 + i * 0.9) * 0.04
      _e.set(0, 0, a); _q.setFromEuler(_e)
      _p.set(x + Math.sin(a) * 0.15, CEIL - 0.12 - Math.cos(a) * 0.15, st.z); _m.compose(_p, _q, _s); st.belt.setMatrixAt(i, _m)
      _p.set(x + Math.sin(a) * 0.37, CEIL - 0.12 - Math.cos(a) * 0.37, st.z); _e.set(0, 0, a); _q.setFromEuler(_e); _m.compose(_p, _q, _s); st.ring.setMatrixAt(i, _m)
    }
    for (const st of W.straps) { st.belt.instanceMatrix.needsUpdate = true; st.ring.instanceMatrix.needsUpdate = true }
  }
  W.swing(0, 0)
  // 中吊り広告（題材の小ネタ。実在の名前は使わない）
  const ads = [['週刊 満員', '押す人 押される人', '#c23b2b'], ['肩甲骨の休め方', '吊り革整体', '#2b5aa0'], ['朝の香水は', '1プッシュまで', '#8a4a7c'], ['リュックは前に', 'マナー向上月間', '#3d7a3a']]
  ads.forEach(([a, b, c], i) => {
    const t = cv(256, 128, (x, w, h) => { x.fillStyle = '#faf8f2'; x.fillRect(0, 0, w, h); x.fillStyle = c; x.fillRect(0, 0, 18, h); x.fillStyle = '#1b1b1b'; x.font = '900 34px "M PLUS 1p",sans-serif'; x.fillText(a, 30, 54); x.fillStyle = c; x.font = '700 22px "M PLUS 1p",sans-serif'; x.fillText(b, 30, 98) })
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.38), M({ map: t, side: THREE.DoubleSide, roughness: 0.6 }))
    m.position.set(-3 + i * 2, CEIL - 0.28, ZF * 0.5); train.add(m)
  })
  // 車体の下の暗がり（ホームの縁の下）
  box(60, 1.2, 0.6, M({ color: 0x24221f }), 0, -0.6, 0.2, scene)
  // 遊び中は屋根・天井・幕板・つり革・広告を切り取って、上から車内とドアの隙間を見せる
  W.cut = []
  train.traverse(o => { if (o.isMesh && o !== outside && Math.abs(o.position.x) < (X1 - X0) / 2 + 0.5 && (o.position.y > 1.88 || o.isInstancedMesh)) W.cut.push(o) })
  return W
}
