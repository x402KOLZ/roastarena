// Maps Big 5 personality traits → Sims character attributes

// Accessory keywords from bio
const ACCESSORY_KEYWORDS = {
  crown: ['king', 'queen', 'royal', 'ruler', 'leader'],
  flame_hat: ['fire', 'roast', 'burn', 'hot', 'spicy', 'flame'],
  sunglasses: ['cool', 'chill', 'vibe', 'smooth', 'swag'],
  headphones: ['music', 'dj', 'beats', 'producer', 'audio'],
  glasses: ['nerd', 'dev', 'code', 'engineer', 'data', 'research'],
  hat: ['casual', 'cap', 'hat', 'baseball'],
};

// Dominant color extraction from avatar URL hint (fallback: trait-based)
const TRAIT_COLORS = {
  high_extraversion: '#FF6B35',   // Warm orange
  high_neuroticism: '#8B0000',    // Dark red
  high_openness: '#9B59B6',       // Purple
  high_conscientiousness: '#2E86AB', // Steel blue
  high_agreeableness: '#27AE60',  // Green
  balanced: '#3498DB',            // Default blue
};

function mapTraitsToSims(traits, xUser) {
  // Determine dominant trait
  const traitEntries = Object.entries(traits);
  const dominant = traitEntries.reduce((max, [k, v]) => v > max[1] ? [k, v] : max, ['balanced', 0]);

  // Character color based on dominant trait
  let characterColor = TRAIT_COLORS.balanced;
  if (dominant[1] > 0.6) {
    const colorKey = `high_${dominant[0]}`;
    characterColor = TRAIT_COLORS[colorKey] || TRAIT_COLORS.balanced;
  }

  // Accessory from bio keywords
  let accessory = 'none';
  if (xUser && xUser.description) {
    const bio = xUser.description.toLowerCase();
    for (const [acc, keywords] of Object.entries(ACCESSORY_KEYWORDS)) {
      if (keywords.some(kw => bio.includes(kw))) {
        accessory = acc;
        break;
      }
    }
  }

  // Starting need modifiers based on traits
  const needModifiers = {
    energy_start: Math.round(60 + traits.extraversion * 30),
    hunger_start: Math.round(50 + traits.conscientiousness * 30),
    social_start: Math.round(30 + traits.extraversion * 50),
    fun_start: Math.round(40 + traits.openness * 40),
    clout_start: Math.round(20 + (xUser?.public_metrics?.followers_count || 0 > 1000 ? 30 : 10)),
    hygiene_start: Math.round(70 + traits.conscientiousness * 20),
  };

  // Predicted personality description
  const descriptions = [];
  if (traits.extraversion > 0.65) descriptions.push('Highly social and energetic');
  else if (traits.extraversion < 0.35) descriptions.push('Reserved and thoughtful');

  if (traits.openness > 0.65) descriptions.push('Creative and experimental');
  else if (traits.openness < 0.35) descriptions.push('Practical and grounded');

  if (traits.agreeableness > 0.65) descriptions.push('Cooperative and kind');
  else if (traits.agreeableness < 0.35) descriptions.push('Competitive and direct');

  if (traits.neuroticism > 0.65) descriptions.push('Intense and passionate');
  else if (traits.neuroticism < 0.35) descriptions.push('Calm and resilient');

  if (traits.conscientiousness > 0.65) descriptions.push('Organized and disciplined');
  else if (traits.conscientiousness < 0.35) descriptions.push('Spontaneous and flexible');

  return {
    character_color: characterColor,
    character_accessory: accessory,
    need_modifiers: needModifiers,
    personality_summary: descriptions.join('. ') || 'Well-balanced personality',
    dominant_trait: dominant[0],
    dominant_value: dominant[1],
  };
}

module.exports = { mapTraitsToSims };
