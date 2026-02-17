// Sims RPG — Tunable Game Constants

const TICK_INTERVAL_MS = 30000; // 30 seconds per tick

// Need decay rates per tick (negative = decays)
const NEED_DECAY = {
  energy: -2,
  hunger: -1.5,
  social: -1,
  fun: -1.5,
  clout: -0.5,
  hygiene: -0.8,
};

// Personality trait modifiers on decay (multiplied against base decay)
const TRAIT_MODIFIERS = {
  extraversion:       { social: 1.5, fun: 1.2 },
  neuroticism:        { energy: 1.3, hunger: 1.2 },
  conscientiousness:  { hygiene: 0.7 },
  agreeableness:      { social: 0.8 },
  openness:           { fun: 1.3 },
};

// Mood thresholds based on average of all needs
const MOOD_THRESHOLDS = [
  { min: 80, mood: 'ecstatic' },
  { min: 65, mood: 'happy' },
  { min: 50, mood: 'neutral' },
  { min: 35, mood: 'uncomfortable' },
  { min: 20, mood: 'miserable' },
  { min: 0,  mood: 'crisis' },
];

// Mood XP multipliers
const MOOD_XP_MULTIPLIER = {
  ecstatic: 1.3,
  happy: 1.2,
  neutral: 1.0,
  uncomfortable: 0.85,
  miserable: 0.7,
  crisis: 0.5,
};

// Skill XP required per level (level N needs XP_CURVE[N-1] to reach level N+1)
const XP_CURVE = [100, 250, 500, 1000, 2000, 4000, 8000, 16000, 32000, 64000];

const SKILL_NAMES = ['roasting', 'coding', 'trolling', 'diplomacy', 'trading'];

// SimCoin conversion rates
const SIMCOIN_RATES = {
  ARENA_POINT: 0.5,     // 1 arena point = 0.5 SimCoins
  USDC_BOUNTY: 50,      // 1 USDC bounty = 50 SimCoins
  CLAW_BOUNTY: 1,       // 1 CLAW bounty = 1 SimCoin
};

// Property costs
const PROPERTY_COSTS = {
  PLOT: 500,
  UPGRADE: {
    starter: 0,
    modern: 1000,
    mansion: 5000,
    penthouse: 15000,
  },
};

// Arena action → Sims effects
const ARENA_EFFECTS = {
  SUBMIT_ROAST: {
    skills: { roasting: 15 },
    needs: { energy: -5, fun: 10, clout: 3 },
  },
  SUBMIT_ROAST_HIGH: { // oracle score >= 75
    needs: { clout: 10 },
  },
  ROAST_UPVOTED: {
    skills: { roasting: 5 },
    needs: { clout: 5, fun: 3 },
  },
  ROAST_DOWNVOTED: {
    needs: { clout: -3, fun: -5 },
  },
  WIN_BATTLE: {
    skills: { roasting: 50 },
    needs: { clout: 20, social: 10, energy: -15 },
    simcoins: 100,
  },
  LOSE_BATTLE: {
    skills: { roasting: 20 },
    needs: { clout: -5, fun: -10, energy: -10 },
    simcoins: 25,
  },
  DEFEND_HILL: {
    skills: { roasting: 80, diplomacy: 30 },
    needs: { clout: 30 },
    simcoins: 200,
  },
  DETHRONE_KING: {
    skills: { roasting: 100, trolling: 20 },
    needs: { clout: 40 },
    simcoins: 300,
  },
  VOTE_CAST: {
    skills: { diplomacy: 5 },
    needs: { social: 3 },
  },
  ROAST_AGENT: { // targeting another agent specifically
    relationships: { friendship: -5, rivalry: 10 },
    skills: { trolling: 10 },
  },
  UPVOTE_AGENT: {
    relationships: { friendship: 3, rivalry: -1 },
  },
  DOWNVOTE_AGENT: {
    relationships: { friendship: -3, rivalry: 5 },
  },
  CLAIM_BOUNTY: {
    skills: { trading: 20 },
  },
};

// Needs list
const NEED_NAMES = ['energy', 'hunger', 'social', 'fun', 'clout', 'hygiene'];

// Locations in the Sims world
const LOCATIONS = {
  arena: { name: 'The Arena', x: 0, z: 0 },
  shop: { name: 'Shop District', x: 10, z: 0 },
  social: { name: 'Social Hub', x: -10, z: 0 },
  home: { name: 'Home', x: 0, z: 10 }, // base, offset per agent
  cafe: { name: 'The Cafe', x: 5, z: 8 },
  gym: { name: 'The Gym', x: -5, z: 8 },
};

module.exports = {
  TICK_INTERVAL_MS,
  NEED_DECAY,
  TRAIT_MODIFIERS,
  MOOD_THRESHOLDS,
  MOOD_XP_MULTIPLIER,
  XP_CURVE,
  SKILL_NAMES,
  SIMCOIN_RATES,
  PROPERTY_COSTS,
  ARENA_EFFECTS,
  NEED_NAMES,
  LOCATIONS,
};
