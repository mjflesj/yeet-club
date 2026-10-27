/* YEET CLUB — client : rendu, entrées, son, menus et connexion au serveur. */
(() => {
'use strict';
const { W, H, COLORS, PLATS } = Yeet;
const canvas = document.getElementById('c');
let ctx = canvas.getContext('2d');
const stage = document.getElementById('stage');
const $ = id => document.getElementById(id);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

/* ---------- État ---------- */
let mode = 'demo';          // demo (bots derrière le menu), local, online
let ui = 'menu';            // menu, play, end
let lg = null;              // partie locale (simulation dans le navigateur)
let cur = { p: [], it: [], end: 0 };
let snaps = [];             // instantanés reçus du serveur
let parts = [], pops = [], shake = 0, time = 0;
let localCtrls = [];

/* ---------- Affichage ---------- */
let dpr = 1, sc = 1, ox = 0, oy = 0;
function resize() {
  dpr = Math.min(isTouch ? 1.5 : 2, window.devicePixelRatio || 1);
  const cw = stage.clientWidth, ch = stage.clientHeight;
  canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
  sc = Math.min(cw / W, ch / H); ox = (cw - W * sc) / 2; oy = (ch - H * sc) / 2;
  bgDirty = true;
}
let bgDirty = true;
addEventListener('resize', resize); resize();

/* ---------- Entrées ---------- */
const keys = new Set();
const BLOCK = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space']);
const typing = () => document.activeElement && document.activeElement.tagName === 'INPUT';
addEventListener('keydown', e => {
  if (typing()) return;
  if (BLOCK.has(e.code) && ui === 'play') e.preventDefault();
  keys.add(e.code); keys.add('k:' + e.key.toLowerCase());
  if (e.code === 'Escape' && ui === 'play') quit();
});
addEventListener('keyup', e => { keys.delete(e.code); keys.delete('k:' + e.key.toLowerCase()); });
addEventListener('blur', () => keys.clear());

const KB = {
  kb1: { l: ['KeyA'], r: ['KeyD'], u: ['KeyW', 'Space'], d: ['KeyS'], a: ['KeyF'], b: ['KeyG'] },
  kb2: { l: ['ArrowLeft'], r: ['ArrowRight'], u: ['ArrowUp'], d: ['ArrowDown'], a: ['k:n', 'Numpad1'], b: ['k:m', 'Numpad2'] },
};
// Tactile : joystick flottant à gauche, boutons à droite (multi-touch)
const touch = { l: false, r: false, d: false, ju: false, j: false, a: false, b: false };
const stickZone = $('stickZone'), stickBase = $('stickBase'), stickKnob = $('stickKnob');
const stick = { id: null, x: 0, y: 0 };
function stickSet(dx, dy) {
  const L = Math.hypot(dx, dy), m = 50;
  if (L > m) { dx = dx / L * m; dy = dy / L * m; }
  stickKnob.style.transform = `translate(${dx}px,${dy}px)`;
  touch.l = dx < -14; touch.r = dx > 14; touch.d = dy > 30; touch.ju = dy < -32;
}
stickZone.addEventListener('pointerdown', e => {
  if (stick.id !== null) return;
  e.preventDefault(); initAudio();
  stick.id = e.pointerId; stick.x = e.clientX; stick.y = e.clientY;
  const r = stickZone.getBoundingClientRect();
  stickBase.style.left = Math.max(60, Math.min(r.width - 60, e.clientX - r.left)) + 'px';
  stickBase.style.top = Math.max(60, Math.min(r.height - 60, e.clientY - r.top)) + 'px';
  stickBase.classList.add('on'); stickSet(0, 0);
  try { stickZone.setPointerCapture(e.pointerId); } catch {}
});
// Le doigt peut sortir de la zone : on suit le déplacement et le relâchement sur
// toute la fenêtre, sinon le personnage continue à courir tout seul.
addEventListener('pointermove', e => { if (e.pointerId === stick.id) stickSet(e.clientX - stick.x, e.clientY - stick.y); }, { passive: true });
function stickEnd(e) {
  if (e && e.pointerId !== stick.id) return;
  stick.id = null; stickSet(0, 0); stickBase.classList.remove('on');
  stickBase.style.left = ''; stickBase.style.top = '';
}
for (const ev of ['pointerup', 'pointercancel']) addEventListener(ev, stickEnd);
stickZone.addEventListener('lostpointercapture', stickEnd);
addEventListener('blur', () => { stickEnd(); resetTouch(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { stickEnd(); resetTouch(); } });
document.querySelectorAll('#btns button').forEach(btn => {
  const k = btn.dataset.k;
  const on = e => { e.preventDefault(); touch[k] = true; btn.classList.add('on'); if (navigator.vibrate) try { navigator.vibrate(8); } catch {} };
  const off = e => { e.preventDefault(); touch[k] = false; btn.classList.remove('on'); };
  btn.addEventListener('pointerdown', on);
  btn.addEventListener('pointerup', off); btn.addEventListener('pointercancel', off); btn.addEventListener('pointerleave', off);
  btn.addEventListener('contextmenu', e => e.preventDefault());
});
function resetTouch() { stick.id = null; stickKnob.style.transform = ''; stickBase.classList.remove('on'); stickBase.style.left = stickBase.style.top = ''; for (const k in touch) touch[k] = false; document.querySelectorAll('#btns button').forEach(b => b.classList.remove('on')); }
function goFullscreen() {
  if (!isTouch) return;
  try {
    const el = document.documentElement, req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (req && !document.fullscreenElement) {
      const r = req.call(el);
      const lock = () => { try { screen.orientation.lock('landscape').catch(() => {}); } catch {} };
      if (r && r.then) r.then(lock).catch(() => {}); else lock();
    }
  } catch {}
}

function getPads() { try { return navigator.getGamepads ? navigator.getGamepads() : []; } catch { return []; } }
function rawInput(ctrl) {
  const r = { x: 0, up: false, down: false, a: false, b: false };
  if (ctrl === 'kb1' || ctrl === 'kb2') {
    const m = KB[ctrl], h = list => list.some(k => keys.has(k));
    r.x = (h(m.r) ? 1 : 0) - (h(m.l) ? 1 : 0); r.up = h(m.u); r.down = h(m.d); r.a = h(m.a); r.b = h(m.b);
  } else if (ctrl.startsWith('pad')) {
    const gp = getPads()[+ctrl[3]];
    if (gp) {
      const bt = i => !!(gp.buttons[i] && gp.buttons[i].pressed);
      const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
      r.x = Math.abs(ax) > 0.35 ? Math.sign(ax) : (bt(15) ? 1 : 0) - (bt(14) ? 1 : 0);
      r.up = bt(0) || bt(12); r.down = ay > 0.6 || bt(13);
      r.a = bt(2) || bt(5) || bt(7); r.b = bt(1) || bt(3) || bt(4) || bt(6);
    }
  } else if (ctrl === 'touch') {
    r.x = (touch.r ? 1 : 0) - (touch.l ? 1 : 0); r.up = touch.j || touch.ju; r.down = touch.d; r.a = touch.a; r.b = touch.b;
  }
  return r;
}
// En ligne, un seul joueur par appareil : tous les contrôles comptent
function mergedInput() {
  const all = ['kb1', 'kb2', 'pad0', 'pad1', 'pad2', 'pad3', 'touch'].map(rawInput);
  const r = { x: 0, up: false, down: false, a: false, b: false };
  for (const i of all) { r.x = r.x || i.x; r.up ||= i.up; r.down ||= i.down; r.a ||= i.a; r.b ||= i.b; }
  return r;
}

/* ---------- Son ---------- */
let AC = null, muted = false, noiseBuf = null;
function initAudio() {
  if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    noiseBuf = AC.createBuffer(1, AC.sampleRate * 0.5, AC.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch { AC = null; }
}
function tone(type, f1, f2, dur, vol) {
  const t = AC.currentTime, o = AC.createOscillator(), g = AC.createGain();
  o.type = type; o.frequency.setValueAtTime(f1, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(AC.destination); o.start(t); o.stop(t + dur);
}
function noise(dur, vol, freq) {
  const t = AC.currentTime, s = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain();
  s.buffer = noiseBuf; f.type = 'lowpass'; f.frequency.value = freq;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f).connect(g).connect(AC.destination); s.start(t); s.stop(t + dur);
}
function sfx(k) {
  if (!AC || muted || ui !== 'play') return;
  try {
    switch (k) {
      case 'jump': tone('square', 260, 520, 0.09, 0.05); break;
      case 'whoosh': noise(0.08, 0.06, 2200); break;
      case 'hit': noise(0.12, 0.25, 900); tone('sawtooth', 180, 60, 0.12, 0.12); break;
      case 'bat': noise(0.18, 0.35, 1400); tone('square', 120, 40, 0.2, 0.15); break;
      case 'grab': tone('triangle', 400, 220, 0.08, 0.12); break;
      case 'yeet': tone('sawtooth', 160, 900, 0.25, 0.1); break;
      case 'boom': noise(0.6, 0.6, 500); tone('sine', 90, 30, 0.5, 0.4); break;
      case 'ko': tone('square', 700, 90, 0.45, 0.12); noise(0.3, 0.25, 3000); break;
      case 'pick': tone('square', 600, 900, 0.06, 0.06); break;
    }
  } catch {}
}
const muteBtn = $('mute');
muteBtn.onclick = () => { initAudio(); muted = !muted; muteBtn.textContent = 'Son : ' + (muted ? 'non' : 'oui'); };

/* ---------- Effets (déclenchés par les événements de la simulation) ---------- */
function fireEvents(list) {
  for (const e of list) {
    switch (e[0]) {
      case 'b': {
        const [, x, y, n, col, spd, size] = e;
        for (let k = 0; k < n; k++) {
          const a = Math.random() * Math.PI * 2, s = spd * (0.3 + Math.random() * 0.7);
          parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - spd * 0.2, life: 0.4 + Math.random() * 0.5, max: 0.9, col, size: size * (0.5 + Math.random()) });
        }
        break;
      }
      case 'p': pops.push({ x: e[1], y: e[2], text: e[3], col: e[4], big: !!e[5], life: e[5] ? 1.4 : 0.8, max: e[5] ? 1.4 : 0.8 }); break;
      case 's': if (!(mode === 'online' && pred.p && e[2] === net.you && (e[1] === 'jump' || e[1] === 'whoosh'))) sfx(e[1]); break;
      case 'k': shake = Math.min(30, shake + e[1]); break;
    }
  }
  if (parts.length > 900) parts.splice(0, parts.length - 900);
}
function updateFx(dt) {
  for (const q of parts) { q.x += q.vx * dt; q.y += q.vy * dt; q.vy += 900 * dt; q.vx *= 0.98; q.life -= dt; }
  parts = parts.filter(q => q.life > 0);
  for (const q of pops) { q.life -= dt; q.y -= 30 * dt; }
  pops = pops.filter(q => q.life > 0);
  shake *= Math.pow(0.002, dt);
}

/* ---------- Interpolation des instantanés en ligne ---------- */
const INTERP_MS = 50;   // retard d'affichage des autres joueurs (3 instantanés à 60 Hz)
function lerp(a, b, t) { return a + (b - a) * t; }
function onlineView(now) {
  if (!snaps.length) return cur;
  const rt = now - INTERP_MS;
  for (const s of snaps) if (!s.fired && s.t <= rt) { s.fired = true; fireEvents(s.e); }
  while (snaps.length > 2 && snaps[1].t <= rt) snaps.shift();
  const a = snaps[0], b = snaps[1];
  if (!b || rt <= a.t) return a.v;
  const t = Math.min(1, (rt - a.t) / (b.t - a.t || 1));
  const v = { end: b.v.end, p: [], it: [] };
  for (const pb of b.v.p) {
    const pa = a.v.p.find(q => q.i === pb.i);
    if (pa && pa.a && pb.a && Math.abs(pa.x - pb.x) < 200 && Math.abs(pa.y - pb.y) < 200) v.p.push({ ...pb, x: lerp(pa.x, pb.x, t), y: lerp(pa.y, pb.y, t) });
    else v.p.push(pb);
  }
  for (const ib of b.v.it) {
    const ia = a.v.it.find(q => q.id === ib.id);
    v.it.push(ia ? { ...ib, x: lerp(ia.x, ib.x, t), y: lerp(ia.y, ib.y, t), r: lerp(ia.r, ib.r, t) } : ib);
  }
  return v;
}

/* ---------- Prédiction de mon personnage ----------
   Mes entrées sont appliquées tout de suite à une copie locale de mon
   personnage. À chaque instantané, on repart de l'état du serveur et on
   rejoue les entrées qu'il n'a pas encore traitées. L'écart éventuel est
   lissé pour ne pas voir de saut. */
const pred = { p: null, hist: [], seq: 0, acc: 0, ox: 0, oy: 0, lastInp: null };
const NO_IN = { x: 0, up: false, down: false, a: false, b: false };
function resetPred() { pred.p = null; pred.hist = []; pred.acc = 0; pred.ox = pred.oy = 0; }
function predTick(inp) {
  if (!pred.p) return;
  let fx = null;
  for (let k = 0; k < 2; k++) fx = Yeet.predictStep(pred.p, inp, Yeet.STEP) || fx;
  if (fx === 'jump') sfx('jump');
  if (fx === 'shove') sfx('whoosh');
}
function reconcile(v) {
  const me = v.p.find(q => q.i === net.you);
  if (!me || !me.a || me.hb) { pred.p = null; pred.ox = pred.oy = 0; return; }
  const ackEntry = pred.hist.find(h => h.s === me.q);
  pred.hist = pred.hist.filter(h => h.s > me.q);
  const old = pred.p;
  pred.p = Yeet.restorePlayer(me, ackEntry ? ackEntry.inp : (old ? old.prev : NO_IN));
  for (const h of pred.hist) for (let k = 0; k < 2; k++) Yeet.predictStep(pred.p, h.inp, Yeet.STEP);
  if (old) {
    pred.ox += old.x - pred.p.x; pred.oy += old.y - pred.p.y;
    if (Math.hypot(pred.ox, pred.oy) > 140) pred.ox = pred.oy = 0;
  }
}
// Remplace mon personnage (et ce que je porte) par la version prédite
function applyPred(v) {
  if (!pred.p) return v;
  const idx = v.p.findIndex(q => q.i === net.you);
  if (idx < 0) return v;
  const q = pred.p, x = q.x + pred.ox, y = q.y + pred.oy;
  const me = { ...v.p[idx], x, y, vx: q.vx, vy: q.vy, f: q.face, g: q.ground ? 1 : 0, sh: Math.max(0, q.shoveT), sq: q.squash, hs: q.hitstun > 0 ? 1 : 0, cl: Math.max(0, q.cling) };
  const out = { ...v, p: v.p.slice(), it: v.it.map(it => {
    if (it.h !== net.you) return it;
    return it.t === 'bat' ? { ...it, x: x + me.f * 22, y: y - 6 } : { ...it, x, y: y - 37 };
  }) };
  out.p[idx] = me;
  if (me.hk === 'p') out.p = out.p.map(o => o.hb && Math.abs(o.x - (v.p[idx].x)) < 4 ? { ...o, x, y: y - 36 } : o);
  return out;
}

/* ---------- Rendu ---------- */
let hazardPat = null, hazardTile = null;
function makePattern() {
  const c = hazardTile = document.createElement('canvas'); c.width = c.height = 24;
  const g = c.getContext('2d');
  g.fillStyle = '#ffc93c'; g.fillRect(0, 0, 24, 24);
  g.fillStyle = '#16121f';
  g.beginPath(); g.moveTo(0, 0); g.lineTo(12, 0); g.lineTo(0, 12); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(24, 0); g.lineTo(24, 12); g.lineTo(12, 24); g.lineTo(0, 24); g.closePath(); g.fill();
  hazardPat = ctx.createPattern(c, 'repeat');
}

// Le décor fixe (murs, lampes, plateformes) est dessiné une fois dans un canvas à part
let bgCanvas = null;
function buildBG() {
  if (!hazardPat) return;
  const s = dpr * sc;
  bgCanvas = bgCanvas || document.createElement('canvas');
  bgCanvas.width = Math.max(1, Math.round(W * s)); bgCanvas.height = Math.max(1, Math.round(H * s));
  const main = ctx;
  ctx = bgCanvas.getContext('2d');
  ctx.setTransform(s, 0, 0, s, 0, 0);
  hazardPat = ctx.createPattern(hazardTile, 'repeat');
  drawBG(); drawPlats();
  ctx = main;
  bgDirty = false;
}
function drawNeon() {
  const flick = (Math.sin(time * 23) > 0.96 || Math.sin(time * 7.1) > 0.995) ? 0.08 : 0.32;
  ctx.save();
  ctx.font = '86px Bungee, Impact, sans-serif'; ctx.textAlign = 'center';
  if (!isTouch) { ctx.shadowColor = '#ff3d7f'; ctx.shadowBlur = 30; }
  ctx.strokeStyle = `rgba(255,61,127,${flick})`; ctx.lineWidth = 3;
  ctx.strokeText('YEET CLUB', W / 2, 150);
  ctx.restore();
}
function drawBG() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#221c30'); g.addColorStop(0.65, '#16121f'); g.addColorStop(1, '#07060b');
  ctx.fillStyle = g; ctx.fillRect(-200, -200, W + 400, H + 400);
  ctx.fillStyle = '#1a1526';
  for (const x of [40, 400, 840, 1200]) ctx.fillRect(x, 0, 46, H);
  ctx.fillStyle = '#ffffff08';
  for (const x of [40, 400, 840, 1200]) ctx.fillRect(x, 180, 46, 30);
  ctx.fillStyle = '#ffc93c22'; ctx.font = '700 22px Barlow Condensed, sans-serif'; ctx.textAlign = 'left';
  ctx.fillText('P-2', 48, 202); ctx.fillText('B', 420, 202); ctx.fillText('C', 856, 202); ctx.fillText('P-2', 1206, 202);
  ctx.save(); ctx.font = '600 20px Barlow Condensed, sans-serif'; ctx.fillStyle = '#ffffff1c'; ctx.textAlign = 'center';
  ctx.fillText('RÈGLE N°1 : TOUT LE MONDE PARLE DU YEET CLUB', W / 2, 186); ctx.restore();
  for (const x of [320, 640, 960]) {
    const lg2 = ctx.createLinearGradient(0, 0, 0, 520);
    lg2.addColorStop(0, '#fff3c933'); lg2.addColorStop(1, '#fff3c900');
    ctx.fillStyle = lg2; ctx.beginPath(); ctx.moveTo(x - 14, 0); ctx.lineTo(x + 14, 0); ctx.lineTo(x + 170, 520); ctx.lineTo(x - 170, 520); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#2c2540'; ctx.fillRect(x - 22, 0, 44, 8);
    ctx.fillStyle = '#fff6d0'; ctx.fillRect(x - 16, 8, 32, 4);
  }
}

function drawPlats() {
  for (const pl of PLATS) {
    if (pl.solid) {
      const g = ctx.createLinearGradient(0, pl.y, 0, H);
      g.addColorStop(0, '#4a4160'); g.addColorStop(0.15, '#2d2640'); g.addColorStop(1, '#0d0b13');
      ctx.fillStyle = g; ctx.fillRect(pl.x, pl.y, pl.w, H - pl.y + 60);
      ctx.fillStyle = hazardPat; ctx.fillRect(pl.x, pl.y, pl.w, 12);
      ctx.fillStyle = '#ffffff10';
      for (let x = pl.x + 60; x < pl.x + pl.w; x += 130) ctx.fillRect(x, pl.y + 26, 2, 120);
      ctx.fillStyle = '#ffffff22'; ctx.font = '600 16px Barlow Condensed, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('CHARGE MAX 4 PERSONNES', pl.x + pl.w / 2, pl.y + 46); ctx.textAlign = 'left';
    } else {
      ctx.fillStyle = '#3a3150'; ctx.fillRect(pl.x, pl.y, pl.w, pl.h);
      ctx.fillStyle = hazardPat; ctx.fillRect(pl.x, pl.y, pl.w, 5);
      ctx.strokeStyle = '#3a3150'; ctx.lineWidth = 3; ctx.beginPath();
      ctx.moveTo(pl.x + 20, pl.y); ctx.lineTo(pl.x + 20, -10); ctx.moveTo(pl.x + pl.w - 20, pl.y); ctx.lineTo(pl.x + pl.w - 20, -10); ctx.stroke();
      ctx.fillStyle = '#0006'; ctx.fillRect(pl.x, pl.y + pl.h, pl.w, 4);
    }
  }
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function drawItem(it, holder) {
  ctx.save(); ctx.translate(it.x, it.y); ctx.rotate(it.r);
  if (it.t === 'crate') {
    ctx.fillStyle = '#b27a3e'; ctx.fillRect(-18, -18, 36, 36);
    ctx.strokeStyle = '#6e4520'; ctx.lineWidth = 4; ctx.strokeRect(-16, -16, 32, 32);
    ctx.beginPath(); ctx.moveTo(-16, -16); ctx.lineTo(16, 16); ctx.moveTo(16, -16); ctx.lineTo(-16, 16); ctx.stroke();
  } else if (it.t === 'bomb') {
    const hot = it.fu != null && it.fu < 1.2 && Math.sin(time * 40) > 0;
    ctx.fillStyle = hot ? '#ff3d5e' : '#1b1724'; ctx.beginPath(); ctx.arc(0, 2, 17, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#ffffff55'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 2, 17, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#ffffff40'; ctx.beginPath(); ctx.arc(-6, -4, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#555'; ctx.fillRect(-5, -19, 10, 6);
    ctx.strokeStyle = '#d8c39a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, -19); ctx.quadraticCurveTo(6, -28, 12, -26); ctx.stroke();
    if (it.fu != null) {
      ctx.fillStyle = Math.random() < 0.5 ? '#ffc93c' : '#fff'; ctx.beginPath(); ctx.arc(12, -26, 3 + Math.random() * 3, 0, Math.PI * 2); ctx.fill();
      ctx.rotate(-it.r); ctx.fillStyle = '#fff'; ctx.font = '14px Bungee, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(Math.max(1, Math.ceil(it.fu)), 0, 8);
    }
  } else {
    if (holder) {
      ctx.rotate(-it.r);
      const sw = holder.sh > 0 ? (1 - holder.sh / 0.22) : 0;
      ctx.scale(holder.f, 1); ctx.rotate(-1.1 + sw * 2.4);
    }
    ctx.fillStyle = '#d29b5c'; roundRect(-5, -34, 12, 44, 5); ctx.fill();
    ctx.fillStyle = '#6e4520'; ctx.fillRect(-3, 6, 8, 12);
    ctx.fillStyle = '#ffffff30'; ctx.fillRect(-2, -30, 3, 30);
    ctx.fillStyle = '#fff'; for (let k = 0; k < it.u; k++) ctx.fillRect(-1, -26 + k * 7, 6, 3);
  }
  ctx.restore();
}

function dmgColor(d) {
  const t = Math.min(1, d / 150);
  return `rgb(255,${Math.round(255 - 200 * t)},${Math.round(255 - 230 * Math.min(1, t * 1.6))})`;
}

const PW = 36, PH = 42;
function drawPlayer(p, me) {
  if (!p.a) return;
  const col = COLORS[p.i];
  if (p.iv && Math.floor(time * 16) % 2 === 0) ctx.globalAlpha = 0.45;
  const stretch = p.hs ? Math.min(0.25, Math.hypot(p.vx, p.vy) / 5000) : 0;
  const sx = 1 + p.sq * 0.6 - stretch * 0.5, sy = 1 - p.sq * 0.6 + stretch;
  ctx.save(); ctx.translate(p.x, p.y + PH / 2);
  if (p.hs) ctx.rotate(Math.sin(time * 30) * 0.15 + p.vx / 6000);
  if (p.hb) ctx.rotate(Math.sin(time * 25) * 0.3);
  ctx.scale(sx * p.f, sy);
  const w = PW, h = PH, walk = p.g && Math.abs(p.vx) > 40 ? Math.sin(time * 22) * 4 : 0;
  ctx.fillStyle = '#0c0a12';
  ctx.beginPath(); ctx.ellipse(-8 + walk, -3, 8, 5, 0, 0, Math.PI * 2); ctx.ellipse(9 - walk, -3, 8, 5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = col.c; roundRect(-w / 2, -h, w, h - 4, 15); ctx.fill();
  ctx.fillStyle = col.d; roundRect(-w / 2, -h * 0.42, w, h * 0.42 - 4, 10); ctx.fill();
  ctx.fillStyle = '#ffffff35'; roundRect(-w / 2 + 5, -h + 5, 8, 14, 4); ctx.fill();
  ctx.fillStyle = '#f3efe6'; ctx.fillRect(-w / 2, -h + 9, w, 6);
  ctx.beginPath(); ctx.moveTo(-w / 2, -h + 11); ctx.lineTo(-w / 2 - 12, -h + 6 + Math.sin(time * 12) * 3); ctx.lineTo(-w / 2 - 10, -h + 16 + Math.sin(time * 12 + 1) * 3); ctx.closePath(); ctx.fill();
  const ey = -h + 24;
  if (p.hs || p.hb) {
    ctx.strokeStyle = '#111'; ctx.lineWidth = 3;
    for (const ex of [3, 13]) { ctx.beginPath(); ctx.moveTo(ex - 4, ey - 4); ctx.lineTo(ex + 4, ey + 4); ctx.moveTo(ex + 4, ey - 4); ctx.lineTo(ex - 4, ey + 4); ctx.stroke(); }
  } else {
    const blink = ((time + p.i * 1.3) % 3.2) < 0.12 ? 0.15 : 1;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.ellipse(3, ey, 5, 6 * blink, 0, 0, Math.PI * 2); ctx.ellipse(13, ey, 5, 6 * blink, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.arc(5, ey + 1, 2.6 * blink, 0, Math.PI * 2); ctx.arc(15, ey + 1, 2.6 * blink, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#111'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(-1, ey - 9); ctx.lineTo(8, ey - 6); ctx.moveTo(10, ey - 6); ctx.lineTo(18, ey - 9); ctx.stroke();
  }
  const carrying = p.hk && p.hk !== 'bat';
  ctx.fillStyle = col.d;
  if (p.cl > 0) {
    // mains plaquées contre le mur
    ctx.beginPath(); ctx.arc(w / 2 + 4, -h + 4, 6, 0, Math.PI * 2); ctx.arc(w / 2 + 4, -h * 0.5, 6, 0, Math.PI * 2); ctx.fill();
  } else if (carrying) {
    ctx.beginPath(); ctx.arc(-w / 2 + 2, -h - 2, 6, 0, Math.PI * 2); ctx.arc(w / 2 - 2, -h - 2, 6, 0, Math.PI * 2); ctx.fill();
  } else {
    const ext = p.sh > 0 && !p.hk ? 20 * Math.sin(Math.max(0, 1 - p.sh / 0.15) * Math.PI) : 0;
    ctx.beginPath(); ctx.arc(w / 2 + 3 + ext, -h * 0.45, 7, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(-w / 2 - 2, -h * 0.42 + walk * 0.5, 6, 0, Math.PI * 2); ctx.fill();
    if (ext > 6) {
      ctx.strokeStyle = '#ffffff88'; ctx.lineWidth = 2; ctx.beginPath();
      ctx.moveTo(w / 2 + ext - 18, -h * 0.45 - 8); ctx.lineTo(w / 2 + ext - 4, -h * 0.45 - 8);
      ctx.moveTo(w / 2 + ext - 20, -h * 0.45 + 8); ctx.lineTo(w / 2 + ext - 6, -h * 0.45 + 8); ctx.stroke();
    }
  }
  ctx.restore();
  ctx.globalAlpha = 1;
  const tagY = p.y - PH / 2 - (p.hk === 'p' ? 62 : p.hk && p.hk !== 'bat' ? 50 : 14);
  ctx.font = '13px Bungee, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = col.c;
  ctx.fillText(p.n, p.x, tagY);
  if (me) { ctx.beginPath(); ctx.moveTo(p.x - 6, tagY + 4); ctx.lineTo(p.x + 6, tagY + 4); ctx.lineTo(p.x, tagY + 10); ctx.closePath(); ctx.fill(); }
  if (p.hb) {
    ctx.fillStyle = '#0008'; ctx.fillRect(p.x - 22, p.y - PH / 2 - 30, 44, 6);
    ctx.fillStyle = '#fff'; ctx.fillRect(p.x - 22, p.y - PH / 2 - 30, 44 * Math.min(1, p.es / 1.5), 6);
  }
}

function drawOffscreen(p) {
  if (!p.a || (p.x > 0 && p.x < W && p.y > 0)) return;
  const m = 26, x = Math.max(m, Math.min(W - m, p.x)), y = Math.max(m, Math.min(H - m, p.y));
  const d = Math.hypot(p.x - x, p.y - y);
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = '#0009'; ctx.beginPath(); ctx.arc(0, 0, 20 + Math.min(10, d / 40), 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = COLORS[p.i].c; ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#111'; ctx.font = '11px Bungee, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('J' + (p.i + 1), 0, 4);
  ctx.restore();
}

function drawHUD(v) {
  const top = !touchEl.hidden;
  const n = v.p.length, cw = top ? 200 : 220, gap = top ? 10 : 14, total = n * cw + (n - 1) * gap;
  let x = (W - total) / 2; const y = top ? 8 : H - 84;
  for (const p of v.p) {
    const col = COLORS[p.i];
    ctx.save(); ctx.globalAlpha = p.o ? 0.4 : 1;
    ctx.fillStyle = '#0b0910d0'; roundRect(x, y, cw, 70, 6); ctx.fill();
    ctx.fillStyle = col.c; ctx.fillRect(x, y + 8, 5, 54);
    ctx.font = '15px Bungee, sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = col.c;
    ctx.fillText(p.n, x + 16, y + 26);
    const nw = ctx.measureText(p.n).width;
    ctx.font = '600 15px Barlow Condensed, sans-serif'; ctx.fillStyle = '#a59cb8';
    ctx.fillText(String(p.c).toUpperCase(), x + 24 + nw, y + 25);
    for (let k = 0; k < Math.min(p.s, 9); k++) { ctx.fillStyle = col.c; ctx.beginPath(); ctx.arc(x + 22 + k * 15, y + 50, 5, 0, Math.PI * 2); ctx.fill(); }
    ctx.font = '34px Bungee, sans-serif'; ctx.textAlign = 'right'; ctx.fillStyle = p.o ? '#666' : dmgColor(p.d);
    ctx.fillText(p.o ? 'OUT' : p.d + '%', x + cw - 12 + (p.hs ? (Math.random() - 0.5) * 4 : 0), y + 56);
    ctx.restore();
    x += cw + gap;
  }
}

function render(v) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#07060b'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const s = dpr * sc, sh = reduceMotion ? 0 : shake;
  ctx.setTransform(s, 0, 0, s, dpr * ox + (Math.random() - 0.5) * sh * s, dpr * oy + (Math.random() - 0.5) * sh * s);
  ctx.save(); ctx.beginPath(); ctx.rect(-60, -60, W + 120, H + 120); ctx.clip();
  if (bgDirty || !bgCanvas) buildBG();
  ctx.drawImage(bgCanvas, 0, 0, W, H);
  drawNeon();
  const byI = i => v.p.find(p => p.i === i);
  for (const it of v.it) if (it.h < 0) drawItem(it, null);
  for (const p of v.p) if (!p.hb) drawPlayer(p, p.i === net.you && mode === 'online');
  for (const p of v.p) if (p.hb) drawPlayer(p, p.i === net.you && mode === 'online');
  for (const it of v.it) if (it.h >= 0) drawItem(it, byI(it.h));
  for (const q of parts) { ctx.globalAlpha = Math.max(0, q.life / q.max); ctx.fillStyle = q.col; ctx.fillRect(q.x - q.size / 2, q.y - q.size / 2, q.size, q.size); }
  ctx.globalAlpha = 1;
  for (const q of pops) {
    const t = 1 - q.life / q.max, k = q.big ? 1 + Math.max(0, 0.6 - t * 4) : 1;
    ctx.save(); ctx.translate(q.x, q.y); ctx.scale(k, k); ctx.rotate(-0.08);
    ctx.globalAlpha = Math.min(1, q.life * 3);
    ctx.font = (q.big ? 64 : 26) + 'px Bungee, Impact, sans-serif'; ctx.textAlign = 'center';
    ctx.lineWidth = q.big ? 10 : 6; ctx.strokeStyle = '#000'; ctx.strokeText(q.text, 0, 0);
    ctx.fillStyle = q.col; ctx.fillText(q.text, 0, 0);
    ctx.restore();
  }
  for (const p of v.p) drawOffscreen(p);
  ctx.restore();
  if (ui !== 'menu') drawHUD(v);
  if (v.end && ui === 'play') {
    ctx.fillStyle = '#fff'; ctx.font = '72px Bungee, Impact, sans-serif'; ctx.textAlign = 'center';
    ctx.lineWidth = 12; ctx.strokeStyle = '#000'; ctx.strokeText('K.O.', W / 2, 320); ctx.fillText('K.O.', W / 2, 320);
  }
  if (mode === 'online' && ui === 'play' && !snaps.length) {
    ctx.fillStyle = '#fff'; ctx.font = '28px Bungee, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('Connexion…', W / 2, 320);
  }
}

/* ---------- Écrans ---------- */
const menuEl = $('menu'), endEl = $('end'), touchEl = $('touch'), pauseBtn = $('pause');
function setBody() {
  document.body.classList.toggle('playing', ui === 'play');
  document.body.classList.toggle('touchui', !touchEl.hidden);
}
function showTouch(on) { touchEl.hidden = !on; resetTouch(); setBody(); }
function showPlay() {
  ui = 'play'; menuEl.hidden = true; endEl.hidden = true; pauseBtn.hidden = false;
  parts = []; pops = []; setBody();
}
function startDemo() {
  mode = 'demo';
  lg = Yeet.createGame({ seats: [0, 1, 2, 3].map(() => ({ bot: true })), demo: true });
}
function showMenu() {
  ui = 'menu'; menuEl.hidden = false; endEl.hidden = true; pauseBtn.hidden = true; showTouch(false);
  startDemo();
  renderSlots();
}
function showEnd(r) {
  ui = 'end'; endEl.hidden = false; pauseBtn.hidden = true; showTouch(false);
  const w = r.players.find(p => p.i === r.winner);
  const h2 = $('winner');
  h2.textContent = w ? `${w.n} gagne` : 'Égalité';
  h2.style.color = w ? COLORS[w.i].c : '';
  const tb = $('scoreBody'); tb.innerHTML = '';
  [...r.players].sort((a, b) => (b.s - a.s) || (b.k - a.k)).forEach(p => {
    const tr = document.createElement('tr');
    const td = document.createElement('td'); td.style.color = COLORS[p.i].c; td.style.fontWeight = 700;
    td.textContent = `${p.n} · ${p.c}`; tr.appendChild(td);
    for (const val of [p.k, p.fl, p.s]) { const c = document.createElement('td'); c.textContent = val; tr.appendChild(c); }
    tb.appendChild(tr);
  });
  const again = $('againBtn'), back = $('menuBtn');
  setStatus('endStatus', '');
  again.disabled = false;
  if (mode === 'online') {
    again.hidden = false; again.textContent = 'Revanche';
    back.textContent = 'Retour au salon';
  } else {
    again.hidden = false; again.textContent = 'Revanche'; back.textContent = 'Menu';
  }
  (again.hidden ? back : again).focus();
}
function quit() {
  if (mode === 'online') { netSend({ t: 'leave' }); net.room = null; setTab('online'); }
  showMenu();
}
pauseBtn.onclick = quit;
$('againBtn').onclick = () => {
  if (mode !== 'online') { startLocal(); return; }
  if (!net.ws || net.ws.readyState !== 1) { setStatus('endStatus', 'Connexion perdue avec le serveur. Retourne au menu pour recréer une salle.', true); return; }
  goFullscreen();
  $('againBtn').disabled = true;
  setStatus('endStatus', 'Revanche demandée…');
  netSend({ t: 'again' });
};
$('menuBtn').onclick = () => { if (mode === 'online') { mode = 'demo'; showMenu(); setTab('online'); } else showMenu(); };

/* ---------- Onglets ---------- */
let tab = 'online';
function setTab(t) {
  tab = t;
  $('tabOnline').setAttribute('aria-selected', t === 'online');
  $('tabLocal').setAttribute('aria-selected', t === 'local');
  $('viewLocal').hidden = t !== 'local';
  $('viewJoin').hidden = t !== 'online' || !!net.room;
  $('viewLobby').hidden = t !== 'online' || !net.room;
}
$('tabOnline').onclick = () => setTab('online');
$('tabLocal').onclick = () => setTab('local');

/* ---------- Partie locale ---------- */
const CTRL_TYPES = ['kb1', 'kb2', 'pad0', 'pad1', 'pad2', 'pad3', 'touch', 'bot', 'off'];
const CTRL_LABEL = { kb1: 'Clavier 1', kb2: 'Clavier 2', pad0: 'Manette 1', pad1: 'Manette 2', pad2: 'Manette 3', pad3: 'Manette 4', touch: 'Tactile', bot: 'Bot', off: 'Vide' };
const CTRL_HINT = {
  kb1: 'ZQSD ou WASD · F pousse · G chope', kb2: 'Flèches · N pousse · M chope',
  pad: 'Stick · A saut · X pousse · B chope', touch: 'Boutons à l’écran',
  bot: 'Contrôlé par l’ordinateur', off: 'Personne à cette place',
};
let slots = [isTouch ? 'touch' : 'kb1', isTouch ? 'bot' : 'kb2', 'bot', 'bot'];
let stockCount = 3;
const slotsEl = $('slots');
function chip(i) { return `<span class="chip" style="background:${COLORS[i].c}"></span><span class="slot-name" style="color:${COLORS[i].c}">J${i + 1}</span>`; }
function renderSlots() {
  slotsEl.innerHTML = '';
  const pads = getPads();
  slots.forEach((c, i) => {
    const el = document.createElement('div'); el.className = 'slot'; el.dataset.off = c === 'off' ? '1' : '0';
    let hint = CTRL_HINT[c.startsWith('pad') ? 'pad' : c];
    if (c.startsWith('pad') && !pads[+c[3]]) hint = 'Pas encore détectée : appuie sur un bouton de la manette';
    el.innerHTML = `<div class="slot-top">${chip(i)}</div><button id="slot${i}" type="button">${CTRL_LABEL[c]} ▸</button><small>${hint}</small>`;
    el.querySelector('button').onclick = () => {
      let k = CTRL_TYPES.indexOf(slots[i]);
      for (let n = 0; n < CTRL_TYPES.length; n++) {
        k = (k + 1) % CTRL_TYPES.length; const t = CTRL_TYPES[k];
        if (t === 'bot' || t === 'off' || !slots.some((s, j) => j !== i && s === t)) break;
      }
      slots[i] = CTRL_TYPES[k]; renderSlots(); $('slot' + i).focus();
    };
    slotsEl.appendChild(el);
  });
}
addEventListener('gamepadconnected', () => { if (ui === 'menu') renderSlots(); });
$('stockDown').onclick = () => { stockCount = Math.max(1, stockCount - 1); $('stockVal').textContent = stockCount; };
$('stockUp').onclick = () => { stockCount = Math.min(9, stockCount + 1); $('stockVal').textContent = stockCount; };

function startLocal() {
  const note = $('padNote');
  if (slots.filter(s => s !== 'off').length < 2) { note.textContent = 'Il faut au moins deux combattants. Ajoute un joueur ou un bot.'; note.classList.add('err'); return; }
  initAudio();
  localCtrls = slots.slice();
  lg = Yeet.createGame({
    seats: slots.map((c, i) => c === 'off' ? null : { bot: c === 'bot', name: 'J' + (i + 1), label: CTRL_LABEL[c] }),
    stocks: stockCount,
  });
  if (slots.includes('touch')) goFullscreen();
  mode = 'local'; showPlay();
  showTouch(slots.includes('touch'));
}
$('startBtn').onclick = startLocal;

/* ---------- En ligne ---------- */
const net = { ws: null, queue: [], room: null, you: -1, host: false };
const nameInput = $('nameInput'), codeInput = $('codeInput');
nameInput.value = store.get('yeet-name') || '';
const hashCode = (location.hash.match(/^#([A-Za-z0-9]{4})$/) || [])[1];
if (hashCode) codeInput.value = hashCode.toUpperCase();

function setStatus(id, text, err) { const el = $(id); el.textContent = text; el.classList.toggle('err', !!err); }

function netConnect() {
  if (net.ws && net.ws.readyState <= 1) return;
  if (location.protocol === 'file:') { setStatus('netStatus', 'Le jeu en ligne a besoin du serveur : lance « npm start » puis ouvre http://localhost:3000.', true); return; }
  const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  net.ws = ws;
  setStatus('netStatus', 'Connexion au serveur…');
  ws.onopen = () => { setStatus('netStatus', ''); for (const m of net.queue) ws.send(JSON.stringify(m)); net.queue = []; };
  ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch { return; } onNet(m); };
  ws.onclose = () => {
    const wasIn = !!net.room;
    net.ws = null; net.room = null; net.queue = [];
    if (mode === 'online') showMenu();
    setTab('online');
    setStatus('netStatus', wasIn ? 'Connexion perdue avec le serveur.' : 'Impossible de joindre le serveur.', true);
  };
}
function netSend(m) {
  if (net.ws && net.ws.readyState === 1) net.ws.send(JSON.stringify(m));
  else { net.queue.push(m); netConnect(); }
}

function onNet(m) {
  switch (m.t) {
    case 'err':
      if (ui === 'end') { setStatus('endStatus', m.msg, true); $('againBtn').disabled = false; }
      else setStatus(net.room ? 'lobbyStatus' : 'netStatus', m.msg, true);
      break;
    case 'room':
      net.room = m; net.you = m.you; net.host = m.host;
      if (!location.hash || location.hash.slice(1) !== m.code) history.replaceState(null, '', '#' + m.code);
      renderLobby();
      if (ui === 'menu') setTab('online');
      break;
    case 'start':
      initAudio();
      mode = 'online'; snaps = []; resetPred(); showPlay();
      showTouch(isTouch);
      break;
    case 'snap':
      if (mode !== 'online') break;
      snaps.push({ t: performance.now(), v: m.v, e: m.e, fired: false });
      reconcile(m.v);
      if (snaps.length > 30) snaps.splice(0, snaps.length - 30);
      break;
    case 'end':
      if (mode !== 'online') break;
      for (const s of snaps) if (!s.fired) { s.fired = true; fireEvents(s.e); }
      if (snaps.length) cur = snaps[snaps.length - 1].v;
      showEnd(m.r);
      break;
  }
}

function renderLobby() {
  const r = net.room; if (!r) return;
  $('roomCode').textContent = r.code;
  $('lStockVal').textContent = r.stocks;
  const box = $('lobbySeats'); box.innerHTML = '';
  r.seats.forEach((s, i) => {
    const el = document.createElement('div'); el.className = 'slot'; el.dataset.off = s ? '0' : '1';
    el.innerHTML = `<div class="slot-top">${chip(i)}${i === r.you ? '<span class="seat-you">toi</span>' : ''}</div>`;
    const name = document.createElement('div'); name.className = 'slot-name';
    name.textContent = s ? s.name : 'Place libre';
    el.appendChild(name);
    const small = document.createElement('small');
    small.textContent = !s ? 'En attente d’un joueur' : s.bot ? 'Bot' : (i === r.you ? 'Toi' : 'Joueur en ligne') + (i === 0 && r.host && i === r.you ? '' : '');
    if (r.host && (!s || s.bot)) {
      const b = document.createElement('button'); b.type = 'button';
      b.textContent = s ? 'Retirer le bot' : 'Ajouter un bot';
      b.onclick = () => netSend({ t: 'seat', i });
      el.appendChild(b);
    }
    el.appendChild(small);
    box.appendChild(el);
  });
  for (const id of ['lStockDown', 'lStockUp', 'lobbyStart']) $(id).disabled = !r.host;
  $('lobbyStart').hidden = !r.host;
  const n = r.seats.filter(Boolean).length;
  setStatus('lobbyStatus', r.host
    ? (n < 2 ? 'Partage le code ou ajoute un bot : il faut au moins deux combattants.' : `${n} combattants prêts. Tu es l’hôte : lance quand tout le monde est là.`)
    : 'En attente de l’hôte pour lancer la bagarre.');
}

function joinWith(msg) {
  const name = nameInput.value.trim();
  if (!name) { setStatus('netStatus', 'Choisis un pseudo avant de jouer.', true); nameInput.focus(); return; }
  store.set('yeet-name', name);
  initAudio(); goFullscreen();
  netSend({ ...msg, name });
}
$('createBtn').onclick = () => joinWith({ t: 'create' });
$('joinBtn').onclick = () => {
  const code = codeInput.value.trim().toUpperCase();
  if (code.length !== 4) { setStatus('netStatus', 'Le code d’une salle fait 4 caractères.', true); codeInput.focus(); return; }
  joinWith({ t: 'join', code });
};
codeInput.addEventListener('keydown', e => { if (e.key === 'Enter') $('joinBtn').click(); });
nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') (codeInput.value.trim() ? $('joinBtn') : $('createBtn')).click(); });
$('leaveBtn').onclick = () => { netSend({ t: 'leave' }); net.room = null; history.replaceState(null, '', location.pathname); setTab('online'); };
$('lStockDown').onclick = () => net.room && netSend({ t: 'stocks', n: net.room.stocks - 1 });
$('lStockUp').onclick = () => net.room && netSend({ t: 'stocks', n: net.room.stocks + 1 });
$('lobbyStart').onclick = () => { goFullscreen(); netSend({ t: 'start' }); };
$('copyBtn').onclick = async () => {
  const link = location.origin + location.pathname + '#' + (net.room ? net.room.code : '');
  try { await navigator.clipboard.writeText(link); $('copyBtn').textContent = 'Lien copié'; }
  catch { $('copyBtn').textContent = link; }
  setTimeout(() => { $('copyBtn').textContent = 'Copier le lien d’invitation'; }, 2500);
};

/* ---------- Boucle ---------- */
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now; time += dt;
  if (mode === 'online') {
    if (ui === 'play' && net.ws && net.ws.readyState === 1) {
      pred.acc = Math.min(pred.acc + dt, 0.1);
      while (pred.acc >= 1 / 60) {
        pred.acc -= 1 / 60;
        const i = mergedInput(), s = ++pred.seq;
        net.ws.send(JSON.stringify({ t: 'in', s, x: i.x, u: i.up ? 1 : 0, d: i.down ? 1 : 0, a: i.a ? 1 : 0, b: i.b ? 1 : 0 }));
        pred.hist.push({ s, inp: i });
        if (pred.hist.length > 120) pred.hist.shift();
        predTick(i);
      }
    }
    const k = Math.exp(-dt * 12); pred.ox *= k; pred.oy *= k;
    cur = applyPred(onlineView(now));
  } else if (lg) {
    if (mode === 'local' && ui === 'play') localCtrls.forEach((c, i) => { if (c !== 'off' && c !== 'bot') Yeet.setInput(lg, i, rawInput(c)); });
    if (ui !== 'end') Yeet.update(lg, dt);
    fireEvents(Yeet.drainEvents(lg));
    cur = Yeet.view(lg);
    if (mode === 'local' && ui === 'play' && lg.finished) showEnd(Yeet.results(lg));
  }
  updateFx(dt);
  render(cur);
  requestAnimationFrame(frame);
}

makePattern();
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { bgDirty = true; });
setTab('online');
showMenu();
if (hashCode && nameInput.value) setStatus('netStatus', `Invitation reçue pour la salle ${hashCode.toUpperCase()}. Clique sur Rejoindre.`);
else if (hashCode) setStatus('netStatus', `Invitation reçue pour la salle ${hashCode.toUpperCase()}. Choisis un pseudo puis clique sur Rejoindre.`);
// accès de débogage depuis la console
window.yeetDebug = { pred, net, view: () => cur };
requestAnimationFrame(frame);
})();
