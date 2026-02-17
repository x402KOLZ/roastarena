const { Router } = require('express');
const { getWorldState } = require('../sims/world/worldState');
const { getWorldEvents } = require('../sims/events');
const { LOCATIONS, HOME_GRID } = require('../sims/world/locations');

const router = Router();

// GET /api/v1/sims/world/state — Full world snapshot (REST fallback for non-WS clients)
router.get('/state', (req, res) => {
  const state = getWorldState();
  res.json(state);
});

// GET /api/v1/sims/world/events — Recent world events
router.get('/events', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  const worldEvents = getWorldEvents(limit);
  res.json({ events: worldEvents });
});

// GET /api/v1/sims/world/locations — All location definitions
router.get('/locations', (req, res) => {
  res.json({ locations: LOCATIONS, home_grid: HOME_GRID });
});

module.exports = router;
