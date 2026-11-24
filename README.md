# Operation Gobble

Guests join a Thanksgiving secret-mission game from a phone. The game leader sets up the room, then can join as a regular player with a private dossier.

## Run locally

With Node.js 22 or newer, run:

```sh
npm ci
npm test
npm start
```

Open `http://localhost:3000` to try the demo. Use **Game leader** to create a live game, set the cutoff, and get the join QR code. Choose **Join as a player** to get your own missions. Use **Open TV** to open a separate scoreboard tab, then cast that tab or open the scoreboard on a connected device. Click **Enable sound** on the scoreboard and check the TV's output volume.

For guests on the same Wi-Fi, open the leader page using the computer's LAN address and port 3000 so the QR code points at an address their phones can reach. Set `GOBBLE_PUBLIC_ORIGIN` to the full guest-facing URL if the server needs to override the QR address.

Scoring closes and missions are revealed automatically at cutoff. The leader can advance the featured dossier from the original browser profile. The TV announces each confirmed completion with the objective and XP earned. Players who are caught can mark an active mission **Sniffed out** for a 50 XP penalty and a new draw if the deck has cards left. Every draw is uniform among eligible, unused cards. A targeted mission names another randomly selected joined player. Each mission is used at most once per game, regardless of how it ends. If the deck runs low, players keep their remaining assignments and new players need three eligible missions to join.

The local backend runs as one process and persists games to `.data/games.json`. Use `GOBBLE_DATA_DIR` for a different writable data directory and `PORT` for a different port. Keep the JSON file private and use a persistent local volume if hosting the Node backend remotely.

## GitHub Pages and Firebase

Set **Settings → Pages → Build and deployment → Source** to **GitHub Actions**. The Pages workflow publishes `public/` and defaults to the `gobble` function in Firebase project `savemhq` (region `us-central1`). Set the repository Actions variable `GOBBLE_API_URL` if Firebase reports a different HTTPS endpoint.

For live play, use a Firebase project with a default Firestore database and Blaze billing for Cloud Functions. The API uses Firestore through the function's service account. Review the existing Firestore rules to ensure no browser clients can read or write `gobbleGames`, including through broader wildcard rules. Keep the rest of the project's rules intact. Deploy only this function using an authorized Firebase CLI session:

```sh
firebase deploy --only functions:gobble --project YOUR_PROJECT_ID
```

If Firebase reports a different URL, set `GOBBLE_API_URL` to the deployed function’s base URL and rerun the Pages workflow. No Firebase web app config or service-account key is needed by the browser. Rehearse on the published site using the game leader, two guest browser profiles, and a TV tab before sharing the QR code.
