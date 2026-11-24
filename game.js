import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import QRCode from 'qrcode';
import { missions } from './missions.js';

const token = () => randomBytes(24).toString('base64url');
const missionById = new Map(missions.map(mission => [mission.id, mission]));
const status = game => Date.now() >= game.cutoff ? 'revealed' : 'open';
const active = player => player.assignments.filter(item => item.state === 'active');
const publicPlayer = ({ id, name, score, completed }) => ({ id, name, score, completed });
const details = assignment => ({ ...assignment, ...missionById.get(assignment.missionId) });

function deal(game, player, difficulty) {
  const used = new Set(Object.values(game.players).flatMap(guest => guest.assignments.map(item => item.missionId)));
  const available = missions.filter(mission => !used.has(mission.id) && (!player.family || mission.family));
  const preferred = available.filter(mission => mission.difficulty === difficulty);
  const pool = preferred.length ? preferred : available;
  if (pool.length) {
    player.assignments.push({ assignmentId: randomUUID(), missionId: pool[randomInt(pool.length)].id, state: 'active' });
  }
}

function view(game, auth) {
  const host = !!auth && auth === game.host;
  const player = Object.values(game.players).find(item => item.token === auth);
  const phase = status(game);
  const standings = Object.values(game.players).map(publicPlayer)
    .sort((a, b) => b.score - a.score || b.completed - a.completed || a.id - b.id);
  return {
    code: game.code, cutoff: game.cutoff, phase, host, standings, events: game.events.slice(-30),
    revealIndex: game.revealIndex,
    player: player ? { ...publicPlayer(player), missions: active(player).map(details) } : null,
    reveal: phase === 'revealed' ? standings.map(row => ({
      ...row, missions: game.players[row.id].assignments.map(details),
    })) : null,
  };
}

function fail(code, message) {
  throw Object.assign(new Error(message), { status: code });
}

async function body(request) {
  if (Buffer.isBuffer(request.rawBody)) {
    if (request.rawBody.length > 4096) fail(413, 'Request is too large.');
    return parseBody(request.rawBody.toString());
  }
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 4096) fail(413, 'Request is too large.');
  }
  return parseBody(raw);
}

function parseBody(raw) {
  try {
    const parsed = JSON.parse(raw || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail(400, 'Invalid request.');
    return parsed;
  } catch {
    fail(400, 'Invalid request.');
  }
}

const assets = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/config.js': ['config.js', 'text/javascript; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
};

function send(response, code, data) {
  response.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(data));
}

export const gameHandler = store => async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    const auth = request.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
    const method = request.method;
    if (method === 'GET' && Object.hasOwn(assets, url.pathname)) {
      const [file, type] = assets[url.pathname];
      response.writeHead(200, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' });
      return response.end(readFileSync(new URL('./public/' + file, import.meta.url)));
    }
    if (method === 'POST' && url.pathname === '/api/games') {
      const { cutoff } = await body(request);
      if (typeof cutoff !== 'number' || !Number.isSafeInteger(cutoff) || cutoff <= Date.now() || cutoff > Date.now() + 7 * 86400000) {
        fail(400, 'Choose a cutoff within the next seven days.');
      }
      let game;
      do {
        const code = randomBytes(3).toString('hex').toUpperCase();
        game = { code, cutoff, host: token(), players: {}, events: [], sequence: 0, revealIndex: 0 };
      } while (!(await store.create(game)));
      return send(response, 201, { token: game.host, ...view(game, game.host) });
    }
    const route = url.pathname.match(/^\/api\/games\/([0-9A-F]{6})(?:\/(join|mission|advance|qr))?$/i);
    const missing = () => fail(404, 'Game not found. Check the join code.');
    if (!route) missing();
    const code = route[1].toUpperCase();
    const action = route[2];
    if (method === 'GET') {
      const game = await store.read(code);
      if (!game) missing();
      if (!action) return send(response, 200, view(game, auth));
      if (action !== 'qr') fail(405, 'Method not allowed.');
      const origin = process.env.GOBBLE_PUBLIC_ORIGIN || url.searchParams.get('target') || `http://${request.headers.host}`;
      let target;
      try { target = new URL(origin); } catch { fail(400, 'Invalid QR origin.'); }
      if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) fail(400, 'Invalid QR origin.');
      target.search = '';
      target.hash = '';
      target.searchParams.set('join', game.code);
      const image = await QRCode.toBuffer(target.href, { margin: 2, width: 256 });
      response.writeHead(200, { 'Content-Type': 'image/png' });
      return response.end(image);
    }
    if (method !== 'POST') fail(405, 'Method not allowed.');
    const input = await body(request);
    const result = await store.update(code, game => {
      if (!game) missing();
      return updateGame(game, action, auth, input);
    });
    send(response, result.status, result.data);
  } catch (error) {
    if (!error.status) console.error(error);
    send(response, error.status || 500, error.status ? { error: error.message } : { error: 'Something went wrong.' });
  }
};

function updateGame(game, action, auth, input) {
  if (action === 'join') {
    if (status(game) !== 'open') fail(409, 'This game is closed.');
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name || name.length > 24) fail(400, 'Enter a name between 1 and 24 characters.');
    const id = Object.keys(game.players).length + 1;
    const player = { id, name, token: token(), family: input.family === true, score: 0, completed: 0, assignments: [] };
    game.players[id] = player;
    for (const difficulty of ['Easy', 'Medium', player.family ? 'Easy' : 'Hard']) deal(game, player, difficulty);
    if (active(player).length < 3) {
      delete game.players[id];
      fail(409, 'There are fewer than three available missions for this selection.');
    }
    return { status: 201, data: { token: player.token, ...view(game, player.token) } };
  }
  if (action === 'mission') {
    const player = Object.values(game.players).find(item => item.token === auth);
    if (!player) fail(403, 'Join this game to update missions.');
    const assignment = active(player).find(item => item.assignmentId === input.assignmentId);
    if (!assignment) fail(409, 'That mission has already been updated.');
    if (status(game) !== 'open') fail(409, 'Scoring is closed.');
    const mission = missionById.get(assignment.missionId);
    if (input.result === 'completed') {
      assignment.state = 'completed';
      player.score += mission.points;
      player.completed++;
      game.events.push({ sequence: ++game.sequence, name: player.name, points: mission.points });
      if (game.events.length > 30) game.events.shift();
    } else if (input.result === 'abandoned') {
      assignment.state = 'abandoned';
      player.score -= 25;
    } else {
      fail(400, 'Invalid mission result.');
    }
    deal(game, player, mission.difficulty);
  } else if (action === 'advance') {
    if (auth !== game.host) fail(403, 'Only the game leader can advance the reveal.');
    if (status(game) !== 'revealed') fail(409, 'The reveal opens at cutoff.');
    if (![-1, 1].includes(input.step)) fail(400, 'Invalid reveal step.');
    game.revealIndex = Math.max(0, Math.min(Object.keys(game.players).length - 1, game.revealIndex + input.step));
  } else {
    fail(404, 'Unknown action.');
  }
  return { status: 200, data: view(game, auth) };
}
