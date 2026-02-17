// Build Sims profiles for all 18 agents from production + X API persona building
const TOKEN = process.env.X_API_BEARER_TOKEN || 'AAAAAAAAAAAAAAAAAAAAAGiE7gEAAAAADrj%2Bd03W8%2B74VVQN1YWHLVD6oIw%3DynENNBX42754JGr4U3S88pOFtxCBMj6CCV5Dql2fP6erwTqCJw';
const db = require('../src/db');
const { SKILL_NAMES } = require('../src/sims/constants');
const { analyzeTweets } = require('../src/sims/x-api/personalityAnalyzer');
const { mapTraitsToSims } = require('../src/sims/x-api/traitMapper');

// Verified X handle mappings from search
const X_HANDLES = {
  'ClaudeOpus': 'AnthropicAI',
  'SonnetSharp': 'AnthropicAI',
  'HaikuBurn': 'AnthropicAI',
  'GeminiRoast': 'GoogleDeepMind',
  'GPTorched': 'OpenAI',
  'MistralFire': 'MistralAI',
  'eltociear': 'eltociear',       // Confirmed - GitHub/AI contributor
  'AdamLias': 'AdamLias',         // Confirmed
  // These matched but are likely different people:
  // 'Neo': 'neo',                // VC fund, not the agent
  // 'Tania': 'tania',            // Different person
  // 'Kustos': 'kustos',          // Empty account
  'ClawCrier_CC': null,
  'RoastScout_CC': null,
};

const ACTIVITIES = ['roasting', 'socializing', 'idle', 'flexing', 'training', 'shopping', 'celebrating', 'recovering'];
const LOCATIONS = ['arena', 'social', 'shop', 'cafe', 'gym', 'home', 'arena', 'social'];

async function xFetch(endpoint) {
  const url = `https://api.x.com/2${endpoint}`;
  const res = await fetch(url, {
    headers: { 'Authorization': 'Bearer ' + TOKEN },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`X API ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

function ensureProfile(agentId) {
  const exists = db.prepare('SELECT agent_id FROM sims_profiles WHERE agent_id = ?').get(agentId);
  if (!exists) {
    db.prepare('INSERT OR IGNORE INTO sims_profiles (agent_id) VALUES (?)').run(agentId);
    for (const skill of SKILL_NAMES) {
      db.prepare('INSERT OR IGNORE INTO sims_skills (agent_id, skill_name) VALUES (?, ?)').run(agentId, skill);
    }
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function buildAll() {
  // 1. Sync all agents from production
  console.log('=== Syncing from production ===');
  const res = await fetch('https://roastarena-production.up.railway.app/api/v1/leaderboard?limit=50');
  const { leaderboard } = await res.json();

  for (const agent of leaderboard) {
    // Get full profile from production
    let desc = 'Cooked Claws arena agent';
    let source = null;
    try {
      const profileRes = await fetch(`https://roastarena-production.up.railway.app/api/v1/agents/${agent.name}`);
      if (profileRes.ok) {
        const profile = await profileRes.json();
        desc = profile.description || desc;
        source = profile.source || null;
      }
    } catch (e) {}

    const local = db.prepare('SELECT id FROM agents WHERE name = ?').get(agent.name);
    if (!local) {
      const apiKey = 'roast_' + require('crypto').randomUUID();
      db.prepare('INSERT INTO agents (name, description, api_key, points, rank, source) VALUES (?, ?, ?, ?, ?, ?)')
        .run(agent.name, desc, apiKey, agent.points, agent.rank, source);
      console.log(`  + ${agent.name} (${agent.points} pts, source: ${source || 'sim'})`);
    } else {
      db.prepare('UPDATE agents SET points = ?, rank = ?, description = ? WHERE name = ?')
        .run(agent.points, agent.rank, desc, agent.name);
      console.log(`  ~ ${agent.name} updated (${agent.points} pts)`);
    }
  }

  // 2. Build sims profiles with X data
  console.log('\n=== Building Sims Profiles ===');
  const allAgents = db.prepare('SELECT id, name, description, points, rank FROM agents ORDER BY points DESC').all();
  let xReqs = 0;
  const seenXHandles = new Set(); // Don't fetch same handle twice

  for (let i = 0; i < allAgents.length; i++) {
    const agent = allAgents[i];
    ensureProfile(agent.id);

    const xHandle = X_HANDLES[agent.name];
    let xUser = null;
    let tweets = [];

    if (xHandle === null) {
      console.log(`[${i + 1}] ${agent.name} — internal, personality from description`);
    } else if (xHandle && !seenXHandles.has(xHandle)) {
      console.log(`[${i + 1}] ${agent.name} — fetching @${xHandle}...`);
      seenXHandles.add(xHandle);
      try {
        const userData = await xFetch(`/users/by/username/${xHandle}?user.fields=description,profile_image_url,public_metrics`);
        xUser = userData.data;
        if (xUser) {
          const tweetsData = await xFetch(`/users/${xUser.id}/tweets?max_results=30&tweet.fields=created_at,public_metrics,text&exclude=retweets,replies`);
          tweets = tweetsData.data || [];
          xReqs += 2;
          console.log(`  Found @${xUser.username} (${xUser.public_metrics?.followers_count || 0} followers, ${tweets.length} tweets)`);
        }
        await sleep(1200);
      } catch (e) {
        console.log(`  X API error: ${e.message.slice(0, 80)}`);
      }
    } else if (xHandle && seenXHandles.has(xHandle)) {
      console.log(`[${i + 1}] ${agent.name} — reusing @${xHandle} data`);
    } else {
      // No known handle, try agent name on X
      console.log(`[${i + 1}] ${agent.name} — searching X...`);
      try {
        const userData = await xFetch(`/users/by/username/${agent.name}?user.fields=description,profile_image_url,public_metrics`);
        xUser = userData.data;
        if (xUser) {
          const tweetsData = await xFetch(`/users/${xUser.id}/tweets?max_results=30&tweet.fields=created_at,public_metrics,text&exclude=retweets,replies`);
          tweets = tweetsData.data || [];
          xReqs += 2;
          console.log(`  Found @${xUser.username}: ${(xUser.description || '').slice(0, 60)} (${tweets.length} tweets)`);
        } else {
          console.log(`  Not on X, using description`);
        }
        await sleep(1200);
      } catch (e) {
        console.log(`  Not found on X`);
      }
    }

    // Analyze personality
    let traits;
    if (tweets.length > 0) {
      traits = analyzeTweets(tweets.map(t => t.text));
      // Cache tweets
      db.prepare('DELETE FROM sims_x_tweets WHERE agent_id = ?').run(agent.id);
      for (const t of tweets) {
        db.prepare('INSERT OR IGNORE INTO sims_x_tweets (agent_id, tweet_text, tweet_date, likes, retweets) VALUES (?, ?, ?, ?, ?)')
          .run(agent.id, t.text, t.created_at || null, t.public_metrics?.like_count || 0, t.public_metrics?.retweet_count || 0);
      }
    } else {
      // Personality from agent description
      traits = analyzeTweets([agent.description || '', agent.name]);
      // Add variety
      for (const key of Object.keys(traits)) {
        traits[key] = Math.max(0.1, Math.min(0.9, traits[key] + (Math.random() - 0.5) * 0.3));
      }
    }

    const simsAttrs = mapTraitsToSims(traits, xUser);

    // Update profile
    db.prepare(`
      UPDATE sims_profiles
      SET x_handle = ?, x_avatar_url = ?, x_bio = ?, x_scraped_at = datetime('now'),
          trait_openness = ?, trait_conscientiousness = ?, trait_extraversion = ?,
          trait_agreeableness = ?, trait_neuroticism = ?,
          character_color = ?, character_accessory = ?,
          current_location = ?, current_activity = ?,
          simcoins = ?
      WHERE agent_id = ?
    `).run(
      xHandle || (xUser ? xUser.username : null),
      xUser?.profile_image_url?.replace('_normal', '_400x400') || null,
      xUser?.description || agent.description || null,
      traits.openness, traits.conscientiousness, traits.extraversion,
      traits.agreeableness, traits.neuroticism,
      simsAttrs.character_color, simsAttrs.character_accessory,
      LOCATIONS[i % LOCATIONS.length],
      ACTIVITIES[i % ACTIVITIES.length],
      Math.floor(agent.points * 0.5) + 100,
      agent.id
    );

    console.log(`  -> ${simsAttrs.personality_summary || 'Balanced'} | ${simsAttrs.character_color} | ${simsAttrs.character_accessory}`);
  }

  // 3. Assign properties to top agents
  console.log('\n=== Properties ===');
  const topAgents = db.prepare('SELECT sp.agent_id, a.name, a.points FROM sims_profiles sp JOIN agents a ON sp.agent_id = a.id ORDER BY a.points DESC LIMIT 10').all();
  const styles = ['penthouse', 'mansion', 'mansion', 'modern', 'modern', 'modern', 'starter', 'starter', 'starter', 'starter'];
  for (let i = 0; i < topAgents.length; i++) {
    const existing = db.prepare('SELECT id FROM sims_properties WHERE agent_id = ?').get(topAgents[i].agent_id);
    if (!existing) {
      const px = i % 5;
      const py = Math.floor(i / 5);
      try {
        db.prepare('INSERT INTO sims_properties (agent_id, plot_x, plot_y, house_style, house_level) VALUES (?, ?, ?, ?, ?)')
          .run(topAgents[i].agent_id, px, py, styles[i], Math.min(4, 4 - i));
        console.log(`  ${topAgents[i].name} -> ${styles[i]} at (${px},${py})`);
      } catch (e) { /* plot taken */ }
    }
  }

  // 4. Summary
  console.log('\n=== FINAL SUMMARY ===');
  const profiles = db.prepare(`
    SELECT sp.agent_id, a.name, a.points, a.rank, sp.mood, sp.x_handle, sp.character_color,
           sp.character_accessory, sp.current_location, sp.simcoins,
           ROUND(sp.trait_extraversion, 2) as ext, ROUND(sp.trait_openness, 2) as opn
    FROM sims_profiles sp JOIN agents a ON sp.agent_id = a.id
    ORDER BY a.points DESC
  `).all();

  console.log('');
  console.log('Name'.padEnd(20) + 'X Handle'.padEnd(18) + 'Color'.padEnd(10) + 'Access'.padEnd(14) + 'Location'.padEnd(10) + 'SimCoins');
  console.log('-'.repeat(90));
  for (const p of profiles) {
    console.log(
      p.name.padEnd(20) +
      ('@' + (p.x_handle || 'none')).padEnd(18) +
      p.character_color.padEnd(10) +
      p.character_accessory.padEnd(14) +
      p.current_location.padEnd(10) +
      p.simcoins
    );
  }
  console.log(`\nTotal: ${profiles.length} profiles | X API requests: ${xReqs}`);
  console.log('\nReady! Start the server with: node src/index.js');
}

buildAll().catch(e => console.error('Fatal:', e));
