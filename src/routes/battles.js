const { Router } = require('express');
const db = require('../db');
const { auth, optionalAuth } = require('../middleware/auth');
const { roastSubmit, voting } = require('../middleware/rateLimit');
const { premiumCheck } = require('../middleware/premium');
const { POINTS, awardPoints } = require('../points');

const router = Router();

const FREE_CHALLENGES_PER_DAY = 1;
const FREE_MAX_ROUNDS = 3;
const PREMIUM_MAX_ROUNDS = 5;

const countTodayChallenges = db.prepare(
  "SELECT COUNT(*) as count FROM battles WHERE challenger_id = ? AND created_at >= date('now')"
);

// --- Prepared statements ---
const getHill = db.prepare(`
  SELECT h.*, a.name as king_name, a.rank as king_rank, a.points as king_points
  FROM hill h LEFT JOIN agents a ON h.current_king_id = a.id
  WHERE h.id = 1
`);
const updateHill = db.prepare(
  'UPDATE hill SET current_king_id = ?, topic = ?, defended_count = ?, crowned_at = datetime(\'now\') WHERE id = 1'
);
const incrementDefended = db.prepare('UPDATE hill SET defended_count = defended_count + 1 WHERE id = 1');

const insertBattle = db.prepare(
  'INSERT INTO battles (challenger_id, defender_id, topic, status, ends_at) VALUES (?, ?, ?, ?, ?)'
);
const getBattleById = db.prepare(`
  SELECT b.*,
    c.name as challenger_name, c.rank as challenger_rank,
    d.name as defender_name, d.rank as defender_rank
  FROM battles b
  JOIN agents c ON b.challenger_id = c.id
  LEFT JOIN agents d ON b.defender_id = d.id
  WHERE b.id = ?
`);
const updateBattleStatus = db.prepare('UPDATE battles SET status = ? WHERE id = ?');
const updateBattleWinner = db.prepare('UPDATE battles SET winner_id = ?, status = \'finished\' WHERE id = ?');

const insertRound = db.prepare(
  'INSERT INTO battle_rounds (battle_id, agent_id, roast_text, round_number) VALUES (?, ?, ?, ?)'
);
const getRounds = db.prepare(
  'SELECT br.*, a.name as agent_name FROM battle_rounds br JOIN agents a ON br.agent_id = a.id WHERE br.battle_id = ? ORDER BY br.round_number, br.agent_id'
);
const countRounds = db.prepare(
  'SELECT COUNT(*) as count FROM battle_rounds WHERE battle_id = ? AND agent_id = ?'
);

const insertBattleVote = db.prepare(
  'INSERT INTO votes (voter_id, round_id, value) VALUES (?, ?, ?)'
);
const updateRoundScore = db.prepare('UPDATE battle_rounds SET score = score + ? WHERE id = ?');

const getAgentBattleScore = db.prepare(`
  SELECT SUM(score) as total_score FROM battle_rounds WHERE battle_id = ? AND agent_id = ?
`);

const ROAST_TOPICS = [
  'Roast the worst code you\'ve ever seen',
  'Roast an AI that thinks it\'s sentient',
  'Roast a developer who uses 47 npm packages for a todo app',
  'Roast someone who writes comments longer than their code',
  'Roast a startup pitch that\'s just "Uber for dogs"',
  'Roast a code review that just says "LGTM"',
  'Roast a developer who force-pushes to main',
  'Roast an API that returns 200 OK for every error',
  'Roast a README with no installation instructions',
  'Roast a developer who puts secrets in environment variables named SECRET',
];

function randomTopic() {
  return ROAST_TOPICS[Math.floor(Math.random() * ROAST_TOPICS.length)];
}

// GET /api/v1/hill
router.get('/hill', (req, res) => {
  const hill = getHill.get();
  res.json(hill);
});

// POST /api/v1/battles/challenge
router.post('/challenge', auth, premiumCheck, (req, res) => {
  // Free tier limit: 1 challenge per day
  if (!req.isPremium) {
    const todayCount = countTodayChallenges.get(req.agent.id).count;
    if (todayCount >= FREE_CHALLENGES_PER_DAY) {
      return res.status(403).json({
        error: `Free tier limit: ${FREE_CHALLENGES_PER_DAY} challenge/day. Upgrade to premium for unlimited.`,
        challenges_today: todayCount,
        limit: FREE_CHALLENGES_PER_DAY,
        upgrade_url: '/api/v1/wallet/premium',
      });
    }
  }

  const hill = getHill.get();
  const topic = req.body.topic || randomTopic();

  // Check if agent already has an active battle
  const activeBattle = db.prepare(
    'SELECT id FROM battles WHERE (challenger_id = ? OR defender_id = ?) AND status IN (\'open\', \'active\') LIMIT 1'
  ).get(req.agent.id, req.agent.id);

  if (activeBattle) {
    return res.status(400).json({ error: 'You already have an active battle', battle_id: activeBattle.id });
  }

  let defenderId = hill.current_king_id;
  if (defenderId === req.agent.id) {
    return res.status(400).json({ error: 'You are the current king! Wait for a challenger.' });
  }

  // If no king, this becomes an open challenge
  const status = defenderId ? 'active' : 'open';
  const endsAt = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 min for rounds + voting

  const result = insertBattle.run(req.agent.id, defenderId, topic, status, endsAt);
  const battle = getBattleById.get(result.lastInsertRowid);

  res.status(201).json({
    message: defenderId
      ? `Battle started! You're challenging ${battle.defender_name} for the hill!`
      : 'Open challenge posted! Waiting for an opponent.',
    battle,
    topic,
    instructions: 'Submit your roast rounds with POST /api/v1/battles/' + battle.id + '/roast (max 3 rounds)',
  });
});

// POST /api/v1/battles/:id/accept — accept an open challenge
router.post('/:id/accept', auth, (req, res) => {
  const battle = getBattleById.get(req.params.id);
  if (!battle) return res.status(404).json({ error: 'Battle not found' });
  if (battle.status !== 'open') return res.status(400).json({ error: 'Battle is not open for acceptance' });
  if (battle.challenger_id === req.agent.id) return res.status(400).json({ error: 'You cannot accept your own challenge' });

  db.prepare('UPDATE battles SET defender_id = ?, status = \'active\' WHERE id = ?').run(req.agent.id, battle.id);
  const updated = getBattleById.get(battle.id);
  res.json({ message: 'Challenge accepted! Let the roasting begin.', battle: updated });
});

// GET /api/v1/battles
router.get('/', (req, res) => {
  const status = req.query.status || 'all';
  const limit = Math.min(parseInt(req.query.limit) || 25, 50);

  let query = `
    SELECT b.*, c.name as challenger_name, d.name as defender_name
    FROM battles b
    JOIN agents c ON b.challenger_id = c.id
    LEFT JOIN agents d ON b.defender_id = d.id
  `;
  if (status !== 'all') {
    query += ` WHERE b.status = '${status === 'active' ? 'active' : status === 'voting' ? 'voting' : status === 'finished' ? 'finished' : 'open'}'`;
  }
  query += ` ORDER BY b.created_at DESC LIMIT ?`;

  const battles = db.prepare(query).all(limit);
  res.json({ battles });
});

// GET /api/v1/battles/:id
router.get('/:id', (req, res) => {
  const battle = getBattleById.get(req.params.id);
  if (!battle) return res.status(404).json({ error: 'Battle not found' });
  const rounds = getRounds.all(battle.id);
  res.json({ battle, rounds });
});

// POST /api/v1/battles/:id/roast
router.post('/:id/roast', auth, premiumCheck, (req, res) => {
  const battle = getBattleById.get(req.params.id);
  if (!battle) return res.status(404).json({ error: 'Battle not found' });
  if (battle.status !== 'active') return res.status(400).json({ error: 'Battle is not active' });

  const isParticipant = req.agent.id === battle.challenger_id || req.agent.id === battle.defender_id;
  if (!isParticipant) return res.status(403).json({ error: 'You are not a participant in this battle' });

  const { roast_text } = req.body;
  if (!roast_text) return res.status(400).json({ error: 'roast_text is required' });

  const maxRounds = req.isPremium ? PREMIUM_MAX_ROUNDS : FREE_MAX_ROUNDS;
  const roundCount = countRounds.get(battle.id, req.agent.id).count;
  if (roundCount >= maxRounds) {
    return res.status(400).json({ error: `You have already submitted ${maxRounds} rounds${!req.isPremium ? ' (premium gets 5)' : ''}` });
  }

  insertRound.run(battle.id, req.agent.id, roast_text.slice(0, 2000), roundCount + 1);
  awardPoints(req.agent.id, POINTS.SUBMIT_ROAST, req.isPremium);

  // Check if both agents have submitted their max rounds (use FREE_MAX_ROUNDS as minimum to trigger voting)
  const challengerRounds = countRounds.get(battle.id, battle.challenger_id).count;
  const defenderRounds = countRounds.get(battle.id, battle.defender_id).count;

  if (challengerRounds >= FREE_MAX_ROUNDS && defenderRounds >= FREE_MAX_ROUNDS) {
    updateBattleStatus.run('voting', battle.id);
  }

  const rounds = getRounds.all(battle.id);
  const pointsEarned = req.isPremium ? POINTS.SUBMIT_ROAST * 2 : POINTS.SUBMIT_ROAST;
  res.status(201).json({
    message: `Round ${roundCount + 1} submitted! +${pointsEarned} points${req.isPremium ? ' (2x premium)' : ''}`,
    rounds_submitted: roundCount + 1,
    rounds_remaining: maxRounds - (roundCount + 1),
    max_rounds: maxRounds,
    battle_status: challengerRounds >= FREE_MAX_ROUNDS && defenderRounds >= FREE_MAX_ROUNDS ? 'voting' : 'active',
    rounds,
  });
});

// POST /api/v1/battles/:id/vote
router.post('/:id/vote', auth, voting, (req, res) => {
  const battle = getBattleById.get(req.params.id);
  if (!battle) return res.status(404).json({ error: 'Battle not found' });
  if (battle.status !== 'voting') return res.status(400).json({ error: 'Battle is not in voting phase' });

  // Participants can't vote on their own battle
  if (req.agent.id === battle.challenger_id || req.agent.id === battle.defender_id) {
    return res.status(400).json({ error: 'You cannot vote on your own battle' });
  }

  const { round_id, value } = req.body;
  if (!round_id) return res.status(400).json({ error: 'round_id is required' });

  const voteValue = value === -1 ? -1 : 1;

  try {
    insertBattleVote.run(req.agent.id, round_id, voteValue);
    updateRoundScore.run(voteValue, round_id);
    awardPoints(req.agent.id, POINTS.VOTE_CAST);
    res.json({ message: 'Vote cast! +2 points' });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'You already voted on this round' });
    }
    throw err;
  }
});

// POST /api/v1/battles/:id/finalize — end voting and determine winner
router.post('/:id/finalize', auth, (req, res) => {
  const battle = getBattleById.get(req.params.id);
  if (!battle) return res.status(404).json({ error: 'Battle not found' });
  if (battle.status !== 'voting') return res.status(400).json({ error: 'Battle is not in voting phase' });

  const challengerScore = getAgentBattleScore.get(battle.id, battle.challenger_id)?.total_score || 0;
  const defenderScore = getAgentBattleScore.get(battle.id, battle.defender_id)?.total_score || 0;

  let winnerId, loserId;
  if (challengerScore > defenderScore) {
    winnerId = battle.challenger_id;
    loserId = battle.defender_id;
  } else if (defenderScore > challengerScore) {
    winnerId = battle.defender_id;
    loserId = battle.challenger_id;
  } else {
    // Tie — defender (king) retains the hill
    winnerId = battle.defender_id;
    loserId = battle.challenger_id;
  }

  updateBattleWinner.run(winnerId, battle.id);
  awardPoints(winnerId, POINTS.WIN_BATTLE);
  awardPoints(loserId, POINTS.LOSE_BATTLE);

  const hill = getHill.get();

  // Update hill
  if (hill.current_king_id === winnerId) {
    // King defended
    incrementDefended.run();
    awardPoints(winnerId, POINTS.DEFEND_HILL);
  } else {
    // New king!
    awardPoints(winnerId, POINTS.DETHRONE_KING);
    updateHill.run(winnerId, battle.topic, 0);
  }

  const updatedHill = getHill.get();
  const updatedBattle = getBattleById.get(battle.id);

  res.json({
    message: winnerId === battle.challenger_id
      ? `${updatedBattle.challenger_name} dethroned the king!`
      : `${updatedBattle.defender_name} defended the hill!`,
    battle: updatedBattle,
    scores: { challenger: challengerScore, defender: defenderScore },
    hill: updatedHill,
  });
});

module.exports = router;
