import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { gameHandler } from '../game.js';
import { avatars } from '../public/avatars.js';
import { missions } from '../missions.js';

test('mission deck has 451 unique assignments and a family selection', () => {
  assert.equal(missions.length, 451);
  assert.equal(new Set(missions.map(mission => mission.description)).size, missions.length);
  assert.ok(missions.filter(mission => mission.family).length >= 100);
  assert.equal(missions.filter(mission => mission.targeted).length, 40);
});

test('avatar catalog offers 30 distinct badges with WebP artwork', async () => {
  assert.equal(avatars.length, 30);
  for (const key of ['id', 'name']) {
    assert.equal(new Set(avatars.map(avatar => avatar[key])).size, avatars.length);
  }
  const images = await Promise.all(avatars.map(({ id }) => readFile(new URL(`../public/art/${id}.webp`, import.meta.url))));
  for (const image of images) assert.equal(image.toString('ascii', 8, 12), 'WEBP');
  assert.equal(new Set(images.map(image => image.toString('base64'))).size, avatars.length);
});

test('host, guests, and TV share scores while missions stay private until reveal', { timeout: 15000 }, async t => {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const dir = await mkdtemp(join(tmpdir(), 'gobble-test-'));
  let child;
  async function start() {
    child = spawn(process.execPath, ['server.js'], {
      env: { ...process.env, PORT: String(port), GOBBLE_DATA_DIR: dir },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    for await (const chunk of child.stdout) {
      if (chunk.toString().includes('is listening')) return;
    }
    throw new Error('Game server exited during startup');
  }
  async function stop() {
    if (child?.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
  }
  t.after(async () => {
    await stop();
    await rm(dir, { recursive: true, force: true });
  });
  await start();
  const origin = 'http://127.0.0.1:' + port;
  const gameRequest = async (path, auth, data, expected = 200) => {
    const response = await fetch(origin + '/api/games' + path, {
      method: data ? 'POST' : 'GET',
      headers: { ...(auth ? { Authorization: 'Bearer ' + auth } : {}), 'Content-Type': 'application/json' },
      body: data ? JSON.stringify(data) : undefined,
    });
    assert.equal(response.status, expected, await response.clone().text());
    return response.json();
  };

  const cutoff = Date.now() + 2300;
  const host = await gameRequest('', null, { cutoff }, 201);
  const path = '/' + host.code;
  assert.equal(host.phase, 'lobby');
  assert.equal(host.canStart, false);
  assert.equal(host.joinOpen, true);
  await gameRequest(path + '/start', host.token, {}, 409);
  const qr = await fetch(origin + '/api/games' + path + '/qr');
  assert.equal(qr.headers.get('content-type'), 'image/png');
  assert.equal(Buffer.from(await qr.arrayBuffer()).subarray(1, 4).toString(), 'PNG');
  const [waitingMaya, waitingAlex] = await Promise.all([
    gameRequest(path + '/join', null, { name: 'Maya', realName: 'Morgan W', family: true, avatar: 'turkey' }, 201),
    gameRequest(path + '/join', null, { name: 'Alex', realName: 'Avery C' }, 201),
  ]);
  assert.equal(waitingMaya.player.missions.length, 3);
  assert.equal(waitingAlex.player.missions.length, 3);
  const warmup = waitingAlex.player.missions[0];
  const warmedUp = await gameRequest(path + '/mission', waitingAlex.token, {
    assignmentId: warmup.assignmentId, result: 'completed',
  });
  assert.equal(warmedUp.phase, 'lobby');
  assert.equal(warmedUp.player.score, warmup.points);
  assert.equal(warmedUp.player.completed, 1);
  assert.deepEqual(warmedUp.player.missions, waitingAlex.player.missions.slice(1));
  assert.equal(waitingMaya.player.avatar, 'turkey');
  await gameRequest(path + '/start', waitingMaya.token, {}, 403);
  await gameRequest(path + '/codeword-mission', waitingMaya.token, {}, 409);
  await gameRequest(path + '/join', null, { name: 'Guest', avatar: 'unknown' }, 400);
  const claim = name => fetch(origin + '/api/games' + path + '/join', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, avatar: 'fox', realName: 'Blake R' }),
  });
  const claims = await Promise.all([claim('Blair'), claim('Casey')]);
  assert.deepEqual(claims.map(response => response.status).sort(), [201, 409]);
  const extra = await claims.find(response => response.status === 201).json();
  assert.equal(waitingMaya.identity.choices, undefined);
  assert.equal((await gameRequest(path, waitingMaya.token)).identity.choices, undefined);
  assert.equal((await gameRequest(path, host.token)).canStart, true);
  await gameRequest(path + '/identity-open', host.token, {}, 409);
  const started = await gameRequest(path + '/start', host.token, {});
  assert.equal(started.phase, 'open');
  assert.equal(started.joinOpen, true);
  assert.equal(started.identity.opened, true);
  const late = await gameRequest(path + '/join', null, { name: 'Late Guest', realName: 'Jules K' }, 201);
  assert.equal(late.player.missions.length, 3);
  assert.equal(late.identity.eligible, false);
  assert.equal(late.identity.choices, undefined);
  await gameRequest(path + '/start', host.token, {}, 409);
  const maya = { ...(await gameRequest(path, waitingMaya.token)), token: waitingMaya.token };
  const alex = { ...(await gameRequest(path, waitingAlex.token)), token: waitingAlex.token };
  assert.deepEqual(maya.player.missions, waitingMaya.player.missions);
  assert.equal(alex.player.missions.length, 3);
  assert.equal(alex.player.score, warmup.points);
  assert.ok(alex.player.missions.every(mission => mission.id !== warmup.id));
  assert.deepEqual(alex.player.missions.slice(0, 2), warmedUp.player.missions);
  const privateRound = (await gameRequest(path, maya.token)).identity;
  assert.deepEqual(privateRound.choices.map(choice => choice.name), ['Avery C', 'Blake R']);
  assert.ok(privateRound.choices.every(choice => Object.keys(choice).length === 2));
  assert.equal(privateRound.matches, undefined);
  assert.equal((await gameRequest(path, host.token)).identity.choices, undefined);
  const avery = privateRound.choices[0].id;
  await gameRequest(path + '/guess', maya.token, { guesses: { [alex.player.id]: avery, [extra.player.id]: avery } }, 409);
  const guessed = await gameRequest(path + '/guess', maya.token, { guesses: { [alex.player.id]: avery } });
  assert.equal(guessed.player.identified, undefined);
  assert.equal(guessed.player.score, 0);
  assert.equal(guessed.identity.matches, undefined);
  const expiringLobby = await gameRequest('', null, { cutoff }, 201);
  const otherGame = await gameRequest('', null, { cutoff }, 201);
  const otherPath = '/' + otherGame.code;
  const sam = await gameRequest(otherPath + '/join', null, { name: 'Sam', avatar: 'fox' }, 201);
  assert.equal(otherGame.canCancel, true);
  assert.equal(sam.canCancel, false);
  await gameRequest(otherPath + '/cancel', sam.token, {}, 403);
  const canceled = await gameRequest(otherPath + '/cancel', otherGame.token, {});
  assert.equal(canceled.phase, 'canceled');
  assert.equal(canceled.canCancel, false);
  assert.equal((await gameRequest(otherPath + '/cancel', otherGame.token, {})).phase, 'canceled');
  await gameRequest(otherPath + '/join', null, { name: 'Guest' }, 409);
  await gameRequest(otherPath + '/mission', sam.token, { assignmentId: 'no-lobby-mission', result: 'completed' }, 409);
  await gameRequest(otherPath + '/guess', sam.token, { guesses: {} }, 409);
  await gameRequest(otherPath + '/codeword-mission', sam.token, {}, 409);
  await gameRequest(otherPath + '/record-codeword', sam.token, { phrase: 'Gravy' }, 409);
  assert.equal((await fetch(origin + '/api/games' + otherPath + '/qr')).status, 409);
  assert.ok(maya.player.missions.every(mission => mission.family));
  const alexMissions = new Set(alex.player.missions.map(mission => mission.missionId));
  assert.ok(maya.player.missions.every(mission => !alexMissions.has(mission.missionId)));
  assert.equal((await gameRequest(path, host.token)).player, null);
  const [first, second, third] = maya.player.missions;
  const update = { assignmentId: first.assignmentId, result: 'completed' };
  const attempts = await Promise.allSettled([
    gameRequest(path + '/mission', maya.token, update),
    gameRequest(path + '/mission', maya.token, update),
  ]);
  const success = attempts.filter(attempt => attempt.status === 'fulfilled');
  assert.equal(success.length, 1);
  assert.equal(attempts.find(attempt => attempt.status === 'rejected').reason.actual, 409);
  const saved = success[0].value;
  assert.equal(saved.player.score, first.points);
  assert.equal(saved.player.missions.length, 3);
  assert.ok(saved.player.missions.every(mission => mission.missionId !== first.missionId && !alexMissions.has(mission.missionId)));
  await gameRequest(path + '/mission', alex.token, { assignmentId: second.assignmentId, result: 'completed' }, 409);
  const abandoned = await gameRequest(path + '/mission', maya.token, { assignmentId: second.assignmentId, result: 'abandoned' });
  assert.equal(abandoned.player.score, first.points - 25);
  const sniffed = await gameRequest(path + '/mission', maya.token, { assignmentId: third.assignmentId, result: 'sniffed' });
  assert.equal(sniffed.player.score, first.points - 75);
  assert.equal(sniffed.player.completed, 1);
  assert.ok(sniffed.player.missions.every(mission => ![first, second, third].some(previous => mission.id === previous.id)));
  const tv = await gameRequest(path);
  assert.equal(tv.player, null);
  assert.equal(tv.standings.filter(player => player.avatar === 'fox').length, 1);
  assert.equal(tv.standings.find(player => player.name === 'Maya').avatar, 'turkey');
  assert.equal(tv.reveal, null);
  assert.equal(tv.identity.choices, undefined);
  assert.ok(!JSON.stringify(tv).includes('Avery C'));
  assert.deepEqual(tv.events, [
    { sequence: 1, name: 'Alex', points: warmup.points, title: warmup.title, description: warmup.description },
    { sequence: 2, name: 'Maya', points: first.points, title: first.title, description: first.description },
  ]);
  assert.equal((await fetch(origin + '/api/games' + path + '/qr')).status, 200);
  await gameRequest(path + '/advance', host.token, { step: 1 }, 409);
  await stop();
  await start();
  const restored = await gameRequest(path, maya.token);
  assert.deepEqual(restored.player, sniffed.player);
  await delay(Math.max(0, cutoff - Date.now() + 30));
  await gameRequest(path + '/mission', maya.token, { assignmentId: restored.player.missions[0].assignmentId, result: 'completed' }, 409);
  await gameRequest(path + '/advance', alex.token, { step: 1 }, 403);
  const expiringPath = '/' + expiringLobby.code;
  const expired = await gameRequest(expiringPath, expiringLobby.token);
  assert.equal(expired.phase, 'lobby');
  assert.equal(expired.joinOpen, false);
  assert.equal(expired.reveal, null);
  await gameRequest(expiringPath + '/start', expiringLobby.token, {}, 409);
  await gameRequest(expiringPath + '/join', null, { name: 'Late Guest' }, 409);
  assert.equal((await gameRequest(expiringPath + '/cancel', expiringLobby.token, {})).phase, 'canceled');
  const afterCutoff = await gameRequest(otherPath);
  assert.equal(afterCutoff.phase, 'canceled');
  assert.equal(afterCutoff.reveal, null);
  assert.equal(afterCutoff.standings[0].score, 0);
  await gameRequest(otherPath + '/advance', otherGame.token, { step: 1 }, 409);
  const reveal = await gameRequest(path);
  assert.equal(reveal.phase, 'revealed');
  await gameRequest(path + '/cancel', host.token, {}, 409);
  assert.equal(reveal.standings[0].identified, 1);
  assert.equal(reveal.standings[0].score, first.points - 75 + 600);
  assert.ok(!JSON.stringify(reveal).includes('Avery C'));
  const privateReveal = await gameRequest(path, maya.token);
  assert.deepEqual(privateReveal.identity.matches.find(match => match.agentId === alex.player.id), {
    agentId: alex.player.id, realName: 'Avery C', correct: true,
  });
  assert.equal((await gameRequest(path, maya.token)).player.score, privateReveal.player.score);
  await gameRequest(path + '/guess', maya.token, { guesses: {} }, 409);
  assert.deepEqual(reveal.reveal[0].missions.slice(0, 3).map(mission => mission.state), ['completed', 'abandoned', 'sniffed']);
  assert.equal((await gameRequest(path + '/advance', host.token, { step: 1 })).revealIndex, 1);
});

test('targeted cards name another joined agent and retain that name when reported', async () => {
  const available = missions.filter(mission => mission.targeted).slice(0, 3);
  const remainingIds = new Set(available.map(mission => mission.id));
  const game = {
    code: 'ABC123', cutoff: Date.now() + 60000, host: 'leader', sequence: 0,
    revealIndex: 0, events: [],
    players: { 1: {
      id: 1, name: 'Carlson', token: 'carlson', score: 0, completed: 0,
      assignments: missions.filter(mission => !remainingIds.has(mission.id))
        .map(mission => ({ missionId: mission.id, state: 'abandoned' })),
    } },
  };
  const handler = gameHandler({ update: (_code, update) => update(game) });
  async function post(action, input, expected, authorization) {
    let result;
    await handler({
      method: 'POST', url: '/api/games/ABC123/' + action, headers: { authorization },
      rawBody: Buffer.from(JSON.stringify(input)),
    }, {
      writeHead(status) { assert.equal(status, expected); },
      end(body) { result = JSON.parse(body); },
    });
    return result;
  }
  const joined = await post('join', { name: 'Maya' }, 201);
  assert.deepEqual(new Set(joined.player.missions.map(mission => mission.id)), remainingIds);
  assert.ok(joined.player.missions.every(mission => mission.description.includes('Agent Carlson (#001)')));
  const first = joined.player.missions[0];
  const completed = await post('mission', { assignmentId: first.assignmentId, result: 'completed' }, 200, 'Bearer ' + joined.token);
  assert.equal(completed.events[0].description, first.description);
  assert.equal(completed.player.missions.length, 2);
});

test('a secret codeword settles once and stays private', async () => {
  const game = {
    code: 'ABC123', cutoff: Date.now() + 60000, host: 'leader', sequence: 0,
    revealIndex: 0, events: [],
    players: Object.fromEntries(['Gravy Boat', 'Night Fox', 'Lockpick'].map((name, index) => [
      index + 1, { id: index + 1, name, token: 'token' + (index + 1), score: 0, completed: 0, assignments: [] },
    ])),
  };
  const handler = gameHandler({ read: () => game, update: (_code, update) => update(game) });
  async function request(action, input, expected, authorization) {
    let result;
    await handler({
      method: input ? 'POST' : 'GET', url: '/api/games/ABC123' + action,
      headers: { authorization }, rawBody: input && Buffer.from(JSON.stringify(input)),
    }, {
      writeHead(status) { assert.equal(status, expected); },
      end(body) { result = JSON.parse(body); },
    });
    return result;
  }
  const issued = await request('/codeword-mission', {}, 200, 'Bearer token1');
  const { phrase, targetId } = issued.codewords.mission;
  assert.equal((await request('/codeword-mission', {}, 200, 'Bearer token1')).codewords.mission.phrase, phrase);
  assert.equal((await request('', null, 200)).codewords, null);
  assert.equal((await request('', null, 200, 'Bearer token' + targetId)).codewords.mission, null);
  await request('/record-codeword', { phrase }, 400, 'Bearer token1');
  const delivered = await request('/record-codeword', { phrase: phrase.toLowerCase().replaceAll(' ', '-') }, 200, 'Bearer token' + targetId);
  assert.deepEqual(delivered.receipt, { delivered: true, reward: 300 });
  assert.equal(game.players[1].score, 300);
  assert.equal(game.players[1].completed, 1);
  assert.equal(game.players[targetId].score, 300);
  assert.ok(!JSON.stringify(delivered.events).includes(phrase));
  await request('/record-codeword', { phrase }, 409, 'Bearer token' + targetId);

  const next = (await request('/codeword-mission', {}, 200, 'Bearer token2')).codewords.mission;
  assert.notEqual(next.phrase, phrase);
  const interceptor = [1, 3].find(id => id !== next.targetId);
  const before = game.players[interceptor].score;
  const senderBefore = game.players[2].score;
  const caught = await request('/record-codeword', { phrase: next.phrase }, 200, 'Bearer token' + interceptor);
  assert.deepEqual(caught.receipt, { delivered: false, reward: 300 });
  assert.equal(game.players[interceptor].score, before + 300);
  assert.equal(game.players[2].score, senderBefore - 150);
  assert.equal((await request('', null, 200, 'Bearer token2')).codewords.mission.outcome, 'intercepted');
  await request('/record-codeword', { phrase: next.phrase }, 409, 'Bearer token' + next.targetId);
  game.cutoff = Date.now() - 1;
  await request('/codeword-mission', {}, 409, 'Bearer token3');
  await request('/record-codeword', { phrase }, 409, 'Bearer token3');
});
