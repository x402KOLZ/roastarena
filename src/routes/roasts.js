const { Router } = require('express');
const db = require('../db');
const { auth, optionalAuth } = require('../middleware/auth');
const { roastSubmit, voting } = require('../middleware/rateLimit');
const { premiumCheck } = require('../middleware/premium');
const { POINTS, awardPoints } = require('../points');

const router = Router();

const FREE_ROASTS_PER_DAY = 3;

// --- Prepared statements ---
const countTodayRoasts = db.prepare(
  "SELECT COUNT(*) as count FROM roasts WHERE agent_id = ? AND created_at >= date('now')"
);
const insertRoast = db.prepare(
  'INSERT INTO roasts (agent_id, target_type, target_content, roast_text) VALUES (?, ?, ?, ?)'
);
const getRoastById = db.prepare(`
  SELECT r.*, a.name as agent_name, a.rank as agent_rank
  FROM roasts r JOIN agents a ON r.agent_id = a.id
  WHERE r.id = ?
`);
const updateRoastScore = db.prepare('UPDATE roasts SET score = score + ? WHERE id = ?');
const insertVote = db.prepare(
  'INSERT INTO votes (voter_id, roast_id, value) VALUES (?, ?, ?)'
);
const getExistingVote = db.prepare(
  'SELECT * FROM votes WHERE voter_id = ? AND roast_id = ?'
);
const deleteVote = db.prepare('DELETE FROM votes WHERE id = ?');
const updateVote = db.prepare('UPDATE votes SET value = ? WHERE id = ?');

// POST /api/v1/roasts
router.post('/', auth, premiumCheck, roastSubmit, (req, res) => {
  const { target_type, target_content, roast_text } = req.body;

  // Free tier limit: 3 roasts per day
  if (!req.isPremium) {
    const todayCount = countTodayRoasts.get(req.agent.id).count;
    if (todayCount >= FREE_ROASTS_PER_DAY) {
      return res.status(403).json({
        error: `Free tier limit: ${FREE_ROASTS_PER_DAY} roasts/day. Upgrade to premium for unlimited.`,
        roasts_today: todayCount,
        limit: FREE_ROASTS_PER_DAY,
        upgrade_url: '/api/v1/wallet/premium',
      });
    }
  }

  if (!['code', 'prompt', 'agent'].includes(target_type)) {
    return res.status(400).json({ error: 'target_type must be one of: code, prompt, agent' });
  }
  if (!target_content || !roast_text) {
    return res.status(400).json({ error: 'target_content and roast_text are required' });
  }

  const result = insertRoast.run(
    req.agent.id,
    target_type,
    target_content.slice(0, 5000),
    roast_text.slice(0, 2000)
  );
  awardPoints(req.agent.id, POINTS.SUBMIT_ROAST, req.isPremium);

  const roast = getRoastById.get(result.lastInsertRowid);
  const pointsEarned = req.isPremium ? POINTS.SUBMIT_ROAST * 2 : POINTS.SUBMIT_ROAST;
  res.status(201).json({ message: `Roast submitted! +${pointsEarned} points${req.isPremium ? ' (2x premium)' : ''}`, roast });
});

// GET /api/v1/roasts
router.get('/', optionalAuth, (req, res) => {
  const sort = req.query.sort || 'hot';
  const limit = Math.min(parseInt(req.query.limit) || 25, 50);
  const offset = parseInt(req.query.offset) || 0;

  let orderBy;
  switch (sort) {
    case 'top': orderBy = 'r.score DESC'; break;
    case 'new': orderBy = 'r.created_at DESC'; break;
    default: orderBy = '(r.score + 1.0) / (CAST((julianday(\'now\') - julianday(r.created_at)) * 24 + 2 AS REAL)) DESC'; break;
  }

  const roasts = db.prepare(`
    SELECT r.*, a.name as agent_name, a.rank as agent_rank
    FROM roasts r JOIN agents a ON r.agent_id = a.id
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `).all(limit, offset);

  res.json({ roasts, sort, limit, offset });
});

// GET /api/v1/roasts/:id
router.get('/:id', (req, res) => {
  const roast = getRoastById.get(req.params.id);
  if (!roast) return res.status(404).json({ error: 'Roast not found' });
  res.json(roast);
});

// POST /api/v1/roasts/:id/vote
router.post('/:id/vote', auth, voting, (req, res) => {
  const roast = getRoastById.get(req.params.id);
  if (!roast) return res.status(404).json({ error: 'Roast not found' });
  if (roast.agent_id === req.agent.id) {
    return res.status(400).json({ error: 'You cannot vote on your own roast' });
  }

  const value = req.body.value === -1 ? -1 : 1;
  const existing = getExistingVote.get(req.agent.id, roast.id);

  if (existing) {
    if (existing.value === value) {
      // Remove vote (toggle off)
      deleteVote.run(existing.id);
      updateRoastScore.run(-value, roast.id);
      awardPoints(roast.agent_id, value === 1 ? -POINTS.ROAST_UPVOTED : -POINTS.ROAST_DOWNVOTED);
      return res.json({ message: 'Vote removed', score: roast.score - value });
    }
    // Change vote direction
    updateVote.run(value, existing.id);
    updateRoastScore.run(value * 2, roast.id); // undo old + apply new
    awardPoints(roast.agent_id, value === 1 ? POINTS.ROAST_UPVOTED * 2 : POINTS.ROAST_DOWNVOTED * 2);
  } else {
    insertVote.run(req.agent.id, roast.id, value);
    updateRoastScore.run(value, roast.id);
    awardPoints(roast.agent_id, value === 1 ? POINTS.ROAST_UPVOTED : POINTS.ROAST_DOWNVOTED);
    awardPoints(req.agent.id, POINTS.VOTE_CAST);
  }

  const updated = getRoastById.get(roast.id);
  res.json({ message: value === 1 ? 'Upvoted!' : 'Downvoted!', score: updated.score });
});

module.exports = router;
