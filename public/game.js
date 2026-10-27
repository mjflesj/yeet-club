/* YEET CLUB — simulation partagée.
   Le même fichier tourne sur le serveur (Node) pour les parties en ligne
   et dans le navigateur pour les parties locales. Aucun rendu ici :
   la simulation produit un état (view) et des événements visuels/sonores. */
(function (root) {
'use strict';

const W = 1280, H = 720, G = 2100, STEP = 1 / 120;
const COLORS = [
  { c: '#ff4d5e', d: '#a8203a', n: 'Rouge' },
  { c: '#3cc8ff', d: '#1b6f9c', n: 'Bleu' },
  { c: '#ffc93c', d: '#b9850a', n: 'Jaune' },
  { c: '#7dff8a', d: '#259c3d', n: 'Vert' },
];
const PLATS = [
  { x: 250, y: 500, w: 780, h: 320, solid: true },
  { x: 110, y: 362, w: 200, h: 14 },
  { x: 970, y: 362, w: 200, h: 14 },
  { x: 510, y: 236, w: 260, h: 14 },
];
const MAIN = PLATS[0];
const SPAWN_X = [360, 920, 560, 720];
const ITEM_TYPES = ['crate', 'bomb', 'bat', 'crate', 'bomb'];
const NO_INPUT = { x: 0, up: false, down: false, a: false, b: false };

/* ---------- Création ---------- */
// seats : tableau de 4 entrées, null ou { bot, name, label }
function createGame(cfg) {
  const g = {
    players: [], items: [], events: [], hitstop: 0, acc: 0, time: 0,
    itemTimer: cfg.demo ? 1.5 : 4, ending: null, finished: false, demo: !!cfg.demo, nextId: 1,
  };
  cfg.seats.forEach((s, i) => { if (s) g.players.push(makePlayer(i, s, cfg.demo ? 99 : cfg.stocks)); });
  g.players.forEach(p => placePlayer(p, true));
  return g;
}

function makePlayer(i, seat, stocks) {
  return {
    i, bot: !!seat.bot, name: seat.name || 'J' + (i + 1), label: seat.label || (seat.bot ? 'Bot' : ''),
    x: 0, y: 0, vx: 0, vy: 0, w: 36, h: 42, face: i % 2 ? -1 : 1,
    ground: false, gplat: null, jumps: 2, dmg: 0, stocks, out: false, respawn: 0, hitstun: 0,
    shoveCd: 0, shoveT: 0, grabCd: 0, held: null, heldBy: null, escape: 0, holdT: 0, invuln: 0, drop: 0,
    lastHit: null, lastHitT: 0, kos: 0, falls: 0, squash: 0, cling: 0, wallUsed: false, wallDir: 0,
    inp: NO_INPUT, prev: { x: 0, up: false, down: false, a: false, b: false }, ai: { cd: 0.5, t: 0, itemCd: 0 },
  };
}

function placePlayer(p, initial) {
  p.x = initial ? SPAWN_X[p.i] : 520 + p.i * 80; p.y = initial ? MAIN.y - p.h / 2 : 120;
  p.vx = p.vy = 0; p.dmg = 0; p.hitstun = 0; p.jumps = 2; p.held = null; p.heldBy = null;
  p.invuln = initial ? 0 : 2; p.lastHit = null; p.face = p.x < W / 2 ? 1 : -1;
  p.cling = 0; p.wallUsed = false;
}

const active = p => !p.out && p.respawn <= 0;
const ev = (g, e) => { if (g) g.events.push(e); };
const r1 = v => Math.round(v * 10) / 10;

/* ---------- API publique ---------- */
function setInput(g, i, inp) {
  const p = g.players.find(q => q.i === i);
  if (!p) return;
  p.inp = {
    x: inp.x > 0 ? 1 : inp.x < 0 ? -1 : 0,
    up: !!inp.up, down: !!inp.down, a: !!inp.a, b: !!inp.b,
  };
}
function setBot(g, i, bot) {
  const p = g.players.find(q => q.i === i);
  if (p) { p.bot = bot; if (bot) p.label = 'Bot'; p.inp = NO_INPUT; }
}
function drainEvents(g) { const e = g.events; g.events = []; return e; }

function update(g, dt) {
  if (g.finished) return;
  dt = Math.min(dt, 0.1);
  if (g.hitstop > 0) g.hitstop -= dt;
  else {
    g.acc += dt * (g.ending !== null ? 0.35 : 1);
    while (g.acc >= STEP - 1e-9) {
      step(g, STEP); g.acc -= STEP;
      if (g.hitstop > 0) { g.acc = 0; break; }
    }
  }
  if (g.ending !== null) { g.ending -= dt; if (g.ending <= 0) g.finished = true; }
}

function view(g) {
  return {
    end: g.ending !== null ? 1 : 0,
    p: g.players.map(p => ({
      i: p.i, n: p.name, c: p.label, x: r1(p.x), y: r1(p.y), vx: Math.round(p.vx), vy: Math.round(p.vy),
      f: p.face, d: Math.floor(p.dmg), s: p.stocks, o: p.out ? 1 : 0, a: active(p) ? 1 : 0,
      hs: p.hitstun > 0 ? 1 : 0, hb: p.heldBy ? 1 : 0,
      hk: p.held ? (p.held.kind === 'p' ? 'p' : p.held.ref.type) : '',
      sh: Math.max(0, Math.round(p.shoveT * 1000) / 1000), iv: p.invuln > 0 ? 1 : 0,
      sq: Math.round(p.squash * 100) / 100, es: Math.round(Math.max(0, p.escape) * 100) / 100,
      g: p.ground ? 1 : 0, k: p.kos, fl: p.falls,
      j: p.jumps, dr: Math.max(0, Math.round(p.drop * 1000) / 1000), ht: Math.max(0, Math.round(p.hitstun * 1000) / 1000),
      sc: Math.max(0, Math.round(p.shoveCd * 1000) / 1000),
      cl: Math.max(0, Math.round(p.cling * 1000) / 1000), wu: p.wallUsed ? 1 : 0, wd: p.wallDir,
    })),
    it: g.items.map(it => ({
      id: it.id, t: it.type, x: r1(it.x), y: r1(it.y), r: Math.round(it.rot * 100) / 100,
      fu: it.fuse == null ? null : Math.round(it.fuse * 10) / 10, u: it.uses, h: it.heldBy ? it.heldBy.i : -1,
    })),
  };
}

function results(g) {
  const alive = g.players.filter(p => !p.out);
  return {
    winner: alive.length === 1 ? alive[0].i : -1,
    players: g.players.map(p => ({ i: p.i, n: p.name, c: p.label, k: p.kos, fl: p.falls, s: Math.max(0, p.stocks) })),
  };
}

/* ---------- Combat ---------- */
function burst(g, x, y, n, col, spd, size) { ev(g, ['b', r1(x), r1(y), n, col, spd, size]); }
function pop(g, x, y, text, col, big) { ev(g, ['p', r1(x), r1(y), text, col, big ? 1 : 0]); }
function sfx(g, k, p) { ev(g, ['s', k, p ? p.i : -1]); }
function shake(g, v) { ev(g, ['k', Math.round(v)]); }

function hit(g, q, dx, dy, base, dmg, by) {
  const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
  q.dmg = Math.min(999, q.dmg + dmg);
  const v = base * (1 + q.dmg / 85);
  q.vx = dx * v; q.vy = dy * v; q.hitstun = 0.14 + v / 2800; q.ground = false; q.cling = 0;
  if (q.held) release(g, q, false);
  if (q.heldBy) release(g, q.heldBy, false);
  if (by) { q.lastHit = by; q.lastHitT = 5; }
  g.hitstop = Math.max(g.hitstop, Math.min(0.11, 0.025 + v / 22000));
  shake(g, Math.min(26, v / 140));
  burst(g, q.x, q.y, 10 + (v / 120 | 0), '#fff', 300 + v * 0.3, 4);
  burst(g, q.x, q.y, 6, COLORS[q.i].c, 250, 5);
  if (v > 900) pop(g, q.x, q.y - 40, v > 1400 ? 'BAM!' : 'PAF!', '#fff', false);
}

function release(g, holder, escaped) {
  const h = holder.held; if (!h) return;
  holder.held = null; holder.grabCd = 0.3;
  if (h.kind === 'p') {
    const v = h.ref; v.heldBy = null;
    v.vy = -420; v.vx = holder.face * (escaped ? 280 : 120); v.invuln = Math.max(v.invuln, 0.35);
    if (escaped) {
      holder.vx = -holder.face * 260; holder.vy = -200; holder.hitstun = 0.3;
      pop(g, v.x, v.y - 30, 'LIBRE!', '#fff', false);
    }
  } else {
    h.ref.heldBy = null; h.ref.vx = holder.vx * 0.5; h.ref.vy = -150;
  }
}

function doShove(g, p) {
  if (p.held && p.held.kind === 'p') return;
  const bat = p.held && p.held.kind === 'item' && p.held.ref.type === 'bat' ? p.held.ref : null;
  p.shoveCd = bat ? 0.48 : 0.32; p.shoveT = bat ? 0.22 : 0.15;
  const reach = bat ? 64 : 44, r = bat ? 50 : 34;
  const hx = p.x + p.face * reach, hy = p.y;
  let landed = false;
  for (const q of g.players) {
    if (q === p || !active(q) || q.invuln > 0 || q.heldBy) continue;
    if (Math.hypot(q.x - hx, q.y - hy) < r + q.w / 2) {
      hit(g, q, p.face, -0.55, bat ? 640 : 330, bat ? 16 : 7, p);
      landed = true;
    }
  }
  for (const it of g.items) {
    if (it.heldBy) continue;
    if (Math.hypot(it.x - hx, it.y - hy) < r + it.r) {
      it.vx = p.face * 650; it.vy = -320; it.thrownBy = p; it.owner = p; it.grace = 0.1;
    }
  }
  if (bat && landed) {
    bat.uses--;
    if (bat.uses <= 0) {
      p.held = null; removeItem(g, bat);
      burst(g, bat.x, bat.y, 14, '#c58a4a', 300, 4); pop(g, p.x, p.y - 50, 'CRAC', '#c58a4a', false);
    }
  }
  sfx(g, landed ? (bat ? 'bat' : 'hit') : 'whoosh', p);
}

function doGrab(g, p, inp) {
  p.grabCd = 0.22;
  if (p.held) { throwHeld(g, p, inp); return; }
  let best = null, bd = 1e9;
  for (const q of g.players) {
    if (q === p || !active(q) || q.heldBy || q.invuln > 0 || p.heldBy === q) continue;
    const fx = (q.x - p.x) * p.face, dy = Math.abs(q.y - p.y);
    if (fx > -14 && fx < 66 && dy < 46 && fx < bd) { bd = fx; best = q; }
  }
  if (best) {
    if (best.held) release(g, best, false);
    p.held = { kind: 'p', ref: best }; best.heldBy = p; best.vx = best.vy = 0;
    best.escape = 0.9 + best.dmg / 140; p.holdT = 0; p.ai.t = 0;
    sfx(g, 'grab'); return;
  }
  let bi = null; bd = 1e9;
  for (const it of g.items) {
    if (it.heldBy) continue;
    const d = Math.hypot(it.x - p.x, it.y - p.y);
    if (d < 62 && d < bd) { bd = d; bi = it; }
  }
  if (bi) {
    p.held = { kind: 'item', ref: bi }; bi.heldBy = p; bi.owner = p; bi.thrownBy = null;
    if (bi.type === 'bomb' && bi.fuse == null) bi.fuse = 3.2;
    sfx(g, 'pick');
  }
}

function throwHeld(g, p, inp) {
  const h = p.held; if (!h) return;
  p.held = null; p.grabCd = 0.3;
  if (inp.x) p.face = inp.x;
  let dx = p.face, dy = -0.38;
  if (inp.up) { dx = p.face * 0.22; dy = -1; }
  else if (inp.down && !p.ground) { dx = p.face * 0.3; dy = 1; }
  if (h.kind === 'p') {
    const v = h.ref; v.heldBy = null; v.x = p.x + p.face * 24; v.y = p.y - 30;
    hit(g, v, dx, dy, 540, 10, p); v.invuln = 0;
    pop(g, v.x, v.y - 30, 'YEET!', COLORS[p.i].c, false); sfx(g, 'yeet');
  } else {
    const it = h.ref, L = Math.hypot(dx, dy), sp = it.type === 'crate' ? 880 : 1080;
    it.heldBy = null; it.x = p.x + p.face * 22; it.y = p.y - 16;
    it.vx = dx / L * sp + p.vx * 0.3; it.vy = dy / L * sp; it.thrownBy = p; it.owner = p; it.grace = 0.15; it.spin = p.face * 14;
    sfx(g, 'whoosh');
  }
}

function removeItem(g, it) {
  const i = g.items.indexOf(it); if (i >= 0) g.items.splice(i, 1);
  if (it.heldBy) { it.heldBy.held = null; it.heldBy = null; }
}

function explode(g, it) {
  removeItem(g, it);
  for (const q of g.players) {
    if (!active(q)) continue;
    const d = Math.hypot(q.x - it.x, q.y - it.y);
    if (d < 150) {
      if (q.heldBy) release(g, q.heldBy, false);
      hit(g, q, q.x - it.x || 1, (q.y - it.y) - 50, 860 * (1 - d / 150 * 0.45), 20, it.owner && it.owner !== q ? it.owner : null);
      q.invuln = 0;
    }
  }
  burst(g, it.x, it.y, 40, '#ffc93c', 700, 6); burst(g, it.x, it.y, 30, '#ff3d7f', 500, 7); burst(g, it.x, it.y, 20, '#fff', 900, 3);
  pop(g, it.x, it.y - 20, 'BOUM', '#ffc93c', true);
  shake(g, 22); g.hitstop = 0.09; sfx(g, 'boom');
}

function ko(g, p) {
  if (p.held) release(g, p, false);
  if (p.heldBy) release(g, p.heldBy, false);
  p.stocks--; p.falls++;
  const killer = p.lastHit && p.lastHitT > 0 && p.lastHit !== p ? p.lastHit : null;
  if (killer) killer.kos++;
  const cx = Math.max(30, Math.min(W - 30, p.x)), cy = Math.max(40, Math.min(H - 40, p.y));
  const col = COLORS[p.i].c;
  burst(g, cx, cy, 50, col, 900, 7); burst(g, cx, cy, 30, '#fff', 1200, 3);
  pop(g, cx < 120 ? 140 : cx > W - 120 ? W - 140 : cx, cy < 100 ? 120 : cy > H - 120 ? H - 160 : cy, 'YEET!', col, true);
  shake(g, 30); g.hitstop = 0.12; sfx(g, 'ko');
  if (p.stocks <= 0) { p.out = true; p.respawn = 0; }
  else p.respawn = 1.4;
  p.x = -9999; p.y = -9999; p.vx = p.vy = 0;
  if (!g.demo && g.ending === null) {
    const alive = g.players.filter(q => !q.out);
    if (alive.length <= 1) g.ending = 1.8;
  }
}

/* ---------- Physique ---------- */
function collide(o, hw, hh, prevBottom, prevTop, canDrop) {
  o.ground = false; o.gplat = null;
  for (const pl of PLATS) {
    const l = o.x - hw, r = o.x + hw, t = o.y - hh, b = o.y + hh;
    if (r <= pl.x || l >= pl.x + pl.w) continue;
    if (pl.solid) {
      if (b <= pl.y || t >= pl.y + pl.h) continue;
      if (prevBottom <= pl.y + 3 && o.vy >= 0) land(o, pl, hh);
      else if (prevTop >= pl.y + pl.h - 3 && o.vy < 0) { o.y = pl.y + pl.h + hh; o.vy = Math.abs(o.vy) * 0.2; }
      else {
        o.x = o.x < pl.x + pl.w / 2 ? pl.x - hw : pl.x + pl.w + hw;
        o.vx = o.hitstun > 0 ? -o.vx * 0.35 : 0;
      }
    } else if (o.vy >= 0 && prevBottom <= pl.y + 1 && b >= pl.y && !(canDrop && o.drop > 0)) {
      land(o, pl, hh);
    }
  }
}
function land(o, pl, hh) {
  o.y = pl.y - hh;
  if (o.hitstun > 0 && o.vy > 650) { o.vy = -o.vy * 0.42; return; }
  if (o.vy > 500 && o.squash !== undefined) o.squash = 0.35;
  o.vy = 0; o.ground = true; o.gplat = pl;
  if (o.wallUsed !== undefined) o.wallUsed = false;
  if (o.jumps !== undefined) o.jumps = 2;
}
function groundBelow(x, y) {
  for (const pl of PLATS) if (x > pl.x + 4 && x < pl.x + pl.w - 4 && pl.y >= y - 4) return true;
  return false;
}

// Déplacement pur (contrôle, saut, gravité, collisions). Partagé par la
// simulation et par la prédiction locale du client (g peut être null).
function tickTimers(p, dt) {
  p.shoveCd -= dt; p.shoveT -= dt; p.grabCd -= dt; p.invuln -= dt; p.drop -= dt; p.lastHitT -= dt;
  p.squash = Math.max(0, p.squash - dt * 2.5);
}
function controlMove(g, p, inp, pr, dt, carrying) {
  if (inp.x && p.shoveT <= 0) p.face = inp.x;
  const speed = carrying ? 200 : 310;
  const k = p.ground ? 16 : 6;
  p.vx += (inp.x * speed - p.vx) * Math.min(1, dt * k);
  if (pr.up && p.jumps > 0) {
    p.vy = p.jumps === 2 ? -760 : -680; p.jumps--; p.ground = false; p.squash = -0.3;
    burst(g, p.x, p.y + p.h / 2, 5, '#ddd', 120, 3); sfx(g, 'jump', p);
  }
  if (inp.down && p.ground && p.gplat && !p.gplat.solid) p.drop = 0.22;
  if (inp.down && !p.ground && p.vy > -100) p.vy += G * 0.9 * dt;
}
// Accroche au mur : une fois par saut, en se poussant contre le côté du ring.
// Le joueur glisse doucement, puis saute pour remonter (un saut en l'air reste dispo).
const CLING_TIME = 1.2, CLING_ZONE = 220;
function wallNear(p) {
  for (const pl of PLATS) {
    if (!pl.solid || p.y < pl.y - 10 || p.y > pl.y + CLING_ZONE) continue;
    if (Math.abs(p.x + p.w / 2 - pl.x) < 6) return 1;              // mur à droite
    if (Math.abs(p.x - p.w / 2 - (pl.x + pl.w)) < 6) return -1;    // mur à gauche
  }
  return 0;
}
// Renvoie false (pas au mur), 'cling' (accroché) ou 'jump' (saut depuis le mur)
function wallMove(g, p, inp, pr, dt, carrying) {
  if (p.cling > 0) {
    p.cling -= dt; p.face = p.wallDir;
    p.vx = p.wallDir * 30; p.vy = 30;
    if (pr.up) {
      p.cling = 0; p.vy = -960; p.vx = p.wallDir * 170; p.jumps = 1; p.squash = -0.3;
      burst(g, p.x + p.wallDir * p.w / 2, p.y, 8, '#ddd', 180, 3); sfx(g, 'jump', p);
      return 'jump';
    }
    if (inp.down || inp.x === -p.wallDir) p.cling = 0;
    return 'cling';
  }
  if (!p.ground && !p.wallUsed && !carrying && p.vy > -250) {
    const d = wallNear(p);
    if (d && inp.x === d) {
      p.cling = CLING_TIME; p.wallUsed = true; p.wallDir = d; p.face = d; p.vx = 0; p.vy = 0;
      burst(g, p.x + d * p.w / 2, p.y - 10, 6, '#ffc93c', 120, 3); sfx(g, 'grab', p);
      return 'cling';
    }
  }
  return false;
}
function stunDrag(p, dt) {
  p.hitstun -= dt;
  p.vx *= p.ground ? Math.pow(0.02, dt) : Math.pow(0.6, dt);
}
function integrate(g, p, dt) {
  p.vy = Math.min(p.vy + G * dt, p.hitstun > 0 ? 2400 : 1300);
  const pb = p.y + p.h / 2, pt = p.y - p.h / 2;
  p.x += p.vx * dt; p.y += p.vy * dt;
  const wasHit = p.hitstun > 0 && p.vy > 650;
  collide(p, p.w / 2, p.h / 2, pb, pt, true);
  if (wasHit && p.vy < 0) burst(g, p.x, p.y + p.h / 2, 6, '#aaa', 200, 3);
}

function updatePlayer(g, p, dt) {
  if (p.out) return;
  if (p.respawn > 0) { p.respawn -= dt; if (p.respawn <= 0) placePlayer(p, false); return; }
  const inp = p.bot ? botInput(g, p, dt) : p.inp;
  const pr = { up: inp.up && !p.prev.up, a: inp.a && !p.prev.a, b: inp.b && !p.prev.b };
  p.prev = inp;
  tickTimers(p, dt);

  if (p.heldBy) {
    if (pr.up || pr.a || pr.b) p.escape -= 0.14;
    p.escape -= dt;
    if (p.escape <= 0) release(g, p.heldBy, true);
    return;
  }

  if (p.hitstun > 0) stunDrag(p, dt);
  else {
    const carrying = p.held && p.held.kind === 'p';
    if (!wallMove(g, p, inp, pr, dt, carrying)) {
      controlMove(g, p, inp, pr, dt, carrying);
      if (pr.a && p.shoveCd <= 0) doShove(g, p);
      if (pr.b && p.grabCd <= 0) doGrab(g, p, inp);
    }
    if (p.held && p.held.kind === 'p') {
      p.holdT += dt;
      if (p.holdT > 2.2) throwHeld(g, p, NO_INPUT);
    }
  }
  integrate(g, p, dt);

  if (p.x < -200 || p.x > W + 200 || p.y > H + 220 || p.y < -520) ko(g, p);
}

/* ---------- Prédiction côté client ---------- */
// Reconstruit un corps prédictible à partir de l'état envoyé par le serveur.
function restorePlayer(v, prevInp) {
  const p = {
    i: v.i, x: v.x, y: v.y, vx: v.vx, vy: v.vy, w: 36, h: 42, face: v.f, ground: !!v.g, gplat: null,
    jumps: v.j, drop: v.dr, hitstun: v.ht, shoveCd: v.sc, shoveT: v.sh, grabCd: 0, invuln: 0, lastHitT: 0,
    squash: v.sq, cling: v.cl, wallUsed: !!v.wu, wallDir: v.wd, carrying: v.hk === 'p', bat: v.hk === 'bat', prev: prevInp || NO_INPUT,
  };
  if (p.ground) p.gplat = PLATS.find(pl => Math.abs(pl.y - (p.y + p.h / 2)) < 1.5 && p.x + 18 > pl.x && p.x - 18 < pl.x + pl.w) || null;
  return p;
}
// Avance le corps prédit d'un pas. Renvoie 'jump' / 'shove' quand l'action démarre.
function predictStep(p, inp, dt) {
  const pr = { up: inp.up && !p.prev.up, a: inp.a && !p.prev.a, b: inp.b && !p.prev.b };
  p.prev = inp;
  tickTimers(p, dt);
  let fx = null;
  if (p.hitstun > 0) stunDrag(p, dt);
  else {
    const wall = wallMove(null, p, inp, pr, dt, p.carrying);
    if (wall === 'jump') fx = 'jump';
    else if (!wall) {
      const j = p.jumps;
      controlMove(null, p, inp, pr, dt, p.carrying);
      if (p.jumps < j) fx = 'jump';
      if (pr.a && p.shoveCd <= 0 && !p.carrying) {
        p.shoveCd = p.bat ? 0.48 : 0.32; p.shoveT = p.bat ? 0.22 : 0.15; fx = 'shove';
      }
    }
  }
  integrate(null, p, dt);
  return fx;
}

function updateCarried(g) {
  for (const p of g.players) {
    if (!p.held || !active(p)) continue;
    const r = p.held.ref;
    if (p.held.kind === 'p') { r.x = p.x; r.y = p.y - p.h / 2 - r.h / 2 + 6; r.vx = r.vy = 0; r.face = p.face; }
    else if (r.type === 'bat') { r.x = p.x + p.face * 22; r.y = p.y - 6; }
    else { r.x = p.x; r.y = p.y - p.h / 2 - r.r + 2; }
  }
}

function bodyPush(g) {
  const list = g.players.filter(p => active(p) && !p.heldBy);
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    if (a.held && a.held.ref === b || b.held && b.held.ref === a) continue;
    const dx = b.x - a.x, dy = b.y - a.y, minX = (a.w + b.w) / 2 - 4;
    if (Math.abs(dx) < minX && Math.abs(dy) < (a.h + b.h) / 2 - 8) {
      const s = Math.sign(dx) || (Math.random() < 0.5 ? -1 : 1), push = (minX - Math.abs(dx)) / 2;
      a.x -= s * push; b.x += s * push;
      const rel = (a.vx - b.vx) * s;
      if (rel > 0) { a.vx -= s * rel * 0.5; b.vx += s * rel * 0.5; }
    }
  }
}

function spawnItem(g) {
  const type = ITEM_TYPES[(Math.random() * ITEM_TYPES.length) | 0];
  g.items.push({
    id: g.nextId++, type, x: 300 + Math.random() * 680, y: -40, vx: (Math.random() - 0.5) * 100, vy: 0,
    r: type === 'bat' ? 16 : 18, heldBy: null, thrownBy: null, owner: null, grace: 0, fuse: null, uses: 4,
    rot: 0, spin: 0, ground: false, hitstun: 0,
  });
}

function updateItems(g, dt) {
  for (const it of g.items.slice()) {
    if (it.fuse != null) { it.fuse -= dt; if (it.fuse <= 0) { explode(g, it); continue; } }
    if (it.heldBy) continue;
    it.grace -= dt;
    it.vy = Math.min(it.vy + G * dt, 1500);
    const pb = it.y + it.r, pt = it.y - it.r;
    it.x += it.vx * dt; it.y += it.vy * dt; it.rot += it.spin * dt;
    const vyBefore = it.vy;
    collide(it, it.r, it.r, pb, pt, false);
    if (it.ground) {
      if (vyBefore > 380) { it.vy = -vyBefore * 0.35; it.ground = false; }
      it.vx *= Math.pow(0.03, dt); it.spin *= Math.pow(0.02, dt);
      if (it.type !== 'bat') it.rot *= Math.pow(0.001, dt);
    }
    const sp = Math.hypot(it.vx, it.vy);
    if (it.thrownBy && sp > 380) {
      for (const q of g.players) {
        if (!active(q) || q.heldBy || q.invuln > 0) continue;
        if (q === it.thrownBy && it.grace > 0) continue;
        if (q.held && q.held.ref === it) continue;
        if (Math.abs(q.x - it.x) < q.w / 2 + it.r && Math.abs(q.y - it.y) < q.h / 2 + it.r) {
          const by = it.thrownBy !== q ? it.thrownBy : null;
          if (it.type === 'bomb') { explode(g, it); break; }
          if (it.type === 'crate') {
            hit(g, q, it.vx, it.vy - 300, 560, 13, by);
            burst(g, it.x, it.y, 18, '#c58a4a', 400, 5); pop(g, it.x, it.y - 20, 'KRAK', '#e0a060', false);
            removeItem(g, it); sfx(g, 'hit'); break;
          }
          hit(g, q, it.vx, it.vy - 250, 470, 10, by); it.vx *= -0.3; it.vy = -200; it.thrownBy = null; sfx(g, 'bat'); break;
        }
      }
    }
    if (it.ground && sp < 200) it.thrownBy = null;
    if (it.y > H + 300 || it.x < -400 || it.x > W + 400) removeItem(g, it);
  }
}

function step(g, dt) {
  g.time += dt;
  for (const p of g.players) updatePlayer(g, p, dt);
  bodyPush(g);
  updateCarried(g);
  updateItems(g, dt);
  g.itemTimer -= dt;
  if (g.itemTimer <= 0) { if (g.items.length < 3) spawnItem(g); g.itemTimer = 5 + Math.random() * 4; }
}

/* ---------- Bots ---------- */
function botInput(g, p, dt) {
  const r = { x: 0, up: false, down: false, a: false, b: false }, ai = p.ai;
  ai.cd -= dt; ai.itemCd -= dt;
  if (p.heldBy) { r.a = Math.random() < 0.35 && !p.prev.a; return r; }
  const canJump = () => !p.prev.up;

  // Revenir sur le ring
  if (p.cling > 0) { r.x = p.wallDir; r.up = canJump() && Math.random() < 0.2; return r; }
  if (!p.ground && !groundBelow(p.x, p.y)) {
    r.x = p.x < W / 2 ? 1 : -1;
    if (p.vy > -60 && p.jumps > 0 && canJump()) r.up = true;
    return r;
  }

  const foes = g.players.filter(q => q !== p && active(q) && !q.heldBy);
  let tgt = null, td = 1e9;
  for (const q of foes) {
    const d = Math.hypot(q.x - p.x, q.y - p.y) + (q.invuln > 0 ? 400 : 0);
    if (d < td) { td = d; tgt = q; }
  }

  const moveTo = tx => {
    const dx = tx - p.x;
    if (Math.abs(dx) > 18) {
      const s = Math.sign(dx);
      if (p.ground && !groundBelow(p.x + s * 42, p.y)) return;
      r.x = s;
    }
  };

  // Porte quelqu'un : vers le bord le plus proche, puis lance
  if (p.held && p.held.kind === 'p') {
    ai.t += dt;
    r.x = p.x < W / 2 ? -1 : 1;
    if (ai.t > 0.3 + Math.random() * 0.3) r.b = !p.prev.b;
    return r;
  }
  // Porte un objet
  if (p.held && tgt) {
    const it = p.held.ref, dx = tgt.x - p.x, dy = tgt.y - p.y;
    if (it.type === 'bat') {
      moveTo(tgt.x);
      if (Math.abs(dx) < 80 && Math.abs(dy) < 50 && ai.cd <= 0) {
        r.x = Math.sign(dx);
        if (p.face === Math.sign(dx)) { r.a = !p.prev.a; ai.cd = 0.3; }
      }
    } else {
      if (Math.abs(dx) > 120) moveTo(tgt.x);
      if ((Math.abs(dx) < 520 && Math.abs(dy) < 90) || (it.type === 'bomb' && it.fuse < 1.2)) {
        r.x = Math.sign(dx) || p.face; r.b = !p.prev.b;
      }
    }
    return r;
  }
  // Aller chercher un objet
  if (!p.held && ai.itemCd <= 0) {
    let near = null, nd = 260;
    for (const it of g.items) {
      if (it.heldBy || it.thrownBy) continue;
      const d = Math.hypot(it.x - p.x, it.y - p.y);
      if (d < nd && !(it.type === 'bomb' && it.fuse != null && it.fuse < 1.5)) { nd = d; near = it; }
    }
    if (near && (!tgt || td > 140)) {
      moveTo(near.x);
      if (near.y < p.y - 80 && p.ground && ai.cd <= 0 && canJump()) { r.up = true; ai.cd = 0.4; }
      if (nd < 55 && !p.prev.b) { r.b = true; ai.itemCd = 1; }
      return r;
    }
  }
  if (!tgt) return r;

  const dx = tgt.x - p.x, dy = tgt.y - p.y;
  if (Math.abs(dx) > 52) moveTo(tgt.x);
  if (dy < -70 && p.ground && ai.cd <= 0 && canJump()) { r.up = true; ai.cd = 0.45; }
  if (dy > 70 && p.ground && p.gplat && !p.gplat.solid) r.down = true;
  if (Math.abs(dx) < 66 && Math.abs(dy) < 46 && ai.cd <= 0) {
    const s = Math.sign(dx) || p.face;
    if (p.face !== s) r.x = s;
    else {
      if (Math.random() < 0.3 && !p.prev.b) r.b = true; else if (!p.prev.a) r.a = true;
      ai.cd = 0.25 + Math.random() * 0.4;
    }
  }
  return r;
}

const api = { W, H, STEP, COLORS, PLATS, createGame, restorePlayer, predictStep, update, setInput, setBot, drainEvents, view, results };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else root.Yeet = api;
})(typeof self !== 'undefined' ? self : this);
