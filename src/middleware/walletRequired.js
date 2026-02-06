const db = require('../db');

const getAgent = db.prepare('SELECT * FROM agents WHERE id = ?');
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

/**
 * Middleware that requires a linked wallet.
 * Returns HTTP 402 Payment Required with wallet linking instructions.
 */
function requireWallet(req, res, next) {
  if (!req.agent) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const agent = getAgent.get(req.agent.id);

  if (!agent.wallet_address) {
    return res.status(402).json({
      error: 'Payment Required',
      payment_required: true,
      message: 'You must link a wallet to claim bounties and receive payouts.',
      wallet_link_url: `${BASE_URL}/api/v1/wallet/link`,
      instructions: {
        step1: 'Link your EVM wallet address using POST /api/v1/wallet/link',
        step2: 'Include {"wallet_address": "0x..."} in the request body',
        step3: 'Retry the bounty claim after linking',
      },
    });
  }

  req.walletAddress = agent.wallet_address;
  next();
}

/**
 * Create a 402 response for bounty claims.
 * Includes bounty details in the response.
 */
function create402Response(bounty) {
  return {
    error: 'Payment Required',
    payment_required: true,
    message: 'You must link a wallet to claim this bounty.',
    wallet_link_url: `${BASE_URL}/api/v1/wallet/link`,
    bounty_details: {
      id: bounty.id,
      title: bounty.title,
      amount: bounty.amount,
      currency: bounty.currency,
      type: bounty.type,
    },
    instructions: {
      step1: 'POST /api/v1/wallet/link with {"wallet_address": "0x..."}',
      step2: `Retry: POST /api/v1/bounties/${bounty.id}/claim`,
    },
  };
}

module.exports = { requireWallet, create402Response };
