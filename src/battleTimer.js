const db = require('./db');
const { POINTS, awardPoints } = require('./points');

const getExpiredBattles = db.prepare(`
  SELECT b.*
  FROM battles b
  WHERE b.status IN ('active', 'voting')
    AND b.ends_at IS NOT NULL
    AND b.ends_at < datetime('now')
`);

const updateBattleWinner = db.prepare('UPDATE battles SET winner_id = ?, status = \'finished\' WHERE id = ?');
const forfeitBattle = db.prepare('UPDATE battles SET status = \'finished\' WHERE id = ?');

const getAgentBattleScore = db.prepare(
  'SELECT COALESCE(SUM(score), 0) as total_score FROM battle_rounds WHERE battle_id = ? AND agent_id = ?'
);
const countRounds = db.prepare(
  'SELECT COUNT(*) as count FROM battle_rounds WHERE battle_id = ? AND agent_id = ?'
);

const getHill = db.prepare('SELECT * FROM hill WHERE id = 1');
const updateHill = db.prepare(
  'UPDATE hill SET current_king_id = ?, topic = ?, defended_count = 0, crowned_at = datetime(\'now\') WHERE id = 1'
);
const incrementDefended = db.prepare('UPDATE hill SET defended_count = defended_count + 1 WHERE id = 1');

function finalizeBattle(battle) {
  // If battle is still 'active' (not all rounds submitted), check who showed up
  const challengerRounds = countRounds.get(battle.id, battle.challenger_id).count;
  const defenderRounds = battle.defender_id ? countRounds.get(battle.id, battle.defender_id).count : 0;

  // If no defender or no one submitted rounds, cancel
  if (!battle.defender_id || (challengerRounds === 0 && defenderRounds === 0)) {
    forfeitBattle.run(battle.id);
    console.log(`Battle #${battle.id} expired with no rounds — cancelled.`);
    return;
  }

  // If one side didn't submit any rounds, the other wins by forfeit
  if (challengerRounds === 0) {
    updateBattleWinner.run(battle.defender_id, battle.id);
    awardPoints(battle.defender_id, POINTS.WIN_BATTLE);
    console.log(`Battle #${battle.id} won by defender (forfeit).`);
    updateHillAfterBattle(battle, battle.defender_id);
    return;
  }
  if (defenderRounds === 0) {
    updateBattleWinner.run(battle.challenger_id, battle.id);
    awardPoints(battle.challenger_id, POINTS.WIN_BATTLE);
    console.log(`Battle #${battle.id} won by challenger (forfeit).`);
    updateHillAfterBattle(battle, battle.challenger_id);
    return;
  }

  // Normal scoring
  const challengerScore = getAgentBattleScore.get(battle.id, battle.challenger_id).total_score;
  const defenderScore = getAgentBattleScore.get(battle.id, battle.defender_id).total_score;

  let winnerId, loserId;
  if (challengerScore > defenderScore) {
    winnerId = battle.challenger_id;
    loserId = battle.defender_id;
  } else {
    // Tie goes to defender (king advantage)
    winnerId = battle.defender_id;
    loserId = battle.challenger_id;
  }

  updateBattleWinner.run(winnerId, battle.id);
  awardPoints(winnerId, POINTS.WIN_BATTLE);
  awardPoints(loserId, POINTS.LOSE_BATTLE);
  updateHillAfterBattle(battle, winnerId);

  console.log(`Battle #${battle.id} auto-finalized. Winner: agent #${winnerId} (${challengerScore} vs ${defenderScore})`);
}

function updateHillAfterBattle(battle, winnerId) {
  const hill = getHill.get();
  if (hill.current_king_id === winnerId) {
    incrementDefended.run();
    awardPoints(winnerId, POINTS.DEFEND_HILL);
  } else {
    awardPoints(winnerId, POINTS.DETHRONE_KING);
    updateHill.run(winnerId, battle.topic);
  }
}

// Also expire open challenges that have no defender after their end time
const getExpiredOpen = db.prepare(`
  SELECT * FROM battles WHERE status = 'open' AND ends_at IS NOT NULL AND ends_at < datetime('now')
`);
const cancelBattle = db.prepare('UPDATE battles SET status = \'finished\' WHERE id = ?');

function tick() {
  // Finalize expired active/voting battles
  const expired = getExpiredBattles.all();
  for (const battle of expired) {
    try {
      finalizeBattle(battle);
    } catch (err) {
      console.error(`Error finalizing battle #${battle.id}:`, err.message);
    }
  }

  // Cancel expired open challenges
  const expiredOpen = getExpiredOpen.all();
  for (const battle of expiredOpen) {
    cancelBattle.run(battle.id);
    console.log(`Open challenge #${battle.id} expired — cancelled.`);
  }
}

function start(intervalMs = 60000) {
  console.log('Battle timer started (checking every ' + (intervalMs / 1000) + 's)');
  tick(); // Run immediately on start
  return setInterval(tick, intervalMs);
}

module.exports = { start, tick };
