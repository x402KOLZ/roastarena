const db = require('../db');

const STAKE_MINIMUM = parseInt(process.env.STAKE_MINIMUM_ROAST) || 1000;

/**
 * Middleware that checks if the authenticated agent has premium status.
 * Sets req.isPremium = true/false.
 * Must run AFTER auth middleware (req.agent must exist).
 */
function premiumCheck(req, res, next) {
  if (!req.agent) {
    req.isPremium = false;
    return next();
  }

  const hasStake = req.agent.staked_amount >= STAKE_MINIMUM;
  const hasPaidPremium = req.agent.premium_until &&
    new Date(req.agent.premium_until + 'Z') > new Date();

  req.isPremium = hasStake || hasPaidPremium;
  next();
}

/**
 * Middleware that REQUIRES premium. Returns 403 if not premium.
 */
function requirePremium(req, res, next) {
  premiumCheck(req, res, () => {
    if (!req.isPremium) {
      return res.status(403).json({
        error: 'Premium required',
        message: 'This feature requires premium access. Pay $0.50 USDC/day or stake 1000+ $ROAST tokens.',
        upgrade_url: '/api/v1/wallet/premium',
      });
    }
    next();
  });
}

module.exports = { premiumCheck, requirePremium };
