import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { gameHandler } from './game.js';

initializeApp();
const firestore = getFirestore();
const ref = code => firestore.collection('gobbleGames').doc(code);
const store = {
  async read(code) {
    return (await ref(code).get()).data();
  },
  async create(game) {
    try {
      await ref(game.code).create(game);
      return true;
    } catch (error) {
      if (error.code === 6) return false;
      throw error;
    }
  },
  update(code, apply) {
    return firestore.runTransaction(async transaction => {
      const doc = ref(code);
      const game = (await transaction.get(doc)).data();
      const result = apply(game);
      transaction.set(doc, game);
      return result;
    });
  },
};

export const gobble = onRequest({ cors: true, maxInstances: 5 }, gameHandler(store));
