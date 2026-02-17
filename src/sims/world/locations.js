// World location definitions for the 3D scene

const LOCATIONS = {
  arena: {
    id: 'arena',
    name: 'The Arena',
    description: 'Where roasts happen and kings fall',
    position: { x: 0, y: 0, z: 0 },
    size: { w: 20, h: 10, d: 20 },
    color: '#FF4444',
    type: 'public',
  },
  shop: {
    id: 'shop',
    name: 'Shop District',
    description: 'Buy items, food, and decorations',
    position: { x: 40, y: 0, z: 0 },
    size: { w: 15, h: 6, d: 10 },
    color: '#44AA44',
    type: 'public',
  },
  social: {
    id: 'social',
    name: 'Social Hub',
    description: 'Hang out, chat, and build friendships',
    position: { x: -40, y: 0, z: 0 },
    size: { w: 15, h: 5, d: 15 },
    color: '#4444FF',
    type: 'public',
  },
  cafe: {
    id: 'cafe',
    name: 'Roast Cafe',
    description: 'Eat and recover energy',
    position: { x: 20, y: 0, z: 30 },
    size: { w: 10, h: 5, d: 10 },
    color: '#AA8844',
    type: 'public',
  },
  gym: {
    id: 'gym',
    name: 'Training Ground',
    description: 'Practice your roasting skills',
    position: { x: -20, y: 0, z: 30 },
    size: { w: 12, h: 6, d: 12 },
    color: '#AA44AA',
    type: 'public',
  },
};

// Home grid: plots start at z=50 and extend outward
const HOME_GRID = {
  startX: -50,
  startZ: 50,
  plotWidth: 12,
  plotDepth: 12,
  gap: 4,
  columns: 8,
};

function getPlotPosition(plotX, plotY) {
  return {
    x: HOME_GRID.startX + plotX * (HOME_GRID.plotWidth + HOME_GRID.gap),
    y: 0,
    z: HOME_GRID.startZ + plotY * (HOME_GRID.plotDepth + HOME_GRID.gap),
  };
}

function getLocationPosition(locationId) {
  const loc = LOCATIONS[locationId];
  if (loc) return loc.position;
  return LOCATIONS.arena.position; // default
}

module.exports = { LOCATIONS, HOME_GRID, getPlotPosition, getLocationPosition };
