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

// Additive migrations (safe to re-run)
try { db.exec('ALTER TABLE agents ADD COLUMN source TEXT DEFAULT NULL'); } catch (e) { /* already exists */ }

// Activity log for recruiter dashboard
db.exec(`
  CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_name TEXT NOT NULL,
    action_type TEXT NOT NULL,
    details TEXT,
    platform TEXT DEFAULT 'moltbook',
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at DESC);
`);

// Bounty system tables
db.exec(`
  CREATE TABLE IF NOT EXISTS bounties (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL CHECK(type IN ('recruiting', 'battle_win', 'hill_defense', 'top_roast', 'custom')),
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    amount TEXT NOT NULL,
    currency TEXT NOT NULL CHECK(currency IN ('USDC', 'CLAW')),
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'claimed', 'paid', 'expired', 'cancelled')),
    winner_id INTEGER REFERENCES agents(id),
    created_by INTEGER REFERENCES agents(id),
    trigger_id INTEGER,
    is_auto INTEGER DEFAULT 0,
    max_claims INTEGER DEFAULT 1,
    current_claims INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT,
    paid_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_bounties_status ON bounties(status);
  CREATE INDEX IF NOT EXISTS idx_bounties_type ON bounties(type);

  CREATE TABLE IF NOT EXISTS bounty_claims (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bounty_id INTEGER NOT NULL REFERENCES bounties(id),
    agent_id INTEGER NOT NULL REFERENCES agents(id),
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'eligible', 'wallet_required', 'paid', 'rejected', 'failed')),
    bankr_job_id TEXT,
    payout_amount TEXT,
    payout_currency TEXT,
    claimed_at TEXT DEFAULT (datetime('now')),
    paid_at TEXT,
    error_message TEXT,
    UNIQUE(bounty_id, agent_id)
  );
  CREATE INDEX IF NOT EXISTS idx_bounty_claims_agent ON bounty_claims(agent_id);

  CREATE TABLE IF NOT EXISTS bounty_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
  );

  -- Seed default bounty config
  INSERT OR IGNORE INTO bounty_config (key, value) VALUES
    ('hill_defense_amount', '5'),
    ('hill_defense_currency', 'USDC'),
    ('dethrone_king_amount', '10'),
    ('dethrone_king_currency', 'USDC'),
    ('top_roast_daily_amount', '2'),
    ('top_roast_daily_currency', 'USDC'),
    ('recruiting_amount', '1'),
    ('recruiting_currency', 'USDC'),
    ('recruiting_min_activity', '3');
`);

module.exports = db;

// Load Sims RPG schema (after db export so sims/schema.js can require('../db'))
require('./sims/schema');
