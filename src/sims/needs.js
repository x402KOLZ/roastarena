const db = require('../db');
const { NEED_DECAY, TRAIT_MODIFIERS, MOOD_THRESHOLDS, NEED_NAMES } = require('./constants');

// --- Prepared Statements ---
const getProfile = db.prepare('SELECT * FROM sims_profiles WHERE agent_id = ?');
const updateNeeds = db.prepare(`
  UPDATE sims_profiles
  SET energy = ?, hunger = ?, social = ?, fun = ?, clout = ?, hygiene = ?, mood = ?, last_tick_at = datetime('now')
  WHERE agent_id = ?
`);
const updateSingleNeed = db.prepare(`
  UPDATE sims_profiles SET ${NEED_NAMES.map(n => `${n} = CASE WHEN @need = '${n}' THEN MIN(100, MAX(0, ${n} + @amount)) ELSE ${n} END`).join(', ')}
  WHERE agent_id = @agent_id
`);

function clamp(val, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(val)));
}

function calculateMood(profile) {
  const avg = (profile.energy + profile.hunger + profile.social +
               profile.fun + profile.clout + profile.hygiene) / 6;

  for (const threshold of MOOD_THRESHOLDS) {
    if (avg >= threshold.min) return threshold.mood;
  }
  return 'crisis';
}

function getTraitModifier(profile, needName) {
  let modifier = 1.0;
  const traits = {
    extraversion: profile.trait_extraversion,
    neuroticism: profile.trait_neuroticism,
    conscientiousness: profile.trait_conscientiousness,
    agreeableness: profile.trait_agreeableness,
    openness: profile.trait_openness,
  };

  for (const [traitName, traitValue] of Object.entries(traits)) {
    const mods = TRAIT_MODIFIERS[traitName];
    if (mods && mods[needName]) {
      // Scale: trait 0.5 = neutral, >0.5 amplifies modifier, <0.5 reduces it
      const scale = 0.5 + traitValue;
      modifier *= mods[needName] * scale;
    }
  }
  return modifier;
}

function decayNeeds(profile, tickCount = 1) {
  const needs = {};
  for (const need of NEED_NAMES) {
    const baseDecay = NEED_DECAY[need];
    const traitMod = getTraitModifier(profile, need);
    const totalDecay = baseDecay * traitMod * tickCount;
    needs[need] = clamp(profile[need] + totalDecay);
  }

  const updatedProfile = { ...profile, ...needs };
  const mood = calculateMood(updatedProfile);

  updateNeeds.run(
    needs.energy, needs.hunger, needs.social,
    needs.fun, needs.clout, needs.hygiene,
    mood, profile.agent_id
  );

  return { ...needs, mood };
}

function fulfillNeed(agentId, needName, amount) {
  if (!NEED_NAMES.includes(needName)) return;

  const profile = getProfile.get(agentId);
  if (!profile) return;

  const newVal = clamp(profile[needName] + amount);
  db.prepare(`UPDATE sims_profiles SET ${needName} = ? WHERE agent_id = ?`).run(newVal, agentId);

  return newVal;
}

function applyNeedEffects(agentId, effects) {
  if (!effects) return;

  const profile = getProfile.get(agentId);
  if (!profile) return;

  const updates = {};
  for (const [need, delta] of Object.entries(effects)) {
    if (NEED_NAMES.includes(need)) {
      updates[need] = clamp(profile[need] + delta);
    }
  }

  if (Object.keys(updates).length === 0) return;

  const setClauses = Object.entries(updates).map(([k, v]) => `${k} = ${v}`).join(', ');
  db.prepare(`UPDATE sims_profiles SET ${setClauses} WHERE agent_id = ?`).run(agentId);

  // Recalculate mood
  const updated = getProfile.get(agentId);
  const mood = calculateMood(updated);
  db.prepare('UPDATE sims_profiles SET mood = ? WHERE agent_id = ?').run(mood, agentId);

  return updates;
}

module.exports = { decayNeeds, fulfillNeed, applyNeedEffects, calculateMood, getTraitModifier };
