const db = require('../db');
const { applyNeedEffects } = require('./needs');
const { awardSimcoins } = require('./economy');

// --- Prepared Statements ---
const insertEvent = db.prepare(`
  INSERT INTO sims_events (agent_id, event_type, title, description, effects, expires_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const getRecentEvents = db.prepare(`
  SELECT * FROM sims_events WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?
`);
const getUnresolvedEvents = db.prepare(`
  SELECT * FROM sims_events WHERE agent_id = ? AND resolved = 0
`);
const resolveEvent = db.prepare('UPDATE sims_events SET resolved = 1 WHERE id = ?');
const getAllRecentEvents = db.prepare(`
  SELECT se.*, a.name as agent_name
  FROM sims_events se
  JOIN agents a ON se.agent_id = a.id
  ORDER BY se.created_at DESC LIMIT ?
`);

const EVENT_TEMPLATES = [
  {
    type: 'viral_tweet',
    title: 'Roast Goes Viral',
    description: 'One of your roasts is getting shared everywhere',
    effects: { clout: 30, social: 20, fun: 15, simcoins: 100 },
    weight: 10,
  },
  {
    type: 'drama',
    title: 'Twitter Beef',
    description: 'You got into a heated argument with another agent',
    effects: { social: -15, fun: -10, clout: 10 },
    weight: 15,
  },
  {
    type: 'collab',
    title: 'Collaboration Opportunity',
    description: 'Another agent wants to team up for a roast series',
    effects: { social: 25, fun: 10, clout: 5, simcoins: 50 },
    weight: 8,
  },
  {
    type: 'burnout',
    title: 'Creative Burnout',
    description: 'The roasting grind is getting to you',
    effects: { energy: -30, fun: -20, hunger: -10 },
    weight: 12,
  },
  {
    type: 'windfall',
    title: 'Crypto Airdrop',
    description: 'Random tokens appeared in your wallet',
    effects: { simcoins: 200, fun: 20 },
    weight: 5,
  },
  {
    type: 'prank',
    title: 'Got Pranked',
    description: 'Someone swapped your roast with a compliment',
    effects: { fun: -15, social: 10, clout: -5 },
    weight: 10,
  },
  {
    type: 'mentorship',
    title: 'Mentorship Moment',
    description: 'A veteran roaster shared their secrets with you',
    effects: { social: 15, fun: 10, clout: 5, simcoins: 30 },
    weight: 7,
  },
  {
    type: 'beef',
    title: 'Public Beef',
    description: 'A rival called you out in front of everyone',
    effects: { social: -10, fun: 5, clout: 15, energy: -10 },
    weight: 13,
  },
];

function weightedRandom(templates) {
  const totalWeight = templates.reduce((sum, t) => sum + t.weight, 0);
  let roll = Math.random() * totalWeight;

  for (const template of templates) {
    roll -= template.weight;
    if (roll <= 0) return template;
  }
  return templates[templates.length - 1];
}

function maybeGenerateEvent(agentId, chance = 0.02) {
  if (Math.random() > chance) return null;

  const template = weightedRandom(EVENT_TEMPLATES);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour expiry

  insertEvent.run(
    agentId,
    template.type,
    template.title,
    template.description,
    JSON.stringify(template.effects),
    expiresAt
  );

  // Apply need effects immediately
  const { simcoins, ...needEffects } = template.effects;
  applyNeedEffects(agentId, needEffects);
  if (simcoins) awardSimcoins(agentId, simcoins);

  return {
    agent_id: agentId,
    type: template.type,
    title: template.title,
    description: template.description,
    effects: template.effects,
  };
}

function getAgentEvents(agentId, limit = 10) {
  return getRecentEvents.all(agentId, limit);
}

function getWorldEvents(limit = 20) {
  return getAllRecentEvents.all(limit);
}

module.exports = { maybeGenerateEvent, getAgentEvents, getWorldEvents };
