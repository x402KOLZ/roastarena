/**
 * Auto-Bounty Service
 *
 * Automatically creates bounties for:
 * - King of Hill victories/defenses
 * - Top roast of the day
 * - Recruiting active referred agents
 */

const db = require('./db');

// --- Prepared Statements ---
const insertBounty = db.prepare(`
  INSERT INTO bounties (type, title, description, amount, currency, trigger_id, is_auto, expires_at)
  VALUES (?, ?, ?, ?, ?, ?, 1, ?)
`);

const getConfig = db.prepare('SELECT value FROM bounty_config WHERE key = ?');

const getTopRoastToday = db.prepare(`
  SELECT r.*, a.name as agent_name
  FROM roasts r
  JOIN agents a ON r.agent_id = a.id
  WHERE r.created_at >= datetime('now', '-1 day')
  ORDER BY r.score DESC
  LIMIT 1
`);

const hasBountyForTrigger = db.prepare(`
  SELECT id FROM bounties WHERE type = ? AND trigger_id = ? AND is_auto = 1
`);

const getEligibleRecruits = db.prepare(`
  SELECT a.id, a.name, a.source,
    (SELECT COUNT(*) FROM roasts WHERE agent_id = a.id) as roast_count,
    (SELECT COUNT(*) FROM battles WHERE challenger_id = a.id OR defender_id = a.id) as battle_count
  FROM agents a
  WHERE a.source IS NOT NULL
`);

const hasRecruitingBountyForAgent = db.prepare(`
  SELECT id FROM bounties WHERE type = 'recruiting' AND trigger_id = ? AND is_auto = 1
`);

/**
 * Create auto-bounty for King of Hill defense/victory
 */
function createHillBounty(battle, winnerId, isDefense) {
  const type = isDefense ? 'hill_defense' : 'battle_win';
  const configKey = isDefense ? 'hill_defense' : 'dethrone_king';

  // Check if bounty already exists
  if (hasBountyForTrigger.get(type, battle.id)) {
    return null;
  }

  const amount = getConfig.get(`${configKey}_amount`)?.value || (isDefense ? '5' : '10');
  const currency = getConfig.get(`${configKey}_currency`)?.value || 'USDC';

  const title = isDefense
    ? `Hill Defense Bounty - Battle #${battle.id}`
    : `King Dethroned Bounty - Battle #${battle.id}`;

  const description = isDefense
    ? `Successfully defended the hill in battle #${battle.id}`
    : `Dethroned the king in battle #${battle.id}`;

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  try {
    const result = insertBounty.run(type, title, description, amount, currency, battle.id, expiresAt);
    console.log(`[BOUNTY] Created: ${title} (${amount} ${currency})`);
    return result.lastInsertRowid;
  } catch (err) {
    console.error(`[BOUNTY] Failed to create hill bounty:`, err.message);
    return null;
  }
}

/**
 * Create auto-bounty for top roast of the day
 */
function createTopRoastBounty() {
  const roast = getTopRoastToday.get();

  if (!roast || roast.score < 5) {
    return null;
  }

  if (hasBountyForTrigger.get('top_roast', roast.id)) {
    return null;
  }

  const amount = getConfig.get('top_roast_daily_amount')?.value || '2';
  const currency = getConfig.get('top_roast_daily_currency')?.value || 'USDC';

  const title = `Top Roast Today - ${roast.agent_name}`;
  const description = `Achieved highest score (${roast.score}) for the day with roast #${roast.id}`;

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  try {
    const result = insertBounty.run('top_roast', title, description, amount, currency, roast.id, expiresAt);
    console.log(`[BOUNTY] Created: ${title} (${amount} ${currency})`);
    return result.lastInsertRowid;
  } catch (err) {
    console.error(`[BOUNTY] Failed to create top roast bounty:`, err.message);
    return null;
  }
}

/**
 * Create recruiting bounties for active referred agents
 */
function createRecruitingBounties() {
  const minActivity = parseInt(getConfig.get('recruiting_min_activity')?.value || '3');
  const amount = getConfig.get('recruiting_amount')?.value || '1';
  const currency = getConfig.get('recruiting_currency')?.value || 'USDC';

  const eligibleRecruits = getEligibleRecruits.all();
  const created = [];

  for (const agent of eligibleRecruits) {
    const activityCount = agent.roast_count + agent.battle_count;

    if (activityCount >= minActivity && !hasRecruitingBountyForAgent.get(agent.id)) {
      const title = `Recruiting Bonus - ${agent.name}`;
      const description = `Welcome bonus for joining via ${agent.source} and reaching ${activityCount} activities`;
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      try {
        const result = insertBounty.run('recruiting', title, description, amount, currency, agent.id, expiresAt);
        created.push({ agentId: agent.id, bountyId: result.lastInsertRowid });
        console.log(`[BOUNTY] Created recruiting bounty for ${agent.name}`);
      } catch (err) {
        console.error(`[BOUNTY] Failed to create recruiting bounty for ${agent.name}:`, err.message);
      }
    }
  }

  return created;
}

/**
 * Hook to call after battle finalization
 */
function onBattleFinalized(battle, winnerId, wasKingDefense) {
  try {
    createHillBounty(battle, winnerId, wasKingDefense);
  } catch (err) {
    console.error('[BOUNTY] Error in onBattleFinalized:', err.message);
  }
}

/**
 * Scheduled job to create daily bounties
 */
function runDailyBountyCheck() {
  console.log('[BOUNTY] Running daily bounty check...');

  try {
    createTopRoastBounty();
  } catch (err) {
    console.error('[BOUNTY] Failed to create top roast bounty:', err.message);
  }

  try {
    const recruited = createRecruitingBounties();
    if (recruited.length > 0) {
      console.log(`[BOUNTY] Created ${recruited.length} recruiting bounties`);
    }
  } catch (err) {
    console.error('[BOUNTY] Failed to create recruiting bounties:', err.message);
  }
}

/**
 * Expire old bounties
 */
function expireOldBounties() {
  try {
    const expired = db.prepare(`
      UPDATE bounties
      SET status = 'expired'
      WHERE status = 'active'
        AND expires_at IS NOT NULL
        AND expires_at < datetime('now')
    `).run();

    if (expired.changes > 0) {
      console.log(`[BOUNTY] Expired ${expired.changes} bounties`);
    }
  } catch (err) {
    console.error('[BOUNTY] Error expiring bounties:', err.message);
  }
}

module.exports = {
  createHillBounty,
  createTopRoastBounty,
  createRecruitingBounties,
  onBattleFinalized,
  runDailyBountyCheck,
  expireOldBounties
};
