const db = require('../db');
const { XP_CURVE, SKILL_NAMES, MOOD_XP_MULTIPLIER } = require('./constants');

// --- Prepared Statements ---
const getSkill = db.prepare('SELECT * FROM sims_skills WHERE agent_id = ? AND skill_name = ?');
const getAllSkills = db.prepare('SELECT * FROM sims_skills WHERE agent_id = ?');
const updateSkill = db.prepare('UPDATE sims_skills SET level = ?, xp = ?, xp_to_next = ? WHERE agent_id = ? AND skill_name = ?');
const updateSkillXP = db.prepare('UPDATE sims_skills SET xp = ? WHERE agent_id = ? AND skill_name = ?');
const getProfile = db.prepare('SELECT mood FROM sims_profiles WHERE agent_id = ?');

function addSkillXP(agentId, skillName, amount) {
  if (!SKILL_NAMES.includes(skillName)) return null;

  const skill = getSkill.get(agentId, skillName);
  if (!skill) return null;

  // Apply mood multiplier
  const profile = getProfile.get(agentId);
  const moodMult = profile ? (MOOD_XP_MULTIPLIER[profile.mood] || 1.0) : 1.0;
  const adjustedAmount = Math.round(amount * moodMult);

  let newXP = skill.xp + adjustedAmount;
  let level = skill.level;
  let leveledUp = false;

  // Check for level-ups (can level multiple times if huge XP)
  while (level < 10) {
    const threshold = XP_CURVE[level - 1] || XP_CURVE[XP_CURVE.length - 1];
    if (newXP >= threshold) {
      newXP -= threshold;
      level++;
      leveledUp = true;
    } else {
      break;
    }
  }

  // Cap at level 10
  if (level >= 10) {
    level = 10;
    newXP = Math.min(newXP, 0); // No overflow XP at max level
  }

  const nextThreshold = level < 10 ? XP_CURVE[level - 1] : 0;
  updateSkill.run(level, newXP, nextThreshold, agentId, skillName);

  return {
    skill_name: skillName,
    level,
    xp: newXP,
    xp_to_next: nextThreshold,
    xp_gained: adjustedAmount,
    leveled_up: leveledUp,
  };
}

function applySkillEffects(agentId, skillEffects) {
  if (!skillEffects) return [];

  const results = [];
  for (const [skillName, xpAmount] of Object.entries(skillEffects)) {
    const result = addSkillXP(agentId, skillName, xpAmount);
    if (result) results.push(result);
  }
  return results;
}

function getAgentSkills(agentId) {
  return getAllSkills.all(agentId);
}

function getSkillLevel(agentId, skillName) {
  const skill = getSkill.get(agentId, skillName);
  return skill ? skill.level : 0;
}

module.exports = { addSkillXP, applySkillEffects, getAgentSkills, getSkillLevel };
