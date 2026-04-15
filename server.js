const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8'
};

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const rooms = new Map();

function cleanRoomId(value) {
  return (value || 'lobby').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32) || 'lobby';
}

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      state: {
        fen: START_FEN,
        history: [],
        turn: 'w',
        isGameOver: false,
        isCheck: false,
        result: null
      },
      players: { w: null, b: null },
      streams: new Set()
    });
  }
  return rooms.get(roomId);
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=UTF-8' });
  res.end(JSON.stringify(data));
}

function getRole(room, userId) {
  if (room.players.w === userId) return 'w';
  if (room.players.b === userId) return 'b';
  return 'spectator';
}

function assignRole(room, userId) {
  const existing = getRole(room, userId);
  if (existing !== 'spectator') return existing;

  if (!room.players.w) {
    room.players.w = userId;
    return 'w';
  }

  if (!room.players.b) {
    room.players.b = userId;
    return 'b';
  }

  return 'spectator';
}

function broadcast(room, roomId) {
  const payload = JSON.stringify({ type: 'state', roomId, ...room.state, players: room.players });
  for (const stream of room.streams) {
    stream.write(`data: ${payload}\n\n`);
  }
}

function serveStatic(req, res) {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  let filePath = parsedUrl.pathname === '/' ? '/index.html' : parsedUrl.pathname;
  filePath = path.normalize(filePath).replace(/^([.][.][/\\])+/, '');
  const absPath = path.join(PUBLIC_DIR, filePath);

  if (!absPath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(absPath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=UTF-8' });
      res.end('Not found');
      return;
    }

    const ext = path.extname(absPath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/join' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const { roomId, userId } = JSON.parse(body || '{}');
        const cleanRoom = cleanRoomId(roomId);
        const normalizedUserId = typeof userId === 'string' && userId.length > 8 ? userId : crypto.randomUUID();
        const room = getRoom(cleanRoom);
        const role = assignRole(room, normalizedUserId);

        sendJson(res, 200, { roomId: cleanRoom, userId: normalizedUserId, yourRole: role, ...room.state });
      } catch (_error) {
        sendJson(res, 400, { message: 'JSON inválido' });
      }
    });
    return;
  }

  if (url.pathname === '/api/events' && req.method === 'GET') {
    const roomId = cleanRoomId(url.searchParams.get('room'));
    const room = getRoom(roomId);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });
    res.write('\n');

    room.streams.add(res);
    res.write(`data: ${JSON.stringify({ type: 'state', roomId, ...room.state, players: room.players })}\n\n`);

    req.on('close', () => {
      room.streams.delete(res);
    });
    return;
  }

  if (url.pathname === '/api/move' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const roomId = cleanRoomId(payload.roomId);
        const room = getRoom(roomId);
        const role = getRole(room, payload.userId);

        if (role === 'spectator') {
          sendJson(res, 403, { message: 'Solo jugadores pueden mover.' });
          return;
        }

        if (role !== payload.turn) {
          sendJson(res, 409, { message: 'Turno inválido.' });
          return;
        }

        room.state = {
          fen: payload.fen,
          history: Array.isArray(payload.history) ? payload.history : [],
          turn: payload.nextTurn,
          isGameOver: Boolean(payload.isGameOver),
          isCheck: Boolean(payload.isCheck),
          result: payload.result || null
        };

        broadcast(room, roomId);
        sendJson(res, 200, { ok: true });
      } catch (_error) {
        sendJson(res, 400, { message: 'JSON inválido' });
      }
    });
    return;
  }

  if (url.pathname === '/api/reset' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const roomId = cleanRoomId(payload.roomId);
        const room = getRoom(roomId);
        const role = getRole(room, payload.userId);

        if (role === 'spectator') {
          sendJson(res, 403, { message: 'Solo jugadores pueden reiniciar.' });
          return;
        }

        room.state = {
          fen: START_FEN,
          history: [],
          turn: 'w',
          isGameOver: false,
          isCheck: false,
          result: null
        };

        broadcast(room, roomId);
        sendJson(res, 200, { ok: true });
      } catch (_error) {
        sendJson(res, 400, { message: 'JSON inválido' });
      }
    });
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Servidor listo en http://localhost:${PORT}`);
});
