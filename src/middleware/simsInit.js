const db = require('../db');
const { SKILL_NAMES } = require('../sims/constants');

const checkProfile = db.prepare('SELECT agent_id FROM sims_profiles WHERE agent_id = ?');
const createProfile = db.prepare('INSERT OR IGNORE INTO sims_profiles (agent_id) VALUES (?)');
const createSkill = db.prepare('INSERT OR IGNORE INTO sims_skills (agent_id, skill_name) VALUES (?, ?)');

function simsInit(req, res, next) {
  if (!req.agent) return next();

  const existing = checkProfile.get(req.agent.id);
  if (!existing) {
    createProfile.run(req.agent.id);
    for (const skill of SKILL_NAMES) {
      createSkill.run(req.agent.id, skill);
    }
  }
  next();
}

module.exports = { simsInit };
