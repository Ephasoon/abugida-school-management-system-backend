// src/utils/examRules.js
// Shared validation for exam max_score (exams.max_score is NUMERIC(5,2), CHECK > 0).

const MAX_SCORE_LIMIT = 999.99;

// Returns an error message, or null if valid. undefined/null means "not provided".
const validateMaxScore = (value) => {
  if (value === undefined || value === null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_SCORE_LIMIT) {
    return `max_score must be a number greater than 0 and at most ${MAX_SCORE_LIMIT}.`;
  }
  return null;
};

// Postgres raises check_violation (23514) from the max_score trigger (migration 015)
// when max_score would drop below a score already entered.
const isScoreRuleViolation = (err) => err && err.code === '23514';

module.exports = { validateMaxScore, isScoreRuleViolation, MAX_SCORE_LIMIT };
