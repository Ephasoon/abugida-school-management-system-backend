// src/controllers/academicYear.controller.js
// ============================================================
// Handles all academic year operations:
//   GET  /api/academic-years           → list all years
//   GET  /api/academic-years/current   → get current year
//   POST /api/academic-years           → create new year
//   PUT  /api/academic-years/:id       → update year (a changed semester2_start moves dated exams)
//   GET  /api/academic-years/:id/semester2-preview → which exams a new semester2_start would move
//   POST /api/academic-years/:id/activate → set as current
//   DELETE /api/academic-years/:id     → delete an unused year
//   GET  /api/academic-years/:id/stats → year statistics
//   promotion: promotion.controller.js; classes: class.controller.js
// ============================================================

const db            = require('../config/db');
const { sendSuccess,
        sendError } = require('../utils/response');
const { sendServerError } = require('../utils/errors');
const { audit }         = require('../utils/audit');
const { inTransaction } = require('../utils/transaction');
const { LockedError, assertYearUnlocked } = require('../services/locks.service');
const { totalsSql } = require('../services/fees.service');

// Dates are 'YYYY-MM-DD' strings (see config/db.js), so they compare as text.
const isIsoDate = (d) =>
  /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d)) &&
  new Date(d).toISOString().slice(0, 10) === d;

// Error message when the dates are invalid or out of order, else null
const dateRangeError = (start_date, end_date) => {
  if (!isIsoDate(start_date) || !isIsoDate(end_date)) {
    return 'start_date and end_date must be valid dates in format YYYY-MM-DD.';
  }
  if (end_date <= start_date) {
    return `end_date (${end_date}) must be after start_date (${start_date}).`;
  }
  return null;
};

// semester2_start (B1): after start_date, not after end_date. Error or null.
const semester2Error = (s2, start_date, end_date) => {
  if (!isIsoDate(s2)) return 'semester2_start must be a valid date in format YYYY-MM-DD.';
  if (s2 <= start_date || s2 > end_date) {
    return `semester2_start (${s2}) must be after start_date (${start_date}) and not after end_date (${end_date}).`;
  }
  return null;
};

// Default semester 2 start (D14): Yekatit 1 of the Ethiopian year of end_date (one SQL function, 020)
const defaultSemester2 = async (q, end_date) =>
  (await q.query('SELECT asms_semester2_default($1::date)::text AS d', [end_date])).rows[0].d;

// Dated exams of a year's classes whose semester would change with this semester 2 start
const examsMoving = (q, yearId, s2) => q.query(
  `SELECT e.id, e.name, e.exam_date, e.semester AS from_semester,
          CASE WHEN e.exam_date >= $2::date THEN 'semester2' ELSE 'semester1' END AS to_semester,
          c.name AS class_name, s.name AS subject_name
   FROM exams e JOIN classes c ON c.id = e.class_id JOIN subjects s ON s.id = e.subject_id
   WHERE c.academic_year_id = $1 AND e.exam_date IS NOT NULL
     AND e.semester::text <> CASE WHEN e.exam_date >= $2::date THEN 'semester2' ELSE 'semester1' END
   ORDER BY e.exam_date, c.name, s.name`, [yearId, s2]).then((r) => r.rows);

// The name is the Gregorian years "YYYY/YYYY": consecutive, the first one the
// start date's year (M7a decision: "2026/2027" starts in 2026). Error or null.
const nameError = (name, start_date) => {
  const m = /^(\d{4})\/(\d{4})$/.exec(String(name ?? ''));
  if (!m) return 'name must be in format YYYY/YYYY (e.g. 2026/2027).';
  if (+m[2] !== +m[1] + 1) return `name must be two consecutive years (e.g. ${m[1]}/${+m[1] + 1}).`;
  if (isIsoDate(start_date) && start_date.slice(0, 4) !== m[1]) {
    return `name must start with the year of start_date (${start_date.slice(0, 4)}/${+start_date.slice(0, 4) + 1}).`;
  }
  return null;
};


// ── GET /api/academic-years ───────────────────────────────────
const getAcademicYears = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT ay.*,
         COUNT(DISTINCT c.id) AS class_count,
         COUNT(DISTINCT s.id) AS student_count,
         (SELECT fy.name FROM promotion_runs pr JOIN academic_years fy ON fy.id = pr.from_year_id WHERE pr.to_year_id = ay.id LIMIT 1) AS promoted_from,
         (SELECT ty.name FROM promotion_runs pr JOIN academic_years ty ON ty.id = pr.to_year_id WHERE pr.from_year_id = ay.id) AS promoted_to
       FROM academic_years ay
       LEFT JOIN classes  c ON c.academic_year_id = ay.id
       LEFT JOIN students s ON s.class_id = c.id AND s.status = 'active'
       GROUP BY ay.id
       ORDER BY ay.start_date DESC`
    );
    return sendSuccess(res, rows, `Found ${rows.length} academic year(s).`);
  } catch (err) {
    return sendServerError(res, err, 'Server error.');
  }
};


// ── GET /api/academic-years/current ──────────────────────────
const getCurrentYear = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT ay.*,
         COUNT(DISTINCT c.id) AS class_count,
         COUNT(DISTINCT s.id) AS student_count
       FROM academic_years ay
       LEFT JOIN classes  c ON c.academic_year_id = ay.id
       LEFT JOIN students s ON s.class_id = c.id AND s.status = 'active'
       WHERE ay.is_current = TRUE
       GROUP BY ay.id`
    );
    if (!rows[0]) return sendError(res, 'No current academic year set.', 404);
    return sendSuccess(res, rows[0], 'Current academic year retrieved.');
  } catch (err) {
    return sendServerError(res, err, 'Server error.');
  }
};


// ── POST /api/academic-years ──────────────────────────────────
const createAcademicYear = async (req, res) => {
  try {
    const { name, start_date, end_date } = req.body;

    if (!name || !start_date || !end_date) {
      return sendError(res, 'name, start_date, and end_date are required.', 400);
    }

    const dateError = dateRangeError(start_date, end_date);
    if (dateError) return sendError(res, dateError, 400);
    const badName = nameError(name, start_date);
    if (badName) return sendError(res, badName, 400);

    // Semester 2 start: as sent, or the default (the old frontend never sends it)
    const semester2_start = req.body.semester2_start ?? await defaultSemester2(db, end_date);
    const s2Error = semester2Error(semester2_start, start_date, end_date);
    if (s2Error) {
      return sendError(res, req.body.semester2_start === undefined
        ? `The default semester 2 start (Yekatit 1, ${semester2_start}) is outside these dates; send semester2_start.` : s2Error,
      400, { field: 'semester2_start' });
    }

    const { rows: existing } = await db.query(
      'SELECT id FROM academic_years WHERE name = $1', [name]
    );
    if (existing[0]) return sendError(res, `Year ${name} already exists.`, 409);

    const rows = await inTransaction(async (client) => {
      const r = await client.query(
        `INSERT INTO academic_years (name, start_date, end_date, semester2_start, is_current)
         VALUES ($1,$2,$3,$4,FALSE) RETURNING *`,
        [name, start_date, end_date, semester2_start]
      );
      await audit(client, req, 'academic_year.created', 'academic_year', r.rows[0].id, { name, start_date, end_date, semester2_start });
      return r.rows;
    });

    return sendSuccess(res, rows[0], `Academic year ${name} created.`, 201);

  } catch (err) {
    return sendServerError(res, err, 'Server error.');
  }
};


// ── PUT /api/academic-years/:id ───────────────────────────────
const updateAcademicYear = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, start_date, end_date, semester2_start } = req.body;

    // ::text comparison: a malformed id simply matches nothing (404, not 500)
    const { rows: current } = await db.query(
      'SELECT name, start_date, end_date, semester2_start FROM academic_years WHERE id::text = $1', [id]
    );
    if (!current[0]) return sendError(res, 'Academic year not found.', 404);

    // Check the dates and name the row will have after the update
    const after = {
      name: name ?? current[0].name,
      start_date: start_date ?? current[0].start_date,
      end_date: end_date ?? current[0].end_date,
      semester2_start: semester2_start ?? current[0].semester2_start,
    };
    // New dates without a semester2_start (e.g. the old frontend): keep the current start if it
    // still lies inside them, else use the default for the new end date
    if (semester2_start === undefined && semester2Error(after.semester2_start, after.start_date, after.end_date)
        && isIsoDate(after.start_date) && isIsoDate(after.end_date) && after.end_date > after.start_date) {
      after.semester2_start = await defaultSemester2(db, after.end_date);
    }
    const dateError = dateRangeError(after.start_date, after.end_date);
    if (dateError) return sendError(res, dateError, 400);
    const badName = nameError(after.name, after.start_date);
    if (badName) return sendError(res, badName, 400);
    const s2Error = semester2Error(after.semester2_start, after.start_date, after.end_date);
    if (s2Error) {
      return sendError(res, semester2_start === undefined
        ? `Semester 2 starts ${after.semester2_start}, outside the new dates; send semester2_start too.` : s2Error,
      400, { field: 'semester2_start' });
    }
    if (after.name !== current[0].name) {
      const { rows: taken } = await db.query('SELECT 1 FROM academic_years WHERE name = $1 AND id <> $2', [after.name, id]);
      if (taken[0]) return sendError(res, `Year ${after.name} already exists.`, 409);
    }
    // Dated exams must stay inside the year
    const { rows: outside } = await db.query(
      `SELECT COUNT(*)::int AS n FROM exams e JOIN classes c ON c.id = e.class_id
       WHERE c.academic_year_id = $1 AND e.exam_date IS NOT NULL AND (e.exam_date < $2 OR e.exam_date > $3)`,
      [id, after.start_date, after.end_date]);
    if (outside[0].n) {
      return sendError(res, `${outside[0].n} exam(s) of this year are dated outside ${after.start_date} to ${after.end_date}. Change their dates first.`, 400, { field: 'start_date' });
    }

    const { rows, moved } = await inTransaction(async (client) => {
      if (after.semester2_start !== current[0].semester2_start) await assertYearUnlocked(client, id);   // D29
      const r = await client.query(
        `UPDATE academic_years SET name = $1, start_date = $2, end_date = $3, semester2_start = $4
         WHERE id = $5 RETURNING *`,
        [after.name, after.start_date, after.end_date, after.semester2_start, id]
      );
      // Dated exams follow a changed semester 2 start
      const moving = await examsMoving(client, id, after.semester2_start);
      if (moving.length) {
        await client.query(
          `UPDATE exams SET semester = CASE WHEN exam_date >= $2::date THEN 'semester2' ELSE 'semester1' END::semester_type
           WHERE id = ANY($1::uuid[])`, [moving.map((e) => e.id), after.semester2_start]);
      }
      await audit(client, req, 'academic_year.updated', 'academic_year', id, { ...after, exams_moved: moving.length });
      return { rows: r.rows, moved: moving.length };
    });
    if (!rows[0]) return sendError(res, 'Academic year not found.', 404);
    return sendSuccess(res, { ...rows[0], exams_moved: moved },
      moved ? `Academic year updated; ${moved} exam(s) moved to the other semester.` : 'Academic year updated.');
  } catch (err) {
    if (err instanceof LockedError) return sendError(res, err.message, err.status, err.errors);
    return sendServerError(res, err, 'Server error.');
  }
};


// ── POST /api/academic-years/:id/activate ────────────────────
const activateYear = async (req, res) => {
  try {
    const { id } = req.params;

    const { rows: yearRows } = await db.query(
      'SELECT * FROM academic_years WHERE id = $1', [id]
    );
    if (!yearRows[0]) return sendError(res, 'Academic year not found.', 404);
    if (yearRows[0].is_current) {
      return sendError(res, `${yearRows[0].name} is already active.`, 400);
    }

    const rows = await inTransaction(async (client) => {
      const { rows: before } = await client.query('SELECT id, name FROM academic_years WHERE is_current');
      await client.query('UPDATE academic_years SET is_current = FALSE WHERE is_current');
      const r = await client.query(
        'UPDATE academic_years SET is_current = TRUE WHERE id = $1 RETURNING *', [id]
      );
      await audit(client, req, 'academic_year.activated', 'academic_year', id,
        { name: r.rows[0].name, previous: before[0]?.name ?? null });
      return r.rows;
    });

    return sendSuccess(res, rows[0], `${rows[0].name} is now the active academic year.`);

  } catch (err) {
    return sendServerError(res, err, 'Server error.');
  }
};


// ── DELETE /api/academic-years/:id ───────────────────────────
// Only an unused year: not the current one, and nothing refers to it (no
// classes, so no students; no exams, fee structures or payments).
const deleteAcademicYear = async (req, res) => {
  try {
    const { id } = req.params;
    const { rows: yr } = await db.query('SELECT id, name, is_current FROM academic_years WHERE id = $1', [id]);
    if (!yr[0]) return sendError(res, 'Academic year not found.', 404);
    if (yr[0].is_current) return sendError(res, `${yr[0].name} is the active year and cannot be deleted.`, 409);

    const { rows: [use] } = await db.query(
      `SELECT (SELECT COUNT(*) FROM classes        WHERE academic_year_id = $1)::int AS classes,
              (SELECT COUNT(*) FROM exams          WHERE academic_year_id = $1)::int AS exams,
              (SELECT COUNT(*) FROM fee_structures WHERE academic_year_id = $1)::int AS fee_structures,
              (SELECT COUNT(*) FROM payments       WHERE academic_year_id = $1)::int AS payments,
              (SELECT COUNT(*) FROM student_charges WHERE academic_year_id = $1)::int AS charges,
              (SELECT COUNT(*) FROM promotion_runs WHERE $1 IN (from_year_id, to_year_id))::int AS promotions`, [id]);
    const used = Object.entries(use).filter(([, n]) => n > 0);
    if (used.length) {
      return sendError(res, `${yr[0].name} is in use (${used.map(([k, n]) => `${n} ${k.replace('_', ' ')}`).join(', ')}) and cannot be deleted.`, 409, use);
    }

    await inTransaction(async (client) => {
      await client.query('DELETE FROM academic_years WHERE id = $1', [id]);
      await audit(client, req, 'academic_year.deleted', 'academic_year', id, { name: yr[0].name });
    });
    return sendSuccess(res, null, `Academic year ${yr[0].name} deleted.`);
  } catch (err) {
    return sendServerError(res, err, 'Server error.');
  }
};


// ── GET /api/academic-years/:id/stats ────────────────────────
const getYearStats = async (req, res) => {
  try {
    const { id } = req.params;

    const { rows: yr } = await db.query(
      'SELECT * FROM academic_years WHERE id = $1', [id]
    );
    if (!yr[0]) return sendError(res, 'Academic year not found.', 404);

    const { rows: byGrade } = await db.query(
      `SELECT c.grade_level,
         COUNT(DISTINCT s.id)                                   AS student_count,
         COUNT(DISTINCT s.id) FILTER(WHERE s.gender='male')    AS male,
         COUNT(DISTINCT s.id) FILTER(WHERE s.gender='female')  AS female,
         COUNT(DISTINCT c.id)                                   AS section_count
       FROM classes c
       LEFT JOIN students s ON s.class_id=c.id AND s.status='active'
       WHERE c.academic_year_id=$1
       GROUP BY c.grade_level ORDER BY c.grade_level`,
      [id]
    );

    const { rows: totals } = await db.query(
      `SELECT
         COUNT(DISTINCT s.id)                                   AS total_students,
         COUNT(DISTINCT s.id) FILTER(WHERE s.gender='male')    AS male_students,
         COUNT(DISTINCT s.id) FILTER(WHERE s.gender='female')  AS female_students,
         COUNT(DISTINCT c.id)                                   AS total_classes,
         COUNT(DISTINCT tc.teacher_id)                         AS total_teachers
       FROM classes c
       LEFT JOIN students       s  ON s.class_id=c.id AND s.status='active'
       LEFT JOIN teacher_classes tc ON tc.class_id=c.id
       WHERE c.academic_year_id=$1`,
      [id]
    );

    const { rows: examStats } = await db.query(
      `SELECT COUNT(DISTINCT e.id) AS total_exams,
         ROUND(AVG(g.score/e.max_score*100),1) AS avg_score
       FROM exams e
       LEFT JOIN grades g ON g.exam_id=e.id
       WHERE e.academic_year_id=$1`,
      [id]
    );

    const { rows: finStats } = await db.query(totalsSql('b.academic_year_id = $1'), [id]);

    return sendSuccess(res, {
      year:     yr[0],
      totals:   totals[0],
      by_grade: byGrade,
      exams:    examStats[0],
      finance:  finStats[0],
    }, `Statistics for ${yr[0].name}.`);

  } catch (err) {
    return sendServerError(res, err, 'Server error.');
  }
};


// ── GET /api/academic-years/:id/semester2-preview?semester2_start= ─
// Dry run for changing semester 2's start: which dated exams would move (nothing written),
// so the screen can confirm before saving.
const previewSemester2 = async (req, res) => {
  try {
    const { id } = req.params;
    const { semester2_start } = req.query;
    const { rows: y } = await db.query('SELECT id, name, start_date, end_date, semester2_start FROM academic_years WHERE id::text = $1', [id]);
    if (!y[0]) return sendError(res, 'Academic year not found.', 404);
    const s2Error = semester2Error(semester2_start, y[0].start_date, y[0].end_date);
    if (s2Error) return sendError(res, s2Error, 400, { field: 'semester2_start' });
    const exams = await examsMoving(db, y[0].id, semester2_start);
    return sendSuccess(res, {
      academic_year_id: y[0].id,
      current_semester2_start: y[0].semester2_start,
      semester2_start,
      exams_moved: exams.length,
      to_semester1: exams.filter((e) => e.to_semester === 'semester1').length,
      to_semester2: exams.filter((e) => e.to_semester === 'semester2').length,
      exams,
    }, `${exams.length} exam(s) would move to the other semester.`);
  } catch (err) {
    return sendServerError(res, err, 'Server error.');
  }
};


module.exports = {
  getAcademicYears, getCurrentYear, previewSemester2,
  createAcademicYear, updateAcademicYear,
  activateYear, deleteAcademicYear, getYearStats,
};
