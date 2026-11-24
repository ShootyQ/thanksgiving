import { randomInt } from 'node:crypto';

const foods = ['Gravy', 'Turkey', 'Stuffing', 'Cranberry', 'Biscuit', 'Pumpkin', 'Cider', 'Pecan', 'Cornbread', 'Giblet', 'Squash', 'Ginger', 'Cinnamon', 'Turnip', 'Yam', 'Sage', 'Roll', 'Custard'];
const signals = ['Lantern', 'Compass', 'Echo', 'Whistle', 'Radar', 'Cipher', 'Midnight', 'Shadow', 'Satchel', 'Keyhole', 'Beacon', 'Tunnel', 'Footprint', 'Decoy', 'Signal', 'Tophat', 'Pocket', 'Checkpoint'];
const reward = 300;
const penalty = 150;
const normalize = text => text.toLowerCase().replace(/[\s-]+/g, '');

export function codewordView(game, player) {
  if (!player) return null;
  const assignment = player.codeword;
  const target = assignment && game.players[assignment.targetId];
  return {
    ready: Object.keys(game.players).length >= 3, reward, penalty,
    mission: assignment ? {
      phrase: assignment.phrase, target: target.name, targetId: target.id,
      avatar: target.avatar, outcome: assignment.outcome,
    } : null,
  };
}

export function issueCodeword(game, player, fail) {
  if (player.codeword) return;
  const players = Object.values(game.players);
  if (players.length < 3) fail(409, 'Wait for at least three agents to join.');
  const candidates = players.filter(guest => guest.id !== player.id);
  const used = new Set(players.filter(guest => guest.codeword).map(guest => guest.codeword.phrase));
  let phrase;
  do {
    phrase = `${foods[randomInt(foods.length)]} ${signals[randomInt(signals.length)]} ${randomInt(100, 1000)}`;
  } while (used.has(phrase));
  player.codeword = { phrase, targetId: candidates[randomInt(candidates.length)].id, outcome: 'active' };
}

export function recordCodeword(game, receiver, value, fail) {
  const phrase = typeof value === 'string' && value.length <= 48 ? normalize(value) : '';
  const sender = Object.values(game.players).find(player =>
    player.codeword && normalize(player.codeword.phrase) === phrase
  );
  if (!sender) fail(400, 'Codeword not recognized. Ask the agent to repeat the full phrase.');
  if (sender.id === receiver.id) fail(400, 'Another agent must record your codeword.');
  const assignment = sender.codeword;
  if (assignment.outcome !== 'active') fail(409, 'That codeword has already been recorded.');
  const delivered = assignment.targetId === receiver.id;
  assignment.outcome = delivered ? 'delivered' : 'intercepted';
  receiver.score += reward;
  sender.score += delivered ? reward : -penalty;
  if (delivered) sender.completed++;
  return {
    delivered, reward,
    report: delivered ? {
      name: sender.name, points: reward, title: 'Secret delivery',
      description: `Delivered a secret codeword to ${receiver.name}. Both agents earned ${reward} XP.`,
    } : null,
  };
}
