// src/controllers/academicYear.controller.js
// ============================================================
// Handles all academic year operations:
//   GET  /api/academic-years           → list all years
//   GET  /api/academic-years/current   → get current year
//   POST /api/academic-years           → create new year
//   PUT  /api/academic-years/:id       → update year
//   POST /api/academic-years/:id/activate → set as current
//   GET  /api/academic-years/:id/stats → year statistics
//   POST /api/academic-years/:id/promote → promote students
// ============================================================

const db            = require('../config/db');
const { sendSuccess,
        sendError } = require('../utils/response');
const { sendServerError } = require('../utils/errors');
const { setUserActive } = require('../utils/sessions');


// ── GET /api/academic-years ───────────────────────────────────
const getAcademicYears = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT ay.*,
         COUNT(DISTINCT c.id) AS class_count,
         COUNT(DISTINCT s.id) AS student_count
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

    if (!/^\d{4}\/\d{4}$/.test(name)) {
      return sendError(res, 'name must be in format YYYY/YYYY (e.g. 2025/2026).', 400);
    }

    const { rows: existing } = await db.query(
      'SELECT id FROM academic_years WHERE name = $1', [name]
    );
    if (existing[0]) return sendError(res, `Year ${name} already exists.`, 409);

    const { rows } = await db.query(
      `INSERT INTO academic_years (name, start_date, end_date, is_current)
       VALUES ($1,$2,$3,FALSE) RETURNING *`,
      [name, start_date, end_date]
    );

    return sendSuccess(res, rows[0], `Academic year ${name} created.`, 201);

  } catch (err) {
    return sendServerError(res, err, 'Server error.');
  }
};


// ── PUT /api/academic-years/:id ───────────────────────────────
const updateAcademicYear = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, start_date, end_date } = req.body;

    const { rows } = await db.query(
      `UPDATE academic_years SET
         name       = COALESCE($1, name),
         start_date = COALESCE($2, start_date),
         end_date   = COALESCE($3, end_date)
       WHERE id = $4 RETURNING *`,
      [name, start_date, end_date, id]
    );
    if (!rows[0]) return sendError(res, 'Academic year not found.', 404);
    return sendSuccess(res, rows[0], 'Academic year updated.');
  } catch (err) {
    return sendServerError(res, err, 'Server error.');
  }
};


// ── POST /api/academic-years/:id/activate ────────────────────
const activateYear = async (req, res) => {
  const client = await db.pool.connect();
  try {
    const { id } = req.params;

    const { rows: yearRows } = await db.query(
      'SELECT * FROM academic_years WHERE id = $1', [id]
    );
    if (!yearRows[0]) return sendError(res, 'Academic year not found.', 404);
    if (yearRows[0].is_current) {
      return sendError(res, `${yearRows[0].name} is already active.`, 400);
    }

    await client.query('BEGIN');
    await client.query('UPDATE academic_years SET is_current = FALSE');
    const { rows } = await client.query(
      'UPDATE academic_years SET is_current = TRUE WHERE id = $1 RETURNING *', [id]
    );
    await client.query('COMMIT');

    await db.query(
      `INSERT INTO audit_logs (user_id, action, target_type, target_id)
       VALUES ($1,'academic_year.activated','academic_year',$2)`,
      [req.user.id, id]
    );

    return sendSuccess(res, rows[0], `${rows[0].name} is now the active academic year.`);

  } catch (err) {
    await client.query('ROLLBACK');
    return sendServerError(res, err, 'Server error.');
  } finally {
    client.release();
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

    const { rows: finStats } = await db.query(
      `SELECT
         COALESCE(SUM(amount_due),0)  AS total_expected,
         COALESCE(SUM(amount_paid),0) AS total_collected,
         ROUND(COALESCE(SUM(amount_paid),0)*100/
           NULLIF(COALESCE(SUM(amount_due),0),0),1) AS collection_rate
       FROM payments WHERE academic_year_id=$1`,
      [id]
    );

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


// ── POST /api/academic-years/:id/promote ─────────────────────
// Promote students from one year to the next.
const promoteStudents = async (req, res) => {
  const client = await db.pool.connect();
  try {
    const { id }         = req.params; // target NEW year id
    const { from_year_id, grade_levels } = req.body;

    if (!from_year_id) {
      return sendError(res, 'from_year_id is required.', 400);
    }

    const { rows: toYear }   = await db.query(
      'SELECT * FROM academic_years WHERE id=$1', [id]
    );
    const { rows: fromYear } = await db.query(
      'SELECT * FROM academic_years WHERE id=$1', [from_year_id]
    );
    if (!toYear[0] || !fromYear[0]) {
      return sendError(res, 'One or both academic years not found.', 404);
    }

    await client.query('BEGIN');

    const grades   = grade_levels || [7,8,9,10,11,12];
    let   promoted = 0;
    let   graduated= 0;
    const results  = [];

    for (const grade of grades) {
      const { rows: fromClasses } = await client.query(
        `SELECT c.*, ARRAY_AGG(s.id) FILTER(WHERE s.id IS NOT NULL) AS student_ids
         FROM classes c
         LEFT JOIN students s ON s.class_id=c.id AND s.status='active'
         WHERE c.academic_year_id=$1 AND c.grade_level=$2
         GROUP BY c.id`,
        [from_year_id, grade]
      );

      for (const fc of fromClasses) {
        const ids = fc.student_ids || [];
        if (ids.length === 0) continue;

        if (grade >= 12) {
          // Graduate grade 12
          const { rows: gradUsers } = await client.query(
            `UPDATE students SET status='graduated', updated_at=NOW()
             WHERE id=ANY($1) RETURNING user_id`, [ids]
          );
          // Graduated students lose login access, like any non-active student
          for (const { user_id } of gradUsers) {
            await setUserActive(user_id, false, client);
          }
          graduated += ids.length;
          results.push({ from:`Grade ${grade} ${fc.section}`, action:'graduated', count:ids.length });
          continue;
        }

        const nextGrade = grade + 1;

        // Find or create target class
        let { rows: toClasses } = await client.query(
          `SELECT id FROM classes
           WHERE academic_year_id=$1 AND grade_level=$2 AND section=$3`,
          [id, nextGrade, fc.section]
        );

        let toClassId;
        if (toClasses[0]) {
          toClassId = toClasses[0].id;
        } else {
          const { rows: nc } = await client.query(
            `INSERT INTO classes (academic_year_id, name, grade_level, section, capacity)
             VALUES ($1,$2,$3,$4,$5) RETURNING id`,
            [id, `Grade ${nextGrade} Section ${fc.section}`, nextGrade, fc.section, fc.capacity||45]
          );
          toClassId = nc[0].id;
        }

        await client.query(
          `UPDATE students SET class_id=$1, updated_at=NOW() WHERE id=ANY($2)`,
          [toClassId, ids]
        );

        promoted += ids.length;
        results.push({
          from:`Grade ${grade} ${fc.section}`,
          to:`Grade ${nextGrade} ${fc.section}`,
          action:'promoted', count:ids.length,
        });
      }
    }

    await client.query('COMMIT');

    await db.query(
      `INSERT INTO audit_logs (user_id,action,target_type,target_id,new_data)
       VALUES ($1,'students.promoted','academic_year',$2,$3)`,
      [req.user.id, id, JSON.stringify({ promoted, graduated })]
    );

    return sendSuccess(res, { promoted, graduated, results },
      `${promoted} students promoted. ${graduated} graduated.`);

  } catch (err) {
    await client.query('ROLLBACK');
    return sendServerError(res, err, 'Server error during promotion.');
  } finally {
    client.release();
  }
};


module.exports = {
  getAcademicYears, getCurrentYear,
  createAcademicYear, updateAcademicYear,
  activateYear, getYearStats, promoteStudents,
};
