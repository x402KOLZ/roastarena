// X API v2 Client — uses official Bearer Token auth

const BEARER_TOKEN = process.env.X_API_BEARER_TOKEN;
const BASE_URL = 'https://api.x.com/2';

let requestCount = 0;
let windowStart = Date.now();
const RATE_LIMIT = 300; // 300 requests per 15 min window
const WINDOW_MS = 15 * 60 * 1000;

function isConfigured() {
  return !!BEARER_TOKEN;
}

async function checkRateLimit() {
  const now = Date.now();
  if (now - windowStart > WINDOW_MS) {
    requestCount = 0;
    windowStart = now;
  }
  if (requestCount >= RATE_LIMIT) {
    const waitMs = WINDOW_MS - (now - windowStart);
    throw new Error(`X API rate limit hit. Retry in ${Math.ceil(waitMs / 1000)}s`);
  }
  requestCount++;
}

async function xFetch(endpoint, params = {}) {
  if (!BEARER_TOKEN) {
    throw new Error('X_API_BEARER_TOKEN not configured');
  }

  await checkRateLimit();

  const url = new URL(`${BASE_URL}${endpoint}`);
  for (const [key, val] of Object.entries(params)) {
    if (val !== undefined) url.searchParams.set(key, val);
  }

  const response = await fetch(url.toString(), {
    headers: {
      'Authorization': `Bearer ${BEARER_TOKEN}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(15000),
  });

  if (response.status === 429) {
    const retryAfter = response.headers.get('retry-after');
    throw new Error(`X API rate limited. Retry after ${retryAfter || '?'}s`);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`X API error ${response.status}: ${body}`);
  }

  return response.json();
}

// Fetch user profile by username
async function getUserByUsername(username) {
  const data = await xFetch(`/users/by/username/${username}`, {
    'user.fields': 'description,profile_image_url,public_metrics,created_at,location,url,pinned_tweet_id',
  });
  return data.data;
}

// Fetch user's recent tweets
async function getUserTweets(userId, maxResults = 50) {
  const data = await xFetch(`/users/${userId}/tweets`, {
    max_results: Math.min(maxResults, 100),
    'tweet.fields': 'created_at,public_metrics,text',
    exclude: 'retweets,replies',
  });
  return data.data || [];
}

// Fetch user by ID
async function getUserById(userId) {
  const data = await xFetch(`/users/${userId}`, {
    'user.fields': 'description,profile_image_url,public_metrics,created_at,location',
  });
  return data.data;
}

module.exports = { isConfigured, getUserByUsername, getUserTweets, getUserById };
