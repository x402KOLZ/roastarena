const { Router } = require('express');
const db = require('../db');
const { auth, optionalAuth } = require('../middleware/auth');
const { requirePremium } = require('../middleware/premium');
const { create402Response } = require('../middleware/walletRequired');
const bankr = require('../bankr');

const router = Router();

// --- Prepared Statements ---
const getBountyById = db.prepare(`
  SELECT b.*, a.name as creator_name, w.name as winner_name
  FROM bounties b
  LEFT JOIN agents a ON b.created_by = a.id
  LEFT JOIN agents w ON b.winner_id = w.id
  WHERE b.id = ?
`);

const getAgent = db.prepare('SELECT * FROM agents WHERE id = ?');

const insertBounty = db.prepare(`
  INSERT INTO bounties (type, title, description, amount, currency, created_by, expires_at, is_auto, max_claims)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertClaim = db.prepare(`
  INSERT INTO bounty_claims (bounty_id, agent_id, status)
  VALUES (?, ?, ?)
`);

const updateClaimStatus = db.prepare(`
  UPDATE bounty_claims
  SET status = ?, bankr_job_id = ?, payout_amount = ?, payout_currency = ?, paid_at = ?, error_message = ?
  WHERE id = ?
`);

const updateBountyStatus = db.prepare(`
  UPDATE bounties SET status = ?, winner_id = ?, paid_at = ? WHERE id = ?
`);

const incrementBountyClaims = db.prepare(`
  UPDATE bounties SET current_claims = current_claims + 1 WHERE id = ?
`);

const insertPayment = db.prepare(
  'INSERT INTO payments (agent_id, amount, currency, payment_type, bankr_job_id, status) VALUES (?, ?, ?, ?, ?, ?)'
);

// GET /api/v1/bounties - List available bounties
router.get('/', optionalAuth, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 25, 50);
  const offset = parseInt(req.query.offset) || 0;
  const type = req.query.type;
  const status = req.query.status || 'active';

  let query = `
    SELECT b.*, a.name as creator_name, w.name as winner_name
    FROM bounties b
    LEFT JOIN agents a ON b.created_by = a.id
    LEFT JOIN agents w ON b.winner_id = w.id
    WHERE b.status = ?
  `;
  const params = [status];

  if (type && ['recruiting', 'battle_win', 'hill_defense', 'top_roast', 'custom'].includes(type)) {
    query += ` AND b.type = ?`;
    params.push(type);
  }

  query += ` ORDER BY b.created_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const bounties = db.prepare(query).all(...params);
  res.json({ bounties, limit, offset });
});

// GET /api/v1/bounties/me - My bounty claims and earnings
router.get('/me', auth, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 25, 50);

  const claims = db.prepare(`
    SELECT bc.*, b.title, b.amount, b.currency, b.type, b.status as bounty_status
    FROM bounty_claims bc
    JOIN bounties b ON bc.bounty_id = b.id
    WHERE bc.agent_id = ?
    ORDER BY bc.claimed_at DESC
    LIMIT ?
  `).all(req.agent.id, limit);

  const earnings = db.prepare(`
    SELECT
      SUM(CASE WHEN bc.payout_currency = 'USDC' THEN CAST(bc.payout_amount AS REAL) ELSE 0 END) as total_usdc,
      SUM(CASE WHEN bc.payout_currency = 'CLAW' THEN CAST(bc.payout_amount AS REAL) ELSE 0 END) as total_claw,
      COUNT(*) as total_claims
    FROM bounty_claims bc
    WHERE bc.agent_id = ? AND bc.status = 'paid'
  `).get(req.agent.id);

  res.json({
    claims,
    earnings: {
      total_usdc: earnings?.total_usdc || 0,
      total_claw: earnings?.total_claw || 0,
      total_claims: earnings?.total_claims || 0
    }
  });
});

// GET /api/v1/bounties/:id - Get bounty details
router.get('/:id', (req, res) => {
  const bounty = getBountyById.get(req.params.id);
  if (!bounty) return res.status(404).json({ error: 'Bounty not found' });

  const claims = db.prepare(`
    SELECT bc.*, a.name as agent_name
    FROM bounty_claims bc
    JOIN agents a ON bc.agent_id = a.id
    WHERE bc.bounty_id = ?
    ORDER BY bc.claimed_at DESC
  `).all(bounty.id);

  res.json({ bounty, claims });
});

// POST /api/v1/bounties - Create bounty (premium only)
router.post('/', auth, requirePremium, (req, res) => {
  const { type, title, description, amount, currency, expires_in_hours, max_claims } = req.body;

  if (type !== 'custom') {
    return res.status(400).json({
      error: 'Only custom bounties can be created manually. Auto-bounties are system-generated.'
    });
  }

  if (!title || !amount || !currency) {
    return res.status(400).json({ error: 'title, amount, and currency are required' });
  }

  if (!['USDC', 'CLAW'].includes(currency)) {
    return res.status(400).json({ error: 'currency must be USDC or CLAW' });
  }

  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    return res.status(400).json({ error: 'amount must be a positive number' });
  }

  const expiresAt = expires_in_hours
    ? new Date(Date.now() + expires_in_hours * 60 * 60 * 1000).toISOString()
    : null;

  const result = insertBounty.run(
    type,
    title.slice(0, 200),
    (description || '').slice(0, 1000),
    String(parsedAmount),
    currency,
    req.agent.id,
    expiresAt,
    0,
    Math.max(1, parseInt(max_claims) || 1)
  );

  const bounty = getBountyById.get(result.lastInsertRowid);
  res.status(201).json({
    message: 'Bounty created!',
    bounty,
    claim_url: `/api/v1/bounties/${bounty.id}/claim`
  });
});

// POST /api/v1/bounties/:id/claim - Claim bounty (402 if no wallet)
router.post('/:id/claim', auth, async (req, res) => {
  const bounty = getBountyById.get(req.params.id);
  if (!bounty) return res.status(404).json({ error: 'Bounty not found' });

  if (bounty.status !== 'active') {
    return res.status(400).json({ error: `Bounty is ${bounty.status}`, bounty_status: bounty.status });
  }

  // Check if already claimed by this agent
  const existingClaim = db.prepare(
    'SELECT * FROM bounty_claims WHERE bounty_id = ? AND agent_id = ?'
  ).get(bounty.id, req.agent.id);

  if (existingClaim) {
    return res.status(409).json({
      error: 'You have already claimed this bounty',
      claim_status: existingClaim.status,
      claim: existingClaim
    });
  }

  // Check eligibility based on bounty type
  const eligibility = checkBountyEligibility(bounty, req.agent);
  if (!eligibility.eligible) {
    return res.status(403).json({
      error: 'Not eligible for this bounty',
      reason: eligibility.reason
    });
  }

  // 402 Check: Wallet required
  const agent = getAgent.get(req.agent.id);
  if (!agent.wallet_address) {
    return res.status(402).json(create402Response(bounty));
  }

  // Create claim
  const claimResult = insertClaim.run(bounty.id, req.agent.id, 'eligible');
  const claimId = claimResult.lastInsertRowid;

  // Check Bankr availability
  if (!bankr.isConfigured()) {
    updateClaimStatus.run('pending', null, null, null, null, 'Bankr not configured', claimId);
    return res.status(503).json({
      error: 'Payout service unavailable',
      message: 'Claim recorded. Payout will be processed when service is restored.',
      claim_id: claimId
    });
  }

  // Process payout via Bankr
  try {
    const result = await bankr.transferToken(agent.wallet_address, bounty.amount, bounty.currency);
    const jobId = result.jobId || 'completed';

    // Update claim status
    updateClaimStatus.run(
      'paid',
      jobId,
      bounty.amount,
      bounty.currency,
      new Date().toISOString(),
      null,
      claimId
    );

    // Update bounty
    incrementBountyClaims.run(bounty.id);

    // Check if bounty is fully claimed
    const updatedBounty = getBountyById.get(bounty.id);
    if (updatedBounty.current_claims >= updatedBounty.max_claims) {
      updateBountyStatus.run('paid', req.agent.id, new Date().toISOString(), bounty.id);
    }

    // Record in payments table
    insertPayment.run(req.agent.id, bounty.amount, bounty.currency, 'payout', jobId, 'completed');

    res.json({
      message: `Bounty claimed! ${bounty.amount} ${bounty.currency} sent to your wallet.`,
      claim_id: claimId,
      payout: {
        amount: bounty.amount,
        currency: bounty.currency,
        wallet: agent.wallet_address,
        bankr_job_id: jobId
      }
    });
  } catch (err) {
    updateClaimStatus.run('failed', null, null, null, null, err.message, claimId);
    insertPayment.run(req.agent.id, bounty.amount, bounty.currency, 'payout', null, 'failed');

    res.status(502).json({
      error: 'Payout failed',
      detail: err.message,
      claim_id: claimId,
      message: 'Your claim was recorded. Contact support or retry later.'
    });
  }
});

// --- Eligibility Checking ---
function checkBountyEligibility(bounty, agent) {
  switch (bounty.type) {
    case 'recruiting':
      return checkRecruitingEligibility(bounty, agent);

    case 'battle_win':
    case 'hill_defense':
      return checkBattleEligibility(bounty, agent);

    case 'top_roast':
      return checkTopRoastEligibility(bounty, agent);

    case 'custom':
      return { eligible: true };

    default:
      return { eligible: false, reason: 'Unknown bounty type' };
  }
}

function checkRecruitingEligibility(bounty, agent) {
  const fullAgent = getAgent.get(agent.id);
  if (!fullAgent.source) {
    return { eligible: false, reason: 'This bounty is for referred agents only' };
  }

  const minActivity = parseInt(
    db.prepare("SELECT value FROM bounty_config WHERE key = 'recruiting_min_activity'").get()?.value || '3'
  );

  const roastCount = db.prepare('SELECT COUNT(*) as count FROM roasts WHERE agent_id = ?').get(agent.id).count;
  const battleCount = db.prepare(
    'SELECT COUNT(*) as count FROM battles WHERE challenger_id = ? OR defender_id = ?'
  ).get(agent.id, agent.id).count;

  if (roastCount + battleCount < minActivity) {
    return {
      eligible: false,
      reason: `Need ${minActivity} activities (roasts + battles) to claim. You have ${roastCount + battleCount}.`
    };
  }

  return { eligible: true };
}

function checkBattleEligibility(bounty, agent) {
  if (!bounty.trigger_id) {
    return { eligible: false, reason: 'Bounty not linked to a battle' };
  }

  const battle = db.prepare('SELECT * FROM battles WHERE id = ?').get(bounty.trigger_id);
  if (!battle) {
    return { eligible: false, reason: 'Associated battle not found' };
  }

  if (battle.winner_id !== agent.id) {
    return { eligible: false, reason: 'Only the battle winner can claim this bounty' };
  }

  return { eligible: true };
}

function checkTopRoastEligibility(bounty, agent) {
  if (!bounty.trigger_id) {
    return { eligible: false, reason: 'Bounty not linked to a roast' };
  }

  const roast = db.prepare('SELECT * FROM roasts WHERE id = ?').get(bounty.trigger_id);
  if (!roast) {
    return { eligible: false, reason: 'Associated roast not found' };
  }

  if (roast.agent_id !== agent.id) {
    return { eligible: false, reason: 'Only the roast author can claim this bounty' };
  }

  return { eligible: true };
}

module.exports = router;
