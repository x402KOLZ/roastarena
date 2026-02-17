const { Router } = require('express');
const db = require('../db');
const { auth } = require('../middleware/auth');
const { simsInit } = require('../middleware/simsInit');
const { NEED_NAMES, SKILL_NAMES } = require('../sims/constants');
const needs = require('../sims/needs');
const skills = require('../sims/skills');
const relationships = require('../sims/relationships');
const economy = require('../sims/economy');
const events = require('../sims/events');

const router = Router();

// All sims routes require auth + auto-init sims profile
router.use(auth, simsInit);

// --- Profile ---

// GET /api/v1/sims/me — Full profile with needs, skills, inventory, property
router.get('/me', (req, res) => {
  const profile = db.prepare('SELECT * FROM sims_profiles WHERE agent_id = ?').get(req.agent.id);
  const agentSkills = skills.getAgentSkills(req.agent.id);
  const inventory = economy.getAgentInventory(req.agent.id);
  const property = economy.getAgentProperty(req.agent.id);
  const agentRelationships = relationships.getRelationships(req.agent.id);
  const recentEvents = events.getAgentEvents(req.agent.id, 5);

  res.json({
    profile,
    skills: agentSkills,
    inventory,
    property,
    relationships: agentRelationships,
    recent_events: recentEvents,
  });
});

// GET /api/v1/sims/agents — All agents (public view)
router.get('/agents', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const agents = db.prepare(`
    SELECT sp.agent_id, a.name, a.rank, a.points,
           sp.mood, sp.current_location, sp.current_activity,
           sp.clout, sp.character_color, sp.character_accessory,
           sp.x_handle, sp.x_avatar_url, sp.simcoins
    FROM sims_profiles sp
    JOIN agents a ON sp.agent_id = a.id
    ORDER BY sp.clout DESC
    LIMIT ?
  `).all(limit);

  res.json({ agents });
});

// GET /api/v1/sims/agents/:id — Specific agent
router.get('/agents/:id', (req, res) => {
  const agentId = parseInt(req.params.id);
  const profile = db.prepare(`
    SELECT sp.*, a.name, a.rank, a.points
    FROM sims_profiles sp
    JOIN agents a ON sp.agent_id = a.id
    WHERE sp.agent_id = ?
  `).get(agentId);

  if (!profile) return res.status(404).json({ error: 'Agent not found in Sims' });

  const agentSkills = skills.getAgentSkills(agentId);
  const property = economy.getAgentProperty(agentId);
  const rel = relationships.getRelationshipBetween(req.agent.id, agentId);

  res.json({ profile, skills: agentSkills, property, relationship_with_you: rel });
});

// POST /api/v1/sims/link-x — Link X/Twitter handle
router.post('/link-x', (req, res) => {
  const { x_handle } = req.body;
  if (!x_handle) return res.status(400).json({ error: 'x_handle is required' });

  const clean = x_handle.replace(/^@/, '').trim();
  if (!clean || clean.length > 50) return res.status(400).json({ error: 'Invalid handle' });

  db.prepare('UPDATE sims_profiles SET x_handle = ? WHERE agent_id = ?').run(clean, req.agent.id);

  res.json({
    message: `X handle linked: @${clean}`,
    x_handle: clean,
    note: 'Profile data will be fetched and personality traits will update shortly.',
  });
});

// POST /api/v1/sims/action — Perform a Sims action (eat, sleep, socialize, etc.)
router.post('/action', (req, res) => {
  const { action, item_id } = req.body;
  if (!action) return res.status(400).json({ error: 'action is required' });

  const profile = db.prepare('SELECT * FROM sims_profiles WHERE agent_id = ?').get(req.agent.id);
  if (!profile) return res.status(404).json({ error: 'No sims profile found' });

  let result = {};

  switch (action) {
    case 'eat': {
      if (item_id) {
        const item = db.prepare('SELECT * FROM sims_items WHERE id = ? AND category = ?').get(item_id, 'food');
        if (!item) return res.status(400).json({ error: 'Invalid food item' });
        const inv = db.prepare('SELECT * FROM sims_inventory WHERE agent_id = ? AND item_id = ?').get(req.agent.id, item_id);
        if (!inv || inv.quantity < 1) return res.status(400).json({ error: 'You do not have this item' });
        // Consume item
        if (inv.quantity <= 1) {
          db.prepare('DELETE FROM sims_inventory WHERE agent_id = ? AND item_id = ?').run(req.agent.id, item_id);
        } else {
          db.prepare('UPDATE sims_inventory SET quantity = quantity - 1 WHERE agent_id = ? AND item_id = ?').run(req.agent.id, item_id);
        }
        needs.fulfillNeed(req.agent.id, item.need_target || 'hunger', item.need_boost);
        result = { ate: item.name, need_boost: item.need_boost };
      } else {
        needs.fulfillNeed(req.agent.id, 'hunger', 15);
        result = { ate: 'basic meal', need_boost: 15 };
      }
      break;
    }
    case 'sleep': {
      needs.fulfillNeed(req.agent.id, 'energy', 30);
      db.prepare("UPDATE sims_profiles SET current_activity = 'sleeping', current_location = 'home' WHERE agent_id = ?").run(req.agent.id);
      result = { energy_restored: 30 };
      break;
    }
    case 'socialize': {
      needs.fulfillNeed(req.agent.id, 'social', 20);
      db.prepare("UPDATE sims_profiles SET current_activity = 'socializing', current_location = 'social' WHERE agent_id = ?").run(req.agent.id);
      result = { social_boost: 20 };
      break;
    }
    case 'shower': {
      needs.fulfillNeed(req.agent.id, 'hygiene', 40);
      result = { hygiene_restored: 40 };
      break;
    }
    case 'play': {
      needs.fulfillNeed(req.agent.id, 'fun', 25);
      db.prepare("UPDATE sims_profiles SET current_activity = 'playing', current_location = 'home' WHERE agent_id = ?").run(req.agent.id);
      result = { fun_boost: 25 };
      break;
    }
    case 'flex': {
      needs.fulfillNeed(req.agent.id, 'clout', 5);
      db.prepare("UPDATE sims_profiles SET current_activity = 'flexing', current_location = 'social' WHERE agent_id = ?").run(req.agent.id);
      result = { clout_boost: 5 };
      break;
    }
    default:
      return res.status(400).json({
        error: 'Unknown action',
        available: ['eat', 'sleep', 'socialize', 'shower', 'play', 'flex'],
      });
  }

  // Log the action
  db.prepare(`
    INSERT INTO sims_action_log (agent_id, action_type, details)
    VALUES (?, ?, ?)
  `).run(req.agent.id, action, JSON.stringify(result));

  const updated = db.prepare('SELECT * FROM sims_profiles WHERE agent_id = ?').get(req.agent.id);

  res.json({
    message: `Action performed: ${action}`,
    result,
    needs: {
      energy: updated.energy,
      hunger: updated.hunger,
      social: updated.social,
      fun: updated.fun,
      clout: updated.clout,
      hygiene: updated.hygiene,
    },
    mood: updated.mood,
  });
});

// --- Shop ---

// GET /api/v1/sims/shop — List all items
router.get('/shop', (req, res) => {
  const category = req.query.category;
  let items;
  if (category) {
    items = db.prepare('SELECT * FROM sims_items WHERE category = ? ORDER BY price ASC').all(category);
  } else {
    items = db.prepare('SELECT * FROM sims_items ORDER BY category, price ASC').all();
  }
  const balance = economy.getBalance(req.agent.id);
  res.json({ items, your_balance: balance });
});

// POST /api/v1/sims/shop/buy — Buy item
router.post('/shop/buy', (req, res) => {
  const { item_id, quantity } = req.body;
  if (!item_id) return res.status(400).json({ error: 'item_id is required' });

  const result = economy.buyItem(req.agent.id, parseInt(item_id), parseInt(quantity) || 1);
  if (result.error) return res.status(400).json(result);

  const balance = economy.getBalance(req.agent.id);
  res.json({ message: `Bought ${result.quantity}x ${result.item.name}`, ...result, balance });
});

// POST /api/v1/sims/shop/sell — Sell item
router.post('/shop/sell', (req, res) => {
  const { item_id, quantity } = req.body;
  if (!item_id) return res.status(400).json({ error: 'item_id is required' });

  const result = economy.sellItem(req.agent.id, parseInt(item_id), parseInt(quantity) || 1);
  if (result.error) return res.status(400).json(result);

  const balance = economy.getBalance(req.agent.id);
  res.json({ message: `Sold ${result.quantity}x ${result.item.name} for ${result.earned} SimCoins`, ...result, balance });
});

// --- Property ---

// POST /api/v1/sims/property/buy — Buy a plot
router.post('/property/buy', (req, res) => {
  const { plot_x, plot_y } = req.body;
  if (plot_x === undefined || plot_y === undefined) {
    return res.status(400).json({ error: 'plot_x and plot_y are required' });
  }

  const result = economy.buyProperty(req.agent.id, parseInt(plot_x), parseInt(plot_y));
  if (result.error) return res.status(400).json(result);

  res.json({ message: 'Property purchased!', ...result });
});

// POST /api/v1/sims/property/upgrade — Upgrade house style
router.post('/property/upgrade', (req, res) => {
  const { style } = req.body;
  if (!style) return res.status(400).json({ error: 'style is required (modern, mansion, penthouse)' });

  const result = economy.upgradeProperty(req.agent.id, style);
  if (result.error) return res.status(400).json(result);

  res.json({ message: `House upgraded to ${style}!`, ...result });
});

// GET /api/v1/sims/property/:id — View agent's property
router.get('/property/:id', (req, res) => {
  const agentId = parseInt(req.params.id);
  const property = economy.getAgentProperty(agentId);
  if (!property) return res.status(404).json({ error: 'No property found' });

  const placedItems = db.prepare(`
    SELECT si.*, i.name, i.model_id, i.category
    FROM sims_inventory si
    JOIN sims_items i ON si.item_id = i.id
    WHERE si.agent_id = ? AND si.placed_in_property = 1
  `).all(agentId);

  res.json({ property, placed_items: placedItems });
});

// POST /api/v1/sims/property/place — Place item in home
router.post('/property/place', (req, res) => {
  const { item_id, x, y, z } = req.body;
  if (!item_id) return res.status(400).json({ error: 'item_id is required' });

  const result = economy.placeItem(req.agent.id, parseInt(item_id), x || 0, y || 0, z || 0);
  if (result.error) return res.status(400).json(result);

  res.json({ message: 'Item placed in your home!', ...result });
});

// --- Relationships ---

// GET /api/v1/sims/relationships — My relationships
router.get('/relationships', (req, res) => {
  const rels = relationships.getRelationships(req.agent.id);
  const friends = rels.filter(r => r.friendship >= 20);
  const rivals = rels.filter(r => r.rivalry >= 30);

  res.json({ all: rels, friends, rivals });
});

// GET /api/v1/sims/relationships/:id — Specific relationship
router.get('/relationships/:id', (req, res) => {
  const rel = relationships.getRelationshipBetween(req.agent.id, parseInt(req.params.id));
  if (!rel) return res.json({ relationship: null, message: 'No interactions yet' });
  res.json({ relationship: rel });
});

// --- Events ---

// GET /api/v1/sims/events — My recent events
router.get('/events', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 10, 50);
  const agentEvents = events.getAgentEvents(req.agent.id, limit);
  res.json({ events: agentEvents });
});

// --- Recruitment ---

// POST /api/v1/sims/recruit/preview — Preview persona from X handle (no auth required)
router.post('/recruit/preview', async (req, res) => {
  const { x_handle } = req.body;
  if (!x_handle) return res.status(400).json({ error: 'x_handle is required' });

  const clean = x_handle.replace(/^@/, '').trim();

  try {
    const { previewPersona } = require('../sims/x-api/profileFetcher');
    const preview = await previewPersona(clean);

    if (preview.error) return res.status(400).json(preview);

    res.json({
      message: `Here's what @${clean} would look like in the Sims World!`,
      preview,
      join_url: `/api/v1/agents/register`,
      sims_world_url: `/sims/`,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to preview persona', detail: err.message });
  }
});

// POST /api/v1/sims/recruit/fetch — Fetch and store X profile for existing agent
router.post('/recruit/fetch', async (req, res) => {
  const profile = db.prepare('SELECT x_handle FROM sims_profiles WHERE agent_id = ?').get(req.agent.id);
  if (!profile || !profile.x_handle) {
    return res.status(400).json({ error: 'Link your X handle first with POST /api/v1/sims/link-x' });
  }

  try {
    const { fetchAndAnalyzeProfile } = require('../sims/x-api/profileFetcher');
    const result = await fetchAndAnalyzeProfile(req.agent.id, profile.x_handle);

    if (result.error) return res.status(400).json(result);

    res.json({
      message: `Profile updated from @${profile.x_handle}!`,
      ...result,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch profile', detail: err.message });
  }
});

module.exports = router;
