// src/utils/password.js
// Random temporary passwords for newly created accounts.
// Uses crypto.randomInt (CSPRNG). Ambiguous characters (0/O, 1/l/I) are excluded
// so the password can be read aloud or copied from paper.

const crypto = require('crypto');

const LOWER  = 'abcdefghijkmnpqrstuvwxyz';
const UPPER  = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const ALL    = LOWER + UPPER + DIGITS;

const pick = (chars) => chars[crypto.randomInt(chars.length)];

const generateTemporaryPassword = (length = 12) => {
  // Guarantee at least one of each class, then fill and shuffle
  const chars = [pick(LOWER), pick(UPPER), pick(DIGITS)];
  while (chars.length < length) chars.push(pick(ALL));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
};

module.exports = { generateTemporaryPassword };
