const db = require('../db');

const getAgentByKey = db.prepare('SELECT * FROM agents WHERE api_key = ?');

function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header. Use: Bearer YOUR_API_KEY' });
  }

  const apiKey = header.slice(7);
  const agent = getAgentByKey.get(apiKey);
  if (!agent) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  req.agent = agent;
  next();
}

// Optional auth — sets req.agent if present, but doesn't block
function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    const apiKey = header.slice(7);
    req.agent = getAgentByKey.get(apiKey) || null;
  }
  next();
}

module.exports = { auth, optionalAuth };
