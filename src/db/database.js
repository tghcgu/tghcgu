const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '../../data/murder_mystery.db');

const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS scenarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL DEFAULT 'web',
    creator_id TEXT NOT NULL DEFAULT 'web',
    title TEXT NOT NULL,
    overview TEXT NOT NULL,
    answer TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS characters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scenario_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    secret TEXT NOT NULL,
    is_killer INTEGER DEFAULT 0,
    FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS clues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scenario_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE
  );

  -- フェーズ定義（シナリオごとにカスタマイズ可能）
  -- type: manual | clues_investigated | all_players_ready | vote
  CREATE TABLE IF NOT EXISTS phases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scenario_id INTEGER NOT NULL,
    order_index INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'manual',
    condition_value INTEGER DEFAULT 0,
    on_fail_phase_index INTEGER DEFAULT NULL,
    FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS game_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scenario_id INTEGER NOT NULL,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    gm_id TEXT NOT NULL,
    status TEXT DEFAULT 'waiting',
    phase_index INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (scenario_id) REFERENCES scenarios(id)
  );

  CREATE TABLE IF NOT EXISTS session_players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    character_id INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES game_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (character_id) REFERENCES characters(id)
  );

  CREATE TABLE IF NOT EXISTS votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    phase_index INTEGER NOT NULL DEFAULT 0,
    voter_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES game_sessions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS revealed_clues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    clue_id INTEGER NOT NULL,
    revealed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES game_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (clue_id) REFERENCES clues(id)
  );

  -- all_players_ready 条件用：各フェーズで「準備完了」を押したプレイヤー
  CREATE TABLE IF NOT EXISTS session_ready_players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    phase_index INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES game_sessions(id) ON DELETE CASCADE
  );
`);

// ── デフォルトフェーズ定義 ─────────────────────────────────────────────────
// シナリオにフェーズが定義されていない場合に使用
const DEFAULT_PHASES = [
  { order_index: 0, name: '導入',   description: '各自の役割カードを確認してください。',            type: 'manual',              condition_value: 0, on_fail_phase_index: null },
  { order_index: 1, name: '調査',   description: '/game investigate で手がかりを調査しましょう。',  type: 'clues_investigated',  condition_value: 1, on_fail_phase_index: null },
  { order_index: 2, name: '議論',   description: '情報を整理して犯人を議論してください。',            type: 'manual',              condition_value: 0, on_fail_phase_index: null },
  { order_index: 3, name: '投票',   description: '/game vote で犯人に投票してください。',             type: 'vote',                condition_value: 51, on_fail_phase_index: 2 },
];

// ── Scenario CRUD ──────────────────────────────────────────────────────────

function createScenario({ guild_id, creator_id, title, overview, answer }) {
  const stmt = db.prepare(
    'INSERT INTO scenarios (guild_id, creator_id, title, overview, answer) VALUES (?, ?, ?, ?, ?)'
  );
  const result = stmt.run(guild_id, creator_id, title, overview, answer);
  return result.lastInsertRowid;
}

function getScenario(id) {
  return db.prepare('SELECT * FROM scenarios WHERE id = ?').get(id);
}

function listScenarios(guild_id = null) {
  if (guild_id) {
    return db.prepare("SELECT * FROM scenarios WHERE guild_id = ? OR guild_id = 'web' ORDER BY created_at DESC").all(guild_id);
  }
  return db.prepare('SELECT * FROM scenarios ORDER BY created_at DESC').all();
}

function deleteScenario(id, creator_id) {
  return db.prepare('DELETE FROM scenarios WHERE id = ? AND creator_id = ?').run(id, creator_id);
}

// ── Phase CRUD ─────────────────────────────────────────────────────────────

function addPhase({ scenario_id, order_index, name, description, type = 'manual', condition_value = 0, on_fail_phase_index = null }) {
  const stmt = db.prepare(
    'INSERT INTO phases (scenario_id, order_index, name, description, type, condition_value, on_fail_phase_index) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const result = stmt.run(scenario_id, order_index, name, description, type, condition_value, on_fail_phase_index ?? null);
  return result.lastInsertRowid;
}

function getPhases(scenario_id) {
  const phases = db.prepare('SELECT * FROM phases WHERE scenario_id = ? ORDER BY order_index').all(scenario_id);
  if (phases.length === 0) return DEFAULT_PHASES.map((p, i) => ({ ...p, id: -(i + 1), scenario_id }));
  return phases;
}

function deletePhases(scenario_id) {
  db.prepare('DELETE FROM phases WHERE scenario_id = ?').run(scenario_id);
}

// ── Character CRUD ─────────────────────────────────────────────────────────

function addCharacter({ scenario_id, name, description, secret, is_killer = 0 }) {
  const stmt = db.prepare(
    'INSERT INTO characters (scenario_id, name, description, secret, is_killer) VALUES (?, ?, ?, ?, ?)'
  );
  const result = stmt.run(scenario_id, name, description, secret, is_killer ? 1 : 0);
  return result.lastInsertRowid;
}

function getCharacters(scenario_id) {
  return db.prepare('SELECT * FROM characters WHERE scenario_id = ?').all(scenario_id);
}

function getCharacter(id) {
  return db.prepare('SELECT * FROM characters WHERE id = ?').get(id);
}

// ── Clue CRUD ──────────────────────────────────────────────────────────────

function addClue({ scenario_id, name, description }) {
  const stmt = db.prepare('INSERT INTO clues (scenario_id, name, description) VALUES (?, ?, ?)');
  const result = stmt.run(scenario_id, name, description);
  return result.lastInsertRowid;
}

function getClues(scenario_id) {
  return db.prepare('SELECT * FROM clues WHERE scenario_id = ?').all(scenario_id);
}

function getClue(id) {
  return db.prepare('SELECT * FROM clues WHERE id = ?').get(id);
}

// ── Game Session ───────────────────────────────────────────────────────────

function createSession({ scenario_id, guild_id, channel_id, gm_id }) {
  const stmt = db.prepare(
    'INSERT INTO game_sessions (scenario_id, guild_id, channel_id, gm_id) VALUES (?, ?, ?, ?)'
  );
  const result = stmt.run(scenario_id, guild_id, channel_id, gm_id);
  return result.lastInsertRowid;
}

function getSession(id) {
  return db.prepare('SELECT * FROM game_sessions WHERE id = ?').get(id);
}

function getActiveSession(channel_id) {
  return db
    .prepare("SELECT * FROM game_sessions WHERE channel_id = ? AND status != 'ended' ORDER BY created_at DESC LIMIT 1")
    .get(channel_id);
}

function updateSession(id, fields) {
  const keys = Object.keys(fields);
  const set = keys.map((k) => `${k} = ?`).join(', ');
  const values = keys.map((k) => fields[k]);
  db.prepare(`UPDATE game_sessions SET ${set} WHERE id = ?`).run(...values, id);
}

// ── Session Players ────────────────────────────────────────────────────────

function addPlayer({ session_id, user_id, character_id }) {
  const stmt = db.prepare('INSERT INTO session_players (session_id, user_id, character_id) VALUES (?, ?, ?)');
  const result = stmt.run(session_id, user_id, character_id);
  return result.lastInsertRowid;
}

function getPlayers(session_id) {
  return db
    .prepare(
      `SELECT sp.*, c.name as char_name, c.description as char_desc,
              c.secret as char_secret, c.is_killer
       FROM session_players sp
       JOIN characters c ON sp.character_id = c.id
       WHERE sp.session_id = ?`
    )
    .all(session_id);
}

function getPlayerByUser(session_id, user_id) {
  return db
    .prepare(
      `SELECT sp.*, c.name as char_name, c.description as char_desc,
              c.secret as char_secret, c.is_killer
       FROM session_players sp
       JOIN characters c ON sp.character_id = c.id
       WHERE sp.session_id = ? AND sp.user_id = ?`
    )
    .get(session_id, user_id);
}

function isPlayerInSession(session_id, user_id) {
  return !!db.prepare('SELECT 1 FROM session_players WHERE session_id = ? AND user_id = ?').get(session_id, user_id);
}

// ── Votes ──────────────────────────────────────────────────────────────────

function addVote({ session_id, phase_index, voter_id, target_id }) {
  db.prepare('DELETE FROM votes WHERE session_id = ? AND phase_index = ? AND voter_id = ?').run(session_id, phase_index, voter_id);
  db.prepare('INSERT INTO votes (session_id, phase_index, voter_id, target_id) VALUES (?, ?, ?, ?)').run(session_id, phase_index, voter_id, target_id);
}

function getVotes(session_id, phase_index) {
  return db.prepare('SELECT * FROM votes WHERE session_id = ? AND phase_index = ?').all(session_id, phase_index);
}

// ── Revealed Clues ─────────────────────────────────────────────────────────

function revealClue(session_id, clue_id) {
  const exists = db.prepare('SELECT 1 FROM revealed_clues WHERE session_id = ? AND clue_id = ?').get(session_id, clue_id);
  if (exists) return false;
  db.prepare('INSERT INTO revealed_clues (session_id, clue_id) VALUES (?, ?)').run(session_id, clue_id);
  return true;
}

function getRevealedClues(session_id) {
  return db
    .prepare(
      `SELECT c.* FROM clues c
       JOIN revealed_clues rc ON rc.clue_id = c.id
       WHERE rc.session_id = ?`
    )
    .all(session_id);
}

// ── Ready Players ──────────────────────────────────────────────────────────

function setReady(session_id, phase_index, user_id) {
  const exists = db.prepare('SELECT 1 FROM session_ready_players WHERE session_id = ? AND phase_index = ? AND user_id = ?').get(session_id, phase_index, user_id);
  if (exists) return false;
  db.prepare('INSERT INTO session_ready_players (session_id, phase_index, user_id) VALUES (?, ?, ?)').run(session_id, phase_index, user_id);
  return true;
}

function getReadyPlayers(session_id, phase_index) {
  return db.prepare('SELECT * FROM session_ready_players WHERE session_id = ? AND phase_index = ?').all(session_id, phase_index);
}

module.exports = {
  db,
  createScenario, getScenario, listScenarios, deleteScenario,
  addPhase, getPhases, deletePhases, DEFAULT_PHASES,
  addCharacter, getCharacters, getCharacter,
  addClue, getClues, getClue,
  createSession, getSession, getActiveSession, updateSession,
  addPlayer, getPlayers, getPlayerByUser, isPlayerInSession,
  addVote, getVotes,
  revealClue, getRevealedClues,
  setReady, getReadyPlayers,
};
