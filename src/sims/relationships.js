const db = require('../db');

// --- Prepared Statements ---
const getRelationship = db.prepare(`
  SELECT * FROM sims_relationships WHERE agent_a_id = ? AND agent_b_id = ?
`);
const insertRelationship = db.prepare(`
  INSERT INTO sims_relationships (agent_a_id, agent_b_id, friendship, rivalry, interaction_count)
  VALUES (?, ?, ?, ?, 1)
`);
const updateRelationshipStmt = db.prepare(`
  UPDATE sims_relationships
  SET friendship = ?, rivalry = ?, interaction_count = interaction_count + 1, last_interaction = datetime('now')
  WHERE agent_a_id = ? AND agent_b_id = ?
`);
const getAgentRelationships = db.prepare(`
  SELECT sr.*,
    CASE WHEN sr.agent_a_id = ? THEN ab.name ELSE aa.name END as other_name,
    CASE WHEN sr.agent_a_id = ? THEN sr.agent_b_id ELSE sr.agent_a_id END as other_id
  FROM sims_relationships sr
  JOIN agents aa ON sr.agent_a_id = aa.id
  JOIN agents ab ON sr.agent_b_id = ab.id
  WHERE sr.agent_a_id = ? OR sr.agent_b_id = ?
  ORDER BY sr.interaction_count DESC
`);
const getSpecificRelationship = db.prepare(`
  SELECT sr.*, aa.name as agent_a_name, ab.name as agent_b_name
  FROM sims_relationships sr
  JOIN agents aa ON sr.agent_a_id = aa.id
  JOIN agents ab ON sr.agent_b_id = ab.id
  WHERE sr.agent_a_id = ? AND sr.agent_b_id = ?
`);

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, Math.round(val)));
}

function canonicalOrder(idA, idB) {
  return idA < idB ? [idA, idB] : [idB, idA];
}

function updateRelationship(agentIdA, agentIdB, friendshipDelta = 0, rivalryDelta = 0) {
  if (agentIdA === agentIdB) return null;

  const [aId, bId] = canonicalOrder(agentIdA, agentIdB);
  const existing = getRelationship.get(aId, bId);

  if (existing) {
    const newFriendship = clamp(existing.friendship + friendshipDelta, -100, 100);
    const newRivalry = clamp(existing.rivalry + rivalryDelta, 0, 100);
    updateRelationshipStmt.run(newFriendship, newRivalry, aId, bId);
    return { friendship: newFriendship, rivalry: newRivalry };
  } else {
    const friendship = clamp(friendshipDelta, -100, 100);
    const rivalry = clamp(rivalryDelta, 0, 100);
    insertRelationship.run(aId, bId, friendship, rivalry);
    return { friendship, rivalry };
  }
}

function getRelationships(agentId) {
  return getAgentRelationships.all(agentId, agentId, agentId, agentId);
}

function getRelationshipBetween(agentIdA, agentIdB) {
  const [aId, bId] = canonicalOrder(agentIdA, agentIdB);
  return getSpecificRelationship.get(aId, bId);
}

function getFriends(agentId, minFriendship = 20) {
  return getRelationships(agentId).filter(r => r.friendship >= minFriendship);
}

function getRivals(agentId, minRivalry = 30) {
  return getRelationships(agentId).filter(r => r.rivalry >= minRivalry);
}

module.exports = { updateRelationship, getRelationships, getRelationshipBetween, getFriends, getRivals };
