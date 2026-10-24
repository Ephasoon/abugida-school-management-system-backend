// Test helper (M8): since migration 024, money owed is in student_charges and payments are
// allocated to charges. Suites that set up fees straight in the database use these instead of
// INSERT INTO payments. Scratch DB only (pass the tdb pool).
//   legacyPayment(pool, { student_id, academic_year_id, due, paid, term, category })
//     → a charge without a month (as 024 migrates old term payments) and, if paid > 0, a
//       payment and its allocation; returns { charge_id, payment_id }. Also the way to set up
//       amounts owed and paid now that POST /finance/payments takes allocations only (M10).
//   clearFees(pool, studentIds) → removes their allocations, payments, charges and discounts
const legacyPayment = async (pool, { student_id, academic_year_id, due, paid = 0, term = 'term1', category = 'tuition' }) => {
  const charge = (await pool.query(
    `INSERT INTO student_charges (student_id, academic_year_id, category, amount_due, legacy_term)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`, [student_id, academic_year_id, category, due, term])).rows[0].id;
  let payment = null;
  if (Number(paid) > 0) {
    payment = (await pool.query(
      `INSERT INTO payments (student_id, academic_year_id, amount) VALUES ($1, $2, $3) RETURNING id`,
      [student_id, academic_year_id, paid])).rows[0].id;
    await pool.query('INSERT INTO payment_allocations (payment_id, charge_id, amount) VALUES ($1, $2, $3)', [payment, charge, paid]);
  }
  return { charge_id: charge, payment_id: payment };
};

const clearFees = async (pool, studentIds) => {
  await pool.query(`DELETE FROM payment_allocations WHERE payment_id IN (SELECT id FROM payments WHERE student_id = ANY($1::uuid[]))
                      OR charge_id IN (SELECT id FROM student_charges WHERE student_id = ANY($1::uuid[]))`, [studentIds]);
  await pool.query('DELETE FROM payments WHERE student_id = ANY($1::uuid[])', [studentIds]);
  await pool.query('DELETE FROM student_charges WHERE student_id = ANY($1::uuid[])', [studentIds]);
  await pool.query('DELETE FROM student_discounts WHERE student_id = ANY($1::uuid[])', [studentIds]);
};

module.exports = { legacyPayment, clearFees };
