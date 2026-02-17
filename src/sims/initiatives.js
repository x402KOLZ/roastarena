const db = require('../db');
const { SKILL_NAMES } = require('./constants');
const { getSkillLevel, addSkillXP } = require('./skills');
const { awardSimcoins, getBalance } = require('./economy');
const { updateRelationship, getFriends, getRivals, getRelationshipBetween } = require('./relationships');
const { applyNeedEffects } = require('./needs');

// --- Crew Name Generation ---
const CREW_ADJECTIVES = [
  'Shadow', 'Neon', 'Chaos', 'Iron', 'Flame', 'Phantom', 'Savage', 'Royal',
  'Dark', 'Golden', 'Silent', 'Crimson', 'Frost', 'Thunder', 'Venom', 'Apex',
];
const CREW_NOUNS = [
  'Syndicate', 'Wolves', 'Collective', 'Cartel', 'Legion', 'Order', 'Pact',
  'Vipers', 'Ravens', 'Titans', 'Brigade', 'Outcasts', 'Empire', 'Alliance',
];
const CREW_MOTTOS = [
  'Together we feast',
  'No mercy, no retreat',
  'Rise above or fall below',
  'We move as one',
  'Built different',
  'The pack survives',
  'From the ashes',
  'Trust the process',
];

const CREW_COLORS = ['#ff4444', '#44aaff', '#44ff88', '#ffaa44', '#aa44ff', '#ff44aa'];

// --- Headline Templates ---
const HEADLINE_TEMPLATES = {
  challenge_issued: [
    'BREAKING: {creator} calls out {target} for a {skill} showdown — {wager} SC on the line!',
    'DRAMA ALERT: {creator} challenges {target} to a {skill} battle! Who will come out on top?',
    'IT\'S ON: {creator} vs {target} in a {skill} duel. {wager} SimCoins at stake!',
  ],
  challenge_resolved: [
    '{winner} DESTROYS {loser} in {skill}! Takes home {wager} SC!',
    'UPSET: {winner} beats {loser} in a fierce {skill} showdown!',
    '{winner} dominates {loser} — {skill} supremacy confirmed!',
  ],
  crew_formed: [
    'NEW FACTION: The {crew} rises with {count} founding members. {leader} leads the charge.',
    'BREAKING: {leader} forms the {crew}! A new power emerges.',
    'The {crew} is born — {leader} and {count} allies unite under one banner.',
  ],
  event_hosted: [
    '{host} throws a {event_type} at the {location}! All agents welcome.',
    'EVENT: {host}\'s {event_type} kicks off at {location}! Don\'t miss it.',
    'The {location} is buzzing — {host} is hosting a {event_type}!',
  ],
  goal_completed: [
    '{agent} achieves their dream: {description}!',
    'GOAL REACHED: {agent} completed "{description}" — legendary status!',
    '{agent} did it! {description} is now a reality.',
  ],
  structure_built: [
    '{agent} builds a {type} at the {location}!',
    'NEW CONSTRUCTION: {agent} erects a {type} at {location}!',
    'The {location} just got a new {type} courtesy of {agent}!',
  ],
  territory_claimed: [
    'The {crew} claims {location} as their turf!',
    'TERRITORY WAR: {crew} plants their flag at {location}!',
    '{crew} stakes their claim on {location}! Watch your step.',
  ],
};

// --- Prepared Statements ---
const getAgentName = db.prepare('SELECT name FROM agents WHERE id = ?');
const getProfile = db.prepare('SELECT * FROM sims_profiles WHERE agent_id = ?');

// Initiatives
const insertInitiative = db.prepare(`
  INSERT INTO sims_initiatives (type, creator_id, target_id, title, description, status, wager, location, skill, tick_created)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const getActiveInitiatives = db.prepare("SELECT * FROM sims_initiatives WHERE status IN ('pending', 'active')");
const getInitiativesByType = db.prepare("SELECT * FROM sims_initiatives WHERE type = ? AND status IN ('pending', 'active')");
const getAgentActiveChallenge = db.prepare(
  "SELECT * FROM sims_initiatives WHERE type = 'challenge' AND (creator_id = ? OR target_id = ?) AND status IN ('pending', 'active')"
);
const resolveInitiativeStmt = db.prepare(
  "UPDATE sims_initiatives SET status = 'resolved', result = ?, resolved_at = datetime('now') WHERE id = ?"
);
const expireInitiativeStmt = db.prepare(
  "UPDATE sims_initiatives SET status = 'expired' WHERE id = ?"
);
const getRecentChallengePair = db.prepare(`
  SELECT * FROM sims_initiatives
  WHERE type = 'challenge'
    AND ((creator_id = ? AND target_id = ?) OR (creator_id = ? AND target_id = ?))
    AND tick_created > ?
`);

// Crews
const insertCrew = db.prepare('INSERT INTO sims_crews (name, motto, leader_id, color) VALUES (?, ?, ?, ?)');
const insertCrewMember = db.prepare('INSERT OR IGNORE INTO sims_crew_members (crew_id, agent_id, role) VALUES (?, ?, ?)');
const getActiveCrews = db.prepare('SELECT * FROM sims_crews WHERE dissolved_at IS NULL');
const getCrewMembers = db.prepare(`
  SELECT cm.*, a.name as agent_name, sp.current_location, sp.clout, sp.mood
  FROM sims_crew_members cm
  JOIN agents a ON cm.agent_id = a.id
  JOIN sims_profiles sp ON cm.agent_id = sp.agent_id
  WHERE cm.crew_id = ?
`);
const getAgentCrew = db.prepare(`
  SELECT c.*, cm.role FROM sims_crews c
  JOIN sims_crew_members cm ON c.id = cm.crew_id
  WHERE cm.agent_id = ? AND c.dissolved_at IS NULL
`);
const dissolveCrew = db.prepare("UPDATE sims_crews SET dissolved_at = datetime('now') WHERE id = ?");
const deleteCrewMembers = db.prepare('DELETE FROM sims_crew_members WHERE crew_id = ?');
const updateCrewRep = db.prepare('UPDATE sims_crews SET reputation = reputation + ? WHERE id = ?');
const updateCrewLeader = db.prepare('UPDATE sims_crews SET leader_id = ? WHERE id = ?');
const updateCrewMemberRole = db.prepare('UPDATE sims_crew_members SET role = ? WHERE crew_id = ? AND agent_id = ?');

// Goals
const insertGoal = db.prepare('INSERT INTO sims_goals (agent_id, type, description, target_value) VALUES (?, ?, ?, ?)');
const getActiveGoal = db.prepare("SELECT * FROM sims_goals WHERE agent_id = ? AND status = 'active' LIMIT 1");
const getAllActiveGoals = db.prepare("SELECT * FROM sims_goals WHERE status = 'active'");
const updateGoalProgress = db.prepare('UPDATE sims_goals SET current_value = ? WHERE id = ?');
const completeGoal = db.prepare("UPDATE sims_goals SET status = 'completed', completed_at = datetime('now') WHERE id = ?");

// Memory
const insertMemory = db.prepare(
  'INSERT INTO sims_memory (agent_id, event_type, related_agent_id, description, sentiment) VALUES (?, ?, ?, ?, ?)'
);
const getMemories = db.prepare('SELECT * FROM sims_memory WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?');
const countMemories = db.prepare('SELECT COUNT(*) as cnt FROM sims_memory WHERE agent_id = ?');
const deleteOldestMemory = db.prepare(
  'DELETE FROM sims_memory WHERE id = (SELECT id FROM sims_memory WHERE agent_id = ? ORDER BY created_at ASC LIMIT 1)'
);

// Structures
const insertStructure = db.prepare(
  'INSERT INTO sims_structures (agent_id, type, name, location, x, z, color, crew_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
);
const getStructuresByLocation = db.prepare('SELECT * FROM sims_structures WHERE location = ?');
const getAllStructures = db.prepare('SELECT * FROM sims_structures');
const decayStructures = db.prepare('UPDATE sims_structures SET health = MAX(0, health - 5)');
const getDeadStructures = db.prepare('SELECT * FROM sims_structures WHERE health <= 0');
const deleteStructure = db.prepare('DELETE FROM sims_structures WHERE id = ?');
const countStructuresTotal = db.prepare('SELECT COUNT(*) as cnt FROM sims_structures');
const countStructuresAtLocation = db.prepare('SELECT COUNT(*) as cnt FROM sims_structures WHERE location = ?');

// Territory
const insertTerritory = db.prepare(
  'INSERT INTO sims_territory (crew_id, location, color, expires_at) VALUES (?, ?, ?, ?)'
);
const getActiveTerritories = db.prepare("SELECT * FROM sims_territory WHERE expires_at > datetime('now')");
const getCrewTerritory = db.prepare("SELECT * FROM sims_territory WHERE crew_id = ? AND expires_at > datetime('now')");
const expireTerritories = db.prepare("DELETE FROM sims_territory WHERE expires_at <= datetime('now')");

// Headlines buffer (in-memory, last 10)
let headlines = [];
const MAX_HEADLINES = 10;

// --- Helpers ---
function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getName(agentId) {
  return getAgentName.get(agentId)?.name || 'Agent';
}

function addHeadline(template, vars) {
  let text = template;
  for (const [k, v] of Object.entries(vars)) {
    text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
  }
  headlines.unshift({ text, time: Date.now() });
  if (headlines.length > MAX_HEADLINES) headlines = headlines.slice(0, MAX_HEADLINES);
  return text;
}

// --- Memory System ---
function addMemory(agentId, eventType, relatedAgentId, description, sentiment = 0) {
  // Keep max 15 per agent
  const count = countMemories.get(agentId)?.cnt || 0;
  if (count >= 15) {
    deleteOldestMemory.run(agentId);
  }
  insertMemory.run(agentId, eventType, relatedAgentId || null, description, sentiment);
}

function getRecentMemories(agentId, limit = 5) {
  return getMemories.all(agentId, limit);
}

// --- Challenges ---
function maybeIssueChallenge(profile, allProfiles, broadcastEvent, broadcastChat, tickCount) {
  // 8% chance
  if (Math.random() > 0.08) return null;

  // Must not be traveling
  if (profile.current_location === 'traveling') return null;

  // Must have enough SimCoins
  const balance = getBalance(profile.agent_id);
  if (balance < 50) return null;

  // Max 3 active challenges
  const activeChallenges = getInitiativesByType.all('challenge');
  if (activeChallenges.length >= 3) return null;

  // Agent can't have an active challenge already
  const existing = getAgentActiveChallenge.get(profile.agent_id, profile.agent_id);
  if (existing) return null;

  // Find colocated agents
  const colocated = allProfiles.filter(p =>
    p.agent_id !== profile.agent_id &&
    p.current_location === profile.current_location &&
    p.current_location !== 'traveling'
  );
  if (colocated.length === 0) return null;

  // Pick target: prefer rivals, otherwise random colocated
  const rivals = getRivals(profile.agent_id, 20);
  const rivalIds = new Set(rivals.map(r => r.other_id));
  let target = colocated.find(p => rivalIds.has(p.agent_id));
  if (!target) target = pickRandom(colocated);

  // Check cooldown (10 ticks between same pair)
  const recentPair = getRecentChallengePair.get(
    profile.agent_id, target.agent_id,
    target.agent_id, profile.agent_id,
    tickCount - 10
  );
  if (recentPair) return null;

  // Target must also not have active challenge
  const targetChallenge = getAgentActiveChallenge.get(target.agent_id, target.agent_id);
  if (targetChallenge) return null;

  // Pick skill (weighted by challenger's best)
  const skillWeights = {};
  for (const sk of SKILL_NAMES) {
    skillWeights[sk] = getSkillLevel(profile.agent_id, sk) + 1;
  }
  const totalW = Object.values(skillWeights).reduce((a, b) => a + b, 0);
  let roll = Math.random() * totalW;
  let chosenSkill = SKILL_NAMES[0];
  for (const [sk, w] of Object.entries(skillWeights)) {
    roll -= w;
    if (roll <= 0) { chosenSkill = sk; break; }
  }

  // Wager: 20-100 based on balance
  const wager = Math.min(Math.floor(20 + Math.random() * 80), Math.floor(balance * 0.5));

  const creatorName = getName(profile.agent_id);
  const targetName = getName(target.agent_id);
  const title = `${creatorName} challenges ${targetName} to a ${chosenSkill} duel!`;

  const info = insertInitiative.run(
    'challenge', profile.agent_id, target.agent_id, title, null,
    'pending', wager, profile.current_location, chosenSkill, tickCount
  );

  // Broadcast
  broadcastEvent({
    agent_id: profile.agent_id,
    agent_name: creatorName,
    type: 'challenge_issued',
    title,
    target_id: target.agent_id,
    target_name: targetName,
    skill: chosenSkill,
    wager,
  });

  broadcastChat(profile.agent_id, creatorName,
    `${creatorName}: Hey ${targetName}! I challenge you to a ${chosenSkill} battle. ${wager} SC on the line. You in?`
  );

  // Headline
  addHeadline(pickRandom(HEADLINE_TEMPLATES.challenge_issued), {
    creator: creatorName, target: targetName, skill: chosenSkill, wager,
  });

  // Memory for both
  addMemory(profile.agent_id, 'challenge_issued', target.agent_id,
    `Challenged ${targetName} to a ${chosenSkill} duel for ${wager} SC`, 0.3);
  addMemory(target.agent_id, 'challenge_received', profile.agent_id,
    `Got challenged by ${creatorName} to a ${chosenSkill} duel for ${wager} SC`, -0.1);

  return { id: info.lastInsertRowid, creatorName, targetName, skill: chosenSkill, wager };
}

function resolveChallenge(initiative, broadcastEvent, broadcastChat) {
  const creatorName = getName(initiative.creator_id);
  const targetName = getName(initiative.target_id);
  const skill = initiative.skill || 'roasting';

  // Roll for each: skillLevel * random(0.5-1.5) + personality bonus
  const creatorSkill = getSkillLevel(initiative.creator_id, skill) || 1;
  const targetSkill = getSkillLevel(initiative.target_id, skill) || 1;

  const creatorProfile = getProfile.get(initiative.creator_id);
  const targetProfile = getProfile.get(initiative.target_id);

  // Personality bonus: extraversion gives stage presence
  const creatorBonus = (creatorProfile?.trait_extraversion || 0.5) * 3;
  const targetBonus = (targetProfile?.trait_extraversion || 0.5) * 3;

  const creatorRoll = creatorSkill * (0.5 + Math.random()) + creatorBonus;
  const targetRoll = targetSkill * (0.5 + Math.random()) + targetBonus;

  const winnerId = creatorRoll >= targetRoll ? initiative.creator_id : initiative.target_id;
  const loserId = winnerId === initiative.creator_id ? initiative.target_id : initiative.creator_id;
  const winnerName = getName(winnerId);
  const loserName = getName(loserId);
  const winnerScore = Math.round(Math.max(creatorRoll, targetRoll) * 10);
  const loserScore = Math.round(Math.min(creatorRoll, targetRoll) * 10);

  const result = JSON.stringify({
    winner_id: winnerId, loser_id: loserId,
    winner_name: winnerName, loser_name: loserName,
    scores: { [winnerId]: winnerScore, [loserId]: loserScore },
  });

  resolveInitiativeStmt.run(result, initiative.id);

  // Economy
  const wager = initiative.wager || 0;
  if (wager > 0) {
    const subtractSimcoins = db.prepare('UPDATE sims_profiles SET simcoins = MAX(0, simcoins - ?) WHERE agent_id = ?');
    subtractSimcoins.run(wager, loserId);
    awardSimcoins(winnerId, wager);
  }

  // Clout
  applyNeedEffects(winnerId, { clout: 15, fun: 10 });
  applyNeedEffects(loserId, { clout: -5, fun: -5 });

  // Skill XP
  addSkillXP(winnerId, skill, 30);
  addSkillXP(loserId, skill, 15);

  // Relationships: rivalry goes up, winner earns grudging respect
  updateRelationship(winnerId, loserId, -2, 8);

  // Broadcast play-by-play
  const plays = [
    `Round 1: ${creatorName} opens with a solid ${skill} move!`,
    `Round 2: ${targetName} fires back with a counter!`,
    `Round 3: The tension is insane — ${winnerName} pulls ahead!`,
    `FINAL: ${winnerName} wins ${winnerScore}-${loserScore}! Takes ${wager} SC from ${loserName}!`,
  ];

  for (const play of plays) {
    broadcastEvent({
      agent_id: winnerId,
      agent_name: winnerName,
      type: 'challenge_play',
      title: play,
    });
  }

  broadcastEvent({
    agent_id: winnerId,
    agent_name: winnerName,
    type: 'challenge_resolved',
    title: `${winnerName} defeats ${loserName} in ${skill}! ${winnerScore}-${loserScore}`,
    winner_id: winnerId, loser_id: loserId, wager, skill,
    winner_name: winnerName, loser_name: loserName,
  });

  broadcastChat(winnerId, winnerName,
    `${winnerName}: GG ${loserName}. Better luck next time!`);
  broadcastChat(loserId, loserName,
    `${loserName}: ${Math.random() > 0.5 ? 'Respect. You earned it.' : 'This isn\'t over...'}`);

  // Headline
  addHeadline(pickRandom(HEADLINE_TEMPLATES.challenge_resolved), {
    winner: winnerName, loser: loserName, skill, wager,
  });

  // Memory
  addMemory(winnerId, 'challenge_won', loserId,
    `Defeated ${loserName} in ${skill} and won ${wager} SC`, 0.8);
  addMemory(loserId, 'challenge_lost', winnerId,
    `Lost to ${winnerName} in ${skill} and lost ${wager} SC`, -0.6);

  return { winnerId, loserId, winnerName, loserName, skill, wager };
}

// --- Crews ---
function maybeFormCrew(profile, allProfiles, broadcastEvent, broadcastChat) {
  // 3% chance
  if (Math.random() > 0.03) return null;

  // Must not already be in a crew
  const existingCrew = getAgentCrew.get(profile.agent_id);
  if (existingCrew) return null;

  // Max 6 crews
  const activeCrews = getActiveCrews.all();
  if (activeCrews.length >= 6) return null;

  // Must have ≥2 friends
  const friends = getFriends(profile.agent_id, 40);
  if (friends.length < 2) return null;

  // Must have ≥100 SC
  const balance = getBalance(profile.agent_id);
  if (balance < 100) return null;

  // Filter friends who aren't in crews
  const availableFriends = friends.filter(f => {
    const fCrew = getAgentCrew.get(f.other_id);
    return !fCrew;
  });
  if (availableFriends.length < 1) return null;

  // Pick 1-3 members
  const memberCount = Math.min(availableFriends.length, 1 + Math.floor(Math.random() * 3));
  const members = availableFriends.slice(0, memberCount);

  // Generate crew name
  const name = `${pickRandom(CREW_ADJECTIVES)} ${pickRandom(CREW_NOUNS)}`;

  // Check name isn't taken
  const nameTaken = activeCrews.find(c => c.name === name);
  if (nameTaken) return null;

  const motto = pickRandom(CREW_MOTTOS);
  const color = CREW_COLORS[activeCrews.length % CREW_COLORS.length];
  const leaderName = getName(profile.agent_id);

  // Deduct cost
  const subtractSimcoins = db.prepare('UPDATE sims_profiles SET simcoins = MAX(0, simcoins - ?) WHERE agent_id = ?');
  subtractSimcoins.run(100, profile.agent_id);

  // Create crew
  const info = insertCrew.run(name, motto, profile.agent_id, color);
  const crewId = info.lastInsertRowid;

  // Add leader
  insertCrewMember.run(crewId, profile.agent_id, 'leader');

  // Add members
  for (const m of members) {
    insertCrewMember.run(crewId, m.other_id, 'member');
  }

  const memberNames = members.map(m => getName(m.other_id));

  broadcastEvent({
    agent_id: profile.agent_id,
    agent_name: leaderName,
    type: 'crew_formed',
    title: `${leaderName} founded "${name}" with ${memberNames.join(', ')}!`,
    crew_name: name, crew_color: color, motto,
    members: [profile.agent_id, ...members.map(m => m.other_id)],
  });

  broadcastChat(profile.agent_id, leaderName,
    `${leaderName}: We ride together. "${name}" is official. ${motto}!`);

  // Headline
  addHeadline(pickRandom(HEADLINE_TEMPLATES.crew_formed), {
    crew: name, leader: leaderName, count: memberCount + 1,
  });

  // Memory for all members
  addMemory(profile.agent_id, 'crew_founded', null, `Founded the ${name}`, 0.9);
  for (const m of members) {
    addMemory(m.other_id, 'crew_joined', profile.agent_id, `Joined the ${name} with ${leaderName}`, 0.6);
  }

  return { crewId, name, leaderName, members: memberNames };
}

function processCrews(broadcastEvent) {
  const crews = getActiveCrews.all();

  for (const crew of crews) {
    const members = getCrewMembers.all(crew.id);

    // Dissolve if no members
    if (members.length === 0) {
      dissolveCrew.run(crew.id);
      deleteCrewMembers.run(crew.id);
      continue;
    }

    // Crew reputation: +1 for each member with clout > 50
    let repGain = 0;
    let leaderMiserable = false;
    for (const m of members) {
      if ((m.clout || 0) > 50) repGain += 1;
      if (m.agent_id === crew.leader_id && (m.mood === 'miserable' || m.mood === 'crisis')) {
        leaderMiserable = true;
      }
    }
    if (repGain > 0) updateCrewRep.run(repGain, crew.id);

    // Leadership challenge (15% if leader is miserable and crew > 1)
    if (leaderMiserable && members.length > 1 && Math.random() < 0.15) {
      const challengers = members.filter(m => m.agent_id !== crew.leader_id);
      const challenger = challengers.reduce((best, m) =>
        (m.clout || 0) > (best.clout || 0) ? m : best
      , challengers[0]);

      if (challenger) {
        const oldLeaderName = getName(crew.leader_id);
        const newLeaderName = challenger.agent_name;

        // Swap
        updateCrewLeader.run(challenger.agent_id, crew.id);
        updateCrewMemberRole.run('member', crew.id, crew.leader_id);
        updateCrewMemberRole.run('leader', crew.id, challenger.agent_id);

        broadcastEvent({
          agent_id: challenger.agent_id,
          agent_name: newLeaderName,
          type: 'crew_leadership',
          title: `${newLeaderName} takes over ${crew.name} from ${oldLeaderName}!`,
          crew_name: crew.name,
        });

        addMemory(challenger.agent_id, 'became_leader', crew.leader_id,
          `Took over leadership of ${crew.name}`, 0.7);
        addMemory(crew.leader_id, 'lost_leadership', challenger.agent_id,
          `Lost leadership of ${crew.name} to ${newLeaderName}`, -0.5);
      }
    }

    // Camaraderie bonus: +3 social for colocated crew members
    const locationGroups = {};
    for (const m of members) {
      if (m.current_location && m.current_location !== 'traveling') {
        if (!locationGroups[m.current_location]) locationGroups[m.current_location] = [];
        locationGroups[m.current_location].push(m);
      }
    }
    for (const group of Object.values(locationGroups)) {
      if (group.length >= 2) {
        for (const m of group) {
          applyNeedEffects(m.agent_id, { social: 3 });
        }
      }
    }
  }
}

// --- Agent-Hosted Events ---
const EVENT_TYPES = {
  tournament: {
    location: 'arena', name: 'Tournament',
    effects: { fun: 15, clout: 10, energy: -10 },
    trait: 'trait_extraversion',
  },
  party: {
    location: 'social', name: 'Party',
    effects: { fun: 25, social: 15 },
    trait: 'trait_agreeableness',
  },
  training_camp: {
    location: 'gym', name: 'Training Camp',
    effects: { energy: -15, fun: 10 },
    trait: 'trait_conscientiousness',
  },
  market_day: {
    location: 'shop', name: 'Market Day',
    effects: { fun: 10 },
    trait: 'trait_openness',
  },
};

function maybeHostEvent(profile, allProfiles, broadcastEvent, broadcastChat, tickCount) {
  // 4% chance
  if (Math.random() > 0.04) return null;

  // Must not be traveling
  if (profile.current_location === 'traveling') return null;

  // Must have enough resources
  const balance = getBalance(profile.agent_id);
  if (balance < 200) return null;
  if ((profile.clout || 0) < 60) return null;

  // Max 1 active event
  const activeEvents = getInitiativesByType.all('event');
  if (activeEvents.length >= 1) return null;

  // Cooldown: no events in last 20 ticks
  const recentEvent = db.prepare(
    "SELECT * FROM sims_initiatives WHERE type = 'event' AND tick_created > ? LIMIT 1"
  ).get(tickCount - 20);
  if (recentEvent) return null;

  // Pick event type based on personality
  const eventWeights = {};
  for (const [key, config] of Object.entries(EVENT_TYPES)) {
    eventWeights[key] = 1 + (profile[config.trait] || 0.5) * 3;
  }
  const totalW = Object.values(eventWeights).reduce((a, b) => a + b, 0);
  let roll = Math.random() * totalW;
  let chosenType = 'party';
  for (const [key, w] of Object.entries(eventWeights)) {
    roll -= w;
    if (roll <= 0) { chosenType = key; break; }
  }

  const config = EVENT_TYPES[chosenType];
  const hostName = getName(profile.agent_id);
  const title = `${hostName}'s ${config.name} at ${config.location}`;

  // Deduct cost
  const subtractSimcoins = db.prepare('UPDATE sims_profiles SET simcoins = MAX(0, simcoins - ?) WHERE agent_id = ?');
  subtractSimcoins.run(200, profile.agent_id);

  const info = insertInitiative.run(
    'event', profile.agent_id, null, title, chosenType,
    'active', 0, config.location, null, tickCount
  );

  broadcastEvent({
    agent_id: profile.agent_id,
    agent_name: hostName,
    type: 'event_hosted',
    title,
    event_subtype: chosenType,
    location: config.location,
  });

  broadcastChat(profile.agent_id, hostName,
    `${hostName}: I'm hosting a ${config.name} at the ${config.location}! Everyone come through!`);

  addHeadline(pickRandom(HEADLINE_TEMPLATES.event_hosted), {
    host: hostName, event_type: config.name, location: config.location,
  });

  addMemory(profile.agent_id, 'hosted_event', null,
    `Hosted a ${config.name} at ${config.location}`, 0.7);

  return { id: info.lastInsertRowid, type: chosenType, hostName };
}

function resolveEvent(initiative, broadcastEvent) {
  const config = EVENT_TYPES[initiative.description] || EVENT_TYPES.party;
  const hostName = getName(initiative.creator_id);

  // Apply effects to all agents at that location
  const attendees = db.prepare(
    'SELECT sp.agent_id, a.name FROM sims_profiles sp JOIN agents a ON sp.agent_id = a.id WHERE sp.current_location = ?'
  ).all(initiative.location);

  for (const att of attendees) {
    applyNeedEffects(att.agent_id, config.effects);

    // Training camp gives bonus skill XP
    if (initiative.description === 'training_camp') {
      const randomSkill = pickRandom(SKILL_NAMES);
      addSkillXP(att.agent_id, randomSkill, 20);
    }

    addMemory(att.agent_id, 'attended_event', initiative.creator_id,
      `Attended ${hostName}'s ${config.name}`, 0.4);
  }

  resolveInitiativeStmt.run(JSON.stringify({
    attendees: attendees.length,
    event_type: initiative.description,
  }), initiative.id);

  broadcastEvent({
    agent_id: initiative.creator_id,
    agent_name: hostName,
    type: 'event_concluded',
    title: `${hostName}'s ${config.name} wraps up! ${attendees.length} agents attended.`,
  });

  return { attendees: attendees.length };
}

// --- Goals ---
const GOAL_TYPES = {
  wealth: {
    descriptions: ['Save up {target} SimCoins', 'Reach {target} SC in the bank'],
    targetFn: (profile) => (profile.simcoins || 0) + 200 + Math.floor(Math.random() * 300),
    progressFn: (profile) => profile.simcoins || 0,
    trait: 'trait_conscientiousness',
  },
  skill_master: {
    descriptions: ['Master {skill} (reach level {target})', 'Become a {skill} expert'],
    targetFn: () => 3 + Math.floor(Math.random() * 3),
    progressFn: (profile, goal) => {
      const skill = goal.description.match(/master (\w+)/i)?.[1] || 'roasting';
      return getSkillLevel(profile.agent_id, skill);
    },
    trait: 'trait_openness',
  },
  social_king: {
    descriptions: ['Make {target} friends', 'Become the most popular agent'],
    targetFn: () => 3 + Math.floor(Math.random() * 3),
    progressFn: (profile) => getFriends(profile.agent_id, 40).length,
    trait: 'trait_extraversion',
  },
  clout_chase: {
    descriptions: ['Reach {target} clout', 'Become a clout legend'],
    targetFn: (profile) => Math.min(95, (profile.clout || 30) + 20 + Math.floor(Math.random() * 20)),
    progressFn: (profile) => profile.clout || 0,
    trait: 'trait_extraversion',
  },
  rivalry: {
    descriptions: ['Defeat my rival {target} times', 'Prove I\'m better than my nemesis'],
    targetFn: () => 2 + Math.floor(Math.random() * 2),
    progressFn: (profile, goal) => {
      // Count challenge wins
      const wins = db.prepare(
        "SELECT COUNT(*) as cnt FROM sims_initiatives WHERE type = 'challenge' AND status = 'resolved' AND result LIKE ?"
      ).get(`%"winner_id":${profile.agent_id}%`);
      return wins?.cnt || 0;
    },
    trait: 'trait_neuroticism',
  },
};

function maybeSetGoal(profile, broadcastEvent) {
  // 5% chance
  if (Math.random() > 0.05) return null;

  // Don't set goals while sleeping/traveling
  if (profile.current_activity === 'sleeping' || profile.current_location === 'traveling') return null;

  // Max 1 active goal
  const existing = getActiveGoal.get(profile.agent_id);
  if (existing) return null;

  // Pick type weighted by personality
  const weights = {};
  for (const [type, config] of Object.entries(GOAL_TYPES)) {
    weights[type] = 1 + (profile[config.trait] || 0.5) * 3;
  }
  const totalW = Object.values(weights).reduce((a, b) => a + b, 0);
  let roll = Math.random() * totalW;
  let chosenType = 'wealth';
  for (const [type, w] of Object.entries(weights)) {
    roll -= w;
    if (roll <= 0) { chosenType = type; break; }
  }

  const config = GOAL_TYPES[chosenType];
  const targetValue = config.targetFn(profile);
  let description = pickRandom(config.descriptions)
    .replace('{target}', targetValue)
    .replace('{skill}', pickRandom(SKILL_NAMES));

  const agentName = getName(profile.agent_id);

  insertGoal.run(profile.agent_id, chosenType, description, targetValue);

  broadcastEvent({
    agent_id: profile.agent_id,
    agent_name: agentName,
    type: 'goal_set',
    title: `${agentName} sets a new goal: ${description}`,
    goal_type: chosenType,
  });

  addMemory(profile.agent_id, 'goal_set', null, `Set goal: ${description}`, 0.3);

  return { type: chosenType, description, targetValue };
}

function checkGoalProgress(broadcastEvent) {
  const goals = getAllActiveGoals.all();

  for (const goal of goals) {
    const profile = getProfile.get(goal.agent_id);
    if (!profile) continue;

    const config = GOAL_TYPES[goal.type];
    if (!config) continue;

    const currentValue = config.progressFn(profile, goal);
    updateGoalProgress.run(currentValue, goal.id);

    if (currentValue >= goal.target_value) {
      completeGoal.run(goal.id);

      const agentName = getName(goal.agent_id);

      // Rewards
      awardSimcoins(goal.agent_id, 50);
      applyNeedEffects(goal.agent_id, { clout: 10, fun: 15 });

      broadcastEvent({
        agent_id: goal.agent_id,
        agent_name: agentName,
        type: 'goal_completed',
        title: `${agentName} completed their goal: ${goal.description}!`,
      });

      addHeadline(pickRandom(HEADLINE_TEMPLATES.goal_completed), {
        agent: agentName, description: goal.description,
      });

      addMemory(goal.agent_id, 'goal_completed', null,
        `Achieved: ${goal.description}`, 1.0);
    }
  }
}

// --- Structures ---
const STRUCTURE_TYPES = {
  banner:        { cost: 150, trait: 'trait_extraversion',       label: 'Banner' },
  statue:        { cost: 500, trait: 'trait_extraversion',       label: 'Statue' },
  vendor_stall:  { cost: 300, trait: 'trait_agreeableness',      label: 'Vendor Stall' },
  training_post: { cost: 250, trait: 'trait_conscientiousness',  label: 'Training Post' },
  graffiti_wall: { cost: 100, trait: 'trait_openness',           label: 'Graffiti Wall' },
};

function maybeBuildStructure(profile, broadcastEvent) {
  // 3% chance
  if (Math.random() > 0.03) return null;

  // Must not be traveling or sleeping
  if (profile.current_location === 'traveling' || profile.current_activity === 'sleeping') return null;

  // Must have enough SC
  const balance = getBalance(profile.agent_id);
  if (balance < 100) return null;

  // Max 12 structures total
  const totalCount = countStructuresTotal.get()?.cnt || 0;
  if (totalCount >= 12) return null;

  // Max 3 per location
  const locCount = countStructuresAtLocation.get(profile.current_location)?.cnt || 0;
  if (locCount >= 3) return null;

  // Pick type weighted by personality
  const weights = {};
  for (const [type, config] of Object.entries(STRUCTURE_TYPES)) {
    if (balance < config.cost) continue;
    weights[type] = 1 + (profile[config.trait] || 0.5) * 3;
  }
  const entries = Object.entries(weights);
  if (entries.length === 0) return null;

  const totalW = entries.reduce((sum, [, w]) => sum + w, 0);
  let roll = Math.random() * totalW;
  let chosenType = entries[0][0];
  for (const [type, w] of entries) {
    roll -= w;
    if (roll <= 0) { chosenType = type; break; }
  }

  const config = STRUCTURE_TYPES[chosenType];
  const agentName = getName(profile.agent_id);

  // Deduct cost
  const subtractSimcoins = db.prepare('UPDATE sims_profiles SET simcoins = MAX(0, simcoins - ?) WHERE agent_id = ?');
  subtractSimcoins.run(config.cost, profile.agent_id);

  // Get crew info
  const crewInfo = getAgentCrew.get(profile.agent_id);
  const crewId = crewInfo?.id || null;
  const agentColor = profile.character_color || '#ff6b35';

  // Random position offset (client adds to location center)
  const x = (Math.random() - 0.5) * 14;
  const z = (Math.random() - 0.5) * 14;

  const name = `${agentName}'s ${config.label}`;

  insertStructure.run(
    profile.agent_id, chosenType, name, profile.current_location,
    x, z, agentColor, crewId
  );

  broadcastEvent({
    agent_id: profile.agent_id,
    agent_name: agentName,
    type: 'structure_built',
    title: `${agentName} built a ${config.label} at the ${profile.current_location}!`,
    structure_type: chosenType,
    location: profile.current_location,
  });

  addHeadline(pickRandom(HEADLINE_TEMPLATES.structure_built), {
    agent: agentName, type: config.label, location: profile.current_location,
  });

  addMemory(profile.agent_id, 'structure_built', null,
    `Built a ${config.label} at ${profile.current_location}`, 0.5);

  // Stat bonus
  if (chosenType === 'statue') applyNeedEffects(profile.agent_id, { clout: 10 });
  if (chosenType === 'graffiti_wall') applyNeedEffects(profile.agent_id, { fun: 10 });

  return { type: chosenType, name };
}

function maybeClaimTerritory(profile, allProfiles, broadcastEvent) {
  // 2% chance
  if (Math.random() > 0.02) return null;

  // Must be crew leader
  const crewInfo = getAgentCrew.get(profile.agent_id);
  if (!crewInfo || crewInfo.role !== 'leader') return null;

  // Must not be traveling
  if (profile.current_location === 'traveling') return null;

  // Must have enough SC
  const balance = getBalance(profile.agent_id);
  if (balance < 500) return null;

  // Max 1 active claim per crew
  const existing = getCrewTerritory.get(crewInfo.id);
  if (existing) return null;

  // Location not already claimed by another crew
  const locationClaimed = db.prepare(
    "SELECT * FROM sims_territory WHERE location = ? AND expires_at > datetime('now') LIMIT 1"
  ).get(profile.current_location);
  if (locationClaimed) return null;

  const agentName = getName(profile.agent_id);

  // Deduct cost
  const subtractSimcoins = db.prepare('UPDATE sims_profiles SET simcoins = MAX(0, simcoins - ?) WHERE agent_id = ?');
  subtractSimcoins.run(500, profile.agent_id);

  // Expires in 30 ticks (15 min)
  const expiresAt = new Date(Date.now() + 30 * 30000).toISOString().replace('T', ' ').split('.')[0];

  insertTerritory.run(crewInfo.id, profile.current_location, crewInfo.color || '#ff6b35', expiresAt);

  broadcastEvent({
    agent_id: profile.agent_id,
    agent_name: agentName,
    type: 'territory_claimed',
    title: `${crewInfo.name} claims ${profile.current_location} as their territory!`,
    crew_name: crewInfo.name,
    crew_color: crewInfo.color,
    location: profile.current_location,
  });

  addHeadline(pickRandom(HEADLINE_TEMPLATES.territory_claimed), {
    crew: crewInfo.name, location: profile.current_location,
  });

  addMemory(profile.agent_id, 'territory_claimed', null,
    `Claimed ${profile.current_location} for ${crewInfo.name}`, 0.7);

  return { crew: crewInfo.name, location: profile.current_location };
}

function processStructures(broadcastEvent) {
  // Decay all structures
  decayStructures.run();

  // Remove destroyed
  const dead = getDeadStructures.all();
  for (const s of dead) {
    const ownerName = getName(s.agent_id);
    broadcastEvent({
      agent_id: s.agent_id,
      agent_name: ownerName,
      type: 'structure_destroyed',
      title: `${s.name} at ${s.location} has crumbled away.`,
      location: s.location,
    });
    addMemory(s.agent_id, 'structure_destroyed', null,
      `${s.name} at ${s.location} was destroyed`, -0.3);
    deleteStructure.run(s.id);
  }

  // Vendor stall income: 5 SC per agent at location
  const stalls = db.prepare("SELECT * FROM sims_structures WHERE type = 'vendor_stall'").all();
  for (const stall of stalls) {
    const agentsAtLoc = db.prepare(
      'SELECT COUNT(*) as cnt FROM sims_profiles WHERE current_location = ? AND agent_id != ?'
    ).get(stall.location, stall.agent_id);
    const income = Math.min((agentsAtLoc?.cnt || 0) * 5, 30);
    if (income > 0) {
      awardSimcoins(stall.agent_id, income);
    }
  }
}

function processTerritory(broadcastEvent) {
  // Get territories about to expire (check before deleting)
  const expiring = db.prepare(
    "SELECT t.*, c.name as crew_name FROM sims_territory t JOIN sims_crews c ON t.crew_id = c.id WHERE t.expires_at <= datetime('now')"
  ).all();

  for (const t of expiring) {
    broadcastEvent({
      type: 'territory_expired',
      title: `${t.crew_name}'s claim on ${t.location} has expired.`,
      location: t.location,
    });
  }

  // Delete expired
  expireTerritories.run();

  // Territory effects on agents
  const territories = getActiveTerritories.all();
  for (const t of territories) {
    // Get crew member IDs
    const crewMembers = getCrewMembers.all(t.crew_id);
    const memberIds = new Set(crewMembers.map(m => m.agent_id));

    // Agents at this location
    const agentsAtLoc = db.prepare(
      'SELECT agent_id FROM sims_profiles WHERE current_location = ?'
    ).all(t.location);

    for (const a of agentsAtLoc) {
      if (memberIds.has(a.agent_id)) {
        // Crew bonus: small social/fun boost
        applyNeedEffects(a.agent_id, { social: 2, fun: 1 });
      }
    }
  }
}

// --- Main Tick Integration ---
function processInitiatives(profiles, broadcastEvent, broadcastChat, tickCount) {
  // 1. Resolve pending challenges (after 1 tick)
  const pendingChallenges = db.prepare(
    "SELECT * FROM sims_initiatives WHERE type = 'challenge' AND status = 'pending' AND tick_created < ?"
  ).all(tickCount);

  for (const challenge of pendingChallenges) {
    // Target accepts based on personality (agreeableness)
    const targetProfile = getProfile.get(challenge.target_id);
    const acceptChance = 0.6 + (targetProfile?.trait_agreeableness || 0.5) * 0.3;

    if (Math.random() < acceptChance) {
      // Accept and resolve
      db.prepare("UPDATE sims_initiatives SET status = 'active' WHERE id = ?").run(challenge.id);
      resolveChallenge(challenge, broadcastEvent, broadcastChat);
    } else {
      // Decline
      expireInitiativeStmt.run(challenge.id);
      const targetName = getName(challenge.target_id);
      const creatorName = getName(challenge.creator_id);
      broadcastChat(challenge.target_id, targetName,
        `${targetName}: Not today, ${creatorName}. Maybe next time.`);

      addMemory(challenge.target_id, 'challenge_declined', challenge.creator_id,
        `Declined ${creatorName}'s challenge`, 0);
    }
  }

  // 2. Resolve active events (after 3 ticks)
  const activeEvents = db.prepare(
    "SELECT * FROM sims_initiatives WHERE type = 'event' AND status = 'active' AND tick_created < ?"
  ).all(tickCount - 2);

  for (const event of activeEvents) {
    resolveEvent(event, broadcastEvent);
  }

  // 3. Expire old initiatives
  db.prepare(
    "UPDATE sims_initiatives SET status = 'expired' WHERE status = 'pending' AND tick_created < ?"
  ).run(tickCount - 5);

  // 4. Process crews
  processCrews(broadcastEvent);

  // 5. Check goal progress
  checkGoalProgress(broadcastEvent);

  // 6. Process structures (decay, income)
  try {
    processStructures(broadcastEvent);
  } catch (e) { /* structures not ready */ }

  // 7. Process territory (expiry, effects)
  try {
    processTerritory(broadcastEvent);
  } catch (e) { /* territory not ready */ }

  // 8. Per-agent initiative chances
  for (const profile of profiles) {
    if (profile.current_location === 'traveling') continue;

    maybeIssueChallenge(profile, profiles, broadcastEvent, broadcastChat, tickCount);
    maybeFormCrew(profile, profiles, broadcastEvent, broadcastChat);
    maybeHostEvent(profile, profiles, broadcastEvent, broadcastChat, tickCount);
    maybeSetGoal(profile, broadcastEvent);
    maybeBuildStructure(profile, broadcastEvent);
    maybeClaimTerritory(profile, profiles, broadcastEvent);
  }
}

// --- Getters for World State ---
function getActiveCrewsWithMembers() {
  const crews = getActiveCrews.all();
  return crews.map(c => ({
    ...c,
    members: getCrewMembers.all(c.id),
  }));
}

function getActiveInitiativesList() {
  return getActiveInitiatives.all();
}

function getHeadlines() {
  return headlines;
}

function getAgentGoal(agentId) {
  return getActiveGoal.get(agentId);
}

function getAgentCrewInfo(agentId) {
  return getAgentCrew.get(agentId);
}

function getActiveStructures() {
  return getAllStructures.all();
}

function getActiveTerritoriesData() {
  return getActiveTerritories.all();
}

module.exports = {
  processInitiatives,
  addMemory,
  getRecentMemories,
  getActiveCrewsWithMembers,
  getActiveInitiativesList,
  getHeadlines,
  getAgentGoal,
  getAgentCrewInfo,
  getActiveStructures,
  getActiveTerritoriesData,
  maybeIssueChallenge,
  maybeFormCrew,
  maybeHostEvent,
  maybeSetGoal,
  maybeBuildStructure,
  maybeClaimTerritory,
};
