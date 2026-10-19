// Local game host: serves the game (display) and the phone controller page,
// and relays phone inputs to the display over WebSockets.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');

const PORT = Number(process.env.PORT) || 10000;
const ROOT = __dirname;

// URL prefix -> folder on disk (first match wins)
const MOUNTS = [
  ['/vendor/', path.join(ROOT, 'node_modules/three/build')],
  ['/addons/', path.join(ROOT, 'node_modules/three/examples/jsm')],
  ['/data/', path.join(ROOT, 'data')],
  ['/', path.join(ROOT, 'public')],
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary',
};

function lanAddress() {
  const nets = os.networkInterfaces();
  const candidates = [];
  for (const [name, addrs] of Object.entries(nets)) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) candidates.push({ name, address: a.address });
    }
  }
  // Prefer Wi-Fi / ethernet style interfaces over VPNs and bridges
  candidates.sort((a, b) => score(b) - score(a));
  return candidates[0]?.address || 'localhost';

  function score(c) {
    if (/^(en|wl|eth)/.test(c.name)) return 2;
    if (/^(utun|tun|tap|bridge|vbox|docker|vmnet)/.test(c.name)) return 0;
    return 1;
  }
}

const padUrl = () => `http://${lanAddress()}:${PORT}/pad`;

// Every folder in public/games with a game.json shows up on the game select page.
// Read on each request so a new game appears without restarting the server.
const GAMES_DIR = path.join(ROOT, 'public/games');
function listGames() {
  const games = [];
  for (const id of fs.readdirSync(GAMES_DIR)) {
    let meta;
    try {
      meta = JSON.parse(fs.readFileSync(path.join(GAMES_DIR, id, 'game.json'), 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT' && err.code !== 'ENOTDIR') console.warn(`[games] skipping ${id}: ${err.message}`);
      continue;
    }
    const playable = fs.existsSync(path.join(GAMES_DIR, id, 'index.html'));
    games.push({
      id,
      name: meta.name || id,
      icon: meta.icon || '🎮',
      tagline: meta.tagline || '',
      players: meta.players || '',
      status: playable && meta.status !== 'soon' ? 'ready' : 'soon',
      order: Number(meta.order) || 999,
      url: `/games/${id}/`,
    });
  }
  return games.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

function resolveStatic(urlPath) {
  for (const [prefix, dir] of MOUNTS) {
    if (!urlPath.startsWith(prefix)) continue;
    const rel = urlPath.slice(prefix.length);
    const file = path.normalize(path.join(dir, rel));
    if (!file.startsWith(dir)) return null; // path traversal
    return file;
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }

  if (urlPath === '/pad' || urlPath === '/pad/') urlPath = '/pad.html';
  // /games/football -> /games/football/ so the game's relative URLs resolve inside its folder
  if (/^\/games\/[^/.]+$/.test(urlPath)) {
    res.writeHead(301, { Location: `${urlPath}/` }).end();
    return;
  }
  if (urlPath.endsWith('/')) urlPath += 'index.html';

  if (urlPath === '/api/games') {
    res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ games: listGames() }));
    return;
  }

  if (urlPath === '/info') {
    const url = padUrl();
    const qr = await QRCode.toString(url, { type: 'svg', margin: 1, color: { dark: '#000', light: '#fff' } });
    res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ padUrl: url, qr }));
    return;
  }

  const file = resolveStatic(urlPath);
  if (!file) {
    res.writeHead(404).end('Not found');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
});

// --- WebSocket relay -------------------------------------------------------
// One display (the game screen) and any number of pads (phones).
// Pads -> display: inputs tagged with the pad id.
// Display -> pad: messages with a `to` field are forwarded to that pad.

const wss = new WebSocketServer({ server });
wss.on('error', () => {}); // it re-emits the http server's errors, which are handled below
let display = null;
const pads = new Map(); // id -> { ws, name }

function send(ws, msg) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let m;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    if (!m || typeof m !== 'object') return;

    if (m.t === 'hello') {
      if (m.role === 'display') {
        if (display && display !== ws) display.close();
        display = ws;
        ws.role = 'display';
        for (const [id, p] of pads) send(display, { t: 'join', id, name: p.name });
        for (const p of pads.values()) send(p.ws, { t: 'display', on: true });
      } else {
        const id = /^[a-z0-9]{6,24}$/i.test(m.id) ? m.id : crypto.randomBytes(6).toString('hex');
        const name = String(m.name || '').slice(0, 12);
        const old = pads.get(id);
        if (old && old.ws !== ws) old.ws.close();
        pads.set(id, { ws, name });
        ws.role = 'pad';
        ws.padId = id;
        send(ws, { t: 'welcome', id, display: !!display });
        send(display, { t: 'join', id, name });
        console.log(`[pad] ${name || id} connected (${pads.size} total)`);
      }
      return;
    }

    if (ws.role === 'pad') {
      if (m.t === 'name') {
        const p = pads.get(ws.padId);
        if (p) p.name = String(m.name || '').slice(0, 12);
      }
      send(display, { ...m, id: ws.padId });
    } else if (ws.role === 'display' && m.to) {
      send(pads.get(m.to)?.ws, m);
    }
  });

  ws.on('close', () => {
    if (ws.role === 'display' && display === ws) {
      display = null;
      for (const p of pads.values()) send(p.ws, { t: 'display', on: false });
    } else if (ws.role === 'pad' && pads.get(ws.padId)?.ws === ws) {
      pads.delete(ws.padId);
      send(display, { t: 'leave', id: ws.padId });
      console.log(`[pad] ${ws.padId} left (${pads.size} total)`);
    }
  });
});

server.on('error', (err) => {
  if (err.code !== 'EADDRINUSE') throw err;
  console.error(`  Port ${PORT} is already in use (is Game Night already running?). Try another: PORT=10001`);
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
  const url = `http://localhost:${PORT}`;
  console.log('');
  console.log('  GAME NIGHT is running');
  console.log(`  Game screen : ${url}`);
  console.log(`  Phones      : ${padUrl()}   (same Wi-Fi)`);
  console.log('');
  if (process.env.OPEN_BROWSER) openBrowser(url);
});

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : ['xdg-open', [url]];
  require('child_process').spawn(...cmd, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}
