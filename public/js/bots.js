// Jev Royale — Jev bot models + AI.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const PI = Math.PI;
const TAU = PI * 2;
const GRAVITY = 25;
const JUMP_VEL = 8;
const STEP_HEIGHT = 0.65;
const BOT_RADIUS = 0.42;
const EYE_HEIGHT = 1.55;
const PLAYER_RADIUS = 0.45;
const PLAYER_HEIGHT = 1.8;
const MAX_SHIELD = 100;
const MAX_HEALTH = 100;

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------
// `weapon` is the sfx-compatible name exposed on the bot; `gun` picks stats below.
const WEAPONS = {
  rifle:   { weapon: 'rifle',   dmg: 13, pellets: 1, interval: 0.2,   burst: 4, pause: [0.8, 1.3],  range: 110, spread: 0.012, falloff: [35, 110], engage: 55 },
  smg:     { weapon: 'smg',     dmg: 7,  pellets: 1, interval: 0.085, burst: 7, pause: [0.7, 1.1],  range: 60,  spread: 0.03,  falloff: [15, 60],  engage: 38 },
  shotgun: { weapon: 'shotgun', dmg: 9,  pellets: 7, interval: 1.05,  burst: 1, pause: [1.0, 1.35], range: 32,  spread: 0.075, falloff: [6, 32],   engage: 24 },
  dmr:     { weapon: 'rifle',   dmg: 24, pellets: 1, interval: 0.32,  burst: 2, pause: [1.5, 2.1],  range: 160, spread: 0.004, falloff: [80, 160], engage: 100 },
};

const JEVS = [
  {
    name: 'Jev', color: '#ff7a1a', visor: '#5ff7ff',
    personality: "the original Jev, confident and smug, calls everyone 'default'",
    gun: 'rifle', accuracy: 0.72, reaction: [0.45, 0.7], speed: 5.6, turn: 8,
    buildChance: 0.35, boxUp: false, rampy: 0.12, buildCd: 4, jumpiness: 0.25,
    range: [14, 32], strafe: [0.7, 1.5], sight: 70, headChance: 0.1,
  },
  {
    name: 'Jev Prime', color: '#9b5cff', visor: '#ff66ff',
    personality: "a sweaty tryhard who builds constantly and brags about his 'cracked' edits",
    gun: 'smg', accuracy: 0.78, reaction: [0.35, 0.55], speed: 5.8, turn: 10,
    buildChance: 0.85, boxUp: true, rampy: 0.45, buildCd: 2.2, jumpiness: 0.35,
    range: [8, 22], strafe: [0.5, 1.1], sight: 70, headChance: 0.15,
  },
  {
    name: 'Lil Jev', color: '#6dff3a', visor: '#fff04a',
    personality: 'a hyperactive little kid Jev who screams and uses lots of caps',
    gun: 'shotgun', accuracy: 0.45, reaction: [0.5, 0.8], speed: 6.6, turn: 11,
    buildChance: 0.15, boxUp: false, rampy: 0.05, buildCd: 5, jumpiness: 0.85,
    range: [2.5, 8], strafe: [0.35, 0.8], sight: 65, headChance: 0.05, scale: 0.88,
  },
  {
    name: 'Jev.exe', color: '#ff2a4d', visor: '#ff1030',
    personality: 'a glitchy corrupted robot Jev who speaks in ominous glitchy fragments',
    gun: 'dmr', accuracy: 0.9, reaction: [0.55, 0.8], speed: 4.8, turn: 5,
    buildChance: 0.3, boxUp: false, rampy: 0.05, buildCd: 5, jumpiness: 0.08,
    range: [40, 85], strafe: [1.2, 2.4], sight: 110, headChance: 0.3, glitch: true,
  },
  {
    name: 'Chill Jev', color: '#2ad8ff', visor: '#7dffdf',
    personality: "a laid-back surfer Jev who is way too relaxed, says 'bro' and 'vibes'",
    gun: 'smg', accuracy: 0.66, reaction: [0.4, 0.65], speed: 5.2, turn: 7,
    buildChance: 0.3, boxUp: false, rampy: 0.1, buildCd: 4, jumpiness: 0.3,
    range: [10, 26], strafe: [0.8, 1.6], sight: 70, headChance: 0.08, passive: true,
  },
];

// ---------------------------------------------------------------------------
// Temps (never hold onto these across calls)
// ---------------------------------------------------------------------------
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _teye = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _pdir = new THREE.Vector3();
const _end = new THREE.Vector3();
const _sph = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);
const WHITE = new THREE.Color(1, 1, 1);

const ownRamps = new WeakSet();

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const angleDiff = (a, b) => {
  let d = (a - b) % TAU;
  if (d > PI) d -= TAU;
  if (d < -PI) d += TAU;
  return d;
};
const damp = (cur, target, rate, dt) => cur + (target - cur) * Math.min(1, rate * dt);

function raySphere(o, d, c, r, maxDist) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const h = b * b - cc;
  if (h < 0) return -1;
  const s = Math.sqrt(h);
  let t = -b - s;
  if (t < 0) t = -b + s;
  if (t < 0 || t > maxDist) return -1;
  return t;
}

// Ray vs vertical capsule (axis segment y0..y1 at cx,cz).
function rayCapsuleY(o, d, cx, cz, y0, y1, r, maxDist) {
  let best = -1;
  const ox = o.x - cx, oz = o.z - cz;
  const a = d.x * d.x + d.z * d.z;
  if (a > 1e-8) {
    const b = ox * d.x + oz * d.z;
    const c = ox * ox + oz * oz - r * r;
    const h = b * b - a * c;
    if (h >= 0) {
      const t = (-b - Math.sqrt(h)) / a;
      if (t >= 0 && t <= maxDist) {
        const y = o.y + t * d.y;
        if (y >= y0 && y <= y1) best = t;
      }
    }
  }
  _sph.set(cx, y0, cz);
  let t = raySphere(o, d, _sph, r, maxDist);
  if (t >= 0 && (best < 0 || t < best)) best = t;
  _sph.set(cx, y1, cz);
  t = raySphere(o, d, _sph, r, maxDist);
  if (t >= 0 && (best < 0 || t < best)) best = t;
  return best;
}

function isRamp(c) {
  if (ownRamps.has(c)) return true;
  if (c.type === 'ramp' || c.buildType === 'ramp' || c.piece === 'ramp' || c.subtype === 'ramp') return true;
  const ud = c.mesh?.userData;
  if (ud && (ud.type === 'ramp' || ud.buildType === 'ramp' || ud.piece === 'ramp')) return true;
  const n = c.mesh?.name;
  return typeof n === 'string' && n.toLowerCase().includes('ramp');
}

const isShootable = (c) => c && (c.kind === 'build' || c.kind === 'prop');

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------
let GEO = null;
function getGeo() {
  if (GEO) return GEO;
  GEO = {
    hoodie: new RoundedBoxGeometry(0.78, 0.7, 0.5, 4, 0.14),
    hoodieBand: new RoundedBoxGeometry(0.8, 0.12, 0.52, 2, 0.05),
    pocket: new RoundedBoxGeometry(0.42, 0.16, 0.06, 2, 0.03),
    hood: new THREE.SphereGeometry(0.34, 16, 10, 0, TAU, 0, PI * 0.6),
    helmet: new THREE.SphereGeometry(0.34, 24, 18),
    visor: new THREE.SphereGeometry(0.352, 24, 12, PI / 2 - 1.0, 2.0, 1.2, 0.62),
    ear: new THREE.CylinderGeometry(0.09, 0.09, 0.08, 14),
    antenna: new THREE.CylinderGeometry(0.018, 0.022, 0.24, 6),
    orb: new THREE.SphereGeometry(0.065, 12, 10),
    string: new THREE.CylinderGeometry(0.015, 0.015, 0.2, 5),
    emblem: new THREE.PlaneGeometry(0.3, 0.3),
    sleeve: new THREE.CapsuleGeometry(0.115, 0.3, 4, 10),
    hand: new THREE.SphereGeometry(0.1, 10, 8),
    leg: new THREE.CapsuleGeometry(0.12, 0.36, 4, 10),
    shoe: new RoundedBoxGeometry(0.25, 0.16, 0.38, 2, 0.06),
    sole: new RoundedBoxGeometry(0.27, 0.06, 0.4, 2, 0.025),
    glider: new THREE.ConeGeometry(1.5, 0.55, 10, 1, true),
    gliderBar: new THREE.CylinderGeometry(0.015, 0.015, 1.1, 4),
    box: new THREE.BoxGeometry(1, 1, 1),
    barrel: new THREE.CylinderGeometry(1, 1, 1, 10),
  };
  return GEO;
}

function makeCanvasTexture(w, h, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { canvas, ctx, tex };
}

function buildGun(kind, mats) {
  const G = getGeo();
  const gun = new THREE.Group();
  gun.name = 'gun';
  const add = (geo, mat, sx, sy, sz, x, y, z, rx = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.scale.set(sx, sy, sz);
    m.position.set(x, y, z);
    m.rotation.x = rx;
    m.castShadow = true;
    gun.add(m);
    return m;
  };
  let tip = 0.5;
  if (kind === 'shotgun') {
    add(G.box, mats.gunDark, 0.13, 0.15, 0.42, 0, 0.03, 0.12);
    add(G.barrel, mats.gunDark, 0.045, 0.32, 0.045, -0.032, 0.06, 0.48, PI / 2);
    add(G.barrel, mats.gunDark, 0.045, 0.32, 0.045, 0.032, 0.06, 0.48, PI / 2);
    add(G.box, mats.accent, 0.14, 0.05, 0.2, 0, -0.04, 0.38);
    add(G.box, mats.gunDark, 0.1, 0.16, 0.12, 0, -0.06, -0.12);
    tip = 0.65;
  } else if (kind === 'smg') {
    add(G.box, mats.gunDark, 0.11, 0.14, 0.36, 0, 0.03, 0.08);
    add(G.barrel, mats.gunDark, 0.028, 0.16, 0.028, 0, 0.05, 0.33, PI / 2);
    add(G.box, mats.accent, 0.06, 0.22, 0.07, 0, -0.12, 0.12);
    add(G.box, mats.accent, 0.115, 0.03, 0.3, 0, 0.1, 0.08);
    tip = 0.42;
  } else {
    const long = kind === 'dmr';
    add(G.box, mats.gunDark, 0.11, 0.15, 0.5, 0, 0.03, 0.15);
    add(G.barrel, mats.gunDark, 0.03, long ? 0.46 : 0.3, 0.03, 0, 0.05, long ? 0.62 : 0.55, PI / 2);
    add(G.box, mats.accent, 0.07, 0.18, 0.09, 0, -0.1, 0.18);
    add(G.box, mats.accent, 0.115, 0.03, 0.42, 0, 0.11, 0.15);
    add(G.box, mats.gunDark, 0.09, 0.14, 0.2, 0, -0.01, -0.18);
    if (long) {
      add(G.barrel, mats.gunDark, 0.045, 0.24, 0.045, 0, 0.17, 0.15, PI / 2);
      add(G.barrel, mats.visor, 0.035, 0.01, 0.035, 0, 0.17, 0.275, PI / 2);
    }
    tip = long ? 0.86 : 0.71;
  }
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.05, tip);
  gun.add(muzzle);
  gun.userData.muzzle = muzzle;
  return gun;
}

function buildJevModel(profile) {
  const G = getGeo();
  const accent = new THREE.Color(profile.color);
  const visorColor = new THREE.Color(profile.visor);
  const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.05, ...extra });
  const mats = {
    hoodie: std(accent),
    hoodieDark: std(accent.clone().multiplyScalar(0.62)),
    helmet: std('#eef1f5', { roughness: 0.35, metalness: 0.15 }),
    trim: std('#23262d'),
    visor: new THREE.MeshStandardMaterial({ color: visorColor.clone().multiplyScalar(0.35), emissive: visorColor, emissiveIntensity: 1.7, roughness: 0.15, metalness: 0.4 }),
    orb: new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 2, roughness: 0.3 }),
    shoe: std('#f7f7f7'),
    glove: std('#2b2e36'),
    gunDark: std('#30343c', { metalness: 0.4, roughness: 0.45 }),
    accent: std(accent, { emissive: accent, emissiveIntensity: 0.25 }),
    glider: std(accent, { side: THREE.DoubleSide, transparent: true, opacity: 0.92 }),
  };

  const emblemTex = makeCanvasTexture(128, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.font = '900 112px "Arial Black", Impact, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 12;
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.strokeText('J', w / 2 + 2, h / 2 + 6);
    ctx.fillStyle = '#ffffff';
    ctx.fillText('J', w / 2 + 2, h / 2 + 6);
  }).tex;
  mats.emblem = new THREE.MeshStandardMaterial({ map: emblemTex, transparent: true, roughness: 0.5, emissive: '#ffffff', emissiveIntensity: 0.15, emissiveMap: emblemTex });

  const mesh = (geo, mat, parent, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };

  const root = new THREE.Group();
  root.name = `Jev:${profile.name}`;
  const body = new THREE.Group();
  body.name = 'body';
  root.add(body);
  const s = profile.scale || 1;
  body.scale.setScalar(s);

  // legs
  const legs = [];
  for (const side of [1, -1]) {
    const leg = new THREE.Group();
    leg.name = side > 0 ? 'leftLeg' : 'rightLeg';
    leg.position.set(0.18 * side, 0.72, 0);
    mesh(G.leg, mats.trim, leg, 0, -0.3, 0);
    mesh(G.shoe, mats.shoe, leg, 0, -0.62, 0.05);
    mesh(G.sole, mats.hoodie, leg, 0, -0.7, 0.05);
    body.add(leg);
    legs.push(leg);
  }

  // torso
  const torso = new THREE.Group();
  torso.name = 'torso';
  torso.position.set(0, 0.72, 0);
  body.add(torso);
  mesh(G.hoodie, mats.hoodie, torso, 0, 0.38, 0);
  mesh(G.hoodieBand, mats.hoodieDark, torso, 0, 0.05, 0);
  mesh(G.pocket, mats.hoodieDark, torso, 0, 0.2, 0.25);
  const hood = mesh(G.hood, mats.hoodieDark, torso, 0, 0.66, -0.18);
  hood.scale.set(1.15, 0.75, 0.8);
  hood.rotation.x = -0.5;
  mesh(G.string, mats.shoe, torso, -0.09, 0.6, 0.255);
  mesh(G.string, mats.shoe, torso, 0.09, 0.6, 0.255);
  const emblem = mesh(G.emblem, mats.emblem, torso, 0, 0.44, 0.252);
  emblem.castShadow = false;

  // head
  const head = new THREE.Group();
  head.name = 'head';
  head.position.set(0, 0.76, 0);
  torso.add(head);
  const helmet = mesh(G.helmet, mats.helmet, head, 0, 0.1, 0);
  helmet.scale.set(1.08, 1, 1.02);
  const visor = mesh(G.visor, mats.visor, head, 0, 0.1, 0);
  visor.scale.set(1.08, 1, 1.02);
  visor.castShadow = false;
  for (const side of [1, -1]) {
    const ear = mesh(G.ear, mats.hoodie, head, 0.36 * side, 0.1, 0);
    ear.rotation.z = PI / 2;
  }
  const antenna = new THREE.Group();
  antenna.position.set(0.08, 0.42, -0.02);
  antenna.rotation.z = -0.18;
  head.add(antenna);
  mesh(G.antenna, mats.trim, antenna, 0, 0.1, 0);
  const orb = mesh(G.orb, mats.orb, antenna, 0, 0.24, 0);
  orb.castShadow = false;

  // arms
  const arms = [];
  for (const side of [1, -1]) {
    const arm = new THREE.Group();
    arm.name = side > 0 ? 'leftArm' : 'rightArm';
    arm.position.set(0.47 * side, 0.6, 0);
    mesh(G.sleeve, mats.hoodie, arm, 0, -0.24, 0);
    mesh(G.hand, mats.glove, arm, 0, -0.5, 0);
    torso.add(arm);
    arms.push(arm);
  }
  const [leftArm, rightArm] = arms;
  const gun = buildGun(profile.gun, mats);
  gun.position.set(0, -0.52, 0);
  gun.rotation.x = PI / 2;
  rightArm.add(gun);

  // glider for the sky drop
  const glider = new THREE.Group();
  glider.position.set(0, 2.6, 0);
  const canopy = mesh(G.glider, mats.glider, glider, 0, 0, 0);
  canopy.scale.set(1, 1, 0.75);
  for (const side of [1, -1]) {
    const bar = mesh(G.gliderBar, mats.trim, glider, 0.5 * side, -0.55, 0);
    bar.rotation.z = 0.7 * side;
  }
  glider.visible = false;
  body.add(glider);

  // flashable materials (hurt flash)
  const flashMats = [mats.hoodie, mats.hoodieDark, mats.helmet, mats.trim, mats.shoe, mats.glove, mats.gunDark];
  const flashBase = flashMats.map((m) => ({ color: m.emissive.clone(), intensity: m.emissiveIntensity }));

  return {
    root, body, torso, head, leftArm, rightArm, leftLeg: legs[0], rightLeg: legs[1],
    gun, muzzle: gun.userData.muzzle, visor, orb, glider, mats, flashMats, flashBase,
  };
}

// ---------------------------------------------------------------------------
// Bot
// ---------------------------------------------------------------------------
class Bot {
  constructor(game, profile, index, manager) {
    this.game = game;
    this.manager = manager;
    this.profile = profile;
    this.index = index;
    this.name = profile.name;
    this.color = profile.color;
    this.personality = profile.personality;
    this.w = WEAPONS[profile.gun];
    this.weapon = this.w.weapon;
    this.gunKind = profile.gun;

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = Math.random() * TAU;
    this.health = MAX_HEALTH;
    this.shield = 50;
    this.alive = true;
    this.state = 'DROP';
    this.kills = 0;

    this.rig = buildJevModel(profile);
    this.mesh = this.rig.root;
    this.mesh.userData.bot = this;
    this.mesh.traverse((o) => { o.userData.bot = this; });
    game.scene?.add(this.mesh);
    this.makeLabels();

    // AI state
    this.speed = profile.speed;
    this.target = null;
    this.canSee = false;
    this.lostTime = 99;
    this.lastSeenPos = new THREE.Vector3();
    this.blocker = null;
    this.blockPoint = new THREE.Vector3();
    this.losTimer = Math.random() * 0.15;
    this.retargetTimer = Math.random() * 0.4;
    this.stickTimer = 0;
    this.reactionTimer = 0;
    this.aimWarm = 0;
    this.aimPitch = 0;
    this.cooldown = 0;
    this.burstLeft = this.w.burst;
    this.aggroTarget = null;
    this.aggroTimer = 0;
    this.provoked = false;
    this.strafeDir = Math.random() < 0.5 ? -1 : 1;
    this.strafeTimer = 0;
    this.jumpTimer = rand(1, 3);
    this.waypoint = null;
    this.waypointV = new THREE.Vector3();
    this.lootPause = 0;
    this.flankTimer = 0;
    this.flankPoint = new THREE.Vector3();
    this.stuckTimer = 0;
    this.stuckCheck = 0.5;
    this.stuckRef = new THREE.Vector3();
    this.blocked = false;
    this.grounded = false;
    this.buildCooldown = 0;
    this.buildPose = 0;
    this.stateTimer = 0;
    this.rampRush = 0;
    this.boxTimer = 0;
    this.healCount = 0;
    this.healTimer = 0;
    this.retreatCooldown = 0;
    this.emoteTimer = 0;
    this.idleEmoteTimer = rand(12, 25);
    this.tauntTimer = rand(25, 40);
    this.gotHitChatCd = 0;
    this.builtChatCd = 0;
    this.lastHitTime = -99;
    this.clock = 0;
    this.wish = new THREE.Vector3();
    this.wishSpeed = 0;
    this.rampY = -Infinity;

    // animation state
    this.runPhase = Math.random() * TAU;
    this.recoil = 0;
    this.flinch = 0;
    this.flinchSide = 1;
    this.flash = 0;
    this.glitchT = 0;
    this.anim = { lLeg: 0, rLeg: 0, lArmX: 0, rArmX: 0, lArmZ: 0, rArmZ: 0, bodyX: 0, bodyZ: 0, headX: 0, bodyY: 0 };
    this.spinY = 0;

    // death
    this.deathT = 0;
    this.removed = false;
    this.deathReported = false;
    this.deathDir = 1;

    // drop
    this.dropDelay = 0;
    this.landing = new THREE.Vector3();
  }

  // ----- labels -----
  makeLabels() {
    const { tex: nameTex } = makeCanvasTexture(256, 64, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.font = 'bold 36px "Trebuchet MS", "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 8;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.strokeText(this.name, w / 2, h / 2);
      ctx.fillStyle = this.color;
      ctx.fillText(this.name, w / 2, h / 2);
    });
    const nameMat = new THREE.SpriteMaterial({ map: nameTex, transparent: true, depthWrite: false });
    this.nameplate = new THREE.Sprite(nameMat);
    this.nameplate.scale.set(1.7, 0.425, 1);
    this.nameplate.position.set(0, 2.45, 0);
    this.nameplate.renderOrder = 10;
    this.mesh.add(this.nameplate);

    const bar = makeCanvasTexture(128, 20, () => {});
    this.barCtx = bar.ctx;
    this.barTex = bar.tex;
    const barMat = new THREE.SpriteMaterial({ map: bar.tex, transparent: true, depthWrite: false });
    this.bar = new THREE.Sprite(barMat);
    this.bar.scale.set(1.1, 0.17, 1);
    this.bar.position.set(0, 2.2, 0);
    this.bar.renderOrder = 10;
    this.mesh.add(this.bar);
    this.barKey = '';
    this.drawBars();
  }

  drawBars() {
    const h = Math.max(0, Math.ceil(this.health));
    const s = Math.max(0, Math.ceil(this.shield));
    const key = h + ':' + s;
    if (key === this.barKey) return;
    this.barKey = key;
    const ctx = this.barCtx;
    ctx.clearRect(0, 0, 128, 20);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, 128, 20);
    ctx.fillStyle = '#3aa8ff';
    ctx.fillRect(2, 2, 124 * (s / MAX_SHIELD), 6);
    ctx.fillStyle = h > 60 ? '#5dff6a' : h > 30 ? '#ffd23a' : '#ff4a4a';
    ctx.fillRect(2, 10, 124 * (h / MAX_HEALTH), 8);
    this.barTex.needsUpdate = true;
  }

  // ----- helpers -----
  eyePos(out) {
    return out.set(this.pos.x, this.pos.y + EYE_HEIGHT * (this.profile.scale || 1), this.pos.z);
  }

  targetIsPlayer(t = this.target) {
    return t === this.game.player;
  }

  entityAlive(t) {
    if (!t) return false;
    if (t === this.game.player) return !!t.alive;
    return !!t.alive && t.state !== 'DROP';
  }

  entityEye(t, out) {
    if (t === this.game.player) return out.set(t.pos.x, t.pos.y + 1.6, t.pos.z);
    return t.eyePos(out);
  }

  distTo(t) {
    return Math.hypot(t.pos.x - this.pos.x, t.pos.z - this.pos.z);
  }

  findByName(name) {
    if (!name) return null;
    const p = this.game.player;
    if (name === 'You' || name === p?.name) return p;
    return this.manager.bots.find((b) => b.name === name) || null;
  }

  chat(event, extra) {
    const ctx = {
      hp: Math.round(this.health),
      shield: Math.round(this.shield),
      weapon: this.weapon,
      target: this.target ? this.target.name : null,
      distance: this.target ? Math.round(this.distTo(this.target)) : null,
      ...extra,
    };
    try { this.game.jevChat?.(this, event, ctx); } catch (e) { /* chat is best effort */ }
  }

  groundAt(x, z) {
    return this.game.world?.heightAt ? this.game.world.heightAt(x, z) : 0;
  }

  // Line of sight from my eye to the entity's eye. Returns true if visible; sets this.blocker.
  los(t) {
    const g = this.game;
    this.eyePos(_eye);
    this.entityEye(t, _teye);
    _dir.subVectors(_teye, _eye);
    const dist = _dir.length();
    if (dist < 0.01) return true;
    _dir.multiplyScalar(1 / dist);
    const hit = g.raycastWorld ? g.raycastWorld(_eye, _dir, dist) : null;
    if (!hit || hit.distance >= dist - 0.3) {
      this.blocker = null;
      return true;
    }
    this.blocker = hit.collider || null;
    if (hit.point) this.blockPoint.copy(hit.point);
    return false;
  }

  setTarget(t) {
    if (t === this.target) return;
    this.target = t;
    this.canSee = false;
    this.lostTime = 99;
    this.blocker = null;
    if (t) this.lastSeenPos.copy(t.pos);
  }

  setState(s) {
    if (this.state === s) return;
    this.state = s;
    this.stateTimer = 0;
  }

  // ----- targeting -----
  chooseTarget() {
    const g = this.game;
    const p = g.player;
    const P = this.profile;

    if (this.aggroTimer > 0 && this.entityAlive(this.aggroTarget)) {
      this.setTarget(this.aggroTarget);
      return;
    }
    if (P.passive && !this.provoked) {
      this.setTarget(null);
      return;
    }
    if (this.target && this.entityAlive(this.target) && this.stickTimer > 0 && this.distTo(this.target) < P.sight * 1.25) return;

    const playerOk = p && p.alive && this.distTo(p) < P.sight;
    let best = null;
    let bestScore = Infinity;
    if (playerOk) {
      best = p;
      bestScore = this.distTo(p) * 0.6;
    }
    for (const b of this.manager.bots) {
      if (b === this || !this.entityAlive(b)) continue;
      const d = this.distTo(b);
      if (d > P.sight) continue;
      const score = d * 1.4 + 8 + Math.random() * 10;
      if (score < bestScore) { bestScore = score; best = b; }
    }
    if (playerOk && Math.random() < 0.8) best = p;
    if (!best) {
      if (this.target && !this.entityAlive(this.target)) this.setTarget(null);
      return;
    }
    if (best !== this.target) {
      // Only acquire new targets we can actually see (or hear up close).
      if (this.distTo(best) > 15 && !this.los(best)) return;
      this.setTarget(best);
    }
    this.stickTimer = rand(3, 5);
  }

  checkLOS() {
    const t = this.target;
    const visible = this.los(t);
    if (visible) {
      if (!this.canSee && this.lostTime > 1.2) {
        this.reactionTimer = rand(this.profile.reaction[0], this.profile.reaction[1]);
        this.aimWarm = 0;
      }
      this.canSee = true;
      this.lostTime = 0;
      this.lastSeenPos.copy(t.pos);
    } else {
      this.canSee = false;
      const p = this.game.player;
      const b = this.blocker;
      if (b && b.kind === 'build' && t === p && (b.owner === p.name || b.owner === 'You') && this.builtChatCd <= 0 && this.distTo(t) < 50) {
        this.builtChatCd = 20;
        if (Math.random() < 0.35) this.chat('player_built');
      }
    }
  }

  // ----- update -----
  update(dt) {
    this.clock += dt;
    if (!this.alive) {
      this.updateDeath(dt);
      return;
    }
    if (this.state === 'DROP') {
      this.updateDrop(dt);
    } else {
      this.think(dt);
      this.move(dt);
      this.combat(dt);
      this.stormDamage(dt);
    }
    if (this.alive) {
      this.animate(dt);
      this.drawBars();
    }
  }

  think(dt) {
    const g = this.game;
    const P = this.profile;
    this.stateTimer += dt;
    this.aggroTimer -= dt;
    this.stickTimer -= dt;
    this.buildCooldown -= dt;
    this.retreatCooldown -= dt;
    this.gotHitChatCd -= dt;
    this.builtChatCd -= dt;
    this.buildPose -= dt;
    this.rampRush -= dt;
    this.boxTimer -= dt;
    this.flankTimer -= dt;
    if (!this.canSee) this.lostTime += dt;

    if (this.target && !this.entityAlive(this.target)) {
      this.setTarget(null);
      if (this.state === 'FIGHT' || this.state === 'CHASE') this.setState('LOOT');
    }

    this.retargetTimer -= dt;
    if (this.retargetTimer <= 0 && this.state !== 'EMOTE') {
      this.retargetTimer = rand(0.4, 0.7);
      this.chooseTarget();
    }

    if (this.target) {
      this.losTimer -= dt;
      if (this.losTimer <= 0) {
        this.losTimer = rand(0.12, 0.18);
        this.checkLOS();
      }
      this.eyePos(_eye);
      _v1.set(this.target.pos.x, this.target.pos.y + 1.1, this.target.pos.z);
      const h = Math.hypot(_v1.x - _eye.x, _v1.z - _eye.z);
      this.aimPitch = Math.atan2(_v1.y - _eye.y, Math.max(0.5, h));
    } else {
      this.canSee = false;
      this.aimPitch = damp(this.aimPitch, 0, 4, dt);
    }

    // taunts when we can see the player
    this.tauntTimer -= dt;
    if (this.tauntTimer <= 0) {
      if (this.canSee && this.targetIsPlayer()) {
        this.chat('taunt');
        this.tauntTimer = rand(25, 40);
      } else {
        this.tauntTimer = rand(3, 6);
      }
    }

    const dist = this.target ? this.distTo(this.target) : Infinity;
    const W = this.w;

    // low hp -> retreat & heal
    if ((this.state === 'FIGHT' || this.state === 'CHASE') && this.health < 45 && this.shield < 25 &&
        this.healCount < 2 && this.retreatCooldown <= 0) {
      this.enterRetreat();
    }

    switch (this.state) {
      case 'LOOT':
        if (this.target && (this.canSee || this.aggroTimer > 0)) this.setState('CHASE');
        this.idleEmoteTimer -= dt;
        if (!this.target && this.idleEmoteTimer <= 0 && this.grounded) {
          this.idleEmoteTimer = rand(18, 35);
          this.startEmote(2.2);
        }
        break;
      case 'CHASE':
        if (!this.target) { this.setState('LOOT'); break; }
        if (this.canSee && dist < W.engage) { this.setState('FIGHT'); break; }
        if (this.lostTime > 8 && this.aggroTimer <= 0) { this.setTarget(null); this.setState('LOOT'); }
        break;
      case 'FIGHT': {
        if (!this.target) { this.setState('LOOT'); break; }
        const shootBlock = this.blocker && isShootable(this.blocker) && this.blocker.owner !== this.name;
        if (dist > W.engage * 1.35 || (this.lostTime > 2.5 && !shootBlock)) {
          this.setState('CHASE');
          if (this.lostTime > 2.5 && this.blocker && !isShootable(this.blocker)) this.startFlank();
          break;
        }
        this.fightBuildLogic(dist, dt);
        break;
      }
      case 'BUILD':
        if (this.stateTimer > 0.7) this.setState(this.target ? 'FIGHT' : 'LOOT');
        break;
      case 'RETREAT':
        this.healTimer += dt;
        if (this.healTimer >= 3) {
          this.shield = Math.min(MAX_SHIELD, this.shield + 25);
          this.healCount++;
          this.healTimer = 0;
          g.fx?.sfx?.pickup?.(this.pos);
          this.retreatCooldown = 6;
          this.setState(this.target ? 'FIGHT' : 'LOOT');
        } else if (this.stateTimer > 6) {
          this.retreatCooldown = 4;
          this.setState(this.target ? 'FIGHT' : 'LOOT');
        }
        break;
      case 'EMOTE':
        this.emoteTimer -= dt;
        if (this.emoteTimer <= 0) this.setState(this.target ? 'CHASE' : 'LOOT');
        break;
    }
  }

  fightBuildLogic(dist, dt) {
    const P = this.profile;
    const t = this.target;
    // "Edit" through my own wall once I'm done hiding.
    if (!this.canSee && this.blocker && this.blocker.owner === this.name && this.lostTime > 0.8 && this.boxTimer <= 0) {
      this.game.damageCollider?.(this.blocker, (this.blocker.hp ?? 500) + 1, this.blockPoint.clone());
      this.blocker = null;
      this.losTimer = 0.05;
      return;
    }
    if (this.buildCooldown > 0 || !this.grounded) return;
    const higher = t.pos.y - this.pos.y > 2.2;
    const blockedByBuild = !this.canSee && this.blocker && this.blocker.kind === 'build';
    let want = false;
    if (higher && Math.random() < P.rampy * 4 * dt) want = true;
    else if (blockedByBuild && dist < 25 && Math.random() < P.rampy * 3 * dt) want = true;
    else if (dist > 8 && dist < 35 && Math.random() < P.rampy * 0.25 * dt) want = true;
    if (want) {
      this.placeRampToward(t.pos.x - this.pos.x, t.pos.z - this.pos.z);
      this.buildCooldown = P.buildCd;
    }
  }

  enterRetreat() {
    this.setState('RETREAT');
    this.healTimer = 0;
    this.chat('low_hp');
    const threat = this.target;
    if (threat && this.grounded) {
      const dx = threat.pos.x - this.pos.x, dz = threat.pos.z - this.pos.z;
      if (this.profile.boxUp) this.boxUp(dx, dz);
      else this.placeWallToward(dx, dz);
    }
  }

  startEmote(duration) {
    this.setState('EMOTE');
    this.emoteTimer = duration;
    this.spinY = 0;
  }

  startFlank() {
    const t = this.target;
    if (!t) return;
    const dx = t.pos.x - this.pos.x, dz = t.pos.z - this.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const side = Math.random() < 0.5 ? -1 : 1;
    const off = rand(8, 14);
    this.flankPoint.set(
      this.pos.x + dx * 0.5 + (-dz / d) * off * side,
      0,
      this.pos.z + dz * 0.5 + (dx / d) * off * side,
    );
    this.flankTimer = 4;
  }

  // ----- building -----
  place(type, x, z, yaw) {
    const g = this.game;
    if (!g.placeBuild) return null;
    const pos = new THREE.Vector3(x, Math.max(this.groundAt(x, z), this.pos.y), z);
    let c = null;
    try { c = g.placeBuild(type, pos, yaw, this.name); } catch (e) { c = null; }
    if (c) {
      if (type === 'ramp') ownRamps.add(c);
      this.buildPose = 0.45;
    }
    return c;
  }

  placeWallToward(dx, dz) {
    const d = Math.hypot(dx, dz) || 1;
    dx /= d; dz /= d;
    const c = this.place('wall', this.pos.x + dx * 2.2, this.pos.z + dz * 2.2, Math.atan2(dx, dz));
    if (c) this.buildCooldown = this.profile.buildCd;
    return c;
  }

  placeRampToward(dx, dz) {
    const d = Math.hypot(dx, dz) || 1;
    dx /= d; dz /= d;
    const c = this.place('ramp', this.pos.x + dx * 2.4, this.pos.z + dz * 2.4, Math.atan2(dx, dz));
    if (c) {
      this.rampRush = 1.6;
      this.yaw = Math.atan2(dx, dz);
    }
    return c;
  }

  boxUp(dx, dz) {
    const cx = Math.floor(this.pos.x / 4) * 4 + 2;
    const cz = Math.floor(this.pos.z / 4) * 4 + 2;
    this.place('wall', cx + 2, cz, PI / 2);
    this.place('wall', cx - 2, cz, PI / 2);
    this.place('wall', cx, cz + 2, 0);
    this.place('wall', cx, cz - 2, 0);
    const d = Math.hypot(dx, dz) || 1;
    this.place('ramp', cx, cz, Math.atan2(dx / d, dz / d));
    this.boxTimer = 3.2;
    this.buildCooldown = this.profile.buildCd + 1;
    this.setState(this.state === 'RETREAT' ? 'RETREAT' : 'BUILD');
  }

  onHurtBuild(attacker) {
    if (!attacker || this.buildCooldown > 0 || !this.grounded) return;
    if (this.state === 'EMOTE' || this.state === 'RETREAT') return;
    const P = this.profile;
    if (Math.random() > P.buildChance) return;
    const dx = attacker.pos.x - this.pos.x, dz = attacker.pos.z - this.pos.z;
    if (P.boxUp && Math.random() < 0.6) {
      this.boxUp(dx, dz);
    } else {
      this.placeWallToward(dx, dz);
      this.setState('BUILD');
      if (P.boxUp && Math.random() < 0.5) {
        this.buildCooldown = 0;
        this.placeRampToward(dx, dz);
        this.buildCooldown = P.buildCd;
      }
    }
  }

  // ----- movement -----
  pickWaypoint() {
    const g = this.game;
    const half = (g.world?.size ?? 300) / 2 - 6;
    const st = g.storm;
    const safeR = st ? Math.max(5, st.radius * 0.7) : half;
    const cx = st ? st.center.x : 0, cz = st ? st.center.z : 0;
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * TAU;
      const r = rand(10, 45);
      const x = this.pos.x + Math.cos(a) * r;
      const z = this.pos.z + Math.sin(a) * r;
      if (Math.abs(x) > half || Math.abs(z) > half) continue;
      if (Math.hypot(x - cx, z - cz) > safeR) continue;
      this.waypointV.set(x, 0, z);
      this.waypoint = this.waypointV;
      return;
    }
    const a = Math.random() * TAU;
    const r = Math.random() * safeR * 0.8;
    this.waypointV.set(clamp(cx + Math.cos(a) * r, -half, half), 0, clamp(cz + Math.sin(a) * r, -half, half));
    this.waypoint = this.waypointV;
  }

  wishToward(x, z) {
    const dx = x - this.pos.x, dz = z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.01) this.wish.set(0, 0, 0);
    else this.wish.set(dx / d, 0, dz / d);
    return d;
  }

  move(dt) {
    const g = this.game;
    const P = this.profile;
    const t = this.target;
    let speed = this.speed * (P.passive && this.provoked ? 1.12 : 1);
    this.wish.set(0, 0, 0);
    let faceTarget = false;

    switch (this.state) {
      case 'LOOT': {
        if (this.lootPause > 0) {
          this.lootPause -= dt;
          break;
        }
        if (!this.waypoint) this.pickWaypoint();
        const d = this.wishToward(this.waypoint.x, this.waypoint.z);
        speed *= 0.8;
        if (d < 2.5) {
          this.waypoint = null;
          this.lootPause = rand(0.4, 2.0);
        }
        break;
      }
      case 'CHASE': {
        if (!t) break;
        if (this.flankTimer > 0) {
          if (this.wishToward(this.flankPoint.x, this.flankPoint.z) < 2) this.flankTimer = 0;
        } else {
          const goal = this.canSee || this.aggroTimer > 0 ? t.pos : this.lastSeenPos;
          const d = this.wishToward(goal.x, goal.z);
          if (d < 2 && !this.canSee) {
            this.lastSeenPos.x += rand(-12, 12);
            this.lastSeenPos.z += rand(-12, 12);
          }
        }
        faceTarget = this.canSee;
        break;
      }
      case 'FIGHT': {
        if (!t) break;
        faceTarget = true;
        const dx = t.pos.x - this.pos.x, dz = t.pos.z - this.pos.z;
        const d = Math.hypot(dx, dz) || 1;
        const fx = dx / d, fz = dz / d;
        if (this.rampRush > 0) {
          this.wish.set(fx, 0, fz);
          break;
        }
        const [minR, maxR] = P.range;
        let approach = 0;
        if (d > maxR || !this.canSee) approach = 1;
        else if (d < minR) approach = -0.8;
        this.strafeTimer -= dt;
        const blockedFlip = this.blocked && this.strafeTimer < P.strafe[0] - 0.4;
        if (this.strafeTimer <= 0 || blockedFlip) {
          this.strafeTimer = rand(P.strafe[0], P.strafe[1]);
          if (blockedFlip || Math.random() < 0.7) this.strafeDir *= -1;
        }
        const sx = -fz * this.strafeDir, sz = fx * this.strafeDir;
        this.wish.set(fx * approach + sx * 0.85, 0, fz * approach + sz * 0.85);
        const wl = this.wish.length();
        if (wl > 1) this.wish.multiplyScalar(1 / wl);
        speed *= 0.8;
        // jump around
        this.jumpTimer -= dt;
        if (this.jumpTimer <= 0) {
          this.jumpTimer = rand(1.2, 3.5) / Math.max(0.1, P.jumpiness * 2);
          if (Math.random() < P.jumpiness + 0.1) this.jump();
        }
        break;
      }
      case 'RETREAT': {
        faceTarget = this.canSee;
        if (this.boxTimer > 0 || !t) break;
        const dx = this.pos.x - t.pos.x, dz = this.pos.z - t.pos.z;
        const d = Math.hypot(dx, dz) || 1;
        this.wish.set(dx / d, 0, dz / d);
        if (this.blocked) {
          this.wish.set(-dz / d, 0, dx / d);
        }
        speed *= 0.9;
        break;
      }
      case 'BUILD':
      case 'EMOTE':
        break;
    }

    // Storm awareness: head toward the safe zone.
    const st = g.storm;
    if (st && st.center) {
      const dx = st.center.x - this.pos.x, dz = st.center.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      const margin = this.manager.stormShrinking ? 12 : 5;
      if (d > st.radius - margin && d > 1) {
        const urgency = clamp((d - (st.radius - margin)) / 10, 0.35, 1);
        if (this.state === 'LOOT' || this.state === 'EMOTE' || d > st.radius) {
          this.wish.lerp(_v1.set(dx / d, 0, dz / d), urgency);
          if (this.state === 'EMOTE' && d > st.radius) this.setState('LOOT');
          if (this.state === 'LOOT' && this.waypoint &&
              Math.hypot(this.waypoint.x - st.center.x, this.waypoint.z - st.center.z) > st.radius * 0.8) {
            this.waypoint = null;
          }
        } else {
          this.wish.addScaledVector(_v1.set(dx / d, 0, dz / d), urgency * 0.6);
        }
        const wl = this.wish.length();
        if (wl > 1) this.wish.multiplyScalar(1 / wl);
      }
    }

    // Separation from other bots.
    for (const b of this.manager.bots) {
      if (b === this || !b.alive || b.state === 'DROP') continue;
      const dx = this.pos.x - b.pos.x, dz = this.pos.z - b.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 1.0 && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const push = (1 - d) * 0.5;
        this.pos.x += (dx / d) * push;
        this.pos.z += (dz / d) * push;
      }
    }

    // Facing.
    let desiredYaw = this.yaw;
    if (faceTarget && t) desiredYaw = Math.atan2(t.pos.x - this.pos.x, t.pos.z - this.pos.z);
    else if (this.wish.lengthSq() > 0.01) desiredYaw = Math.atan2(this.wish.x, this.wish.z);
    const turn = P.turn * dt;
    const diff = angleDiff(desiredYaw, this.yaw);
    this.yaw += clamp(diff, -turn, turn);
    this.desiredYaw = desiredYaw;

    // Integrate.
    const accel = this.grounded ? 30 : 8;
    const tx = this.wish.x * speed, tz = this.wish.z * speed;
    const ax = clamp(tx - this.vel.x, -accel * dt, accel * dt);
    const az = clamp(tz - this.vel.z, -accel * dt, accel * dt);
    this.vel.x += ax;
    this.vel.z += az;
    this.vel.y -= GRAVITY * dt;
    this.pos.addScaledVector(this.vel, dt);

    const half = (g.world?.size ?? 300) / 2 - 1;
    this.pos.x = clamp(this.pos.x, -half, half);
    this.pos.z = clamp(this.pos.z, -half, half);

    this.collide(dt);

    // Stuck detection.
    this.stuckCheck -= dt;
    if (this.stuckCheck <= 0) {
      this.stuckCheck = 0.5;
      const wanted = this.wish.lengthSq() > 0.04;
      const moved = Math.hypot(this.pos.x - this.stuckRef.x, this.pos.z - this.stuckRef.z);
      if (wanted && moved < speed * 0.5 * 0.25) this.stuckTimer += 0.5;
      else this.stuckTimer = 0;
      this.stuckRef.copy(this.pos);
      if (this.stuckTimer >= 1.5 && this.grounded) this.jump();
      if (this.stuckTimer >= 3) {
        this.stuckTimer = 0;
        if (this.state === 'LOOT') this.pickWaypoint();
        else if (this.state === 'CHASE' || this.state === 'FIGHT') this.startFlank();
        if (this.state === 'FIGHT') this.setState('CHASE');
      }
    }
  }

  jump() {
    if (!this.grounded) return;
    this.vel.y = JUMP_VEL;
    this.grounded = false;
    this.game.fx?.sfx?.jump?.(this.pos);
  }

  collide(dt) {
    const g = this.game;
    const p = this.pos;
    const R = BOT_RADIUS;
    let ground = this.groundAt(p.x, p.z);
    let onRamp = false;
    this.blocked = false;
    const cols = g.colliders || [];
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      const b = c && c.box;
      if (!b) continue;
      if (p.x + R < b.min.x || p.x - R > b.max.x || p.z + R < b.min.z || p.z - R > b.max.z) continue;
      if (b.min.y > p.y + 1.8 || b.max.y < p.y - 3) continue;
      if (isRamp(c)) { onRamp = true; continue; }
      const top = b.max.y;
      if (top <= p.y + STEP_HEIGHT) {
        if (p.x > b.min.x - R * 0.5 && p.x < b.max.x + R * 0.5 && p.z > b.min.z - R * 0.5 && p.z < b.max.z + R * 0.5) {
          if (top > ground) ground = top;
        }
        continue;
      }
      if (b.min.y >= p.y + 1.75) continue;
      const cx = clamp(p.x, b.min.x, b.max.x);
      const cz = clamp(p.z, b.min.z, b.max.z);
      const dx = p.x - cx, dz = p.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 > 1e-8) {
        if (d2 < R * R) {
          const d = Math.sqrt(d2);
          const nx = dx / d, nz = dz / d;
          p.x += nx * (R - d);
          p.z += nz * (R - d);
          const vn = this.vel.x * nx + this.vel.z * nz;
          if (vn < 0) { this.vel.x -= vn * nx; this.vel.z -= vn * nz; }
          this.blocked = true;
        }
      } else {
        const l = p.x - b.min.x, r = b.max.x - p.x, f = p.z - b.min.z, k = b.max.z - p.z;
        const m = Math.min(l, r, f, k);
        if (m === l) { p.x = b.min.x - R; this.vel.x = Math.min(0, this.vel.x); }
        else if (m === r) { p.x = b.max.x + R; this.vel.x = Math.max(0, this.vel.x); }
        else if (m === f) { p.z = b.min.z - R; this.vel.z = Math.min(0, this.vel.z); }
        else { p.z = b.max.z + R; this.vel.z = Math.max(0, this.vel.z); }
        this.blocked = true;
      }
    }

    if (onRamp && g.raycastWorld) {
      _v2.set(p.x, p.y + 1.6, p.z);
      const hit = g.raycastWorld(_v2, DOWN, 3.6);
      this.rampY = hit && hit.point && hit.point.y <= p.y + 1.3 ? hit.point.y : -Infinity;
      if (this.rampY > ground) ground = this.rampY;
    }

    const wasGrounded = this.grounded;
    const snapDown = wasGrounded && this.vel.y <= 0 && p.y - ground < (onRamp ? 0.9 : 0.4);
    if (p.y <= ground || snapDown) {
      if (!wasGrounded && this.vel.y < -7) g.fx?.sfx?.land?.(p);
      p.y = ground;
      if (this.vel.y < 0) this.vel.y = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }
  }

  stormDamage(dt) {
    const st = this.game.storm;
    if (!st || !st.center || !st.damagePerSec) return;
    const d = Math.hypot(this.pos.x - st.center.x, this.pos.z - st.center.z);
    if (d <= st.radius) return;
    this.health -= st.damagePerSec * dt;
    if (this.health <= 0) this.die('Storm', null);
  }

  // ----- drop from the sky -----
  startDrop(landX, landZ, delay) {
    this.landing.set(landX, 0, landZ);
    const a = Math.random() * TAU;
    const off = rand(15, 30);
    const sx = landX + Math.cos(a) * off;
    const sz = landZ + Math.sin(a) * off;
    this.pos.set(sx, this.groundAt(sx, sz) + 100, sz);
    this.vel.set(0, 0, 0);
    this.yaw = Math.atan2(landX - sx, landZ - sz);
    this.dropDelay = delay;
    this.state = 'DROP';
    this.mesh.visible = delay <= 0;
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.yaw;
  }

  updateDrop(dt) {
    if (this.dropDelay > 0) {
      this.dropDelay -= dt;
      this.mesh.visible = this.dropDelay <= 0;
      return;
    }
    const ground = this.groundAt(this.pos.x, this.pos.z);
    const h = this.pos.y - ground;
    const gliding = h < 40;
    this.rig.glider.visible = gliding;
    if (gliding) {
      this.vel.y = damp(this.vel.y, -6.5, 3, dt);
      const d = this.wishToward(this.landing.x, this.landing.z);
      const hs = Math.min(9, d * 1.2);
      this.vel.x = damp(this.vel.x, this.wish.x * hs, 2, dt);
      this.vel.z = damp(this.vel.z, this.wish.z * hs, 2, dt);
    } else {
      this.vel.y = Math.max(-30, this.vel.y - GRAVITY * dt);
      const d = this.wishToward(this.landing.x, this.landing.z);
      const hs = Math.min(6, d);
      this.vel.x = damp(this.vel.x, this.wish.x * hs, 1, dt);
      this.vel.z = damp(this.vel.z, this.wish.z * hs, 1, dt);
    }
    if (this.vel.x * this.vel.x + this.vel.z * this.vel.z > 0.5) {
      this.yaw += clamp(angleDiff(Math.atan2(this.vel.x, this.vel.z), this.yaw), -3 * dt, 3 * dt);
    }
    this.pos.addScaledVector(this.vel, dt);
    this.grounded = false;
    this.collide(dt);
    if (this.grounded) {
      this.rig.glider.visible = false;
      this.vel.set(0, 0, 0);
      this.state = 'LOOT';
      this.lootPause = rand(0.3, 1.2);
      this.game.fx?.sfx?.land?.(this.pos);
      this.stuckRef.copy(this.pos);
    }
  }

  // ----- combat -----
  combat(dt) {
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.reactionTimer > 0) this.reactionTimer -= dt;
    const t = this.target;
    const s = this.state;
    if (!t || (s !== 'FIGHT' && s !== 'CHASE' && s !== 'RETREAT')) {
      this.burstLeft = this.w.burst;
      return;
    }
    if (this.canSee) this.aimWarm = Math.min(1, this.aimWarm + dt / 1.4);
    else this.aimWarm = Math.max(0, this.aimWarm - dt * 0.5);

    const shootBlock = !this.canSee && this.blocker && isShootable(this.blocker) &&
      this.blocker.owner !== this.name && this.lostTime < 4;
    if (!this.canSee && !shootBlock) return;
    if (this.reactionTimer > 0 || this.cooldown > 0) return;
    const dist = this.distTo(t);
    if (dist > this.w.range) return;
    if (s === 'RETREAT' && (!this.canSee || dist > 18)) return;
    if (s === 'CHASE' && dist > this.w.engage) return;
    if (Math.abs(angleDiff(this.desiredYaw ?? this.yaw, this.yaw)) > 0.35) return;
    this.fire(t, dist);
  }

  getMuzzle(out) {
    this.mesh.updateMatrixWorld(true);
    return this.rig.muzzle.getWorldPosition(out);
  }

  fire(t, dist) {
    const g = this.game;
    const W = this.w;
    const P = this.profile;
    const player = g.player;
    const isPlayer = t === player;

    this.burstLeft--;
    if (this.burstLeft <= 0) {
      this.burstLeft = W.burst;
      this.cooldown = rand(W.pause[0], W.pause[1]) * (P.passive && this.provoked ? 0.85 : 1);
    } else {
      this.cooldown = W.interval;
    }
    this.recoil = 1;

    const muzzle = this.getMuzzle(_muzzle);
    // Aim point: chest, sometimes head.
    const aimHead = Math.random() < P.headChance;
    _aim.set(t.pos.x, t.pos.y + (aimHead ? 1.55 : 1.1) * (t.profile?.scale || 1), t.pos.z);
    const tvel = t.vel;
    const tSpeed = tvel ? Math.hypot(tvel.x, tvel.z) + Math.abs(tvel.y) * 0.5 : 0;
    const acc = clamp(P.accuracy + (P.passive && this.provoked ? 0.06 : 0), 0.05, 0.98);
    let miss = (1 - acc) * (0.5 + dist * 0.045) + tSpeed * 0.05 * (1.2 - acc) + W.spread * dist * (W.pellets > 1 ? 0 : 1);
    miss *= 1.7 - 0.7 * this.aimWarm;
    if (!this.grounded) miss *= 1.3;

    // Base direction with a disk offset perpendicular to the aim line.
    _dir.subVectors(_aim, muzzle).normalize();
    _right.crossVectors(_dir, UP);
    if (_right.lengthSq() < 1e-6) _right.set(1, 0, 0);
    _right.normalize();
    _up.crossVectors(_right, _dir).normalize();
    const r = miss * Math.sqrt(Math.random());
    const a = Math.random() * TAU;
    _aim.addScaledVector(_right, Math.cos(a) * r).addScaledVector(_up, Math.sin(a) * r * 0.9);
    _dir.subVectors(_aim, muzzle).normalize();

    // falloff
    const [f0, f1] = W.falloff;
    const fall = dist <= f0 ? 1 : clamp(1 - ((dist - f0) / Math.max(1, f1 - f0)) * (W.pellets > 1 ? 0.7 : 0.5), 0.3, 1);
    const dmgScale = (g.botDamageScale ?? 1);

    const worldHit = g.raycastWorld ? g.raycastWorld(muzzle, _dir, W.range) : null;
    const worldDist = worldHit ? worldHit.distance : Infinity;

    let targetDmg = 0;
    let headshot = false;
    let worldPellets = 0;
    const hitPoint = _v3;
    let anyTargetHit = false;
    const fxColor = this.color;
    const wasAlive = isPlayer ? player.alive : t.alive;

    for (let i = 0; i < W.pellets; i++) {
      _pdir.copy(_dir);
      if (W.pellets > 1) {
        const pr = W.spread * Math.sqrt(Math.random());
        const pa = Math.random() * TAU;
        _pdir.addScaledVector(_right, Math.cos(pa) * pr).addScaledVector(_up, Math.sin(pa) * pr).normalize();
      }
      let tHit = -1;
      let head = false;
      if (isPlayer) {
        tHit = rayCapsuleY(muzzle, _pdir, t.pos.x, t.pos.z, t.pos.y + PLAYER_RADIUS, t.pos.y + PLAYER_HEIGHT - PLAYER_RADIUS, PLAYER_RADIUS, W.range);
        if (tHit >= 0) head = muzzle.y + _pdir.y * tHit > t.pos.y + 1.45;
      } else {
        const res = t.hitTest(muzzle, _pdir, W.range);
        if (res) { tHit = res.distance; head = res.headshot; }
      }
      const hitsTarget = tHit >= 0 && tHit < worldDist;
      if (hitsTarget) {
        const mult = head ? (isPlayer ? (W === WEAPONS.dmr || W === WEAPONS.rifle ? 1.5 : 1.25) : 1.75) : 1;
        targetDmg += W.dmg * fall * mult;
        headshot = headshot || head;
        if (!anyTargetHit) hitPoint.copy(muzzle).addScaledVector(_pdir, tHit);
        anyTargetHit = true;
      } else if (worldHit) {
        worldPellets++;
      }
      // tracers: all for single-shot weapons, a few for shotgun
      if (i < 3) {
        const len = hitsTarget ? tHit : Math.min(worldDist, W.range);
        _end.copy(muzzle).addScaledVector(_pdir, len);
        g.fx?.tracer?.(muzzle.clone(), _end.clone(), fxColor);
      }
    }

    g.fx?.muzzleFlash?.(muzzle.clone(), _dir.clone(), fxColor);
    g.fx?.sfx?.shot?.(this.weapon, muzzle.clone());

    if (worldPellets > 0 && worldHit) {
      const c = worldHit.collider;
      const kind = c && (c.kind === 'build' || c.kind === 'house' || c.kind === 'prop') ? 'build' : 'ground';
      g.fx?.impact?.(worldHit.point.clone(), (worldHit.normal || _v1.copy(_dir).negate()).clone(), kind);
      if (c && g.damageCollider) g.damageCollider(c, W.dmg * worldPellets * fall, worldHit.point.clone());
    }

    if (anyTargetHit && targetDmg > 0) {
      const dmg = Math.round(targetDmg * (isPlayer ? dmgScale : 1));
      const shielded = isPlayer ? player.shield > 0 : t.shield > 0;
      g.fx?.impact?.(hitPoint.clone(), _v1.copy(_dir).negate().clone(), shielded ? 'shield' : 'flesh');
      if (isPlayer) {
        this.eyePos(_eye);
        g.damagePlayer?.(dmg, _eye.clone(), this.name);
        if (wasAlive && !player.alive) this.onKill(player);
      } else {
        const killed = t.takeDamage(dmg, hitPoint.clone(), headshot, this.name);
        if (killed || (wasAlive && !t.alive)) this.onKill(t);
      }
    }
  }

  onKill(victim) {
    this.kills++;
    if (victim !== this.game.player) this.chat('kill_bot', { victim: victim.name });
    this.setTarget(null);
    this.aggroTimer = 0;
    this.startEmote(2.6);
  }

  // ----- contract API -----
  hitTest(origin, dir, maxDist) {
    if (!this.alive || !this.mesh.visible) return null;
    const s = this.profile.scale || 1;
    const p = this.pos;
    _sph.set(p.x, p.y + 1.58 * s, p.z);
    const tHead = raySphere(origin, dir, _sph, 0.37 * s, maxDist);
    const tBody = rayCapsuleY(origin, dir, p.x, p.z, p.y + 0.4 * s, p.y + 1.15 * s, 0.43 * s, maxDist);
    let t = -1;
    let headshot = false;
    if (tHead >= 0 && (tBody < 0 || tHead <= tBody)) { t = tHead; headshot = true; }
    else if (tBody >= 0) t = tBody;
    if (t < 0) return null;
    return { distance: t, point: origin.clone().addScaledVector(dir, t), headshot };
  }

  takeDamage(amount, point, headshot, attackerName) {
    if (!this.alive || amount <= 0) return false;
    const g = this.game;
    const hadShield = this.shield > 0;
    let rest = amount;
    if (this.shield > 0) {
      const s = Math.min(this.shield, rest);
      this.shield -= s;
      rest -= s;
    }
    this.health -= rest;
    const pt = point || _v1.set(this.pos.x, this.pos.y + 1.6, this.pos.z).clone();
    g.fx?.damageNumber?.(pt, Math.round(amount), { headshot: !!headshot, shield: hadShield });
    if (hadShield && this.shield <= 0) {
      g.fx?.sfx?.shieldBreak?.(this.pos);
      g.fx?.impact?.(pt, UP.clone(), 'shield');
    }
    this.flinch = 1;
    this.flinchSide = Math.random() < 0.5 ? -1 : 1;
    this.flash = 1;
    this.lastHitTime = this.clock;
    this.provoked = true;

    if (this.health <= 0) {
      this.die(attackerName, pt);
      return true;
    }

    const attacker = this.findByName(attackerName);
    const isPlayer = attacker && attacker === g.player;
    if (attacker && attacker !== this && this.entityAlive(attacker)) {
      // aggro: the player always steals attention; other bots only if we're idle or it's close
      if (isPlayer || !this.target || this.target !== g.player || Math.random() < 0.3) {
        this.aggroTarget = attacker;
        this.aggroTimer = isPlayer ? 10 : 6;
        if (this.target !== attacker) {
          this.setTarget(attacker);
          this.reactionTimer = rand(0.25, 0.45);
        }
        this.lastSeenPos.copy(attacker.pos);
        this.stickTimer = 4;
      }
      if (this.state === 'LOOT' || this.state === 'EMOTE') this.setState('CHASE');
      if (this.state === 'RETREAT') this.healTimer = Math.max(0, this.healTimer - 0.8);
      this.onHurtBuild(attacker);
    }
    if (isPlayer && this.gotHitChatCd <= 0) {
      this.gotHitChatCd = 10;
      if (Math.random() < 0.3) this.chat('got_hit', { damage: Math.round(amount), headshot: !!headshot });
    }
    return false;
  }

  die(killerName, point) {
    if (this.deathReported) return;
    this.deathReported = true;
    this.alive = false;
    this.health = 0;
    this.shield = 0;
    this.state = 'DEAD';
    this.deathT = 0;
    this.deathDir = Math.random() < 0.5 ? -1 : 1;
    this.vel.set(0, 3.5, 0);
    this.target = null;
    this.rig.glider.visible = false;
    this.nameplate.visible = false;
    this.bar.visible = false;
    const g = this.game;
    g.fx?.elimination?.(_v1.set(this.pos.x, this.pos.y + 1, this.pos.z).clone(), this.color);
    try { g.onBotKilled?.(this, killerName); } catch (e) { console.error(e); }
    this.chat('eliminated', { killer: killerName });
  }

  updateDeath(dt) {
    if (this.removed) return;
    const r = this.rig;
    this.deathT += dt;
    const t = this.deathT;
    // tumble backwards and fall over
    const k = Math.min(1, t / 0.7);
    const ease = 1 - (1 - k) * (1 - k);
    r.body.rotation.x = -ease * PI / 2 * 0.95;
    r.body.rotation.z = ease * 0.4 * this.deathDir;
    r.body.rotation.y += dt * (1 - k) * 6 * this.deathDir;
    this.vel.y -= GRAVITY * dt;
    this.pos.y += this.vel.y * dt;
    const ground = this.groundAt(this.pos.x, this.pos.z);
    if (this.pos.y < ground) { this.pos.y = ground; this.vel.y = Math.abs(this.vel.y) > 3 ? -this.vel.y * 0.3 : 0; }
    r.leftArm.rotation.z = damp(r.leftArm.rotation.z, 2.2, 6, dt);
    r.rightArm.rotation.z = damp(r.rightArm.rotation.z, -2.2, 6, dt);
    r.leftLeg.rotation.x = damp(r.leftLeg.rotation.x, 0.5, 6, dt);
    r.rightLeg.rotation.x = damp(r.rightLeg.rotation.x, -0.3, 6, dt);
    r.mats.visor.emissiveIntensity = Math.random() < 0.3 ? 0.1 : 1.2 * (1 - k * 0.7);
    if (t > 2) {
      const sc = Math.max(0.001, 1 - (t - 2) / 0.6);
      this.mesh.scale.setScalar(sc);
    }
    this.mesh.position.copy(this.pos);
    if (t > 2.6) {
      this.removed = true;
      this.mesh.visible = false;
      this.mesh.parent?.remove(this.mesh);
    }
  }

  // ----- animation -----
  animate(dt) {
    const r = this.rig;
    const A = this.anim;
    const time = this.clock;
    const P = this.profile;
    const hs = Math.hypot(this.vel.x, this.vel.z);
    const k = Math.min(1, hs / Math.max(1, this.speed));
    this.runPhase += dt * (3 + hs * 1.7);
    const swing = Math.sin(this.runPhase) * 0.9 * k;

    let lLeg = swing, rLeg = -swing;
    let lArmX = -swing * 0.7, rArmX = swing * 0.7, lArmZ = 0.12, rArmZ = -0.12;
    let bodyX = 0.12 * k, bodyZ = 0, headX = 0;
    let bodyY = Math.abs(Math.sin(this.runPhase)) * 0.07 * k + (1 - k) * Math.sin(time * 2.2 + this.index) * 0.018;
    let spin = 0;

    if (!this.grounded && this.state !== 'DROP') { lLeg = -0.7; rLeg = 0.35; }

    const aiming = this.target && (this.state === 'FIGHT' || this.state === 'BUILD' ||
      ((this.state === 'CHASE' || this.state === 'RETREAT') && this.canSee));
    if (aiming) {
      const p = this.aimPitch;
      rArmX = -PI / 2 - p + this.recoil * 0.45;
      rArmZ = 0.12;
      lArmX = -PI / 2 - p + 0.12 + this.recoil * 0.25;
      lArmZ = -0.55;
      headX = -p * 0.6;
      bodyX *= 0.4;
    }
    if (this.buildPose > 0) {
      lArmX = -2.5;
      lArmZ = -0.25;
      rArmX = -0.8;
    }

    if (this.state === 'DROP') {
      if (r.glider.visible) {
        lArmX = 0; lArmZ = 2.7; rArmX = 0; rArmZ = -2.7;
        lLeg = 0.15 + Math.sin(time * 3) * 0.1; rLeg = 0.15 - Math.sin(time * 3) * 0.1;
        bodyX = 0.1;
        bodyZ = Math.sin(time * 1.3) * 0.12;
      } else {
        lArmX = -0.2; lArmZ = 1.3; rArmX = -0.2; rArmZ = -1.3;
        lLeg = -0.4 + Math.sin(time * 7) * 0.15; rLeg = -0.4 - Math.sin(time * 7) * 0.15;
        bodyX = 1.25;
      }
      bodyY = 0;
    }

    if (this.state === 'EMOTE') {
      // the Jev wiggle: spin, then arms up and hip wiggle
      this.spinY += dt;
      const e = this.spinY;
      if (e < 0.6) spin = (e / 0.6) * TAU;
      const w = Math.sin(time * 14);
      lArmX = 0; rArmX = 0;
      lArmZ = 2.6 + w * 0.35;
      rArmZ = -2.6 + w * 0.35;
      bodyZ = w * 0.2;
      bodyY = Math.abs(Math.sin(time * 10)) * 0.12;
      lLeg = Math.max(0, w) * 0.6;
      rLeg = Math.max(0, -w) * 0.6;
      headX = Math.sin(time * 7) * 0.2;
      bodyX = 0;
    }

    const rate = 16;
    A.lLeg = damp(A.lLeg, lLeg, rate, dt);
    A.rLeg = damp(A.rLeg, rLeg, rate, dt);
    A.lArmX = damp(A.lArmX, lArmX, rate, dt);
    A.rArmX = damp(A.rArmX, rArmX, rate * 1.4, dt);
    A.lArmZ = damp(A.lArmZ, lArmZ, rate, dt);
    A.rArmZ = damp(A.rArmZ, rArmZ, rate, dt);
    A.bodyX = damp(A.bodyX, bodyX, 8, dt);
    A.bodyZ = damp(A.bodyZ, bodyZ, 10, dt);
    A.headX = damp(A.headX, headX, 10, dt);
    A.bodyY = damp(A.bodyY, bodyY, 20, dt);

    r.leftLeg.rotation.x = A.lLeg;
    r.rightLeg.rotation.x = A.rLeg;
    r.leftArm.rotation.set(A.lArmX, 0, A.lArmZ);
    r.rightArm.rotation.set(A.rArmX, 0, A.rArmZ);
    r.body.rotation.set(A.bodyX, spin, A.bodyZ);
    r.body.position.y = A.bodyY;
    r.head.rotation.x = A.headX;
    r.torso.rotation.x = -this.flinch * 0.4;
    r.torso.rotation.z = this.flinch * 0.15 * this.flinchSide;
    r.gun.position.y = -0.52 + this.recoil * 0.07;

    this.recoil = Math.max(0, this.recoil - dt * 9);
    this.flinch = Math.max(0, this.flinch - dt * 5);

    // hurt flash
    if (this.flash > 0 || this.flashing) {
      this.flash = Math.max(0, this.flash - dt * 7);
      this.flashing = this.flash > 0;
      for (let i = 0; i < r.flashMats.length; i++) {
        const m = r.flashMats[i];
        const base = r.flashBase[i];
        m.emissive.copy(base.color).lerp(WHITE, this.flash);
        m.emissiveIntensity = base.intensity + this.flash * 0.9;
      }
    }

    // antenna orb pulse + visor
    r.mats.orb.emissiveIntensity = 1.6 + Math.sin(time * 4 + this.index) * 0.9;
    if (P.glitch) {
      this.glitchT -= dt;
      if (this.glitchT <= 0 && Math.random() < 0.05) this.glitchT = rand(0.05, 0.18);
      if (this.glitchT > 0) {
        r.mats.visor.emissiveIntensity = Math.random() < 0.5 ? 0.05 : rand(2, 4);
        r.visor.position.x = (Math.random() - 0.5) * 0.05;
        r.visor.scale.x = 1.08 + (Math.random() - 0.5) * 0.15;
        r.mats.visor.emissive.set(Math.random() < 0.3 ? '#ffffff' : P.visor);
      } else {
        r.mats.visor.emissiveIntensity = 1.7;
        r.visor.position.x = 0;
        r.visor.scale.x = 1.08;
        r.mats.visor.emissive.set(P.visor);
      }
    } else {
      r.mats.visor.emissiveIntensity = 1.5 + Math.sin(time * 2 + this.index) * 0.25 + (this.state === 'FIGHT' ? 0.4 : 0);
    }

    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.yaw;
  }

  dispose() {
    this.mesh.parent?.remove(this.mesh);
  }
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------
export function createBots(game, count = 5) {
  const bots = [];
  const manager = {
    bots,
    stormShrinking: false,
    update,
    aliveCount,
    dispose,
  };

  const half = (game.world?.size ?? 300) / 2 - 15;
  const st = game.storm;
  const zoneR = Math.min(half, st ? st.radius * 0.75 : half);
  const zx = st?.center?.x ?? 0, zz = st?.center?.z ?? 0;
  const landings = [];
  const ppos = game.player?.pos;

  for (let i = 0; i < count; i++) {
    const base = JEVS[i % JEVS.length];
    const profile = i < JEVS.length ? base : { ...base, name: `${base.name} ${Math.floor(i / JEVS.length) + 1}` };
    const bot = new Bot(game, profile, i, manager);
    let lx = 0, lz = 0;
    for (let tries = 0; tries < 40; tries++) {
      const a = Math.random() * TAU;
      const r = Math.sqrt(Math.random()) * zoneR;
      lx = clamp(zx + Math.cos(a) * r, -half, half);
      lz = clamp(zz + Math.sin(a) * r, -half, half);
      const farFromPlayer = !ppos || Math.hypot(lx - ppos.x, lz - ppos.z) > 45;
      const farFromOthers = landings.every((l) => Math.hypot(l.x - lx, l.z - lz) > 35);
      if (farFromPlayer && farFromOthers) break;
    }
    landings.push({ x: lx, z: lz });
    bot.startDrop(lx, lz, i * 0.5 + Math.random() * 0.4);
    bots.push(bot);
  }
  game.bots = bots;

  let spawnChatTimer = 2.5;
  let lastStormR = st ? st.radius : 0;

  function update(dt) {
    if (!(dt > 0)) return;
    dt = Math.min(dt, 0.05);
    const storm = game.storm;
    if (storm) {
      manager.stormShrinking = storm.radius < lastStormR - 1e-4;
      lastStormR = storm.radius;
    }
    if (spawnChatTimer > 0) {
      spawnChatTimer -= dt;
      if (spawnChatTimer <= 0) {
        const alive = bots.filter((b) => b.alive);
        const b = alive[Math.floor(Math.random() * alive.length)];
        if (b) b.chat('spawn');
      }
    }
    for (let i = 0; i < bots.length; i++) bots[i].update(dt);
  }

  function aliveCount() {
    let n = 0;
    for (let i = 0; i < bots.length; i++) if (bots[i].alive) n++;
    return n;
  }

  function dispose() {
    for (const b of bots) b.dispose();
  }

  return manager;
}
