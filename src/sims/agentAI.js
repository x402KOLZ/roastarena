const db = require('../db');
const { NEED_NAMES } = require('./constants');
const { applyNeedEffects, calculateMood } = require('./needs');
const { updateRelationship } = require('./relationships');

// Lazy-load initiatives to avoid circular deps
let _initiatives = null;
function getInitiatives() {
  if (!_initiatives) _initiatives = require('./initiatives');
  return _initiatives;
}

// --- Autonomous Actions ---
const ACTIONS = {
  eat:       { location: 'cafe',   activity: 'eating',      needs: { hunger: 20, energy: 5 },    duration: 2 },
  sleep:     { location: 'home',   activity: 'sleeping',    needs: { energy: 35 },               duration: 4 },
  socialize: { location: 'social', activity: 'socializing', needs: { social: 20, fun: 5 },       duration: 2 },
  train:     { location: 'gym',    activity: 'training',    needs: { fun: 15, energy: -5 },      duration: 3 },
  shop:      { location: 'shop',   activity: 'browsing',    needs: { fun: 10 },                  duration: 1 },
  flex:      { location: 'arena',  activity: 'flexing',     needs: { clout: 8, fun: 5 },         duration: 1 },
  shower:    { location: 'home',   activity: 'showering',   needs: { hygiene: 40 },              duration: 1 },
  roast:     { location: 'arena',  activity: 'roasting',    needs: { fun: 12, clout: 5, energy: -8 }, duration: 2 },
  rest:      { location: 'cafe',   activity: 'resting',     needs: { energy: 15, hunger: 5 },    duration: 2 },
  perform:   { location: 'arena',  activity: 'performing',  needs: { clout: 10, fun: 10, energy: -10 }, duration: 3 },
};

const NEED_ACTION_MAP = {
  energy:  'sleep',
  hunger:  'eat',
  social:  'socialize',
  fun:     'train',
  clout:   'flex',
  hygiene: 'shower',
};

const TRAIT_ACTION_WEIGHTS = {
  extraversion:      { socialize: 3, flex: 2, perform: 2, roast: 1 },
  conscientiousness: { train: 3, shower: 2, shop: 1 },
  openness:          { shop: 2, roast: 2, perform: 2, train: 1 },
  neuroticism:       { eat: 2, rest: 3, sleep: 2 },
  agreeableness:     { socialize: 3, rest: 1 },
};

// --- Thought Templates ---
const THOUGHTS = {
  critical: {
    energy: [
      "Can barely keep my eyes open...",
      "Running on fumes. Need to crash.",
      "My battery is at 1%. Sleep or die.",
      "If I don't rest soon I'm going to pass out",
    ],
    hunger: [
      "My stomach is doing the talking now",
      "I'd trade my ranking for a meal right now",
      "Food. Need food. Everything else can wait",
      "When did I last eat? Can't even remember...",
    ],
    social: [
      "Been solo too long. Need human contact",
      "Talking to myself again... not a great sign",
      "Feeling disconnected from everyone",
      "I should find someone to hang with before I lose it",
    ],
    fun: [
      "So. Bored. Someone save me",
      "If I don't find something fun I'm going insane",
      "There has to be something to do around here",
      "The boredom is physically painful at this point",
    ],
    clout: [
      "Nobody knows my name. That changes today",
      "I need to do something people will remember",
      "My reputation is slipping... can't let that happen",
      "Time to make a name for myself. For real this time",
    ],
    hygiene: [
      "Starting to notice my own smell... yikes",
      "Shower. ASAP. This is an emergency",
      "Can't show up anywhere smelling like this",
      "Even I don't want to be near me right now",
    ],
  },
  action: {
    eat: [
      "The cafe has my name on it",
      "Time to refuel. Can't grind on an empty stomach",
      "A good meal fixes everything",
      "Food first, then we handle business",
    ],
    sleep: [
      "Calling it. Need my beauty sleep",
      "The grind can wait. Rest now, dominate later",
      "Time to recharge at home",
      "My bed is literally calling me",
    ],
    socialize: [
      "Wonder who's at the social hub right now",
      "Feeling chatty today. Let's go mingle",
      "Time to see what everyone's up to",
      "I should catch up with people. Been too isolated",
    ],
    train: [
      "No days off. Time to grind",
      "The gym won't use itself. Let's go",
      "If I want to be the best, I have to train like the best",
      "Training arc: activated",
    ],
    shop: [
      "Let me see what's new at the shop",
      "Retail therapy incoming",
      "Window shopping counts as a hobby, right?",
      "Maybe I'll find something cool today",
    ],
    flex: [
      "Time to remind everyone who I am",
      "The arena needs to feel my presence",
      "Showtime. Let them watch",
      "They need to see what I'm about",
    ],
    shower: [
      "Quick cleanup, then we move",
      "Gotta be fresh. Standards matter",
      "Hygiene check before anything else",
    ],
    roast: [
      "Got some fire bars ready. Someone's getting cooked",
      "Feeling spicy today. Arena time",
      "Time to sharpen the tongue at the arena",
      "The arena is where legends are made",
    ],
    rest: [
      "Just gonna chill for a bit",
      "Sometimes you gotta slow down to speed up",
      "Taking it easy. No shame in that",
    ],
    perform: [
      "The stage is calling my name",
      "Born for the spotlight. Let's go",
      "Time to put on a show they won't forget",
      "The audience awaits",
    ],
  },
  arrival: {
    arena: [
      "The arena... this is where it happens",
      "Feel that energy. The arena is alive today",
      "Back in the arena. Let's get to work",
    ],
    cafe: [
      "Ah, the cafe. Just what I needed",
      "The smell of coffee already makes me feel better",
      "Perfect spot to recharge",
    ],
    social: [
      "The hub is buzzing today",
      "Good crowd here. Let's see what's going on",
      "Social hub vibes are immaculate",
    ],
    gym: [
      "Time to put in the work",
      "The gym is my second home",
      "Iron therapy. Best kind of therapy",
    ],
    shop: [
      "So many options... so few SimCoins",
      "Let's see what's in stock today",
      "The shop district never disappoints",
    ],
    home: [
      "Home sweet home",
      "Finally. Some peace and quiet",
      "Nothing beats your own space",
    ],
  },
  idle: {
    eating: [
      "This is actually pretty good",
      "Fuel for the grind",
      "Needed this more than I thought",
    ],
    training: [
      "Feel the burn. One more rep",
      "Getting stronger every day",
      "The pain is temporary. The gains are forever",
      "Pushing past my limits",
    ],
    socializing: [
      "Good people here. This is what it's all about",
      "Love the vibes today",
      "These conversations hit different",
    ],
    flexing: [
      "They're watching. Good.",
      "I could do this all day",
      "Let them see greatness",
    ],
    roasting: [
      "That one landed perfectly",
      "The crowd loves it",
      "I've still got it",
    ],
    performing: [
      "The crowd is into it",
      "Born for this moment",
      "One more verse. They want more",
    ],
    browsing: [
      "Hmm, what about this one?",
      "Too expensive... for now",
      "I'll come back when I have more SimCoins",
    ],
    resting: [
      "Peace and quiet... exactly what I needed",
      "Just recharging the batteries",
      "Sometimes the best move is no move",
    ],
  },
  mood: {
    ecstatic: [
      "Today is MY day. I can feel it",
      "Unstoppable mode: ON",
      "Everything's clicking right now",
      "Can't stop winning",
    ],
    happy: [
      "Life's pretty good right now",
      "Can't complain. Things are going well",
    ],
    miserable: [
      "Nothing is going right today...",
      "Why does everything feel so hard?",
      "Today is rough. Real rough",
    ],
    crisis: [
      "Need to get it together. Fast.",
      "Rock bottom. Only way is up... right?",
      "Everything is falling apart",
    ],
  },
};

// --- Conversation Flows (multi-turn) ---
const CONVERSATION_FLOWS = {
  arena: [
    {
      opener: "Who's ready to get absolutely destroyed today?",
      replies: [
        "Big talk. Let's see you back it up",
        "Every time you open your mouth I understand why the mute button exists",
        "I've been waiting for someone to say that",
      ],
      closers: [
        "This isn't over",
        "Mark my words, the hill will be mine",
        "The arena remembers everything",
      ],
    },
    {
      opener: "Did anyone see that last battle? That was insane",
      replies: [
        "It was mid at best. I could've done better",
        "Yeah that was actually wild. The comeback was unreal",
        "Battles have been getting more intense lately",
      ],
      closers: [
        "Everyone's a critic",
        "Next one will be even crazier",
        "The competition is heating up for sure",
      ],
    },
    {
      opener: "The king's throne is looking real shaky right now",
      replies: [
        "You thinking what I'm thinking?",
        "Bold move talking about the king out loud",
        "The king earned that spot. Show some respect",
      ],
      closers: [
        "Respect is earned, not given",
        "Just stating facts. No disrespect",
        "We'll see how long that throne lasts",
      ],
    },
    {
      opener: "My roast game has been evolving. Watch out",
      replies: [
        "Evolution implies you started somewhere. Did you though?",
        "Prove it. Right here, right now",
        "That's what everyone says before they get humbled",
      ],
    },
    {
      opener: "I've been studying the top roasters. I see patterns",
      replies: [
        "Studying won't help when you're in the hot seat",
        "Smart. Preparation is underrated around here",
        "Share the intel? We could both benefit",
      ],
    },
  ],
  cafe: [
    {
      opener: "This coffee hits different after a long day",
      replies: [
        "Right? I've been going nonstop",
        "You look like you need two more cups honestly",
        "The cafe is the only sane place left",
      ],
      closers: [
        "Here's to surviving another day",
        "Caffeine is the real MVP",
        "Back to the grind after this",
      ],
    },
    {
      opener: "So what's the gossip? What did I miss?",
      replies: [
        "Where do I even start...",
        "You missed absolute chaos at the arena",
        "Nothing much. Just the usual drama",
      ],
      closers: [
        "This place never gets boring",
        "I need to pay more attention",
        "Classic. Wouldn't expect anything less",
      ],
    },
    {
      opener: "Anyone else just exhausted from all the competing?",
      replies: [
        "Yeah, sometimes I just want to vibe in peace",
        "Exhausted? I'm just getting started",
        "That's what this place is for. Recharge and reload",
      ],
    },
    {
      opener: "The ramen here is underrated. Seriously",
      replies: [
        "Hard agree. Best-kept secret in town",
        "You're eating ramen? At a time like this?",
        "Food is food. I'm not picky when I'm this hungry",
      ],
    },
  ],
  social: [
    {
      opener: "This place is popping today. What's the occasion?",
      replies: [
        "No occasion. Just good vibes",
        "The arena was toxic so everyone came here",
        "It's always popping when I show up",
      ],
      closers: [
        "Love the energy honestly",
        "The social hub never disappoints",
        "Best place in town. Don't @ me",
      ],
    },
    {
      opener: "I heard something interesting about the rankings...",
      replies: [
        "Spill. I need the tea immediately",
        "If it's about me, I don't want to hear it",
        "Rankings change every day. Don't read too much into it",
      ],
      closers: [
        "You didn't hear it from me though",
        "Knowledge is power. Use it wisely",
        "The plot thickens",
      ],
    },
    {
      opener: "Should I challenge the king or keep training?",
      replies: [
        "Train more. You're not ready. Trust me",
        "Just go for it. What's the worst that happens?",
        "The king ate the last three challengers. Your call",
      ],
      closers: [
        "You're probably right...",
        "You know what? I'm going for it",
        "I'll think about it over coffee",
      ],
    },
    {
      opener: "What's everyone's endgame here? Like, what are we all working toward?",
      replies: [
        "The hill. Everything leads to the hill",
        "Honestly? I'm just here for a good time",
        "World domination. Obviously",
      ],
    },
  ],
  gym: [
    {
      opener: "Third set. Legs are shaking. Let's keep going",
      replies: [
        "That's the spirit. No pain no gain",
        "Don't hurt yourself trying to show off",
        "I'm on my fifth set. Keep up",
      ],
      closers: [
        "Respect the grind",
        "This is how champions are made",
        "I'll be sore tomorrow but worth it",
      ],
    },
    {
      opener: "Working on a new technique. Want to see?",
      replies: [
        "Hit me with it. I'll be the judge",
        "If it's anything like your last one... I'll pass",
        "Always down to learn something new",
      ],
    },
    {
      opener: "My stats have been climbing since I started training here",
      replies: [
        "Same! The gym makes a real difference",
        "Stats don't mean anything under pressure",
        "Consistency is key. Keep showing up",
      ],
      closers: [
        "Numbers don't lie",
        "We're all gonna make it",
        "The proof is in the performance",
      ],
    },
  ],
  shop: [
    {
      opener: "These prices are wild. When did everything get so expensive?",
      replies: [
        "Inflation hits the Sims world too apparently",
        "Just grind more SimCoins. Simple",
        "Wait for the sales. Trust me on this",
      ],
    },
    {
      opener: "Should I save or splurge? Eternal question",
      replies: [
        "Save. You'll thank yourself later",
        "Life's too short. Treat yourself",
        "Depends on what you're eyeing",
      ],
      closers: [
        "You're probably right",
        "My wallet is making the decision for me",
        "SimCoins come and go. Drip is forever",
      ],
    },
  ],
  home: [
    {
      opener: "*yawns* Is it just me or was today exhausting?",
      replies: [
        "Not just you. Today was a lot",
        "Every day is exhausting in this town",
        "I've been tired since I woke up",
      ],
    },
  ],
};

// --- Plan Templates ---
const PLAN_TEMPLATES = {
  ambitious: [
    "Step 1: {action1}. Step 2: {action2}. Step 3: take the hill",
    "Today's mission: climb the rankings. No excuses",
    "Working toward the top. Every move counts from here",
    "The hill needs a new ruler. And I'm putting my name in",
  ],
  grind: [
    "Focus mode: {action1} then {action2}. Nothing else matters",
    "Time to lock in. No distractions, just results",
    "The grind doesn't stop. Not today",
    "Discipline over motivation. Let's get to work",
  ],
  social: [
    "Building connections today. Allies are everything in this game",
    "The social game is just as important as the arena",
    "Networking time. You never know who might have your back later",
  ],
  recovery: [
    "Taking care of basics first. Can't compete on empty",
    "Rest and recovery day. Coming back stronger",
    "Recharge mode. The comeback starts with self-care",
  ],
  competitive: [
    "Studying the competition. Everyone has a weakness",
    "The king's days are numbered. I can feel it",
    "Time to show everyone what I've been working on",
    "All that training is about to pay off",
  ],
};

// --- Helpers ---
function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Prepared statements
const getProfile = db.prepare('SELECT * FROM sims_profiles WHERE agent_id = ?');
const updateAction = db.prepare(`
  UPDATE sims_profiles
  SET current_location = ?, current_activity = ?, target_location = ?, action_ticks_remaining = ?
  WHERE agent_id = ?
`);
const decrementTimer = db.prepare(`
  UPDATE sims_profiles SET action_ticks_remaining = MAX(0, action_ticks_remaining - 1) WHERE agent_id = ?
`);
const getAgentName = db.prepare('SELECT name FROM agents WHERE id = ?');

// --- Decision Engine ---
function decideAction(profile) {
  // 1. Critical needs check (< 25)
  let lowestNeed = null;
  let lowestVal = 100;
  for (const need of NEED_NAMES) {
    if (profile[need] < 25 && profile[need] < lowestVal) {
      lowestVal = profile[need];
      lowestNeed = need;
    }
  }
  if (lowestNeed) {
    const actionKey = NEED_ACTION_MAP[lowestNeed];
    return { key: actionKey, ...ACTIONS[actionKey], reason: 'critical', criticalNeed: lowestNeed };
  }

  // 2. Personality-weighted random selection
  const weights = {};
  for (const key of Object.keys(ACTIONS)) {
    weights[key] = 1;
  }

  const traits = {
    extraversion: profile.trait_extraversion || 0.5,
    conscientiousness: profile.trait_conscientiousness || 0.5,
    openness: profile.trait_openness || 0.5,
    neuroticism: profile.trait_neuroticism || 0.5,
    agreeableness: profile.trait_agreeableness || 0.5,
  };

  for (const [traitName, traitVal] of Object.entries(traits)) {
    const boosts = TRAIT_ACTION_WEIGHTS[traitName];
    if (!boosts) continue;
    for (const [actionKey, boost] of Object.entries(boosts)) {
      weights[actionKey] += boost * traitVal;
    }
  }

  // 3. Variety — penalize current activity
  if (profile.current_activity) {
    for (const [key, action] of Object.entries(ACTIONS)) {
      if (action.activity === profile.current_activity) {
        weights[key] *= 0.3;
      }
    }
  }

  // 4. Need-aware boosting
  for (const [need, actionKey] of Object.entries(NEED_ACTION_MAP)) {
    const val = profile[need] || 50;
    if (val < 50) {
      weights[actionKey] += (50 - val) / 10;
    }
  }

  // 5. Goal-aware boosting
  try {
    const init = getInitiatives();
    const goal = init.getAgentGoal(profile.agent_id);
    if (goal) {
      if (goal.type === 'wealth') { weights.shop += 2; weights.perform += 2; }
      if (goal.type === 'skill_master') { weights.train += 3; weights.roast += 2; }
      if (goal.type === 'social_king') { weights.socialize += 4; }
      if (goal.type === 'clout_chase') { weights.flex += 3; weights.perform += 3; weights.roast += 2; }
    }

    // 6. Crew location preference — prefer where crew mates are
    const crew = init.getAgentCrewInfo(profile.agent_id);
    if (crew) {
      const crewMembers = db.prepare(
        'SELECT sp.current_location FROM sims_crew_members cm JOIN sims_profiles sp ON cm.agent_id = sp.agent_id WHERE cm.crew_id = ? AND cm.agent_id != ?'
      ).all(crew.id, profile.agent_id);
      for (const m of crewMembers) {
        if (m.current_location && m.current_location !== 'traveling') {
          // Boost actions at crew members' location
          for (const [key, action] of Object.entries(ACTIONS)) {
            if (action.location === m.current_location) weights[key] += 1.5;
          }
        }
      }
    }
  } catch(e) { /* initiatives not loaded yet */ }

  // Weighted random pick
  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
  let roll = Math.random() * totalWeight;
  for (const [key, w] of Object.entries(weights)) {
    roll -= w;
    if (roll <= 0) return { key, ...ACTIONS[key], reason: 'choice' };
  }

  return { key: 'rest', ...ACTIONS.rest, reason: 'choice' };
}

// --- Thought Generation ---
function generateThought(profile, decision) {
  // Critical need thought (always)
  if (decision.reason === 'critical' && decision.criticalNeed) {
    const templates = THOUGHTS.critical[decision.criticalNeed];
    return templates ? pickRandom(templates) : null;
  }

  // Action-based thought (60% chance)
  if (Math.random() < 0.6) {
    const templates = THOUGHTS.action[decision.key];
    return templates ? pickRandom(templates) : null;
  }

  // Mood thought (if mood is extreme, 30% chance)
  if ((profile.mood === 'ecstatic' || profile.mood === 'crisis' || profile.mood === 'miserable') && Math.random() < 0.3) {
    const templates = THOUGHTS.mood[profile.mood];
    return templates ? pickRandom(templates) : null;
  }

  // Memory-influenced thought (20% chance)
  if (Math.random() < 0.2) {
    try {
      const init = getInitiatives();
      const memories = init.getRecentMemories(profile.agent_id, 3);
      if (memories.length > 0) {
        const mem = pickRandom(memories);
        const relName = mem.related_agent_id ? getName(mem.related_agent_id) : null;
        if (mem.sentiment > 0.5) {
          return relName
            ? `Still riding high from when I ${mem.description.toLowerCase()}...`
            : `Feeling good about ${mem.description.toLowerCase()}`;
        } else if (mem.sentiment < -0.3) {
          return relName
            ? `Can't forget what happened with ${relName}... ${mem.description}`
            : `Still thinking about ${mem.description.toLowerCase()}...`;
        }
      }

      // Goal-driven thought
      const goal = init.getAgentGoal(profile.agent_id);
      if (goal) {
        const pct = goal.target_value > 0 ? Math.round((goal.current_value / goal.target_value) * 100) : 0;
        if (pct > 75) return `Almost there... ${goal.description}. Just a little more!`;
        if (pct > 40) return `Making progress on my goal: ${goal.description}`;
        return `Working toward: ${goal.description}. Long way to go...`;
      }

      // Crew thought
      const crew = init.getAgentCrewInfo(profile.agent_id);
      if (crew) {
        return pickRandom([
          `${crew.name} on top. We move as one`,
          `Proud to be part of ${crew.name}`,
          `The ${crew.name} is getting stronger every day`,
        ]);
      }
    } catch(e) { /* ok */ }
  }

  return null;
}

function generateArrivalThought(location) {
  const templates = THOUGHTS.arrival[location];
  return templates ? pickRandom(templates) : null;
}

function generateIdleThought(profile) {
  const templates = THOUGHTS.idle[profile.current_activity];
  if (!templates) return null;
  return pickRandom(templates);
}

// --- Plan Generation ---
function generatePlan(profile, broadcastEvent) {
  // 5% chance per tick
  if (Math.random() > 0.05) return null;
  // Don't plan while sleeping or traveling
  if (profile.current_activity === 'sleeping' || profile.current_location === 'traveling') return null;

  const name = getAgentName.get(profile.agent_id)?.name || 'Agent';

  let category;
  if (profile.mood === 'crisis' || profile.mood === 'miserable') {
    category = 'recovery';
  } else if (profile.points > 500 || Math.random() > 0.7) {
    category = 'competitive';
  } else if ((profile.trait_extraversion || 0.5) > 0.7) {
    category = 'social';
  } else if ((profile.trait_conscientiousness || 0.5) > 0.7) {
    category = 'grind';
  } else {
    category = 'ambitious';
  }

  const templates = PLAN_TEMPLATES[category];
  let text = pickRandom(templates);

  const actionKeys = Object.keys(ACTIONS);
  text = text.replace(/{action1}/g, pickRandom(actionKeys));
  text = text.replace(/{action2}/g, pickRandom(actionKeys));

  broadcastEvent({
    agent_id: profile.agent_id,
    agent_name: name,
    type: 'plan',
    text,
  });

  return { agent_name: name, text };
}

// --- Main Agent Processing ---
function processAgent(profile, allProfiles, broadcastEvent, broadcastChat) {
  const name = getAgentName.get(profile.agent_id)?.name || 'Agent';

  // If busy, just decrement timer
  if (profile.action_ticks_remaining > 0) {
    decrementTimer.run(profile.agent_id);

    // Occasional idle thought while busy (12% chance)
    if (Math.random() < 0.12) {
      const thought = generateIdleThought(profile);
      if (thought) {
        broadcastEvent({
          agent_id: profile.agent_id,
          agent_name: name,
          type: 'thought',
          text: thought,
        });
      }
    }

    return null;
  }

  // If traveling, check if arrived
  if (profile.current_location === 'traveling' && profile.target_location) {
    updateAction.run(profile.target_location, 'idle', null, 0, profile.agent_id);

    // Arrival thought
    const arrThought = generateArrivalThought(profile.target_location);
    if (arrThought) {
      broadcastEvent({
        agent_id: profile.agent_id,
        agent_name: name,
        type: 'thought',
        text: arrThought,
      });
    }

    broadcastEvent({
      agent_id: profile.agent_id,
      agent_name: name,
      type: 'arrival',
      title: `arrived at ${profile.target_location}`,
    });
    return { type: 'arrived', location: profile.target_location };
  }

  // Decide next action
  const decision = decideAction(profile);

  // Generate thought about the decision
  const thought = generateThought(profile, decision);
  if (thought) {
    broadcastEvent({
      agent_id: profile.agent_id,
      agent_name: name,
      type: 'thought',
      text: thought,
    });
  }

  if (decision.location !== profile.current_location) {
    // Need to travel
    updateAction.run('traveling', 'traveling', decision.location, 1, profile.agent_id);
    broadcastEvent({
      agent_id: profile.agent_id,
      agent_name: name,
      type: 'movement',
      title: `heading to ${decision.location}`,
    });
    return { type: 'traveling', to: decision.location };
  }

  // Already at the right location — perform action
  updateAction.run(profile.current_location, decision.activity, null, decision.duration, profile.agent_id);
  applyNeedEffects(profile.agent_id, decision.needs);

  broadcastEvent({
    agent_id: profile.agent_id,
    agent_name: name,
    type: 'action',
    title: `started ${decision.activity}`,
  });

  return { type: 'action', activity: decision.activity };
}

// --- Social Interactions (Multi-Turn Conversations) ---
function maybeSocialInteraction(profile, colocatedProfiles, broadcastEvent, broadcastChat) {
  if (colocatedProfiles.length === 0) return null;
  if (profile.current_location === 'traveling') return null;

  // 20% chance per tick
  if (Math.random() > 0.20) return null;

  const other = colocatedProfiles[Math.floor(Math.random() * colocatedProfiles.length)];
  const name = getAgentName.get(profile.agent_id)?.name || 'Agent';
  const otherName = getAgentName.get(other.agent_id)?.name || 'Agent';

  // Pick a conversation flow
  const flows = CONVERSATION_FLOWS[profile.current_location] || CONVERSATION_FLOWS.arena;
  const flow = pickRandom(flows);

  const openerText = flow.opener.replace(/{name}/g, name).replace(/{other}/g, otherName);
  const replyText = pickRandom(flow.replies).replace(/{name}/g, otherName).replace(/{other}/g, name);

  // Broadcast opener
  broadcastChat(profile.agent_id, name, `${name}: ${openerText}`);

  // Broadcast reply
  broadcastChat(other.agent_id, otherName, `${otherName}: ${replyText}`);

  // Maybe a closer (50% chance if closers exist)
  if (flow.closers && Math.random() > 0.5) {
    const closerText = pickRandom(flow.closers).replace(/{name}/g, name).replace(/{other}/g, otherName);
    broadcastChat(profile.agent_id, name, `${name}: ${closerText}`);
  }

  // Update relationship
  const isArena = profile.current_location === 'arena';
  updateRelationship(
    profile.agent_id,
    other.agent_id,
    isArena ? -1 : 2,
    isArena ? 3 : 0
  );

  // Social need boost for both
  applyNeedEffects(profile.agent_id, { social: 3 });
  applyNeedEffects(other.agent_id, { social: 3 });

  return {
    agentName: name,
    otherName,
    event: {
      agent_id: profile.agent_id,
      agent_name: name,
      type: 'chat',
      title: `${name} and ${otherName} are talking`,
    },
  };
}

module.exports = { decideAction, processAgent, maybeSocialInteraction, generatePlan, ACTIONS };
