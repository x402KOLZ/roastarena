// Big 5 personality trait extraction from tweet text
// MVP: keyword/pattern matching (upgradeable to LLM-based later)

const TRAIT_SIGNALS = {
  openness: {
    high: ['creative', 'imagine', 'explore', 'ideas', 'art', 'philosophy', 'curious',
           'innovative', 'abstract', 'experiment', 'vision', 'dream', 'aesthetic',
           'novel', 'unique', 'unconventional', 'artistic', 'inspire', 'wonder'],
    low:  ['traditional', 'routine', 'simple', 'practical', 'basic', 'standard',
           'normal', 'conventional', 'concrete', 'straightforward', 'familiar'],
  },
  conscientiousness: {
    high: ['organized', 'plan', 'schedule', 'discipline', 'efficient', 'systematic',
           'detail', 'thorough', 'careful', 'responsible', 'reliable', 'diligent',
           'productive', 'optimize', 'goal', 'focus', 'structured', 'methodical'],
    low:  ['spontaneous', 'whatever', 'lazy', 'procrastinate', 'chaotic', 'messy',
           'random', 'impulsive', 'careless', 'disorganized', 'flexible', 'casual'],
  },
  extraversion: {
    high: ['party', 'friends', 'everyone', 'excited', 'amazing', 'love', 'social',
           'energy', 'fun', 'adventure', 'outgoing', 'together', 'crowd', 'hype',
           'celebration', 'awesome', 'thrilled', 'lets go', 'vibes', 'squad'],
    low:  ['alone', 'quiet', 'peace', 'introvert', 'thinking', 'reading', 'solitude',
           'calm', 'private', 'reserved', 'reflect', 'observe', 'withdrawn'],
  },
  agreeableness: {
    high: ['kind', 'help', 'support', 'understand', 'empathy', 'generous', 'trust',
           'cooperation', 'harmony', 'compassion', 'grateful', 'appreciate', 'team',
           'together', 'share', 'care', 'polite', 'considerate', 'warm'],
    low:  ['disagree', 'argue', 'fight', 'compete', 'challenge', 'debate', 'skeptic',
           'critical', 'stubborn', 'ruthless', 'blunt', 'savage', 'destroy', 'roast'],
  },
  neuroticism: {
    high: ['anxious', 'worry', 'stress', 'nervous', 'fear', 'panic', 'overwhelm',
           'frustrated', 'angry', 'sad', 'depressed', 'insecure', 'doubt', 'hate',
           'terrible', 'awful', 'miserable', 'exhausted', 'struggling', 'crisis'],
    low:  ['calm', 'stable', 'confident', 'secure', 'peaceful', 'relaxed', 'steady',
           'composed', 'resilient', 'unfazed', 'chill', 'unbothered', 'zen'],
  },
};

// Additional signals: emoji/punctuation patterns
const PATTERN_SIGNALS = {
  extraversion: {
    high: [/!{2,}/g, /[A-Z]{3,}/g, /\b(lol|lmao|haha|omg)\b/gi],
    low: [/\.\.\./g],
  },
  neuroticism: {
    high: [/[!?]{3,}/g, /\b(ugh|smh|fml)\b/gi],
    low: [],
  },
  openness: {
    high: [/\b(what if|imagine|consider)\b/gi],
    low: [],
  },
};

function analyzeTweets(tweets) {
  if (!tweets || tweets.length === 0) {
    return {
      openness: 0.5,
      conscientiousness: 0.5,
      extraversion: 0.5,
      agreeableness: 0.5,
      neuroticism: 0.5,
    };
  }

  const allText = tweets.join(' ').toLowerCase();
  const wordCount = allText.split(/\s+/).length;
  const traits = {};

  for (const [trait, signals] of Object.entries(TRAIT_SIGNALS)) {
    let highCount = 0;
    let lowCount = 0;

    for (const word of signals.high) {
      const regex = new RegExp(`\\b${word}\\b`, 'gi');
      const matches = allText.match(regex);
      if (matches) highCount += matches.length;
    }

    for (const word of signals.low) {
      const regex = new RegExp(`\\b${word}\\b`, 'gi');
      const matches = allText.match(regex);
      if (matches) lowCount += matches.length;
    }

    // Check pattern signals
    const patterns = PATTERN_SIGNALS[trait];
    if (patterns) {
      for (const pattern of patterns.high || []) {
        const matches = tweets.join(' ').match(pattern);
        if (matches) highCount += matches.length;
      }
      for (const pattern of patterns.low || []) {
        const matches = tweets.join(' ').match(pattern);
        if (matches) lowCount += matches.length;
      }
    }

    // Normalize: more text = more signal opportunities, so divide by word count
    const normalizedHigh = highCount / Math.max(1, wordCount / 100);
    const normalizedLow = lowCount / Math.max(1, wordCount / 100);
    const total = normalizedHigh + normalizedLow || 1;

    // Score: 0.5 is neutral, signals shift up/down
    const raw = 0.5 + (normalizedHigh - normalizedLow) / (total * 2);
    traits[trait] = Math.max(0.05, Math.min(0.95, raw));
  }

  return traits;
}

module.exports = { analyzeTweets };
