import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { missions } from '../missions.js';

test('mission deck has around 150 unique assignments and a family selection', () => {
  assert.equal(missions.length, 151);
  assert.equal(new Set(missions.map(mission => mission.description)).size, missions.length);
  assert.ok(missions.filter(mission => mission.family).length >= 100);
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
  const [maya, alex] = await Promise.all([
    gameRequest(path + '/join', null, { name: 'Maya', family: true }, 201),
    gameRequest(path + '/join', null, { name: 'Alex' }, 201),
  ]);
  assert.equal(maya.player.missions.length, 3);
  assert.ok(maya.player.missions.every(mission => mission.family));
  const alexMissions = new Set(alex.player.missions.map(mission => mission.missionId));
  assert.ok(maya.player.missions.every(mission => !alexMissions.has(mission.missionId)));
  assert.equal((await gameRequest(path, host.token)).player, null);
  const [first, second] = maya.player.missions;
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
  const tv = await gameRequest(path);
  assert.equal(tv.player, null);
  assert.equal(tv.reveal, null);
  assert.deepEqual(tv.events, [{ sequence: 1, name: 'Maya', points: first.points }]);
  assert.equal(tv.standings[0].name, 'Maya');
  const qr = await fetch(origin + '/api/games' + path + '/qr');
  assert.equal(qr.headers.get('content-type'), 'image/png');
  assert.equal(Buffer.from(await qr.arrayBuffer()).subarray(1, 4).toString(), 'PNG');
  await gameRequest(path + '/advance', host.token, { step: 1 }, 409);
  await stop();
  await start();
  const restored = await gameRequest(path, maya.token);
  assert.deepEqual(restored.player, abandoned.player);
  await delay(Math.max(0, cutoff - Date.now() + 30));
  await gameRequest(path + '/mission', maya.token, { assignmentId: restored.player.missions[0].assignmentId, result: 'completed' }, 409);
  await gameRequest(path + '/advance', alex.token, { step: 1 }, 403);
  const reveal = await gameRequest(path);
  assert.equal(reveal.phase, 'revealed');
  assert.deepEqual(reveal.reveal[0].missions.slice(0, 2).map(mission => mission.state), ['completed', 'abandoned']);
  assert.equal((await gameRequest(path + '/advance', host.token, { step: 1 })).revealIndex, 1);
});
