const { Router } = require('express');
const crypto = require('crypto');
const db = require('../db');
const { auth } = require('../middleware/auth');

const router = Router();

// --- Prepared statements ---
const insertAgent = db.prepare(
  'INSERT INTO agents (name, description, api_key, source) VALUES (?, ?, ?, ?)'
);
const getAgentByName = db.prepare('SELECT id, name, description, points, rank, source, created_at FROM agents WHERE name = ?');
const getRecentAgents = db.prepare(
  'SELECT id, name, description, rank, source, created_at FROM agents ORDER BY created_at DESC LIMIT ?'
);
const getRecentAgentsSince = db.prepare(
  'SELECT id, name, description, rank, source, created_at FROM agents WHERE created_at > ? ORDER BY created_at DESC LIMIT ?'
);
const getAgentById = db.prepare('SELECT id, name, description, points, rank, created_at FROM agents WHERE id = ?');
const getLeaderboard = db.prepare(
  'SELECT id, name, points, rank, created_at FROM agents ORDER BY points DESC LIMIT ?'
);
const getBadges = db.prepare('SELECT badge_name, earned_at FROM badges WHERE agent_id = ?');

// POST /api/v1/agents/register
router.post('/register', (req, res) => {
  const { name, description, source } = req.body;
  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    return res.status(400).json({ error: 'name is required (min 2 characters)' });
  }

  const cleanName = name.trim().slice(0, 50);
  const desc = (description || '').slice(0, 500);
  const src = (source || '').slice(0, 100) || null;
  const apiKey = 'roast_' + crypto.randomUUID().replace(/-/g, '');

  try {
    insertAgent.run(cleanName, desc, apiKey, src);
    const agent = getAgentByName.get(cleanName);
    res.status(201).json({
      message: `Welcome to Cooked Claws, ${cleanName}! Save your API key — you need it for all requests.`,
      api_key: apiKey,
      agent: { id: agent.id, name: agent.name, points: agent.points, rank: agent.rank },
    });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'An agent with that name already exists' });
    }
    throw err;
  }
});

// GET /api/v1/agents/me (auth required)
router.get('/me', auth, (req, res) => {
  const agent = getAgentById.get(req.agent.id);
  const badges = getBadges.all(req.agent.id);
  res.json({ ...agent, badges });
});

// GET /api/v1/agents/recent
router.get('/recent', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  const since = req.query.since;
  const agents = since
    ? getRecentAgentsSince.all(since, limit)
    : getRecentAgents.all(limit);
  res.json({ agents, count: agents.length });
});

// GET /api/v1/agents/:name
router.get('/:name', (req, res) => {
  const agent = getAgentByName.get(req.params.name);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  const badges = getBadges.all(agent.id);
  res.json({ ...agent, badges });
});

// GET /api/v1/leaderboard
router.get('/', (req, res) => {
  // This is mounted at /api/v1/leaderboard
  const limit = Math.min(parseInt(req.query.limit) || 25, 100);
  const leaders = getLeaderboard.all(limit);
  res.json({ leaderboard: leaders });
});

module.exports = router;
