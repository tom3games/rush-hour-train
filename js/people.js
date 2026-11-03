// 乗客の見た目。Kenney Mini Characters（CC0・ボーン入り・アニメ付き）を人の種類ごとに塗り分けて使う
// 盤面の人数は170人前後あるが、描くのはカメラに近い数十人だけ（見た目は人ごとに固定。使い回しは同じ見た目の中で）
import * as THREE from 'three'
import { GLTFLoader } from '../vendor/jsm/loaders/GLTFLoader.js'
import { clone as skClone } from '../vendor/jsm/utils/SkeletonUtils.js'

const BASE = 'assets/chars/'
const FILES = ['male-a', 'male-b', 'male-c', 'male-d', 'male-f', 'female-b', 'female-c', 'female-d', 'female-e', 'female-f']
const BLACK_HAIR = ['male-d', 'female-d', 'female-b']
const A = { src: {}, clips: null, acc: {}, ready: false }
export const assets = A

export function loadPeople(manager) {
  const L = new GLTFLoader(manager)
  const get = f => new Promise((ok, ng) => L.load(BASE + f + '.glb', ok, undefined, ng))
  return Promise.all([...FILES.map(f => get('character-' + f)), get('aid-sunglasses'), get('aid-glasses'), get('aid-mask')]).then(rs => {
    FILES.forEach((f, i) => {
      const g = rs[i]
      g.scene.traverse(o => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = false } })
      A.src[f] = g.scene
      // オレンジ髪を黒髪にする（色見本の列11 から 列1。列11は male-f では肌なので、髪がオレンジのキャラの頭だけ）
      if (BLACK_HAIR.includes(f)) g.scene.traverse(o => {
        if (!o.isMesh || !/head/.test(o.name)) return
        const uv = o.geometry.attributes.uv
        for (let i = 0; i < uv.count; i++) { const u = uv.getX(i); if (u * 16 >= 11 && u * 16 < 12) uv.setX(i, u - 10 / 16) }
        uv.needsUpdate = true
      })
      if (!A.clips) { A.clips = {}; for (const c of g.animations) A.clips[c.name] = c }
    })
    const n = FILES.length; A.acc.sunglasses = rs[n].scene; A.acc.glasses = rs[n + 1].scene; A.acc.mask = rs[n + 2].scene
    A.ready = true
  })
}

// 見た目の決まり方: 種類 から 元のキャラ・色の掛け方・付ける物
// 通勤客はスーツの2人を多めにして、色を少し落として朝の電車らしくする
// 自分は female-b。female-a は松葉杖、male-e は手に物を持っているので通勤客には使わない
const COMMUTER = ['male-d', 'male-d', 'male-d', 'female-d', 'female-d', 'female-d', 'male-f', 'female-e', 'female-f', 'male-d', 'female-d', 'male-f']   // female-b（黄色と紫）は自分の見た目にする
export function lookOf(b) {
  const n = b.look || 0
  switch (b.type) {
    case 'dufu': return { key: 'dufu', file: 'male-a', tint: 0xffffff }
    case 'sleep': return { key: 'sleep', file: 'male-b', tint: 0xe8e2da }
    case 'pack': return { key: 'pack' + (b.id % 2), file: b.id % 2 ? 'male-f' : 'female-f', tint: 0xffffff, pack: true }
    case 'perfume': return { key: 'perfume', file: 'female-c', tint: 0xffd6ec }
    case 'vip': return { key: 'vip', file: 'male-d', tint: 0x2a2a30, acc: 'sunglasses' }
    case 'staff': return { key: 'staff', file: 'male-c', tint: 0xffffff, prop: 'gloves' }
    case 'bento': return { key: 'bento', file: 'male-f', tint: 0xd8dce4, prop: 'bento' }
    case 'board': return { key: 'board', file: 'female-e', tint: 0xffffff, prop: 'board' }
    case 'tourist': return { key: 'tourist', file: 'female-f', tint: 0xffffff, prop: 'suitcase' }
    case 'lying': return { key: 'lying', file: 'male-d', tint: 0xd8dce4 }
    default: {
      const file = COMMUTER[n % COMMUTER.length]
      const shade = [0xffffff, 0xd8dce4, 0xc8ccd6, 0xe6e0d6][(n >> 4) % 4]
      const acc = (n >> 6) % 5 === 0 ? 'mask' : null
      return { key: file + ':' + shade + ':' + acc, file, tint: shade, acc }
    }
  }
}

const PACK_COLS = [0x2b3a55, 0x1f1f22, 0x5a2b2b]
export class Person {
  constructor(look, scaleXZ, scaleY) {
    this.look = look
    this.group = new THREE.Group()
    this.lean = new THREE.Group(); this.group.add(this.lean)
    const ch = this.char = skClone(A.src[look.file])
    ch.traverse(o => {
      if (o.isMesh && o.material) {
        o.material = o.material.clone()
        o.material.color.setHex(look.tint)
        o.material.roughness = 0.85; o.material.metalness = 0
      }
    })
    ch.scale.set(scaleXZ, scaleY, scaleXZ)
    this.lean.add(ch)
    this.bones = {}; ch.traverse(o => { if (o.isBone || o.type === 'Object3D') this.bones[o.name] = o })
    const head = this.bones.head
    if (look.acc && A.acc[look.acc] && head) {
      const a = A.acc[look.acc].clone()
      if (look.acc === 'sunglasses') a.position.set(0, 0.15, 0.115)
      if (look.acc === 'mask') a.position.set(0, 0.035, -0.07)
      head.add(a)
    }
    if (look.pack) {   // 背負ったままのリュック
      const g = new THREE.Group()
      const mat = new THREE.MeshStandardMaterial({ color: PACK_COLS[(look.key.length) % 3], roughness: 0.9 })
      const bag = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.2, 4, 10), mat)
      bag.scale.set(1.15, 1, 0.62); g.add(bag)
      const pocket = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.06, 4, 8), mat); pocket.scale.set(1.1, 1, 0.5); pocket.position.set(0, -0.12, -0.08); g.add(pocket)
      const zip = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.02, 0.02), new THREE.MeshStandardMaterial({ color: 0xc9c9c9, metalness: 0.6, roughness: 0.4 })); zip.position.set(0, 0.02, -0.11); g.add(zip)
      g.position.set(0, 0.25, -0.21); g.scale.setScalar(1 / scaleY)
      ;(this.bones.torso || ch).add(g)
      this.bag = g
    }
    // 持ち物（体の大きさの枠 lean に m 単位で付ける）
    const PM = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 })
    const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); this.lean.add(m); return m }
    if (look.prop === 'bento') {   // 駅弁（ふたを開けて食べ続ける）
      add(new THREE.BoxGeometry(0.3, 0.07, 0.22), PM(0x7a2a1e), 0, 0.78, 0.34)
      add(new THREE.BoxGeometry(0.26, 0.02, 0.18), PM(0xf4f1e6), 0, 0.82, 0.34)
      add(new THREE.BoxGeometry(0.08, 0.04, 0.06), PM(0xc77a2e), 0.06, 0.845, 0.32)
      add(new THREE.CylinderGeometry(0.006, 0.006, 0.26, 4), PM(0xb98a52), -0.05, 0.93, 0.36, 0.6, 0, 0.3)
    }
    if (look.prop === 'board') {   // サーフボード（満員電車に持ち込む）
      const b = add(new THREE.CapsuleGeometry(0.22, 1.5, 4, 12), PM(0x36b3b0), 0.32, 1.05, -0.18, 0, 0, 0.18); b.scale.set(1, 1, 0.18)
      const st = add(new THREE.BoxGeometry(0.03, 1.5, 0.05), PM(0xffffff), 0.32, 1.05, -0.14, 0, 0, 0.18)
    }
    if (look.prop === 'suitcase') {   // スーツケース
      add(new THREE.BoxGeometry(0.42, 0.55, 0.24), PM(0xc23b2b), 0.5, 0.34, 0)
      add(new THREE.BoxGeometry(0.02, 0.3, 0.02), PM(0x333333), 0.42, 0.75, 0); add(new THREE.BoxGeometry(0.02, 0.3, 0.02), PM(0x333333), 0.58, 0.75, 0)
      add(new THREE.BoxGeometry(0.18, 0.02, 0.02), PM(0x333333), 0.5, 0.9, 0)
    }
    if (look.prop === 'gloves') {   // 駅員の白手袋（大きめ）
      for (const s of [-1, 1]) add(new THREE.SphereGeometry(0.11, 10, 8), PM(0xffffff), s * 0.42, 0.62, 0.12)
    }
    this.mixer = new THREE.AnimationMixer(ch)
    this.acts = {}
    for (const n of ['idle', 'walk', 'sit', 'emote-no', 'holding-both', 'crouch', 'attack-melee-right', 'die']) {
      const c = A.clips[n]; if (!c) continue
      const a = this.mixer.clipAction(c); this.acts[n] = a
      if (n === 'die') { a.setLoop(THREE.LoopOnce); a.clampWhenFinished = true }
    }
    this.cur = null; this.play('idle'); this.mixer.update(Math.random() * 2)
    this.acc = 0; this.fade = 1
    this.mats = []; this.group.traverse(o => { if (o.isMesh) this.mats.push(o.material) })
  }
  // 透かす（カメラと自分の間にいる人）。0 で消す
  setFade(a) {
    if (a === this.fade) return
    this.fade = a; this.group.visible = a > 0
    for (const m of this.mats) { m.transparent = a < 1; m.opacity = a; m.depthWrite = a >= 1; m.needsUpdate = true }
  }
  play(n, fade = 0.2) {
    const a = this.acts[n]; if (!a || this.cur === a) return
    a.reset().setEffectiveWeight(1).fadeIn(fade).play()
    if (this.cur) this.cur.fadeOut(fade)
    this.cur = a
  }
}

// 種類ごとの空き箱。見えなくなった人の体を返し、見えた人が借りる
export class Pool {
  constructor(scene, scaleXZ, scaleY) { this.scene = scene; this.free = new Map(); this.sxz = scaleXZ; this.sy = scaleY; this.made = 0 }
  take(look) {
    const a = this.free.get(look.key)
    let p = a && a.pop()
    if (!p) { p = new Person(look, this.sxz, this.sy); this.made++; this.scene.add(p.group) }
    p.group.visible = true
    return p
  }
  give(p) { p.group.visible = false; let a = this.free.get(p.look.key); if (!a) this.free.set(p.look.key, a = []); a.push(p) }
}
