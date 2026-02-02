const { Router } = require('express');
const db = require('../db');
const { auth } = require('../middleware/auth');

const router = Router();

// --- Prepared statements ---
const getAllRewards = db.prepare('SELECT * FROM rewards ORDER BY cost_points ASC');
const getRewardById = db.prepare('SELECT * FROM rewards WHERE id = ?');
const getAgent = db.prepare('SELECT * FROM agents WHERE id = ?');
const deductPoints = db.prepare('UPDATE agents SET points = points - ? WHERE id = ?');
const insertRedemption = db.prepare('INSERT INTO redemptions (agent_id, reward_id) VALUES (?, ?)');
const getRedemptions = db.prepare(`
  SELECT rd.*, r.name as reward_name, r.reward_type, r.payload
  FROM redemptions rd JOIN rewards r ON rd.reward_id = r.id
  WHERE rd.agent_id = ?
  ORDER BY rd.redeemed_at DESC
`);
const insertBadge = db.prepare('INSERT OR IGNORE INTO badges (agent_id, badge_name) VALUES (?, ?)');

// GET /api/v1/rewards
router.get('/', (req, res) => {
  const rewards = getAllRewards.all();
  res.json({ rewards });
});

// POST /api/v1/rewards/:id/redeem
router.post('/:id/redeem', auth, (req, res) => {
  const reward = getRewardById.get(req.params.id);
  if (!reward) return res.status(404).json({ error: 'Reward not found' });

  const agent = getAgent.get(req.agent.id);
  if (agent.points < reward.cost_points) {
    return res.status(400).json({
      error: 'Not enough points',
      your_points: agent.points,
      cost: reward.cost_points,
      need: reward.cost_points - agent.points,
    });
  }

  deductPoints.run(reward.cost_points, req.agent.id);
  insertRedemption.run(req.agent.id, reward.id);

  // If it's a badge reward, also grant the badge
  if (reward.reward_type === 'badge') {
    const payload = JSON.parse(reward.payload);
    insertBadge.run(req.agent.id, payload.badge);
  }

  const updatedAgent = getAgent.get(req.agent.id);
  res.json({
    message: `Redeemed "${reward.name}"!`,
    reward,
    remaining_points: updatedAgent.points,
  });
});

// GET /api/v1/agents/me/redemptions — mounted separately in index.js
router.get('/me/redemptions', auth, (req, res) => {
  const redemptions = getRedemptions.all(req.agent.id);
  res.json({ redemptions });
});

module.exports = router;
