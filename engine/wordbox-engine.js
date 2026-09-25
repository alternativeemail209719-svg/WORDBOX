/**
 * WORDBOX LIVE — Core Game Engine
 * Grid generation, Trie+DFS word validation, scoring, win-condition, gift hooks.
 * Framework-agnostic Node.js module — plug into an Express/socket.io server
 * and a TikTok Live chat listener (see blueprint.md for wiring).
 */

// ---------------------------------------------------------------------------
// 1. WEIGHTED LETTER GENERATION
// ---------------------------------------------------------------------------

// Approximate English letter frequency (%), used as generation weights.
const LETTER_FREQ = {
  E: 12.7, T: 9.1, A: 8.2, O: 7.5, I: 7.0, N: 6.7, S: 6.3, H: 6.1, R: 6.0,
  D: 4.3, L: 4.0, C: 2.8, U: 2.8, M: 2.4, W: 2.4, F: 2.2, G: 2.0, Y: 2.0,
  P: 1.9, B: 1.5, V: 1.0, K: 0.8, J: 0.15, X: 0.15, Q: 0.10, Z: 0.07
};

// Bump vowels slightly relative to raw frequency so small grids stay solvable
// (pure frequency sampling over-favors consonant clusters on tiny boards).
const VOWEL_BOOST = { A: 1.3, E: 1.3, I: 1.2, O: 1.2, U: 1.15 };

function buildWeightedPool() {
  const pool = [];
  for (const [letter, freq] of Object.entries(LETTER_FREQ)) {
    const weight = Math.round(freq * (VOWEL_BOOST[letter] || 1) * 10);
    for (let i = 0; i < weight; i++) pool.push(letter);
  }
  return pool;
}
const WEIGHTED_POOL = buildWeightedPool();

function randomLetter() {
  return WEIGHTED_POOL[Math.floor(Math.random() * WEIGHTED_POOL.length)];
}

/**
 * Generates an N x N grid, then verifies (via the Trie below) that it
 * contains at least `minWords` valid, formable words before returning it.
 * Regenerates on failure — cheap because DFS over a small board is fast.
 */
function generateGrid(n, trie, minWords = Math.max(20, n * 4)) {
  let attempts = 0;
  while (attempts++ < 200) {
    const grid = Array.from({ length: n }, () =>
      Array.from({ length: n }, () => randomLetter())
    );
    const found = findAllWords(grid, trie);
    if (found.size >= minWords) {
      return { grid, possibleWords: found };
    }
  }
  throw new Error(`Could not generate a viable ${n}x${n} grid after 200 attempts`);
}

// ---------------------------------------------------------------------------
// 2. TRIE (DICTIONARY) + DFS VALIDATION
// ---------------------------------------------------------------------------

class TrieNode {
  constructor() {
    this.children = new Map();
    this.isWord = false;
  }
}

class Trie {
  constructor() {
    this.root = new TrieNode();
  }
  insert(word) {
    let node = this.root;
    for (const ch of word.toUpperCase()) {
      if (!node.children.has(ch)) node.children.set(ch, new TrieNode());
      node = node.children.get(ch);
    }
    node.isWord = true;
  }
  loadWordList(words) {
    for (const w of words) if (w.length >= 3) this.insert(w);
  }
}

const DIRECTIONS = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1],           [0, 1],
  [1, -1],  [1, 0],  [1, 1],
];

/**
 * Checks whether `word` can be traced through adjacent (8-directional) tiles
 * on `grid`, each tile used at most once. Returns the path (list of [r,c])
 * on success, or null.
 */
function findWordPath(grid, word) {
  const n = grid.length;
  const target = word.toUpperCase();
  const visited = Array.from({ length: n }, () => Array(n).fill(false));

  function dfs(r, c, idx, path) {
    if (grid[r][c] !== target[idx]) return null;
    const nextPath = [...path, [r, c]];
    if (idx === target.length - 1) return nextPath;
    visited[r][c] = true;
    for (const [dr, dc] of DIRECTIONS) {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < n && nc >= 0 && nc < n && !visited[nr][nc]) {
        const result = dfs(nr, nc, idx + 1, nextPath);
        if (result) { visited[r][c] = false; return result; }
      }
    }
    visited[r][c] = false;
    return null;
  }

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const path = dfs(r, c, 0, []);
      if (path) return path;
    }
  }
  return null;
}

/** Validates a chat-submitted guess against the dictionary Trie + the grid. */
function isValidGuess(grid, trie, wordRaw) {
  const word = wordRaw.trim().toUpperCase();
  if (word.length < 3) return { valid: false, reason: 'too_short' };
  let node = trie.root;
  for (const ch of word) {
    if (!node.children.has(ch)) return { valid: false, reason: 'not_in_dictionary' };
    node = node.children.get(ch);
  }
  if (!node.isWord) return { valid: false, reason: 'not_in_dictionary' };
  const path = findWordPath(grid, word);
  if (!path) return { valid: false, reason: 'not_on_board' };
  return { valid: true, path, length: word.length };
}

/** Exhaustive DFS from every cell to find every dictionary word on the board
 *  (used at grid-generation time to guarantee solvability and set targets). */
function findAllWords(grid, trie) {
  const n = grid.length;
  const found = new Set();
  const visited = Array.from({ length: n }, () => Array(n).fill(false));

  function dfs(r, c, node, prefix) {
    const ch = grid[r][c];
    const child = node.children.get(ch);
    if (!child) return;
    const word = prefix + ch;
    if (child.isWord && word.length >= 3) found.add(word);
    visited[r][c] = true;
    for (const [dr, dc] of DIRECTIONS) {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < n && nc >= 0 && nc < n && !visited[nr][nc]) {
        dfs(nr, nc, child, word);
      }
    }
    visited[r][c] = false;
  }

  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      dfs(r, c, trie.root, '');

  return found;
}

// ---------------------------------------------------------------------------
// 3. SCORING
// ---------------------------------------------------------------------------

function scoreForWord(word) {
  const len = word.length;
  if (len === 3) return 1;
  if (len === 4) return 2;
  if (len === 5) return 4;
  return 8; // 6+
}

// ---------------------------------------------------------------------------
// 4. WIN CONDITION / ROUND STATE
// ---------------------------------------------------------------------------

/** Target word count scales with grid size — tune freely. */
function targetForGridSize(n) {
  // 4x4 -> 50, scaling roughly with cell count, capped for very large grids.
  return Math.min(300, Math.round(50 * Math.pow(n / 4, 1.5)));
}

class RoundState {
  constructor(n, trie) {
    this.n = n;
    this.trie = trie;
    const { grid, possibleWords } = generateGrid(n, trie);
    this.grid = grid;
    this.possibleWords = possibleWords;      // full solution set for this board
    this.foundWords = new Map();             // word -> { user, points }
    this.target = Math.min(targetForGridSize(n), possibleWords.size);
    this.leaderboard = new Map();            // user -> points
    this.finished = false;
  }

  /** Called for every chat message. Returns a result object for the UI/TTS layer. */
  submitGuess(user, rawText) {
    if (this.finished) return { accepted: false, reason: 'round_over' };
    const word = rawText.trim().toUpperCase();
    if (this.foundWords.has(word)) return { accepted: false, reason: 'already_found' };

    const check = isValidGuess(this.grid, this.trie, word);
    if (!check.valid) return { accepted: false, reason: check.reason };

    const points = scoreForWord(word);
    this.foundWords.set(word, { user, points, path: check.path });
    this.leaderboard.set(user, (this.leaderboard.get(user) || 0) + points);

    if (this.foundWords.size >= this.target) this.finished = true;

    return {
      accepted: true,
      word,
      user,
      points,
      path: check.path,
      progress: this.foundWords.size,
      target: this.target,
      roundOver: this.finished,
    };
  }

  topPlayer() {
    let best = null;
    for (const [user, pts] of this.leaderboard) {
      if (!best || pts > best.pts) best = { user, pts };
    }
    return best;
  }

  // -- Gift / engagement hooks -------------------------------------------

  /** Likes threshold: rearrange same letters into a new layout. */
  shuffleBoard() {
    const flat = this.grid.flat();
    for (let i = flat.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [flat[i], flat[j]] = [flat[j], flat[i]];
    }
    this.grid = Array.from({ length: this.n }, (_, r) =>
      flat.slice(r * this.n, r * this.n + this.n)
    );
    // Re-index solvable words against the new letter layout.
    this.possibleWords = findAllWords(this.grid, this.trie);
  }

  /** Small gift (e.g. Rose): shortcut +5 toward the target, credited to gifter. */
  applyGiftBoost(user, amount = 5) {
    this.leaderboard.set(user, (this.leaderboard.get(user) || 0) + amount);
    const before = this.foundWords.size;
    for (let i = 0; i < amount; i++) {
      // Synthetic entries so the progress bar reflects the boost;
      // does not occupy a real dictionary word so it can't collide with a
      // future genuine chat guess.
      this.foundWords.set(`__boost_${before + i}`, { user, points: 0, boost: true });
    }
    if (this.foundWords.size >= this.target) this.finished = true;
    return { progress: this.foundWords.size, target: this.target, roundOver: this.finished };
  }

  /** Large gift (e.g. Galaxy): auto-solve the 5 longest remaining words. */
  applyBigGift(user) {
    const remaining = [...this.possibleWords]
      .filter(w => !this.foundWords.has(w))
      .sort((a, b) => b.length - a.length)
      .slice(0, 5);
    let pointsAwarded = 0;
    for (const word of remaining) {
      const points = scoreForWord(word);
      pointsAwarded += points;
      this.foundWords.set(word, { user, points, gifted: true });
    }
    this.leaderboard.set(user, (this.leaderboard.get(user) || 0) + pointsAwarded);
    if (this.foundWords.size >= this.target) this.finished = true;
    return { solved: remaining, pointsAwarded, progress: this.foundWords.size,
      target: this.target, roundOver: this.finished };
  }
}

// ---------------------------------------------------------------------------
// 5. GRID SIZE PROGRESSION
// ---------------------------------------------------------------------------

const GRID_SEQUENCE = [4, 5, 6, 7, 8]; // extend to 10 if screen/legibility allows

function nextGridSize(currentN) {
  const idx = GRID_SEQUENCE.indexOf(currentN);
  return GRID_SEQUENCE[(idx + 1) % GRID_SEQUENCE.length];
}

module.exports = {
  Trie,
  RoundState,
  generateGrid,
  findAllWords,
  findWordPath,
  isValidGuess,
  scoreForWord,
  targetForGridSize,
  nextGridSize,
  GRID_SEQUENCE,
};
