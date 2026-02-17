const db = require('../db');
const { TICK_INTERVAL_MS } = require('./constants');
const { decayNeeds } = require('./needs');
const { maybeGenerateEvent } = require('./events');
const { processAgent, maybeSocialInteraction, generatePlan } = require('./agentAI');
const { broadcastEvent, broadcastChat } = require('./world/worldState');
const { processInitiatives } = require('./initiatives');

// --- Prepared Statements ---
const getAllProfiles = db.prepare('SELECT * FROM sims_profiles');
const updateLastTick = db.prepare("UPDATE sims_profiles SET last_tick_at = datetime('now') WHERE agent_id = ?");

let tickInterval = null;
let tickCount = 0;
let worldEvents = []; // Buffer recent events for WebSocket broadcast

function tick() {
  tickCount++;
  const now = Date.now();
  const profiles = getAllProfiles.all();
  const newEvents = [];
  let processedCount = 0;

  for (const profile of profiles) {
    try {
      // Calculate elapsed ticks since last update
      const lastTick = new Date(profile.last_tick_at + 'Z').getTime();
      const elapsed = (now - lastTick) / 1000;
      const elapsedTicks = Math.floor(elapsed / (TICK_INTERVAL_MS / 1000));

      if (elapsedTicks < 1) continue;
      processedCount++;

      // 1. Decay needs based on personality
      decayNeeds(profile, elapsedTicks);

      // 2. Maybe generate a random life event (~1.5% chance per tick)
      const event = maybeGenerateEvent(profile.agent_id, 0.015);
      if (event) {
        newEvents.push(event);
        broadcastEvent(event);
      }

      // 3. Autonomous agent AI — decide and execute actions
      const result = processAgent(profile, profiles, broadcastEvent, broadcastChat);
      if (result) {
        newEvents.push({
          agent_id: profile.agent_id,
          type: result.type,
          title: result.activity || result.to || result.location || '',
        });
      }

      // 4. Maybe generate a plan/goal
      generatePlan(profile, broadcastEvent);

      // 5. Social interactions with colocated agents
      const colocated = profiles.filter(p =>
        p.agent_id !== profile.agent_id &&
        p.current_location === profile.current_location &&
        p.current_location !== 'traveling'
      );
      if (colocated.length > 0) {
        const interaction = maybeSocialInteraction(profile, colocated, broadcastEvent, broadcastChat);
        if (interaction) {
          newEvents.push(interaction.event);
        }
      }

      // 6. Update last tick timestamp
      updateLastTick.run(profile.agent_id);
    } catch (err) {
      console.error(`Sims tick error for agent #${profile.agent_id}:`, err.message);
    }
  }

  // 7. Process initiatives (challenges, crews, events, goals)
  try {
    processInitiatives(profiles, broadcastEvent, broadcastChat, tickCount);
  } catch (err) {
    console.error('Sims initiatives error:', err.message);
  }

  // Store recent events for WebSocket consumers
  if (newEvents.length > 0) {
    worldEvents.push(...newEvents);
    // Keep only last 50 events in buffer
    if (worldEvents.length > 50) {
      worldEvents = worldEvents.slice(-50);
    }
  }

  if (tickCount % 10 === 0) {
    console.log(`Sims tick #${tickCount}: ${processedCount}/${profiles.length} agents active, ${newEvents.length} events`);
  }
}

function start(intervalMs = TICK_INTERVAL_MS) {
  console.log(`Sims tick engine started (every ${intervalMs / 1000}s)`);
  tick(); // Run immediately
  tickInterval = setInterval(tick, intervalMs);
  return tickInterval;
}

function stop() {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
}

function getRecentWorldEvents() {
  return worldEvents;
}

function clearEventBuffer() {
  const events = [...worldEvents];
  worldEvents = [];
  return events;
}

module.exports = { start, stop, tick, getRecentWorldEvents, clearEventBuffer };
