import { randomUUID } from 'node:crypto';

const points = 600;

export function registerIdentity(game, input, fail) {
  if (input.realName === undefined) return {};
  const realName = typeof input.realName === 'string' ? input.realName.trim().replace(/\s+/g, ' ') : '';
  if (!realName || realName.length > 40) fail(400, 'Enter a real name between 1 and 40 characters.');
  if (Object.values(game.players).some(player => player.realName?.toLowerCase() === realName.toLowerCase())) {
    fail(409, 'That real name is already in use. Add a last initial to distinguish it.');
  }
  return { realName, identityId: randomUUID() };
}

export function openIdentityRound(game, fail) {
  if (game.identityRoster) fail(409, 'The identity round is already open.');
  const roster = Object.values(game.players).filter(player => player.identityId);
  if (roster.length < 3) fail(409, 'At least three agents with real names must join first.');
  game.identityRoster = roster.map(player => player.id);
}

export function saveGuesses(game, player, input, fail) {
  if (!game.identityRoster?.includes(player.id)) fail(403, 'You are outside this identity round.');
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'Submit a set of identity guesses.');
  const opponents = game.identityRoster.filter(id => id !== player.id);
  const agentIds = new Set(opponents.map(String));
  const nameIds = new Set(opponents.map(id => game.players[id].identityId));
  const used = new Set();
  for (const [agentId, identityId] of Object.entries(input)) {
    if (!agentIds.has(agentId) || !nameIds.has(identityId)) fail(400, 'Choose another agent and a real name from the list.');
    if (used.has(identityId)) fail(409, 'Use each real name only once.');
    used.add(identityId);
  }
  player.identityGuesses = input;
}

export function identityScore(game, player) {
  const correct = (game.identityRoster || []).filter(id =>
    player.identityGuesses?.[id] === game.players[id].identityId
  ).length;
  return { identified: correct, identityXp: correct * points };
}

export function identityView(game, player, revealed) {
  const roster = game.identityRoster || [];
  const eligible = Boolean(player && roster.includes(player.id));
  return {
    opened: Boolean(game.identityRoster), eligible, points,
    readyCount: Object.values(game.players).filter(guest => guest.identityId).length,
    ...(eligible ? {
      agentIds: roster.filter(id => id !== player.id),
      choices: roster.filter(id => id !== player.id).map(id => game.players[id])
        .map(({ identityId, realName }) => ({ id: identityId, name: realName }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      guesses: player.identityGuesses || {},
      ...(revealed ? { matches: roster.map(id => ({
        agentId: id, realName: game.players[id].realName, correct: player.identityGuesses?.[id] === game.players[id].identityId,
      })) } : {}),
    } : {}),
  };
}
