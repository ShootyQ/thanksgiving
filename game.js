import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import QRCode from 'qrcode';
import { missions } from './missions.js';
import { avatars } from './public/avatars.js';
import { codewordView, issueCodeword, recordCodeword } from './codewords.js';
import { registerIdentity, openIdentityRound, saveGuesses, identityScore, identityView } from './identity.js';

const token = () => randomBytes(24).toString('base64url');
const missionById = new Map(missions.map(mission => [mission.id, mission]));
function status(game) {
  if (game.canceledAt) return 'canceled';
  if (game.requiresStart && !game.startedAt) return 'lobby';
  return Date.now() >= game.cutoff ? 'revealed' : 'open';
}
const active = player => player.assignments.filter(item => item.state === 'active');
const avatarIds = new Set(avatars.map(avatar => avatar.id));
const publicPlayer = ({ id, name, score, completed, avatar }) => ({
  id, name, score, completed, ...(avatar ? { avatar } : {}),
});
const sniffedPenalty = 50;

function details(assignment) {
  const mission = missionById.get(assignment.missionId);
  const description = assignment.targetName
    ? mission.description.replace('{target}', () => assignment.targetName)
    : mission.description;
  return { ...assignment, ...mission, description };
}

function deal(game, player) {
  const guests = Object.values(game.players);
  const targets = guests.filter(guest => guest.id !== player.id);
  const used = new Set(guests.flatMap(guest => guest.assignments.map(item => item.missionId)));
  const pool = missions.filter(mission =>
    !used.has(mission.id) && (!player.family || mission.family) && (!mission.targeted || targets.length)
  );
  if (!pool.length) return false;
  const mission = pool[randomInt(pool.length)];
  const assignment = { assignmentId: randomUUID(), missionId: mission.id, state: 'active' };
  if (mission.targeted) {
    const target = targets[randomInt(targets.length)];
    assignment.targetName = `Agent ${target.name} (#${String(target.id).padStart(3, '0')})`;
  }
  player.assignments.push(assignment);
  return true;
}

const minimumAgents = 3;

function joiningOpen(game, phase) {
  return phase === 'open' || (phase === 'lobby' && Date.now() < game.cutoff);
}

function fillMissionSlots(game, player) {
  const vacancies = 3 - active(player).length;
  for (let slot = 0; slot < vacancies; slot++) {
    if (!deal(game, player)) break;
  }
}

function needsLobbyMissions(game, player) {
  return player?.assignments.length === 0 && status(game) === 'lobby' && joiningOpen(game, 'lobby');
}

function view(game, auth) {
  const host = !!auth && auth === game.host;
  const players = Object.values(game.players);
  const player = players.find(item => item.token === auth);
  const phase = status(game);
  const revealed = phase === 'revealed';
  const lobbySealed = game.requiresStart === true && !game.startedAt;
  const joinOpen = joiningOpen(game, phase);
  const finalPlayer = guest => {
    const row = publicPlayer(guest);
    if (!revealed) return row;
    const identity = identityScore(game, guest);
    return { ...row, ...identity, score: row.score + identity.identityXp };
  };
  const standings = lobbySealed ? [] : players.map(finalPlayer)
    .sort((a, b) => b.score - a.score || b.completed - a.completed || a.id - b.id);
  return {
    code: game.code, avatarSelection: true, sniffedPenalty, cutoff: game.cutoff, phase, host, standings,
    events: lobbySealed ? [] : game.events.slice(-30), lobbySealed, playerCount: players.length,
    ...(lobbySealed && joinOpen ? { claimedAvatars: players.map(guest => guest.avatar).filter(Boolean).sort() } : {}),
    revealIndex: game.revealIndex, joinOpen, manualStart: Boolean(game.requiresStart),
    canCancel: host && (phase === 'lobby' || phase === 'open'),
    canStart: host && phase === 'lobby' && joinOpen && players.length >= minimumAgents,
    ...(phase === 'lobby' ? { minimumAgents } : {}),
    identity: identityView(game, phase === 'canceled' ? null : player, revealed),
    codewords: phase === 'lobby' ? null : codewordView(game, player),
    player: player ? { ...finalPlayer(player), missions: active(player).map(details) } : null,
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
  '/avatars.js': ['avatars.js', 'text/javascript; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  ...Object.fromEntries(['gobble-briefing', ...avatars.map(avatar => avatar.id)].map(name => [
    '/art/' + name + '.webp', ['art/' + name + '.webp', 'image/webp'],
  ])),
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
        game = { code, cutoff, requiresStart: true, host: token(), players: {}, events: [], sequence: 0, revealIndex: 0 };
      } while (!(await store.create(game)));
      return send(response, 201, { token: game.host, ...view(game, game.host) });
    }
    const route = url.pathname.match(/^\/api\/games\/([0-9A-F]{6})(?:\/(join|mission|advance|qr|identity-open|guess|codeword-mission|record-codeword|cancel|start))?$/i);
    const missing = () => fail(404, 'Game not found. Check the join code.');
    if (!route) missing();
    const code = route[1].toUpperCase();
    const action = route[2];
    if (method === 'GET') {
      let game = await store.read(code);
      if (!game) missing();
      if (!action) {
        const player = auth && Object.values(game.players).find(item => item.token === auth);
        if (needsLobbyMissions(game, player)) {
          // Lobbies created by the previous version had no assignments before start.
          game = await store.update(code, current => {
            if (!current) missing();
            const guest = current.players[player.id];
            if (needsLobbyMissions(current, guest)) fillMissionSlots(current, guest);
            return current;
          });
        }
        return send(response, 200, view(game, auth));
      }
      if (action !== 'qr') fail(405, 'Method not allowed.');
      if (!joiningOpen(game, status(game))) fail(409, 'Joining is closed.');
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

function addReport(game, report) {
  game.events.push({ sequence: ++game.sequence, ...report });
  if (game.events.length > 30) game.events.shift();
}

function updateGame(game, action, auth, input) {
  if (action === 'join') {
    const phase = status(game);
    if (!joiningOpen(game, phase)) fail(409, 'Joining is closed.');
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name || name.length > 24) fail(400, 'Enter a name between 1 and 24 characters.');
    const id = Object.keys(game.players).length + 1;
    const avatar = input.avatar;
    if (avatar !== undefined) {
      if (!avatarIds.has(avatar)) fail(400, 'Choose a valid avatar.');
      if (Object.values(game.players).some(guest => guest.avatar === avatar)) {
        fail(409, 'Another agent claimed that avatar. Choose a different one.');
      }
    }
    const player = { id, name, ...registerIdentity(game, input, fail), ...(avatar ? { avatar } : {}), token: token(), family: input.family === true, score: 0, completed: 0, assignments: [] };
    game.players[id] = player;
    fillMissionSlots(game, player);
    if (active(player).length < 3) fail(409, 'There are fewer than three available missions for this selection.');
    return { status: 201, data: { token: player.token, ...view(game, player.token) } };
  }
  if (action === 'mission') {
    const player = Object.values(game.players).find(item => item.token === auth);
    if (!player) fail(403, 'Join this game to update missions.');
    const phase = status(game);
    if (!joiningOpen(game, phase)) fail(409, 'Scoring is closed.');
    const assignment = active(player).find(item => item.assignmentId === input.assignmentId);
    if (!assignment) fail(409, 'That mission has already been updated.');
    const mission = details(assignment);
    if (input.result === 'completed') {
      assignment.state = 'completed';
      player.score += mission.points;
      player.completed++;
      addReport(game, {
        name: player.name, points: mission.points, title: mission.title, description: mission.description,
      });
    } else if (input.result === 'sniffed') {
      assignment.state = 'sniffed';
      player.score -= sniffedPenalty;
    } else if (input.result === 'abandoned') {
      assignment.state = 'abandoned';
      player.score -= 25;
    } else {
      fail(400, 'Invalid mission result.');
    }
    if (phase === 'open') deal(game, player);
  } else if (action === 'codeword-mission' || action === 'record-codeword') {
    const player = Object.values(game.players).find(item => item.token === auth);
    if (!player) fail(403, 'Join this game to use codewords.');
    if (status(game) !== 'open') fail(409, 'The game is closed.');
    if (action === 'codeword-mission') {
      issueCodeword(game, player, fail);
    } else {
      const { delivered, reward, report } = recordCodeword(game, player, input.phrase, fail);
      if (report) addReport(game, report);
      return { status: 200, data: { ...view(game, auth), receipt: { delivered, reward } } };
    }
  } else if (action === 'identity-open') {
    if (auth !== game.host) fail(403, 'Only the game leader can open the identity round.');
    if (status(game) !== 'open') fail(409, 'The game is closed.');
    if (game.requiresStart) fail(409, 'The identity roster was set when the game started.');
    openIdentityRound(game, fail);
  } else if (action === 'guess') {
    const player = Object.values(game.players).find(item => item.token === auth);
    if (!player) fail(403, 'Join this game to submit a guess.');
    if (status(game) !== 'open') fail(409, 'Identity guessing is closed.');
    saveGuesses(game, player, input.guesses, fail);
  } else if (action === 'start') {
    if (auth !== game.host) fail(403, 'Only the game leader can start this game.');
    if (status(game) !== 'lobby') fail(409, 'This game is no longer in the lobby.');
    const now = Date.now();
    if (now >= game.cutoff) fail(409, 'The cutoff has passed. Create a new game with a later cutoff.');
    const players = Object.values(game.players);
    if (players.length < minimumAgents) fail(409, `Wait for at least ${minimumAgents} agents to join.`);
    for (const player of players) fillMissionSlots(game, player);
    if (players.filter(player => player.identityId).length >= minimumAgents) openIdentityRound(game, fail);
    game.startedAt = now;
  } else if (action === 'cancel') {
    if (auth !== game.host) fail(403, 'Only the game leader can cancel this game.');
    if (status(game) === 'revealed') fail(409, 'This game has already ended.');
    game.canceledAt ||= Date.now();
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
