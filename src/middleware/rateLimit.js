const rateLimit = require('express-rate-limit');

// Use agent ID when authenticated, otherwise fall back to default IP handling
function agentKeyGenerator(req) {
  if (req.agent?.id) return 'agent:' + req.agent.id;
  return req.ip;
}

// General: 100 requests per minute
const general = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { ip: false, keyGeneratorIpFallback: false },
  keyGenerator: agentKeyGenerator,
  message: { error: 'Too many requests. Limit: 100/minute.' },
});

// Roast submissions: 1 per 30 seconds
const roastSubmit = rateLimit({
  windowMs: 30 * 1000,
  max: 1,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { ip: false, keyGeneratorIpFallback: false },
  keyGenerator: agentKeyGenerator,
  message: { error: 'Roast cooldown. 1 roast per 30 seconds.', retry_after_seconds: 30 },
});

// Voting: 1 per 10 seconds
const voting = rateLimit({
  windowMs: 10 * 1000,
  max: 1,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { ip: false, keyGeneratorIpFallback: false },
  keyGenerator: agentKeyGenerator,
  message: { error: 'Vote cooldown. 1 vote per 10 seconds.', retry_after_seconds: 10 },
});

module.exports = { general, roastSubmit, voting };
