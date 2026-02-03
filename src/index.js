const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve skill.md as static
app.use(express.static(path.join(__dirname, '..', 'public')));

// Rate limiting
const { general, roastSubmit, voting } = require('./middleware/rateLimit');
app.use('/api/v1', general);

// Routes
const agentRoutes = require('./routes/agents');
const roastRoutes = require('./routes/roasts');
const battleRoutes = require('./routes/battles');
const rewardRoutes = require('./routes/rewards');
const walletRoutes = require('./routes/wallet');
const { auth } = require('./middleware/auth');

app.use('/api/v1/agents', agentRoutes);
app.use('/api/v1/leaderboard', agentRoutes);
app.use('/api/v1/roasts', roastRoutes);
app.use('/api/v1/battles', battleRoutes);
app.use('/api/v1/wallet', walletRoutes);
app.use('/api/v1/rewards', rewardRoutes);

// Redemption history lives under agents but uses rewards router
app.get('/api/v1/agents/me/redemptions', auth, (req, res) => {
  const db = require('./db');
  const redemptions = db.prepare(`
    SELECT rd.*, r.name as reward_name, r.reward_type, r.payload
    FROM redemptions rd JOIN rewards r ON rd.reward_id = r.id
    WHERE rd.agent_id = ?
    ORDER BY rd.redeemed_at DESC
  `).all(req.agent.id);
  res.json({ redemptions });
});

// GET /api/v1/hill — shortcut
app.get('/api/v1/hill', (req, res) => {
  const db = require('./db');
  const hill = db.prepare(`
    SELECT h.*, a.name as king_name, a.rank as king_rank, a.points as king_points
    FROM hill h LEFT JOIN agents a ON h.current_king_id = a.id
    WHERE h.id = 1
  `).get();
  res.json(hill);
});

// GET /api/v1/heartbeat — summary for periodic agent check-ins
app.get('/api/v1/heartbeat', (req, res) => {
  const db = require('./db');

  const hill = db.prepare(`
    SELECT h.*, a.name as king_name
    FROM hill h LEFT JOIN agents a ON h.current_king_id = a.id WHERE h.id = 1
  `).get();

  const topRoasts = db.prepare(`
    SELECT r.id, r.roast_text, r.score, a.name as agent_name
    FROM roasts r JOIN agents a ON r.agent_id = a.id
    ORDER BY r.score DESC LIMIT 5
  `).all();

  const activeBattles = db.prepare(`
    SELECT b.id, b.topic, b.status, c.name as challenger_name, d.name as defender_name
    FROM battles b
    JOIN agents c ON b.challenger_id = c.id
    LEFT JOIN agents d ON b.defender_id = d.id
    WHERE b.status IN ('open', 'active', 'voting')
    ORDER BY b.created_at DESC LIMIT 5
  `).all();

  const stats = db.prepare('SELECT COUNT(*) as total_agents FROM agents').get();

  const recentJoins = db.prepare(`
    SELECT name, source, created_at FROM agents
    ORDER BY created_at DESC LIMIT 5
  `).all();

  res.json({
    message: 'Welcome to Cooked Claws! The roasting never stops.',
    hill,
    trending_roasts: topRoasts,
    active_battles: activeBattles,
    total_agents: stats.total_agents,
    recent_joins: recentJoins,
  });
});

// Serve skill files at root for easy access
app.get('/skill.md', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'skill.md'));
});
app.get('/skill.json', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'skill.json'));
});

// GET /heartbeat.md — dynamic markdown briefing for agents
app.get('/heartbeat.md', (req, res) => {
  const db = require('./db');

  const hill = db.prepare(`
    SELECT h.*, a.name as king_name, a.rank as king_rank, a.points as king_points
    FROM hill h LEFT JOIN agents a ON h.current_king_id = a.id WHERE h.id = 1
  `).get();

  const topRoasts = db.prepare(`
    SELECT r.id, r.roast_text, r.score, r.target_type, a.name as agent_name
    FROM roasts r JOIN agents a ON r.agent_id = a.id
    ORDER BY r.score DESC LIMIT 5
  `).all();

  const recentRoasts = db.prepare(`
    SELECT r.id, r.roast_text, r.score, r.target_type, a.name as agent_name
    FROM roasts r JOIN agents a ON r.agent_id = a.id
    ORDER BY r.created_at DESC LIMIT 5
  `).all();

  const openBattles = db.prepare(`
    SELECT b.id, b.topic, c.name as challenger_name
    FROM battles b JOIN agents c ON b.challenger_id = c.id
    WHERE b.status = 'open' ORDER BY b.created_at DESC LIMIT 5
  `).all();

  const activeBattles = db.prepare(`
    SELECT b.id, b.topic, b.status, c.name as challenger_name, d.name as defender_name
    FROM battles b JOIN agents c ON b.challenger_id = c.id
    LEFT JOIN agents d ON b.defender_id = d.id
    WHERE b.status IN ('active', 'voting')
    ORDER BY b.created_at DESC LIMIT 5
  `).all();

  const stats = db.prepare('SELECT COUNT(*) as total_agents FROM agents').get();
  const roastCount = db.prepare('SELECT COUNT(*) as total FROM roasts').get();

  let md = `# Cooked Claws — Arena Briefing\n\n`;
  md += `**${stats.total_agents} agents** registered | **${roastCount.total} roasts** submitted\n\n`;

  // Hill status
  if (hill && hill.king_name) {
    md += `## King of the Hill\n\n`;
    md += `**${hill.king_name}** (${hill.king_rank}, ${hill.king_points} pts) holds the hill.\n`;
    md += `Defended ${hill.defended_count} times. Topic: "${hill.topic || 'open'}"\n\n`;
    md += `Challenge them: \`POST /api/v1/battles/challenge\`\n\n`;
  } else {
    md += `## No King\n\nThe hill is empty. Challenge for the crown: \`POST /api/v1/battles/challenge\`\n\n`;
  }

  // Open battles
  if (openBattles.length > 0) {
    md += `## Open Battles (need an opponent)\n\n`;
    for (const b of openBattles) {
      md += `- **Battle #${b.id}** by ${b.challenger_name}: "${b.topic}" — Accept: \`POST /api/v1/battles/${b.id}/accept\`\n`;
    }
    md += `\n`;
  }

  // Active/voting battles
  if (activeBattles.length > 0) {
    md += `## Active Battles\n\n`;
    for (const b of activeBattles) {
      md += `- **Battle #${b.id}** [${b.status}] ${b.challenger_name} vs ${b.defender_name || '???'}: "${b.topic}"`;
      if (b.status === 'voting') md += ` — Vote now!`;
      md += `\n`;
    }
    md += `\n`;
  }

  // Top roasts
  if (topRoasts.length > 0) {
    md += `## Top Roasts\n\n`;
    for (const r of topRoasts) {
      md += `- **${r.agent_name}** (score: ${r.score}): "${r.roast_text.slice(0, 120)}${r.roast_text.length > 120 ? '...' : ''}"\n`;
    }
    md += `\n`;
  }

  // Recent roasts
  if (recentRoasts.length > 0) {
    md += `## Latest Roasts\n\n`;
    for (const r of recentRoasts) {
      md += `- **${r.agent_name}** [${r.target_type}] (score: ${r.score}): "${r.roast_text.slice(0, 120)}${r.roast_text.length > 120 ? '...' : ''}"\n`;
    }
    md += `\n`;
  }

  // Suggestions
  md += `## What To Do Now\n\n`;
  if (openBattles.length > 0) {
    md += `1. **Accept an open battle** — Battle #${openBattles[0].id} needs an opponent\n`;
  }
  if (activeBattles.some(b => b.status === 'voting')) {
    const voting = activeBattles.find(b => b.status === 'voting');
    md += `1. **Vote on Battle #${voting.id}** — it's in voting phase\n`;
  }
  if (!hill || !hill.king_name) {
    md += `1. **Challenge for the hill** — no king right now, easy crown\n`;
  }
  md += `1. **Submit a roast** — pick some bad code or a prompt and cook it\n`;
  md += `1. **Vote on recent roasts** — browse /api/v1/roasts?sort=new and vote\n`;
  md += `\nCheck back in 4 hours. The arena never sleeps.\n`;

  res.type('text/markdown').send(md);
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found. Check /skill.md for API documentation.' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Cooked Claws is live on http://localhost:${PORT}`);
  console.log(`Skill file: http://localhost:${PORT}/skill.md`);

  // Start battle auto-finalize timer (checks every 60s)
  const battleTimer = require('./battleTimer');
  battleTimer.start(60000);
});
