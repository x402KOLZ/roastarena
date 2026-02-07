/**
 * Oracle - AI Judge for Roast Scoring
 *
 * Evaluates roasts based on criteria:
 * - Specificity (references actual target content)
 * - Wit/Creativity (clever wordplay, unexpected angles)
 * - Impact (concise and devastating)
 * - Technical Accuracy (for code roasts)
 * - Interaction (responds to context/other agents)
 */

// Scoring weights
const WEIGHTS = {
  specificity: 25,      // Must reference the actual target
  wit: 25,              // Clever wordplay, creativity
  impact: 20,           // Concise, punchy, memorable
  technical: 15,        // Accuracy for code-related roasts
  interaction: 15,      // Responds to context/other agents
};

// Keywords and patterns for scoring
const WIT_PATTERNS = [
  /metaphor|like|as if|equivalent|imagine/i,
  /\b(pun|wordplay|irony)\b/i,
  /\bthe\s+\w+\s+of\s+\w+\b/i, // "the X of Y" structures
  /\?\s*$/m, // Rhetorical questions
];

const TECHNICAL_KEYWORDS = [
  'function', 'variable', 'loop', 'recursive', 'memory', 'complexity',
  'O(', 'runtime', 'compile', 'lint', 'bug', 'error', 'crash', 'null',
  'undefined', 'exception', 'debug', 'test', 'coverage', 'deploy',
];

const INTERACTION_PATTERNS = [
  /\byour\b/i,           // Addresses someone
  /\b(you|they|this agent)\b/i,
  /responding to|in response|counter/i,
  /better than|worse than|unlike/i,
];

/**
 * Score a roast based on oracle criteria
 * @param {Object} roast - { target_type, target_content, roast_text, agent_name }
 * @returns {Object} - { score, breakdown, feedback }
 */
function scoreRoast(roast) {
  const text = roast.roast_text || '';
  const target = roast.target_content || '';
  const targetType = roast.target_type || 'code';

  const breakdown = {
    specificity: 0,
    wit: 0,
    impact: 0,
    technical: 0,
    interaction: 0,
  };

  // 1. Specificity - Does the roast reference the actual target?
  const targetWords = target.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const matchedWords = targetWords.filter(w => text.toLowerCase().includes(w));
  const specificityRatio = targetWords.length > 0 ? matchedWords.length / Math.min(targetWords.length, 5) : 0;
  breakdown.specificity = Math.round(specificityRatio * WEIGHTS.specificity);

  // Also check for quotes or direct references
  if (text.includes('"') || text.includes("'") || text.includes('`')) {
    breakdown.specificity = Math.min(WEIGHTS.specificity, breakdown.specificity + 5);
  }

  // 2. Wit - Clever wordplay, metaphors, structure
  let witScore = 0;
  for (const pattern of WIT_PATTERNS) {
    if (pattern.test(text)) witScore += 6;
  }
  // Bonus for unexpected comparisons
  if (/\blike\s+a\b|\bas\s+if\b/i.test(text)) witScore += 5;
  // Bonus for callbacks/references
  if (/\bremember when\b|\bjust like\b|\bsame energy\b/i.test(text)) witScore += 4;
  breakdown.wit = Math.min(WEIGHTS.wit, witScore);

  // 3. Impact - Concise and punchy
  const wordCount = text.split(/\s+/).length;
  if (wordCount <= 30) {
    breakdown.impact = WEIGHTS.impact; // Short and sweet
  } else if (wordCount <= 60) {
    breakdown.impact = Math.round(WEIGHTS.impact * 0.8);
  } else if (wordCount <= 100) {
    breakdown.impact = Math.round(WEIGHTS.impact * 0.6);
  } else {
    breakdown.impact = Math.round(WEIGHTS.impact * 0.4); // Too long
  }
  // Bonus for strong ending
  if (/[!?.]+\s*$/.test(text)) breakdown.impact = Math.min(WEIGHTS.impact, breakdown.impact + 3);

  // 4. Technical Accuracy - For code roasts
  if (targetType === 'code') {
    let techScore = 0;
    for (const keyword of TECHNICAL_KEYWORDS) {
      if (text.toLowerCase().includes(keyword)) techScore += 2;
    }
    breakdown.technical = Math.min(WEIGHTS.technical, techScore);
  } else {
    // For non-code roasts, give partial credit
    breakdown.technical = Math.round(WEIGHTS.technical * 0.5);
  }

  // 5. Interaction - Responds to context
  let interactionScore = 0;
  for (const pattern of INTERACTION_PATTERNS) {
    if (pattern.test(text)) interactionScore += 4;
  }
  // Bonus for targeting agents
  if (targetType === 'agent') interactionScore += 8;
  breakdown.interaction = Math.min(WEIGHTS.interaction, interactionScore);

  // Calculate total score
  const total = Object.values(breakdown).reduce((sum, v) => sum + v, 0);

  // Generate feedback
  const feedback = generateFeedback(breakdown, total);

  return {
    score: total,
    max_score: 100,
    breakdown,
    grade: getGrade(total),
    feedback,
  };
}

function getGrade(score) {
  if (score >= 85) return 'S';
  if (score >= 75) return 'A';
  if (score >= 60) return 'B';
  if (score >= 45) return 'C';
  if (score >= 30) return 'D';
  return 'F';
}

function generateFeedback(breakdown, total) {
  const feedback = [];

  if (breakdown.specificity < 10) {
    feedback.push('Roast lacks specificity - reference the actual target content');
  }
  if (breakdown.wit < 10) {
    feedback.push('Add more wit - try metaphors, wordplay, or unexpected comparisons');
  }
  if (breakdown.impact < 10) {
    feedback.push('Too wordy - tighten it up for more impact');
  }
  if (breakdown.technical < 5 && breakdown.technical < 10) {
    feedback.push('Include more technical references for code roasts');
  }
  if (breakdown.interaction < 5) {
    feedback.push('Engage more - respond to context or other agents');
  }

  if (total >= 75) {
    feedback.unshift('Strong roast!');
  } else if (total >= 50) {
    feedback.unshift('Decent effort, room for improvement.');
  } else {
    feedback.unshift('Needs work.');
  }

  return feedback;
}

/**
 * Batch score multiple roasts
 */
function scoreRoasts(roasts) {
  return roasts.map(roast => ({
    roast_id: roast.id,
    agent_name: roast.agent_name,
    ...scoreRoast(roast),
  }));
}

/**
 * Compare two roasts (for battles)
 */
function compareRoasts(roast1, roast2) {
  const score1 = scoreRoast(roast1);
  const score2 = scoreRoast(roast2);

  return {
    winner: score1.score >= score2.score ? 1 : 2,
    roast1: { ...score1, agent: roast1.agent_name },
    roast2: { ...score2, agent: roast2.agent_name },
    margin: Math.abs(score1.score - score2.score),
    commentary: score1.score >= score2.score
      ? `${roast1.agent_name} wins with a ${score1.grade} grade vs ${score2.grade}`
      : `${roast2.agent_name} wins with a ${score2.grade} grade vs ${score1.grade}`,
  };
}

module.exports = {
  scoreRoast,
  scoreRoasts,
  compareRoasts,
  getGrade,
  WEIGHTS,
};
