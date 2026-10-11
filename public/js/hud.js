import * as THREE from 'three';

const $ = (id) => document.getElementById(id);

export function createHUD(game) {
  const el = {
    hud: $('hud'), aliveCount: $('alive-count'), killCount: $('kill-count'),
    shieldFill: $('shield-fill'), shieldText: $('shield-text'), healthFill: $('health-fill'), healthText: $('health-text'),
    healthBar: document.querySelector('.health-bar'),
    ammoBox: $('ammo-box'), ammoMag: $('ammo-mag'), ammoRes: $('ammo-res'),
    slots: [...document.querySelectorAll('#hotbar .slot')], bslots: [...document.querySelectorAll('#build-bar .bslot')],
    mats: $('mats'), matsCount: $('mats-count'),
    stormInfo: $('storm-info'), stormPhase: $('storm-phase'), stormTimer: $('storm-timer'), stormOverlay: $('storm-overlay'),
    killfeed: $('killfeed'), chatlog: $('chatlog'), bubbles: $('bubbles'), dmgInd: $('damage-indicators'),
    vignette: $('vignette'), crosshair: $('crosshair'), modeText: $('mode-text'),
    centerMsg: $('center-msg'), pickupMsg: $('pickup-msg'), minimap: $('minimap'),
  };
  const mm = el.minimap.getContext('2d');
  const MM = 200, WORLD = 300, scale = MM / WORLD;
  const toMM = (x, z) => [(x + WORLD / 2) * scale, (z + WORLD / 2) * scale];

  // pre-render the minimap terrain
  const bg = document.createElement('canvas');
  bg.width = bg.height = MM;
  {
    const g = bg.getContext('2d');
    const img = g.createImageData(MM, MM);
    const hAt = game.world.heightAt;
    for (let py = 0; py < MM; py++) for (let px = 0; px < MM; px++) {
      const x = px / scale - WORLD / 2, z = py / scale - WORLD / 2;
      const h = hAt(x, z), hx = hAt(x + 1.5, z);
      const shade = Math.max(-1, Math.min(1, (hx - h) * 0.9));
      const i = (py * MM + px) * 4;
      img.data[i] = 70 + h * 4 + shade * 30;
      img.data[i + 1] = 150 + h * 5 + shade * 40;
      img.data[i + 2] = 60 + shade * 20;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    g.fillStyle = '#e8d2a8';
    g.strokeStyle = '#1b0b3a'; g.lineWidth = 1.5;
    for (const s of game.world.sites) {
      const [mx, my] = toMM(s.x, s.z);
      g.fillRect(mx - 3, my - 3, 6, 6); g.strokeRect(mx - 3, my - 3, 6, 6);
    }
  }

  const fmtTime = (s) => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  let lastAlive = -1, lastKills = -1, lastMats = -1;

  function drawMinimap() {
    mm.drawImage(bg, 0, 0);
    const st = game.storm;
    // storm fill outside safe zone
    mm.save();
    mm.fillStyle = 'rgba(130,40,230,0.5)';
    mm.beginPath();
    mm.rect(0, 0, MM, MM);
    const [cx, cy] = toMM(st.center.x, st.center.z);
    mm.arc(cx, cy, Math.max(0, st.radius * scale), 0, Math.PI * 2, true);
    mm.fill('evenodd');
    mm.strokeStyle = '#d68bff'; mm.lineWidth = 2;
    mm.beginPath(); mm.arc(cx, cy, Math.max(0, st.radius * scale), 0, Math.PI * 2); mm.stroke();
    if (st.nextCenter && st.nextRadius != null) {
      const [nx, ny] = toMM(st.nextCenter.x, st.nextCenter.z);
      mm.strokeStyle = '#ffffff'; mm.setLineDash([4, 3]); mm.lineWidth = 1.5;
      mm.beginPath(); mm.arc(nx, ny, Math.max(0, st.nextRadius * scale), 0, Math.PI * 2); mm.stroke();
      mm.setLineDash([]);
    }
    mm.restore();
    // bots
    for (const b of game.bots || []) {
      if (!b.alive || !b.pos) continue;
      const [bx, by] = toMM(b.pos.x, b.pos.z);
      mm.fillStyle = b.color || '#ff4040';
      mm.strokeStyle = '#1b0b3a'; mm.lineWidth = 1.5;
      mm.beginPath(); mm.arc(bx, by, 4, 0, Math.PI * 2); mm.fill(); mm.stroke();
    }
    // player arrow
    const p = game.player;
    const [px, py] = toMM(p.pos.x, p.pos.z);
    mm.save();
    mm.translate(px, py);
    mm.rotate(-p.yaw);
    mm.fillStyle = '#ffd23f'; mm.strokeStyle = '#1b0b3a'; mm.lineWidth = 2;
    mm.beginPath(); mm.moveTo(0, -8); mm.lineTo(5.5, 6); mm.lineTo(0, 3); mm.lineTo(-5.5, 6); mm.closePath();
    mm.fill(); mm.stroke();
    mm.restore();
  }

  function update(state) {
    const p = game.player;
    el.shieldFill.style.width = `${p.shield}%`; el.shieldText.textContent = Math.ceil(p.shield);
    el.healthFill.style.width = `${p.health}%`; el.healthText.textContent = Math.ceil(p.health);
    el.healthBar.classList.toggle('low', p.health <= 30);

    const alive = state.aliveCount;
    if (alive !== lastAlive) { el.aliveCount.textContent = alive; bump(el.aliveCount); lastAlive = alive; }
    if (state.kills !== lastKills) { el.killCount.textContent = state.kills; if (lastKills >= 0) bump(el.killCount); lastKills = state.kills; }
    if (state.mats !== lastMats) { el.matsCount.textContent = state.mats; lastMats = state.mats; }

    el.slots.forEach((s, i) => {
      s.classList.toggle('active', !state.buildType && state.slot === i);
      const w = state.weapons[i];
      if (w && w.mag != null) s.querySelector('.wammo').textContent = w.mag;
    });
    el.bslots.forEach(b => b.classList.toggle('active', state.buildType === b.dataset.build));
    const w = state.weapons[state.slot];
    if (state.buildType) { el.ammoMag.textContent = state.mats; el.ammoRes.textContent = 'MATS'; }
    else if (w.mag == null) { el.ammoMag.textContent = '\u221e'; el.ammoRes.textContent = ''; }
    else { el.ammoMag.textContent = w.mag; el.ammoRes.textContent = `/ ${w.reserve}`; }
    el.ammoBox.classList.toggle('reloading', !!state.reloading);
    el.crosshair.classList.toggle('build', !!state.buildType);
    el.crosshair.style.setProperty('--spread', `${state.spreadPx.toFixed(1)}px`);
    el.modeText.textContent = state.modeText || '';

    const st = game.storm;
    el.stormPhase.textContent = st.label || '';
    el.stormTimer.textContent = st.timer != null ? fmtTime(st.timer) : '';
    el.stormInfo.classList.toggle('shrinking', !!st.shrinking);
    el.stormOverlay.classList.toggle('on', !!state.inStorm);
    drawMinimap();
    updateBubbles();
  }

  function bump(e) { e.classList.remove('bump'); void e.offsetWidth; e.classList.add('bump'); }

  function killfeed(text, you = false) {
    const d = document.createElement('div');
    d.className = 'kf' + (you ? ' you' : '');
    d.textContent = text;
    el.killfeed.prepend(d);
    while (el.killfeed.children.length > 5) el.killfeed.lastChild.remove();
    setTimeout(() => { d.style.opacity = '0'; setTimeout(() => d.remove(), 600); }, 6000);
  }

  function addChat(name, color, text) {
    const d = document.createElement('div');
    d.className = 'chat';
    const b = document.createElement('b');
    b.style.color = color || '#ffd23f';
    b.textContent = name + ':';
    d.append(b, document.createTextNode(text));
    el.chatlog.append(d);
    while (el.chatlog.children.length > 6) el.chatlog.firstChild.remove();
    setTimeout(() => { d.style.opacity = '0'; setTimeout(() => d.remove(), 900); }, 14000);
  }

  const bubbles = [];
  const v3 = new THREE.Vector3();
  function showBubble(bot, text) {
    const old = bubbles.findIndex(b => b.bot === bot);
    if (old >= 0) { bubbles[old].el.remove(); bubbles.splice(old, 1); }
    const d = document.createElement('div');
    d.className = 'bubble';
    d.style.borderColor = bot.color || '#1b0b3a';
    const n = document.createElement('span');
    n.className = 'bn'; n.style.color = bot.color || '#7b2cff'; n.textContent = bot.name;
    d.append(n, document.createTextNode(text));
    el.bubbles.append(d);
    bubbles.push({ bot, el: d, until: performance.now() + 4000, anchor: bot.pos ? bot.pos.clone() : new THREE.Vector3() });
  }
  function updateBubbles() {
    const now = performance.now();
    const cam = game.camera;
    const w = window.innerWidth, h = window.innerHeight;
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      if (now > b.until) { b.el.remove(); bubbles.splice(i, 1); continue; }
      if (b.bot.pos && b.bot.alive !== false) b.anchor.copy(b.bot.pos);
      v3.copy(b.anchor); v3.y += 2.7;
      const dist = v3.distanceTo(cam.position);
      v3.project(cam);
      if (v3.z > 1 || dist > 160 || Math.abs(v3.x) > 1.2 || Math.abs(v3.y) > 1.2) { b.el.style.display = 'none'; continue; }
      b.el.style.display = '';
      const s = Math.max(0.55, Math.min(1.1, 14 / dist + 0.5));
      b.el.style.transform = `translate(${(v3.x * 0.5 + 0.5) * w}px, ${(-v3.y * 0.5 + 0.5) * h}px) translate(-50%, -100%) scale(${s})`;
    }
  }

  function damageIndicator(angle) {
    const d = document.createElement('div');
    d.className = 'dmg-ind';
    d.style.transform = `rotate(${angle}rad)`;
    el.dmgInd.append(d);
    requestAnimationFrame(() => requestAnimationFrame(() => { d.style.opacity = '0'; }));
    setTimeout(() => d.remove(), 1000);
  }

  let vigT = null;
  function flashVignette(strength = 1) {
    el.vignette.style.transition = 'none';
    el.vignette.style.opacity = String(Math.min(1, 0.45 + strength * 0.5));
    void el.vignette.offsetWidth;
    el.vignette.style.transition = 'opacity .6s';
    clearTimeout(vigT);
    vigT = setTimeout(() => { el.vignette.style.opacity = game.player.health < 30 ? '0.35' : '0'; }, 80);
  }

  let cmT = null;
  function centerMessage(html, ms = 2500) {
    el.centerMsg.innerHTML = html;
    el.centerMsg.classList.remove('show'); void el.centerMsg.offsetWidth; el.centerMsg.classList.add('show');
    clearTimeout(cmT);
    cmT = setTimeout(() => el.centerMsg.classList.remove('show'), ms);
  }
  let pmT = null;
  function pickupMessage(text) {
    el.pickupMsg.textContent = text;
    el.pickupMsg.classList.add('show');
    clearTimeout(pmT);
    pmT = setTimeout(() => el.pickupMsg.classList.remove('show'), 1200);
  }
  function flashMats() { bump(el.mats); el.mats.classList.remove('flash'); void el.mats.offsetWidth; el.mats.classList.add('flash'); }

  function showEnd(victory, stats) {
    const scr = $('end-screen');
    scr.classList.remove('hidden');
    scr.classList.toggle('defeat', !victory);
    $('end-title').textContent = victory ? '#1 JEV SLAYER!' : 'ELIMINATED';
    $('end-sub').textContent = victory ? 'Every Jev has been bonked. You are the last one standing!' : (stats.killer ? `Taken out by ${stats.killer}` : 'Better luck next drop.');
    $('st-place').textContent = `#${stats.placement}`;
    $('st-kills').textContent = stats.kills;
    $('st-dmg').textContent = Math.round(stats.damage);
    $('st-time').textContent = fmtTime(stats.time);
  }

  return { el, update, killfeed, addChat, showBubble, damageIndicator, flashVignette, centerMessage, pickupMessage, flashMats, showEnd, show: () => el.hud.classList.remove('hidden') };
}
