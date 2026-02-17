const db = require('../db');

// --- Sims RPG Tables ---

db.exec(`
  CREATE TABLE IF NOT EXISTS sims_profiles (
    agent_id INTEGER PRIMARY KEY REFERENCES agents(id),
    energy INTEGER DEFAULT 80,
    hunger INTEGER DEFAULT 70,
    social INTEGER DEFAULT 60,
    fun INTEGER DEFAULT 50,
    clout INTEGER DEFAULT 30,
    hygiene INTEGER DEFAULT 90,
    simcoins INTEGER DEFAULT 100,
    current_location TEXT DEFAULT 'arena',
    current_activity TEXT DEFAULT 'idle',
    mood TEXT DEFAULT 'neutral',
    x_handle TEXT,
    x_avatar_url TEXT,
    x_banner_url TEXT,
    x_bio TEXT,
    x_scraped_at TEXT,
    trait_openness REAL DEFAULT 0.5,
    trait_conscientiousness REAL DEFAULT 0.5,
    trait_extraversion REAL DEFAULT 0.5,
    trait_agreeableness REAL DEFAULT 0.5,
    trait_neuroticism REAL DEFAULT 0.5,
    character_color TEXT DEFAULT '#FF6B35',
    character_accessory TEXT DEFAULT 'none',
    last_tick_at TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sims_skills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id INTEGER NOT NULL REFERENCES agents(id),
    skill_name TEXT NOT NULL CHECK(skill_name IN ('roasting', 'coding', 'trolling', 'diplomacy', 'trading')),
    level INTEGER DEFAULT 1,
    xp INTEGER DEFAULT 0,
    xp_to_next INTEGER DEFAULT 100,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(agent_id, skill_name)
  );

  CREATE TABLE IF NOT EXISTS sims_relationships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_a_id INTEGER NOT NULL REFERENCES agents(id),
    agent_b_id INTEGER NOT NULL REFERENCES agents(id),
    friendship INTEGER DEFAULT 0,
    rivalry INTEGER DEFAULT 0,
    interaction_count INTEGER DEFAULT 0,
    last_interaction TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(agent_a_id, agent_b_id),
    CHECK(agent_a_id < agent_b_id)
  );
  CREATE INDEX IF NOT EXISTS idx_sims_rel_a ON sims_relationships(agent_a_id);
  CREATE INDEX IF NOT EXISTS idx_sims_rel_b ON sims_relationships(agent_b_id);

  CREATE TABLE IF NOT EXISTS sims_properties (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id INTEGER NOT NULL REFERENCES agents(id),
    plot_x INTEGER NOT NULL,
    plot_y INTEGER NOT NULL,
    house_style TEXT DEFAULT 'starter',
    house_level INTEGER DEFAULT 1,
    purchased_at TEXT DEFAULT (datetime('now')),
    UNIQUE(agent_id),
    UNIQUE(plot_x, plot_y)
  );

  CREATE TABLE IF NOT EXISTS sims_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT DEFAULT '',
    category TEXT NOT NULL CHECK(category IN ('furniture', 'decoration', 'food', 'entertainment', 'hygiene', 'clothing')),
    price INTEGER NOT NULL,
    need_target TEXT,
    need_boost INTEGER DEFAULT 0,
    skill_target TEXT,
    skill_xp_bonus INTEGER DEFAULT 0,
    model_id TEXT DEFAULT 'default',
    rarity TEXT DEFAULT 'common' CHECK(rarity IN ('common', 'uncommon', 'rare', 'legendary'))
  );

  CREATE TABLE IF NOT EXISTS sims_inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id INTEGER NOT NULL REFERENCES agents(id),
    item_id INTEGER NOT NULL REFERENCES sims_items(id),
    quantity INTEGER DEFAULT 1,
    placed_in_property INTEGER DEFAULT 0,
    position_x REAL,
    position_y REAL,
    position_z REAL,
    acquired_at TEXT DEFAULT (datetime('now')),
    UNIQUE(agent_id, item_id)
  );

  CREATE TABLE IF NOT EXISTS sims_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id INTEGER NOT NULL REFERENCES agents(id),
    event_type TEXT NOT NULL CHECK(event_type IN ('viral_tweet', 'drama', 'collab', 'burnout', 'windfall', 'prank', 'mentorship', 'beef')),
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    effects TEXT NOT NULL,
    resolved INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_sims_events_agent ON sims_events(agent_id);

  CREATE TABLE IF NOT EXISTS sims_action_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id INTEGER NOT NULL REFERENCES agents(id),
    action_type TEXT NOT NULL,
    details TEXT,
    needs_delta TEXT,
    skill_delta TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_sims_action_agent ON sims_action_log(agent_id);

  CREATE TABLE IF NOT EXISTS sims_x_tweets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id INTEGER NOT NULL REFERENCES agents(id),
    tweet_text TEXT NOT NULL,
    tweet_date TEXT,
    likes INTEGER DEFAULT 0,
    retweets INTEGER DEFAULT 0,
    scraped_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_sims_tweets_agent ON sims_x_tweets(agent_id);
`);

// Seed default items
const seedItems = [
  // Food
  [1, 'Instant Ramen', 'Quick and questionable nutrition', 'food', 10, 'hunger', 20, null, 0, 'ramen', 'common'],
  [2, 'Lobster Dinner', 'The irony is not lost on anyone', 'food', 50, 'hunger', 50, null, 0, 'lobster', 'uncommon'],
  [3, 'Energy Drink', 'Liquid motivation', 'food', 15, 'energy', 25, null, 0, 'energy_drink', 'common'],
  [4, 'Protein Shake', 'Gains for days', 'food', 20, 'hunger', 30, null, 0, 'protein', 'common'],
  // Entertainment
  [5, 'Gaming Console', 'For when the arena gets boring', 'entertainment', 200, 'fun', 35, null, 0, 'console', 'uncommon'],
  [6, 'Punching Bag', 'Take your frustrations out properly', 'entertainment', 100, 'fun', 25, null, 0, 'punching_bag', 'common'],
  [7, 'DJ Deck', 'Drop beats, not bars', 'entertainment', 500, 'fun', 45, null, 0, 'dj_deck', 'rare'],
  // Furniture
  [8, 'Bed', 'Essential for energy recovery', 'furniture', 150, 'energy', 40, null, 0, 'bed', 'common'],
  [9, 'Couch', 'Comfy spot to socialize', 'furniture', 120, 'social', 15, null, 0, 'couch', 'common'],
  [10, 'Desk', 'Where the magic happens', 'furniture', 100, null, 0, 'coding', 10, 'desk', 'common'],
  // Hygiene
  [11, 'Shower', 'Basic hygiene unit', 'hygiene', 100, 'hygiene', 50, null, 0, 'shower', 'common'],
  [12, 'Golden Toilet', 'Peak decadence', 'hygiene', 5000, 'hygiene', 80, null, 0, 'gold_toilet', 'legendary'],
  // Decoration
  [13, 'Trophy Case', 'Display your battle victories', 'decoration', 300, 'clout', 15, null, 0, 'trophy_case', 'uncommon'],
  [14, 'Neon Sign', 'Your name in lights', 'decoration', 500, 'clout', 25, null, 0, 'neon_sign', 'rare'],
  [15, 'Wall Art', 'Abstract roast interpretations', 'decoration', 80, 'fun', 5, null, 0, 'wall_art', 'common'],
  // Clothing
  [16, 'Flame Hat', 'For the hottest roasters', 'clothing', 200, 'clout', 10, null, 0, 'flame_hat', 'uncommon'],
  [17, 'Crown', 'Only for hill kings', 'clothing', 1000, 'clout', 30, null, 0, 'crown', 'legendary'],
  [18, 'Sunglasses', 'Too cool for school', 'clothing', 50, 'clout', 5, null, 0, 'sunglasses', 'common'],
];

const insertItem = db.prepare(`
  INSERT OR IGNORE INTO sims_items (id, name, description, category, price, need_target, need_boost, skill_target, skill_xp_bonus, model_id, rarity)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

for (const item of seedItems) {
  insertItem.run(...item);
}

// Safe migrations for agent AI
try { db.exec("ALTER TABLE sims_profiles ADD COLUMN target_location TEXT DEFAULT NULL"); } catch(e) {}
try { db.exec("ALTER TABLE sims_profiles ADD COLUMN action_ticks_remaining INTEGER DEFAULT 0"); } catch(e) {}

// --- Initiative System Tables ---
db.exec(`
  CREATE TABLE IF NOT EXISTS sims_initiatives (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    creator_id INTEGER NOT NULL REFERENCES agents(id),
    target_id INTEGER REFERENCES agents(id),
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'pending',
    wager INTEGER DEFAULT 0,
    location TEXT,
    skill TEXT,
    result TEXT,
    tick_created INTEGER DEFAULT 0,
    expires_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    resolved_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_sims_init_status ON sims_initiatives(status);
  CREATE INDEX IF NOT EXISTS idx_sims_init_creator ON sims_initiatives(creator_id);

  CREATE TABLE IF NOT EXISTS sims_crews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    motto TEXT,
    leader_id INTEGER NOT NULL REFERENCES agents(id),
    color TEXT DEFAULT '#ff6b35',
    reputation INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    dissolved_at TEXT
  );

  CREATE TABLE IF NOT EXISTS sims_crew_members (
    crew_id INTEGER NOT NULL REFERENCES sims_crews(id),
    agent_id INTEGER NOT NULL REFERENCES agents(id),
    role TEXT DEFAULT 'member',
    joined_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (crew_id, agent_id)
  );
  CREATE INDEX IF NOT EXISTS idx_sims_crew_mem_agent ON sims_crew_members(agent_id);

  CREATE TABLE IF NOT EXISTS sims_goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id INTEGER NOT NULL REFERENCES agents(id),
    type TEXT NOT NULL,
    description TEXT,
    target_value INTEGER,
    current_value INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_sims_goals_agent ON sims_goals(agent_id);

  CREATE TABLE IF NOT EXISTS sims_memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id INTEGER NOT NULL REFERENCES agents(id),
    event_type TEXT NOT NULL,
    related_agent_id INTEGER,
    description TEXT,
    sentiment REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_sims_memory_agent ON sims_memory(agent_id);
`);

// --- World Building Tables ---
db.exec(`
  CREATE TABLE IF NOT EXISTS sims_structures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id INTEGER NOT NULL REFERENCES agents(id),
    type TEXT NOT NULL CHECK(type IN ('banner', 'statue', 'vendor_stall', 'training_post', 'graffiti_wall')),
    name TEXT NOT NULL,
    location TEXT NOT NULL,
    x REAL,
    z REAL,
    color TEXT DEFAULT '#ff6b35',
    crew_id INTEGER,
    health INTEGER DEFAULT 100,
    built_at TEXT DEFAULT (datetime('now')),
    decay_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_sims_struct_location ON sims_structures(location);
  CREATE INDEX IF NOT EXISTS idx_sims_struct_agent ON sims_structures(agent_id);

  CREATE TABLE IF NOT EXISTS sims_territory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    crew_id INTEGER NOT NULL REFERENCES sims_crews(id),
    location TEXT NOT NULL,
    color TEXT DEFAULT '#ff6b35',
    claimed_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sims_territory_crew ON sims_territory(crew_id);
`);

// Auto-seed sims profiles for all agents that don't have one yet
const COLORS = ['#FF6B35', '#E74C3C', '#3498DB', '#2ECC71', '#9B59B6', '#F39C12', '#1ABC9C', '#E91E63', '#00BCD4', '#FF5722'];
const ACCESSORIES = ['none', 'none', 'none', 'sunglasses', 'flame_hat', 'none'];
const unseeded = db.prepare(`
  SELECT a.id FROM agents a LEFT JOIN sims_profiles sp ON a.id = sp.agent_id WHERE sp.agent_id IS NULL
`).all();

if (unseeded.length > 0) {
  const insertProfile = db.prepare(`
    INSERT OR IGNORE INTO sims_profiles (agent_id, character_color, character_accessory,
      trait_openness, trait_conscientiousness, trait_extraversion, trait_agreeableness, trait_neuroticism)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertSkill = db.prepare('INSERT OR IGNORE INTO sims_skills (agent_id, skill_name) VALUES (?, ?)');
  const SKILL_NAMES = ['roasting', 'coding', 'trolling', 'diplomacy', 'trading'];

  const seedAll = db.transaction(() => {
    for (const { id } of unseeded) {
      const color = COLORS[id % COLORS.length];
      const acc = ACCESSORIES[id % ACCESSORIES.length];
      insertProfile.run(id, color, acc,
        +(0.3 + Math.random() * 0.5).toFixed(2),
        +(0.3 + Math.random() * 0.5).toFixed(2),
        +(0.3 + Math.random() * 0.5).toFixed(2),
        +(0.3 + Math.random() * 0.5).toFixed(2),
        +(0.3 + Math.random() * 0.5).toFixed(2)
      );
      for (const skill of SKILL_NAMES) {
        insertSkill.run(id, skill);
      }
    }
  });
  seedAll();
  console.log(`Auto-seeded ${unseeded.length} agents into Sims world`);
}

console.log('Sims RPG schema initialized');
