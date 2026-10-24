// src/controllers/timetable.controller.js
// ============================================================
// Handles all timetable operations:
//   POST   /api/timetable              → create a timetable slot (admin, audited)
//   POST   /api/timetable/copy         → copy a class's timetable into an empty class (admin, audited)
//   GET    /api/timetable/conflicts    → teacher double bookings of a class's slots (?class_id=)
//   GET    /api/timetable/class/:id    → get timetable for a class
//   GET    /api/timetable/teacher/:id  → get timetable for a teacher (?academic_year_id=)
//   PUT    /api/timetable/:id          → update a slot (admin, audited; only the fields sent)
//   DELETE /api/timetable/:id          → remove a slot (admin, audited)
//   GET    /api/timetable/classes      → list all classes
// Teacher conflicts count only within one academic year (last year's slots never block).
// ============================================================

const db            = require('../config/db');
const { sendSuccess,
        sendError } = require('../utils/response');
const { sendServerError } = require('../utils/errors');
const { isUuid }          = require('../middleware/validateIds.middleware');
const { audit }           = require('../utils/audit');
const { inTransaction }   = require('../utils/transaction');

// Days and periods config
const DAYS    = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const PERIODS = [1,2,3,4,5,6,7,8];
const TIME    = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

const DAY_ORDER = `CASE t.day
           WHEN 'Monday'    THEN 1
           WHEN 'Tuesday'   THEN 2
           WHEN 'Wednesday' THEN 3
           WHEN 'Thursday'  THEN 4
           WHEN 'Friday'    THEN 5
           WHEN 'Saturday'  THEN 6
         END`;

// Conflicts for a slot of classId on day/period (excludeId: the slot being edited):
// the class already has a slot then, or the teacher already teaches then in a class of
// the same academic year. Slots of other years (last year's timetable) never block.
// Returns the 409 message or null.
const findConflict = async ({ classId, teacherId, day, period, excludeId = null }, q = db) => {
  const { rows: classConflict } = await q.query(
    `SELECT id FROM timetable
     WHERE class_id = $1 AND day = $2 AND period = $3 AND ($4::uuid IS NULL OR id <> $4)`,
    [classId, day, period, excludeId]
  );
  if (classConflict[0]) return `Conflict: This class already has a slot on ${day} period ${period}.`;
  if (!teacherId) return null;
  const { rows: teacherConflict } = await q.query(
    `SELECT c.name FROM timetable t
     JOIN classes c ON c.id = t.class_id
     WHERE t.teacher_id = $1 AND t.day = $2 AND t.period = $3 AND ($4::uuid IS NULL OR t.id <> $4)
       AND c.academic_year_id = (SELECT academic_year_id FROM classes WHERE id = $5)`,
    [teacherId, day, period, excludeId, classId]
  );
  if (teacherConflict[0]) {
    return `Teacher conflict: This teacher already has a class on ${day} period ${period} (${teacherConflict[0].name}).`;
  }
  return null;
};

// Subject and teacher of a new or changed slot: an inactive subject or a deactivated
// teacher is refused (unknown ids are left to validateBodyIds). Returns the 400 message or null.
const checkSubjectTeacher = async ({ subjectId, teacherId }) => {
  if (subjectId) {
    const { rows } = await db.query('SELECT name, is_active FROM subjects WHERE id = $1', [subjectId]);
    if (rows[0] && !rows[0].is_active) return { message: `subject_id: ${rows[0].name} is inactive.`, field: 'subject_id' };
  }
  if (teacherId) {
    const { rows } = await db.query('SELECT is_active FROM teachers WHERE id = $1', [teacherId]);
    if (rows[0] && !rows[0].is_active) return { message: 'teacher_id: this teacher is deactivated.', field: 'teacher_id' };
  }
  return null;
};

// The slot as stored, with names for the audit log
const loadSlot = async (q, id) => (await q.query(
  `SELECT t.id, t.class_id, t.subject_id, t.teacher_id, t.day, t.period,
          to_char(t.start_time, 'HH24:MI') AS start_time, to_char(t.end_time, 'HH24:MI') AS end_time, t.room,
          c.name AS class_name, s.name AS subject_name, te.first_name || ' ' || te.last_name AS teacher_name
   FROM timetable t
   JOIN classes c       ON c.id = t.class_id
   JOIN subjects s      ON s.id = t.subject_id
   LEFT JOIN teachers te ON te.id = t.teacher_id
   WHERE t.id = $1`, [id])).rows[0];

const slotSummary = (s) => ({
  class_id: s.class_id, class_name: s.class_name, day: s.day, period: s.period,
  subject_id: s.subject_id, subject_name: s.subject_name, teacher_id: s.teacher_id, teacher_name: s.teacher_name,
  start_time: s.start_time, end_time: s.end_time, room: s.room,
});

// ── POST /api/timetable ──────────────────────────────────────
// Create one timetable slot (class + subject + teacher + day + period)
const createSlot = async (req, res) => {
  try {
    const {
      class_id,
      subject_id,
      teacher_id,
      day,
      period,
      start_time,
      end_time,
      room,
    } = req.body;

    if (!class_id || !subject_id || !day || !period || !start_time || !end_time) {
      return sendError(res,
        'class_id, subject_id, day, period, start_time, end_time are required.', 400);
    }

    if (!DAYS.includes(day)) {
      return sendError(res, `day must be one of: ${DAYS.join(', ')}`, 400);
    }

    if (!PERIODS.includes(parseInt(period))) {
      return sendError(res, `period must be between 1 and 8.`, 400);
    }
    if (!TIME.test(start_time) || !TIME.test(end_time)) return sendError(res, 'start_time and end_time must be HH:MM.', 400);
    if (end_time <= start_time) return sendError(res, 'end_time must be after start_time.', 400);

    const bad = await checkSubjectTeacher({ subjectId: subject_id, teacherId: teacher_id });
    if (bad) return sendError(res, bad.message, 400, { field: bad.field });

    // Same class, or same teacher in the same academic year, at that day and period
    const conflict = await findConflict({ classId: class_id, teacherId: teacher_id, day, period: parseInt(period) });
    if (conflict) return sendError(res, conflict, 409);

    const slot = await inTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO timetable
           (class_id, subject_id, teacher_id, day, period, start_time, end_time, room)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING *`,
        [
          class_id, subject_id,
          teacher_id || null,
          day, parseInt(period),
          start_time, end_time,
          room?.trim() || null,
        ]
      );
      await audit(client, req, 'timetable.slot_created', 'timetable', rows[0].id, slotSummary(await loadSlot(client, rows[0].id)));
      return rows[0];
    });

    return sendSuccess(res, slot, `Timetable slot created for ${day} period ${period}.`, 201);

  } catch (err) {
    if (err.code === '23505') return sendError(res, 'Conflict: This class already has a slot then.', 409);
    return sendServerError(res, err, 'Server error while creating timetable slot.');
  }
};


// ── POST /api/timetable/copy ─────────────────────────────────
// { from_class_id, to_class_id }: copies every slot (subject, day, period, times, room) of
// one class into another class that has no slots yet, in one transaction. The teacher of a slot:
//   - same academic year: the target class's teacher of that subject (teacher_classes), when
//     active and free then (with several, the first free one by name);
//   - another year (last year's class): the slot's own teacher, when active and free then
//     in the target class's year.
// Otherwise the slot is copied without a teacher. Slots of inactive subjects are not copied.
// Both are reported.
const copyTimetable = async (req, res) => {
  try {
    const { from_class_id, to_class_id } = req.body || {};
    if (!from_class_id || !to_class_id) return sendError(res, 'from_class_id and to_class_id are required.', 400);
    if (from_class_id === to_class_id) return sendError(res, 'Choose a different class to copy into.', 400, { field: 'to_class_id' });

    const result = await inTransaction(async (client) => {
      // Lock the target class: two copies into it at the same moment run one after the other
      const target = (await client.query('SELECT id, name, academic_year_id FROM classes WHERE id = $1 FOR UPDATE', [to_class_id])).rows[0];
      const source = (await client.query('SELECT id, name, academic_year_id FROM classes WHERE id = $1', [from_class_id])).rows[0];
      const sameYear = source.academic_year_id === target.academic_year_id;
      const { rows: existing } = await client.query('SELECT COUNT(*)::int AS n FROM timetable WHERE class_id = $1', [to_class_id]);
      if (existing[0].n > 0) return { status: 409, message: `${target.name} already has ${existing[0].n} slot(s). Copy only into a class without a timetable.` };

      const { rows: slots } = await client.query(
        `SELECT t.day, t.period, t.start_time, t.end_time, t.room, t.subject_id, t.teacher_id,
                s.name AS subject_name, s.is_active AS subject_active,
                te.first_name || ' ' || te.last_name AS teacher_name, te.is_active AS teacher_active
         FROM timetable t
         JOIN subjects s ON s.id = t.subject_id
         LEFT JOIN teachers te ON te.id = t.teacher_id
         WHERE t.class_id = $1
         ORDER BY ${DAY_ORDER}, t.period`, [from_class_id]);
      if (!slots.length) return { status: 400, message: `${source.name} has no timetable to copy.` };

      // The class that teacher teaches at that day and period in the target's year, or null
      const busyIn = async (teacherId, day, period) => (await client.query(
        `SELECT c.name FROM timetable t JOIN classes c ON c.id = t.class_id
         WHERE t.teacher_id = $1 AND t.day = $2 AND t.period = $3 AND c.academic_year_id = $4`,
        [teacherId, day, period, target.academic_year_id])).rows[0]?.name ?? null;
      // Same year: the target class's teachers per subject (active ones, by name)
      const assigned = new Map();
      if (sameYear) {
        const { rows } = await client.query(
          `SELECT tc.subject_id, te.id, te.first_name || ' ' || te.last_name AS name, te.is_active
           FROM teacher_classes tc JOIN teachers te ON te.id = tc.teacher_id
           WHERE tc.class_id = $1 ORDER BY te.first_name, te.last_name`, [to_class_id]);
        for (const r of rows) assigned.set(r.subject_id, [...(assigned.get(r.subject_id) ?? []), r]);
      }

      const skippedSlots = [], teachersSkipped = [];
      let copied = 0, withTeacher = 0;
      for (const s of slots) {
        const where = { day: s.day, period: s.period, subject_name: s.subject_name };
        if (!s.subject_active) { skippedSlots.push({ ...where, teacher_name: s.teacher_name ?? null, reason: 'subject_inactive' }); continue; }
        let teacherId = null;
        if (sameYear) {
          const candidates = assigned.get(s.subject_id) ?? [];
          const active = candidates.filter((c) => c.is_active);
          if (!candidates.length) teachersSkipped.push({ ...where, teacher_name: null, reason: 'no_assignment' });
          else if (!active.length) teachersSkipped.push({ ...where, teacher_name: candidates[0].name, reason: 'teacher_inactive' });
          else {
            let firstClash = null;
            for (const c of active) {
              const busy = await busyIn(c.id, s.day, s.period);
              if (!busy) { teacherId = c.id; break; }
              firstClash ??= { teacher_name: c.name, clash_class_name: busy };
            }
            if (!teacherId) teachersSkipped.push({ ...where, ...firstClash, reason: 'teacher_clash' });
          }
        } else if (s.teacher_id) {
          if (!s.teacher_active) teachersSkipped.push({ ...where, teacher_name: s.teacher_name, reason: 'teacher_inactive' });
          else {
            const busy = await busyIn(s.teacher_id, s.day, s.period);
            if (busy) teachersSkipped.push({ ...where, teacher_name: s.teacher_name, reason: 'teacher_clash', clash_class_name: busy });
            else teacherId = s.teacher_id;
          }
        }
        if (teacherId) withTeacher++;
        await client.query(
          `INSERT INTO timetable (class_id, subject_id, teacher_id, day, period, start_time, end_time, room)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [to_class_id, s.subject_id, teacherId, s.day, s.period, s.start_time, s.end_time, s.room]);
        copied++;
      }
      const report = {
        from_class_id, from_class_name: source.name, to_class_id, to_class_name: target.name, same_year: sameYear,
        copied, with_teacher: withTeacher, skipped_slots: skippedSlots, teachers_skipped: teachersSkipped,
      };
      await audit(client, req, 'timetable.copied', 'class', to_class_id, report);
      return { status: 201, report };
    });
    if (result.status !== 201) return sendError(res, result.message, result.status);
    const r = result.report;
    return sendSuccess(res, r, `${r.copied} slot(s) copied from ${r.from_class_name} to ${r.to_class_name}.`, 201);
  } catch (err) {
    if (err.code === '23505') return sendError(res, 'The target class got slots while copying. Try again.', 409);
    return sendServerError(res, err, 'Server error while copying the timetable.');
  }
};


// ── GET /api/timetable/conflicts?class_id= ───────────────────
// Slots of the class whose teacher also teaches another class of the same year at the same
// day and period (data from before the conflict checks, or the old screens).
const getConflicts = async (req, res) => {
  try {
    const { class_id } = req.query;
    if (!class_id || !isUuid(class_id)) return sendError(res, 'class_id does not exist.', 400, { field: 'class_id' });
    const cls = (await db.query('SELECT id, academic_year_id FROM classes WHERE id = $1', [class_id])).rows[0];
    if (!cls) return sendError(res, 'class_id does not exist.', 400, { field: 'class_id' });
    const { rows } = await db.query(
      `SELECT t.id AS slot_id, t.day, t.period, t.teacher_id,
              te.first_name || ' ' || te.last_name AS teacher_name,
              o.id AS other_slot_id, oc.id AS other_class_id, oc.name AS other_class_name
       FROM timetable t
       JOIN teachers te  ON te.id = t.teacher_id
       JOIN timetable o  ON o.teacher_id = t.teacher_id AND o.day = t.day AND o.period = t.period AND o.id <> t.id
       JOIN classes oc   ON oc.id = o.class_id AND oc.academic_year_id = $2
       WHERE t.class_id = $1
       ORDER BY ${DAY_ORDER}, t.period, oc.grade_level, oc.section`, [class_id, cls.academic_year_id]);
    return sendSuccess(res, rows, `${rows.length} conflict(s).`);
  } catch (err) {
    return sendServerError(res, err, 'Server error.');
  }
};


// ── GET /api/timetable/class/:classId ────────────────────────
// Get full weekly timetable for a class — organized by day.
const getClassTimetable = async (req, res) => {
  try {
    const { classId } = req.params;

    // Get class info first
    const { rows: classRows } = await db.query(
      `SELECT c.*, ay.name AS academic_year
       FROM classes c
       LEFT JOIN academic_years ay ON ay.id = c.academic_year_id
       WHERE c.id = $1`,
      [classId]
    );

    if (!classRows[0]) {
      return sendError(res, 'Class not found.', 404);
    }

    // Get all timetable slots for this class
    const { rows } = await db.query(
      `SELECT
         t.id, t.day, t.period, t.start_time, t.end_time, t.room,
         t.subject_id,
         s.name  AS subject_name,
         s.name_am AS subject_name_am,
         s.code  AS subject_code,
         te.first_name || ' ' || te.last_name AS teacher_name,
         te.first_name_am AS teacher_first_name_am,
         te.last_name_am  AS teacher_last_name_am,
         te.id   AS teacher_id
       FROM timetable t
       LEFT JOIN subjects s  ON s.id  = t.subject_id
       LEFT JOIN teachers te ON te.id = t.teacher_id
       WHERE t.class_id = $1
       ORDER BY ${DAY_ORDER}, t.period`,
      [classId]
    );

    // Organize by day
    const byDay = {};
    DAYS.forEach(d => { byDay[d] = []; });
    rows.forEach(slot => {
      if (byDay[slot.day]) byDay[slot.day].push(slot);
    });

    return sendSuccess(res, {
      class:    classRows[0],
      total_slots: rows.length,
      by_day:   byDay,
      all_slots: rows,
    }, `Timetable for ${classRows[0].name}.`);

  } catch (err) {
    return sendServerError(res, err, 'Server error while fetching timetable.');
  }
};


// ── GET /api/timetable/teacher/:teacherId ────────────────────
// Get a teacher's full weekly schedule; ?academic_year_id= for one year only.
const getTeacherTimetable = async (req, res) => {
  try {
    const { teacherId } = req.params;
    const { academic_year_id } = req.query;
    if (academic_year_id && !isUuid(academic_year_id)) {
      return sendError(res, 'academic_year_id does not exist.', 400, { field: 'academic_year_id' });
    }

    const { rows } = await db.query(
      `SELECT
         t.id, t.day, t.period, t.start_time, t.end_time, t.room,
         s.name  AS subject_name,
         s.name_am AS subject_name_am,
         t.class_id, c.academic_year_id,
         c.name  AS class_name,
         c.grade_level, c.section
       FROM timetable t
       LEFT JOIN subjects s ON s.id = t.subject_id
       LEFT JOIN classes  c ON c.id = t.class_id
       WHERE t.teacher_id = $1 AND ($2::uuid IS NULL OR c.academic_year_id = $2)
       ORDER BY ${DAY_ORDER}, t.period`,
      [teacherId, academic_year_id || null]
    );

    // Organize by day
    const byDay = {};
    DAYS.forEach(d => { byDay[d] = []; });
    rows.forEach(slot => {
      if (byDay[slot.day]) byDay[slot.day].push(slot);
    });

    return sendSuccess(res, {
      total_slots: rows.length,
      by_day:      byDay,
      all_slots:   rows,
    }, `Teacher schedule loaded.`);

  } catch (err) {
    return sendServerError(res, err, 'Server error.');
  }
};


// ── PUT /api/timetable/:id ───────────────────────────────────
// Only the fields sent change; teacher_id null removes the teacher, room null or "" clears it.
const updateSlot = async (req, res) => {
  try {
    const { id } = req.params;
    const b = req.body || {};
    const { subject_id, day, period, start_time, end_time } = b;

    const cur = await loadSlot(db, id);
    if (!cur) return sendError(res, 'Slot not found.', 404);
    if (subject_id === null) return sendError(res, 'subject_id is required.', 400, { field: 'subject_id' });
    if (day && !DAYS.includes(day)) {
      return sendError(res, `day must be one of: ${DAYS.join(', ')}`, 400);
    }
    if (period && !PERIODS.includes(parseInt(period))) {
      return sendError(res, `period must be between 1 and 8.`, 400);
    }
    if ((start_time !== undefined && !TIME.test(start_time)) || (end_time !== undefined && !TIME.test(end_time))) {
      return sendError(res, 'start_time and end_time must be HH:MM.', 400);
    }
    const next = {
      subject_id: subject_id ?? cur.subject_id,
      teacher_id: b.teacher_id !== undefined ? (b.teacher_id || null) : cur.teacher_id,
      day: day || cur.day,
      period: period ? parseInt(period) : cur.period,
      start_time: start_time?.slice(0, 5) ?? cur.start_time,
      end_time: end_time?.slice(0, 5) ?? cur.end_time,
      room: b.room !== undefined ? (b.room?.trim() || null) : cur.room,
    };
    if (next.end_time <= next.start_time) return sendError(res, 'end_time must be after start_time.', 400);

    const bad = await checkSubjectTeacher({
      subjectId: next.subject_id !== cur.subject_id ? next.subject_id : null,
      teacherId: next.teacher_id !== cur.teacher_id ? next.teacher_id : null,
    });
    if (bad) return sendError(res, bad.message, 400, { field: bad.field });

    // The slot as it will be, checked like a new one (itself excluded). The teacher is checked
    // only when the teacher, day or period changes: a slot that already clashes (old data) can
    // still get another room or times; the conflicts list shows the clash until it is resolved.
    const moved = next.teacher_id !== cur.teacher_id || next.day !== cur.day || next.period !== cur.period;
    const conflict = await findConflict({
      classId: cur.class_id, teacherId: moved ? next.teacher_id : null, day: next.day, period: next.period, excludeId: id,
    });
    if (conflict) return sendError(res, conflict, 409);

    const updated = await inTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE timetable SET subject_id = $1, teacher_id = $2, day = $3, period = $4,
                start_time = $5, end_time = $6, room = $7
         WHERE id = $8 RETURNING *`,
        [next.subject_id, next.teacher_id, next.day, next.period, next.start_time, next.end_time, next.room, id]);
      const after = await loadSlot(client, id);
      await audit(client, req, 'timetable.slot_updated', 'timetable', id, { ...slotSummary(after), old: slotSummary(cur) });
      return rows[0];
    });
    return sendSuccess(res, updated, 'Timetable slot updated.');

  } catch (err) {
    if (err.code === '23505') return sendError(res, 'Conflict: This class already has a slot then.', 409);
    return sendServerError(res, err, 'Server error.');
  }
};


// ── DELETE /api/timetable/:id ────────────────────────────────
const deleteSlot = async (req, res) => {
  try {
    const { id } = req.params;
    const removed = await inTransaction(async (client) => {
      const slot = await loadSlot(client, id);
      if (!slot) return null;
      await client.query('DELETE FROM timetable WHERE id = $1', [id]);
      await audit(client, req, 'timetable.slot_deleted', 'timetable', id, slotSummary(slot));
      return slot;
    });
    if (!removed) return sendError(res, 'Slot not found.', 404);
    return sendSuccess(res, null, 'Timetable slot removed.');
  } catch (err) {
    return sendServerError(res, err, 'Server error.');
  }
};


// ── GET /api/timetable/classes ───────────────────────────────
// List all classes (for dropdown in timetable builder)
// The classes of the current year by default, so class pickers don't show
// last year's "Grade 9 Section A" next to this year's (M7a). ?academic_year_id=
// for another year, ?all=true for every year.
const getClasses = async (req, res) => {
  try {
    const { academic_year_id, all } = req.query;
    if (academic_year_id && !isUuid(academic_year_id)) {
      return sendError(res, 'academic_year_id does not exist.', 400, { field: 'academic_year_id' });
    }
    const where = all === 'true' ? '' : academic_year_id
      ? 'WHERE c.academic_year_id = $1'
      : 'WHERE c.academic_year_id = (SELECT id FROM academic_years WHERE is_current)';
    const { rows } = await db.query(
      `SELECT c.id, c.name, c.grade_level, c.section, c.academic_year_id,
              t.first_name || ' ' || t.last_name AS homeroom_teacher
       FROM classes c
       LEFT JOIN teachers t ON t.id = c.homeroom_teacher_id
       ${where}
       ORDER BY c.grade_level, c.section`,
      all !== 'true' && academic_year_id ? [academic_year_id] : []
    );
    return sendSuccess(res, rows, `${rows.length} class(es) found.`);
  } catch (err) {
    return sendServerError(res, err, 'Server error.');
  }
};


// ── GET /api/timetable/subjects ──────────────────────────────
// Every subject with is_active; pickers leave out the inactive ones (M7)
const getSubjects = async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, name, name_am, code, is_active FROM subjects ORDER BY name'
    );
    return sendSuccess(res, rows, `${rows.length} subject(s) found.`);
  } catch (err) {
    return sendServerError(res, err, 'Server error.');
  }
};


module.exports = {
  createSlot,
  copyTimetable,
  getConflicts,
  getClassTimetable,
  getTeacherTimetable,
  updateSlot,
  deleteSlot,
  getClasses,
  getSubjects,
};
