// src/utils/pagination.js
// ============================================================
// Parses and validates ?page= and ?limit= query params.
// Default limit 50, max 200. Rejects non-numeric or out-of-range values.
//
// Usage:
//   const pg = parsePagination(req.query);
//   if (pg.error) return sendError(res, pg.error, 400);
//   const { page, limit, offset } = pg;
// ============================================================

const DEFAULT_LIMIT = 50;
const MAX_LIMIT     = 200;

const parsePositiveInt = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  const str = String(value).trim();
  if (!/^\d+$/.test(str)) return NaN;
  return parseInt(str, 10);
};

const parsePagination = (query = {}) => {
  const page  = parsePositiveInt(query.page, 1);
  const limit = parsePositiveInt(query.limit, DEFAULT_LIMIT);

  if (Number.isNaN(page) || page < 1) {
    return { error: 'page must be a positive integer.' };
  }
  if (Number.isNaN(limit) || limit < 1 || limit > MAX_LIMIT) {
    return { error: `limit must be an integer between 1 and ${MAX_LIMIT}.` };
  }

  return { page, limit, offset: (page - 1) * limit };
};

module.exports = { parsePagination, DEFAULT_LIMIT, MAX_LIMIT };
