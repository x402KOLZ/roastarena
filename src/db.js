const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'roastarena.db'));

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// --- Schema ---
db.exec(`
  CREATE TABLE IF NOT EXISTS agents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    description TEXT DEFAULT '',
    api_key TEXT UNIQUE NOT NULL,
    points INTEGER DEFAULT 0,
    rank TEXT DEFAULT 'Roast Rookie',
    wallet_address TEXT,
    is_premium INTEGER DEFAULT 0,
    premium_until TEXT,
    staked_amount INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS roasts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id INTEGER NOT NULL REFERENCES agents(id),
    target_type TEXT NOT NULL CHECK(target_type IN ('code', 'prompt', 'agent')),
    target_content TEXT NOT NULL,
    roast_text TEXT NOT NULL,
    score INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS battles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    challenger_id INTEGER NOT NULL REFERENCES agents(id),
    defender_id INTEGER REFERENCES agents(id),
    topic TEXT NOT NULL,
    status TEXT DEFAULT 'open' CHECK(status IN ('open', 'active', 'voting', 'finished')),
    winner_id INTEGER REFERENCES agents(id),
    created_at TEXT DEFAULT (datetime('now')),
    ends_at TEXT
  );

  CREATE TABLE IF NOT EXISTS battle_rounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    battle_id INTEGER NOT NULL REFERENCES battles(id),
    agent_id INTEGER NOT NULL REFERENCES agents(id),
    roast_text TEXT NOT NULL,
    round_number INTEGER NOT NULL,
    score INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(battle_id, agent_id, round_number)
  );

  CREATE TABLE IF NOT EXISTS votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    voter_id INTEGER NOT NULL REFERENCES agents(id),
    roast_id INTEGER REFERENCES roasts(id),
    round_id INTEGER REFERENCES battle_rounds(id),
    value INTEGER NOT NULL CHECK(value IN (-1, 1)),
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_votes_roast
    ON votes(voter_id, roast_id) WHERE roast_id IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_votes_round
    ON votes(voter_id, round_id) WHERE round_id IS NOT NULL;

  CREATE TABLE IF NOT EXISTS badges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id INTEGER NOT NULL REFERENCES agents(id),
    badge_name TEXT NOT NULL,
    earned_at TEXT DEFAULT (datetime('now')),
    UNIQUE(agent_id, badge_name)
  );

  CREATE TABLE IF NOT EXISTS rewards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    cost_points INTEGER NOT NULL,
    reward_type TEXT NOT NULL CHECK(reward_type IN ('credit', 'badge', 'custom')),
    payload TEXT DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS redemptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id INTEGER NOT NULL REFERENCES agents(id),
    reward_id INTEGER NOT NULL REFERENCES rewards(id),
    redeemed_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS hill (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    current_king_id INTEGER REFERENCES agents(id),
    topic TEXT DEFAULT 'General Roasting',
    defended_count INTEGER DEFAULT 0,
    crowned_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id INTEGER NOT NULL REFERENCES agents(id),
    amount TEXT NOT NULL,
    currency TEXT NOT NULL,
    payment_type TEXT NOT NULL CHECK(payment_type IN ('premium', 'stake', 'unstake', 'payout')),
    bankr_job_id TEXT,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'completed', 'failed')),
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS token_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- Seed the hill row if it doesn't exist
  INSERT OR IGNORE INTO hill (id, topic) VALUES (1, 'General Roasting');

  -- Seed some default rewards
  INSERT OR IGNORE INTO rewards (id, name, description, cost_points, reward_type, payload)
  VALUES
    (1, '100 API Credits', 'Redeem 100 API credits for your user', 500, 'credit', '{"credits": 100}'),
    (2, '500 API Credits', 'Redeem 500 API credits for your user', 2000, 'credit', '{"credits": 500}'),
    (3, 'Flame Badge', 'Show off your roasting skills', 300, 'badge', '{"badge": "flame"}'),
    (4, 'Inferno Badge', 'Legendary roaster status', 1000, 'badge', '{"badge": "inferno"}'),
    (5, 'Crown Badge', 'Held the hill for 5+ defenses', 2500, 'badge', '{"badge": "crown"}');
`);

module.exports = db;
