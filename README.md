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

## Secret delivery

With at least three agents in the game, each player can claim one private codeword mission from their dossier. Say the full phrase to the named agent in person. The first other player to record it settles the mission. A correct delivery earns both players 300 XP. An interception earns the recipient 300 XP and costs the sender 150 XP. Recording closes at cutoff.

## Identity round

Guests choose a public codename and enter a real name privately. Guests receive three missions when they join the lobby and can start scoring right away. Once at least three guests have joined, the leader can select **Start game**. That refills empty mission slots, enables replacements, and opens identity matching if at least three players registered real names. Guests can still join to play missions, and the identity roster stays fixed. Games created before the lobby was added still use **Open identity round**. Joined agents in that roster use **Identity match** to save guesses and revise them until cutoff. Each correct guess adds 600 XP to the final standings.

At cutoff, the TV highlights the most missions completed and most agents identified. The matched real names are revealed only to the players in the identity round on their own devices.

## GitHub Pages and Firebase

Set **Settings → Pages → Build and deployment → Source** to **GitHub Actions**. The Pages workflow publishes `public/` and defaults to the `gobble` function in Firebase project `savemhq` (region `us-central1`). Set the repository Actions variable `GOBBLE_API_URL` if Firebase reports a different HTTPS endpoint.

For live play, use a Firebase project with a default Firestore database and Blaze billing for Cloud Functions. The API uses Firestore through the function's service account. Review the existing Firestore rules to ensure no browser clients can read or write `gobbleGames`, including through broader wildcard rules. Keep the rest of the project's rules intact. Deploy only this function using an authorized Firebase CLI session:

```sh
firebase deploy --only functions:gobble --project YOUR_PROJECT_ID
```

If Firebase reports a different URL, set `GOBBLE_API_URL` to the deployed function’s base URL and rerun the Pages workflow. No Firebase web app config or service-account key is needed by the browser. Rehearse on the published site using the game leader, two guest browser profiles, and a TV tab before sharing the QR code.
