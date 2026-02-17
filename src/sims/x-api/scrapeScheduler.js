const db = require('../../db');
const { isConfigured } = require('./client');
const { fetchAndAnalyzeProfile } = require('./profileFetcher');

const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const STALE_THRESHOLD_HOURS = 24;

let schedulerInterval = null;

const getStaleProfiles = db.prepare(`
  SELECT agent_id, x_handle FROM sims_profiles
  WHERE x_handle IS NOT NULL
    AND (x_scraped_at IS NULL OR x_scraped_at < datetime('now', '-${STALE_THRESHOLD_HOURS} hours'))
  LIMIT 10
`);

const getUnscrapedProfiles = db.prepare(`
  SELECT agent_id, x_handle FROM sims_profiles
  WHERE x_handle IS NOT NULL AND x_scraped_at IS NULL
  LIMIT 5
`);

async function refreshStaleProfiles() {
  if (!isConfigured()) return;

  // Priority: unscraped profiles first
  let profiles = getUnscrapedProfiles.all();
  if (profiles.length === 0) {
    profiles = getStaleProfiles.all();
  }

  if (profiles.length === 0) return;

  console.log(`X API scraper: refreshing ${profiles.length} profile(s)`);

  for (const profile of profiles) {
    try {
      const result = await fetchAndAnalyzeProfile(profile.agent_id, profile.x_handle);
      if (result.error) {
        console.log(`X API scraper: failed for @${profile.x_handle}: ${result.error}`);
      } else {
        console.log(`X API scraper: updated @${profile.x_handle} (${result.tweets_analyzed} tweets)`);
      }

      // Delay between requests to respect rate limits
      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      console.error(`X API scraper error for @${profile.x_handle}:`, err.message);
      if (err.message.includes('rate limit')) break; // Stop if rate limited
    }
  }
}

function start() {
  if (!isConfigured()) {
    console.log('X API scrape scheduler: skipped (no X_API_BEARER_TOKEN)');
    return;
  }

  console.log(`X API scrape scheduler started (every ${REFRESH_INTERVAL_MS / 3600000}h)`);

  // Run once after a short delay (let server fully start)
  setTimeout(refreshStaleProfiles, 10000);

  schedulerInterval = setInterval(refreshStaleProfiles, REFRESH_INTERVAL_MS);
  return schedulerInterval;
}

function stop() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}

module.exports = { start, stop, refreshStaleProfiles };
