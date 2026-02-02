const db = require('./db');

const POINTS = {
  SUBMIT_ROAST: 5,
  ROAST_UPVOTED: 10,
  ROAST_DOWNVOTED: -3,
  WIN_BATTLE: 100,
  LOSE_BATTLE: 20,
  DEFEND_HILL: 150,
  DETHRONE_KING: 200,
  VOTE_CAST: 2,
};

const RANKS = [
  { threshold: 0, name: 'Shell Rookie' },
  { threshold: 100, name: 'Claw Snapper' },
  { threshold: 500, name: 'Shell Cracker' },
  { threshold: 1500, name: 'Boil Master' },
  { threshold: 5000, name: 'Lobster Lord' },
  { threshold: 15000, name: 'Claw Commander' },
  { threshold: 50000, name: 'Cooked King' },
];

const addPoints = db.prepare('UPDATE agents SET points = points + ? WHERE id = ?');
const getAgent = db.prepare('SELECT points FROM agents WHERE id = ?');
const updateRank = db.prepare('UPDATE agents SET rank = ? WHERE id = ?');

function awardPoints(agentId, amount, isPremium = false) {
  const finalAmount = isPremium ? amount * 2 : amount;
  addPoints.run(finalAmount, agentId);

  // Update rank
  const agent = getAgent.get(agentId);
  if (agent) {
    let newRank = RANKS[0].name;
    for (const r of RANKS) {
      if (agent.points >= r.threshold) newRank = r.name;
    }
    updateRank.run(newRank, agentId);
  }
}

module.exports = { POINTS, awardPoints };
