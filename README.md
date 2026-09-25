# WORDBOX LIVE

Endless, no-timer, Boggle-style letter-grid word game for TikTok Live.
Broadcast a single vertical (9:16) browser tab via TikTok's Mobile Gaming
screen-share — no manual tapping required once a round starts.

## What's in this folder

```
wordbox-live/
├── server.js              Express + Socket.IO game server
├── package.json
├── engine/
│   └── wordbox-engine.js  Grid gen, Trie+DFS validator, scoring, win-condition, gift hooks
├── data/
│   └── wordlist.txt       ~61,700-word English dictionary (one word per line)
└── public/
    ├── index.html         BROADCAST VIEW — this is what you screen-share
    └── host.html          Private test panel to simulate chat/gifts/likes
```

## 1. Run it locally

Requires Node.js 18+.

```bash
cd wordbox-live
npm install
npm start
```

Then open two browser tabs:
- **`http://localhost:3000/`** — the broadcast view (9:16 layout). This is
  the tab you'd eventually screen-share on your Android phone.
- **`http://localhost:3000/host.html`** — a private control panel to
  simulate viewer guesses, a 5k-like shuffle, a Rose gift, and a Galaxy
  gift, so you can see the whole game loop working before ever going live.

Type a word that appears on the grid shown in the host panel into "Word
guess" and submit — you'll see it light up on the broadcast view, land in
the found-words feed, and update the leaderboard in real time.

## 2. Deploy (Render, same pattern as your other TikTok games)

1. Push this folder to a new GitHub repo.
2. In Render: **New → Web Service** → connect the repo.
3. Build command: `npm install`
4. Start command: `npm start`
5. Once deployed, open `https://<your-app>.onrender.com/` on your Android
   phone's browser, add it to your home screen for a clean full-screen
   launch, and screen-share that tab into TikTok Live's Mobile Gaming mode.
6. Open `https://<your-app>.onrender.com/host.html` from a second device
   (or a second tab) any time you want to test without being live.

## 3. Connecting real TikTok Live chat/gifts/likes

By default the server runs in **local test mode** (only `host.html` can
trigger events). To pull real events from a live TikTok stream:

1. Set an environment variable **`TIKTOK_USERNAME`** to your TikTok handle
   (no `@`) — on Render, add it under the service's **Environment** tab.
2. Make sure you are actually live when the server starts (the
   `tiktok-live-connector` package connects to your active room).
3. Redeploy / restart the service. Server logs will show
   `connected to TikTok room ...` once it picks up your stream.
4. Chat comments, likes, and gifts named "Rose" / "Galaxy" now drive the
   game automatically — no need to touch `host.html`.

If you use different gift names, edit the `name.includes('rose')` /
`name.includes('galaxy')` checks near the bottom of `server.js`.

## 4. Tuning knobs

- **Grid size progression** — `GRID_SEQUENCE` in `engine/wordbox-engine.js`
  (defaults to `[4, 5, 6, 7, 8]`; add `9, 10` if your phone renders them
  legibly).
- **Word-count targets per grid size** — `targetForGridSize()` in the same
  file.
- **Scoring** — `scoreForWord()` in the same file.
- **Like threshold for a shuffle** — `likesSinceShuffle >= 5000` in
  `server.js`.
- **Gift boost amount** — the `5` passed to `applyGiftBoost()` calls.
- **Dictionary** — swap `data/wordlist.txt` for any newline-separated word
  list (e.g. trim out obscure words, or add slang you want accepted).
- **Colors / fonts / layout** — CSS variables at the top of
  `public/index.html`.

## 5. Notes

- Round-end announcements use the browser's built-in Web Speech API
  (`speechSynthesis`) for TTS — no external service or API key needed. Voice
  quality depends on the phone/browser; Chrome on Android works well.
- The engine guarantees every generated board contains enough real,
  findable dictionary words to reach its target before it's ever shown —
  see `generateGrid()` in `engine/wordbox-engine.js`.
- `public/host.html` is for your eyes only — never screen-share that tab.
