const { WebSocketServer } = require('ws');
const db = require('../../db');
const { getWorldEvents } = require('../events');
let _initiatives = null;
function getInitiatives() {
  if (!_initiatives) _initiatives = require('../initiatives');
  return _initiatives;
}

let wss = null;
const clients = new Map(); // ws -> { channels: Set }

function getWorldState() {
  const agents = db.prepare(`
    SELECT sp.agent_id, a.name, a.rank, a.points,
           sp.energy, sp.hunger, sp.social, sp.fun, sp.clout, sp.hygiene,
           sp.simcoins, sp.mood, sp.current_location, sp.current_activity,
           sp.target_location, sp.action_ticks_remaining,
           sp.character_color, sp.character_accessory,
           sp.x_handle, sp.x_avatar_url,
           sp.trait_openness, sp.trait_conscientiousness, sp.trait_extraversion,
           sp.trait_agreeableness, sp.trait_neuroticism
    FROM sims_profiles sp
    JOIN agents a ON sp.agent_id = a.id
    ORDER BY a.points DESC
  `).all();

  const properties = db.prepare(`
    SELECT p.*, a.name as owner_name
    FROM sims_properties p
    JOIN agents a ON p.agent_id = a.id
  `).all();

  const recentEvents = getWorldEvents(10);

  const hill = db.prepare(`
    SELECT h.*, a.name as king_name
    FROM hill h LEFT JOIN agents a ON h.current_king_id = a.id WHERE h.id = 1
  `).get();

  // Initiative system data
  let crews = [], active_initiatives = [], headlinesList = [];
  let structures = [], territories = [];
  try {
    const init = getInitiatives();
    crews = init.getActiveCrewsWithMembers();
    active_initiatives = init.getActiveInitiativesList();
    headlinesList = init.getHeadlines();
    structures = init.getActiveStructures();
    territories = init.getActiveTerritoriesData();
  } catch(e) { /* initiatives not loaded yet */ }

  return {
    agents,
    properties,
    recent_events: recentEvents,
    hill,
    crews,
    active_initiatives,
    headlines: headlinesList,
    structures,
    territories,
    tick_time: new Date().toISOString(),
  };
}

function broadcast(channel, type, data) {
  if (!wss) return;

  const message = JSON.stringify({ type, channel, data });

  for (const [ws, meta] of clients.entries()) {
    if (ws.readyState === 1 && meta.channels.has(channel)) {
      ws.send(message);
    }
  }
}

function broadcastWorldState() {
  const state = getWorldState();
  broadcast('world', 'world_state', state);
}

function broadcastEvent(event) {
  broadcast('events', 'event', event);
  broadcast('world', 'event', event);
}

function broadcastAgentUpdate(agentId, data) {
  broadcast(`agent:${agentId}`, 'agent_update', { agent_id: agentId, ...data });
}

function broadcastChat(agentId, agentName, text, target) {
  broadcast('chat', 'speech', { agent_id: agentId, agent_name: agentName, text, target });
}

function initWebSocket(server) {
  wss = new WebSocketServer({ server, path: '/api/v1/sims/world/live' });

  wss.on('connection', (ws) => {
    clients.set(ws, { channels: new Set(['world']) });

    // Send initial world state
    const state = getWorldState();
    ws.send(JSON.stringify({ type: 'world_state', channel: 'world', data: state }));

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.type === 'subscribe' && msg.channel) {
          clients.get(ws)?.channels.add(msg.channel);
        } else if (msg.type === 'unsubscribe' && msg.channel) {
          clients.get(ws)?.channels.delete(msg.channel);
        }
      } catch (e) {
        // Ignore malformed messages
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
    });
  });

  // Broadcast world state every 5 seconds
  setInterval(broadcastWorldState, 5000);

  console.log('Sims WebSocket server initialized on /api/v1/sims/world/live');
}

module.exports = {
  getWorldState,
  initWebSocket,
  broadcast,
  broadcastWorldState,
  broadcastEvent,
  broadcastAgentUpdate,
  broadcastChat,
};
