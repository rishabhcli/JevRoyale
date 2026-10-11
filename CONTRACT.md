# Jev Royale — module contract

Original build-and-shoot battle royale (inspired by the genre, NO Fortnite names/assets/characters).
Player vs a bot lobby of 5 "Jev" bots. Every bot is a Jev — an ORIGINAL character:
chunky stylized robot-kid with a big rounded helmet, a wide glowing visor, an oversized hoodie,
a little antenna topped with a glowing orb, and a "J" emblem on the chest. Each Jev has an accent color.

No build step. Vanilla ES modules + three.js r160 from CDN via importmap in `public/index.html`:
`"three": "https://unpkg.com/three@0.160.0/build/three.module.js"`,
`"three/addons/": "https://unpkg.com/three@0.160.0/examples/jsm/"`.
Served by `server.js` (Node, `node server.js`, port 3000) from `public/`.

## Files & owners
- `public/index.html`, `public/style.css`, `public/js/main.js` — core game (world, player, weapons, building, storm, HUD, game flow)
- `public/js/bots.js` — Jev bot models + AI
- `public/js/fx.js` — visual FX + synthesized WebAudio SFX
- `server.js` — static server + `POST /api/jev-chat` (OpenRouter LLM trash talk)

## Units / world
- Y up. 1 unit = 1 meter. Player eye height 1.7, capsule radius 0.4, height 1.8.
- Map is ~300 x 300 centered at origin. Ground height from `game.world.heightAt(x, z)`.
- Build pieces are 4m grid tiles (wall 4x4x0.2, floor 4x0.2x4, ramp = slanted 4x4 tile).

## The shared `game` object (created by main.js, passed to every module)
```js
game = {
  THREE, scene, camera, renderer,
  time,                       // seconds since match start (number, updated by main)
  player: {
    pos: THREE.Vector3,       // FEET position
    vel: THREE.Vector3,
    yaw, pitch,
    health: 100, shield: 50,  // max 100 / 100
    alive: true,
    name: 'You',
    getEyePos(): THREE.Vector3,
  },
  bots: [],                   // filled by bots.js manager (array of Bot, see below)
  colliders: [],              // [{ box: THREE.Box3, mesh, hp, maxHp, kind: 'build'|'prop'|'tree'|'rock'|'house', owner }]
  world: { size: 300, heightAt(x, z): number },
  storm: { center: THREE.Vector3, radius: number, damagePerSec: number },
  fx,                         // object returned by createFX(game)
  botManager,                 // object returned by createBots(game)

  // services provided by main.js:
  raycastWorld(origin, dir, maxDist) -> { point, normal, distance, collider|null } | null  // world + builds, NOT characters
  damagePlayer(amount, fromPos, attackerName)       // handles shield then health, hit indicator, death
  damageCollider(collider, amount, point)            // builds/props lose hp, break with fx
  placeBuild(type /*'wall'|'floor'|'ramp'*/, worldPos, yaw, owner) -> collider|null  // snaps to grid
  onBotKilled(bot, killerName)                       // killfeed, win check
  jevChat(bot, event, context)                       // async LLM trash talk -> speech bubble + chat log. event: 'spawn'|'kill_player'|'got_hit'|'low_hp'|'eliminated'|'player_built'|'taunt'|'kill_bot'
  killfeed(text)
}
```

## bots.js exports
```js
export function createBots(game, count = 5) -> {
  bots: Bot[],          // also assign game.bots = bots
  update(dt),
  aliveCount(): number,
}
```
`Bot` shape (what main.js relies on):
```js
{
  name, color, personality /* short string for the LLM */,
  pos: THREE.Vector3 /* feet */, vel, yaw,
  health, shield, alive,
  mesh: THREE.Group,
  hitTest(origin: Vector3, dir: Vector3 /*normalized*/, maxDist) -> { distance, point, headshot: boolean } | null,
  takeDamage(amount, point, headshot, attackerName),   // bot applies shield/health, triggers fx damage number + hurt reaction, calls game.onBotKilled when dead
}
```

## fx.js exports
```js
export function createFX(game) -> {
  update(dt),
  muzzleFlash(pos, dir, color?),
  tracer(from, to, color?),
  impact(point, normal, kind /*'build'|'ground'|'flesh'|'shield'*/),
  explosion(pos, radius),
  damageNumber(worldPos, amount, { headshot, shield }),
  buildPlace(pos, size),
  buildBreak(pos, color),
  elimination(pos, color),          // big over-the-top elimination burst
  screenShake(intensity),           // main.js reads fx.getShakeOffset() each frame and adds to camera
  getShakeOffset() -> THREE.Vector3,
  hitmarker(headshot),              // DOM crosshair hitmarker
  stormEdge? (optional internal)
  sfx: { shot(weapon /*'rifle'|'shotgun'|'smg'|'rocket'|'pickaxe'*/, pos?), hit(), headshot(), shieldBreak(), build(), breakBuild(), elim(), footstep(), reload(), pickup(), stormTick(), jump(), land(), victory(), defeat(), explosion(), unlock() /* resume AudioContext on first click */ }
}
```
`pos` args for sfx are optional; if given, attenuate/pan by distance to `game.camera`.
