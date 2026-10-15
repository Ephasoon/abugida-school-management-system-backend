// src/controllers/promotion.controller.js
// ============================================================
// Safe promotion (M7a), into the academic year :id from from_year_id:
//   POST /api/academic-years/:id/promotion-preview { from_year_id, exclude? }
//        → the plan per student, nothing written
//   POST /api/academic-years/:id/promote { from_year_id, exclude?, confirm_count }
//        → applies it: one transaction, audited, at most once per source year
// exclude: students who repeat the grade. confirm_count: the number of
// students the preview showed; a different number now means the list changed.
// ============================================================

const { sendSuccess, sendError } = require('../utils/response');
const { sendServerError } = require('../utils/errors');
const { audit }           = require('../utils/audit');
const { inTransaction }   = require('../utils/transaction');
const { setUserActive }   = require('../utils/sessions');
const db                  = require('../config/db');
const { buildPlan, studentsWithoutClass, runFor, PromotionError } = require('../services/promotion.service');

// The server's local date of a timestamp (not UTC: a run at 02:00 is still that day)
const localDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const readBody = (body) => {
  const { from_year_id, exclude = [] } = body || {};
  if (!from_year_id) throw new PromotionError(400, 'from_year_id is required.');
  if (!Array.isArray(exclude)) throw new PromotionError(400, 'exclude must be a list of student ids.');
  return { from_year_id, exclude };
};

const fail = (res, err) => (err instanceof PromotionError
  ? sendError(res, err.message, err.status, err.errors)
  : sendServerError(res, err, 'Server error during promotion.'));

// What the app shows: the plan without internal fields
const publicPlan = (plan) => ({
  from_year: plan.from_year, to_year: plan.to_year, totals: plan.totals, missing_classes: plan.missing_classes,
  students: plan.rows.map(({ student, from_class, action, to_class, problem, result }) => ({ student, from_class, action, to_class, problem, result })),
  ...(plan.suggested_repeat ? { suggested_repeat: plan.suggested_repeat, warnings: plan.warnings } : {}),
});


// ── POST /api/academic-years/:id/promotion-preview ───────────
const previewPromotion = async (req, res) => {
  try {
    const { from_year_id, exclude } = readBody(req.body);
    const plan = await buildPlan(db, req.params.id, from_year_id, exclude, { withResults: true });
    return sendSuccess(res, {
      ...publicPlan(plan),
      already_run: await runFor(db, plan.from_year.id),
      without_class: await studentsWithoutClass(db),
    }, `${plan.totals.total} student(s): ${plan.totals.promote} promoted, ${plan.totals.repeat} repeating, ${plan.totals.graduate} graduating.`);
  } catch (err) {
    return fail(res, err);
  }
};


// ── POST /api/academic-years/:id/promote ─────────────────────
const applyPromotion = async (req, res) => {
  try {
    if (req.body?.grade_levels !== undefined || req.body?.confirm_count === undefined) {
      return sendError(res, 'Preview the promotion first (POST /academic-years/:id/promotion-preview), then send confirm_count with the number of students it showed.', 400);
    }
    const { from_year_id, exclude } = readBody(req.body);
    const confirm = Number(req.body.confirm_count);
    if (!Number.isInteger(confirm) || confirm < 0) return sendError(res, 'confirm_count must be a whole number.', 400);

    const result = await inTransaction(async (client) => {
      // Claim the source year first: a second run (or two at once) stops here
      const { rows: claimed } = await client.query(
        `INSERT INTO promotion_runs (from_year_id, to_year_id, run_by)
         SELECT $1, $2, $3 WHERE EXISTS (SELECT 1 FROM academic_years WHERE id = $1)
                                AND EXISTS (SELECT 1 FROM academic_years WHERE id = $2) AND $1 <> $2
         ON CONFLICT (from_year_id) DO NOTHING RETURNING id`,
        [from_year_id, req.params.id, req.user.id]);
      const plan = await buildPlan(client, req.params.id, from_year_id, exclude, { lock: true });
      if (!claimed[0]) {
        const run = await runFor(client, plan.from_year.id);
        throw new PromotionError(409, `The students of ${plan.from_year.name} were already promoted into ${run?.to_year ?? 'another year'}${run ? ` on ${localDate(run.run_at)}` : ''}.`, { already_run: run });
      }
      if (plan.totals.problems) {
        throw new PromotionError(400, `${plan.missing_classes.length} class(es) are missing in ${plan.to_year.name}. Create or copy them first.`, { missing_classes: plan.missing_classes });
      }
      if (plan.totals.total !== confirm) {
        throw new PromotionError(409, `The list changed: ${plan.totals.total} student(s) now, the preview showed ${confirm}. Preview again.`, { total: plan.totals.total });
      }

      for (const r of plan.rows) {
        if (r.action === 'graduate') {
          await client.query("UPDATE students SET status = 'graduated', updated_at = NOW() WHERE id = $1", [r.student.id]);
          await setUserActive(r.user_id, false, client); // like any student who is no longer active
        } else {
          await client.query('UPDATE students SET class_id = $1, updated_at = NOW() WHERE id = $2', [r.to_class.id, r.student.id]);
        }
      }
      const t = plan.totals;
      await client.query('UPDATE promotion_runs SET promoted = $1, repeated = $2, graduated = $3 WHERE id = $4',
        [t.promote, t.repeat, t.graduate, claimed[0].id]);
      await audit(client, req, 'students.promoted', 'academic_year', plan.to_year.id, {
        from_year_id: plan.from_year.id, from_year: plan.from_year.name, to_year: plan.to_year.name,
        promoted: t.promote, repeated: t.repeat, graduated: t.graduate,
        students: plan.rows.map((r) => ({ student_id: r.student.id, action: r.action, from_class_id: r.from_class.id, to_class_id: r.to_class?.id ?? null })),
      });
      return { ...publicPlan(plan), run: await runFor(client, plan.from_year.id) };
    });

    const t = result.totals;
    return sendSuccess(res, result, `${t.promote} promoted, ${t.repeat} repeating, ${t.graduate} graduated.`);
  } catch (err) {
    return fail(res, err);
  }
};

module.exports = { previewPromotion, applyPromotion };
