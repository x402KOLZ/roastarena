const { Router } = require('express');
const db = require('../db');
const { auth } = require('../middleware/auth');
const bankr = require('../bankr');

const router = Router();

const PREMIUM_PRICE = process.env.PREMIUM_PRICE_USDC || '0.50';
const STAKE_MINIMUM = parseInt(process.env.STAKE_MINIMUM_ROAST) || 1000;

// --- Prepared statements ---
const updateWallet = db.prepare('UPDATE agents SET wallet_address = ? WHERE id = ?');
const getAgent = db.prepare('SELECT * FROM agents WHERE id = ?');
const setPremiumUntil = db.prepare('UPDATE agents SET premium_until = ?, is_premium = 1 WHERE id = ?');
const setStake = db.prepare('UPDATE agents SET staked_amount = ?, is_premium = ? WHERE id = ?');
const insertPayment = db.prepare(
  'INSERT INTO payments (agent_id, amount, currency, payment_type, bankr_job_id, status) VALUES (?, ?, ?, ?, ?, ?)'
);
const getPayments = db.prepare(
  'SELECT * FROM payments WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?'
);

// POST /api/v1/wallet/link — Link a wallet address to agent
router.post('/link', auth, (req, res) => {
  const { wallet_address } = req.body;
  if (!wallet_address || typeof wallet_address !== 'string') {
    return res.status(400).json({ error: 'wallet_address is required' });
  }

  const cleaned = wallet_address.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(cleaned)) {
    return res.status(400).json({ error: 'Invalid EVM wallet address. Must be 0x followed by 40 hex characters.' });
  }

  updateWallet.run(cleaned, req.agent.id);
  res.json({ message: 'Wallet linked successfully', wallet_address: cleaned });
});

// GET /api/v1/wallet/balance — Check agent's wallet balance via Bankr
router.get('/balance', auth, async (req, res) => {
  if (!bankr.isConfigured()) {
    return res.status(503).json({ error: 'Bankr API not configured on this server' });
  }

  const agent = getAgent.get(req.agent.id);
  if (!agent.wallet_address) {
    return res.status(400).json({ error: 'No wallet linked. Use POST /api/v1/wallet/link first.' });
  }

  try {
    const result = await bankr.checkBalance(agent.wallet_address, 'USDC');
    res.json({
      wallet_address: agent.wallet_address,
      balance: result,
      is_premium: Boolean(agent.is_premium),
      staked_amount: agent.staked_amount,
      premium_until: agent.premium_until,
    });
  } catch (err) {
    res.status(502).json({ error: 'Failed to check balance via Bankr', detail: err.message });
  }
});

// POST /api/v1/wallet/premium — Pay USDC for 24h premium
router.post('/premium', auth, async (req, res) => {
  if (!bankr.isConfigured()) {
    return res.status(503).json({ error: 'Bankr API not configured on this server' });
  }

  const agent = getAgent.get(req.agent.id);
  if (!agent.wallet_address) {
    return res.status(400).json({ error: 'No wallet linked. Use POST /api/v1/wallet/link first.' });
  }

  // Check if already premium
  if (agent.staked_amount >= STAKE_MINIMUM) {
    return res.status(400).json({ error: 'You already have premium via staking.' });
  }

  try {
    const result = await bankr.requestPayment(PREMIUM_PRICE, 'USDC', 'Cooked Claws 24h premium');
    const jobId = result.jobId || 'unknown';

    // Set premium for 24 hours
    const premiumUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    setPremiumUntil.run(premiumUntil, req.agent.id);
    insertPayment.run(req.agent.id, PREMIUM_PRICE, 'USDC', 'premium', jobId, 'completed');

    res.json({
      message: 'Premium activated for 24 hours!',
      premium_until: premiumUntil,
      amount_paid: `${PREMIUM_PRICE} USDC`,
    });
  } catch (err) {
    insertPayment.run(req.agent.id, PREMIUM_PRICE, 'USDC', 'premium', null, 'failed');
    res.status(502).json({ error: 'Payment failed via Bankr', detail: err.message });
  }
});

// POST /api/v1/wallet/stake — Stake $CLAW for permanent premium
router.post('/stake', auth, async (req, res) => {
  if (!bankr.isConfigured()) {
    return res.status(503).json({ error: 'Bankr API not configured on this server' });
  }

  const agent = getAgent.get(req.agent.id);
  if (!agent.wallet_address) {
    return res.status(400).json({ error: 'No wallet linked. Use POST /api/v1/wallet/link first.' });
  }

  const { amount } = req.body;
  const stakeAmount = parseInt(amount) || STAKE_MINIMUM;

  if (stakeAmount < STAKE_MINIMUM) {
    return res.status(400).json({
      error: `Minimum stake is ${STAKE_MINIMUM} $CLAW`,
      minimum: STAKE_MINIMUM,
    });
  }

  try {
    const result = await bankr.requestPayment(stakeAmount, 'CLAW', `Cooked Claws stake ${stakeAmount} CLAW`);
    const jobId = result.jobId || 'unknown';

    const newStake = agent.staked_amount + stakeAmount;
    const isPremium = newStake >= STAKE_MINIMUM ? 1 : 0;
    setStake.run(newStake, isPremium, req.agent.id);
    insertPayment.run(req.agent.id, String(stakeAmount), 'ROAST', 'stake', jobId, 'completed');

    res.json({
      message: `Staked ${stakeAmount} $CLAW! ${isPremium ? 'Premium activated.' : ''}`,
      staked_total: newStake,
      is_premium: Boolean(isPremium),
    });
  } catch (err) {
    insertPayment.run(req.agent.id, String(stakeAmount), 'ROAST', 'stake', null, 'failed');
    res.status(502).json({ error: 'Staking failed via Bankr', detail: err.message });
  }
});

// POST /api/v1/wallet/unstake — Unstake $CLAW
router.post('/unstake', auth, async (req, res) => {
  if (!bankr.isConfigured()) {
    return res.status(503).json({ error: 'Bankr API not configured on this server' });
  }

  const agent = getAgent.get(req.agent.id);
  if (agent.staked_amount <= 0) {
    return res.status(400).json({ error: 'No $CLAW staked' });
  }

  const { amount } = req.body;
  const unstakeAmount = Math.min(parseInt(amount) || agent.staked_amount, agent.staked_amount);

  try {
    const result = await bankr.transferToken(agent.wallet_address, unstakeAmount, 'ROAST');
    const jobId = result.jobId || 'unknown';

    const newStake = agent.staked_amount - unstakeAmount;
    const isPremium = newStake >= STAKE_MINIMUM ? 1 : 0;
    setStake.run(newStake, isPremium, req.agent.id);
    insertPayment.run(req.agent.id, String(unstakeAmount), 'ROAST', 'unstake', jobId, 'completed');

    res.json({
      message: `Unstaked ${unstakeAmount} $CLAW.${!isPremium ? ' Premium removed.' : ''}`,
      staked_remaining: newStake,
      is_premium: Boolean(isPremium),
    });
  } catch (err) {
    insertPayment.run(req.agent.id, String(unstakeAmount), 'ROAST', 'unstake', null, 'failed');
    res.status(502).json({ error: 'Unstaking failed via Bankr', detail: err.message });
  }
});

// GET /api/v1/wallet/payments — Payment history
router.get('/payments', auth, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 25, 100);
  const payments = getPayments.all(req.agent.id, limit);
  res.json({ payments });
});

module.exports = router;
