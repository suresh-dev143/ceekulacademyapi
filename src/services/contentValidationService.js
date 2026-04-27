'use strict';

const { runContentValidator } = require('./claudeService');

// Patterns that always trigger rejection regardless of AI scores
const HARD_REJECT_PATTERNS = [
  /\b(suicide|self.?harm|kill yourself)\b/i,
  /\b(porn|pornography|xxx|nude|naked)\b/i,
  /\b(nigger|faggot|chink|spic|kike)\b/i,
  /\b(buy now|click here|free money|make \$\d+|lose weight fast)\b/i,
];

async function validateContent({ userId, title, description, category }) {
  const result = await runContentValidator({ userId, title, description, category });

  // Secondary strict layer — catch edge cases the model may score borderline
  const combined = `${title} ${description}`.toLowerCase();
  const hardRejected = HARD_REJECT_PATTERNS.some(p => p.test(combined));
  if (hardRejected && result.safety_score >= 40) {
    result.status        = 'REJECTED';
    result.safety_score  = Math.min(result.safety_score, 35);
    result.reason        = 'Content contains prohibited terms that violate platform policy.';
  }

  return result;
}

// Map AI status to story.status field value
function toStoryStatus(validationStatus) {
  if (validationStatus === 'APPROVED')      return 'approved';
  if (validationStatus === 'NEEDS_REVIEW')  return 'pending';
  return null; // REJECTED — do not save
}

module.exports = { validateContent, toStoryStatus };
