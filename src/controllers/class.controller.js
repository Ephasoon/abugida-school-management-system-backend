// src/controllers/class.controller.js
// ============================================================
// Classes per academic year (Phase 2 G2, M7a):
//   GET  /api/classes?academic_year_id=        → classes of a year (default: the current year)
//   POST /api/classes                          → create a class (admin)
//   PUT  /api/classes/:id                      → edit grade, section, capacity, homeroom teacher (admin)
//   POST /api/academic-years/:id/copy-classes  → copy last year's classes (admin)
// A class is one grade + section in one year ("Grade 9 Section A"); the name
// always follows the grade and section. Ids in bodies: validateBodyIds.
// ============================================================

const db                  = require('../config/db');
const { sendSuccess, sendError } = require('../utils/response');
const { sendServerError } = require('../utils/errors');
const { audit }           = require('../utils/audit');
const { inTransaction }   = require('../utils/transaction');
const { isUuid }          = require('../middleware/validateIds.middleware');

const SECTIONS = ['A', 'B', 'C', 'D', 'E'];
const className = (grade, section) => `Grade ${grade} Section ${section}`;

const CLASS_COLUMNS = `
  c.id, c.name, c.grade_level, c.section, c.capacity, c.academic_year_id, c.homeroom_teacher_id,
  ay.name AS academic_year, ay.start_date AS year_start, ay.end_date AS year_end, ay.semester2_start,
  t.first_name AS homeroom_first_name, t.last_name AS homeroom_last_name,
  t.first_name_am AS homeroom_first_name_am, t.last_name_am AS homeroom_last_name_am,
  (SELECT COUNT(*)::int FROM students s WHERE s.class_id = c.id AND s.status = 'active') AS student_count`;
const CLASS_FROM = `
  FROM classes c
  JOIN academic_years ay ON ay.id = c.academic_year_id
  LEFT JOIN teachers t ON t.id = c.homeroom_teacher_id`;

const loadClass = async (q, id) => (await q.query(`SELECT ${CLASS_COLUMNS} ${CLASS_FROM} WHERE c.id = $1`, [id])).rows[0];

// Checks grade, section, capacity and homeroom teacher; returns an error message or null
const checkFields = async ({ grade_level, section, capacity, homeroom_teacher_id }, partial) => {
  if (!partial || grade_level !== undefined) {
    if (!Number.isInteger(grade_level) || grade_level < 1 || grade_level > 12) return 'grade_level must be a whole number from 1 to 12.';
  }
  if (!partial || section !== undefined) {
    if (!SECTIONS.includes(section)) return `section must be one of ${SECTIONS.join(', ')}.`;
  }
  if (capacity !== undefined && capacity !== null) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 200) return 'capacity must be a whole number from 1 to 200.';
  }
  if (homeroom_teacher_id) {
    const { rows } = await db.query('SELECT is_active FROM teachers WHERE id = $1', [homeroom_teacher_id]);
    if (!rows[0]?.is_active) return 'The homeroom teacher must be an active teacher.';
  }
  return null;
};


// ── GET /api/classes ─────────────────────────────────────────
const getClasses = async (req, res) => {
  try {
    const { academic_year_id } = req.query;
    if (academic_year_id && !isUuid(academic_year_id)) {
      return sendError(res, 'academic_year_id does not exist.', 400, { field: 'academic_year_id' });
    }
    const { rows: yr } = await db.query(
      academic_year_id ? 'SELECT id, name FROM academic_years WHERE id = $1' : 'SELECT id, name FROM academic_years WHERE is_current',
      academic_year_id ? [academic_year_id] : []);
    if (!yr[0]) {
      return academic_year_id
        ? sendError(res, 'academic_year_id does not exist.', 400, { field: 'academic_year_id' })
        : sendSuccess(res, [], 'No current academic year.');
    }
    const { rows } = await db.query(
      `SELECT ${CLASS_COLUMNS} ${CLASS_FROM} WHERE c.academic_year_id = $1 ORDER BY c.grade_level, c.section`, [yr[0].id]);
    return sendSuccess(res, rows, `${rows.length} class(es) in ${yr[0].name}.`);
  } catch (err) {
    return sendServerError(res, err, 'Server error.');
  }
};


// ── POST /api/classes ────────────────────────────────────────
const createClass = async (req, res) => {
  try {
    const { academic_year_id, grade_level, section, capacity = 45, homeroom_teacher_id = null } = req.body;
    if (!academic_year_id) return sendError(res, 'academic_year_id is required.', 400);
    const bad = await checkFields({ grade_level, section, capacity, homeroom_teacher_id }, false);
    if (bad) return sendError(res, bad, 400);

    const { rows: dup } = await db.query(
      'SELECT 1 FROM classes WHERE academic_year_id = $1 AND grade_level = $2 AND section = $3', [academic_year_id, grade_level, section]);
    if (dup[0]) return sendError(res, `${className(grade_level, section)} already exists in this year.`, 409);

    const created = await inTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO classes (academic_year_id, name, grade_level, section, capacity, homeroom_teacher_id)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [academic_year_id, className(grade_level, section), grade_level, section, capacity, homeroom_teacher_id]);
      await audit(client, req, 'class.created', 'class', rows[0].id,
        { academic_year_id, grade_level, section, capacity, homeroom_teacher_id });
      return loadClass(client, rows[0].id);
    });
    return sendSuccess(res, created, `${created.name} created.`, 201);
  } catch (err) {
    if (err.code === '23505') return sendError(res, 'This class already exists in this year.', 409);
    return sendServerError(res, err, 'Server error.');
  }
};


// ── PUT /api/classes/:id ─────────────────────────────────────
// Only the fields sent change; homeroom_teacher_id null removes the homeroom
// teacher. The year of a class cannot change.
const updateClass = async (req, res) => {
  try {
    const { id } = req.params;
    const b = req.body || {};
    if (b.academic_year_id !== undefined) return sendError(res, 'The academic year of a class cannot be changed.', 400);
    const before = await loadClass(db, id);
    if (!before) return sendError(res, 'Class not found.', 404);
    const bad = await checkFields(b, true);
    if (bad) return sendError(res, bad, 400);

    const after = {
      grade_level: b.grade_level ?? before.grade_level,
      section: b.section ?? before.section,
      capacity: b.capacity ?? before.capacity,
      homeroom_teacher_id: b.homeroom_teacher_id !== undefined ? (b.homeroom_teacher_id || null) : before.homeroom_teacher_id,
    };
    if (after.grade_level !== before.grade_level || after.section !== before.section) {
      const { rows: dup } = await db.query(
        'SELECT 1 FROM classes WHERE academic_year_id = $1 AND grade_level = $2 AND section = $3 AND id <> $4',
        [before.academic_year_id, after.grade_level, after.section, id]);
      if (dup[0]) return sendError(res, `${className(after.grade_level, after.section)} already exists in this year.`, 409);
    }

    const updated = await inTransaction(async (client) => {
      await client.query(
        `UPDATE classes SET name = $1, grade_level = $2, section = $3, capacity = $4, homeroom_teacher_id = $5 WHERE id = $6`,
        [className(after.grade_level, after.section), after.grade_level, after.section, after.capacity, after.homeroom_teacher_id, id]);
      await audit(client, req, 'class.updated', 'class', id, after);
      return loadClass(client, id);
    });
    return sendSuccess(res, updated, `${updated.name} updated.`);
  } catch (err) {
    if (err.code === '23505') return sendError(res, 'This class already exists in this year.', 409);
    return sendServerError(res, err, 'Server error.');
  }
};


// ── POST /api/academic-years/:id/copy-classes ────────────────
// Creates in this year every grade + section of from_year_id that this year
// does not have yet (same capacity, no students). Running it again adds
// nothing. copy_assignments (default false) also copies homeroom teachers
// (where the class has none) and teacher class assignments, active teachers only.
const copyClasses = async (req, res) => {
  try {
    const { id } = req.params;
    const { from_year_id, copy_assignments = false } = req.body || {};
    if (!from_year_id) return sendError(res, 'from_year_id is required.', 400);
    if (typeof copy_assignments !== 'boolean') return sendError(res, 'copy_assignments must be true or false.', 400);
    if (from_year_id.toLowerCase() === id.toLowerCase()) return sendError(res, 'from_year_id must be another academic year.', 400);

    const result = await inTransaction(async (client) => {
      const { rows: from } = await client.query(
        'SELECT id, grade_level, section, capacity, homeroom_teacher_id FROM classes WHERE academic_year_id = $1 ORDER BY grade_level, section', [from_year_id]);
      let created = 0, existing = 0, homerooms = 0, assignments = 0;
      for (const fc of from) {
        const { rows: ins } = await client.query(
          `INSERT INTO classes (academic_year_id, name, grade_level, section, capacity)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (academic_year_id, grade_level, section) DO NOTHING RETURNING id`,
          [id, className(fc.grade_level, fc.section), fc.grade_level, fc.section, fc.capacity]);
        if (ins[0]) created++; else existing++;
        if (!copy_assignments) continue;

        const { rows: [target] } = await client.query(
          'SELECT id, homeroom_teacher_id FROM classes WHERE academic_year_id = $1 AND grade_level = $2 AND section = $3', [id, fc.grade_level, fc.section]);
        if (fc.homeroom_teacher_id && !target.homeroom_teacher_id) {
          const { rowCount } = await client.query(
            `UPDATE classes SET homeroom_teacher_id = $1 WHERE id = $2
               AND EXISTS (SELECT 1 FROM teachers WHERE id = $1 AND is_active)`, [fc.homeroom_teacher_id, target.id]);
          homerooms += rowCount;
        }
        const { rowCount } = await client.query(
          `INSERT INTO teacher_classes (teacher_id, class_id, subject_id)
           SELECT tc.teacher_id, $2, tc.subject_id FROM teacher_classes tc
           JOIN teachers t ON t.id = tc.teacher_id AND t.is_active
           WHERE tc.class_id = $1
           ON CONFLICT (teacher_id, class_id, subject_id) DO NOTHING`, [fc.id, target.id]);
        assignments += rowCount;
      }
      const summary = { from_year_id, copy_assignments, created, existing, homerooms_copied: homerooms, assignments_copied: assignments };
      await audit(client, req, 'classes.copied', 'academic_year', id, summary);
      return summary;
    });

    return sendSuccess(res, result,
      `${result.created} class(es) created, ${result.existing} already there.` +
      (copy_assignments ? ` ${result.homerooms_copied} homeroom teacher(s) and ${result.assignments_copied} assignment(s) copied.` : ''));
  } catch (err) {
    return sendServerError(res, err, 'Server error.');
  }
};

module.exports = { getClasses, createClass, updateClass, copyClasses };
