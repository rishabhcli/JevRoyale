// Jev Royale — visual FX + synthesized WebAudio SFX
import * as THREE from 'three';

const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const isVec = (v) => v && typeof v.x === 'number' && typeof v.y === 'number' && typeof v.z === 'number' && isFinite(v.x) && isFinite(v.y) && isFinite(v.z);

function toColor(c, fallback, out) {
  out = out || new THREE.Color();
  try {
    if (c && c.isColor) return out.copy(c);
    if (typeof c === 'number' || typeof c === 'string') return out.set(c);
  } catch (e) { /* fall through */ }
  return out.set(fallback);
}

export function createFX(game) {
  game = game || {};
  const scene = game.scene;
  const hasScene = !!(scene && scene.add);
  const root = new THREE.Group();
  root.name = 'fx-root';
  if (hasScene) scene.add(root);

  const groundAt = (x, z) => {
    try {
      if (game.world && typeof game.world.heightAt === 'function') {
        const h = game.world.heightAt(x, z);
        if (isFinite(h)) return h;
      }
    } catch (e) { /* ignore */ }
    return 0;
  };

  const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _c1 = new THREE.Color(), _c2 = new THREE.Color(), _c3 = new THREE.Color();
  const UP = new THREE.Vector3(0, 1, 0);
  const ZAX = new THREE.Vector3(0, 0, 1);
  const C = (hex) => new THREE.Color(hex);

  // ---------------------------------------------------------------- textures
  function canvasTex(size, draw) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const ctx = cv.getContext('2d');
    draw(ctx, size);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  const glowTex = canvasTex(128, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.7)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.15)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
  const starTex = canvasTex(128, (ctx, s) => {
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s * 0.32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.6)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    ctx.translate(s / 2, s / 2);
    for (let i = 0; i < 6; i++) {
      ctx.save();
      ctx.rotate((i / 6) * Math.PI * 2 + (i % 2) * 0.2);
      const len = i % 2 ? s * 0.32 : s * 0.48;
      const lg = ctx.createLinearGradient(0, 0, len, 0);
      lg.addColorStop(0, 'rgba(255,255,255,1)');
      lg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = lg;
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.05);
      ctx.lineTo(len, 0);
      ctx.lineTo(0, s * 0.05);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  });

  // ---------------------------------------------------------------- point particle systems
  const PVS = `
    attribute float size; attribute float alpha; attribute vec3 pcolor;
    uniform float uScale;
    varying vec3 vColor; varying float vAlpha;
    void main(){
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = min(size * uScale / max(-mv.z, 0.1), 300.0);
      gl_Position = projectionMatrix * mv;
      vColor = pcolor; vAlpha = alpha;
    }`;
  const PFS = `
    uniform float uAdd;
    varying vec3 vColor; varying float vAlpha;
    void main(){
      vec2 c = gl_PointCoord - 0.5;
      float d = length(c);
      if (d > 0.5 || vAlpha <= 0.0) discard;
      float soft = smoothstep(0.5, 0.0, d);
      float core = smoothstep(0.22, 0.0, d);
      float a = mix(smoothstep(0.5, 0.3, d), soft, uAdd);
      vec3 col = vColor * (1.0 + uAdd * core * 0.9);
      gl_FragColor = vec4(col, a * vAlpha);
    }`;
  const pointMats = [];

  function makePoints(cap, additive) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(cap * 3);
    const col = new Float32Array(cap * 3);
    const size = new Float32Array(cap);
    const alpha = new Float32Array(cap);
    const aPos = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
    const aCol = new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage);
    const aSize = new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage);
    const aAlpha = new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', aPos);
    geo.setAttribute('pcolor', aCol);
    geo.setAttribute('size', aSize);
    geo.setAttribute('alpha', aAlpha);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 500 }, uAdd: { value: additive ? 1 : 0 } },
      vertexShader: PVS, fragmentShader: PFS,
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    pointMats.push(mat);
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = additive ? 12 : 11;
    root.add(pts);

    const vel = new Float32Array(cap * 3);
    const life = new Float32Array(cap), maxLife = new Float32Array(cap);
    const s0 = new Float32Array(cap), s1 = new Float32Array(cap);
    const c0 = new Float32Array(cap * 3), c1 = new Float32Array(cap * 3);
    const grav = new Float32Array(cap), drag = new Float32Array(cap), a0 = new Float32Array(cap);
    let head = 0, live = 0;

    function spawn(x, y, z, vx, vy, vz, lf, sa, sb, ca, cb, g, dr, al) {
      const i = head;
      head = (head + 1) % cap;
      if (life[i] <= 0) live++;
      const i3 = i * 3;
      pos[i3] = x; pos[i3 + 1] = y; pos[i3 + 2] = z;
      vel[i3] = vx; vel[i3 + 1] = vy; vel[i3 + 2] = vz;
      life[i] = maxLife[i] = Math.max(0.01, lf);
      s0[i] = sa; s1[i] = sb;
      c0[i3] = ca.r; c0[i3 + 1] = ca.g; c0[i3 + 2] = ca.b;
      cb = cb || ca;
      c1[i3] = cb.r; c1[i3 + 1] = cb.g; c1[i3 + 2] = cb.b;
      grav[i] = g; drag[i] = dr; a0[i] = al == null ? 1 : al;
      size[i] = sa; alpha[i] = a0[i];
      col[i3] = ca.r; col[i3 + 1] = ca.g; col[i3 + 2] = ca.b;
    }

    function update(dt) {
      if (live <= 0) return;
      live = 0;
      for (let i = 0; i < cap; i++) {
        if (life[i] <= 0) continue;
        life[i] -= dt;
        if (life[i] <= 0) { size[i] = 0; alpha[i] = 0; continue; }
        live++;
        const i3 = i * 3;
        const k = 1 - life[i] / maxLife[i];
        const dd = Math.max(0, 1 - drag[i] * dt);
        vel[i3] *= dd; vel[i3 + 1] = vel[i3 + 1] * dd - grav[i] * dt; vel[i3 + 2] *= dd;
        pos[i3] += vel[i3] * dt; pos[i3 + 1] += vel[i3 + 1] * dt; pos[i3 + 2] += vel[i3 + 2] * dt;
        size[i] = s0[i] + (s1[i] - s0[i]) * k;
        alpha[i] = a0[i] * (k < 0.08 ? k / 0.08 : 1 - Math.pow(k, 2.2) * 0.98) ;
        col[i3] = c0[i3] + (c1[i3] - c0[i3]) * k;
        col[i3 + 1] = c0[i3 + 1] + (c1[i3 + 1] - c0[i3 + 1]) * k;
        col[i3 + 2] = c0[i3 + 2] + (c1[i3 + 2] - c0[i3 + 2]) * k;
      }
      aPos.needsUpdate = aCol.needsUpdate = aSize.needsUpdate = aAlpha.needsUpdate = true;
    }
    return { spawn, update, cap };
  }

  const ADD = makePoints(2200, true);
  const NRM = makePoints(1200, false);

  const _dir = new THREE.Vector3();
  function randDir(out) {
    const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
    return out.set(r * Math.cos(th), u, r * Math.sin(th));
  }
  // o: { dir, spread, speed:[a,b], up, life:[a,b], size:[a,b], end, colors:[Color], colorsEnd:[Color], g, drag, jitter, alpha }
  function burst(sys, p, n, o) {
    const sp = o.speed || [1, 3], lf = o.life || [0.4, 0.8], sz = o.size || [0.1, 0.2];
    const end = o.end == null ? 0.2 : o.end, jit = o.jitter || 0, up = o.up || 0;
    const spread = o.spread == null ? 1 : o.spread;
    for (let i = 0; i < n; i++) {
      randDir(_dir);
      if (o.dir) {
        _dir.multiplyScalar(spread).add(o.dir).normalize();
      }
      if (o.flat) { _dir.y *= 0.15; _dir.normalize(); }
      const s = rand(sp[0], sp[1]);
      const ci = Math.floor(Math.random() * o.colors.length);
      const ca = o.colors[ci];
      const cb = o.colorsEnd ? o.colorsEnd[ci % o.colorsEnd.length] : ca;
      const size0 = rand(sz[0], sz[1]);
      sys.spawn(
        p.x + (Math.random() - 0.5) * jit, p.y + (Math.random() - 0.5) * jit, p.z + (Math.random() - 0.5) * jit,
        _dir.x * s, _dir.y * s + up, _dir.z * s,
        rand(lf[0], lf[1]), size0, size0 * end, ca, cb, o.g || 0, o.drag || 0, o.alpha
      );
    }
  }

  // ---------------------------------------------------------------- instanced chunk systems
  const _dummy = new THREE.Object3D();
  function makeChunks(geo, mat, cap) {
    const mesh = new THREE.InstancedMesh(geo, mat, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    _dummy.position.set(0, -9999, 0); _dummy.scale.set(0, 0, 0); _dummy.updateMatrix();
    const white = new THREE.Color(1, 1, 1);
    for (let i = 0; i < cap; i++) { mesh.setMatrixAt(i, _dummy.matrix); mesh.setColorAt(i, white); }
    root.add(mesh);
    const P = new Float32Array(cap * 3), V = new Float32Array(cap * 3), R = new Float32Array(cap * 3), W = new Float32Array(cap * 3);
    const S = new Float32Array(cap * 3), L = new Float32Array(cap), G = new Float32Array(cap), F = new Float32Array(cap), PH = new Float32Array(cap);
    const REST = new Uint8Array(cap);
    let head = 0, live = 0, t = 0;

    function spawn(x, y, z, vx, vy, vz, sx, sy, sz, color, life, g, flutter) {
      const i = head; head = (head + 1) % cap;
      const i3 = i * 3;
      P[i3] = x; P[i3 + 1] = y; P[i3 + 2] = z;
      V[i3] = vx; V[i3 + 1] = vy; V[i3 + 2] = vz;
      R[i3] = rand(0, 6.28); R[i3 + 1] = rand(0, 6.28); R[i3 + 2] = rand(0, 6.28);
      const spin = flutter ? 9 : 12;
      W[i3] = rand(-spin, spin); W[i3 + 1] = rand(-spin, spin); W[i3 + 2] = rand(-spin, spin);
      S[i3] = sx; S[i3 + 1] = sy; S[i3 + 2] = sz;
      if (L[i] <= 0) live++;
      L[i] = life; G[i] = g == null ? 18 : g; F[i] = flutter || 0; PH[i] = rand(0, 6.28); REST[i] = 0;
      mesh.setColorAt(i, color);
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    function update(dt) {
      if (live <= 0) return;
      t += dt;
      live = 0;
      for (let i = 0; i < cap; i++) {
        if (L[i] <= 0) continue;
        L[i] -= dt;
        if (L[i] <= 0) {
          _dummy.position.set(0, -9999, 0); _dummy.scale.set(0, 0, 0); _dummy.rotation.set(0, 0, 0);
          _dummy.updateMatrix(); mesh.setMatrixAt(i, _dummy.matrix);
          continue;
        }
        live++;
        const i3 = i * 3;
        if (!REST[i]) {
          if (F[i] > 0) {
            const d = Math.max(0, 1 - 2.6 * dt);
            V[i3] = V[i3] * d + Math.sin(t * 5 + PH[i]) * F[i] * dt;
            V[i3 + 2] = V[i3 + 2] * d + Math.cos(t * 4.3 + PH[i]) * F[i] * dt;
            V[i3 + 1] = V[i3 + 1] * Math.max(0, 1 - 1.6 * dt) - G[i] * dt;
          } else {
            V[i3 + 1] -= G[i] * dt;
          }
          P[i3] += V[i3] * dt; P[i3 + 1] += V[i3 + 1] * dt; P[i3 + 2] += V[i3 + 2] * dt;
          R[i3] += W[i3] * dt; R[i3 + 1] += W[i3 + 1] * dt; R[i3 + 2] += W[i3 + 2] * dt;
          const gy = groundAt(P[i3], P[i3 + 2]) + S[i3 + 1] * 0.5;
          if (P[i3 + 1] < gy && V[i3 + 1] < 0) {
            P[i3 + 1] = gy;
            if (F[i] > 0 || Math.abs(V[i3 + 1]) < 1.5) {
              REST[i] = 1;
              if (F[i] > 0) { R[i3] = Math.PI / 2; R[i3 + 2] = 0; }
            } else {
              V[i3 + 1] *= -0.35; V[i3] *= 0.55; V[i3 + 2] *= 0.55;
              W[i3] *= 0.5; W[i3 + 1] *= 0.5; W[i3 + 2] *= 0.5;
            }
          }
        }
        const k = Math.min(1, L[i] / 0.5);
        _dummy.position.set(P[i3], P[i3 + 1], P[i3 + 2]);
        _dummy.rotation.set(R[i3], R[i3 + 1], R[i3 + 2]);
        _dummy.scale.set(S[i3] * k, S[i3 + 1] * k, S[i3 + 2] * k);
        _dummy.updateMatrix();
        mesh.setMatrixAt(i, _dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
    return { spawn, update, mesh };
  }

  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const nutGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.45, 6);
  const confGeo = new THREE.PlaneGeometry(1, 1);
  const CHUNKS = makeChunks(boxGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), 320);
  const NUTS = makeChunks(nutGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.8, roughness: 0.35 }), 80);
  const CONF = makeChunks(confGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }), 600);

  // ---------------------------------------------------------------- pooled mesh effects
  const activeFx = [];
  function meshPool(make, cap) {
    const items = [];
    return {
      get() {
        for (let i = 0; i < items.length; i++) if (!items[i].active) return items[i];
        if (items.length < cap) {
          const m = make();
          m.visible = false;
          m.frustumCulled = false;
          root.add(m);
          const it = { mesh: m, active: false, t: 0, life: 1, fn: null, a: new THREE.Vector3(), b: new THREE.Vector3(), n: 0, c: new THREE.Color() };
          items.push(it);
          return it;
        }
        let best = items[0];
        for (let i = 1; i < items.length; i++) if (items[i].t / items[i].life > best.t / best.life) best = items[i];
        return best;
      },
    };
  }
  function start(it, life, fn) {
    it.t = 0; it.life = Math.max(0.01, life); it.fn = fn;
    it.mesh.visible = true;
    if (!it.active) { it.active = true; activeFx.push(it); }
    fn(it, 0);
  }
  function updateFx(dt) {
    for (let i = activeFx.length - 1; i >= 0; i--) {
      const it = activeFx[i];
      it.t += dt;
      if (it.t >= it.life) {
        it.active = false; it.mesh.visible = false;
        activeFx[i] = activeFx[activeFx.length - 1]; activeFx.pop();
        continue;
      }
      it.fn(it, it.t / it.life);
    }
  }
  const addMat = (color, map) => new THREE.MeshBasicMaterial({
    color, map: map || null, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const spriteMat = (map) => new THREE.SpriteMaterial({ map, color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });

  const starPool = meshPool(() => { const s = new THREE.Sprite(spriteMat(starTex)); s.renderOrder = 14; return s; }, 16);
  const glowPool = meshPool(() => { const s = new THREE.Sprite(spriteMat(glowTex)); s.renderOrder = 13; return s; }, 16);
  const sphereGeo = new THREE.SphereGeometry(1, 20, 14);
  const spherePool = meshPool(() => new THREE.Mesh(sphereGeo, addMat(0xffcc66)), 8);
  const ringGeo = new THREE.RingGeometry(0.82, 1, 48);
  const ringPool = meshPool(() => new THREE.Mesh(ringGeo, addMat(0xffffff)), 14);
  const hexGeo = new THREE.RingGeometry(0.6, 1, 6);
  const hexPool = meshPool(() => new THREE.Mesh(hexGeo, addMat(0x55ccff)), 12);
  const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 16, 1, true);
  beamGeo.translate(0, 0.5, 0);
  const beamPool = meshPool(() => {
    const m = new THREE.Mesh(beamGeo, addMat(0xffffff));
    const core = new THREE.Mesh(beamGeo, addMat(0xffffff));
    core.scale.set(0.35, 1, 0.35);
    m.add(core);
    m.userData.core = core;
    return m;
  }, 5);
  const tracerGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
  const tracerPool = meshPool(() => {
    const m = new THREE.Mesh(tracerGeo, addMat(0xffdd55));
    const core = new THREE.Mesh(tracerGeo, addMat(0xffffff));
    core.scale.set(0.35, 1, 0.35);
    m.add(core);
    m.userData.core = core;
    m.renderOrder = 13;
    return m;
  }, 48);
  const decalGeo = new THREE.CircleGeometry(1, 14);
  const decalPool = meshPool(() => new THREE.Mesh(decalGeo, new THREE.MeshBasicMaterial({
    color: 0x1a120c, transparent: true, opacity: 0.6, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  })), 50);

  function decal(point, normal, radius, color, life) {
    const it = decalPool.get();
    const m = it.mesh;
    m.material.color.set(color);
    m.position.copy(point).addScaledVector(normal, 0.02);
    m.quaternion.setFromUnitVectors(ZAX, normal);
    m.rotateZ(rand(0, 6.28));
    m.scale.setScalar(radius * rand(0.8, 1.2));
    start(it, life, (it, k) => { it.mesh.material.opacity = 0.65 * (k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1); });
  }

  // ---------------------------------------------------------------- light pool
  const lights = [];
  if (hasScene) {
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 10, 2);
      l.userData = { t: 1, life: 1, i0: 0 };
      root.add(l);
      lights.push(l);
    }
  }
  function lightFlash(pos, color, intensity, dist, life) {
    if (!lights.length) return;
    let best = lights[0], bestRem = Infinity;
    for (const l of lights) {
      const rem = (1 - l.userData.t / l.userData.life) * l.userData.i0;
      if (rem < bestRem) { bestRem = rem; best = l; }
    }
    if (bestRem > intensity) return;
    best.position.copy(pos);
    best.color.copy(color);
    best.distance = dist;
    best.userData.t = 0; best.userData.life = life; best.userData.i0 = intensity;
    best.intensity = intensity;
  }
  function updateLights(dt) {
    for (const l of lights) {
      const u = l.userData;
      if (u.t >= u.life) { if (l.intensity !== 0) l.intensity = 0; continue; }
      u.t += dt;
      const k = Math.min(1, u.t / u.life);
      l.intensity = u.i0 * (1 - k) * (1 - k);
    }
  }

  // ---------------------------------------------------------------- DOM: style, layer, numbers, banner, hitmarker
  const hasDOM = typeof document !== 'undefined' && document.body;
  let layer = null, banner = null, ownHitmarker = null;
  if (hasDOM) {
    const st = document.createElement('style');
    st.id = 'fx-style';
    st.textContent = `
#fx-layer{position:fixed;inset:0;pointer-events:none;z-index:40;overflow:hidden}
.fx-num{position:absolute;left:0;top:0;pointer-events:none;will-change:transform,opacity;white-space:nowrap;
  font-family:'Luckiest Guy','Bungee',sans-serif;font-size:30px;color:#fff;letter-spacing:1px;
  -webkit-text-stroke:2px #1b0f2e;paint-order:stroke fill;text-shadow:0 3px 0 #1b0f2e,0 0 12px rgba(0,0,0,.35)}
.fx-num>span{display:inline-block;transform:translate(-50%,-50%)}
.fx-num.pop>span{animation:fxpop .38s cubic-bezier(.2,1.6,.4,1) both}
.fx-num.shield{color:#5fd4ff;text-shadow:0 3px 0 #0b2a4a,0 0 14px rgba(60,180,255,.7)}
.fx-num.head{color:#ffd83a;font-size:44px;text-shadow:0 4px 0 #7a2a00,0 0 18px rgba(255,140,0,.9)}
.fx-num.head.shield{color:#9fe8ff;text-shadow:0 4px 0 #0b2a4a,0 0 18px rgba(255,200,0,.9)}
.fx-num.elim{font-size:46px;color:#fff;-webkit-text-stroke:3px #1b0f2e;letter-spacing:3px}
@keyframes fxpop{0%{transform:translate(-50%,-50%) scale(.2) rotate(-12deg)}55%{transform:translate(-50%,-50%) scale(1.55) rotate(4deg)}100%{transform:translate(-50%,-50%) scale(1) rotate(0)}}
#fx-banner{position:fixed;left:50%;top:20%;transform:translateX(-50%);pointer-events:none;z-index:45;opacity:0;text-align:center;
  font-family:'Luckiest Guy','Bungee',sans-serif;font-size:72px;color:#fff;letter-spacing:4px;
  -webkit-text-stroke:3px #1b0f2e;paint-order:stroke fill;white-space:nowrap}
#fx-banner small{display:block;font-size:26px;letter-spacing:2px;color:#ffe96b;margin-top:-6px}
#fx-banner.show{animation:fxbanner 1.7s ease-out both}
@keyframes fxbanner{0%{opacity:0;transform:translateX(-50%) scale(2.6) rotate(-8deg)}12%{opacity:1;transform:translateX(-50%) scale(.9) rotate(2deg)}
  20%{transform:translateX(-50%) scale(1.08) rotate(-1deg)}28%{transform:translateX(-50%) scale(1)}80%{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}
  100%{opacity:0;transform:translateX(-50%) translateY(-40px) scale(.9)}}
#fx-hitmarker{position:fixed;left:50%;top:50%;width:28px;height:28px;margin:-14px 0 0 -14px;pointer-events:none;z-index:46;opacity:0;transform:scale(.6);transition:opacity .12s,transform .12s}
#fx-hitmarker i{position:absolute;left:50%;top:50%;width:3px;height:9px;margin:-4.5px 0 0 -1.5px;background:#fff;box-shadow:0 0 3px #000;border-radius:2px}
#fx-hitmarker i:nth-child(1){transform:rotate(45deg) translateY(-9px)}
#fx-hitmarker i:nth-child(2){transform:rotate(135deg) translateY(-9px)}
#fx-hitmarker i:nth-child(3){transform:rotate(225deg) translateY(-9px)}
#fx-hitmarker i:nth-child(4){transform:rotate(315deg) translateY(-9px)}
#fx-hitmarker.show{opacity:1;transform:scale(1);transition:none}
#fx-hitmarker.headshot i{background:#ffcf2e;box-shadow:0 0 6px #ff7a00}
#fx-hitmarker.headshot.show{transform:scale(1.35)}
`;
    document.head.appendChild(st);
    layer = document.createElement('div');
    layer.id = 'fx-layer';
    document.body.appendChild(layer);
    banner = document.createElement('div');
    banner.id = 'fx-banner';
    document.body.appendChild(banner);
  }

  const NUM_CAP = 48;
  const nums = [];
  let numHead = 0;
  function getNum() {
    if (nums.length < NUM_CAP) {
      const el = document.createElement('div');
      el.className = 'fx-num';
      const span = document.createElement('span');
      el.appendChild(span);
      el.style.display = 'none';
      layer.appendChild(el);
      const n = { el, span, pos: new THREE.Vector3(), t: 0, life: 1, active: false, dx: 0, rise: 1 };
      nums.push(n);
      return n;
    }
    const n = nums[numHead]; numHead = (numHead + 1) % NUM_CAP;
    return n;
  }
  function floatText(worldPos, text, cls, life, rise, dx) {
    if (!layer || !isVec(worldPos)) return;
    const n = getNum();
    n.pos.copy(worldPos);
    n.t = 0; n.life = life; n.active = true; n.rise = rise; n.dx = dx;
    n.span.textContent = text;
    n.el.className = 'fx-num ' + cls;
    n.el.style.display = 'block';
    n.el.style.opacity = '1';
    void n.el.offsetWidth;
    n.el.classList.add('pop');
    n.el.style.textShadow = '';
    return n;
  }
  const _proj = new THREE.Vector3();
  function updateNums(dt) {
    const cam = game.camera;
    if (!cam || !nums.length) return;
    const w = window.innerWidth, h = window.innerHeight;
    for (const n of nums) {
      if (!n.active) continue;
      n.t += dt;
      if (n.t >= n.life) { n.active = false; n.el.style.display = 'none'; continue; }
      const k = n.t / n.life;
      n.pos.y += n.rise * dt * (1 - k * 0.6);
      _proj.copy(n.pos).project(cam);
      if (_proj.z > 1 || _proj.z < -1) { n.el.style.opacity = '0'; continue; }
      const dist = cam.position.distanceTo(n.pos);
      const sc = clamp(14 / Math.max(dist, 0.1), 0.55, 1.3);
      const x = (_proj.x * 0.5 + 0.5) * w + n.dx * k * 40;
      const y = (-_proj.y * 0.5 + 0.5) * h;
      n.el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) scale(${sc.toFixed(3)})`;
      n.el.style.opacity = String(k > 0.65 ? 1 - (k - 0.65) / 0.35 : 1);
    }
  }

  // ---------------------------------------------------------------- shake
  let trauma = 0, shakeT = 0;
  const shakeOffset = new THREE.Vector3();
  function screenShake(intensity) {
    const v = Number(intensity);
    if (!isFinite(v) || v <= 0) return;
    trauma = Math.min(1, trauma + v);
  }
  function updateShake(dt) {
    shakeT += dt;
    trauma = Math.max(0, trauma - dt * 1.5);
    const s = trauma * trauma * 0.45;
    if (s <= 0) { shakeOffset.set(0, 0, 0); return; }
    const t = shakeT;
    shakeOffset.set(
      (Math.sin(t * 41.3) * 0.6 + Math.sin(t * 73.1 + 1.7) * 0.4) * s,
      (Math.sin(t * 37.7 + 2.1) * 0.6 + Math.sin(t * 89.3 + 0.4) * 0.4) * s,
      (Math.sin(t * 29.9 + 4.2) * 0.6 + Math.sin(t * 61.7 + 3.1) * 0.4) * s * 0.6
    );
  }

  // ---------------------------------------------------------------- palettes
  const PAL = {
    flashY: [C(0xfff2a8), C(0xffd25a), C(0xffffff)],
    spark: [C(0xffe680), C(0xffb030), C(0xffffff)],
    sparkEnd: [C(0xff5a10), C(0xff3000), C(0xffa040)],
    wood: [C(0x8a5a2b), C(0xa8743a), C(0x6b4320), C(0xc89456)],
    dust: [C(0xc9b38f), C(0xb59c78), C(0xd8c7a8)],
    dirt: [C(0x5a3d22), C(0x6e4b2a), C(0x4a3320), C(0x7c6a3a)],
    robo: [C(0x7ff6ff), C(0xffffff), C(0x40d8ff), C(0xb8fbff)],
    roboEnd: [C(0x2060ff), C(0x60b0ff), C(0x0040c0)],
    metal: [C(0x9aa3ad), C(0xc8ced6), C(0x6a737d), C(0xd6b24a)],
    shield: [C(0x3fb8ff), C(0x9fe8ff), C(0xffffff), C(0x5a7dff)],
    fire0: [C(0xfff4b0), C(0xffd050), C(0xffa030)],
    fire1: [C(0xff3a10), C(0xc01800), C(0x801000)],
    smoke0: [C(0x3a3430), C(0x4a4440), C(0x2c2826)],
    smoke1: [C(0x8a8580), C(0x777270), C(0x9a9590)],
    debris: [C(0x3b2a20), C(0x55463a), C(0x6a6a6a), C(0x2a2a2a)],
    confetti: [C(0xff3b6b), C(0xffd93b), C(0x3bff8a), C(0x3bb8ff), C(0xb93bff), C(0xff8a3b), C(0xffffff)],
    build: [C(0x9fe0ff), C(0xffffff), C(0x5ab8ff), C(0xc8f0ff)],
    storm: [C(0xc070ff), C(0xff60e0), C(0x8a50ff), C(0xffffff)],
    stormEnd: [C(0x5020a0), C(0xa030a0)],
  };

  // ---------------------------------------------------------------- visual FX API
  function muzzleFlash(pos, dir, color) {
    if (!isVec(pos)) return;
    const c = toColor(color, 0xffd25a, _c1);
    const d = isVec(dir) ? _v1.copy(dir).normalize() : _v1.set(0, 0, -1);
    const it = starPool.get();
    it.c.copy(c).lerp(_c2.set(0xffffff), 0.35);
    it.a.copy(pos);
    it.n = rand(0.55, 0.85);
    it.mesh.material.rotation = rand(0, 6.28);
    start(it, 0.06, (it, k) => {
      it.mesh.position.copy(it.a);
      it.mesh.scale.setScalar(it.n * (1 + k * 0.6));
      it.mesh.material.color.copy(it.c);
      it.mesh.material.opacity = 1 - k;
    });
    const g = glowPool.get();
    g.c.copy(c); g.a.copy(pos).addScaledVector(d, 0.15);
    start(g, 0.09, (it, k) => {
      it.mesh.position.copy(it.a);
      it.mesh.scale.setScalar(1.3 * (1 - k * 0.5));
      it.mesh.material.color.copy(it.c);
      it.mesh.material.opacity = 0.7 * (1 - k);
    });
    lightFlash(pos, c, 30, 9, 0.07);
    burst(ADD, pos, 5, { dir: d, spread: 0.45, speed: [5, 12], life: [0.08, 0.2], size: [0.05, 0.09], end: 0.2, colors: PAL.spark, colorsEnd: PAL.sparkEnd, g: 6, drag: 3 });
    burst(NRM, pos, 1, { dir: d, spread: 0.3, speed: [0.5, 1.5], life: [0.25, 0.4], size: [0.15, 0.25], end: 3, colors: [C(0x8a8580)], drag: 2, alpha: 0.25, g: -0.5 });
  }

  function tracer(from, to, color) {
    if (!isVec(from) || !isVec(to)) return;
    const len = from.distanceTo(to);
    if (len < 0.05) return;
    const it = tracerPool.get();
    it.a.copy(from); it.b.copy(to);
    it.c.copy(toColor(color, 0xffd25a, _c1));
    it.n = len;
    it.mesh.material.color.copy(it.c);
    _v1.copy(to).sub(from).normalize();
    it.mesh.quaternion.setFromUnitVectors(UP, _v1);
    start(it, 0.12, (it, k) => {
      const s = Math.min(0.85, k * 1.4);
      _v2.lerpVectors(it.a, it.b, s);
      const segLen = Math.max(0.01, it.n * (1 - s));
      it.mesh.position.lerpVectors(_v2, it.b, 0.5);
      const w = 0.045 * (1 - k * 0.6);
      it.mesh.scale.set(w, segLen, w);
      it.mesh.material.opacity = 0.85 * (1 - k);
      it.mesh.userData.core.material.opacity = 1 - k;
    });
  }

  function impact(point, normal, kind) {
    if (!isVec(point)) return;
    const n = isVec(normal) && (normal.x || normal.y || normal.z) ? _v3.copy(normal).normalize() : _v3.set(0, 1, 0);
    const p = _v2.copy(point).addScaledVector(n, 0.04);
    switch (kind) {
      case 'build': {
        burst(NRM, p, 9, { dir: n, spread: 0.8, speed: [2, 6], life: [0.4, 0.8], size: [0.07, 0.13], end: 0.6, colors: PAL.wood, g: 14, drag: 1 });
        burst(NRM, p, 5, { dir: n, spread: 0.9, speed: [0.5, 2], life: [0.5, 0.9], size: [0.3, 0.5], end: 2.5, colors: PAL.dust, g: -0.3, drag: 3, alpha: 0.45 });
        for (let i = 0; i < 3; i++) {
          randDir(_dir).multiplyScalar(0.7).add(n).normalize().multiplyScalar(rand(3, 6));
          CHUNKS.spawn(p.x, p.y, p.z, _dir.x, _dir.y + 2, _dir.z, 0.05, 0.05, rand(0.15, 0.25), pick(PAL.wood), rand(0.8, 1.4), 16, 0);
        }
        burst(ADD, p, 3, { dir: n, spread: 0.6, speed: [3, 6], life: [0.08, 0.15], size: [0.06, 0.1], colors: PAL.spark, colorsEnd: PAL.sparkEnd, drag: 3 });
        decal(point, n, 0.09, 0x2a1a0c, 6);
        break;
      }
      case 'flesh': {
        burst(ADD, p, 18, { dir: n, spread: 0.9, speed: [4, 11], life: [0.2, 0.5], size: [0.08, 0.15], end: 0.15, colors: PAL.robo, colorsEnd: PAL.roboEnd, g: 9, drag: 1.5 });
        burst(ADD, p, 6, { speed: [0.5, 1.5], life: [0.15, 0.3], size: [0.25, 0.4], end: 0.2, colors: [C(0x40e0ff)], drag: 4 });
        const cnt = randi(2, 3);
        for (let i = 0; i < cnt; i++) {
          randDir(_dir).multiplyScalar(0.8).add(n).normalize().multiplyScalar(rand(3, 6));
          const s = rand(0.06, 0.1);
          if (Math.random() < 0.5) NUTS.spawn(p.x, p.y, p.z, _dir.x, _dir.y + 3, _dir.z, s, s, s, pick(PAL.metal), rand(1, 1.6), 18, 0);
          else CHUNKS.spawn(p.x, p.y, p.z, _dir.x, _dir.y + 3, _dir.z, s * 0.5, s * 0.5, s * 2.2, pick(PAL.metal), rand(1, 1.6), 18, 0);
        }
        const g = starPool.get();
        g.a.copy(p); g.n = rand(0.4, 0.6);
        start(g, 0.07, (it, k) => {
          it.mesh.position.copy(it.a);
          it.mesh.scale.setScalar(it.n * (1 + k));
          it.mesh.material.color.setRGB(0.6, 0.95, 1);
          it.mesh.material.opacity = 1 - k;
        });
        break;
      }
      case 'shield': {
        burst(ADD, p, 22, { dir: n, spread: 1, speed: [2, 6], life: [0.3, 0.55], size: [0.08, 0.16], end: 0.1, colors: PAL.shield, drag: 4, g: -1 });
        const h = hexPool.get();
        h.a.copy(p); h.b.copy(n);
        h.mesh.quaternion.setFromUnitVectors(ZAX, n);
        h.mesh.rotateZ(rand(0, 1));
        start(h, 0.3, (it, k) => {
          it.mesh.position.copy(it.a);
          it.mesh.scale.setScalar(0.15 + k * 0.6);
          it.mesh.material.color.setRGB(0.35, 0.8, 1);
          it.mesh.material.opacity = 1 - k;
        });
        break;
      }
      case 'ground':
      default: {
        burst(NRM, p, 12, { dir: n, spread: 0.7, speed: [3, 7], life: [0.4, 0.8], size: [0.08, 0.16], end: 0.6, colors: PAL.dirt, g: 15, drag: 0.8 });
        burst(NRM, p, 6, { dir: n, spread: 0.9, speed: [0.6, 2], life: [0.6, 1.1], size: [0.35, 0.55], end: 2.6, colors: PAL.dust, g: -0.2, drag: 2.5, alpha: 0.5 });
        burst(ADD, p, 3, { dir: n, spread: 0.6, speed: [3, 7], life: [0.08, 0.15], size: [0.05, 0.08], colors: PAL.spark, colorsEnd: PAL.sparkEnd, drag: 3 });
        decal(point, n, 0.12, 0x1a120c, 7);
        break;
      }
    }
  }

  function explosion(pos, radius) {
    if (!isVec(pos)) return;
    const r = clamp(Number(radius) || 5, 0.5, 40);
    const p = _v2.copy(pos);
    const s = r / 5;
    const sp = spherePool.get();
    sp.a.copy(p); sp.n = r;
    start(sp, 0.35, (it, k) => {
      it.mesh.position.copy(it.a);
      it.mesh.scale.setScalar(it.n * (0.3 + 1.0 * (1 - Math.pow(1 - k, 3))));
      it.mesh.material.color.setRGB(1, 0.85 - k * 0.5, 0.45 - k * 0.4);
      it.mesh.material.opacity = 0.95 * (1 - k) * (1 - k);
    });
    const gl = glowPool.get();
    gl.a.copy(p); gl.n = r;
    start(gl, 0.4, (it, k) => {
      it.mesh.position.copy(it.a);
      it.mesh.scale.setScalar(it.n * 5 * (0.6 + k * 0.6));
      it.mesh.material.color.setRGB(1, 0.75, 0.4);
      it.mesh.material.opacity = 1 - k;
    });
    const st = starPool.get();
    st.a.copy(p); st.n = r;
    st.mesh.material.rotation = rand(0, 6.28);
    start(st, 0.18, (it, k) => {
      it.mesh.position.copy(it.a);
      it.mesh.scale.setScalar(it.n * 3.2 * (1 + k));
      it.mesh.material.color.setRGB(1, 0.95, 0.7);
      it.mesh.material.opacity = 1 - k;
    });
    const gy = groundAt(p.x, p.z);
    if (p.y - gy < r * 1.5) {
      for (let j = 0; j < 2; j++) {
        const rg = ringPool.get();
        rg.a.set(p.x, gy + 0.15 + j * 0.05, p.z); rg.n = r * (j ? 1.8 : 2.8);
        rg.c.set(j ? 0xffd080 : 0xffffff);
        start(rg, j ? 0.7 : 0.5, (it, k) => {
          it.mesh.position.copy(it.a);
          it.mesh.rotation.set(-Math.PI / 2, 0, 0);
          it.mesh.scale.setScalar(0.4 + it.n * (1 - Math.pow(1 - k, 2.5)));
          it.mesh.material.color.copy(it.c);
          it.mesh.material.opacity = 0.9 * (1 - k);
        });
      }
      decal(_v1.set(p.x, gy, p.z), UP, r * 0.55, 0x0e0a08, 12);
      burst(NRM, _v1.set(p.x, gy + 0.3, p.z), Math.round(18 * Math.min(2, s)), { flat: true, speed: [4 * s, 9 * s], life: [0.8, 1.4], size: [0.6, 1.0], end: 2.5, colors: PAL.dust, drag: 2.6, g: -0.2, alpha: 0.55 });
    }
    burst(ADD, p, Math.round(60 * Math.min(1.8, s)), { speed: [3 * s, 10 * s], life: [0.35, 0.85], size: [0.9 * s, 2.0 * s], end: 0.25, colors: PAL.fire0, colorsEnd: PAL.fire1, drag: 3, g: -2.5, jitter: r * 0.3 });
    burst(ADD, p, 40, { speed: [8, 22], life: [0.4, 1.0], size: [0.08, 0.16], end: 0.2, colors: PAL.spark, colorsEnd: PAL.sparkEnd, drag: 0.8, g: 12 });
    burst(NRM, p, Math.round(28 * Math.min(1.8, s)), { speed: [1 * s, 4.5 * s], up: 2, life: [1.4, 2.6], size: [1.2 * s, 2 * s], end: 2.4, colors: PAL.smoke0, colorsEnd: PAL.smoke1, drag: 1.6, g: -1.4, jitter: r * 0.5, alpha: 0.7 });
    const nDebris = Math.round(16 * Math.min(1.6, s));
    for (let i = 0; i < nDebris; i++) {
      randDir(_dir); _dir.y = Math.abs(_dir.y) + 0.3; _dir.normalize().multiplyScalar(rand(6, 15) * Math.sqrt(s));
      const sz = rand(0.1, 0.3);
      CHUNKS.spawn(p.x, p.y + 0.2, p.z, _dir.x, _dir.y, _dir.z, sz, sz * rand(0.6, 1), sz * rand(0.6, 1.4), pick(PAL.debris), rand(1.6, 2.6), 20, 0);
    }
    lightFlash(p, _c1.set(0xffa050), 900 * s, r * 6, 0.45);
    const cam = game.camera;
    const d = cam && cam.position ? cam.position.distanceTo(p) : 0;
    screenShake(clamp(1.1 - d / (r * 7), 0, 1) * 0.95);
    sfx.explosion(p);
  }

  function damageNumber(worldPos, amount, opts) {
    if (!isVec(worldPos)) return;
    const a = Math.round(Number(amount) || 0);
    if (!isFinite(a) || a <= 0) return;
    opts = opts || {};
    let cls = '';
    if (opts.shield) cls += ' shield';
    if (opts.headshot) cls += ' head';
    _v1.copy(worldPos);
    _v1.x += rand(-0.25, 0.25); _v1.y += rand(0.1, 0.4); _v1.z += rand(-0.25, 0.25);
    floatText(_v1, opts.headshot ? a + '!' : String(a), cls, opts.headshot ? 1.1 : 0.9, 1.6, rand(-1, 1));
  }

  function buildPlace(pos, size) {
    if (!isVec(pos)) return;
    let sx = 4, sy = 4, sz = 4;
    if (typeof size === 'number' && isFinite(size)) sx = sy = sz = size;
    else if (isVec(size)) { sx = size.x || 0.3; sy = size.y || 0.3; sz = size.z || 0.3; }
    for (let i = 0; i < 34; i++) {
      _v1.set(pos.x + (Math.random() - 0.5) * sx, pos.y + (Math.random() - 0.5) * sy, pos.z + (Math.random() - 0.5) * sz);
      randDir(_dir);
      const c = pick(PAL.build);
      ADD.spawn(_v1.x, _v1.y, _v1.z, _dir.x * 1.2, _dir.y * 1.2 + 1.5, _dir.z * 1.2, rand(0.35, 0.7), rand(0.1, 0.2), 0.02, c, PAL.build[2], 0, 2.5, 1);
    }
    const m = Math.max(sx, sz);
    const rg = ringPool.get();
    rg.a.copy(pos); rg.n = m;
    start(rg, 0.35, (it, k) => {
      it.mesh.position.copy(it.a);
      it.mesh.rotation.set(-Math.PI / 2, 0, 0);
      it.mesh.scale.setScalar(it.n * (0.3 + 0.6 * (1 - (1 - k) * (1 - k))));
      it.mesh.material.color.setRGB(0.55, 0.85, 1);
      it.mesh.material.opacity = 0.9 * (1 - k);
    });
    const gl = glowPool.get();
    gl.a.copy(pos); gl.n = m;
    start(gl, 0.22, (it, k) => {
      it.mesh.position.copy(it.a);
      it.mesh.scale.setScalar(it.n * 1.4);
      it.mesh.material.color.setRGB(0.5, 0.8, 1);
      it.mesh.material.opacity = 0.45 * (1 - k);
    });
  }

  function buildBreak(pos, color) {
    if (!isVec(pos)) return;
    const base = toColor(color, 0x9a6a3a, _c1);
    for (let i = 0; i < 16; i++) {
      randDir(_dir); _dir.y = Math.abs(_dir.y) * 0.8 + 0.2;
      _dir.normalize().multiplyScalar(rand(3, 8));
      _c2.copy(base).offsetHSL(rand(-0.02, 0.02), 0, rand(-0.12, 0.08));
      CHUNKS.spawn(pos.x + rand(-1.5, 1.5), pos.y + rand(-1.5, 1.5), pos.z + rand(-1.5, 1.5),
        _dir.x, _dir.y + 2, _dir.z, rand(0.12, 0.22), rand(0.06, 0.1), rand(0.5, 1.1), _c2, rand(1.4, 2.2), 18, 0);
    }
    burst(NRM, pos, 22, { speed: [1, 3.5], life: [0.8, 1.5], size: [0.7, 1.2], end: 2.2, colors: PAL.dust, drag: 2.2, g: -0.3, jitter: 3, alpha: 0.5 });
    burst(NRM, pos, 20, { speed: [3, 7], up: 2, life: [0.5, 1.0], size: [0.07, 0.14], end: 0.6, colors: PAL.wood, g: 14, drag: 0.6, jitter: 2.5 });
    burst(ADD, pos, 10, { speed: [2, 6], life: [0.2, 0.4], size: [0.1, 0.18], colors: PAL.spark, colorsEnd: PAL.sparkEnd, drag: 2, jitter: 2 });
  }

  let elimStreak = 0, lastElimT = -99, clock = 0;
  const STREAK = ['JEV DOWN!', 'DOUBLE JEV!', 'TRIPLE JEV!', 'JEV-POCALYPSE!', 'UNSTOPPA-JEV!'];
  function showBanner(text, sub, color) {
    if (!banner) return;
    banner.innerHTML = '';
    banner.appendChild(document.createTextNode(text));
    if (sub) { const sm = document.createElement('small'); sm.textContent = sub; banner.appendChild(sm); }
    const hex = '#' + color.getHexString();
    banner.style.textShadow = `0 5px 0 #1b0f2e, 0 0 24px ${hex}, 0 0 48px ${hex}`;
    banner.classList.remove('show');
    void banner.offsetWidth;
    banner.classList.add('show');
  }

  function elimination(pos, color) {
    if (!isVec(pos)) return;
    const c = toColor(color, 0xff3b6b, new THREE.Color());
    const p = _v2.copy(pos);
    const bm = beamPool.get();
    bm.a.copy(p); bm.c.copy(c);
    bm.mesh.material.color.copy(c);
    bm.mesh.userData.core.material.color.set(0xffffff);
    start(bm, 1.6, (it, k) => {
      it.mesh.position.copy(it.a);
      const grow = Math.min(1, k * 6);
      const w = (k < 0.15 ? 0.3 + k * 6 : 1.2 * (1 - (k - 0.15) / 0.85)) + 0.05;
      it.mesh.scale.set(w, 120 * grow, w);
      it.mesh.material.opacity = 0.75 * (1 - k);
      it.mesh.userData.core.material.opacity = 1 - k * k;
    });
    const gl = glowPool.get();
    gl.a.copy(p).y += 1; gl.c.copy(c);
    start(gl, 0.7, (it, k) => {
      it.mesh.position.copy(it.a);
      it.mesh.scale.setScalar(9 * (0.5 + k));
      it.mesh.material.color.copy(it.c);
      it.mesh.material.opacity = 1 - k;
    });
    const st = starPool.get();
    st.a.copy(p).y += 1.2;
    st.mesh.material.rotation = rand(0, 6.28);
    start(st, 0.3, (it, k) => {
      it.mesh.position.copy(it.a);
      it.mesh.scale.setScalar(6 * (0.6 + k));
      it.mesh.material.color.setRGB(1, 1, 1);
      it.mesh.material.opacity = 1 - k;
    });
    const gy = groundAt(p.x, p.z);
    for (let j = 0; j < 3; j++) {
      const rg = ringPool.get();
      rg.a.set(p.x, (j === 2 ? p.y + 1 : gy + 0.12 + j * 0.04), p.z);
      rg.n = 7 + j * 3; rg.c.copy(j === 1 ? _c3.set(0xffffff) : c);
      const tilt = j === 2;
      start(rg, 0.7 + j * 0.15, (it, k) => {
        it.mesh.position.copy(it.a);
        if (tilt) it.mesh.rotation.set(0, k * 2, 0); else it.mesh.rotation.set(-Math.PI / 2, 0, 0);
        it.mesh.scale.setScalar(0.5 + it.n * (1 - Math.pow(1 - k, 3)));
        it.mesh.material.color.copy(it.c);
        it.mesh.material.opacity = 1 - k;
      });
    }
    const conf = PAL.confetti.concat([c, c]);
    for (let i = 0; i < 140; i++) {
      const a = rand(0, 6.28), out = rand(2, 9);
      CONF.spawn(p.x, p.y + 1.2, p.z, Math.cos(a) * out, rand(7, 17), Math.sin(a) * out,
        rand(0.14, 0.2), rand(0.22, 0.32), 1, pick(conf), rand(2.6, 4.2), 7, rand(6, 14));
    }
    const sparkC = [c, C(0xffffff), c.clone().offsetHSL(0.08, 0, 0.1)];
    burst(ADD, _v1.copy(p).setY(p.y + 1), 90, { speed: [4, 14], life: [0.5, 1.2], size: [0.12, 0.25], end: 0.1, colors: sparkC, drag: 1.8, g: 3 });
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2;
      ADD.spawn(p.x + Math.cos(a) * 1.2, p.y + 0.4, p.z + Math.sin(a) * 1.2, Math.cos(a) * 8, rand(0.5, 2), Math.sin(a) * 8,
        rand(0.6, 0.9), 0.22, 0.04, sparkC[i % 2], c, 0, 2.2, 1);
    }
    for (let i = 0; i < 40; i++) {
      ADD.spawn(p.x + rand(-0.6, 0.6), p.y + rand(0, 3), p.z + rand(-0.6, 0.6), 0, rand(8, 25), 0, rand(0.6, 1.2), rand(0.2, 0.4), 0.05, sparkC[1], c, 0, 0.5, 1);
    }
    for (let i = 0; i < 10; i++) {
      randDir(_dir); _dir.y = Math.abs(_dir.y) + 0.5; _dir.normalize().multiplyScalar(rand(4, 9));
      const s = rand(0.1, 0.18);
      NUTS.spawn(p.x, p.y + 1, p.z, _dir.x, _dir.y, _dir.z, s, s, s, pick(PAL.metal), rand(2, 3), 18, 0);
    }
    lightFlash(_v1.copy(p).setY(p.y + 2), c, 700, 30, 0.8);
    const lab = floatText(_v1.copy(p).setY(p.y + 2.6), 'ELIMINATED', 'elim', 1.8, 0.9, 0);
    if (lab) lab.el.style.textShadow = `0 4px 0 #1b0f2e, 0 0 20px #${c.getHexString()}`;
    elimStreak = clock - lastElimT < 4 ? elimStreak + 1 : 0;
    lastElimT = clock;
    showBanner(STREAK[Math.min(elimStreak, STREAK.length - 1)], elimStreak ? 'x' + (elimStreak + 1) + ' STREAK' : '', c);
    screenShake(0.55);
    sfx.elim(p);
  }

  let hmTimer = 0;
  function hitmarker(headshot) {
    if (!hasDOM) return;
    let el = document.getElementById('hitmarker');
    if (!el) {
      if (!ownHitmarker) {
        ownHitmarker = document.createElement('div');
        ownHitmarker.id = 'fx-hitmarker';
        ownHitmarker.innerHTML = '<i></i><i></i><i></i><i></i>';
        document.body.appendChild(ownHitmarker);
      }
      el = ownHitmarker;
    }
    el.classList.remove('show', 'headshot');
    void el.offsetWidth;
    el.classList.add('show');
    if (headshot) el.classList.add('headshot');
    clearTimeout(hmTimer);
    hmTimer = setTimeout(() => el.classList.remove('show', 'headshot'), headshot ? 260 : 150);
  }

  // ---------------------------------------------------------------- ambient dust + storm edge
  const DUST_N = 240, DUST_R = 22;
  const dustGeo = new THREE.BufferGeometry();
  const dPos = new Float32Array(DUST_N * 3), dCol = new Float32Array(DUST_N * 3), dSize = new Float32Array(DUST_N), dAlpha = new Float32Array(DUST_N);
  const dPh = new Float32Array(DUST_N);
  for (let i = 0; i < DUST_N; i++) {
    dPos[i * 3] = rand(-DUST_R, DUST_R); dPos[i * 3 + 1] = rand(-DUST_R * 0.5, DUST_R * 0.5); dPos[i * 3 + 2] = rand(-DUST_R, DUST_R);
    const c = Math.random() < 0.3 ? _c1.set(0xfff0a0) : _c1.set(0xffffff);
    dCol[i * 3] = c.r; dCol[i * 3 + 1] = c.g; dCol[i * 3 + 2] = c.b;
    dSize[i] = rand(0.05, 0.12); dAlpha[i] = rand(0.15, 0.45); dPh[i] = rand(0, 6.28);
  }
  const dPosAttr = new THREE.BufferAttribute(dPos, 3).setUsage(THREE.DynamicDrawUsage);
  dustGeo.setAttribute('position', dPosAttr);
  dustGeo.setAttribute('pcolor', new THREE.BufferAttribute(dCol, 3));
  dustGeo.setAttribute('size', new THREE.BufferAttribute(dSize, 1));
  dustGeo.setAttribute('alpha', new THREE.BufferAttribute(dAlpha, 1));
  const dustMat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 500 }, uAdd: { value: 1 } }, vertexShader: PVS, fragmentShader: PFS,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  pointMats.push(dustMat);
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.frustumCulled = false;
  root.add(dust);
  let dustInit = false;
  function updateDust(dt) {
    const cam = game.camera;
    if (!cam) return;
    const cx = cam.position.x, cy = cam.position.y, cz = cam.position.z;
    if (!dustInit) {
      for (let i = 0; i < DUST_N; i++) { dPos[i * 3] += cx; dPos[i * 3 + 1] += cy; dPos[i * 3 + 2] += cz; }
      dustInit = true;
    }
    const t = clock;
    const R2 = DUST_R * 2, RY = DUST_R;
    for (let i = 0; i < DUST_N; i++) {
      const i3 = i * 3;
      dPos[i3] += (0.25 + Math.sin(t * 0.5 + dPh[i]) * 0.3) * dt;
      dPos[i3 + 1] += Math.sin(t * 0.8 + dPh[i] * 2) * 0.15 * dt;
      dPos[i3 + 2] += Math.cos(t * 0.4 + dPh[i]) * 0.3 * dt;
      let dx = dPos[i3] - cx; if (dx > DUST_R) dPos[i3] -= R2; else if (dx < -DUST_R) dPos[i3] += R2;
      let dy = dPos[i3 + 1] - cy; if (dy > RY * 0.5) dPos[i3 + 1] -= RY; else if (dy < -RY * 0.5) dPos[i3 + 1] += RY;
      let dz = dPos[i3 + 2] - cz; if (dz > DUST_R) dPos[i3 + 2] -= R2; else if (dz < -DUST_R) dPos[i3 + 2] += R2;
    }
    dPosAttr.needsUpdate = true;
  }

  let stormAcc = 0;
  function updateStorm(dt) {
    const s = game.storm, cam = game.camera;
    if (!s || !cam || !isVec(s.center) || !(s.radius > 0)) return;
    const dx = cam.position.x - s.center.x, dz = cam.position.z - s.center.z;
    const dc = Math.sqrt(dx * dx + dz * dz);
    if (Math.abs(dc - s.radius) > 90) return;
    const a0 = Math.atan2(dz, dx);
    const span = Math.min(Math.PI, 70 / Math.max(1, s.radius));
    stormAcc += dt * 90;
    while (stormAcc >= 1) {
      stormAcc -= 1;
      const a = a0 + (Math.random() * 2 - 1) * span;
      const x = s.center.x + Math.cos(a) * s.radius, z = s.center.z + Math.sin(a) * s.radius;
      const y = groundAt(x, z) + rand(0, 25);
      const ci = randi(0, PAL.storm.length - 1);
      ADD.spawn(x, y, z, rand(-0.3, 0.3), rand(1, 3.5), rand(-0.3, 0.3), rand(1.2, 2.4), rand(0.2, 0.45), 0.02, PAL.storm[ci], PAL.stormEnd[ci % 2], -0.5, 0.3, 0.9);
    }
  }

  function updateScale() {
    const cam = game.camera;
    let h = (typeof window !== 'undefined' ? window.innerHeight : 800) * (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
    try {
      if (game.renderer && game.renderer.domElement) h = game.renderer.domElement.height || h;
    } catch (e) { /* ignore */ }
    const fov = cam && cam.fov ? cam.fov : 70;
    const sc = h / (2 * Math.tan((fov * Math.PI) / 360));
    for (const m of pointMats) m.uniforms.uScale.value = sc;
  }

  function update(dt) {
    dt = Number(dt);
    if (!isFinite(dt) || dt <= 0) return;
    dt = Math.min(dt, 0.1);
    clock += dt;
    try {
      updateScale();
      updateShake(dt);
      updateStorm(dt);
      ADD.update(dt);
      NRM.update(dt);
      CHUNKS.update(dt);
      NUTS.update(dt);
      CONF.update(dt);
      updateFx(dt);
      updateLights(dt);
      updateDust(dt);
      updateNums(dt);
    } catch (e) {
      if (!update._warned) { update._warned = true; console.warn('[fx] update error', e); }
    }
  }

  // ================================================================ AUDIO
  let actx = null, master = null, noiseBuf = null, voices = 0;
  const MAX_VOICES = 22;
  const lastPlay = {};
  const _aq = new THREE.Quaternion();
  const _av = new THREE.Vector3();

  function ac() {
    if (actx) return actx;
    try {
      const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
      if (!AC) return null;
      actx = new AC();
      const comp = actx.createDynamicsCompressor();
      comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 6;
      comp.attack.value = 0.002; comp.release.value = 0.18;
      master = actx.createGain();
      master.gain.value = 0.6;
      master.connect(comp);
      comp.connect(actx.destination);
      const len = Math.floor(actx.sampleRate * 3);
      noiseBuf = actx.createBuffer(1, len, actx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { actx = null; }
    return actx;
  }

  function env(param, t, dur, vol, attack) {
    param.setValueAtTime(0.0001, t);
    param.linearRampToValueAtTime(Math.max(0.0002, vol), t + attack);
    param.exponentialRampToValueAtTime(0.0001, t + Math.max(dur, attack + 0.005));
  }
  function tone(dest, t, dur, o) {
    const osc = actx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(Math.max(1, o.f0), t);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t + dur * (o.sweep || 1));
    if (o.detune) osc.detune.value = o.detune;
    const g = actx.createGain();
    env(g.gain, t, dur, o.vol == null ? 0.5 : o.vol, o.attack || 0.003);
    osc.connect(g); g.connect(dest);
    osc.start(t); osc.stop(t + dur + 0.05);
  }
  function nz(dest, t, dur, o) {
    const s = actx.createBufferSource();
    s.buffer = noiseBuf;
    s.playbackRate.value = o.rate || 1;
    const f = actx.createBiquadFilter();
    f.type = o.type || 'bandpass';
    f.frequency.setValueAtTime(o.f0 || 1000, t);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + dur);
    f.Q.value = o.q == null ? 1 : o.q;
    const g = actx.createGain();
    env(g.gain, t, dur, o.vol == null ? 0.5 : o.vol, o.attack || 0.002);
    s.connect(f); f.connect(g); g.connect(dest);
    s.start(t, Math.random() * 1.4, dur + 0.05);
  }
  function bus(pos, vol, dur) {
    let v = vol, pan = 0;
    const cam = game.camera;
    if (isVec(pos) && cam && cam.position) {
      _av.set(pos.x - cam.position.x, pos.y - cam.position.y, pos.z - cam.position.z);
      const d = _av.length();
      if (d > 170) return null;
      v *= Math.min(1, 1.5 / (1 + d * 0.09)) * (1 - d / 170);
      if (d > 0.5 && cam.quaternion) {
        _av.applyQuaternion(_aq.copy(cam.quaternion).invert());
        pan = clamp(_av.x / d, -1, 1) * 0.85;
      }
    }
    if (v < 0.01) return null;
    const g = actx.createGain();
    g.gain.value = v;
    let tail = g;
    if (pan && actx.createStereoPanner) {
      const p = actx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p); p.connect(master); tail = p;
    } else g.connect(master);
    voices++;
    setTimeout(() => {
      voices--;
      try { g.disconnect(); if (tail !== g) tail.disconnect(); } catch (e) { /* ignore */ }
    }, (dur + 0.4) * 1000);
    return g;
  }
  function play(name, gap, pos, vol, dur, fn) {
    try {
      const c = ac();
      if (!c || c.state !== 'running') return;
      if (voices >= MAX_VOICES) return;
      const now = c.currentTime;
      if (gap && lastPlay[name] != null && now - lastPlay[name] < gap) return;
      lastPlay[name] = now;
      const out = bus(pos, vol, dur);
      if (!out) return;
      fn(out, now + 0.005);
    } catch (e) { /* never throw */ }
  }
  const note = (n) => 440 * Math.pow(2, (n - 69) / 12);

  const shotFns = {
    rifle(o, t) {
      nz(o, t, 0.13, { type: 'bandpass', f0: 3200, f1: 700, q: 0.8, vol: 0.9 });
      nz(o, t, 0.04, { type: 'highpass', f0: 5000, vol: 0.5 });
      tone(o, t, 0.12, { type: 'sine', f0: 160, f1: 45, vol: 0.9 });
      tone(o, t, 0.03, { type: 'square', f0: 900, f1: 220, vol: 0.12 });
    },
    shotgun(o, t) {
      nz(o, t, 0.4, { type: 'lowpass', f0: 4000, f1: 250, q: 0.7, vol: 1.2 });
      nz(o, t, 0.06, { type: 'highpass', f0: 3500, vol: 0.7 });
      tone(o, t, 0.38, { type: 'sine', f0: 120, f1: 32, vol: 1.1 });
      tone(o, t + 0.01, 0.12, { type: 'triangle', f0: 260, f1: 70, vol: 0.4 });
    },
    smg(o, t) {
      nz(o, t, 0.055, { type: 'bandpass', f0: 3400, f1: 1500, q: 1.2, vol: 0.65 });
      tone(o, t, 0.025, { type: 'square', f0: rand(1300, 1600), f1: 450, vol: 0.14 });
      tone(o, t, 0.06, { type: 'sine', f0: 200, f1: 80, vol: 0.5 });
    },
    rocket(o, t) {
      nz(o, t, 0.7, { type: 'bandpass', f0: 300, f1: 2400, q: 1.6, vol: 0.9, attack: 0.05 });
      nz(o, t, 0.12, { type: 'lowpass', f0: 1800, f1: 200, vol: 0.8 });
      tone(o, t, 0.5, { type: 'sawtooth', f0: 90, f1: 40, vol: 0.25 });
      tone(o, t, 0.15, { type: 'sine', f0: 110, f1: 40, vol: 0.8 });
    },
    pickaxe(o, t) {
      tone(o, t, 0.09, { type: 'triangle', f0: rand(300, 360), f1: 170, vol: 0.6 });
      nz(o, t, 0.07, { type: 'bandpass', f0: 1300, q: 3, vol: 0.5 });
      tone(o, t, 0.12, { type: 'sine', f0: 95, f1: 60, vol: 0.5 });
      nz(o, t, 0.25, { type: 'highpass', f0: 2500, vol: 0.12, attack: 0.04 });
    },
  };

  // Recorded battle-bus clips. Music is one decoded buffer looped end to end so the
  // whole track plays before it repeats. Horn and drop stay on their own elements,
  // off the synth compressor, so the existing effects keep their levels.
  const MUSIC_VOL = 0.62;
  function makeEl(url, volume) {
    const el = new Audio(url);
    el.preload = 'auto';
    el.volume = volume;
    return el;
  }
  const busHorn = makeEl('/audio/battle-bus-horn.mp3', 0.9);
  const busDrop = makeEl('/audio/battle-bus-drop.mp3', 1);
  let busLeft = false;
  let musicWanted = false;
  let musicBuf = null;
  let musicSrc = null;
  let musicGain = null;

  function playEl(el) {
    const p = el.play();
    if (p && p.catch) p.catch(() => {});
    return p;
  }
  function fadeEl(el, ms) {
    const from = el.volume;
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / ms);
      el.volume = from * (1 - k);
      if (k < 1) requestAnimationFrame(step);
      else { el.pause(); el.volume = from; }
    };
    requestAnimationFrame(step);
  }
  function startBusMusic() {
    const c = ac();
    if (!musicBuf || musicSrc || !musicWanted || busLeft || game.started || game.over) return;
    if (!c || c.state !== 'running') return;
    const src = c.createBufferSource();
    src.buffer = musicBuf;
    src.loop = true;
    const g = c.createGain();
    g.gain.value = MUSIC_VOL;
    src.connect(g);
    g.connect(c.destination);
    musicSrc = src;
    musicGain = g;
    src.start();
  }
  {
    const c = ac();
    if (c) {
      fetch('/audio/battle-bus-music.mp3')
        .then((r) => r.arrayBuffer())
        .then((buf) => c.decodeAudioData(buf.slice(0)))
        .then((decoded) => { musicBuf = decoded; startBusMusic(); })
        .catch(() => {});
    }
  }

  const sfx = {
    unlock() {
      try {
        const c = ac();
        if (c && c.state !== 'running' && c.resume) c.resume().catch(() => {});
      } catch (e) { /* ignore */ }
    },
    lobby() {
      if (busLeft || musicSrc || game.started || game.over) return;
      musicWanted = true;
      const c = ac();
      if (!c) return;
      const ready = c.state === 'running' ? Promise.resolve() : c.resume();
      ready.then(() => startBusMusic()).catch(() => {});
    },
    depart() {
      if (busLeft) return;
      busLeft = true;
      musicWanted = false;
      const c = ac();
      if (musicGain && c) {
        const now = c.currentTime;
        const g = musicGain.gain;
        g.cancelScheduledValues(now);
        g.setValueAtTime(g.value, now);
        g.linearRampToValueAtTime(0.0001, now + 0.9);
        const src = musicSrc;
        musicSrc = null;
        setTimeout(() => { try { src.stop(); } catch (e) { /* already stopped */ } }, 1000);
      }
      busHorn.currentTime = 0;
      busDrop.currentTime = 0;
      playEl(busHorn);
      playEl(busDrop);
    },
    dropSettle() {
      if (!busLeft || busDrop.paused) return;
      fadeEl(busDrop, 500);
    },
    shot(weapon, pos) {
      const fn = shotFns[weapon] || shotFns.rifle;
      const w = shotFns[weapon] ? weapon : 'rifle';
      const isLocal = !isVec(pos);
      play('shot_' + w + (isLocal ? '' : '_r'), w === 'smg' ? 0.03 : 0.045, pos, isLocal ? 0.7 : 0.9, w === 'rocket' || w === 'shotgun' ? 0.8 : 0.3, fn);
    },
    hit(pos) {
      play('hit', 0.025, pos, 0.6, 0.12, (o, t) => {
        tone(o, t, 0.05, { type: 'square', f0: 1900, f1: 1500, vol: 0.22 });
        tone(o, t, 0.07, { type: 'sine', f0: 2700, vol: 0.25 });
        nz(o, t, 0.02, { type: 'highpass', f0: 6000, vol: 0.2 });
      });
    },
    headshot(pos) {
      play('headshot', 0.04, pos, 0.7, 0.4, (o, t) => {
        tone(o, t, 0.32, { type: 'sine', f0: 2350, vol: 0.4 });
        tone(o, t, 0.22, { type: 'sine', f0: 3520, vol: 0.22 });
        tone(o, t + 0.04, 0.3, { type: 'triangle', f0: 4700, vol: 0.1 });
        tone(o, t, 0.06, { type: 'square', f0: 1200, f1: 900, vol: 0.12 });
      });
    },
    shieldBreak(pos) {
      play('shieldBreak', 0.15, pos, 0.8, 0.6, (o, t) => {
        nz(o, t, 0.45, { type: 'highpass', f0: 4500, vol: 0.6 });
        nz(o, t, 0.2, { type: 'bandpass', f0: 2500, f1: 800, q: 2, vol: 0.4 });
        for (let i = 0; i < 7; i++) tone(o, t + i * 0.025 + Math.random() * 0.02, 0.15, { type: 'sine', f0: rand(2200, 5200), vol: 0.14 });
        tone(o, t, 0.35, { type: 'triangle', f0: 1600, f1: 260, vol: 0.3 });
      });
    },
    build(pos) {
      play('build', 0.04, pos, 0.65, 0.2, (o, t) => {
        tone(o, t, 0.1, { type: 'triangle', f0: rand(220, 250), f1: 140, vol: 0.6 });
        nz(o, t, 0.05, { type: 'bandpass', f0: 950, q: 4, vol: 0.6 });
        tone(o, t, 0.12, { type: 'sine', f0: 115, f1: 75, vol: 0.6 });
        tone(o, t + 0.03, 0.08, { type: 'sine', f0: 700, f1: 900, vol: 0.08 });
      });
    },
    breakBuild(pos) {
      play('breakBuild', 0.06, pos, 0.85, 0.45, (o, t) => {
        nz(o, t, 0.3, { type: 'bandpass', f0: 1600, f1: 350, q: 1, vol: 0.9 });
        for (let i = 0; i < 5; i++) nz(o, t + i * 0.035 + Math.random() * 0.02, 0.04, { type: 'bandpass', f0: rand(1500, 3500), q: 3, vol: 0.5 });
        tone(o, t, 0.18, { type: 'square', f0: 150, f1: 55, vol: 0.25 });
        tone(o, t, 0.2, { type: 'sine', f0: 90, f1: 40, vol: 0.6 });
      });
    },
    elim(pos) {
      play('elim', 0.1, null, 0.85, 1.0, (o, t) => {
        const arp = [72, 76, 79, 84, 88];
        arp.forEach((n, i) => {
          tone(o, t + i * 0.055, 0.14, { type: 'square', f0: note(n), vol: 0.16 });
          tone(o, t + i * 0.055, 0.18, { type: 'triangle', f0: note(n + 12), vol: 0.12 });
        });
        tone(o, t + 0.28, 0.6, { type: 'sine', f0: 170, f1: 38, vol: 1.0 });
        nz(o, t + 0.28, 0.5, { type: 'lowpass', f0: 2500, f1: 120, vol: 0.5 });
        nz(o, t, 0.3, { type: 'highpass', f0: 3000, f1: 9000, vol: 0.12, attack: 0.2 });
      });
    },
    footstep(pos) {
      play('footstep' + (isVec(pos) ? '_r' : ''), 0.07, pos, 0.35, 0.12, (o, t) => {
        nz(o, t, rand(0.05, 0.08), { type: 'lowpass', f0: rand(380, 750), q: 1.2, vol: 0.5, rate: rand(0.8, 1.2) });
        tone(o, t, 0.05, { type: 'sine', f0: rand(70, 100), f1: 50, vol: 0.25 });
      });
    },
    reload(pos) {
      play('reload', 0.2, pos, 0.6, 0.5, (o, t) => {
        tone(o, t, 0.02, { type: 'square', f0: 2200, f1: 1400, vol: 0.2 });
        nz(o, t, 0.03, { type: 'highpass', f0: 3000, vol: 0.4 });
        nz(o, t + 0.05, 0.12, { type: 'bandpass', f0: 1800, f1: 3500, q: 3, vol: 0.15 });
        tone(o, t + 0.22, 0.025, { type: 'square', f0: 1500, f1: 800, vol: 0.25 });
        nz(o, t + 0.22, 0.04, { type: 'bandpass', f0: 2200, q: 2, vol: 0.5 });
        tone(o, t + 0.22, 0.06, { type: 'sine', f0: 180, f1: 100, vol: 0.3 });
      });
    },
    pickup(pos) {
      play('pickup', 0.08, pos, 0.6, 0.4, (o, t) => {
        tone(o, t, 0.16, { type: 'sine', f0: 600, f1: 1900, vol: 0.3 });
        [1320, 1760, 2640].forEach((f, i) => tone(o, t + 0.05 + i * 0.05, 0.14, { type: 'triangle', f0: f, vol: 0.18 }));
      });
    },
    stormTick(pos) {
      play('stormTick', 0.3, pos, 0.55, 0.5, (o, t) => {
        const lp = actx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 380; lp.Q.value = 4;
        lp.connect(o);
        tone(lp, t, 0.4, { type: 'sawtooth', f0: 55, vol: 0.6, attack: 0.04 });
        tone(lp, t, 0.4, { type: 'sawtooth', f0: 58.5, vol: 0.5, attack: 0.04 });
        tone(lp, t, 0.4, { type: 'square', f0: 110, f1: 82, vol: 0.2, attack: 0.04 });
        nz(o, t, 0.35, { type: 'bandpass', f0: 200, q: 2, vol: 0.3, attack: 0.05 });
      });
    },
    jump(pos) {
      play('jump', 0.1, pos, 0.4, 0.2, (o, t) => {
        tone(o, t, 0.13, { type: 'sine', f0: 220, f1: 480, vol: 0.3 });
        nz(o, t, 0.06, { type: 'lowpass', f0: 800, vol: 0.3 });
      });
    },
    land(pos) {
      play('land', 0.12, pos, 0.5, 0.2, (o, t) => {
        tone(o, t, 0.12, { type: 'sine', f0: 130, f1: 50, vol: 0.6 });
        nz(o, t, 0.1, { type: 'lowpass', f0: 600, f1: 200, vol: 0.5 });
      });
    },
    victory() {
      play('victory', 1, null, 0.8, 2.2, (o, t) => {
        const seq = [[67, 0, 0.12], [72, 0.12, 0.12], [76, 0.24, 0.12], [79, 0.36, 0.24], [76, 0.62, 0.12], [79, 0.74, 0.12], [84, 0.86, 0.8]];
        for (const [n, at, d] of seq) {
          tone(o, t + at, d + 0.05, { type: 'square', f0: note(n), vol: 0.18 });
          tone(o, t + at, d + 0.05, { type: 'square', f0: note(n), detune: 8, vol: 0.08 });
        }
        [[48, 0], [55, 0.36], [60, 0.86]].forEach(([n, at]) => tone(o, t + at, 0.5, { type: 'triangle', f0: note(n), vol: 0.35 }));
        [88, 91, 96].forEach((n, i) => tone(o, t + 0.9 + i * 0.07, 0.5, { type: 'sine', f0: note(n), vol: 0.07 }));
      });
    },
    defeat() {
      play('defeat', 1, null, 0.8, 2.4, (o, t) => {
        const lp = actx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 1400;
        lp.connect(o);
        [67, 66, 65, 64].forEach((n, i) => {
          const d = i === 3 ? 1.0 : 0.32;
          tone(lp, t + i * 0.36, d, { type: 'sawtooth', f0: note(n), f1: i === 3 ? note(n - 1) : 0, vol: 0.3, attack: 0.02 });
          tone(lp, t + i * 0.36, d, { type: 'triangle', f0: note(n - 12), vol: 0.25, attack: 0.02 });
        });
        tone(o, t + 1.08, 1.0, { type: 'sine', f0: note(40), f1: note(36), vol: 0.5, attack: 0.03 });
      });
    },
    explosion(pos) {
      play('explosion', 0.05, pos, 1.0, 1.6, (o, t) => {
        nz(o, t, 1.4, { type: 'lowpass', f0: 3200, f1: 90, q: 0.8, vol: 1.4 });
        nz(o, t, 0.12, { type: 'highpass', f0: 2000, vol: 0.8 });
        tone(o, t, 1.0, { type: 'sine', f0: 80, f1: 24, vol: 1.3 });
        tone(o, t, 0.4, { type: 'triangle', f0: 140, f1: 40, vol: 0.5 });
        for (let i = 0; i < 4; i++) nz(o, t + 0.15 + i * 0.09 + Math.random() * 0.05, 0.08, { type: 'bandpass', f0: rand(600, 1800), q: 2, vol: 0.25 });
      });
    },
  };

  const safe = (fn) => (...args) => {
    try { return fn(...args); } catch (e) { console.warn('[fx]', e); }
  };
  return {
    update,
    muzzleFlash: safe(muzzleFlash),
    tracer: safe(tracer),
    impact: safe(impact),
    explosion: safe(explosion),
    damageNumber: safe(damageNumber),
    buildPlace: safe(buildPlace),
    buildBreak: safe(buildBreak),
    elimination: safe(elimination),
    screenShake: safe(screenShake),
    getShakeOffset: () => shakeOffset,
    hitmarker: safe(hitmarker),
    stormEdge: safe(updateStorm),
    sfx,
  };
}
