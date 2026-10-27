/* YEET CLUB — serveur de jeu.
   Sert les fichiers de /public et héberge les salles en ligne via WebSocket.
   Le serveur fait autorité : il simule la partie à 120 Hz, reçoit les
   entrées des joueurs et diffuse l'état à 60 Hz.
   Chaque instantané indique la dernière entrée traitée de chaque joueur,
   ce qui permet au client de prédire son personnage sans attendre. */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const Yeet = require('./public/game.js');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');
const TICK = 1 / 60;            // un tick = une entrée par joueur = 2 pas de simulation
const MAX_QUEUE = 8;             // au-delà, on jette les entrées les plus vieilles
const MAX_SEATS = 4;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.json': 'application/json',
};

/* ---------- Fichiers statiques ---------- */
const server = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); return; }
  let url;
  try { url = decodeURIComponent(req.url.split('?')[0]); } catch { res.writeHead(400); res.end(); return; }
  if (url === '/') url = '/index.html';
  const file = path.normalize(path.join(PUBLIC, url));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Introuvable'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

/* ---------- Salles ---------- */
const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0];
    if (!rooms.has(c)) return c;
  }
}
function cleanName(n) {
  const s = String(n || '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 12);
  return s || 'Anonyme';
}
function send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function broadcast(room, msg) {
  const data = JSON.stringify(msg);
  for (const s of room.seats) if (s && s.ws && s.ws.readyState === 1) s.ws.send(data);
}
function humans(room) { return room.seats.filter(s => s && s.ws); }

function roomState(room) {
  for (const s of room.seats) {
    if (!s || !s.ws) continue;
    send(s.ws, {
      t: 'room', code: room.code, you: room.seats.indexOf(s), host: room.host === s.ws,
      stocks: room.stocks, playing: !!room.game,
      seats: room.seats.map(x => x ? { bot: !x.ws, name: x.name } : null),
    });
  }
}

function createRoom(ws, name) {
  const room = { code: newCode(), seats: [null, null, null, null], host: ws, stocks: 3, game: null, timer: null };
  room.seats[0] = { ws, name: cleanName(name) };
  rooms.set(room.code, room);
  ws.room = room;
  roomState(room);
}

function joinRoom(ws, code, name) {
  const room = rooms.get(String(code || '').toUpperCase().trim());
  if (!room) return send(ws, { t: 'err', msg: 'Aucune salle avec ce code.' });
  if (room.game) return send(ws, { t: 'err', msg: 'Une partie est en cours dans cette salle. Réessaie à la fin du round.' });
  let i = room.seats.indexOf(null);
  if (i < 0) i = room.seats.findIndex(s => s && !s.ws);   // remplace un bot
  if (i < 0) return send(ws, { t: 'err', msg: 'La salle est pleine (4 joueurs).' });
  room.seats[i] = { ws, name: cleanName(name) };
  ws.room = room;
  roomState(room);
}

function leaveRoom(ws) {
  const room = ws.room; if (!room) return;
  ws.room = null;
  const i = room.seats.findIndex(s => s && s.ws === ws);
  if (i >= 0) {
    if (room.game) {
      // En pleine partie, un bot reprend le personnage
      room.seats[i] = { ws: null, name: room.seats[i].name, left: true };
      Yeet.setBot(room.game, i, true);
    } else room.seats[i] = null;
  }
  if (!humans(room).length) { stopGame(room); rooms.delete(room.code); return; }
  if (room.host === ws) room.host = humans(room)[0].ws;
  roomState(room);
}

function startGame(room, asker) {
  const filled = room.seats.filter(Boolean);
  if (filled.length < 2) {
    return send(asker || room.host, { t: 'err', msg: asker
      ? 'Ton adversaire est parti. Retourne au salon pour ajouter un bot ou inviter quelqu\'un.'
      : 'Il faut au moins deux combattants. Ajoute un bot ou invite un ami.' });
  }
  room.played = true;
  const seats = room.seats.map(s => s ? { bot: !s.ws, name: s.name, label: s.ws ? 'En ligne' : 'Bot' } : null);
  room.game = Yeet.createGame({ seats, stocks: room.stocks });
  broadcast(room, { t: 'start' });
  roomState(room);
  for (const st of room.seats) if (st) { st.q = []; st.inp = { x: 0, up: false, down: false, a: false, b: false }; st.ack = 0; }
  let last = Date.now(), acc = 0, events = [];
  room.timer = setInterval(() => {
    const now = Date.now(), g = room.game;
    if (!g) return;
    acc = Math.min(acc + (now - last) / 1000, 0.25); last = now;
    let ticks = 0;
    while (acc >= TICK && ticks < 5) {
      acc -= TICK; ticks++;
      room.seats.forEach((st, i) => {
        if (!st || !st.ws) return;
        if (st.q.length) { const m = st.q.shift(); st.inp = m; st.ack = m.s; }
        Yeet.setInput(g, i, st.inp);
      });
      Yeet.update(g, TICK);
      events.push(...Yeet.drainEvents(g));
      if (g.finished) break;
    }
    if (!ticks) return;
    const v = Yeet.view(g);
    for (const pv of v.p) { const st = room.seats[pv.i]; pv.q = st && st.ws ? st.ack : 0; }
    broadcast(room, { t: 'snap', v, e: events });
    events = [];
    if (g.finished) {
      broadcast(room, { t: 'end', r: Yeet.results(g) });
      stopGame(room);
      // les places tenues par des joueurs partis redeviennent libres
      room.seats = room.seats.map(st => (st && !st.ws && st.left) ? null : st);
      roomState(room);
    }
  }, 1000 / 120);
}

function stopGame(room) {
  if (room.timer) clearInterval(room.timer);
  room.timer = null; room.game = null;
}

/* ---------- WebSocket ---------- */
const wss = new WebSocketServer({ server, maxPayload: 2048 });

wss.on('connection', ws => {
  if (ws._socket) ws._socket.setNoDelay(true);
  ws.room = null; ws.alive = true; ws.budget = 240;
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', raw => {
    if (--ws.budget < 0) return;                    // anti-inondation simple
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;
    const room = ws.room;
    switch (m.t) {
      case 'create': if (!room) createRoom(ws, m.name); break;
      case 'join': if (!room) joinRoom(ws, m.code, m.name); break;
      case 'leave': leaveRoom(ws); break;
      case 'in': {
        if (!room || !room.game) break;
        const st = room.seats.find(s => s && s.ws === ws);
        if (!st || !st.q) break;
        st.q.push({ s: m.s >>> 0, x: Math.sign(m.x | 0), up: !!m.u, down: !!m.d, a: !!m.a, b: !!m.b });
        if (st.q.length > MAX_QUEUE) st.q.splice(0, st.q.length - MAX_QUEUE);
        break;
      }
      case 'seat': {
        if (!room || room.host !== ws || room.game) break;
        const i = m.i | 0; if (i < 0 || i >= MAX_SEATS) break;
        const s = room.seats[i];
        if (!s) room.seats[i] = { ws: null, name: 'Bot' };
        else if (!s.ws) room.seats[i] = null;
        roomState(room);
        break;
      }
      case 'stocks': {
        if (!room || room.host !== ws || room.game) break;
        room.stocks = Math.max(1, Math.min(9, m.n | 0));
        roomState(room);
        break;
      }
      case 'start': if (room && room.host === ws && !room.game) startGame(room); break;
      // revanche : n'importe quel joueur de la salle peut la lancer après une partie
      case 'again': if (room && room.played && !room.game) startGame(room, ws); break;
    }
  });
  ws.on('close', () => leaveRoom(ws));
});

// budget de messages rechargé chaque seconde, connexions mortes fermées
setInterval(() => { for (const ws of wss.clients) ws.budget = 240; }, 1000);
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false; ws.ping();
  }
}, 15000);

server.listen(PORT, () => console.log(`YEET CLUB en ligne sur http://localhost:${PORT}`));
