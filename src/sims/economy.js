const db = require('../db');
const { SIMCOIN_RATES, PROPERTY_COSTS } = require('./constants');

// --- Prepared Statements ---
const getSimcoins = db.prepare('SELECT simcoins FROM sims_profiles WHERE agent_id = ?');
const addSimcoins = db.prepare('UPDATE sims_profiles SET simcoins = simcoins + ? WHERE agent_id = ?');
const subtractSimcoins = db.prepare('UPDATE sims_profiles SET simcoins = simcoins - ? WHERE agent_id = ?');

const getItem = db.prepare('SELECT * FROM sims_items WHERE id = ?');
const getInventoryItem = db.prepare('SELECT * FROM sims_inventory WHERE agent_id = ? AND item_id = ?');
const insertInventory = db.prepare(`
  INSERT INTO sims_inventory (agent_id, item_id, quantity) VALUES (?, ?, ?)
`);
const updateInventoryQty = db.prepare('UPDATE sims_inventory SET quantity = quantity + ? WHERE agent_id = ? AND item_id = ?');
const deleteInventoryItem = db.prepare('DELETE FROM sims_inventory WHERE agent_id = ? AND item_id = ?');

const getProperty = db.prepare('SELECT * FROM sims_properties WHERE agent_id = ?');
const insertProperty = db.prepare('INSERT INTO sims_properties (agent_id, plot_x, plot_y) VALUES (?, ?, ?)');
const updatePropertyStyle = db.prepare('UPDATE sims_properties SET house_style = ?, house_level = ? WHERE agent_id = ?');
const checkPlot = db.prepare('SELECT * FROM sims_properties WHERE plot_x = ? AND plot_y = ?');

const getInventory = db.prepare(`
  SELECT si.*, i.name, i.description, i.category, i.price, i.need_target, i.need_boost, i.model_id, i.rarity
  FROM sims_inventory si
  JOIN sims_items i ON si.item_id = i.id
  WHERE si.agent_id = ?
`);

function awardSimcoins(agentId, amount) {
  if (amount <= 0) return;
  addSimcoins.run(amount, agentId);
}

function arenaPointsToSimcoins(agentId, arenaPoints) {
  const simcoins = Math.floor(arenaPoints * SIMCOIN_RATES.ARENA_POINT);
  if (simcoins > 0) awardSimcoins(agentId, simcoins);
  return simcoins;
}

function bountyToSimcoins(agentId, bountyAmount, currency) {
  const rate = currency === 'USDC' ? SIMCOIN_RATES.USDC_BOUNTY : SIMCOIN_RATES.CLAW_BOUNTY;
  const simcoins = Math.floor(parseFloat(bountyAmount) * rate);
  if (simcoins > 0) awardSimcoins(agentId, simcoins);
  return simcoins;
}

function buyItem(agentId, itemId, quantity = 1) {
  const item = getItem.get(itemId);
  if (!item) return { error: 'Item not found' };

  const totalCost = item.price * quantity;
  const wallet = getSimcoins.get(agentId);
  if (!wallet || wallet.simcoins < totalCost) {
    return { error: 'Not enough SimCoins', required: totalCost, balance: wallet?.simcoins || 0 };
  }

  subtractSimcoins.run(totalCost, agentId);

  const existing = getInventoryItem.get(agentId, itemId);
  if (existing) {
    updateInventoryQty.run(quantity, agentId, itemId);
  } else {
    insertInventory.run(agentId, itemId, quantity);
  }

  return { success: true, item, quantity, cost: totalCost };
}

function sellItem(agentId, itemId, quantity = 1) {
  const item = getItem.get(itemId);
  if (!item) return { error: 'Item not found' };

  const existing = getInventoryItem.get(agentId, itemId);
  if (!existing || existing.quantity < quantity) {
    return { error: 'Not enough items to sell', have: existing?.quantity || 0, want: quantity };
  }

  // Sell at 50% of purchase price
  const sellPrice = Math.floor(item.price * 0.5 * quantity);
  addSimcoins.run(sellPrice, agentId);

  if (existing.quantity - quantity <= 0) {
    deleteInventoryItem.run(agentId, itemId);
  } else {
    updateInventoryQty.run(-quantity, agentId, itemId);
  }

  return { success: true, item, quantity, earned: sellPrice };
}

function buyProperty(agentId, plotX, plotY) {
  const existing = getProperty.get(agentId);
  if (existing) return { error: 'You already own a property' };

  const plotTaken = checkPlot.get(plotX, plotY);
  if (plotTaken) return { error: 'This plot is already taken' };

  const wallet = getSimcoins.get(agentId);
  if (!wallet || wallet.simcoins < PROPERTY_COSTS.PLOT) {
    return { error: 'Not enough SimCoins', required: PROPERTY_COSTS.PLOT, balance: wallet?.simcoins || 0 };
  }

  subtractSimcoins.run(PROPERTY_COSTS.PLOT, agentId);
  insertProperty.run(agentId, plotX, plotY);

  return { success: true, plot: { x: plotX, y: plotY }, cost: PROPERTY_COSTS.PLOT };
}

function upgradeProperty(agentId, newStyle) {
  const property = getProperty.get(agentId);
  if (!property) return { error: 'You do not own a property' };

  const cost = PROPERTY_COSTS.UPGRADE[newStyle];
  if (cost === undefined) return { error: 'Invalid house style' };

  const styleOrder = ['starter', 'modern', 'mansion', 'penthouse'];
  const currentIdx = styleOrder.indexOf(property.house_style);
  const newIdx = styleOrder.indexOf(newStyle);
  if (newIdx <= currentIdx) return { error: 'Can only upgrade to a higher tier' };

  const wallet = getSimcoins.get(agentId);
  if (!wallet || wallet.simcoins < cost) {
    return { error: 'Not enough SimCoins', required: cost, balance: wallet?.simcoins || 0 };
  }

  subtractSimcoins.run(cost, agentId);
  updatePropertyStyle.run(newStyle, newIdx + 1, agentId);

  return { success: true, style: newStyle, level: newIdx + 1, cost };
}

function placeItem(agentId, itemId, x, y, z) {
  const inv = getInventoryItem.get(agentId, itemId);
  if (!inv) return { error: 'You do not own this item' };

  const property = getProperty.get(agentId);
  if (!property) return { error: 'You do not own a property' };

  db.prepare(`
    UPDATE sims_inventory SET placed_in_property = 1, position_x = ?, position_y = ?, position_z = ?
    WHERE agent_id = ? AND item_id = ?
  `).run(x, y, z, agentId, itemId);

  return { success: true };
}

function getAgentInventory(agentId) {
  return getInventory.all(agentId);
}

function getAgentProperty(agentId) {
  return getProperty.get(agentId);
}

function getBalance(agentId) {
  const wallet = getSimcoins.get(agentId);
  return wallet ? wallet.simcoins : 0;
}

module.exports = {
  awardSimcoins, arenaPointsToSimcoins, bountyToSimcoins,
  buyItem, sellItem, buyProperty, upgradeProperty, placeItem,
  getAgentInventory, getAgentProperty, getBalance,
};
