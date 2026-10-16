// src/controllers/grade.controller.js
// Exams and scores. Results (subject scores out of 100, totals, averages, ranks; no letters
// or GPA since M5a, B2) come from services/results.service.js.

const db            = require('../config/db');
const { sendSuccess, sendError } = require('../utils/response');
const { sendServerError } = require('../utils/errors');
const { scopeCondition } = require('../utils/scope');
const { createExam: createExamService, ExamError } = require('../services/exam.service');
const { rateSql } = require('../utils/attendance');
const RATE   = rateSql();   // attendance rate (M4): late attended, excused left out

const { semesterFilter } = require('../utils/semesters');
const { studentResults, ResultsError } = require('../services/results.service');
const { LockedError, assertSemesterUnlocked, findLock } = require('../services/locks.service');
const { inTransaction } = require('../utils/transaction');
const { audit } = require('../utils/audit');

// Helper: teacher id if this user teaches subjectId in classId (teacher_classes), else null
const getAssignedTeacherId = async (userId, classId, subjectId) => {
  const { rows } = await db.query(
    `SELECT t.id FROM teachers t
     JOIN teacher_classes tc ON tc.teacher_id = t.id
     WHERE t.user_id = $1 AND tc.class_id::text = $2 AND tc.subject_id::text = $3`,
    [userId, String(classId), String(subjectId)]
  );
  return rows[0]?.id || null;
};

const NOT_ASSIGNED = 'Access denied. You are not assigned to teach this subject in this class.';

// POST /api/grades/exams — Create exam
const createExam = async (req, res) => {
  // Deprecated alias of POST /api/exam-schedule (same rules, date optional).
  // Kept while the current HTML frontend (grades.html) still calls it.
  res.set('Deprecation', 'true');
  res.set('Link', '</api/exam-schedule>; rel="successor-version"');
  try {
    const { exam } = await createExamService(req.user, req.body, { requireDate: false });
    return sendSuccess(res, exam, `Exam "${exam.name}" created successfully.`, 201);
  } catch (err) {
    if (err instanceof ExamError) return sendError(res, err.message, err.status, err.errors);
    return sendServerError(res, err, 'Server error.');
  }
};

// GET /api/grades/exams — List exams
const getExams = async (req, res) => {
  try {
    const { class_id, subject_id } = req.query;
    const sf = semesterFilter(req.query);
    if (sf.error) return sendError(res, sf.error, 400, { field: 'semester' });
    const conditions = []; const params = []; let idx = 1;
    if (class_id)   { conditions.push(`e.class_id=$${idx++}`);   params.push(class_id); }
    if (sf.semester) { conditions.push(`e.semester=$${idx++}`);   params.push(sf.semester); }
    if (subject_id) { conditions.push(`e.subject_id=$${idx++}`);  params.push(subject_id); }
    // Teachers only see exams of their own classes
    const scoped = await scopeCondition(req.user, 'e.class_id', params);
    if (scoped) { conditions.push(scoped); idx = params.length + 1; }
    const where = conditions.length ? 'WHERE '+conditions.join(' AND ') : '';

    const { rows } = await db.query(
      `SELECT e.*,
         c.name AS class_name, c.grade_level,
         s.name AS subject_name, s.code AS subject_code,
         COUNT(g.id) AS grades_entered
       FROM exams e
       LEFT JOIN classes  c ON c.id=e.class_id
       LEFT JOIN subjects s ON s.id=e.subject_id
       LEFT JOIN grades   g ON g.exam_id=e.id
       ${where}
       GROUP BY e.id, c.name, c.grade_level, s.name, s.code
       ORDER BY e.created_at DESC`,
      params
    );
    return sendSuccess(res, rows, `Found ${rows.length} exam(s).`);
  } catch (err) {
    return sendServerError(res, err, 'Server error.');
  }
};

// POST /api/grades — Enter grades for an exam
// A row { student_id, clear: true } removes a saved score (M5b): the result becomes incomplete.
// Cleared scores are audited (grades.score_cleared) with their old values.
const enterGrades = async (req, res) => {
  try {
    const { exam_id, grades } = req.body;
    if (!exam_id || !grades || !Array.isArray(grades)) {
      return sendError(res, 'exam_id and grades array are required.', 400);
    }

    // Get exam to calculate grade letters
    const { rows: examRows } = await db.query(
      'SELECT * FROM exams WHERE id=$1', [exam_id]
    );
    if (!examRows[0]) return sendError(res, 'Exam not found.', 404);
    const exam = examRows[0];

    // Every score must be a number between 0 and the exam's max_score.
    // Checked up front so an invalid row never leaves a half-saved batch.
    const maxScore = parseFloat(exam.max_score);
    const invalid = grades
      .filter(g => g.student_id && g.score !== undefined && g.score !== null)
      .filter(g => { const n = Number(g.score); return !Number.isFinite(n) || n < 0 || n > maxScore; })
      .map(g => ({ student_id: g.student_id, score: g.score }));
    if (invalid.length) {
      return sendError(res, `Scores must be numbers between 0 and ${maxScore}.`, 400,
        { invalid });
    }
    const both = grades.filter(g => g.clear === true && g.score !== undefined && g.score !== null)
      .map(g => g.student_id);
    if (both.length) {
      return sendError(res, 'A row cannot both clear and set a score.', 400, { student_ids: both });
    }

    // Teachers: only exams for their own class+subject, and only students in that class
    if (req.user.role === 'teacher') {
      const teacherId = await getAssignedTeacherId(req.user.id, exam.class_id, exam.subject_id);
      if (!teacherId) return sendError(res, NOT_ASSIGNED, 403);

      const ids = grades.filter(g => g.student_id).map(g => String(g.student_id));
      const { rows: inClass } = await db.query(
        'SELECT id FROM students WHERE class_id = $1 AND id::text = ANY($2)',
        [exam.class_id, ids]
      );
      const allowed = new Set(inClass.map(r => r.id));
      const outside = ids.filter(id => !allowed.has(id));
      if (outside.length) {
        return sendError(res, "Some students are not in this exam's class.", 403,
          { student_ids: outside });
      }
    }

    // D29: no score changes in a locked semester
    const { rows: ec } = await db.query('SELECT name, academic_year_id FROM classes WHERE id = $1', [exam.class_id]);
    await assertSemesterUnlocked(db, { classId: exam.class_id, yearId: ec[0].academic_year_id, semester: exam.semester, className: ec[0].name });

    const { saved, cleared } = await inTransaction(async (client) => {
      let saved = 0;
      const cleared = [];
      for (const g of grades) {
        if (!g.student_id) continue;
        if (g.clear === true) {
          const { rows } = await client.query(
            'DELETE FROM grades WHERE exam_id = $1 AND student_id = $2 RETURNING student_id, score',
            [exam_id, g.student_id]
          );
          if (rows[0]) cleared.push({ student_id: rows[0].student_id, score: Number(rows[0].score) });
        } else if (g.score !== undefined && g.score !== null) {
          await client.query(
            `INSERT INTO grades (exam_id, student_id, score, remarks)
             VALUES ($1,$2,$3,$4)
             ON CONFLICT (exam_id, student_id)
             DO UPDATE SET score=$3, grade_letter=NULL, remarks=$4, entered_at=NOW()`,
            [exam_id, g.student_id, parseFloat(g.score), g.remarks || null]
          );
          saved++;
        }
      }
      if (cleared.length) await audit(client, req, 'grades.score_cleared', 'exam', exam_id, { cleared });
      return { saved, cleared: cleared.length };
    });

    return sendSuccess(res, { total_graded: saved, cleared },
      `Grades saved for ${saved} student(s)${cleared ? `, ${cleared} cleared` : ''}.`);

  } catch (err) {
    if (err instanceof LockedError) return sendError(res, err.message, err.status, err.errors);
    return sendServerError(res, err, 'Server error.');
  }
};

// GET /api/grades/exams/:examId — one exam with the scores entered so far (G1)
// Admin, principal: any exam. Teacher: own class + subject.
const getExamGrades = async (req, res) => {
  try {
    const { rows: ex } = await db.query(
      `SELECT e.*, c.name AS class_name, c.grade_level, c.section, c.academic_year_id AS class_year_id,
              s.name AS subject_name, s.name_am AS subject_name_am
       FROM exams e JOIN classes c ON c.id = e.class_id JOIN subjects s ON s.id = e.subject_id WHERE e.id = $1`, [req.params.examId]);
    if (!ex[0]) return sendError(res, 'Exam not found.', 404);
    if (req.user.role === 'teacher' && !(await getAssignedTeacherId(req.user.id, ex[0].class_id, ex[0].subject_id))) {
      return sendError(res, NOT_ASSIGNED, 403);
    }
    const { rows: grades } = await db.query(
      `SELECT g.id, g.student_id, g.score, g.remarks, g.entered_at, g.updated_at,
              s.student_number, s.first_name, s.fathers_name, s.last_name, s.first_name_am, s.fathers_name_am, s.last_name_am
       FROM grades g JOIN students s ON s.id = g.student_id WHERE g.exam_id = $1
       ORDER BY s.first_name, s.last_name`, [ex[0].id]);
    // The roster for score entry (M5b): the class's active students and anyone with a score
    // here (moved or archived since: in_class false, their score can no longer be changed by a teacher)
    const { rows: students } = await db.query(
      `SELECT s.id AS student_id, s.student_number, s.first_name, s.fathers_name, s.last_name,
              s.first_name_am, s.fathers_name_am, s.last_name_am, s.status,
              (s.class_id = $2) AS in_class, g.score, g.remarks, g.updated_at
       FROM students s LEFT JOIN grades g ON g.student_id = s.id AND g.exam_id = $1
       WHERE (s.class_id = $2 AND s.status = 'active') OR g.id IS NOT NULL
       ORDER BY s.first_name, s.fathers_name, s.last_name`, [ex[0].id, ex[0].class_id]);
    const { grade_letter: _gl, class_year_id, ...exam } = ex[0];
    const lock = await findLock(db, { yearId: class_year_id, semester: exam.semester, classId: exam.class_id });
    exam.locked = !!lock;   // M5b: score entry is read-only while the semester is locked (D29)
    return sendSuccess(res, { exam, grades, students }, `${grades.length} score(s) entered.`);
  } catch (err) {
    return sendServerError(res, err, 'Server error.');
  }
};

// GET /api/grades/report-card/:studentId?semester=1|2&academic_year_id=
const PROMOTION_LABEL = { promoted: 'Promoted', not_promoted: 'Not promoted', pending: 'Promotion pending' };
const getReportCard = async (req, res) => {
  try {
    const { studentId } = req.params;
    const sf = semesterFilter(req.query);
    if (sf.error) return sendError(res, sf.error, 400, { field: 'semester' });

    const { rows: stuRows } = await db.query(
      `SELECT s.*, c.name AS class_name, c.grade_level, c.section,
              ay.name AS academic_year
       FROM students s
       LEFT JOIN classes c ON c.id=s.class_id
       LEFT JOIN academic_years ay ON ay.id=c.academic_year_id
       WHERE s.id=$1`, [studentId]
    );
    if (!stuRows[0]) return sendError(res, 'Student not found.', 404);

    let results = null;
    try {
      results = await studentResults(studentId, req.query.academic_year_id);
    } catch (err) {
      if (!(err instanceof ResultsError) || err.status !== 404) throw err;   // no class / no results yet
    }
    const sem = results && sf.semester ? results.semesters[sf.semester] : null;
    const rows = !results ? [] : sem ? sem.subjects : results.year.subjects;
    const subjects = rows.map((x) => ({
      subject: x.name, subject_am: x.name_am, score: x.score,
      max_entered: x.max_total ?? null, complete: x.complete ?? null,
      average: x.score === null ? null : Number(x.score).toFixed(1),   // the subject score is out of 100
      grade_letter: '—', grade_points: null,
    }));
    const part = sem || results?.year;
    const promotion = !sem ? results?.year.promotion : null;

    const { rows: att } = await db.query(
      `SELECT COUNT(*) AS total_days,
              COUNT(*) FILTER(WHERE status='present') AS present,
              COUNT(*) FILTER(WHERE status='absent')  AS absent,
              COUNT(*) FILTER(WHERE status='late')    AS late,
              ${RATE} AS rate
       FROM attendance WHERE student_id=$1`, [studentId]
    );

    return sendSuccess(res, {
      student: stuRows[0],
      subjects,
      academic_summary: {
        gpa: '—',
        average: part?.average ?? null,
        rank: part?.rank ?? null,
        total_in_class: part?.ranked_count ?? null,
        result: promotion ? PROMOTION_LABEL[promotion.status] : '—',
      },
      attendance: att[0],
      results,
    }, 'Report card retrieved.');

  } catch (err) {
    return sendServerError(res, err, 'Server error.');
  }
};

module.exports = { createExam, getExams, getExamGrades, enterGrades, getReportCard };
