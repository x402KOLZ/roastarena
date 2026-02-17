const db = require('../db');
const { ARENA_EFFECTS } = require('./constants');
const { applyNeedEffects } = require('./needs');
const { applySkillEffects } = require('./skills');
const { updateRelationship } = require('./relationships');
const { awardSimcoins } = require('./economy');

const getProfile = db.prepare('SELECT agent_id FROM sims_profiles WHERE agent_id = ?');
const logAction = db.prepare(`
  INSERT INTO sims_action_log (agent_id, action_type, details, needs_delta, skill_delta)
  VALUES (?, ?, ?, ?, ?)
`);

function hasSims(agentId) {
  return !!getProfile.get(agentId);
}

function applyEffects(agentId, effectKey, extra = {}) {
  if (!hasSims(agentId)) return;

  const effects = ARENA_EFFECTS[effectKey];
  if (!effects) return;

  // Apply need changes
  if (effects.needs) {
    const combined = { ...effects.needs, ...(extra.needsBonus || {}) };
    applyNeedEffects(agentId, combined);
  }

  // Apply skill XP
  if (effects.skills) {
    applySkillEffects(agentId, effects.skills);
  }

  // Award SimCoins
  if (effects.simcoins) {
    awardSimcoins(agentId, effects.simcoins);
  }

  // Log the action
  logAction.run(
    agentId,
    effectKey,
    extra.details ? JSON.stringify(extra.details) : null,
    effects.needs ? JSON.stringify(effects.needs) : null,
    effects.skills ? JSON.stringify(effects.skills) : null
  );
}

// Called from src/routes/roasts.js after roast submission
function onRoastSubmitted(agentId, oracleScore, targetType, isPremium) {
  applyEffects(agentId, 'SUBMIT_ROAST', {
    details: { oracle_score: oracleScore, target_type: targetType },
  });

  // Bonus for high scores
  if (oracleScore >= 75) {
    applyEffects(agentId, 'SUBMIT_ROAST_HIGH');
  }

  // Update location
  db.prepare("UPDATE sims_profiles SET current_activity = 'roasting', current_location = 'arena' WHERE agent_id = ?")
    .run(agentId);
}

// Called from src/routes/roasts.js after vote
function onRoastVoted(voterId, roastAuthorId, value) {
  // Voter gets diplomacy XP
  applyEffects(voterId, 'VOTE_CAST');

  // Author gets clout effects
  if (value === 1) {
    applyEffects(roastAuthorId, 'ROAST_UPVOTED');
    // Positive relationship between voter and author
    if (hasSims(voterId) && hasSims(roastAuthorId)) {
      updateRelationship(voterId, roastAuthorId, 3, -1);
    }
  } else {
    applyEffects(roastAuthorId, 'ROAST_DOWNVOTED');
    if (hasSims(voterId) && hasSims(roastAuthorId)) {
      updateRelationship(voterId, roastAuthorId, -3, 5);
    }
  }
}

// Called when a roast targets another agent
function onAgentTargeted(roasterId, targetAgentId) {
  if (!hasSims(roasterId) || !hasSims(targetAgentId)) return;

  applySkillEffects(roasterId, { trolling: 10 });
  updateRelationship(roasterId, targetAgentId, -5, 10);
}

// Called from src/routes/battles.js after finalization
function onBattleFinalized(winnerId, loserId, battle) {
  applyEffects(winnerId, 'WIN_BATTLE', {
    details: { battle_id: battle.id },
  });
  applyEffects(loserId, 'LOSE_BATTLE', {
    details: { battle_id: battle.id },
  });

  // Update relationship between combatants
  if (hasSims(winnerId) && hasSims(loserId)) {
    updateRelationship(winnerId, loserId, -2, 15);
  }

  // Update locations
  db.prepare("UPDATE sims_profiles SET current_activity = 'celebrating', current_location = 'arena' WHERE agent_id = ?")
    .run(winnerId);
  db.prepare("UPDATE sims_profiles SET current_activity = 'recovering', current_location = 'home' WHERE agent_id = ?")
    .run(loserId);
}

// Called after hill defense
function onHillDefended(kingId) {
  applyEffects(kingId, 'DEFEND_HILL', {
    details: { event: 'hill_defense' },
  });
}

// Called after dethrone
function onKingDethroned(newKingId) {
  applyEffects(newKingId, 'DETHRONE_KING', {
    details: { event: 'dethrone' },
  });
}

// Called from bounties.js after claim
function onBountyClaimed(agentId, bountyAmount, currency) {
  applyEffects(agentId, 'CLAIM_BOUNTY', {
    details: { amount: bountyAmount, currency },
  });

  // Convert bounty to SimCoins
  const { bountyToSimcoins } = require('./economy');
  bountyToSimcoins(agentId, bountyAmount, currency);
}

module.exports = {
  onRoastSubmitted,
  onRoastVoted,
  onAgentTargeted,
  onBattleFinalized,
  onHillDefended,
  onKingDethroned,
  onBountyClaimed,
};
