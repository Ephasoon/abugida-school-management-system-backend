// src/utils/money.js
// ============================================================
// Exact money (M8): amounts are handled as whole santim (1 ETB = 100 santim) in
// JavaScript and as NUMERIC(12,2) in PostgreSQL, never as floating point.
//
//   parseAmount('1250.5') → 125050      parseAmount(-1) → null
//   fromCents(125050)     → '1250.50'   (the string the API returns)
//   percentOf(125050, '12.5') → 15631   (rounded half up to the santim)
// ============================================================

const MAX_CENTS = 9999999999; // NUMERIC(12,2)

/** "1250", "1250.5", "1250.50" or a number with at most 2 decimals → santim; null if not a valid amount ≥ 0. */
const parseAmount = (v) => {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null;
    v = String(v);
  }
  if (typeof v !== 'string') return null;
  const m = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(v.trim());
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0'));
  return cents <= MAX_CENTS ? cents : null;
};

/** A NUMERIC value from PostgreSQL ("1250.50", or null) → santim. */
const toCents = (v) => (v === null || v === undefined ? 0 : parseAmount(String(v).replace(/^-/, '')) * (String(v).startsWith('-') ? -1 : 1));

/** santim → "1250.50" */
const fromCents = (c) => {
  const neg = c < 0; const a = Math.abs(c);
  return `${neg ? '-' : ''}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
};

/** percent (string or number, at most 2 decimals, 0-100) of an amount in santim, rounded half up. */
const percentOf = (cents, percent) => {
  const p = parseAmount(percent); // percent × 100, exact
  return Math.floor((cents * p + 5000) / 10000);
};

module.exports = { parseAmount, toCents, fromCents, percentOf, MAX_CENTS };
