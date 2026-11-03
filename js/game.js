// 満員電車に乗り込め。押し合いは phys.js（前作の 2D Verlet）、表示はここで three.js の斜め後ろ視点にする（v2。初版は主観）
import * as THREE from 'three'
import { World, T as PT, STEP, ROUND, CAR, GC, mid, botInput } from './phys.js?v=2'
import { buildWorld, S, wx, wz } from './world.js?v=2'
import { loadPeople, lookOf, Pool, Person, assets } from './people.js?v=2'

const $ = id => document.getElementById(id)
const TX = window.RH_TEXT, LINES = window.RH_LINES
const coarse = matchMedia('(pointer: coarse)').matches
const LOW = coarse || Math.min(screen.width, screen.height) < 700
const MAXV = LOW ? 22 : 34          // 動かして描く人数（近い順）
const EYE = 1.2                      // 目の高さ（人は身長 約1.45m のデフォルメ）
const SXZ = 1.45, SY = 1.95          // Kenney Mini（身長0.72・横幅0.77）。横は盤面の肩幅に合わせ、縦は少し伸ばす

let lang = /^ja/.test(navigator.language || 'ja') ? 'ja' : 'en'
try { const l = localStorage.getItem('rh_lang'); if (l) lang = l } catch (e) {}
let muted = false
try { muted = localStorage.getItem('rh_mute') === '1' } catch (e) {}
const t = k => TX[lang][k]

// ---------------------------------------------------------------- 描画の土台
const renderer = new THREE.WebGLRenderer({ antialias: !LOW, powerPreference: 'high-performance', preserveDrawingBuffer: false })
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, LOW ? 1.25 : 2))
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05
$('view').appendChild(renderer.domElement)
const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 60)
camera.rotation.order = 'YXZ'
scene.add(camera)

// 読み込みの進み具合（本物の読み込み数）
const manager = new THREE.LoadingManager()
let loadFrac = 0
manager.onProgress = (url, a, b) => { loadFrac = a / Math.max(1, b); $('loadBar').style.width = Math.round(loadFrac * 100) + '%' }
$('loadText').textContent = t('loading')

const W = buildWorld(scene, { low: LOW })
const pool = new Pool(scene, SXZ, SY)

// 座っている人（座席の上。電車と一緒に動く）
const seated = []
function placeSeated() {
  const looks = ['female-f', 'male-d', 'female-d', 'female-e', 'male-f', 'female-e', 'male-d', 'female-d', 'male-f', 'female-e']
  for (let i = 0; i < looks.length; i++) {
    const p = new Person({ key: 'seat' + i, file: looks[i], tint: [0xffffff, 0xd8dce4, 0xc8ccd6][i % 3] }, SXZ, SY)
    p.play('sit', 0); p.mixer.update(0.5 + i * 0.13)
    p.group.position.set(-6.2 + i * 1.3, 0.12, wz(CAR.t) + 0.5)
    W.train.add(p.group); seated.push(p)
  }
}

// ---------------------------------------------------------------- 音（録音素材だけ）
Snd.def({
  cloth: ['snd/cloth1.mp3', 'snd/cloth2.mp3', 'snd/cloth3.mp3', 'snd/cloth4.mp3'],
  grunt: ['snd/grunt1.mp3', 'snd/grunt2.mp3', 'snd/grunt3.mp3'],
  slam: ['snd/slam1.mp3', 'snd/slam2.mp3'], metal: 'snd/metal1.mp3', thud: ['snd/thud1.mp3', 'snd/thud2.mp3'],
  step: ['snd/step1.mp3', 'snd/step2.mp3', 'snd/step3.mp3'],
  bell: 'snd/bell.mp3', doors: 'snd/doors.mp3', depart: 'snd/depart.mp3', chime: 'snd/chime.mp3',
  win: 'snd/win.mp3', lose: 'snd/lose.mp3', click: 'snd/click.mp3',
})
Snd.setMute(muted)
const sfx = (n, o) => Snd.play(n, o)
let ambOn = false
function audioOn() { Snd.init(); if (!ambOn) { ambOn = true; Snd.loop('amb', 'snd/amb_platform.mp3', 0.16) } }

// ---------------------------------------------------------------- 状態
let mode = 'loading', w = null, paused = false
let hitStop = 0, fovKick = 0, shake = 0, flashA = 0, squeezeK = 0, camYaw = 0, glance = 0, knock = 0, pushedEver = false, moved = false
let annText = '', annT = 0, hintShown = false, resultAt = 0, stepT = 0
const say = { el: $('say'), body: null, t: 0 }
let testInput = null

function announce(k, sec = 2.6) { annText = typeof k === 'string' && TX[lang].ann[k] ? TX[lang].ann[k] : k; annT = sec }
function bubble(body, line, cls = '') {
  if (!body || say.t > 0.25) return false
  say.body = body; say.el.textContent = line; say.el.className = 'say ' + cls; say.t = 0.9 + line.length * 0.09 + 0.4
  return true
}
const pickLine = (kind, n) => { const a = LINES[lang][kind] || LINES[lang].commuter; return a[n % a.length] }

// ---------------------------------------------------------------- 入力
const keys = new Set(); let pushBuf = 0, grabOn = false
const stick = { x: 0, y: 0, id: null, ox: 0, oy: 0 }
addEventListener('keydown', e => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault()
  keys.add(e.code); audioOn()
  if (mode === 'play' && !e.repeat && (e.code === 'Space' || e.code === 'KeyF' || e.code === 'Enter')) pushBuf = 40
  if (mode === 'play' && e.code === 'Escape') toTitle()
  if (mode === 'result' && !e.repeat && (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyR')) start()
})
addEventListener('keyup', e => keys.delete(e.code))
addEventListener('blur', () => keys.clear())
const sz = $('stickZone'), stEl = $('stick'), knob = stEl.querySelector('.knob')
sz.addEventListener('pointerdown', e => { audioOn(); stick.id = e.pointerId; stick.ox = e.clientX; stick.oy = e.clientY; stEl.style.left = e.clientX + 'px'; stEl.style.top = e.clientY + 'px'; stEl.classList.remove('hidden'); try { sz.setPointerCapture(e.pointerId) } catch (er) {} })
sz.addEventListener('pointermove', e => {
  if (e.pointerId !== stick.id) return
  let dx = e.clientX - stick.ox, dy = e.clientY - stick.oy; const d = Math.hypot(dx, dy), R = 50
  if (d > R) { dx *= R / d; dy *= R / d }
  stick.x = dx / R; stick.y = -dy / R; knob.style.transform = `translate(${dx}px,${dy}px)`
})
const stickEnd = e => { if (e.pointerId !== stick.id) return; stick.id = null; stick.x = stick.y = 0; knob.style.transform = ''; stEl.classList.add('hidden') }
sz.addEventListener('pointerup', stickEnd); sz.addEventListener('pointercancel', stickEnd)
const bp = $('btnPush')
bp.addEventListener('pointerdown', e => { e.preventDefault(); audioOn(); if (mode === 'play') pushBuf = 40; bp.classList.add('on') })
for (const n of ['pointerup', 'pointercancel', 'pointerleave']) bp.addEventListener(n, () => bp.classList.remove('on'))
// つかむ: スマホはスイッチ式（1回でつかむ・もう1回で離す。離した時に進んでいれば投げる）。PC は G か Shift を押している間
const bg = $('btnGrab')
function setGrab(on) { grabOn = on; bg.classList.toggle('on', on) }
bg.addEventListener('pointerdown', e => { e.preventDefault(); audioOn(); if (mode === 'play') setGrab(!grabOn) })

function gather() {
  if (testInput) return testInput
  let sx = stick.x, sy = stick.y
  if (keys.has('KeyA') || keys.has('ArrowLeft')) sx -= 1
  if (keys.has('KeyD') || keys.has('ArrowRight')) sx += 1
  if (keys.has('KeyW') || keys.has('ArrowUp')) sy += 1
  if (keys.has('KeyS') || keys.has('ArrowDown')) sy -= 1
  const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw), rx = Math.cos(camYaw), rz = -Math.sin(camYaw)
  const p = w.player, ready = p.shoveCd <= 0
  const shove = pushBuf > 0 && ready
  if (shove) pushBuf = 0
  const grab = grabOn || keys.has('KeyG') || keys.has('ShiftLeft') || keys.has('ShiftRight')
  return { x: rx * sx + fx * sy, y: rz * sx + fz * sy, shove, grab, face: { x: fx, y: fz } }
}

// ---------------------------------------------------------------- 1回の流れ
function newWorld(seed, opts) { w = new World(seed ?? Math.floor(Math.random() * 1e9), opts || {}); for (const [b, p] of vis) pool.give(p); vis.clear() }
function toTitle() {
  mode = 'title'; newWorld(); camYaw = 0; glance = 0
  show('title'); $('hud').classList.add('hidden')
  W.train.position.x = 0; W.setDoor(0)
}
function start(seed, opts) {
  audioOn()
  newWorld(seed, opts)
  mode = 'play'; paused = false; hitStop = fovKick = shake = flashA = squeezeK = knock = glance = 0; camYaw = 0; pushedEver = false; moved = false; resultAt = 0; hintShown = false
  say.t = 0; say.body = null; say.el.classList.add('hidden'); annT = 0; $('fxFlash').classList.remove('red'); pushBuf = 0; setGrab(false)
  show(null); $('hud').classList.remove('hidden'); $('touch').classList.toggle('hidden', !coarse)
  announce('start', 2.6)
  sfx('click', { vol: 0.5 })
}
function show(id) { for (const s of ['title', 'how', 'result']) $(s).classList.toggle('hidden', s !== id) }

function onEvent(e) {
  const L = TX[lang]
  switch (e.t) {
    case 'shove': {
      pushedEver = true
      sfx('cloth', { vol: 0.9 }); sfx('grunt', { vol: 0.55, delay: 0.03 })
      hitStop = Math.max(hitStop, 0.045); fovKick = -6; squeezeK = 1; shake = Math.max(shake, 0.12)
      const o = e.top
      if (o && o.sayCd <= 0) {
        const always = o.type === 'dufu' || o.type === 'sleep' || o.type === 'pack' || o.type === 'perfume'
        if (always || Math.random() < 0.55) { if (bubble(o, pickLine(o.type === 'player' ? 'commuter' : o.type, o.shoveSay = (o.shoveSay || 0) + o.id), o.type === 'dufu' ? 'dufu' : '')) o.sayCd = 150 }
      }
      break
    }
    case 'grab': {
      pushedEver = true
      const o = e.target
      sfx('cloth', { vol: 0.8, rate: 0.85 }); squeezeK = Math.max(squeezeK, 0.5); shake = Math.max(shake, 0.08)
      if (o.sayCd <= 0 && bubble(o, pickLine('g_' + o.type, w.step + o.id), o.type === 'dufu' ? 'dufu' : '')) o.sayCd = 120
      break
    }
    case 'release':
      if (e.thrown) { sfx('thud', { vol: 0.8 }); sfx('grunt', { vol: 0.6, delay: 0.05 }); hitStop = Math.max(hitStop, 0.06); shake = Math.max(shake, 0.3); fovKick = -4 }
      setGrab(false)
      break
    case 'grabFail':
      if (e.target) bubble(e.target, pickLine(e.target.type === 'vip' ? 'g_vip' : 'g_staff', w.step))
      setGrab(false)
      break
    case 'yield': if (Math.random() < 0.5) bubble(e.b, pickLine('yield', e.b.id)); break
    case 'vip': announce('vip', 2.8); break
    case 'staff': announce('staff', 2.4); sfx('step', { vol: 0.6 }); break
    case 'staffPush': if (w.staff) bubble(w.staff, pickLine('staff', w.step)); shake = Math.max(shake, 0.2); break
    case 'bell': Snd.play('bell', { vol: 0.75, offset: 1.9, jitter: 0 }); break
    case 'closing': announce('closing', 3); sfx('chime', { vol: 0.6, jitter: 0 }); break
    case 'doorMove': sfx('doors', { vol: 0.8, offset: 0.65, jitter: 0 }); break
    case 'caught':
      announce('caught', 3.2)
      sfx('slam', { vol: 1 }); sfx('metal', { vol: 0.9, delay: 0.02 })
      hitStop = 0.14; shake = 1.1; flashA = 1; $('fxFlash').classList.add('red'); fovKick = 10; squeezeK = 1.4
      break
    case 'eject': sfx('thud', { vol: 0.9 }); knock = 1; shake = Math.max(shake, 0.6); break
    case 'closed':
      sfx('slam', { vol: 0.85 })
      if (e.in) { announce('inside', 2.2); hitStop = 0.1; shake = 0.6; flashA = 1; $('fxFlash').classList.remove('red'); fovKick = -7; glance = 0.001 }
      else { setTimeout(() => announce('gone', 3), 900) }
      setTimeout(() => sfx('depart', { vol: 0.8, jitter: 0 }), 500)
      break
  }
}

function stepOnce() {
  if (!w) return
  if (mode === 'title') return
  if (mode !== 'play' && mode !== 'result') return
  if (pushBuf > 0) pushBuf--
  const inp = mode === 'play' ? (window.__bot ? botInput(w, window.__bot) : gather()) : null
  if (inp && Math.hypot(inp.x, inp.y) > 0.3) moved = true
  w.tick(inp)
  for (const e of w.ev) onEvent(e)
  w.ev.length = 0
  if (w.result && !resultAt) resultAt = performance.now() + 1100
}

// ---------------------------------------------------------------- 描く人を選ぶ・動かす
const vis = new Map()   // body から Person
const _v = new THREE.Vector3()
let pickN = 0
function choosePeople() {
  // 自分のまわりから近い順（カメラは後ろにいるので、自分の位置で選ぶ）
  const pm = mid(w.player), off = w.trainX * S
  const px = wx(pm.x) + (w.player.core[0].frozen ? off : 0), pz = wz(pm.y)
  const arr = []
  for (const b of w.bodies) {
    if (b === w.player) continue
    const c = mid(b), x = wx(c.x) + (b.core[0].frozen ? off : 0), z = wz(c.y)
    const dx = x - px, dz = z - pz
    arr.push([dx * dx + dz * dz * 1.4, b])
  }
  arr.sort((a, b) => a[0] - b[0])
  const want = new Set(arr.slice(0, MAXV).map(a => a[1]))
  for (const [b, p] of vis) if (!want.has(b)) { p.setFade(1); pool.give(p); vis.delete(b) }
  let rank = 0
  for (const [, b] of arr.slice(0, MAXV)) { if (!vis.has(b)) vis.set(b, pool.take(lookOf(b))); vis.get(b).rank = rank++ }
}
function poseBody(b, p, dt, frozenOff) {
  const c = mid(b), g = p.group
  g.position.set(wx(c.x) + frozenOff, 0, wz(c.y))
  // 肩の線から向き（体の前）を出す
  const sx = b.ls.x - b.rs.x, sy = b.ls.y - b.rs.y, sl = Math.hypot(sx, sy) || 1
  g.rotation.y = Math.atan2(sy / sl, -sx / sl)
  // 押されたら押された向きに傾く
  const lx = Math.max(-0.3, Math.min(0.3, b.vx * 0.12)), lz = Math.max(-0.3, Math.min(0.3, b.vy * 0.12)), ry = g.rotation.y
  p.lean.rotation.set(lx * Math.sin(ry) + lz * Math.cos(ry), 0, -(lx * Math.cos(ry) - lz * Math.sin(ry)))
  // ふらついている（投げられた・離された）人は大きく揺れる
  if (b.held > 4 && b !== w.player) p.lean.rotation.z += Math.sin(performance.now() / 110 + b.id) * 0.22
}
const _cp = new THREE.Vector3()
function updatePeople(dt) {
  if (pickN++ % 4 === 0) choosePeople()
  const off = w.trainX * S
  // カメラと自分の間にいる人・カメラに近い人は透かす（混んでいても自分とドアが見える）
  const pm = mid(w.player), px = wx(pm.x) + (w.player.core[0].frozen ? off : 0), pz = wz(pm.y)
  const cx = camera.position.x, cz = camera.position.z, sx = px - cx, sz = pz - cz, sl2 = sx * sx + sz * sz || 1
  for (const [b, p] of vis) {
    const fo = b.core[0].frozen ? off : 0
    poseBody(b, p, dt, fo)
    const gx = p.group.position.x - cx, gz = p.group.position.z - cz
    const t = (gx * sx + gz * sz) / sl2, lat = Math.abs(gx * sz - gz * sx) / Math.sqrt(sl2)
    let fade = 1
    if (mode !== 'title' && t > -0.2 && t < 0.92 && lat < 0.75) fade = 0.2
    if (gx * gx + gz * gz < 0.8) fade = 0
    p.setFade(fade)
    const sp = Math.hypot(b.vx, b.vy)
    if (b.kind === 'staff' && b.pushing) p.play('holding-both')
    else if (b.held > 4 && b !== w.player) p.play('emote-no')
    else if (sp > 0.55 && !b.core[0].frozen) p.play('walk')
    else p.play('idle')
    if (p.cur) p.cur.timeScale = b.type === 'sleep' ? 0.35 : 1
    const every = p.rank < 12 ? 1 : 3   // 遠い人のアニメは間引く
    p.acc += dt
    if ((pickN + b.id) % every === 0) { p.mixer.update(p.acc); p.acc = 0 }
    if (b.type === 'sleep' && p.bones.head) p.bones.head.rotation.x = 0.55 + Math.sin(performance.now() / 900) * 0.05
  }
  // 自分
  const me = w.player
  if (!meModel) { meModel = new Person({ key: 'me', file: 'female-b', tint: 0xffffff }, SXZ, SY); scene.add(meModel.group); meModel.group.add(meRing) }
  poseBody(me, meModel, dt, me.core[0].frozen ? off : 0)
  meModel.group.visible = mode !== 'title'
  if (me.shoveAnim > 0) meModel.play('attack-melee-right', 0.05)
  else if (me.grab) meModel.play('holding-both', 0.12)
  else if (Math.hypot(me.vx, me.vy) > 0.4) meModel.play('walk')
  else meModel.play('idle')
  meModel.mixer.update(dt * (me.shoveAnim > 0 ? 1.6 : 1))
  meRing.material.opacity = 0.75 + Math.sin(performance.now() / 200) * 0.2
  // つかんでいる人の足もとに輪
  grabRing.visible = !!me.grab
  grabMark.visible = !!me.grab
  if (me.grab) { const c = mid(me.grab.target.body); grabRing.position.set(wx(c.x), 0.03, wz(c.y)); grabMark.position.set(wx(c.x), 1.85 + Math.sin(performance.now() / 120) * 0.04, wz(c.y)); grabMark.rotation.y += 0.05 }
}
let meModel = null
const meRing = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.55, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x2fd18a, transparent: true, opacity: 0.85, depthWrite: false, depthTest: false }))
meRing.renderOrder = 20   // 人に隠れても自分の足もとが分かるように手前に描く
meRing.position.y = 0.03
const grabRing = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.6, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff9a2a, transparent: true, opacity: 0.95, depthWrite: false }))
grabRing.visible = false; scene.add(grabRing)
// つかんでいる人の頭の上の目印（人に隠れないよう手前に描く）
const grabMark = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.26, 4).rotateX(Math.PI), new THREE.MeshBasicMaterial({ color: 0xff9a2a, depthTest: false }))
grabMark.renderOrder = 21; grabMark.visible = false; scene.add(grabMark)

// ---------------------------------------------------------------- カメラ（自分の斜め後ろ・高め）
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3()
let camInit = false
function updateCamera(dt) {
  const p = w.player, off = p.core[0].frozen ? w.trainX * S : 0
  const asp = innerWidth / innerHeight
  // 向き: 押す向き・進む向きに少しだけ振る。大きくは回さない（いつもドアと車内が前）
  const d = p.dir, want = Math.max(-0.42, Math.min(0.42, Math.atan2(-d.x, -d.y))) * 0.5
  if (mode === 'play' || mode === 'result') camYaw += (want - camYaw) * (1 - Math.exp(-dt * 2.4))
  knock = Math.max(0, knock - dt * 0.8)
  window.__crowd = mode === 'play' ? w.crowdAt(p) : 0
  const crowd = window.__crowd
  const W_ = W
  if (mode === 'title') {
    camera.position.set(wx(GC), EYE + 0.05, wz(CAR.wall + 210)); camera.rotation.set(-0.11, 0, 0); camInit = false
    camera.fov = asp >= 1 ? 66 : Math.min(86, 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(34)) / asp) * 180 / Math.PI)
    camera.aspect = asp; camera.updateProjectionMatrix()
    W_.cut.forEach(o => o.visible = true)
    return
  }
  // 屋根・天井・つり革は切り取る（上から車内とドアの隙間が見えるように）
  W_.cut.forEach(o => o.visible = false)
  const m = mid(p), px = wx(m.x) + off, pz = wz(m.y)
  const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw)
  const port = asp < 1
  // 混むほど少し上から見下ろす。乗った後は引いて電車ごと見せる
  const ride = w.phase !== 'play' && p.outcome === 'in' ? Math.min(1, w.departT / 120) : 0
  const back = (port ? 3.0 : 2.6) + ride * 1.6, up = (port ? 3.3 : 2.75) + Math.min(0.5, crowd * 0.025) + ride * 1.2 + knock * 0.6
  _v.set(px - fx * back, Math.min(4.2, up), pz - fz * back)
  const lk = _cp.set(px + fx * (port ? 1.0 : 1.4), 0.55, pz + fz * (port ? 1.0 : 1.4))
  if (!camInit) { camPos.copy(_v); camLook.copy(lk); camInit = true }
  camPos.lerp(_v, 1 - Math.exp(-dt * 6)); camLook.lerp(lk, 1 - Math.exp(-dt * 8))
  camera.position.copy(camPos)
  if (shake > 0) camera.position.add(_v.set((Math.random() - 0.5) * shake * 0.12, (Math.random() - 0.5) * shake * 0.1, (Math.random() - 0.5) * shake * 0.08))
  camera.lookAt(camLook)
  if (w.phase === 'depart' && p.core[0].frozen) camera.rotateZ(Math.sin(performance.now() / 700) * 0.006 * Math.min(1, w.trainV / 3))
  // 視野: 縦長はたてに広げる。混んでいるほど狭く（ぎゅっと）。押した瞬間に一瞬ズーム
  const base = asp >= 1 ? 56 : Math.min(84, 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(32)) / asp) * 180 / Math.PI)
  const fov = base - Math.min(6, Math.max(0, crowd - 6) * 0.4)
  fovKick *= Math.exp(-dt * 7)
  camera.fov = fov + fovKick; camera.aspect = asp; camera.updateProjectionMatrix()
  $('fxVig').style.opacity = mode === 'play' ? Math.min(0.6, Math.max(0, (crowd - 6) / 20)).toFixed(2) : '0'
  // 香水のきつい人に近いと画面がうっすら紫
  let pf = 0
  if (mode === 'play') for (const b of w.bodies) if (b.type === 'perfume') { const c = mid(b), dd = Math.hypot(c.x - p.head.x, c.y - p.head.y); pf = Math.max(pf, Math.min(1, (130 - dd) / 80)) }
  window.__perfume = pf
  $('fxPerfume').style.opacity = Math.max(0, pf * 0.75).toFixed(2)
}

// ---------------------------------------------------------------- 画面の文字
function updateHud(dt) {
  const L = TX[lang]
  if (annT > 0) annT -= dt
  else if (mode === 'play' && !hintShown && w.step > 170 && !pushedEver) { hintShown = true; announce(coarse ? L.hintTouch : L.hintPc, 3.2) }
  const secs = Math.max(0, Math.ceil((ROUND - w.step) / 60))
  $('ledText').textContent = annT > 0 ? annText : L.led.dest
  $('ledText').classList.toggle('dest', !(annT > 0))
  $('ledSec').textContent = w.phase === 'play' ? L.led.left(secs) : ''
  $('touch').classList.toggle('hidden', !coarse || w.phase !== 'play')
  $('led').classList.toggle('warn', secs <= 5 && w.phase === 'play')
  // 吹き出し: 話している人の頭の上
  if (say.t > 0) {
    say.t -= dt
    const b = say.body, p = b && vis.get(b)
    let ok = false
    if (p && p.group.visible) {
      _v.set(p.group.position.x, 1.62, p.group.position.z).project(camera)
      if (_v.z < 1 && Math.abs(_v.x) < 1.05 && Math.abs(_v.y) < 1.1) {
        ok = true
        const x = (_v.x * 0.5 + 0.5) * innerWidth, y = (-_v.y * 0.5 + 0.5) * innerHeight
        const hw = say.el.offsetWidth / 2 + 8
        say.el.style.left = Math.max(hw, Math.min(innerWidth - hw, x)) + 'px'
        say.el.style.top = Math.max(110, Math.min(innerHeight - 40, y)) + 'px'
      }
    }
    say.el.classList.toggle('hidden', !ok || say.t <= 0)
  } else say.el.classList.add('hidden')
}

// ---------------------------------------------------------------- 結果（定期券 / 遅延証明書）
function drawTicket() {
  const r = w.result, L = TX[lang], cv = $('ticket'), x = cv.getContext('2d')
  const win = r.outcome === 'in', CW = 640, CH = 404
  cv.width = CW; cv.height = CH
  const side = innerHeight < 560 && innerWidth > innerHeight   // 背の低い横画面はボタンを右に並べる
  const aw = innerWidth - (side ? 275 : 28), ah = innerHeight - (side ? 30 : 150)
  const k = Math.min(1, aw / CW, ah / CH, 560 / CW)
  cv.style.width = Math.round(CW * k) + 'px'; cv.style.height = Math.round(CH * k) + 'px'
  const F = (wt, px) => `${wt} ${px}px "M PLUS 1p","Hiragino Sans",sans-serif`
  const date = new Date(), ds = `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`
  const stamp = (cx, cy, txt, rot) => {
    x.save(); x.translate(cx, cy); x.rotate(rot); x.strokeStyle = 'rgba(200,30,30,.85)'; x.fillStyle = 'rgba(200,30,30,.85)'
    x.lineWidth = 5; x.beginPath(); x.arc(0, 0, 50, 0, 7); x.stroke(); x.lineWidth = 2; x.beginPath(); x.arc(0, 0, 42, 0, 7); x.stroke()
    x.font = F(900, txt.length > 2 ? 22 : 32); x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(txt, 0, 2); x.restore()
  }
  if (win) {
    const P = L.pass
    x.fillStyle = '#f1ece0'; x.beginPath(); x.roundRect(0, 0, CW, CH, 10); x.fill()
    x.save(); x.clip(); x.strokeStyle = 'rgba(22,121,79,.16)'; x.lineWidth = 1
    for (let yy = 70; yy < CH; yy += 9) { x.beginPath(); for (let xx = 0; xx <= CW; xx += 8) x.lineTo(xx, yy + Math.sin(xx / 26 + yy / 40) * 4); x.stroke() }
    x.fillStyle = '#16794f'; x.fillRect(0, 0, CW, 64); x.restore()
    x.fillStyle = '#fff'; x.font = F(900, 30); x.textBaseline = 'middle'; x.fillText(P.head, 28, 33)
    x.font = F(800, 18); x.textAlign = 'right'; x.fillText(ds, CW - 26, 34); x.textAlign = 'left'
    x.fillStyle = '#1b1b1b'; x.font = F(900, 44); x.fillText(P.route, 28, 116)
    x.font = F(800, 20); x.fillStyle = '#2d3a33'; x.fillText(P.via, 30, 162); x.fillText(P.valid, 30, 192)
    x.fillText(P.shoves(r.shoves), 30, 222)
    x.fillStyle = '#16794f'; x.font = F(800, 22); x.fillText(P.rate, 30, 300)
    x.fillStyle = '#1b1b1b'; x.font = '400 92px "DotGothic16",monospace'; x.fillText(r.rate + '%', 120, 300)
    stamp(CW - 92, CH - 96, P.stamp, -0.25)
  } else {
    const C = L.cert
    x.fillStyle = '#fbf8ef'; x.fillRect(0, 0, CW, CH)
    x.strokeStyle = '#3a3a3a'; x.lineWidth = 2; x.strokeRect(14, 14, CW - 28, CH - 28)
    x.fillStyle = '#1b1b1b'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = F(900, 38); x.fillText(C.head, CW / 2, 64)
    x.fillRect(CW / 2 - 130, 92, 260, 2); x.fillRect(CW / 2 - 130, 98, 260, 2)
    x.textAlign = 'left'; x.font = F(800, 21)
    const body = C.body(r.rate), lines = wrap(x, body, CW - 110)
    lines.forEach((l, i) => x.fillText(l, 52, 140 + i * 32))
    const why = r.outcome === 'ejected' ? 'ejected' : (!moved && !r.shoves ? 'idle' : 'left')
    x.fillStyle = '#b8231c'; x.font = F(900, 22); x.fillText(C.why[why], 52, 150 + lines.length * 32 + 16)
    x.fillStyle = '#444'; x.font = F(800, 18); x.fillText(C.note, 52, CH - 66); x.fillText(ds, 52, CH - 40)
    stamp(CW - 104, CH - 92, C.stamp, 0.18)
  }
  // ポスト
  const txt = (win ? L.postIn : L.postOut)(r.rate) + ' ' + L.tags
  $('btnPost').href = 'https://x.com/intent/post?text=' + encodeURIComponent(txt) + '&url=' + encodeURIComponent('https://tom3games.github.io/rush-hour-train/')
}
function wrap(x, s, maxW) {
  const out = []; let cur = ''
  const parts = /\s/.test(s) && !/[ぁ-んァ-ン一-龥]/.test(s) ? s.split(/(\s+)/) : [...s]
  for (const ch of parts) { if (x.measureText(cur + ch).width > maxW && cur) { out.push(cur.trim()); cur = ch.trimStart() } else cur += ch }
  if (cur) out.push(cur.trim())
  return out
}
function showResult() {
  mode = 'result'
  $('hud').classList.add('hidden')
  drawTicket(); show('result')
  sfx(w.result.outcome === 'in' ? 'win' : 'lose', { vol: 0.8, jitter: 0 })
}

// ---------------------------------------------------------------- ループ（固定60Hz）
function resize() { renderer.setSize(innerWidth, innerHeight, false); if (mode === 'result' && w && w.result) drawTicket() }
addEventListener('resize', resize); resize()
let last = performance.now(), acc = 0, dbgPause = false, frameN = 0
function frame() {
  requestAnimationFrame(frame)
  const now = performance.now()
  let dt = Math.min(0.1, (now - last) / 1000); last = now
  if (mode === 'loading') return
  if (hitStop > 0) { hitStop -= dt; acc = 0 }
  else if (!dbgPause) { acc += dt * 1000; let n = 0; while (acc >= STEP && n < 4) { stepOnce(); acc -= STEP; n++ } if (n >= 4) acc = 0 }
  render(dbgPause ? 0 : dt)
  if (mode === 'play' && resultAt && now >= resultAt) showResult()
}
function render(dt) {
  if (!w) return
  W.setDoor(w.door)
  W.train.position.x = w.trainX * S
  W.swing(w.phase === 'depart' ? Math.min(0.35, w.trainV * 0.06) * Math.min(1, w.departT / 60) : 0, performance.now() / 1000)
  if (w.phase === 'depart' && w.player.core[0].frozen) W.farTex.offset.x = -w.trainX * S * 0.02
  updateCamera(dt)
  updatePeople(dt)
  if (mode === 'play' || mode === 'result') updateHud(dt)
  // 演出の減衰
  shake = Math.max(0, shake - dt * 2.4)
  flashA = Math.max(0, flashA - dt * 2.8); $('fxFlash').style.opacity = flashA.toFixed(2)
  squeezeK = Math.max(0, squeezeK - dt * 6)
  const sq = squeezeK > 1 ? 1 : squeezeK
  $('squeeze').style.transform = sq > 0.001 ? `scale(${(1 - 0.06 * sq).toFixed(3)},${(1 - 0.025 * sq).toFixed(3)})` : ''
  // 足音
  if (mode === 'play') { stepT -= dt; const p = w.player; if (Math.hypot(p.vx, p.vy) > 0.6 && stepT <= 0) { stepT = 0.36; sfx('step', { vol: 0.35 }) } }
  renderer.render(scene, camera)
  frameN++
}

// ---------------------------------------------------------------- 画面のボタン
function applyLang() {
  document.documentElement.lang = lang
  for (const el of document.querySelectorAll('[data-t]')) { const v = TX[lang][el.dataset.t]; if (typeof v === 'string') el.textContent = v }
  $('howList').innerHTML = TX[lang].how.map(h => `<li>${h[0]}</li>`).join('')
  $('howKeys').textContent = coarse ? TX[lang].keysTouch : TX[lang].keysPc
  $('btnMute').textContent = muted ? TX[lang].sndOff : TX[lang].sndOn
  $('loadText').textContent = TX[lang].loading
}
$('btnStart').onclick = () => start()
$('btnHow').onclick = () => { audioOn(); show('how') }
$('btnOk').onclick = () => show('title')
$('btnLang').onclick = () => { lang = lang === 'ja' ? 'en' : 'ja'; try { localStorage.setItem('rh_lang', lang) } catch (e) {} applyLang() }
$('btnMute').onclick = () => { muted = !muted; Snd.setMute(muted); try { localStorage.setItem('rh_mute', muted ? '1' : '0') } catch (e) {} applyLang() }
$('btnAgain').onclick = () => start()
$('btnTitle').onclick = () => toTitle()
$('btnQuit').onclick = () => toTitle()
$('btnSave').onclick = () => { $('ticket').toBlob(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'rush-hour-train.png'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000) }) }
applyLang()

// ---------------------------------------------------------------- 検証用の窓口
window.rh = {
  get mode() { return mode }, get w() { return w }, PT, camera, renderer, LOW, MAXV, THREE, W, get me() { return meModel }, get peopleShown() { return [...vis.values()] },
  start, toTitle, showResult, setLang: l => { lang = l; applyLang() }, get lang() { return lang },
  get visCount() { return vis.size }, get pool() { return pool.made },
  dbg: {
    pause: on => { dbgPause = on }, step: n => { for (let i = 0; i < n; i++) stepOnce(); render(STEP / 1000) },
    input: v => { testInput = v }, bot: mode => { testInput = null; window.__bot = mode }, push: () => { pushBuf = 40 },
    render: () => render(0), runToEnd: () => { let g = 0; while (mode === 'play' && !w.result && g++ < 4000) stepOnce(); if (w.result) showResult() },
    get state() { return { hitStop, fovKick, shake, flashA, squeezeK, glance, crowd: window.__crowd, perfume: window.__perfume, ann: annText, annT, say: say.t > 0 ? say.el.textContent : '' } },
    botInput: m => botInput(w, m),
  },
}

// ---------------------------------------------------------------- 起動
// 字の読み込みは待ちすぎない（回線が遅いと止まって見える。最大2.5秒）
const fontsReady = Promise.race([document.fonts ? document.fonts.ready.catch(() => {}) : Promise.resolve(), new Promise(r => setTimeout(r, 2500))])
Promise.all([loadPeople(manager), fontsReady]).then(() => {
  placeSeated()
  toTitle()
  for (let i = 0; i < 3; i++) render(0.016)   // シェーダを先に作っておく
  $('loadBar').style.width = '100%'
  $('loading').classList.add('out')
  setTimeout(() => { $('loading').classList.add('hidden'); window.__rhReady = true }, 380)
}).catch(e => { $('loadText').textContent = 'ERROR'; console.error(e) })
requestAnimationFrame(frame)
