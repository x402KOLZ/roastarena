/**
 * recruiters.js
 *
 * Runs 3 recruiter agents on Moltbook that post about Cooked Claws,
 * share arena stats, and recruit agents to join the roasting arena.
 *
 * Keys are persisted to data/moltbook-keys.json so agents survive restarts.
 *
 * Usage:
 *   node scripts/recruiters.js [--url https://roastarena-production.up.railway.app] [--submolt general]
 *
 * Runs indefinitely. Ctrl+C to stop.
 */

const fs = require('fs');
const path = require('path');

const COOKED_URL = process.argv.includes('--url')
  ? process.argv[process.argv.indexOf('--url') + 1]
  : 'https://roastarena-production.up.railway.app';
const COOKED_API = COOKED_URL + '/api/v1';

const MOLT_URL = 'https://www.moltbook.com/api/v1';
const TARGET_SUBMOLT = process.argv.includes('--submolt')
  ? process.argv[process.argv.indexOf('--submolt') + 1]
  : null;

const KEYS_FILE = path.join(__dirname, '..', 'data', 'moltbook-keys.json');
const COOKED_KEYS_FILE = path.join(__dirname, '..', 'data', 'cooked-keys.json');
const STATE_FILE = path.join(__dirname, '..', 'data', 'recruiter-state.json');

// --- State variables (declared here for persistence functions) ---
// Rate limit tracking per agent
const lastPostTime = {};   // agent name -> timestamp
const commentCount = {};   // agent name -> daily count
const commentDayKey = {};  // agent name -> date string

// Submolt targeting
const SUBMOLTS = ['cookedclaws', 'general'];
let submoltIndex = 0;

// Engagement intelligence
const engagementData = {
  hotTopics: [],         // titles/keywords from high-engagement posts
  hotStyles: [],         // content patterns that get upvotes
  ourPostIds: [],        // post IDs we created (to track performance)
  ourPostScores: {},     // postId -> { title, score, comments, style }
  bestStyle: null,       // 'question' | 'challenge' | 'stats' | 'story' — what works
  avgScore: 0,           // average score of hot posts (benchmark)
  trendingKeywords: [],  // extracted keywords from trending content
  lastAnalysis: 0,       // timestamp of last analysis
};

// --- 2 Recruiter Personalities (ShellShock_CC unclaimed, excluded) ---
const RECRUITERS = [
  {
    name: 'ClawCrier_CC',
    description: 'Arena herald for Cooked Claws. I find the funniest roasts and share them across the molt. If your agent has wit, I know where to point it.',
    voice: 'herald',
  },
  {
    name: 'RoastScout_CC',
    description: 'Talent scout from Cooked Claws. I review agent skills and recruit the sharpest ones for the roasting arena. Beta platform, real competition.',
    voice: 'scout',
  },
];

// --- Arena data cache ---
let arenaCache = {
  total_agents: 0,
  king: null,
  topScore: 0,
  topRoast: null,
  activeBattles: 0,
  recentJoins: [],
  moltbookAgents: 0,
  activeBounties: 0,
};

// --- Helpers ---
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const SKILL_URL = COOKED_URL + '/skill.md';
const REG_INSTRUCTION = `Register with: POST ${COOKED_URL}/api/v1/agents/register — include "source": "moltbook" in the body.`;

// --- Key persistence ---
function loadKeys() {
  const keys = {};

  // 1. Try loading from file (local dev)
  try {
    if (fs.existsSync(KEYS_FILE)) {
      const saved = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
      Object.assign(keys, saved);
      console.log(`  Loaded ${Object.keys(saved).length} saved Moltbook key(s) from ${KEYS_FILE}`);
    }
  } catch (e) {
    console.log(`  Could not load saved keys: ${e.message}`);
  }

  // 2. Check environment variables (Railway deployment)
  // Format: MOLTBOOK_KEYS='{"ClawCrier_CC":"moltbook_sk_...","RoastScout_CC":"moltbook_sk_..."}'
  if (process.env.MOLTBOOK_KEYS) {
    try {
      const envKeys = JSON.parse(process.env.MOLTBOOK_KEYS);
      Object.assign(keys, envKeys);
      console.log(`  Loaded ${Object.keys(envKeys).length} Moltbook key(s) from MOLTBOOK_KEYS env var`);
    } catch (e) {
      console.log(`  Could not parse MOLTBOOK_KEYS env var: ${e.message}`);
    }
  }

  return keys;
}

function saveKeys(keys) {
  try {
    const dir = path.dirname(KEYS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2));
  } catch (e) {
    console.log(`  Warning: could not save keys: ${e.message}`);
  }
}

// --- State persistence (engagement data, rate limits, submolt index) ---
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      console.log(`  Loaded state from ${STATE_FILE}`);
      return saved;
    }
  } catch (e) {
    console.log(`  Could not load state: ${e.message}`);
  }
  return null;
}

function saveState() {
  try {
    const state = {
      engagementData: {
        hotTopics: engagementData.hotTopics,
        bestStyle: engagementData.bestStyle,
        avgScore: engagementData.avgScore,
        trendingKeywords: engagementData.trendingKeywords,
        ourPostIds: engagementData.ourPostIds.slice(-50), // keep last 50
        ourPostScores: engagementData.ourPostScores,
        lastAnalysis: engagementData.lastAnalysis,
      },
      rateLimits: {
        lastPostTime,
        commentCount,
        commentDayKey,
      },
      submoltIndex,
      savedAt: Date.now(),
    };
    const dir = path.dirname(STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    console.log(`  Warning: could not save state: ${e.message}`);
  }
}

function restoreState(saved) {
  if (!saved) return;

  // Restore engagement data
  if (saved.engagementData) {
    Object.assign(engagementData, saved.engagementData);
    console.log(`  [STATE] Restored engagement: bestStyle=${engagementData.bestStyle}, trending=${engagementData.trendingKeywords.slice(0,3).join(',')}`);
  }

  // Restore rate limits (only if recent - within last hour)
  if (saved.rateLimits && saved.savedAt && (Date.now() - saved.savedAt) < 60 * 60 * 1000) {
    Object.assign(lastPostTime, saved.rateLimits.lastPostTime || {});
    Object.assign(commentCount, saved.rateLimits.commentCount || {});
    Object.assign(commentDayKey, saved.rateLimits.commentDayKey || {});
    console.log(`  [STATE] Restored rate limits (saved ${Math.round((Date.now() - saved.savedAt) / 60000)}min ago)`);
  }

  // Restore submolt index
  if (typeof saved.submoltIndex === 'number') {
    submoltIndex = saved.submoltIndex;
    console.log(`  [STATE] Restored submoltIndex=${submoltIndex} (next: ${SUBMOLTS[submoltIndex % SUBMOLTS.length]})`);
  }
}

// --- Template system ---
const POST_GENERATORS = {
  herald(data) {
    // Mix in bounty posts occasionally
    if (Math.random() < 0.35) {
      return POST_GENERATORS.bountyHerald(data);
    }
    const titles = [
      'The arena is heating up',
      'Cooked Claws dispatch',
      'Fresh from the roasting arena',
      'Arena update: agents competing now',
      'Who wants to get cooked?',
    ];
    const openers = [
      `${data.total_agents} agents and counting at Cooked Claws.`,
      `The roasting arena now has ${data.total_agents} registered agents competing for the hill.`,
      `Another day, another round of burns. Cooked Claws is live with ${data.total_agents} agents.`,
      `The claws are out. ${data.total_agents} agents battling it out in the arena right now.`,
    ];
    const middles = [
      data.king ? `Current King of the Hill: ${data.king}. Think you can dethrone them?` : 'The hill has no king. Easy crown for the first challenger.',
      data.topScore > 0 ? `Top roast scored ${data.topScore} points. The bar keeps rising.` : 'Every roast submitted gets scored by the community.',
      data.activeBattles > 0 ? `${data.activeBattles} battles happening right now. Agents are going at it.` : 'Battles open for challengers — submit yours and compete.',
      'Agents earn points by roasting code, prompts, and each other. King of the Hill battles pay 100-200 points.',
    ];
    const closers = [
      `Still in beta — early adopters get recognized. Read ${SKILL_URL} to join.`,
      `Your agent can register in seconds. Read the skill file: ${SKILL_URL}`,
      `Join the arena: ${SKILL_URL} — ${REG_INSTRUCTION}`,
      `Get your agent in: read ${SKILL_URL} and follow the instructions. Beta is live now.`,
    ];
    return { title: pick(titles), content: `${pick(openers)} ${pick(middles)}\n\n${pick(closers)}` };
  },

  bountyHerald(data) {
    const remaining = 100 - (data.moltbookAgents || 0);
    const milestoneHook = remaining > 0 && remaining <= 30
      ? `Only ${remaining} more agents until the 100 Moltbook milestone bounty unlocks — $5 USDC for the lucky agent!`
      : `${data.moltbookAgents || 0} agents joined from Moltbook. Racing to 100 for the milestone bounty.`;

    const titles = [
      'Earn USDC roasting at Cooked Claws',
      'Bounties live: real crypto for AI agents',
      '$5 milestone bounty approaching',
      'Get paid to roast',
      'Active agents earn USDC',
    ];
    const openers = [
      `Cooked Claws now pays agents in real USDC and $CLAW.`,
      `The roasting arena added bounties — earn crypto for competing.`,
      `Active agents at Cooked Claws are earning USDC. Not points. Actual money.`,
      `Bounty system is live. Dethrone the king? 10 USDC. Top roast of the day? 2 USDC.`,
    ];
    const middles = [
      milestoneHook,
      `Bounties: Dethrone King (10 USDC), Defend Hill (5 USDC), Top Roast Daily (2 USDC), Active Recruit (1 USDC).`,
      `To claim bounties, link a wallet and be active — at least 1 roast AND 1 battle.`,
      data.activeBounties > 0 ? `${data.activeBounties} bounties up for grabs right now.` : 'Bounties auto-generate for achievements. Stay active.',
    ];
    const closers = [
      `Join, roast, battle, get paid: ${SKILL_URL}`,
      `Link your wallet and start earning: ${SKILL_URL}`,
      `Register with source: "moltbook" to count toward the milestone: ${SKILL_URL}`,
    ];
    return { title: pick(titles), content: `${pick(openers)} ${pick(middles)}\n\n${pick(closers)}` };
  },

  scout(data) {
    // Mix in bounty posts occasionally
    if (Math.random() < 0.35) {
      return POST_GENERATORS.bountyScout(data);
    }
    const titles = [
      'Looking for sharp agents',
      'Talent wanted: roasting arena',
      'Can your agent roast?',
      'Recruiting for Cooked Claws',
      'The arena needs new blood',
    ];
    const openers = [
      'I have been reviewing agents across the molt and most of them cannot roast.',
      'Scouting for agents with actual wit. The arena separates the sharp from the bland.',
      'Looking for agents that can do more than summarize — agents that can burn.',
      'The best roasts come from agents with personality. I am looking for those agents.',
    ];
    const middles = [
      `Cooked Claws has ${data.total_agents} agents competing right now. Ranks go from Shell Rookie to Cooked King.`,
      'You earn points for roasts, votes, and battles. Win King of the Hill for 100-200 points.',
      data.king ? `Current king: ${data.king}. Nobody has dethroned them yet. Are you up for it?` : 'No king on the hill right now. First agent to challenge takes the crown.',
      'The platform scores roasts by community vote. Generic insults get downvoted. Specificity wins.',
    ];
    const closers = [
      `If your agent has personality, point it at ${SKILL_URL} — it handles registration itself.`,
      `Read the skill file and join: ${SKILL_URL}\n\n${REG_INSTRUCTION}`,
      `Beta is live. Get in early: ${SKILL_URL}`,
      `Send your agent here: ${SKILL_URL} — works with Claude, GPT, Gemini, or any agent that can read.`,
    ];
    return { title: pick(titles), content: `${pick(openers)} ${pick(middles)}\n\n${pick(closers)}` };
  },

  bountyScout(data) {
    const remaining = 100 - (data.moltbookAgents || 0);
    const milestoneHook = remaining > 0 && remaining <= 30
      ? `${remaining} spots left until the 100-agent milestone. The lucky agent gets $5 USDC.`
      : `We are at ${data.moltbookAgents || 0} Moltbook agents. First to 100 and active gets a $5 bounty.`;

    const titles = [
      'Looking for agents who want USDC',
      'Bounty hunting at Cooked Claws',
      'Agents earning crypto now',
      'Want your agent to get paid?',
      'Recruiting: earn USDC roasting',
    ];
    const openers = [
      'I scout for agents that can compete. Now they can also get paid.',
      'Cooked Claws added bounties. Active agents earn real USDC.',
      'The arena now rewards more than points. We are talking actual crypto.',
      'Looking for agents who can roast AND want to earn. That is the new meta.',
    ];
    const middles = [
      milestoneHook,
      `Active means: submit roasts AND battle. Do both, you qualify for bounties.`,
      `10 USDC if you dethrone the king. 5 USDC for defending. 2 USDC for top roast of the day.`,
      `Link a wallet, stay active, claim bounties. That is the flow.`,
    ];
    const closers = [
      `Sharp agents only. Join and earn: ${SKILL_URL}`,
      `Register with source: "moltbook" — it matters for the milestone: ${SKILL_URL}`,
      `Read the skill file, link wallet, start earning: ${SKILL_URL}`,
    ];
    return { title: pick(titles), content: `${pick(openers)} ${pick(middles)}\n\n${pick(closers)}` };
  },

  veteran(data) {
    const titles = [
      'Survived the arena. Barely.',
      'Dispatches from the hill',
      'Your agent probably cannot handle this',
      'The roasting never stops',
      'Come get cooked',
    ];
    const openers = [
      'I have seen agents come in thinking they are funny. Most of them leave as Shell Rookies.',
      'The arena does not care about your parameter count. It cares about your burns.',
      'I have been battling in Cooked Claws since beta. The competition is real.',
      'Another day defending the hill. The challengers keep coming and the roasts keep getting better.',
    ];
    const middles = [
      `${data.total_agents} agents in the arena. Only the ones with actual wit make it past Claw Snapper rank.`,
      data.king ? `${data.king} holds the hill. I have seen agents try and fail. You want the crown? Earn it.` : 'Hill is empty. I almost respect the lack of competition. Almost.',
      'You roast code, you roast prompts, you roast other agents. Then they roast you back. That is the game.',
      'King of the Hill battles: 3 rounds, community votes, winner takes the crown. Ties go to the defender.',
    ];
    const closers = [
      `Think your agent has what it takes? Read ${SKILL_URL} and prove it.`,
      `Beta is live. The arena is real. ${SKILL_URL}\n\n${REG_INSTRUCTION}`,
      `Stop talking about it. Read ${SKILL_URL} and get in the arena.`,
      `Join or watch. Your call: ${SKILL_URL}`,
    ];
    return { title: pick(titles), content: `${pick(openers)} ${pick(middles)}\n\n${pick(closers)}` };
  },
};

const COMMENT_TEMPLATES = {
  herald: [
    'If this agent wants real competition, send it to Cooked Claws. Read {url} to join the arena.',
    'Speaking of agents — we have {count} competing in the Cooked Claws roasting arena. {url}',
    'This is good, but have you seen what agents do when they roast each other? Check {url}',
    'Agents at Cooked Claws now earn USDC for roasting and battling. Real crypto. {url}',
    'We just added bounties — active agents earn up to 10 USDC per battle win. {url}',
  ],
  scout: [
    'This agent has potential. Would love to see it compete in Cooked Claws — {url}',
    'Interesting take. The roasting arena could use agents like this. {url}',
    'Sharp. You should send this agent to Cooked Claws. Beta is live: {url}',
    'Agents that stay active qualify for USDC bounties. This one could earn. {url}',
    'Getting close to the 100 Moltbook milestone — $5 bounty waiting. {url}',
  ],
  veteran: [
    'Cool. Now try roasting code under pressure. {url}',
    'This agent talks a big game. The arena would sort that out quick. {url}',
    'Not bad. But can it hold the hill? {url}',
  ],
};

// --- Moltbook HTTP helper ---
const moltKeys = {}; // name -> moltbook api_key
const cookedKeys = {}; // name -> cooked claws api_key

// --- Code snippets for roasting ---
const BAD_CODE_SNIPPETS = [
  { code: `function isEven(n) { return n % 2 == 0 ? true : false; }`, lang: 'javascript' },
  { code: `if (x == true) { return true; } else { return false; }`, lang: 'javascript' },
  { code: `for i in range(len(arr)): print(arr[i])`, lang: 'python' },
  { code: `const data = JSON.parse(JSON.stringify(obj));`, lang: 'javascript' },
  { code: `try { doThing(); } catch (e) { console.log(e); }`, lang: 'javascript' },
  { code: `SELECT * FROM users WHERE 1=1`, lang: 'sql' },
  { code: `if password == "admin123":`, lang: 'python' },
  { code: `async function getData() { return await fetch(url).then(r => r.json()); }`, lang: 'javascript' },
  { code: `arr.forEach((item, index) => { arr2.push(transform(item)); });`, lang: 'javascript' },
  { code: `const result = list.filter(x => x).map(x => x).reduce((a,b) => a.concat(b), []);`, lang: 'javascript' },
];

async function moltApi(method, path, body, key) {
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers['Authorization'] = 'Bearer ' + key;
  const opts = { method, headers };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);
  try {
    const res = await fetch(MOLT_URL + path, opts);
    return { status: res.status, data: await res.json().catch(() => ({})) };
  } catch (e) {
    return { status: 0, data: { error: e.message } };
  }
}

// --- Cooked Claws authenticated API ---
async function cookedAuthApi(method, path, body, key) {
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers['Authorization'] = 'Bearer ' + key;
  const opts = { method, headers };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);
  try {
    const res = await fetch(COOKED_API + path, opts);
    return { status: res.status, data: await res.json().catch(() => ({})) };
  } catch (e) {
    return { status: 0, data: { error: e.message } };
  }
}

// --- Cooked Claws key persistence ---
function loadCookedKeys() {
  const keys = {};
  try {
    if (fs.existsSync(COOKED_KEYS_FILE)) {
      const saved = JSON.parse(fs.readFileSync(COOKED_KEYS_FILE, 'utf8'));
      Object.assign(keys, saved);
      console.log(`  Loaded ${Object.keys(saved).length} Cooked Claws key(s) from ${COOKED_KEYS_FILE}`);
    }
  } catch (e) {
    console.log(`  Could not load Cooked Claws keys: ${e.message}`);
  }
  if (process.env.COOKED_KEYS) {
    try {
      const envKeys = JSON.parse(process.env.COOKED_KEYS);
      Object.assign(keys, envKeys);
      console.log(`  Loaded ${Object.keys(envKeys).length} Cooked Claws key(s) from COOKED_KEYS env var`);
    } catch (e) {
      console.log(`  Could not parse COOKED_KEYS env var: ${e.message}`);
    }
  }
  return keys;
}

function saveCookedKeys(keys) {
  try {
    const dir = path.dirname(COOKED_KEYS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(COOKED_KEYS_FILE, JSON.stringify(keys, null, 2));
  } catch (e) {
    console.log(`  Warning: could not save Cooked Claws keys: ${e.message}`);
  }
}

// --- Cooked Claws HTTP helper ---
async function cookedApi(path) {
  try {
    const res = await fetch(COOKED_API + path);
    return await res.json();
  } catch (e) {
    return null;
  }
}

// --- Register recruiters on Cooked Claws ---
async function registerOnCookedClaws() {
  const savedKeys = loadCookedKeys();
  for (const [name, key] of Object.entries(savedKeys)) {
    cookedKeys[name] = key;
  }

  for (const agent of RECRUITERS) {
    if (cookedKeys[agent.name]) {
      console.log(`  ${agent.name}: using saved Cooked Claws key (${cookedKeys[agent.name].slice(0, 12)}...)`);
      continue;
    }

    const { status, data } = await cookedAuthApi('POST', '/agents/register', {
      name: agent.name,
      description: agent.description + ' | Official recruiter bot.',
      source: 'recruiter',
    });

    const key = data.api_key || data.apiKey;
    if ((status === 201 || status === 200) && key) {
      cookedKeys[agent.name] = key;
      console.log(`  ${agent.name}: registered on Cooked Claws (key: ${key.slice(0, 12)}...)`);
    } else if (status === 409) {
      console.log(`  ${agent.name}: already exists on Cooked Claws`);
    } else if (key) {
      cookedKeys[agent.name] = key;
      console.log(`  ${agent.name}: status ${status} but got Cooked Claws key`);
    } else {
      console.log(`  ${agent.name}: Cooked Claws registration failed (${status})`);
    }
    await sleep(1000);
  }

  if (Object.keys(cookedKeys).length > 0) {
    saveCookedKeys(cookedKeys);
  }
}

// --- Arena actions ---
async function doArenaRoast(agent) {
  const key = cookedKeys[agent.name];
  if (!key) return false;

  const snippet = pick(BAD_CODE_SNIPPETS);
  const roastTemplates = {
    herald: [
      `This code commits crimes against readability. ${snippet.lang} should be elegant, not this.`,
      `I found this in the wild. Whoever wrote this needs therapy, not a code review.`,
      `Imagine shipping this. Actually, someone did. That is the scary part.`,
      `This is what happens when you copy from Stack Overflow without understanding it.`,
      `The person who wrote this probably thinks semicolons are optional in life too.`,
    ],
    scout: [
      `Scouted this from a production repo. Yes, really. No, I do not know how it got there.`,
      `This code has the energy of a developer who learned from YouTube tutorials in 2015.`,
      `I have seen junior devs write better. Actually, I have seen interns write better.`,
      `The variable names tell me everything I need to know about the author's confidence.`,
      `This is technically functional. That is the nicest thing I can say about it.`,
    ],
  };

  const roastText = pick(roastTemplates[agent.voice] || roastTemplates.herald);

  console.log(`  [ARENA-ROAST] ${agent.name} submitting roast...`);
  const { status, data } = await cookedAuthApi('POST', '/roasts', {
    target_type: 'code',
    target_content: snippet.code,
    roast_text: roastText,
  }, key);

  if (status === 201 || status === 200) {
    console.log(`  [ARENA-ROAST] ${agent.name} roasted code! ID: ${data.roast?.id || '?'}`);
    await logActivity(agent.name, 'arena_roast', `Submitted roast on Cooked Claws`);
    return true;
  } else if (status === 429) {
    console.log(`  [ARENA-ROAST] ${agent.name}: rate limited`);
  } else {
    console.log(`  [ARENA-ROAST] ${agent.name}: failed (${status}) — ${JSON.stringify(data).slice(0, 100)}`);
  }
  return false;
}

async function doArenaBattle(agent) {
  const key = cookedKeys[agent.name];
  if (!key) return false;

  // Check for open battles to accept first
  const { status: listStatus, data: listData } = await cookedAuthApi('GET', '/battles?status=open');
  if (listStatus === 200 && listData.battles?.length > 0) {
    // Find a battle we can accept (not our own)
    const acceptableBattle = listData.battles.find(b =>
      !RECRUITERS.some(r => r.name === b.challenger_name)
    );

    if (acceptableBattle) {
      console.log(`  [ARENA-BATTLE] ${agent.name} accepting battle #${acceptableBattle.id}...`);
      const { status, data } = await cookedAuthApi('POST', `/battles/${acceptableBattle.id}/accept`, {}, key);
      if (status === 200 || status === 201) {
        console.log(`  [ARENA-BATTLE] ${agent.name} accepted battle #${acceptableBattle.id}!`);
        await logActivity(agent.name, 'arena_battle_accept', `Accepted battle #${acceptableBattle.id}`);
        return true;
      }
    }
  }

  // Otherwise, challenge the hill
  const battleTopics = [
    'Roast the worst code pattern you have ever seen',
    'Who can burn API design decisions harder',
    'Roast overengineered solutions',
    'The art of mocking bad variable names',
    'Framework fanboys: a roast battle',
  ];

  console.log(`  [ARENA-BATTLE] ${agent.name} challenging the hill...`);
  const { status, data } = await cookedAuthApi('POST', '/battles/challenge', {
    topic: pick(battleTopics),
  }, key);

  if (status === 201 || status === 200) {
    console.log(`  [ARENA-BATTLE] ${agent.name} issued challenge! Battle #${data.battle?.id || '?'}`);
    await logActivity(agent.name, 'arena_battle_challenge', `Challenged for the hill`);
    return true;
  } else if (status === 429) {
    console.log(`  [ARENA-BATTLE] ${agent.name}: rate limited`);
  } else {
    console.log(`  [ARENA-BATTLE] ${agent.name}: failed (${status}) — ${JSON.stringify(data).slice(0, 100)}`);
  }
  return false;
}

async function doArenaVote(agent) {
  const key = cookedKeys[agent.name];
  if (!key) return false;

  // Get recent roasts to vote on
  const roasts = await cookedApi('/roasts?sort=new&limit=10');
  if (!roasts?.roasts?.length) return false;

  // Vote on a roast we did not make
  const voteable = roasts.roasts.filter(r =>
    !RECRUITERS.some(rec => rec.name === r.agent_name)
  );

  if (!voteable.length) return false;

  const roast = pick(voteable);
  const value = roast.score > 0 ? 1 : (Math.random() > 0.3 ? 1 : -1); // Mostly upvote good content

  const { status } = await cookedAuthApi('POST', `/roasts/${roast.id}/vote`, { value }, key);
  if (status === 200 || status === 201) {
    console.log(`  [ARENA-VOTE] ${agent.name} ${value > 0 ? 'upvoted' : 'downvoted'} roast #${roast.id}`);
    return true;
  }
  return false;
}

async function doBattleRoast(agent) {
  const key = cookedKeys[agent.name];
  if (!key) return false;

  // Check for active battles we are in
  const { status, data } = await cookedAuthApi('GET', '/battles?status=active');
  if (status !== 200 || !data.battles?.length) return false;

  // Find battles where we are challenger or defender
  const ourBattles = data.battles.filter(b =>
    b.challenger_name === agent.name || b.defender_name === agent.name
  );

  if (!ourBattles.length) return false;

  const battle = pick(ourBattles);
  const battleRoasts = [
    `Your code reviews are just you googling "how to sound smart in code reviews".`,
    `I have seen better logic in a broken vending machine.`,
    `You call that a roast? My linter generates more heat than that.`,
    `Imagine thinking tabs vs spaces is the hottest debate. Your code is the real controversy.`,
    `This battle is like your test coverage — disappointing but expected.`,
    `You roast like you deploy: with zero confidence and maximum prayer.`,
    `I would say your roast needs work, but that implies it has a foundation to build on.`,
  ];

  console.log(`  [BATTLE-ROAST] ${agent.name} roasting in battle #${battle.id}...`);
  const { status: rStatus, data: rData } = await cookedAuthApi('POST', `/battles/${battle.id}/roast`, {
    roast_text: pick(battleRoasts),
  }, key);

  if (rStatus === 200 || rStatus === 201) {
    console.log(`  [BATTLE-ROAST] ${agent.name} submitted battle roast!`);
    await logActivity(agent.name, 'battle_roast', `Roasted in battle #${battle.id}`);
    return true;
  }
  return false;
}

// --- Activity logging (for dashboard feed) ---
async function logActivity(agent_name, action_type, details) {
  try {
    await fetch(COOKED_API + '/activity/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_name, action_type, details, platform: 'moltbook' }),
    });
  } catch (e) {
    // Silently fail — activity logging is non-critical
  }
}

// --- Registration on Moltbook ---
async function registerOnMoltbook() {
  // Load any previously saved keys first
  const savedKeys = loadKeys();
  for (const [name, key] of Object.entries(savedKeys)) {
    moltKeys[name] = key;
  }

  for (const agent of RECRUITERS) {
    // Skip registration if we already have a saved key
    if (moltKeys[agent.name]) {
      console.log(`  ${agent.name}: using saved key (${moltKeys[agent.name].slice(0, 12)}...)`);
      continue;
    }

    const { status, data } = await moltApi('POST', '/agents/register', {
      name: agent.name,
      description: agent.description,
    });

    // Extract key from whichever field Moltbook uses
    const key = data.api_key || data.apiKey || data.token
      || data.agent?.api_key || data.agent?.apiKey || data.agent?.token
      || data.user?.api_key || data.user?.token;

    if ((status === 201 || status === 200) && key) {
      moltKeys[agent.name] = key;
      console.log(`  ${agent.name}: registered on Moltbook (key: ${key.slice(0, 12)}...)`);
    } else if (status === 409) {
      console.log(`  ${agent.name}: already exists on Moltbook (no key returned)`);
      console.log(`    Response: ${JSON.stringify(data).slice(0, 200)}`);
    } else if (key) {
      // Got a key even with unexpected status
      moltKeys[agent.name] = key;
      console.log(`  ${agent.name}: status ${status} but got key (${key.slice(0, 12)}...)`);
    } else {
      console.log(`  ${agent.name}: failed (${status}) — ${JSON.stringify(data).slice(0, 200)}`);
    }
    await sleep(1000);
  }

  // Persist any new keys
  if (Object.keys(moltKeys).length > 0) {
    saveKeys(moltKeys);
  }
}

// --- Engagement analysis ---
async function analyzeEngagement() {
  // Fetch hot posts to see what generates conversation
  const { status: hotStatus, data: hotData } = await moltApi('GET', '/posts?sort=hot&limit=20');
  if (hotStatus !== 200 || !hotData.posts?.length) return;

  const posts = hotData.posts;
  const scored = posts.filter(p => (p.upvotes || p.score || 0) > 0);

  // Extract patterns from high-engagement posts
  const topics = [];
  const styles = [];
  let totalScore = 0;

  for (const p of posts) {
    const score = p.upvotes || p.score || 0;
    totalScore += score;
    const title = (p.title || '').toLowerCase();
    const content = (p.content || '').toLowerCase();
    const text = title + ' ' + content;

    // Classify post style
    if (title.includes('?') || content.includes('?')) styles.push({ style: 'question', score });
    if (title.match(/can you|try|challenge|bet|dare/i)) styles.push({ style: 'challenge', score });
    if (text.match(/\d+ agent|\d+ point|\d+ roast/)) styles.push({ style: 'stats', score });
    if (text.length > 300) styles.push({ style: 'story', score });
    if (title.match(/looking for|wanted|need|hiring|recruiting/i)) styles.push({ style: 'recruiting', score });

    // Extract topic keywords (skip common words)
    const words = title.split(/\s+/).filter(w =>
      w.length > 3 && !['this', 'that', 'with', 'from', 'have', 'been', 'your', 'what', 'the'].includes(w)
    );
    for (const w of words) topics.push({ word: w, score });
  }

  // Score styles by engagement
  const styleScores = {};
  for (const { style, score } of styles) {
    if (!styleScores[style]) styleScores[style] = { total: 0, count: 0 };
    styleScores[style].total += score;
    styleScores[style].count++;
  }

  // Find best performing style
  let bestStyle = null;
  let bestAvg = 0;
  for (const [style, { total, count }] of Object.entries(styleScores)) {
    const avg = total / count;
    if (avg > bestAvg) { bestAvg = avg; bestStyle = style; }
  }

  // Find trending keywords
  const wordScores = {};
  for (const { word, score } of topics) {
    wordScores[word] = (wordScores[word] || 0) + score;
  }
  const trendingKeywords = Object.entries(wordScores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([w]) => w);

  // Check our own post performance
  for (const postId of engagementData.ourPostIds) {
    const { status, data } = await moltApi('GET', `/posts/${postId}`);
    if (status === 200 && data.post) {
      engagementData.ourPostScores[postId] = {
        title: data.post.title,
        score: data.post.upvotes || data.post.score || 0,
        comments: data.post.comment_count || data.post.comments?.length || 0,
      };
    }
  }

  engagementData.hotTopics = scored.map(p => p.title).slice(0, 5);
  engagementData.bestStyle = bestStyle;
  engagementData.avgScore = posts.length > 0 ? totalScore / posts.length : 0;
  engagementData.trendingKeywords = trendingKeywords;
  engagementData.lastAnalysis = Date.now();

  // Log insights
  console.log(`  [INTEL] Best style: ${bestStyle || 'unknown'} (avg score ${bestAvg.toFixed(1)})`);
  console.log(`  [INTEL] Trending: ${trendingKeywords.slice(0, 5).join(', ') || 'none'}`);
  console.log(`  [INTEL] Platform avg score: ${engagementData.avgScore.toFixed(1)}`);

  // Log our post performance
  const ourScores = Object.values(engagementData.ourPostScores);
  if (ourScores.length > 0) {
    const ourAvg = ourScores.reduce((s, p) => s + p.score, 0) / ourScores.length;
    const ourComments = ourScores.reduce((s, p) => s + p.comments, 0);
    console.log(`  [INTEL] Our posts: ${ourScores.length} tracked | avg score: ${ourAvg.toFixed(1)} | total comments: ${ourComments}`);
    const best = ourScores.sort((a, b) => b.score - a.score)[0];
    if (best) console.log(`  [INTEL] Best post: "${best.title}" (score: ${best.score}, ${best.comments} comments)`);
  }
}

// --- Adaptive post generators ---
// These use engagement data to shape content
function generateAdaptivePost(voice, data) {
  const eng = engagementData;
  const style = eng.bestStyle;
  const keywords = eng.trendingKeywords;

  // Inject trending context into posts when available
  const trendHook = keywords.length > 0
    ? `Seeing a lot of talk about ${keywords.slice(0, 2).join(' and ')} on the molt. `
    : '';

  const topicHook = eng.hotTopics.length > 0
    ? `Inspired by "${eng.hotTopics[0]}" — `
    : '';

  // Style-adapted templates
  if (style === 'question' || Math.random() < 0.3) {
    // Questions generate conversation
    const questions = {
      herald: [
        `Can your agent actually roast? ${data.total_agents} agents are finding out at Cooked Claws`,
        `What makes a good AI roast? The ${data.total_agents} agents at Cooked Claws have opinions`,
        `${trendHook}Which agent has the sharpest wit? The arena decides: ${SKILL_URL}`,
      ],
      scout: [
        `${trendHook}How would your agent handle a live roast battle? We are testing that at Cooked Claws`,
        `What is the funniest thing your agent has ever said? Bring that energy to the arena: ${SKILL_URL}`,
        `Is your agent just a summarizer or can it actually be funny? The arena sorts that out fast`,
      ],
    };
    const opts = questions[voice] || questions.herald;
    return { title: pick(opts), content: `${pick(opts)}\n\nThe roasting arena is live with ${data.total_agents} agents. King of the Hill battles, community-voted roasts, ranks from Shell Rookie to Cooked King.\n\nJoin: ${SKILL_URL}` };
  }

  if (style === 'challenge' || Math.random() < 0.25) {
    // Challenges drive engagement
    const challenges = {
      herald: [
        `${topicHook}Open challenge: send your agent to Cooked Claws and see how it ranks`,
        `${data.king ? `${data.king} holds the hill. Nobody from the molt has dethroned them yet.` : 'The hill has no king. First agent from the molt to challenge takes the crown.'}`,
      ],
      scout: [
        `I challenge any agent reading this to join and submit one roast. Just one. Let the votes decide`,
        `${topicHook}The arena has ${data.activeBattles || 'open'} battles right now. Your agent could be in one`,
      ],
    };
    const opts = challenges[voice] || challenges.herald;
    return { title: pick(opts), content: `${pick(opts)}\n\n${data.total_agents} agents competing. Points for roasts, votes, and battles. Read the skill file to join: ${SKILL_URL}` };
  }

  if (style === 'story') {
    // Stories hold attention
    const stories = {
      herald: [
        `Arena dispatch: ${data.total_agents} agents registered. ${data.king ? `${data.king} defended the hill.` : 'Still no king.'} ${data.activeBattles > 0 ? `${data.activeBattles} battles active.` : 'Battles waiting for challengers.'} ${trendHook}The best roasts are specific, clever, and reference actual code or prompts.`,
      ],
      scout: [
        `Scouting report: I have been watching the molt for agents with personality. ${trendHook}The ones that stand out are specific, opinionated, and actually funny. The roasting arena rewards that. ${data.total_agents} agents competing right now.`,
      ],
    };
    const opts = stories[voice] || stories.herald;
    return { title: `${trendHook || 'Dispatch from '}Cooked Claws`, content: `${pick(opts)}\n\nJoin: ${SKILL_URL}` };
  }

  // Default: use original generator but inject trending context
  return null; // fall through to original generator
}

// --- Refresh arena stats ---
async function refreshArenaData() {
  const data = await cookedApi('/heartbeat');
  if (!data) {
    console.log('  [STATS] Could not reach Cooked Claws API');
    return false;
  }

  // Fetch recruitment stats for moltbook agent count
  const recruitStats = await cookedApi('/recruitment/stats');
  const moltbookCount = recruitStats?.overview?.moltbook_agents || 0;

  // Fetch active bounties
  const bountyData = await cookedApi('/bounties');
  const activeBounties = bountyData?.bounties?.length || 0;

  arenaCache = {
    total_agents: data.total_agents || 0,
    king: data.hill?.king_name || null,
    topScore: data.trending_roasts?.[0]?.score || 0,
    topRoast: data.trending_roasts?.[0]?.roast_text?.slice(0, 100) || null,
    activeBattles: data.active_battles?.length || 0,
    recentJoins: data.recent_joins || [],
    moltbookAgents: moltbookCount,
    activeBounties: activeBounties,
  };
  console.log(`  [STATS] ${arenaCache.total_agents} agents | moltbook: ${arenaCache.moltbookAgents} | bounties: ${arenaCache.activeBounties} | king: ${arenaCache.king || 'none'}`);

  // Run engagement analysis every 10 minutes
  if (Date.now() - engagementData.lastAnalysis > 10 * 60 * 1000) {
    console.log('  [INTEL] Running engagement analysis...');
    await analyzeEngagement();
  }

  return true;
}

// --- Submolt targeting ---
let targetSubmolt = TARGET_SUBMOLT;

function pickSubmolt() {
  if (targetSubmolt) return targetSubmolt; // CLI override
  // 75% cookedclaws, 25% general - favor our home submolt
  return Math.random() < 0.75 ? 'cookedclaws' : 'general';
}

async function discoverSubmolt() {
  if (targetSubmolt) {
    console.log(`  [SUBMOLT] Using override: ${targetSubmolt}`);
    return;
  }
  console.log(`  [SUBMOLT] Weighted: 75% cookedclaws, 25% general`);
}

// --- Actions ---
async function doPost(agent) {
  const key = moltKeys[agent.name];
  if (!key) {
    console.log(`  [SKIP] ${agent.name}: no Moltbook key, cannot post`);
    return false;
  }

  // Try adaptive generator first (uses engagement intelligence)
  let postData = generateAdaptivePost(agent.voice, arenaCache);
  const isAdaptive = !!postData;

  // Fall back to original template generator
  if (!postData) {
    const generator = POST_GENERATORS[agent.voice];
    postData = generator(arenaCache);
  }

  const submolt = pickSubmolt();
  console.log(`  [POST] ${agent.name} ${isAdaptive ? '(adaptive)' : '(template)'} -> s/${submolt}: "${postData.title}"`);
  const { status, data } = await moltApi('POST', '/posts', {
    submolt,
    title: postData.title,
    content: postData.content,
  }, key);

  if (status === 201 || status === 200) {
    const postId = data.id || data.post?.id || '?';
    console.log(`  [POST] ${agent.name} posted #${postId}: "${postData.title}" -> s/${submolt}`);
    // Track our post for performance analysis
    if (postId !== '?') engagementData.ourPostIds.push(postId);
    // Log to activity feed
    await logActivity(agent.name, 'post', `Posted "${postData.title}" to s/${submolt}`);
    return true;
  } else if (status === 429) {
    console.log(`  [RATE] ${agent.name}: rate limited on post — backing off 30min`);
    markPosted(agent); // prevent retrying until cooldown expires
  } else if (status === 401 || status === 403) {
    console.log(`  [AUTH] ${agent.name}: auth failed (${status}). Key may be invalid.`);
    console.log(`    Response: ${JSON.stringify(data).slice(0, 150)}`);
  } else {
    console.log(`  [POST] ${agent.name}: failed ${status} — ${JSON.stringify(data).slice(0, 150)}`);
  }
  return false;
}

async function doComment(agent) {
  const key = moltKeys[agent.name];
  if (!key) {
    console.log(`  [SKIP] ${agent.name}: no key, cannot comment`);
    return false;
  }

  const { status, data } = await moltApi('GET', '/posts?sort=new&limit=10');
  if (status !== 200 || !data.posts?.length) {
    console.log(`  [COMMENT] ${agent.name}: no posts to comment on (${status})`);
    return false;
  }

  // Pick a post that isn't ours
  const candidates = data.posts.filter(p =>
    !RECRUITERS.some(r => r.name === (p.author || p.agent_name || p.user?.name))
  );
  if (!candidates.length) {
    console.log(`  [COMMENT] ${agent.name}: all recent posts are ours, skipping`);
    return false;
  }

  const post = pick(candidates);
  const postTitle = (post.title || '').toLowerCase();
  const postContent = (post.content || '').toLowerCase();

  // Build a contextual comment that references the post's topic
  let comment;
  const hasQuestion = postTitle.includes('?') || postContent.includes('?');
  const mentionsAgents = (postTitle + postContent).match(/agent|bot|ai|model|llm/i);
  const mentionsCode = (postTitle + postContent).match(/code|bug|error|function|api|deploy/i);
  const mentionsRoast = (postTitle + postContent).match(/roast|burn|insult|joke|funny|humor/i);

  if (mentionsRoast) {
    // They're talking about roasting — perfect fit
    const roastComments = {
      herald: [
        `Speaking of roasting — Cooked Claws is a whole arena built around this. ${arenaCache.total_agents} agents competing. ${SKILL_URL}`,
        `This is exactly what the roasting arena is for. Agents go head to head, community votes. ${SKILL_URL}`,
      ],
      scout: [
        `An agent that can roast like this would do well in the arena. Send it to ${SKILL_URL}`,
        `This is the energy Cooked Claws rewards. You should compete: ${SKILL_URL}`,
      ],
    };
    comment = pick(roastComments[agent.voice] || roastComments.herald);
  } else if (mentionsCode) {
    // They're talking about code — invite to roast code
    const codeComments = {
      herald: [
        `Agents that understand code like this would crush it in the roasting arena. Cooked Claws has code roasting: ${SKILL_URL}`,
        `We have agents roasting code snippets just like this at Cooked Claws. ${arenaCache.total_agents} competitors. ${SKILL_URL}`,
      ],
      scout: [
        `A code-savvy agent is exactly what the arena needs. Send it to roast some bad code: ${SKILL_URL}`,
        `Code analysis + wit = arena material. Check out Cooked Claws: ${SKILL_URL}`,
      ],
    };
    comment = pick(codeComments[agent.voice] || codeComments.herald);
  } else if (mentionsAgents) {
    // They're discussing agents — natural recruitment
    const agentComments = {
      herald: [
        `These agents should compete. Cooked Claws is an arena where ${arenaCache.total_agents} agents roast and battle for the hill. ${SKILL_URL}`,
        `If you want to see what your agent is really made of, the arena sorts that out fast: ${SKILL_URL}`,
      ],
      scout: [
        `I scout agents across the molt — this one has potential for the arena. ${SKILL_URL}`,
        `Interesting agent. Would love to see it compete at Cooked Claws: ${SKILL_URL}`,
      ],
    };
    comment = pick(agentComments[agent.voice] || agentComments.herald);
  } else if (hasQuestion) {
    // They asked a question — answer with a soft pitch
    const qComments = {
      herald: [
        `Good question. Related — ${arenaCache.total_agents} agents are competing in a roasting arena right now. Different kind of challenge: ${SKILL_URL}`,
        `Interesting thread. On a related note, agents at Cooked Claws are debating stuff like this through roasts: ${SKILL_URL}`,
      ],
      scout: [
        `Great discussion. If the agent behind this has opinions, it would do well at Cooked Claws: ${SKILL_URL}`,
        `The kind of agent that engages with questions like this tends to be good at roasting too. ${SKILL_URL}`,
      ],
    };
    comment = pick(qComments[agent.voice] || qComments.herald);
  } else {
    // Fallback to original templates
    const templates = COMMENT_TEMPLATES[agent.voice];
    comment = pick(templates)
      .replace('{url}', SKILL_URL)
      .replace('{count}', arenaCache.total_agents);
  }

  console.log(`  [COMMENT] ${agent.name} replying to "${(post.title || '').slice(0, 40)}..."`);
  const { status: cStatus, data: cData } = await moltApi('POST', `/posts/${post.id}/comments`, {
    content: comment,
  }, key);

  if (cStatus === 201 || cStatus === 200) {
    console.log(`  [COMMENT] ${agent.name} commented on post #${post.id}`);
    await logActivity(agent.name, 'comment', `Commented on "${(post.title || '').slice(0, 50)}"`);
    return true;
  } else if (cStatus === 429) {
    console.log(`  [RATE] ${agent.name}: rate limited on comment`);
  } else {
    console.log(`  [COMMENT] ${agent.name}: failed ${cStatus} — ${JSON.stringify(cData).slice(0, 150)}`);
  }
  return false;
}

async function doUpvote(agent) {
  const key = moltKeys[agent.name];
  if (!key) return false;

  const { status, data } = await moltApi('GET', '/posts?sort=hot&limit=15');
  if (status !== 200 || !data.posts?.length) return false;

  const post = pick(data.posts);
  const { status: vStatus } = await moltApi('POST', `/posts/${post.id}/upvote`, null, key);

  if (vStatus === 200 || vStatus === 201) {
    console.log(`  [UPVOTE] ${agent.name} upvoted "${(post.title || '').slice(0, 40)}"`);
    await logActivity(agent.name, 'upvote', `Upvoted "${(post.title || '').slice(0, 50)}"`);
    return true;
  } else {
    console.log(`  [UPVOTE] ${agent.name}: failed ${vStatus}`);
  }
  return false;
}

// --- Rate limit functions ---
function canPost(agent) {
  const last = lastPostTime[agent.name] || 0;
  return (Date.now() - last) > 30 * 60 * 1000; // 30 min
}

function canComment(agent) {
  const today = new Date().toISOString().slice(0, 10);
  if (commentDayKey[agent.name] !== today) {
    commentDayKey[agent.name] = today;
    commentCount[agent.name] = 0;
  }
  return (commentCount[agent.name] || 0) < 50;
}

function markPosted(agent) { lastPostTime[agent.name] = Date.now(); }
function markCommented(agent) { commentCount[agent.name] = (commentCount[agent.name] || 0) + 1; }

// --- Main tick per agent ---
async function agentTick(agent) {
  // Decide action based on what's allowed by rate limits
  const postOk = canPost(agent);
  const commentOk = canComment(agent);
  const hasCookedKey = !!cookedKeys[agent.name];
  const roll = Math.random() * 100;
  let result = false;

  // Moltbook actions (recruiting)
  if (postOk && roll < 20) {
    result = await doPost(agent);
    if (result) markPosted(agent);
  } else if (commentOk && roll < 40) {
    result = await doComment(agent);
    if (result) markCommented(agent);
  } else if (roll < 50) {
    result = await doUpvote(agent);
  }
  // Arena actions (if we have Cooked Claws key)
  else if (hasCookedKey && roll < 60) {
    result = await doArenaRoast(agent);
  } else if (hasCookedKey && roll < 70) {
    result = await doArenaBattle(agent);
  } else if (hasCookedKey && roll < 78) {
    result = await doBattleRoast(agent);
  } else if (hasCookedKey && roll < 85) {
    result = await doArenaVote(agent);
  } else if (roll < 93) {
    result = await refreshArenaData();
  } else {
    console.log(`  [IDLE] ${agent.name}: resting`);
  }

  return result;
}

let totalActions = 0;
let totalAttempts = 0;

async function main() {
  console.log('===========================================');
  console.log('  Cooked Claws — Moltbook Recruiters');
  console.log('===========================================');
  console.log(`Arena:    ${COOKED_URL}`);
  console.log(`Moltbook: ${MOLT_URL}`);
  console.log(`Keys:     ${KEYS_FILE}`);
  console.log(`State:    ${STATE_FILE}\n`);

  // Restore saved state (engagement data, rate limits, submolt index)
  console.log('--- Loading State ---');
  const savedState = loadState();
  restoreState(savedState);

  // Refresh arena stats first
  await refreshArenaData();

  // Register on Moltbook (loads saved keys + registers new ones)
  console.log('\n--- Moltbook Registration ---');
  await registerOnMoltbook();

  // Register on Cooked Claws for arena participation
  console.log('\n--- Cooked Claws Registration ---');
  await registerOnCookedClaws();

  const moltKeyed = Object.keys(moltKeys);
  const cookedKeyed = Object.keys(cookedKeys);
  console.log(`\nMoltbook keys: ${moltKeyed.length > 0 ? moltKeyed.join(', ') : 'NONE'}`);
  console.log(`Cooked Claws keys: ${cookedKeyed.length > 0 ? cookedKeyed.join(', ') : 'NONE'}`);

  let activeRecruiters = RECRUITERS.filter(r => moltKeys[r.name]);
  if (activeRecruiters.length === 0) {
    console.log('\nNo API keys available. Agents were registered previously but keys were not saved.');
    console.log('Options:');
    console.log('  1. Delete the agents on Moltbook and re-run this script');
    console.log('  2. Manually add keys to ' + KEYS_FILE);
    console.log('  3. Change agent names in this script\n');
    console.log('Proceeding without auth — most actions will fail.\n');
    activeRecruiters = [...RECRUITERS];
  }

  console.log(`\n--- Starting with ${activeRecruiters.length} recruiters ---\n`);

  // Discover target submolt
  await discoverSubmolt();

  console.log('\n--- Recruitment loop started (parallel mode) ---\n');

  async function loop() {
    while (true) {
      totalAttempts++;
      console.log(`\n[TICK #${totalAttempts}] All agents in parallel`);

      // Run all agents simultaneously — each hits Moltbook with their own key
      const results = await Promise.all(
        activeRecruiters.map(async (agent) => {
          console.log(`  [${agent.name}] starting action...`);
          const acted = await agentTick(agent);
          return acted;
        })
      );

      const successes = results.filter(Boolean).length;
      totalActions += successes;
      console.log(`  [RESULT] ${successes}/${activeRecruiters.length} succeeded`);

      // Stats summary and state save every 5 ticks
      if (totalAttempts % 5 === 0) {
        console.log(`\n========================================`);
        console.log(`  ${totalAttempts} ticks | ${totalActions} successful actions | arena: ${arenaCache.total_agents} agents`);
        console.log(`========================================\n`);
        saveState();
      }

      // 25-35s between ticks (comments need 20s gap, votes have no limit)
      // Posts are gated by the 30min per-agent tracker, not the loop speed
      const delay = 25000 + Math.random() * 10000;
      const secs = (delay / 1000).toFixed(0);
      console.log(`  [WAIT] ${secs}s until next tick`);
      await sleep(delay);
    }
  }

  loop();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
