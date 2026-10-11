import * as THREE from 'three';

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x, z) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function valueNoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi), b = hash2(xi + 1, zi), c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function rawHeight(x, z) {
  let h = 3.2 * Math.sin(x * 0.019 + 1.3) * Math.cos(z * 0.016 + 0.4)
    + 1.8 * Math.sin(x * 0.041 + z * 0.033 + 2.0)
    + 4.4 * (valueNoise(x * 0.035, z * 0.035) - 0.5)
    + 1.2 * (valueNoise(x * 0.11, z * 0.11) - 0.5);
  const r = Math.sqrt(x * x + z * z);
  if (r > 140) h += Math.min(70, Math.pow((r - 140) * 0.25, 1.6)) * (0.55 + 0.9 * valueNoise(x * 0.018, z * 0.018));
  return h;
}

function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function makeCanvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function makePlankTexture() {
  return makeCanvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#c98a4b'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 4; i++) {
      const y = i * 32;
      g.fillStyle = i % 2 ? '#d89a58' : '#bf7f40';
      g.fillRect(0, y + 2, w, 28);
      g.fillStyle = 'rgba(90,45,15,0.35)';
      for (let k = 0; k < 6; k++) g.fillRect(Math.random() * w, y + 4 + Math.random() * 22, 20 + Math.random() * 40, 2);
      g.fillStyle = '#6b3d1a'; g.fillRect(0, y, w, 3);
      g.fillStyle = '#4a2a10';
      g.beginPath(); g.arc(10, y + 16, 3, 0, 7); g.arc(w - 10, y + 16, 3, 0, 7); g.fill();
    }
    g.strokeStyle = '#4a2a10'; g.lineWidth = 6; g.strokeRect(0, 0, w, h);
  });
}

function makeCrateTexture() {
  return makeCanvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#b5773a'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#9a6028';
    for (let i = 0; i < 5; i++) g.fillRect(0, i * 26 + 4, w, 3);
    g.strokeStyle = '#5a3412'; g.lineWidth = 14; g.strokeRect(7, 7, w - 14, h - 14);
    g.beginPath(); g.moveTo(10, 10); g.lineTo(w - 10, h - 10); g.stroke();
  });
}

function makeSidingTexture() {
  const t = makeCanvasTex(64, 64, (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,0.12)';
    for (let i = 0; i < 8; i++) g.fillRect(0, i * 8 + 6, w, 2);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 2);
  return t;
}

export function buildWorld(game) {
  const { scene } = game;
  const rng = mulberry32((Math.random() * 1e9) | 0);
  const R = (a, b) => a + (b - a) * rng();

  // ---------- house sites (terrain flattens around them) ----------
  const sites = [];
  let tries = 0;
  while (sites.length < 7 && tries++ < 500) {
    const x = R(-115, 115), z = R(-115, 115);
    if (sites.some(s => Math.hypot(s.x - x, s.z - z) < 38)) continue;
    sites.push({ x, z, r: 7.5, h: rawHeight(x, z) });
  }

  function heightAt(x, z) {
    let h = rawHeight(x, z);
    for (let i = 0; i < sites.length; i++) {
      const s = sites[i];
      const dx = x - s.x, dz = z - s.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < (s.r + 8) * (s.r + 8)) {
        const t = smoothstep(s.r + 8, s.r, Math.sqrt(d2));
        h += (s.h - h) * t;
      }
    }
    return h;
  }
  function normalAt(x, z) {
    const e = 0.5;
    const n = new THREE.Vector3(heightAt(x - e, z) - heightAt(x + e, z), 2 * e, heightAt(x, z - e) - heightAt(x, z + e));
    return n.normalize();
  }

  game.world = { size: 300, heightAt, normalAt, sites, lootSpawns: [] };
  const colliders = game.colliders;

  // ---------- terrain ----------
  const TS = 760, SEG = 230;
  const tg = new THREE.PlaneGeometry(TS, TS, SEG, SEG);
  tg.rotateX(-Math.PI / 2);
  const pos = tg.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  const cA = new THREE.Color(), cB = new THREE.Color(), cTmp = new THREE.Color();
  const grassDark = new THREE.Color('#3f9a3a'), grassLight = new THREE.Color('#8fd94e'), dirt = new THREE.Color('#c9a66b');
  const rock = new THREE.Color('#8a8496'), snow = new THREE.Color('#f4f7ff');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = heightAt(x, z);
    pos.setY(i, h);
    const n = valueNoise(x * 0.07, z * 0.07);
    cA.copy(grassDark).lerp(grassLight, n * 0.8 + 0.1);
    for (const s of sites) {
      const d = Math.hypot(x - s.x, z - s.z);
      if (d < s.r + 3) cA.lerp(dirt, smoothstep(s.r + 3, s.r - 1, d) * 0.7);
    }
    const r = Math.hypot(x, z);
    if (r > 150) {
      cA.lerp(rock, smoothstep(150, 200, r) * (0.6 + 0.4 * n));
      if (h > 40) cA.lerp(snow, smoothstep(40, 60, h));
    }
    cTmp.copy(cA);
    cols[i * 3] = cTmp.r; cols[i * 3 + 1] = cTmp.g; cols[i * 3 + 2] = cTmp.b;
  }
  tg.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  tg.computeVertexNormals();
  const terrain = new THREE.Mesh(tg, new THREE.MeshLambertMaterial({ vertexColors: true }));
  terrain.receiveShadow = true;
  terrain.name = 'terrain';
  scene.add(terrain);
  game.world.terrain = terrain;

  const dummy = new THREE.Object3D();
  const zeroM = new THREE.Matrix4().makeScale(0, 0, 0);
  const farFromSites = (x, z, pad) => sites.every(s => Math.hypot(s.x - x, s.z - z) > s.r + pad);

  // ---------- trees (instanced) ----------
  const TREE_N = 150;
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 2.6, 6); trunkGeo.translate(0, 1.3, 0);
  const leafGeo1 = new THREE.ConeGeometry(2.0, 3.4, 7); leafGeo1.translate(0, 3.6, 0);
  const leafGeo2 = new THREE.ConeGeometry(1.4, 2.8, 7); leafGeo2.translate(0, 5.4, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: '#7a4a24', flatShading: true }), TREE_N);
  const leaves1 = new THREE.InstancedMesh(leafGeo1, new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true }), TREE_N);
  const leaves2 = new THREE.InstancedMesh(leafGeo2, new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true }), TREE_N);
  [trunks, leaves1, leaves2].forEach(m => { m.castShadow = true; m.receiveShadow = false; scene.add(m); });
  const leafColors = ['#2f9e44', '#40c057', '#2b8a3e', '#69db7c', '#94d82d', '#37b24d'];
  let ti = 0;
  tries = 0;
  while (ti < TREE_N && tries++ < 3000) {
    const x = R(-142, 142), z = R(-142, 142);
    if (!farFromSites(x, z, 5)) continue;
    const y = heightAt(x, z), s = R(0.8, 1.45);
    dummy.position.set(x, y - 0.1, z); dummy.rotation.set(0, R(0, 6.28), 0); dummy.scale.setScalar(s); dummy.updateMatrix();
    trunks.setMatrixAt(ti, dummy.matrix); leaves1.setMatrixAt(ti, dummy.matrix); leaves2.setMatrixAt(ti, dummy.matrix);
    const lc = new THREE.Color(leafColors[(rng() * leafColors.length) | 0]);
    leaves1.setColorAt(ti, lc); leaves2.setColorAt(ti, lc.clone().offsetHSL(0, 0, 0.06));
    colliders.push({
      box: new THREE.Box3(new THREE.Vector3(x - 0.45 * s, y - 0.5, z - 0.45 * s), new THREE.Vector3(x + 0.45 * s, y + 6.8 * s, z + 0.45 * s)),
      mesh: null, hp: 200, maxHp: 200, kind: 'tree', owner: null, mats: 10,
      instances: [{ mesh: trunks, index: ti }, { mesh: leaves1, index: ti }, { mesh: leaves2, index: ti }],
      center: new THREE.Vector3(x, y + 3, z),
    });
    ti++;
  }
  for (let i = ti; i < TREE_N; i++) { trunks.setMatrixAt(i, zeroM); leaves1.setMatrixAt(i, zeroM); leaves2.setMatrixAt(i, zeroM); }
  [trunks, leaves1, leaves2].forEach(m => { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; m.computeBoundingSphere(); });

  // ---------- rocks (instanced) ----------
  const ROCK_N = 50;
  const rocks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true }), ROCK_N);
  rocks.castShadow = true; rocks.receiveShadow = true; scene.add(rocks);
  let ri = 0; tries = 0;
  while (ri < ROCK_N && tries++ < 2000) {
    const x = R(-140, 140), z = R(-140, 140);
    if (!farFromSites(x, z, 4)) continue;
    const y = heightAt(x, z);
    const sx = R(1.0, 2.6), sy = R(0.8, 1.9), sz = R(1.0, 2.6);
    dummy.position.set(x, y + sy * 0.35, z); dummy.rotation.set(0, R(0, 6.28), 0); dummy.scale.set(sx, sy, sz); dummy.updateMatrix();
    rocks.setMatrixAt(ri, dummy.matrix);
    rocks.setColorAt(ri, new THREE.Color().setHSL(0.7 + R(-0.05, 0.05), 0.08, R(0.45, 0.62)));
    const ex = Math.max(sx, sz) * 0.78;
    colliders.push({
      box: new THREE.Box3(new THREE.Vector3(x - ex, y - 1, z - ex), new THREE.Vector3(x + ex, y + sy * 1.2, z + ex)),
      mesh: null, hp: 300, maxHp: 300, kind: 'rock', owner: null, mats: 12,
      instances: [{ mesh: rocks, index: ri }], center: new THREE.Vector3(x, y + sy * 0.5, z),
    });
    ri++;
  }
  for (let i = ri; i < ROCK_N; i++) rocks.setMatrixAt(i, zeroM);
  rocks.instanceMatrix.needsUpdate = true; if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true; rocks.computeBoundingSphere();

  // ---------- grass tufts + flowers ----------
  const GRASS_N = 2600;
  const grass = new THREE.InstancedMesh(new THREE.ConeGeometry(0.13, 0.65, 3).translate(0, 0.32, 0), new THREE.MeshLambertMaterial({ color: '#ffffff' }), GRASS_N);
  for (let i = 0; i < GRASS_N; i++) {
    const x = R(-148, 148), z = R(-148, 148);
    dummy.position.set(x, heightAt(x, z) - 0.05, z); dummy.rotation.set(R(-0.25, 0.25), R(0, 6.28), R(-0.25, 0.25)); dummy.scale.setScalar(R(0.7, 1.5)); dummy.updateMatrix();
    grass.setMatrixAt(i, dummy.matrix);
    grass.setColorAt(i, new THREE.Color().setHSL(R(0.22, 0.32), 0.65, R(0.32, 0.5)));
  }
  scene.add(grass);
  const FLOWER_N = 500;
  const flowers = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.14, 0), new THREE.MeshBasicMaterial({ color: '#ffffff' }), FLOWER_N);
  const fcols = ['#ff6bd6', '#ffe14d', '#ffffff', '#7ad3ff', '#ff8a5c'];
  for (let i = 0; i < FLOWER_N; i++) {
    const x = R(-148, 148), z = R(-148, 148);
    dummy.position.set(x, heightAt(x, z) + 0.25, z); dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(R(0.8, 1.3)); dummy.updateMatrix();
    flowers.setMatrixAt(i, dummy.matrix);
    flowers.setColorAt(i, new THREE.Color(fcols[(rng() * fcols.length) | 0]));
  }
  scene.add(flowers);

  // ---------- clouds ----------
  const CLOUD_N = 28 * 5;
  const clouds = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#c8d8ff', emissiveIntensity: 0.45, flatShading: true }), CLOUD_N);
  for (let c = 0; c < 28; c++) {
    const cx = R(-320, 320), cz = R(-320, 320), cy = R(95, 150), s = R(6, 13);
    for (let k = 0; k < 5; k++) {
      dummy.position.set(cx + R(-1.6, 1.6) * s, cy + R(-0.3, 0.4) * s, cz + R(-0.8, 0.8) * s);
      dummy.rotation.set(0, R(0, 6), 0); dummy.scale.set(s * R(0.8, 1.3), s * R(0.55, 0.8), s * R(0.8, 1.2)); dummy.updateMatrix();
      clouds.setMatrixAt(c * 5 + k, dummy.matrix);
    }
  }
  scene.add(clouds);
  game.world.clouds = clouds;

  const crateQueue = [];
  function addCrate(x, z) { crateQueue.push([x, z]); }

  // ---------- houses ----------
  const siding = makeSidingTexture();
  const wallColors = ['#ffd6a5', '#bde0fe', '#ffc8dd', '#caffbf', '#fdffb6', '#e4c1f9', '#ffadad'];
  const roofColors = ['#e63946', '#1d6fd8', '#2a9d8f', '#f77f00', '#7b2cff', '#d6336c'];
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  sites.forEach((s, hi) => {
    const base = s.h;
    const group = new THREE.Group();
    group.position.set(s.x, 0, s.z);
    group.rotation.y = ((rng() * 4) | 0) * Math.PI / 2;
    scene.add(group);
    const wallMat = new THREE.MeshLambertMaterial({ color: wallColors[hi % wallColors.length], map: siding });
    const trimMat = new THREE.MeshLambertMaterial({ color: '#ffffff' });
    const winMat = new THREE.MeshBasicMaterial({ color: '#7fd6ff' });
    const roofMat = new THREE.MeshLambertMaterial({ color: roofColors[hi % roofColors.length], flatShading: true });
    const W = 8, H = 3.8, T = 0.3, below = 1.6;
    const parts = [];
    const addWall = (w, h, d, x, y, z, window) => {
      const m = new THREE.Mesh(boxGeo, wallMat);
      m.scale.set(w, h, d); m.position.set(x, y, z);
      m.castShadow = true; m.receiveShadow = true;
      group.add(m);
      if (window) {
        const wn = new THREE.Mesh(boxGeo, winMat);
        if (w > d) wn.scale.set(Math.min(0.5, 1.6 / w), 1.2 / h, 1.08);
        else wn.scale.set(1.08, 1.2 / h, Math.min(0.5, 1.6 / d));
        wn.position.set(0, (base + 2.1 - y) / h, 0);
        m.add(wn);
      }
      parts.push(m);
    };
    const wy = base + (H - below) / 2, wh = H + below;
    addWall(W, wh, T, 0, wy, -W / 2, true);
    addWall(T, wh, W, -W / 2, wy, 0, false);
    addWall(T, wh, W, W / 2, wy, 0, true);
    // front wall with door gap (2.2 wide, 2.7 tall)
    const side = (W - 2.2) / 2;
    addWall(side, wh, T, -W / 2 + side / 2, wy, W / 2, false);
    addWall(side, wh, T, W / 2 - side / 2, wy, W / 2, false);
    addWall(2.2, H - 2.7, T, 0, base + 2.7 + (H - 2.7) / 2, W / 2, false);
    // floor (visual)
    const fl = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: '#a0703c' }));
    fl.scale.set(W - 0.2, 0.2, W - 0.2); fl.position.set(0, base - 0.04, 0); fl.receiveShadow = true; group.add(fl);
    // door frame trim
    const trim = new THREE.Mesh(boxGeo, trimMat); trim.scale.set(2.6, 0.2, 0.4); trim.position.set(0, base + 2.75, W / 2); group.add(trim);
    // roof
    const roof = new THREE.Group();
    const slab = new THREE.Mesh(boxGeo, trimMat); slab.scale.set(W + 0.8, 0.3, W + 0.8); slab.position.y = 0;
    const pyr = new THREE.Mesh(new THREE.ConeGeometry(W * 0.78, 2.8, 4), roofMat); pyr.rotation.y = Math.PI / 4; pyr.position.y = 1.55;
    slab.castShadow = pyr.castShadow = true;
    roof.add(slab, pyr); roof.position.set(0, base + H + 0.15, 0);
    group.add(roof);
    group.updateMatrixWorld(true);
    for (const m of parts) {
      colliders.push({ box: new THREE.Box3().setFromObject(m), mesh: m, hp: 250, maxHp: 250, kind: 'house', owner: null, mats: 10 });
    }
    const rb = new THREE.Box3().setFromObject(slab);
    colliders.push({ box: rb, mesh: roof, hp: 400, maxHp: 400, kind: 'house', owner: null, mats: 10 });
    game.world.lootSpawns.push(new THREE.Vector3(s.x, base + 0.6, s.z));
    // crates beside house
    for (let k = 0; k < 2; k++) {
      const a = rng() * 6.28, d = s.r + R(1.5, 3);
      addCrate(s.x + Math.cos(a) * d, s.z + Math.sin(a) * d);
    }
  });

  // ---------- crates ----------
  const crateTex = makeCrateTexture();
  const crateMat = new THREE.MeshLambertMaterial({ map: crateTex });
  for (let i = 0; i < 22; i++) {
    const x = R(-135, 135), z = R(-135, 135);
    if (farFromSites(x, z, 3)) addCrate(x, z);
  }
  for (const [x, z] of crateQueue) {
    const y = heightAt(x, z);
    const s = R(1.1, 1.5);
    const m = new THREE.Mesh(boxGeo, crateMat);
    m.scale.setScalar(s); m.position.set(x, y + s / 2 - 0.05, z); m.rotation.y = 0;
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m); m.updateMatrixWorld();
    colliders.push({ box: new THREE.Box3().setFromObject(m), mesh: m, hp: 90, maxHp: 90, kind: 'prop', owner: null, mats: 15 });
  }

  // ---------- loot spawn points ----------
  tries = 0;
  while (game.world.lootSpawns.length < 30 && tries++ < 1000) {
    const x = R(-130, 130), z = R(-130, 130);
    game.world.lootSpawns.push(new THREE.Vector3(x, heightAt(x, z) + 0.6, z));
  }

  return game.world;
}

// ---------- Loot pickups ----------
const LOOT_TYPES = {
  shield: { color: '#3fa9ff', label: '+50 SHIELD' },
  medkit: { color: '#ff4f6b', label: '+50 HEALTH' },
  ammo: { color: '#5cff7a', label: 'AMMO' },
  mats: { color: '#ffb347', label: '+50 MATS' },
};

export function createLootSystem(game) {
  const { scene } = game;
  const items = [];
  const ringTex = makeCanvasTex(64, 64, (g, w, h) => {
    const gr = g.createRadialGradient(32, 32, 4, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  const geos = {
    shield: new THREE.CylinderGeometry(0.22, 0.28, 0.6, 10),
    medkit: new THREE.BoxGeometry(0.6, 0.4, 0.45),
    ammo: new THREE.BoxGeometry(0.55, 0.35, 0.35),
    mats: new THREE.BoxGeometry(0.6, 0.5, 0.6),
  };
  const crossGeo = new THREE.BoxGeometry(0.12, 0.42, 0.47);

  function spawn(type, pos) {
    const def = LOOT_TYPES[type];
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: def.color, emissive: def.color, emissiveIntensity: 0.6, roughness: 0.4 });
    const body = new THREE.Mesh(geos[type], mat);
    g.add(body);
    if (type === 'medkit') {
      const cm = new THREE.MeshBasicMaterial({ color: '#ffffff' });
      const c1 = new THREE.Mesh(crossGeo, cm), c2 = new THREE.Mesh(crossGeo, cm);
      c2.rotation.z = Math.PI / 2; c1.scale.y = 0.8; c2.scale.y = 0.8;
      g.add(c1, c2);
    }
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTex, color: def.color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.85 }));
    glow.scale.setScalar(2.0);
    g.add(glow);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.25, 4, 6, 1, true),
      new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false }));
    beam.position.y = 1.6;
    g.add(beam);
    g.position.copy(pos);
    scene.add(g);
    items.push({ type, group: g, body, base: pos.clone(), phase: Math.random() * 6.28 });
  }

  function update(dt, t, onPickup) {
    const p = game.player;
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      it.body.rotation.y += dt * 2.2;
      it.group.position.y = it.base.y + 0.45 + Math.sin(t * 2.5 + it.phase) * 0.18;
      if (p.alive && !p.dropping) {
        const dx = p.pos.x - it.base.x, dz = p.pos.z - it.base.z, dy = p.pos.y - it.base.y;
        if (dx * dx + dz * dz < 2.6 && Math.abs(dy) < 2.2) {
          if (onPickup(it.type, LOOT_TYPES[it.type].label) !== false) {
            scene.remove(it.group);
            items.splice(i, 1);
          }
        }
      }
    }
  }

  function populate() {
    const types = ['shield', 'medkit', 'ammo', 'mats', 'shield', 'ammo'];
    game.world.lootSpawns.forEach((sp, i) => spawn(types[i % types.length], sp));
  }

  function dropPile(pos) {
    const h = game.world.heightAt(pos.x, pos.z) + 0.6;
    const kinds = ['ammo', Math.random() < 0.5 ? 'shield' : 'medkit', 'mats'];
    kinds.forEach((k, i) => {
      const a = (i / kinds.length) * Math.PI * 2;
      const x = pos.x + Math.cos(a) * 1.4, z = pos.z + Math.sin(a) * 1.4;
      spawn(k, new THREE.Vector3(x, Math.max(h, game.world.heightAt(x, z) + 0.6), z));
    });
  }

  return { items, spawn, update, populate, dropPile };
}
