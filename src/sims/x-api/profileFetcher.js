const db = require('../../db');
const { isConfigured, getUserByUsername, getUserTweets } = require('./client');
const { analyzeTweets } = require('./personalityAnalyzer');
const { mapTraitsToSims } = require('./traitMapper');

const updateProfile = db.prepare(`
  UPDATE sims_profiles
  SET x_handle = ?, x_avatar_url = ?, x_bio = ?, x_scraped_at = datetime('now'),
      trait_openness = ?, trait_conscientiousness = ?, trait_extraversion = ?,
      trait_agreeableness = ?, trait_neuroticism = ?,
      character_color = ?, character_accessory = ?
  WHERE agent_id = ?
`);

const insertTweet = db.prepare(`
  INSERT OR IGNORE INTO sims_x_tweets (agent_id, tweet_text, tweet_date, likes, retweets)
  VALUES (?, ?, ?, ?, ?)
`);

const clearTweets = db.prepare('DELETE FROM sims_x_tweets WHERE agent_id = ?');

async function fetchAndAnalyzeProfile(agentId, xHandle) {
  if (!isConfigured()) {
    return { error: 'X API not configured', agent_id: agentId };
  }

  // 1. Fetch user profile
  const user = await getUserByUsername(xHandle);
  if (!user) {
    return { error: `User @${xHandle} not found`, agent_id: agentId };
  }

  // 2. Fetch recent tweets
  const tweets = await getUserTweets(user.id, 50);
  const tweetTexts = tweets.map(t => t.text);

  // 3. Analyze personality from tweets
  const traits = analyzeTweets(tweetTexts);

  // 4. Map traits to Sims attributes
  const simsAttrs = mapTraitsToSims(traits, user);

  // 5. Store tweets in cache
  clearTweets.run(agentId);
  for (const tweet of tweets) {
    insertTweet.run(
      agentId,
      tweet.text,
      tweet.created_at || null,
      tweet.public_metrics?.like_count || 0,
      tweet.public_metrics?.retweet_count || 0
    );
  }

  // 6. Update sims profile
  updateProfile.run(
    xHandle,
    user.profile_image_url?.replace('_normal', '_400x400') || null,
    user.description || null,
    traits.openness,
    traits.conscientiousness,
    traits.extraversion,
    traits.agreeableness,
    traits.neuroticism,
    simsAttrs.character_color,
    simsAttrs.character_accessory,
    agentId
  );

  return {
    agent_id: agentId,
    x_handle: xHandle,
    x_user: {
      id: user.id,
      name: user.name,
      bio: user.description,
      avatar: user.profile_image_url,
      followers: user.public_metrics?.followers_count || 0,
      following: user.public_metrics?.following_count || 0,
      tweets_count: user.public_metrics?.tweet_count || 0,
    },
    personality_traits: traits,
    sims_attributes: simsAttrs,
    tweets_analyzed: tweetTexts.length,
  };
}

// Preview persona for recruitment (no agent_id required)
async function previewPersona(xHandle) {
  if (!isConfigured()) {
    return { error: 'X API not configured' };
  }

  const user = await getUserByUsername(xHandle);
  if (!user) {
    return { error: `User @${xHandle} not found` };
  }

  const tweets = await getUserTweets(user.id, 50);
  const tweetTexts = tweets.map(t => t.text);
  const traits = analyzeTweets(tweetTexts);
  const simsAttrs = mapTraitsToSims(traits, user);

  return {
    x_handle: xHandle,
    x_user: {
      name: user.name,
      bio: user.description,
      avatar: user.profile_image_url?.replace('_normal', '_400x400'),
      followers: user.public_metrics?.followers_count || 0,
    },
    personality: traits,
    predicted_character: simsAttrs,
    predicted_skills: {
      roasting: traits.extraversion > 0.6 ? 'High' : 'Medium',
      coding: traits.conscientiousness > 0.6 ? 'High' : 'Medium',
      trolling: traits.neuroticism > 0.5 && traits.openness > 0.5 ? 'High' : 'Low',
      diplomacy: traits.agreeableness > 0.6 ? 'High' : 'Medium',
      trading: traits.conscientiousness > 0.5 && traits.openness > 0.5 ? 'High' : 'Medium',
    },
    tweets_sampled: tweetTexts.length,
  };
}

module.exports = { fetchAndAnalyzeProfile, previewPersona };
