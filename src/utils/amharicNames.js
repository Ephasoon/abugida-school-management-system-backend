// src/utils/amharicNames.js
// ============================================================
// Optional Amharic name fields (migration 018, PHASE2_PLAN D4).
//   readAmharicNames(body, { first_name_am: 100, ... }) → { error } or { values }
//   values has only the fields the request sent: field → trimmed text, or
//   null ('' and null clear it). An update changes only those fields, so a
//   request without them leaves the stored names alone.
// ============================================================

const readAmharicNames = (body, limits) => {
  const values = {};
  for (const [field, max] of Object.entries(limits)) {
    if (!Object.prototype.hasOwnProperty.call(body || {}, field)) continue;
    const v = body[field];
    if (v !== null && typeof v !== 'string') return { error: `${field} must be text.` };
    const text = v === null ? '' : v.trim();
    if (text.length > max) return { error: `${field} must be at most ${max} characters.` };
    values[field] = text || null;
  }
  return { values };
};

const TEACHER_AM = { first_name_am: 100, last_name_am: 100 };
const STUDENT_AM = { first_name_am: 100, fathers_name_am: 100, last_name_am: 100 };
const PARENT_AM  = { full_name_am: 255 };

// SET clauses for an UPDATE: only the fields the request sent.
// amharicSet(values, 9) → { sql: ', first_name_am = $9', params: ['…'] }
const amharicSet = (values, firstParam) => {
  const fields = Object.keys(values);
  return {
    sql: fields.map((f, i) => `, ${f} = $${firstParam + i}`).join(''),
    params: fields.map((f) => values[f]),
  };
};

module.exports = { readAmharicNames, amharicSet, TEACHER_AM, STUDENT_AM, PARENT_AM };
