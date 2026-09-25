/**
 * WORDBOX LIVE — server.js
 * Express + Socket.IO backend. Serves the broadcast view (public/index.html)
 * and a host test panel (public/host.html), and drives the game engine.
 *
 * Local testing: run `npm start`, open http://localhost:3000 (broadcast view,
 * this is what you screen-share) and http://localhost:3000/host.html in a
 * second tab/device to simulate chat guesses, likes, and gifts.
 *
 * Real TikTok Live: set the TIKTOK_USERNAME env var (your TikTok @handle,
 * no @) before starting. Requires you to actually be live. See README.md.
 */

const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Trie, RoundState, nextGridSize, GRID_SEQUENCE } = require('./engine/wordbox-engine');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ---------------------------------------------------------------------------
// Dictionary
// ---------------------------------------------------------------------------
const trie = new Trie();
const wordListPath = path.join(__dirname, 'data', 'wordlist.txt');
const words = fs.readFileSync(wordListPath, 'utf8').split('\n').map(w => w.trim()).filter(Boolean);
trie.loadWordList(words);
console.log(`[wordbox] loaded ${words.length} dictionary words`);

// ---------------------------------------------------------------------------
// Round state
// ---------------------------------------------------------------------------
let round = new RoundState(GRID_SEQUENCE[0], trie);
let roundTransitioning = false;

function serializeRound() {
  const feed = [...round.foundWords.entries()]
    .filter(([, d]) => !d.boost)
    .slice(-10)
    .map(([word, d]) => ({ word, user: d.user, points: d.points, gifted: !!d.gifted }));

  const leaderboard = [...round.leaderboard.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([user, pts]) => ({ user, pts }));

  const giftWords = [...round.foundWords.values()].filter(d => d.boost || d.gifted).length;

  return {
    grid: round.grid,
    n: round.n,
    target: round.target,
    progress: round.foundWords.size,
    giftContribution: giftWords,
    feed,
    leaderboard,
    finished: round.finished,
  };
}

function broadcastState() {
  io.emit('state', serializeRound());
}

function finishRoundAndAdvance() {
  if (roundTransitioning) return;
  roundTransitioning = true;
  const top = round.topPlayer();
  io.emit('round_over', { top, target: round.target, n: round.n });
  const next = nextGridSize(round.n);
  setTimeout(() => {
    round = new RoundState(next, trie);
    roundTransitioning = false;
    io.emit('new_round', { n: round.n, target: round.target });
    broadcastState();
  }, 4500); // pause for the celebration/TTS beat before the next board appears
}

function handleGuess(user, text) {
  const result = round.submitGuess(user, text);
  if (result.accepted) {
    io.emit('guess_result', result);
    broadcastState();
    if (result.roundOver) finishRoundAndAdvance();
  }
  return result;
}

function handleShuffle() {
  round.shuffleBoard();
  io.emit('shuffle', { grid: round.grid });
  broadcastState();
}

function handleSmallGift(user) {
  const result = round.applyGiftBoost(user, 5);
  io.emit('gift_boost', { user, ...result });
  broadcastState();
  if (result.roundOver) finishRoundAndAdvance();
}

function handleBigGift(user) {
  const result = round.applyBigGift(user);
  io.emit('big_gift', { user, ...result });
  broadcastState();
  if (result.roundOver) finishRoundAndAdvance();
}

// ---------------------------------------------------------------------------
// Socket.IO — broadcast view sync + host test-panel controls
// ---------------------------------------------------------------------------
io.on('connection', (socket) => {
  socket.emit('state', serializeRound());

  // These events are only ever sent by public/host.html (your private test
  // panel) — never exposed on the broadcast view itself.
  socket.on('test_chat', ({ user, text }) => {
    const result = handleGuess(user || 'TestViewer', text || '');
    if (!result.accepted) socket.emit('guess_rejected', result);
  });
  socket.on('test_like_burst', () => handleShuffle());
  socket.on('test_small_gift', ({ user }) => handleSmallGift(user || 'TestGifter'));
  socket.on('test_big_gift', ({ user }) => handleBigGift(user || 'TestGifter'));
});

// ---------------------------------------------------------------------------
// Optional: real TikTok Live connection
// Requires `tiktok-live-connector` (already in package.json) and you to
// actually be live under TIKTOK_USERNAME. Safe to leave unset for testing.
//
// tiktok-live-connector v2 ships as an ES module only, so it's loaded here
// with a dynamic import() (works fine from this CommonJS server.js — the
// rest of the file stays require()-based).
// ---------------------------------------------------------------------------
if (process.env.TIKTOK_USERNAME) {
  (async () => {
    try {
      const { TikTokLiveConnection, WebcastEvent, ControlEvent, SignConfig } =
        await import('tiktok-live-connector');

      // Optional: an Euler Stream API key raises the free community rate
      // limit. Not required to connect. Get one at https://www.eulerstream.com
      if (process.env.EULER_API_KEY) {
        SignConfig.apiKey = process.env.EULER_API_KEY;
      }

      const tiktok = new TikTokLiveConnection(process.env.TIKTOK_USERNAME);
      let likesSinceShuffle = 0;

      tiktok.connect()
        .then(state => console.log(`[wordbox] connected to TikTok room ${state.roomId}`))
        .catch(err => console.error('[wordbox] TikTok connect failed:', err.message));

      tiktok.on(WebcastEvent.CHAT, data => {
        const name = data.user?.nickname || data.user?.uniqueId || 'Viewer';
        handleGuess(name, data.comment || '');
      });

      tiktok.on(WebcastEvent.LIKE, data => {
        likesSinceShuffle += data.likeCount || 1;
        if (likesSinceShuffle >= 5000) {
          likesSinceShuffle = 0;
          handleShuffle();
        }
      });

      tiktok.on(WebcastEvent.GIFT, data => {
        const giftType = data.giftDetails?.giftType;
        if (giftType === 1 && !data.repeatEnd) return; // wait out repeatable combo streak
        const giftName = (data.giftDetails?.giftName || '').toLowerCase();
        const name = data.user?.nickname || data.user?.uniqueId || 'Gifter';
        if (giftName.includes('rose')) handleSmallGift(name);
        else if (giftName.includes('galaxy')) handleBigGift(name);
      });

      tiktok.on(WebcastEvent.STREAM_END, () => console.log('[wordbox] TikTok stream ended'));
      tiktok.on(ControlEvent.ERROR, ({ info, exception }) =>
        console.error('[wordbox] TikTok connector error:', info, exception?.message));
    } catch (err) {
      console.warn('[wordbox] tiktok-live-connector unavailable — run `npm install` to enable live mode.', err.message);
    }
  })();
} else {
  console.log('[wordbox] TIKTOK_USERNAME not set — local test mode. Open /host.html to simulate chat/gifts.');
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`[wordbox] running on port ${PORT}`));
