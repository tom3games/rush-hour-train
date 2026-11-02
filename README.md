# 満員電車に乗り込め

発車まで30秒。主観（一人称）の3Dで、背中を押して満員電車に乗り込むバカゲー。ブラウザで遊べる。

- 操作: スマホは左側をなぞって進む・右下の手のボタンで押す。PC は WASD / 矢印で進む・Space / F で押す
- 閉まるドアに体がかかると弾き出される。残り10秒で駅員が押しに来る

## 開発
- `node server.mjs` で http://localhost:5310
- `node verify.mjs` 検証一式（音は出さない）、`node sim.mjs` bot の乗車割合、`node fps.mjs` スマホ相当の fps、`node og.mjs` OGP 画像
- 押し合いの計算は `js/phys.js`（DOM なし）。難しさは `T`

素材のライセンスは CREDITS.md と `assets/chars/License-kenney.txt`。
