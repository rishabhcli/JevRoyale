import * as THREE from 'three';
import { buildWorld, createLootSystem, makePlankTexture } from './world.js';
import { createHUD } from './hud.js';

const V3 = THREE.Vector3;
const errOnce = new Set();
function logOnce(tag, e) { if (!errOnce.has(tag)) { errOnce.add(tag); console.error(`[Jev Royale] ${tag}:`, e); } }
function safe(tag, f) { try { return f(); } catch (e) { logOnce(tag, e); } }

// ================= renderer / scene / camera =================
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.autoClear = false;
document.getElementById('game-root').append(renderer.domElement);

const scene = new THREE.Scene();
const FOG_COLOR = new THREE.Color('#cfe8ff');
const STORM_FOG = new THREE.Color('#8a4fd8');
scene.fog = new THREE.Fog(FOG_COLOR.clone(), 90, 430);
scene.background = FOG_COLOR.clone();

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1400);
camera.rotation.order = 'YXZ';
scene.add(camera);

// sky dome
const SUN_DIR = new V3(0.45, 0.75, 0.3).normalize();
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(1000, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top: { value: new THREE.Color('#2f7dff') }, horizon: { value: FOG_COLOR.clone() }, bottom: { value: new THREE.Color('#9fd0ff') },
      sunDir: { value: SUN_DIR },
    },
    vertexShader: `varying vec3 vPos; void main(){ vPos = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; uniform vec3 sunDir; varying vec3 vPos;
      void main(){ float h = vPos.y; vec3 c = h > 0.0 ? mix(horizon, top, pow(h, 0.55)) : mix(horizon, bottom, min(1.0, -h * 3.0));
        float s = max(dot(normalize(vPos), sunDir), 0.0); c += vec3(1.0, 0.9, 0.6) * (pow(s, 600.0) * 3.0 + pow(s, 12.0) * 0.25);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  })
);
sky.renderOrder = -1;
scene.add(sky);

const hemi = new THREE.HemisphereLight('#cfe9ff', '#5d8f3a', 1.35);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff1d6', 2.5);
sun.castShadow = true;
sun.shadow.mapSize.set(1536, 1536);
sun.shadow.camera.left = -70; sun.shadow.camera.right = 70; sun.shadow.camera.top = 70; sun.shadow.camera.bottom = -70;
sun.shadow.camera.near = 10; sun.shadow.camera.far = 320;
sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);

// ================= the shared game object =================
const player = {
  pos: new V3(0, 120, 0), vel: new V3(), yaw: 0, pitch: 0,
  health: 100, shield: 50, alive: true, name: 'You',
  onGround: false, onRamp: null, crouching: false, dropping: true, gliding: false, dropTime: 0,
  getEyePos() { return new V3(this.pos.x, this.pos.y + (this.crouching ? 1.15 : 1.7), this.pos.z); },
};

const game = {
  THREE, scene, camera, renderer,
  time: 0, started: false, over: false,
  player,
  bots: [],
  colliders: [],
  world: null,
  storm: { center: new V3(0, 0, 0), radius: 220, damagePerSec: 1, nextCenter: null, nextRadius: null, phase: 0, label: 'STORM FORMING', timer: 30, shrinking: false },
  fx: null,
  botManager: null,
};
window.game = game;

const fx = (name, ...a) => { try { return game.fx?.[name]?.(...a); } catch (e) { logOnce('fx.' + name, e); } };
const sfx = (name, ...a) => { try { return game.fx?.sfx?.[name]?.(...a); } catch (e) { logOnce('sfx.' + name, e); } };

// ================= world =================
buildWorld(game);
const heightAt = game.world.heightAt;
const loot = createLootSystem(game);
loot.populate();
const hud = createHUD(game);

const stats = { kills: 0, damage: 0, placement: 6, killer: null };
let mats = 100;

// ================= build system =================
const plankTex = makePlankTexture();
const BUILD_GEO = {
  wall: new THREE.BoxGeometry(4, 4, 0.2),
  floor: new THREE.BoxGeometry(4, 0.2, 4),
  ramp: new THREE.BoxGeometry(4, 0.2, Math.SQRT2 * 4),
};
const buildMats = new Map();
function buildMaterialFor(owner) {
  if (buildMats.has(owner)) return buildMats.get(owner);
  const bot = findBot(owner);
  const col = new THREE.Color('#ffffff');
  if (bot && bot.color) col.lerp(new THREE.Color(bot.color), 0.4);
  const m = new THREE.MeshLambertMaterial({ map: plankTex, color: col });
  buildMats.set(owner, m);
  return m;
}
function makeBuildObject(type, material) {
  if (type === 'ramp') {
    const g = new THREE.Group();
    const m = new THREE.Mesh(BUILD_GEO.ramp, material);
    m.position.y = 2; m.rotation.x = Math.PI / 4;
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return g;
  }
  const m = new THREE.Mesh(BUILD_GEO[type], material);
  m.castShadow = m.receiveShadow = true;
  return m;
}
function applyBuildTransform(obj, s) {
  obj.rotation.set(0, s.qyaw, 0);
  if (s.type === 'wall') obj.position.set(s.x, s.y + 2, s.z);
  else obj.position.set(s.x, s.y, s.z);
}

const slotMap = new Map();
const builds = [];
const buildAnims = [];
const punches = [];
const MAX_BUILDS = 400;

function snapBuild(type, pos, yaw, estY = pos.y) {
  const q = ((Math.round(yaw / (Math.PI / 2)) % 4) + 4) % 4;
  const qyaw = q * Math.PI / 2;
  const fxr = Math.round(-Math.sin(qyaw)), fzr = Math.round(-Math.cos(qyaw));
  let x, z;
  if (type === 'wall') {
    if (fxr !== 0) { x = Math.round(pos.x / 4) * 4; z = Math.floor(pos.z / 4) * 4 + 2; }
    else { z = Math.round(pos.z / 4) * 4; x = Math.floor(pos.x / 4) * 4 + 2; }
  } else { x = Math.floor(pos.x / 4) * 4 + 2; z = Math.floor(pos.z / 4) * 4 + 2; }
  const ground = Math.round(heightAt(x, z) * 4) / 4;
  let ref = null, refD = 1e9;
  for (const b of builds) {
    const dx = b.center.x - x, dz = b.center.z - z, dy = b.baseY - estY;
    if (Math.abs(dx) > 8.5 || Math.abs(dz) > 8.5 || Math.abs(dy) > 8) continue;
    const d = dx * dx + dz * dz + dy * dy;
    if (d < refD) { refD = d; ref = b.baseY; }
  }
  let y;
  if (ref !== null) y = ref + 4 * Math.round((estY - ref) / 4);
  else y = ground + 4 * Math.max(0, Math.round((estY - ground) / 4));
  if (y < ground - 3) y += 4 * Math.ceil((ground - 3 - y) / 4);
  const axis = type === 'wall' ? (fxr !== 0 ? 'x' : 'z') : '';
  const key = `${type}|${x}|${Math.round(y * 10)}|${z}|${axis}`;
  return { type, x, y, z, qyaw, fx: fxr, fz: fzr, key };
}

function placeSnapped(s, owner) {
  if (slotMap.has(s.key)) return null;
  const obj = makeBuildObject(s.type, buildMaterialFor(owner));
  applyBuildTransform(obj, s);
  scene.add(obj);
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const center = s.type === 'wall' ? new V3(s.x, s.y + 2, s.z) : s.type === 'ramp' ? new V3(s.x, s.y + 2, s.z) : new V3(s.x, s.y, s.z);
  const c = {
    box, mesh: obj, hp: 150, maxHp: 150, kind: 'build', buildType: s.type, owner, key: s.key,
    baseY: s.y, center, rampDir: { x: s.fx, z: s.fz }, mats: 5,
  };
  game.colliders.push(c);
  builds.push(c);
  slotMap.set(s.key, c);
  obj.scale.setScalar(0.05);
  buildAnims.push({ obj, t: 0 });
  const size = s.type === 'wall' ? new V3(4, 4, 0.2) : s.type === 'floor' ? new V3(4, 0.2, 4) : new V3(4, 4, 4);
  fx('buildPlace', center.clone(), size);
  sfx('build', center.clone());
  if (builds.length > MAX_BUILDS) breakCollider(builds[0], true);
  return c;
}

function placeBuild(type, worldPos, yaw, owner = 'You') {
  if (!['wall', 'floor', 'ramp'].includes(type) || !worldPos) return null;
  return placeSnapped(snapBuild(type, worldPos, yaw || 0, worldPos.y), owner);
}

function rampHeight(c, x, z) {
  const dx = x - c.center.x, dz = z - c.center.z;
  const along = dx * c.rampDir.x + dz * c.rampDir.z;
  const side = dx * c.rampDir.z - dz * c.rampDir.x;
  if (Math.abs(along) > 2.05 || Math.abs(side) > 2.05) return null;
  return c.baseY + Math.max(0, Math.min(4, along + 2));
}

const COLLIDER_COLORS = { build: '#c98a4b', tree: '#3fae4a', rock: '#9a94a8', house: '#ffd6a5', prop: '#b5773a' };
const zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
function breakCollider(c, silent = false) {
  const i = game.colliders.indexOf(c);
  if (i >= 0) game.colliders.splice(i, 1);
  if (c.kind === 'build') {
    const bi = builds.indexOf(c);
    if (bi >= 0) builds.splice(bi, 1);
    if (slotMap.get(c.key) === c) slotMap.delete(c.key);
  }
  c.hp = 0;
  if (c.instances) {
    for (const { mesh, index } of c.instances) { mesh.setMatrixAt(index, zeroMatrix); mesh.instanceMatrix.needsUpdate = true; }
  } else if (c.mesh && c.mesh.parent) c.mesh.parent.remove(c.mesh);
  if (!silent) {
    const center = c.center ? c.center.clone() : c.box.getCenter(new V3());
    fx('buildBreak', center, COLLIDER_COLORS[c.kind] || '#c98a4b');
    sfx('breakBuild', center);
  }
}

function damageCollider(c, amount, point) {
  if (!c || c.hp <= 0) return;
  c.hp -= amount;
  if (c.hp <= 0) { breakCollider(c); return; }
  if (c.mesh && !punches.some(p => p.c === c)) punches.push({ c, t: 0, base: c.mesh.scale.clone() });
}

function updateBuildAnims(dt) {
  for (let i = buildAnims.length - 1; i >= 0; i--) {
    const a = buildAnims[i];
    a.t += dt / 0.22;
    const t = Math.min(1, a.t);
    const s = t < 1 ? 1 + Math.sin(t * Math.PI) * 0.12 - (1 - t) * (1 - t) : 1;
    a.obj.scale.setScalar(Math.max(0.05, s));
    if (a.t >= 1) { a.obj.scale.setScalar(1); buildAnims.splice(i, 1); }
  }
  for (let i = punches.length - 1; i >= 0; i--) {
    const p = punches[i];
    p.t += dt;
    const k = 1 + Math.sin(p.t * 40) * 0.05 * Math.max(0, 1 - p.t / 0.18);
    if (buildAnims.some(a => a.obj === p.c.mesh)) { punches.splice(i, 1); continue; }
    p.c.mesh.scale.copy(p.base).multiplyScalar(k);
    if (p.t > 0.18) { p.c.mesh.scale.copy(p.base); punches.splice(i, 1); }
  }
}

// ================= raycasting =================
const _ray = new THREE.Ray();
const _v = new V3();
const _plane = new THREE.Plane();
function boxNormal(box, p) {
  const d = [
    [Math.abs(p.x - box.min.x), -1, 0, 0], [Math.abs(p.x - box.max.x), 1, 0, 0],
    [Math.abs(p.y - box.min.y), 0, -1, 0], [Math.abs(p.y - box.max.y), 0, 1, 0],
    [Math.abs(p.z - box.min.z), 0, 0, -1], [Math.abs(p.z - box.max.z), 0, 0, 1],
  ];
  let best = d[0];
  for (const e of d) if (e[0] < best[0]) best = e;
  return new V3(best[1], best[2], best[3]);
}

function rayTerrain(origin, dir, maxDist) {
  const h0 = heightAt(origin.x, origin.z);
  if (origin.y < h0) return { point: origin.clone(), normal: new V3(0, 1, 0), distance: 0, collider: null };
  let t = 0, prevT = 0;
  let iter = 0;
  while (t < maxDist && iter++ < 900) {
    const px = origin.x + dir.x * t, py = origin.y + dir.y * t, pz = origin.z + dir.z * t;
    const gap = py - heightAt(px, pz);
    if (gap < 0) {
      let a = prevT, b = t;
      for (let k = 0; k < 10; k++) {
        const m = (a + b) / 2;
        const g = origin.y + dir.y * m - heightAt(origin.x + dir.x * m, origin.z + dir.z * m);
        if (g < 0) b = m; else a = m;
      }
      const point = new V3(origin.x + dir.x * b, origin.y + dir.y * b, origin.z + dir.z * b);
      return { point, normal: game.world.normalAt(point.x, point.z), distance: b, collider: null };
    }
    prevT = t;
    t += Math.max(0.3, gap * 0.6);
  }
  return null;
}

function raycastWorld(origin, dir, maxDist = 500) {
  _ray.set(origin, dir);
  let best = null, bestD = maxDist;
  const cols = game.colliders;
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    if (c.hp <= 0) continue;
    if (c.buildType === 'ramp') {
      const n = _v.set(-c.rampDir.x, 1, -c.rampDir.z).normalize();
      _plane.setFromNormalAndCoplanarPoint(n, c.center);
      const p = _ray.intersectPlane(_plane, new V3());
      if (!p) continue;
      const d = p.distanceTo(origin);
      if (d >= bestD) continue;
      if (rampHeight(c, p.x, p.z) === null || p.y < c.baseY - 0.3 || p.y > c.baseY + 4.3) continue;
      bestD = d; best = { point: p, normal: n.clone(), distance: d, collider: c };
      continue;
    }
    const p = _ray.intersectBox(c.box, _v);
    if (!p) continue;
    const d = p.distanceTo(origin);
    if (d < bestD) { bestD = d; best = { point: p.clone(), normal: boxNormal(c.box, p), distance: d, collider: c }; }
  }
  const th = rayTerrain(origin, dir, bestD);
  if (th) best = th;
  return best;
}

// ================= services =================
function findBot(name) { return (game.bots || []).find(b => b && b.name === name) || null; }
function aliveCount() {
  try {
    const n = game.botManager?.aliveCount?.();
    if (typeof n === 'number') return n;
  } catch (e) { logOnce('aliveCount', e); }
  return (game.bots || []).filter(b => b && b.alive).length;
}

function damagePlayer(amount, fromPos, attackerName = 'Someone') {
  if (!player.alive || !game.started || game.over || !(amount > 0)) return;
  let a = amount;
  if (player.shield > 0) {
    const s = Math.min(player.shield, a);
    player.shield -= s; a -= s;
    if (player.shield <= 0) sfx('shieldBreak');
  }
  player.health = Math.max(0, player.health - a);
  hud.flashVignette(amount / 30);
  if (fromPos && attackerName !== 'The Storm') {
    const dx = fromPos.x - player.pos.x, dz = fromPos.z - player.pos.z;
    const fwdX = -Math.sin(player.yaw), fwdZ = -Math.cos(player.yaw);
    const rX = Math.cos(player.yaw), rZ = -Math.sin(player.yaw);
    hud.damageIndicator(Math.atan2(dx * rX + dz * rZ, dx * fwdX + dz * fwdZ));
    sfx('hit');
  }
  fx('screenShake', Math.min(0.6, 0.1 + amount / 50));
  if (player.health <= 0) killPlayer(attackerName);
}

function killPlayer(attackerName) {
  player.alive = false;
  player.health = 0;
  stats.placement = aliveCount() + 1;
  stats.killer = attackerName;
  deathInfo.killer = findBot(attackerName);
  if (attackerName === 'The Storm') hud.killfeed('You got zapped by the storm');
  else hud.killfeed(`${attackerName} eliminated You`);
  if (deathInfo.killer) jevChat(deathInfo.killer, 'kill_player', { killer: attackerName });
  sfx('defeat');
  fx('screenShake', 1);
  hud.centerMessage(`ELIMINATED<small>by ${attackerName} — #${stats.placement}</small>`, 3000);
  setTimeout(() => {
    game.over = true;
    document.exitPointerLock?.();
    hud.showEnd(false, { ...stats, time: game.time });
  }, 2600);
}

function onBotKilled(bot, killerName) {
  if (!bot || bot._jrKillHandled) return;
  bot._jrKillHandled = true;
  const pos = bot.pos ? bot.pos.clone() : new V3();
  sfx('elim', pos.clone());
  const left = Math.max(0, aliveCount() - (bot.alive ? 1 : 0));
  if (killerName === 'You') {
    stats.kills++;
    hud.killfeed(`You eliminated ${bot.name}`, true);
    hud.centerMessage(`ELIMINATED ${String(bot.name).toUpperCase()}<small>${left} Jev${left === 1 ? '' : 's'} left</small>`);
    fx('screenShake', 0.45);
  } else if (killerName === 'The Storm' || killerName === 'Storm' || !killerName) {
    hud.killfeed(`${bot.name} got zapped by the storm`);
  } else {
    hud.killfeed(`${killerName} eliminated ${bot.name}`);
  }
  loot.dropPile(pos);
}

const FALLBACK_LINES = {
  spawn: ['Jev has entered the chat.', 'Another day, another drop.', 'Hope you brought snacks. And skill.'],
  kill_player: ['GG. Go practice on a training dummy.', 'Sit down, sit down.', 'That was quicker than my boot sequence.', 'Respawn? Oh wait.'],
  got_hit: ['Hey! That tickled.', 'Lucky shot.', 'Ow, my paint job!', 'You missed. Mostly.'],
  low_hp: ['Okay okay, time out!', 'I am totally fine. Totally.', 'Where are the medkits?!'],
  eliminated: ['Lag. Definitely lag.', 'I let you win.', 'Tell my antenna I loved it.', 'Rematch. Now.'],
  player_built: ['Nice shack. I will be removing it.', 'Building? Cute.', 'Is that a wall or a cry for help?'],
  taunt: ['I can see you, you know.', 'Come out and play!', 'Your aim has a firmware bug.', 'Storm is coming for you, buddy.'],
  kill_bot: ['One less Jev. More loot for me.', 'Nothing personal, cousin.', 'Next!'],
};
const chatState = { lastGlobal: -99, perBot: new Map() };
async function jevChat(bot, event, context = {}) {
  if (!bot || !bot.name) return;
  const now = performance.now() / 1000;
  const always = event === 'eliminated' || event === 'kill_player';
  if (!always) {
    if (now - chatState.lastGlobal < 3.5) return;
    if (now - (chatState.perBot.get(bot.name) ?? -99) < 8) return;
  }
  chatState.lastGlobal = now;
  chatState.perBot.set(bot.name, now);
  const ctx = {
    playerHealth: Math.round(player.health), playerShield: Math.round(player.shield), playerAlive: player.alive,
    jevsLeft: aliveCount(), stormPhase: game.storm.phase, matchTime: Math.round(game.time),
    distanceToPlayer: bot.pos ? Math.round(bot.pos.distanceTo(player.pos)) : null,
    playerKills: stats.kills, ...context,
  };
  let text = '';
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 7000);
    const res = await fetch('/api/jev-chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal,
      body: JSON.stringify({ botName: bot.name, personality: bot.personality || '', event, context: ctx }),
    });
    clearTimeout(to);
    if (res.ok) { const j = await res.json(); text = String(j?.text || '').trim(); }
  } catch (e) { /* fall back below */ }
  if (!text) { const arr = FALLBACK_LINES[event] || FALLBACK_LINES.taunt; text = arr[(Math.random() * arr.length) | 0]; }
  text = text.replace(/^["']|["']$/g, '').slice(0, 160);
  hud.addChat(bot.name, bot.color, text);
  hud.showBubble(bot, text);
}

Object.assign(game, {
  raycastWorld, damagePlayer, damageCollider, placeBuild, onBotKilled, jevChat,
  killfeed: (text) => hud.killfeed(text),
  heightAt,
});

// ================= input =================
const keys = {};
const mouse = { left: false, right: false, fresh: false };
let locked = false;
let thirdPerson = false;
let mouseDX = 0, mouseDY = 0;

document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === renderer.domElement;
  const pause = document.getElementById('pause-screen');
  if (locked) pause.classList.add('hidden');
  else { mouse.left = mouse.right = false; if (game.started && !game.over && player.alive) pause.classList.remove('hidden'); }
});
function lock() { try { const p = renderer.domElement.requestPointerLock(); p?.catch?.(() => {}); } catch (e) { /* ignore */ } }

window.addEventListener('keydown', (e) => {
  if (e.repeat) { keys[e.code] = true; return; }
  keys[e.code] = true;
  if (!game.started || game.over) return;
  if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
  switch (e.code) {
    case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': case 'Digit5': setSlot(+e.code.slice(5) - 1); break;
    case 'KeyQ': toggleBuild('wall'); break;
    case 'KeyE': toggleBuild('ramp'); break;
    case 'KeyF': toggleBuild('floor'); break;
    case 'KeyR': startReload(); break;
    case 'KeyV': thirdPerson = !thirdPerson; break;
  }
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouse.left = mouse.right = false; });
document.addEventListener('mousemove', (e) => {
  if (!locked || !player.alive) return;
  const sens = 0.0022 * (mouse.right && !buildType ? 0.6 : 1);
  player.yaw -= e.movementX * sens;
  player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch - e.movementY * sens));
  mouseDX += e.movementX; mouseDY += e.movementY;
});
renderer.domElement.addEventListener('mousedown', (e) => {
  if (!locked) { if (game.started && !game.over) lock(); return; }
  if (e.button === 0) { mouse.left = true; mouse.fresh = true; }
  if (e.button === 2) mouse.right = true;
});
window.addEventListener('mouseup', (e) => { if (e.button === 0) mouse.left = false; if (e.button === 2) mouse.right = false; });
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('wheel', (e) => {
  if (!locked || !game.started) return;
  setSlot((slot + (e.deltaY > 0 ? 1 : -1) + 5) % 5);
}, { passive: true });

// ================= weapons =================
const WEAPONS = [
  { id: 'pickaxe', name: 'PICK', rate: 2.4, melee: true, dmg: 20, structDmg: 50, range: 3.3, mag: null, auto: true },
  { id: 'rifle', name: 'RIFLE', rate: 9, auto: true, dmg: 24, pellets: 1, magSize: 30, mag: 30, reserve: 150, reload: 2.0, spread: 0.007, bloomAdd: 0.006, bloomMax: 0.045, range: 300, kick: 0.012, shake: 0.12, color: '#ffd27a', fov: 48 },
  { id: 'shotgun', name: 'PUMP', rate: 1.05, auto: false, dmg: 11, pellets: 8, magSize: 5, mag: 5, reserve: 25, reload: 2.4, spread: 0.075, bloomAdd: 0, bloomMax: 0, range: 70, kick: 0.07, shake: 0.5, color: '#ffb35a', fov: 62 },
  { id: 'smg', name: 'SMG', rate: 14, auto: true, dmg: 14, pellets: 1, magSize: 30, mag: 30, reserve: 180, reload: 1.7, spread: 0.02, bloomAdd: 0.005, bloomMax: 0.06, range: 200, kick: 0.008, shake: 0.09, color: '#d6a8ff', fov: 58 },
  { id: 'rocket', name: 'ROCKET', rate: 0.9, auto: false, projectile: true, dmg: 70, radius: 5, magSize: 1, mag: 1, reserve: 6, reload: 2.4, spread: 0.002, bloomAdd: 0, bloomMax: 0, range: 400, kick: 0.09, shake: 0.6, color: '#ff8a3a', fov: 55 },
];
let slot = 1;
let buildType = null;
let cooldown = 0, bloom = 0, reloading = false, reloadT = 0;
let camRecoil = 0, vmKick = 0, swapT = 0, swingT = 0;

function setSlot(i) {
  if (i < 0 || i > 4) return;
  buildType = null;
  if (i !== slot) { slot = i; reloading = false; swapT = 1; cooldown = Math.max(cooldown, 0.2); }
}
function toggleBuild(type) { buildType = buildType === type ? null : type; reloading = false; }
function startReload() {
  const w = WEAPONS[slot];
  if (buildType || w.mag == null || reloading || w.mag >= w.magSize || w.reserve <= 0) return;
  reloading = true; reloadT = w.reload;
  sfx('reload');
}

const _fwd = new V3(), _right = new V3(), _up = new V3();
function camBasis() {
  camera.getWorldDirection(_fwd);
  _right.crossVectors(_fwd, camera.up).normalize();
  _up.crossVectors(_right, _fwd).normalize();
}
function getMuzzle() {
  if (!thirdPerson) return camera.localToWorld(new V3(0.22, -0.2, -0.95));
  const e = player.getEyePos();
  return e.addScaledVector(_right, 0.35).addScaledVector(_fwd, 0.7).addScaledVector(_up, -0.3);
}

function hitscan(origin, dir, maxDist) {
  let best = null;
  const wh = raycastWorld(origin, dir, maxDist);
  if (wh) best = { type: 'world', ...wh };
  for (const b of game.bots) {
    if (!b || !b.alive || !b.hitTest) continue;
    try {
      const h = b.hitTest(origin, dir, best ? best.distance : maxDist);
      if (h && (!best || h.distance < best.distance)) best = { type: 'bot', bot: b, distance: h.distance, point: h.point, headshot: !!h.headshot };
    } catch (e) { logOnce('bot.hitTest', e); }
  }
  return best;
}

function dealDamageToBot(bot, amount, point, headshot) {
  if (!bot.alive) return;
  const before = (bot.health || 0) + (bot.shield || 0);
  const hadShield = (bot.shield || 0) > 0;
  try { bot.takeDamage(amount, point, headshot, 'You'); } catch (e) { logOnce('bot.takeDamage', e); }
  const after = bot.alive ? (bot.health || 0) + (bot.shield || 0) : 0;
  stats.damage += Math.max(0, Math.min(amount, before - after));
  if (game.fx?.hitmarker) fx('hitmarker', headshot); else localHitmarker(headshot);
  sfx(headshot ? 'headshot' : 'hit');
  fx('impact', point, new V3(0, 1, 0), hadShield ? 'shield' : 'flesh');
}
let hmT = null;
function localHitmarker(head) {
  const el = document.getElementById('hitmarker');
  el.classList.toggle('headshot', !!head);
  el.classList.add('show');
  clearTimeout(hmT);
  hmT = setTimeout(() => el.classList.remove('show'), 120);
}

function impactKind(hit) {
  if (!hit.collider) return 'ground';
  return hit.collider.kind === 'rock' ? 'ground' : 'build';
}

function fire(w) {
  camBasis();
  const camPos = camera.position.clone();
  const eye = player.getEyePos();
  const muzzle = getMuzzle();
  let origin = thirdPerson ? eye : camPos;
  let aimDir = _fwd.clone();
  if (thirdPerson && !w.melee) {
    const ah = hitscan(camPos, _fwd, w.range);
    const target = ah ? ah.point : camPos.clone().addScaledVector(_fwd, w.range);
    aimDir = target.clone().sub(eye).normalize();
  }

  if (w.melee) {
    swingT = 1;
    sfx('shot', 'pickaxe', muzzle);
    const h = hitscan(origin, aimDir, w.range);
    if (!h) return;
    if (h.type === 'bot') dealDamageToBot(h.bot, w.dmg, h.point, false);
    else {
      fx('impact', h.point, h.normal, impactKind(h));
      if (h.collider) {
        mats = Math.min(999, mats + (h.collider.mats || 5));
        hud.flashMats();
        damageCollider(h.collider, w.structDmg, h.point);
      }
    }
    fx('screenShake', 0.08);
    return;
  }

  w.mag--;
  const moving = Math.hypot(player.vel.x, player.vel.z) > 1.5;
  let spread = (w.spread + bloom) * (mouse.right ? 0.45 : 1) * (moving ? 1.35 : 1) * (player.crouching ? 0.8 : 1) * (player.onGround ? 1 : 2);
  if (w.id === 'shotgun') spread = w.spread * (mouse.right ? 0.75 : 1);
  bloom = Math.min(w.bloomMax, bloom + w.bloomAdd);

  fx('muzzleFlash', muzzle.clone(), aimDir.clone(), w.color);
  sfx('shot', w.id, muzzle.clone());
  fx('screenShake', w.shake);
  camRecoil += w.kick * (mouse.right ? 0.6 : 1);
  player.yaw += (Math.random() - 0.5) * w.kick * 0.3;
  vmKick = 1;

  if (w.projectile) { spawnRocket(muzzle, aimDir); return; }

  const perBot = new Map();
  const r = new V3(), u = new V3();
  r.crossVectors(aimDir, new V3(0, 1, 0)).normalize();
  if (r.lengthSq() < 0.01) r.set(1, 0, 0);
  u.crossVectors(r, aimDir).normalize();
  for (let i = 0; i < w.pellets; i++) {
    const a = Math.random() * Math.PI * 2, m = Math.sqrt(Math.random()) * spread;
    const dir = aimDir.clone().addScaledVector(r, Math.cos(a) * m).addScaledVector(u, Math.sin(a) * m).normalize();
    const h = hitscan(origin, dir, w.range);
    const end = h ? h.point : origin.clone().addScaledVector(dir, w.range);
    if (i < 4 || Math.random() < 0.5) fx('tracer', muzzle.clone(), end.clone(), w.color);
    if (!h) continue;
    if (h.type === 'bot') {
      const dmg = w.dmg * (h.headshot ? 2 : 1);
      const e = perBot.get(h.bot) || { dmg: 0, head: false, point: h.point };
      e.dmg += dmg; e.head = e.head || h.headshot;
      perBot.set(h.bot, e);
    } else {
      fx('impact', h.point, h.normal, impactKind(h));
      if (h.collider) damageCollider(h.collider, w.dmg, h.point);
    }
  }
  for (const [bot, e] of perBot) dealDamageToBot(bot, e.dmg, e.point, e.head);
}

// ---------- rockets ----------
const rockets = [];
const rocketGeo = new THREE.CylinderGeometry(0.08, 0.1, 0.6, 8).rotateX(Math.PI / 2);
const rocketNose = new THREE.ConeGeometry(0.08, 0.22, 8).rotateX(-Math.PI / 2).translate(0, 0, -0.41);
const rocketMat = new THREE.MeshLambertMaterial({ color: '#6b7d3a' });
const noseMat = new THREE.MeshBasicMaterial({ color: '#ff3b3b' });
const flameMat = new THREE.MeshBasicMaterial({ color: '#ffb347', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
const flameGeo = new THREE.SphereGeometry(0.16, 8, 6);
function spawnRocket(pos, dir) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(rocketGeo, rocketMat);
  const nose = new THREE.Mesh(rocketNose, noseMat);
  const flame = new THREE.Mesh(flameGeo, flameMat);
  flame.position.z = 0.4; flame.scale.set(1, 1, 2.2);
  g.add(body, nose, flame);
  g.position.copy(pos);
  g.quaternion.setFromUnitVectors(new V3(0, 0, -1), dir);
  scene.add(g);
  rockets.push({ g, flame, pos: pos.clone(), dir: dir.clone(), speed: 48, life: 0 });
}
function updateRockets(dt) {
  for (let i = rockets.length - 1; i >= 0; i--) {
    const r = rockets[i];
    r.life += dt;
    const step = r.speed * dt;
    const h = hitscan(r.pos, r.dir, step);
    const prev = r.pos.clone();
    if (h || r.life > 5) {
      explode(h ? h.point.clone().addScaledVector(r.dir, -0.2) : r.pos.clone());
      scene.remove(r.g);
      rockets.splice(i, 1);
      continue;
    }
    r.pos.addScaledVector(r.dir, step);
    r.g.position.copy(r.pos);
    r.flame.scale.set(1 + Math.random() * 0.4, 1 + Math.random() * 0.4, 2 + Math.random());
    fx('tracer', prev, r.pos.clone(), '#ffae5a');
  }
}
function explode(point) {
  const R = WEAPONS[4].radius;
  fx('explosion', point.clone(), R);
  sfx('explosion', point.clone());
  const pd = point.distanceTo(player.getEyePos());
  fx('screenShake', Math.max(0.15, 1.1 - pd / 40));
  for (const b of game.bots) {
    if (!b || !b.alive || !b.pos) continue;
    const d = b.pos.clone().add(new V3(0, 1, 0)).distanceTo(point);
    if (d < R) dealDamageToBot(b, Math.round(WEAPONS[4].dmg * (1 - 0.5 * d / R)), b.pos.clone().add(new V3(0, 1, 0)), false);
  }
  const cp = new V3();
  for (const c of game.colliders.slice()) {
    c.box.clampPoint(point, cp);
    if (cp.distanceTo(point) < R) damageCollider(c, c.kind === 'build' ? 9999 : 120, cp);
  }
  // rocket jump knockback
  const pc = player.pos.clone().add(new V3(0, 0.9, 0));
  const d = pc.distanceTo(point);
  if (d < R && player.alive) {
    const push = pc.sub(point).normalize().multiplyScalar(14 * (1 - d / R));
    player.vel.add(push); player.vel.y += 4 * (1 - d / R);
    player.onGround = false;
  }
}

function updateWeapons(dt) {
  cooldown -= dt;
  bloom = Math.max(0, bloom - dt * 0.09);
  camRecoil *= Math.exp(-dt * 9);
  vmKick *= Math.exp(-dt * 12);
  swapT = Math.max(0, swapT - dt * 4);
  swingT = Math.max(0, swingT - dt * 4);
  const w = WEAPONS[slot];
  if (reloading) {
    reloadT -= dt;
    if (reloadT <= 0) {
      reloading = false;
      const take = Math.min(w.magSize - w.mag, w.reserve);
      w.mag += take; w.reserve -= take;
    }
  }
  if (!game.started || game.over || !player.alive || player.dropping || !locked) { mouse.fresh = false; return; }
  if (buildType) return;
  if (mouse.left && cooldown <= 0 && !reloading) {
    if (!w.auto && !mouse.fresh) return;
    if (w.mag != null && w.mag <= 0) {
      if (mouse.fresh) { if (w.reserve > 0) startReload(); else hud.pickupMessage('OUT OF AMMO'); }
      mouse.fresh = false;
      return;
    }
    fire(w);
    cooldown = 1 / w.rate;
    mouse.fresh = false;
    if (w.mag === 0 && w.reserve > 0) setTimeout(() => { if (WEAPONS[slot] === w && w.mag === 0) startReload(); }, 250);
  }
}

// ================= building (player) =================
const ghostMat = new THREE.MeshBasicMaterial({ color: '#4fb3ff', transparent: true, opacity: 0.38, depthWrite: false });
const ghosts = {};
for (const t of ['wall', 'floor', 'ramp']) {
  const g = makeBuildObject(t, ghostMat);
  g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.add(new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry), new THREE.LineBasicMaterial({ color: '#d8f1ff' }))); } });
  g.visible = false;
  scene.add(g);
  ghosts[t] = g;
}
let buildCooldown = 0;
let currentSnap = null;
function playerBuildTarget(type) {
  const q = ((Math.round(player.yaw / (Math.PI / 2)) % 4) + 4) % 4;
  const qyaw = q * Math.PI / 2;
  const fxr = Math.round(-Math.sin(qyaw)), fzr = Math.round(-Math.cos(qyaw));
  const p = player.pos;
  let tx, tz;
  if (type === 'wall') { tx = p.x + fxr * 2; tz = p.z + fzr * 2; }
  else { tx = p.x + fxr * 4; tz = p.z + fzr * 4; }
  if (type === 'floor' && player.pitch < -0.85) { tx = p.x; tz = p.z; }
  let est = p.y;
  if (player.onRamp) {
    const r = player.onRamp;
    const along = (p.x - r.center.x) * r.rampDir.x + (p.z - r.center.z) * r.rampDir.z;
    const sameDir = r.rampDir.x === fxr && r.rampDir.z === fzr;
    if (type === 'wall') est = r.baseY;
    else est = sameDir ? r.baseY + 4 : r.baseY + Math.max(0, along + 2);
  }
  if (player.pitch > 0.55 && type !== 'ramp') est += 4;
  return snapBuild(type, { x: tx, y: est, z: tz }, player.yaw, est);
}
function updateBuilding(dt) {
  buildCooldown -= dt;
  for (const t in ghosts) ghosts[t].visible = false;
  currentSnap = null;
  if (!buildType || !player.alive || player.dropping || !game.started || game.over) return;
  const s = playerBuildTarget(buildType);
  currentSnap = s;
  const g = ghosts[buildType];
  applyBuildTransform(g, s);
  g.visible = true;
  const ok = mats >= 10 && !slotMap.has(s.key);
  ghostMat.color.set(slotMap.has(s.key) ? '#7fd0ff' : ok ? '#4fb3ff' : '#ff5a6a');
  ghostMat.opacity = slotMap.has(s.key) ? 0.12 : 0.38;
  if (locked && mouse.left && ok && buildCooldown <= 0) {
    const c = placeSnapped(s, 'You');
    if (c) {
      mats -= 10;
      buildCooldown = 0.07;
    }
  } else if (locked && mouse.fresh && mats < 10) hud.pickupMessage('NEED MORE MATS — USE PICKAXE');
  mouse.fresh = false;
}

// ================= player physics =================
const PR = 0.4, PH = 1.8, STEP = 0.55, GRAV = 24;
function overlapXZ(b, x, z, r) { return x > b.min.x - r && x < b.max.x + r && z > b.min.z - r && z < b.max.z + r; }
function resolveXZ(p, feet, height) {
  for (const c of game.colliders) {
    if (c.buildType === 'ramp' || c.hp <= 0) continue;
    const b = c.box;
    if (feet + STEP >= b.max.y || feet + height <= b.min.y) continue;
    const cx = Math.max(b.min.x, Math.min(p.x, b.max.x)), cz = Math.max(b.min.z, Math.min(p.z, b.max.z));
    const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
    if (d2 >= PR * PR) continue;
    if (d2 > 1e-8) { const d = Math.sqrt(d2); p.x += dx / d * (PR - d); p.z += dz / d * (PR - d); }
    else {
      const o = [p.x - b.min.x, b.max.x - p.x, p.z - b.min.z, b.max.z - p.z];
      const m = Math.min(...o);
      if (m === o[0]) p.x = b.min.x - PR; else if (m === o[1]) p.x = b.max.x + PR; else if (m === o[2]) p.z = b.min.z - PR; else p.z = b.max.z + PR;
    }
  }
}
function groundAt(p, maxTop) {
  let h = heightAt(p.x, p.z), ramp = null;
  for (const c of game.colliders) {
    if (c.hp <= 0) continue;
    if (c.buildType === 'ramp') {
      const rh = rampHeight(c, p.x, p.z);
      if (rh !== null && rh <= maxTop + 0.35 && rh > h) { h = rh; ramp = c; }
      continue;
    }
    const b = c.box;
    if (b.max.y <= maxTop && b.max.y > h && overlapXZ(b, p.x, p.z, PR * 0.7)) { h = b.max.y; ramp = null; }
  }
  return { h, ramp };
}

let stepT = 0;
const deathInfo = { killer: null, t: 0 };
function updatePlayer(dt) {
  if (!game.started) return;
  if (!player.alive) { deathInfo.t += dt; return; }
  const k = (c) => (keys[c] ? 1 : 0);
  const ix = locked ? k('KeyD') - k('KeyA') : 0, iz = locked ? k('KeyW') - k('KeyS') : 0;
  const fX = -Math.sin(player.yaw), fZ = -Math.cos(player.yaw), rX = Math.cos(player.yaw), rZ = -Math.sin(player.yaw);
  let wx = fX * iz + rX * ix, wz = fZ * iz + rZ * ix;
  const wl = Math.hypot(wx, wz); if (wl > 0) { wx /= wl; wz /= wl; }
  const p = player.pos, v = player.vel;

  if (player.dropping) {
    player.dropTime += dt;
    const above = p.y - heightAt(p.x, p.z);
    if (!player.gliding && (above < 38 || (keys.Space && player.dropTime > 0.6))) { player.gliding = true; sfx('jump'); fx('screenShake', 0.2); }
    const targetVy = player.gliding ? -7 : (player.pitch < -0.6 ? -40 : -26);
    v.y += (targetVy - v.y) * Math.min(1, dt * 2.2);
    const hs = player.gliding ? 16 : 24;
    v.x += (wx * hs - v.x) * Math.min(1, dt * 2.5);
    v.z += (wz * hs - v.z) * Math.min(1, dt * 2.5);
    const prevFeet = p.y;
    p.x += v.x * dt; p.z += v.z * dt;
    resolveXZ(p, prevFeet, PH);
    p.y += v.y * dt;
    const g = groundAt(p, prevFeet + STEP);
    if (p.y <= g.h) {
      p.y = g.h; v.set(0, 0, 0);
      player.dropping = false; player.gliding = false; player.onGround = true;
      sfx('land'); sfx('dropSettle'); fx('screenShake', 0.35);
      hud.centerMessage('LANDED!<small>Find the Jevs. Bonk the Jevs.</small>', 2000);
    }
    clampMap(p);
    return;
  }

  player.crouching = locked && !!keys.KeyC && player.onGround;
  const sprint = keys.ShiftLeft || keys.ShiftRight;
  let speed = player.crouching ? 3.6 : (sprint && iz > 0 ? 10.5 : 7);
  if (mouse.right && !buildType) speed *= 0.65;
  const accel = player.onGround ? 14 : 2.5;
  v.x += (wx * speed - v.x) * Math.min(1, accel * dt);
  v.z += (wz * speed - v.z) * Math.min(1, accel * dt);
  if (locked && keys.Space && player.onGround) { v.y = 8.6; player.onGround = false; sfx('jump'); }
  v.y -= GRAV * dt;
  if (v.y < -55) v.y = -55;

  const prevFeet = p.y;
  const height = player.crouching ? 1.3 : PH;
  p.x += v.x * dt; p.z += v.z * dt;
  resolveXZ(p, prevFeet, height);
  p.y += v.y * dt;
  if (v.y > 0) {
    for (const c of game.colliders) {
      if (c.buildType === 'ramp' || c.hp <= 0) continue;
      const b = c.box;
      if (b.min.y >= prevFeet + height - 0.05 && b.min.y < p.y + height && overlapXZ(b, p.x, p.z, PR * 0.8)) { p.y = b.min.y - height; v.y = 0; }
    }
  }
  const wasGround = player.onGround;
  const fallV = v.y;
  const g = groundAt(p, Math.max(prevFeet, p.y) + STEP);
  const snap = wasGround && v.y <= 0 ? 0.6 : 0;
  if (p.y < g.h) { p.y = g.h; if (v.y < 0) v.y = 0; player.onGround = v.y <= 0; }
  else if (v.y <= 0 && p.y - g.h <= snap) { p.y = g.h; v.y = 0; player.onGround = true; }
  else player.onGround = false;
  player.onRamp = player.onGround ? g.ramp : null;
  if (!wasGround && player.onGround && fallV < -9) { sfx('land'); fx('screenShake', Math.min(0.4, -fallV / 60)); }
  clampMap(p);

  const hs = Math.hypot(v.x, v.z);
  if (player.onGround && hs > 2) {
    stepT -= dt;
    if (stepT <= 0) { sfx('footstep'); stepT = hs > 9 ? 0.29 : player.crouching ? 0.5 : 0.38; }
  } else stepT = 0.1;
}
function clampMap(p) {
  const L = 148;
  p.x = Math.max(-L, Math.min(L, p.x));
  p.z = Math.max(-L, Math.min(L, p.z));
}

// ================= player model (3rd person) =================
function makePlayerModel() {
  const g = new THREE.Group();
  const M = (c) => new THREE.MeshLambertMaterial({ color: c });
  const hoodie = M('#ff7a1a'), pants = M('#2b2d6e'), skin = M('#f1c27d'), cap = M('#18c9b5'), dark = M('#222233');
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.5, 4, 10), hoodie); body.position.y = 1.08;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 10), skin); head.position.y = 1.64;
  const capTop = new THREE.Mesh(new THREE.SphereGeometry(0.255, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), cap); capTop.position.y = 1.68;
  const brim = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.04, 0.24), cap); brim.position.set(0, 1.69, -0.24);
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.46, 0.2), cap); pack.position.set(0, 1.12, 0.3);
  const legs = [], arms = [];
  for (const sx of [-1, 1]) {
    const lp = new THREE.Group(); lp.position.set(0.13 * sx, 0.62, 0);
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.62, 0.2), pants); l.position.y = -0.31; lp.add(l); legs.push(lp);
    const ap = new THREE.Group(); ap.position.set(0.38 * sx, 1.35, 0);
    const a = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.55, 0.16), hoodie); a.position.y = -0.27; ap.add(a); arms.push(ap);
    g.add(lp, ap);
  }
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.6), dark); gun.position.set(0.25, 1.15, -0.4);
  const glider = new THREE.Group();
  const wingMat = new THREE.MeshLambertMaterial({ color: '#ff3fa4', side: THREE.DoubleSide });
  const wingShape = new THREE.Shape(); wingShape.moveTo(0, -0.9); wingShape.lineTo(1.7, 0.5); wingShape.lineTo(-1.7, 0.5); wingShape.closePath();
  const wing = new THREE.Mesh(new THREE.ShapeGeometry(wingShape), wingMat); wing.rotation.x = -Math.PI / 2;
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.06, 0.18), M('#ffd23f')); stripe.position.z = 0.45;
  const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.9), dark); strut.position.y = -0.45;
  glider.add(wing, stripe, strut); glider.position.y = 2.5; glider.visible = false;
  g.add(body, head, capTop, brim, pack, gun, glider);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return { group: g, legs, arms, glider };
}
const pModel = makePlayerModel();
scene.add(pModel.group);

// ================= viewmodel =================
const vmScene = new THREE.Scene();
const vmCam = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.01, 10);
vmScene.add(new THREE.HemisphereLight('#ffffff', '#6a6a90', 2.0));
const vmSun = new THREE.DirectionalLight('#fff1d6', 1.8); vmSun.position.set(1, 2, 1); vmScene.add(vmSun);
const vmRoot = new THREE.Group(); vmScene.add(vmRoot);
const VM_BASE = new V3(0.3, -0.3, -0.62);
function vmBox(parent, w, h, d, color, x, y, z, emissive) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color, emissive: emissive || '#000000' }));
  m.position.set(x, y, z); parent.add(m); return m;
}
function vmCyl(parent, r, len, color, x, y, z) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10).rotateX(Math.PI / 2), new THREE.MeshLambertMaterial({ color }));
  m.position.set(x, y, z); parent.add(m); return m;
}
const vmModels = [];
{
  const pick = new THREE.Group();
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.75, 8), new THREE.MeshLambertMaterial({ color: '#8a5a2b' }));
  handle.position.set(0, 0.1, -0.05); pick.add(handle);
  const head = new THREE.Group(); head.position.set(0, 0.45, -0.05);
  const h1 = vmBox(head, 0.06, 0.07, 0.34, '#3ff2ff', 0, 0, -0.14, '#0a4a55'); h1.rotation.x = 0.25;
  const h2 = vmBox(head, 0.06, 0.07, 0.22, '#b07bff', 0, 0, 0.1, '#2a1055'); h2.rotation.x = -0.3;
  pick.add(head);
  pick.rotation.set(-0.5, 0.2, -0.35);
  vmModels.push(pick);

  const rifle = new THREE.Group();
  vmBox(rifle, 0.09, 0.12, 0.5, '#2f6fff', 0, 0, 0);
  vmCyl(rifle, 0.022, 0.32, '#222233', 0, 0.02, -0.4);
  const mag = vmBox(rifle, 0.06, 0.18, 0.09, '#1b1b2b', 0, -0.13, -0.05); mag.rotation.x = 0.25;
  vmBox(rifle, 0.07, 0.11, 0.2, '#1d3f99', 0, -0.02, 0.32);
  vmBox(rifle, 0.04, 0.05, 0.12, '#ffd23f', 0, 0.09, -0.05, '#553300');
  vmBox(rifle, 0.05, 0.12, 0.06, '#1b1b2b', 0, -0.1, 0.12);
  vmModels.push(rifle);

  const sg = new THREE.Group();
  vmBox(sg, 0.1, 0.13, 0.42, '#2a9d4a', 0, 0, 0.05);
  vmCyl(sg, 0.035, 0.5, '#2a2a33', 0, 0.03, -0.38);
  const pump = vmBox(sg, 0.08, 0.07, 0.18, '#a0703c', 0, -0.05, -0.32);
  vmBox(sg, 0.08, 0.12, 0.22, '#7a4a24', 0, -0.04, 0.33);
  sg.userData.pump = pump;
  vmModels.push(sg);

  const smg = new THREE.Group();
  vmBox(smg, 0.08, 0.12, 0.34, '#9b4dff', 0, 0, 0);
  vmCyl(smg, 0.02, 0.16, '#222233', 0, 0.02, -0.25);
  vmBox(smg, 0.05, 0.26, 0.06, '#1b1b2b', 0, -0.17, -0.04);
  vmBox(smg, 0.05, 0.11, 0.05, '#1b1b2b', 0, -0.09, 0.1);
  vmBox(smg, 0.03, 0.04, 0.06, '#3ff2ff', 0, 0.08, 0.05, '#0a4a55');
  vmModels.push(smg);

  const rl = new THREE.Group();
  vmCyl(rl, 0.085, 0.85, '#6b7d3a', 0.02, 0.04, -0.05);
  vmCyl(rl, 0.1, 0.1, '#ff8a1f', 0.02, 0.04, -0.47);
  vmCyl(rl, 0.1, 0.08, '#ff8a1f', 0.02, 0.04, 0.37);
  vmBox(rl, 0.05, 0.14, 0.06, '#222233', 0.02, -0.08, 0.05);
  vmBox(rl, 0.04, 0.08, 0.1, '#222233', 0.02, 0.15, -0.1);
  const war = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 8).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: '#ff3b3b' }));
  war.position.set(0.02, 0.04, -0.56); rl.add(war);
  rl.userData.warhead = war;
  vmModels.push(rl);
}
vmModels.forEach((m, i) => { m.visible = i === slot; vmRoot.add(m); });
const vmBuild = new THREE.Group();
{
  const plank = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.04), new THREE.MeshLambertMaterial({ map: plankTex }));
  plank.rotation.set(-0.3, 0.4, 0.1); vmBuild.add(plank);
}
vmBuild.visible = false; vmRoot.add(vmBuild);
let bobT = 0, swayX = 0, swayY = 0;
const vmPos = VM_BASE.clone();

function updateViewmodel(dt) {
  const show = !thirdPerson && player.alive && game.started && !player.dropping;
  vmRoot.visible = show;
  if (!show) return;
  vmModels.forEach((m, i) => { m.visible = !buildType && i === slot; });
  vmBuild.visible = !!buildType;
  const hs = Math.hypot(player.vel.x, player.vel.z);
  const moveAmt = player.onGround ? Math.min(1, hs / 7) : 0.2;
  bobT += dt * (hs > 9 ? 13 : 9) * (moveAmt > 0.05 ? 1 : 0.3);
  swayX += (-mouseDX * 0.0006 - swayX) * Math.min(1, dt * 10);
  swayY += (-mouseDY * 0.0006 - swayY) * Math.min(1, dt * 10);
  mouseDX = 0; mouseDY = 0;
  const ads = mouse.right && !buildType && WEAPONS[slot].id !== 'pickaxe';
  const target = ads ? new V3(0, -0.17, -0.45) : VM_BASE;
  vmPos.lerp(target, Math.min(1, dt * 14));
  vmRoot.position.copy(vmPos);
  const bobA = ads ? 0.25 : 1;
  vmRoot.position.x += Math.sin(bobT) * 0.014 * moveAmt * bobA + swayX * 0.4;
  vmRoot.position.y += Math.abs(Math.cos(bobT)) * 0.014 * moveAmt * bobA - swapT * 0.35 + swayY * 0.4;
  vmRoot.position.z += vmKick * 0.07;
  const reloadTilt = reloading ? Math.sin(Math.min(1, 1 - reloadT / WEAPONS[slot].reload) * Math.PI) * 0.7 : 0;
  vmRoot.rotation.set(vmKick * 0.18 - reloadTilt * 0.5 + swayY, swayX, reloadTilt * 0.6);
  const pick = vmModels[0];
  pick.rotation.set(-0.5 - Math.sin(swingT * Math.PI) * 1.3, 0.2, -0.35 + Math.sin(swingT * Math.PI) * 0.4);
  const sg = vmModels[2];
  if (sg.userData.pump) sg.userData.pump.position.z = -0.32 + Math.max(0, Math.sin(Math.min(1, cooldown * 1.05) * Math.PI)) * 0.1;
  vmModels[4].userData.warhead.visible = WEAPONS[4].mag > 0;
}

// ================= camera =================
let fovCur = 75;
function updateCamera(dt) {
  if (!game.started) {
    const t = performance.now() * 0.00005;
    camera.position.set(Math.cos(t) * 140, 75, Math.sin(t) * 140);
    camera.lookAt(0, 5, 0);
    return;
  }
  const eye = player.getEyePos();
  if (!player.alive) {
    const k = deathInfo.killer;
    if (k && k.pos) {
      const dx = k.pos.x - player.pos.x, dz = k.pos.z - player.pos.z;
      const targetYaw = Math.atan2(-dx, -dz);
      let dy = targetYaw - player.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      player.yaw += dy * Math.min(1, dt * 3);
    }
    player.pitch += (-0.25 - player.pitch) * Math.min(1, dt * 2);
    eye.y = player.pos.y + 1.7 + Math.min(4, deathInfo.t * 2);
  }
  const tp = thirdPerson || player.dropping || !player.alive;
  camera.rotation.set(player.pitch + camRecoil, player.yaw, 0, 'YXZ');
  camera.updateMatrixWorld();
  if (tp) {
    camBasis();
    const dist = player.dropping ? 6 : 3.4;
    const want = eye.clone().addScaledVector(_right, player.dropping ? 0 : 0.7).addScaledVector(_fwd, -dist).add(new V3(0, 0.35, 0));
    const toCam = want.clone().sub(eye);
    const len = toCam.length();
    toCam.normalize();
    const h = raycastWorld(eye, toCam, len);
    camera.position.copy(h ? eye.addScaledVector(toCam, Math.max(0.3, h.distance - 0.3)) : want);
  } else camera.position.copy(eye);
  const so = game.fx?.getShakeOffset?.();
  if (so) camera.position.add(so);
  const sprinting = (keys.ShiftLeft || keys.ShiftRight) && Math.hypot(player.vel.x, player.vel.z) > 9;
  const w = WEAPONS[slot];
  const targetFov = mouse.right && !buildType && w.fov ? w.fov : player.dropping ? 85 : sprinting ? 82 : 75;
  fovCur += (targetFov - fovCur) * Math.min(1, dt * 12);
  if (Math.abs(camera.fov - fovCur) > 0.01) { camera.fov = fovCur; camera.updateProjectionMatrix(); }
  camera.updateMatrixWorld();

  // player model
  pModel.group.visible = tp && player.alive;
  if (pModel.group.visible) {
    pModel.group.position.copy(player.pos);
    pModel.group.rotation.y = player.yaw;
    const hs = Math.hypot(player.vel.x, player.vel.z);
    const sw = player.onGround ? Math.sin(performance.now() * 0.012 * (hs > 9 ? 1.4 : 1)) * Math.min(1, hs / 7) * 0.8 : 0.3;
    pModel.legs[0].rotation.x = sw; pModel.legs[1].rotation.x = -sw;
    pModel.arms[0].rotation.x = -sw * 0.6; pModel.arms[1].rotation.x = -1.2;
    pModel.glider.visible = player.gliding;
    pModel.group.rotation.x = player.dropping && !player.gliding ? -0.9 : 0;
  }
  sky.position.copy(camera.position);
  sun.position.copy(player.pos).addScaledVector(SUN_DIR, 150);
  sun.target.position.copy(player.pos);
}

// ================= storm =================
const STORM_PHASES = [
  { wait: 30, shrink: 25, radius: 120, dps: 1 },
  { wait: 30, shrink: 25, radius: 65, dps: 2 },
  { wait: 25, shrink: 25, radius: 30, dps: 5 },
  { wait: 20, shrink: 25, radius: 8, dps: 10 },
];
const stormWall = new THREE.Mesh(
  new THREE.CylinderGeometry(1, 1, 260, 96, 1, true),
  new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: `varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uTime; varying vec2 vUv; varying vec3 vW;
      void main(){
        float s = 0.5 + 0.5 * sin(vUv.x * 520.0 + vW.y * 0.12 - uTime * 2.0);
        float b = 0.5 + 0.5 * sin(vW.y * 0.3 + uTime * 3.0 + vUv.x * 80.0);
        float fade = smoothstep(190.0, 10.0, vW.y);
        float edge = smoothstep(-40.0, 0.0, vW.y);
        vec3 col = mix(vec3(0.35, 0.05, 0.85), vec3(0.95, 0.45, 1.0), s * b);
        gl_FragColor = vec4(col * (0.35 + 0.45 * s * b) * fade * edge, 1.0);
        #include <colorspace_fragment>
      }`,
  })
);
stormWall.position.y = 90;
stormWall.renderOrder = 5;
scene.add(stormWall);

const storm = game.storm;
const stormState = { idx: 0, stage: 'wait', t: 0, fromC: new V3(), fromR: 220, tickT: 1 };
function beginWait(i) {
  const ph = STORM_PHASES[i];
  stormState.idx = i; stormState.stage = 'wait'; stormState.t = 0;
  const maxOff = Math.max(0, storm.radius - ph.radius);
  const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * maxOff;
  const L = Math.max(10, 125 - ph.radius);
  storm.nextCenter = new V3(
    Math.max(-L, Math.min(L, storm.center.x + Math.cos(a) * d)), 0,
    Math.max(-L, Math.min(L, storm.center.z + Math.sin(a) * d)));
  storm.nextRadius = ph.radius;
  storm.damagePerSec = ph.dps;
  storm.phase = i + 1;
  if (i > 0) hud.centerMessage(`STORM PHASE ${i + 1}<small>Get to the safe zone!</small>`, 2200);
}
function updateStorm(dt) {
  stormWall.material.uniforms.uTime.value += dt;
  stormWall.position.x = storm.center.x; stormWall.position.z = storm.center.z;
  stormWall.scale.set(Math.max(0.1, storm.radius), 1, Math.max(0.1, storm.radius));
  if (!game.started || game.over) return;
  const st = stormState;
  st.t += dt;
  if (st.stage === 'wait') {
    const ph = STORM_PHASES[st.idx];
    storm.label = `PHASE ${st.idx + 1}/${STORM_PHASES.length} — STORM CLOSING IN`;
    storm.timer = ph.wait - st.t; storm.shrinking = false;
    if (st.t >= ph.wait) { st.stage = 'shrink'; st.t = 0; st.fromC.copy(storm.center); st.fromR = storm.radius; hud.centerMessage('THE STORM IS SHRINKING!', 2000); }
  } else if (st.stage === 'shrink') {
    const ph = STORM_PHASES[st.idx];
    const k = Math.min(1, st.t / ph.shrink);
    storm.center.lerpVectors(st.fromC, storm.nextCenter, k);
    storm.radius = st.fromR + (ph.radius - st.fromR) * k;
    storm.label = `PHASE ${st.idx + 1}/${STORM_PHASES.length} — SHRINKING`;
    storm.timer = ph.shrink - st.t; storm.shrinking = true;
    if (k >= 1) {
      if (st.idx + 1 < STORM_PHASES.length) beginWait(st.idx + 1);
      else { st.stage = 'final'; st.t = 0; st.fromR = storm.radius; storm.nextRadius = 0; storm.nextCenter = storm.center.clone(); hud.centerMessage('FINAL COLLAPSE!', 2200); }
    }
  } else {
    const k = Math.min(1, st.t / 40);
    storm.radius = st.fromR * (1 - k);
    storm.damagePerSec = 10 + Math.floor(st.t / 10) * 5;
    storm.label = 'FINAL COLLAPSE'; storm.timer = 40 - st.t; storm.shrinking = true;
  }
  st.tickT -= dt;
  if (st.tickT <= 0) {
    st.tickT += 1;
    const out = (pos) => Math.hypot(pos.x - storm.center.x, pos.z - storm.center.z) > storm.radius;
    if (player.alive && !player.dropping && out(player.pos)) { damagePlayer(storm.damagePerSec, null, 'The Storm'); sfx('stormTick'); }
  }
}
function inStorm() { return Math.hypot(player.pos.x - storm.center.x, player.pos.z - storm.center.z) > storm.radius; }

// ================= loot pickup =================
function onPickup(type, label) {
  if (type === 'shield') { if (player.shield >= 100) return false; player.shield = Math.min(100, player.shield + 50); }
  else if (type === 'medkit') { if (player.health >= 100) return false; player.health = Math.min(100, player.health + 50); }
  else if (type === 'ammo') { WEAPONS[1].reserve += 60; WEAPONS[2].reserve += 10; WEAPONS[3].reserve += 60; WEAPONS[4].reserve += 2; }
  else if (type === 'mats') { mats = Math.min(999, mats + 50); hud.flashMats(); }
  sfx('pickup');
  hud.pickupMessage(label);
  return true;
}

// ================= flow =================
function startMatch() {
  if (game.started) return;
  game.started = true;
  game.time = 0;
  document.getElementById('start-screen').classList.add('hidden');
  hud.show();
  const a = Math.random() * Math.PI * 2, d = 30 + Math.random() * 70;
  player.pos.set(Math.cos(a) * d, 120, Math.sin(a) * d);
  player.vel.set(0, -10, 0);
  player.yaw = Math.atan2(player.pos.x, player.pos.z);
  player.pitch = -0.5;
  player.dropping = true;
  beginWait(0);
  hud.centerMessage('DROP IN!<small>SPACE to deploy glider early</small>', 2500);
}
function victory() {
  game.over = true;
  stats.placement = 1;
  sfx('victory');
  fx('screenShake', 0.5);
  hud.centerMessage('#1 JEV SLAYER!<small>Last one standing</small>', 3000);
  setTimeout(() => { document.exitPointerLock?.(); hud.showEnd(true, { ...stats, time: game.time }); }, 2800);
}

function pokeLobby() { if (!game.started) sfx('lobby'); }
window.addEventListener('pointerdown', (e) => {
  if (e.target.closest && e.target.closest('#drop-btn')) return;
  pokeLobby();
});
window.addEventListener('keydown', pokeLobby);

document.getElementById('drop-btn').addEventListener('click', () => {
  sfx('unlock');
  sfx('depart');
  lock();
  startMatch();
});
document.getElementById('resume-btn').addEventListener('click', () => { sfx('unlock'); lock(); });
document.getElementById('again-btn').addEventListener('click', () => location.reload());

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
  vmCam.aspect = camera.aspect; vmCam.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ================= load companion modules =================
try {
  const { createFX } = await import('./fx.js');
  game.fx = createFX(game) || {};
  sfx('lobby');
} catch (e) { console.error('[Jev Royale] fx.js failed to load/init:', e); game.fx = {}; }
try {
  const { createBots } = await import('./bots.js');
  game.botManager = createBots(game, 5) || null;
  if (game.botManager?.bots && game.bots !== game.botManager.bots) game.bots = game.botManager.bots;
} catch (e) { console.error('[Jev Royale] bots.js failed to load/init:', e); }

// ================= main loop =================
const fogTarget = new THREE.Color();
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  if (game.started && !game.over) game.time += dt;

  safe('player', () => updatePlayer(dt));
  safe('camera', () => updateCamera(dt));
  safe('weapons', () => updateWeapons(dt));
  safe('building', () => updateBuilding(dt));
  safe('rockets', () => updateRockets(dt));
  safe('buildAnims', () => updateBuildAnims(dt));
  safe('storm', () => updateStorm(dt));
  if (game.started && !(game.over && player.alive)) safe('bots', () => game.botManager?.update?.(dt));
  safe('fx', () => game.fx?.update?.(dt));
  safe('loot', () => loot.update(dt, performance.now() / 1000, onPickup));
  safe('viewmodel', () => updateViewmodel(dt));

  if (game.started && !game.over && player.alive && game.bots.length > 0 && aliveCount() === 0) victory();

  const outside = game.started && player.alive && inStorm();
  fogTarget.copy(outside ? STORM_FOG : FOG_COLOR);
  scene.fog.color.lerp(fogTarget, Math.min(1, dt * 3));
  scene.fog.near += ((outside ? 5 : 90) - scene.fog.near) * Math.min(1, dt * 3);
  scene.fog.far += ((outside ? 120 : 430) - scene.fog.far) * Math.min(1, dt * 3);

  safe('hud', () => {
    if (!game.started) return;
    const w = WEAPONS[slot];
    let modeText = '';
    if (player.dropping) modeText = player.gliding ? 'GLIDING — WASD TO STEER' : 'SKYDIVING — SPACE TO GLIDE, LOOK DOWN TO DIVE';
    else if (buildType) modeText = mats >= 10 ? `BUILD ${buildType.toUpperCase()} — CLICK TO PLACE (10 MATS)` : 'NOT ENOUGH MATS — PICKAXE STUFF!';
    else if (reloading) modeText = 'RELOADING...';
    const spreadPx = w.melee ? 0 : ((w.spread || 0) + bloom) * (mouse.right ? 0.45 : 1) * 500 + (player.onGround ? 0 : 6);
    hud.update({ aliveCount: aliveCount(), kills: stats.kills, mats, slot, buildType, weapons: WEAPONS, reloading, spreadPx, modeText, inStorm: outside });
  });

  renderer.clear();
  renderer.render(scene, camera);
  if (vmRoot.visible) { renderer.clearDepth(); renderer.render(vmScene, vmCam); }
}
requestAnimationFrame(frame);
