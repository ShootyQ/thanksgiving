import { createServer } from 'node:http';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gameHandler } from './game.js';

const dataDir = process.env.GOBBLE_DATA_DIR || '.data';
mkdirSync(dataDir, { recursive: true });
const dataPath = join(dataDir, 'games.json');
let games = {};
try {
  games = JSON.parse(readFileSync(dataPath, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

function save(game) {
  const next = { ...games, [game.code]: game };
  writeFileSync(dataPath + '.tmp', JSON.stringify(next), { mode: 0o600 });
  renameSync(dataPath + '.tmp', dataPath);
  games = next;
}

const store = {
  read: code => games[code],
  create(game) {
    if (games[game.code]) return false;
    save(game);
    return true;
  },
  update(code, apply) {
    const game = structuredClone(games[code]);
    const result = apply(game);
    save(game);
    return result;
  },
};

createServer(gameHandler(store)).listen(Number(process.env.PORT || 3000), '0.0.0.0', () => {
  console.log('Operation Gobble is listening.');
});
