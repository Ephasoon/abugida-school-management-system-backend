// src/utils/audit.js
// ============================================================
// One audit_logs entry for an admin action. Pass the transaction's
// client so the entry is written (or rolled back) with the change.
//   audit(client, req, 'teacher.class_assigned', 'teacher', id, { class_id })
//   audit(client, req, 'discount.updated', 'discount', id, after, before)   // with the old values
// ============================================================

const json = (v) => (v ? JSON.stringify(v) : null);

const audit = (client, req, action, targetType, targetId, data = null, oldData = null) => client.query(
  `INSERT INTO audit_logs (user_id, action, target_type, target_id, new_data, old_data)
   VALUES ($1, $2, $3, $4, $5, $6)`,
  [req.user.id, action, targetType, targetId, json(data), json(oldData)]
);

module.exports = { audit };
