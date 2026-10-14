// src/middleware/validateBodyIds.middleware.js
// ============================================================
// One check for ids in request bodies (BACKLOG "Validate ids in request
// bodies", decision 2026-10-14). A malformed or unknown id answers
//   400 { message: "<field> does not exist.", errors: { field } }
// with the same message for both, so a bad id never reaches a uuid column or
// a foreign key (500). For arrays the field names the entry:
// "subject_ids[1]", "grades[2].student_id".
//
// A missing id (undefined, null or '') is not checked here: whether it is
// required is up to the route ("class_id is required").
//
// Place it after the role and record-level checks, right before the
// controller (after multer for uploads: a refused upload's file is removed).
//
// Usage:
//   validateBodyIds({ class_id: 'classes', 'records[].student_id': 'students', 'subject_ids[]': 'subjects' })
// ============================================================

const fs                  = require('fs');
const db                  = require('../config/db');
const { sendError }       = require('../utils/response');
const { sendServerError } = require('../utils/errors');
const { isUuid, TABLES }  = require('./validateIds.middleware');

const BODY_TABLES = { ...TABLES, fee_structures: 'Fee structure' };
const missing = (v) => v === undefined || v === null || v === '';

// "a" | "a[]" | "a[].b" → the values present in the body, each with its field name
const collect = (body, spec) => {
  const found = [];
  for (const [key, table] of Object.entries(spec)) {
    const m = key.match(/^(\w+)\[\](?:\.(\w+))?$/);
    if (!m) {
      if (!missing(body?.[key])) found.push({ field: key, value: body[key], table });
      continue;
    }
    const [, list, prop] = m;
    if (!Array.isArray(body?.[list])) continue; // the route reports a missing or wrong list itself
    body[list].forEach((item, i) => {
      if (prop && (item === null || typeof item !== 'object')) return;
      const value = prop ? item[prop] : item;
      if (!missing(value)) found.push({ field: `${list}[${i}]${prop ? `.${prop}` : ''}`, value, table });
    });
  }
  return found;
};

const validateBodyIds = (spec) => {
  for (const t of Object.values(spec)) {
    if (!BODY_TABLES[t]) throw new Error(`validateBodyIds: unknown table ${t}`);
  }
  return async (req, res, next) => {
    const refuse = (field) => {
      if (req.file?.path) fs.unlink(req.file.path, () => {});
      return sendError(res, `${field} does not exist.`, 400, { field });
    };
    const found = collect(req.body, spec);
    const bad = found.find((x) => !isUuid(x.value));
    if (bad) return refuse(bad.field);

    try {
      // One query per table for all its ids
      const known = new Set();
      for (const table of new Set(found.map((x) => x.table))) {
        const ids = [...new Set(found.filter((x) => x.table === table).map((x) => x.value.toLowerCase()))];
        const { rows } = await db.query(`SELECT id::text AS id FROM ${table} WHERE id = ANY($1::uuid[])`, [ids]);
        for (const r of rows) known.add(`${table}:${r.id}`);
      }
      const unknown = found.find((x) => !known.has(`${x.table}:${x.value.toLowerCase()}`));
      if (unknown) return refuse(unknown.field);
    } catch (err) {
      if (req.file?.path) fs.unlink(req.file.path, () => {});
      return sendServerError(res, err, 'Server error while checking ids.');
    }
    return next();
  };
};

module.exports = { validateBodyIds };
