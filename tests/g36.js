// Phase 2 M8: monthly fees (PHASE2_PLAN §5.3 B3; D19-D22, D27).
// Fee structures (validation, overlaps, roles), generating charges (preview, idempotent, whole
// year up front, due day 10 and Pagume capped), discounts (percent and amount, months, changed
// mid-year without touching paid charges, never below what is paid), payments (one receipt for
// several months, partial, no overpayment, reference unless cash, M-Pesa, one student and year,
// waived charges refused, future months in advance), receipt numbers (RCP-<E.C. year>-00001,
// consecutive, no gaps under concurrent payments), reversal, waiver, manual charges, fee
// structure changes (amount only on unpaid charges, due day, months), reports (summary
// identities, outstanding by class and month, student grid), parent monthly view and scoping,
// receipt PDF, the old frontend's term shape, audit entries. A year that contains today is made
// current while it runs (todayyear.js), 2024/2025 put back afterwards. Scratch DB backend on :3100.
const pool = require('./tdb');
const { useTodayYear, restoreFixtureYear } = require('./todayyear');
const { legacyPayment, clearFees } = require('./fees');
const { toGregorian, toEthiopian, ethiopianMonthLength } = require('../src/utils/ethiopianDate');
const { parseAmount, percentOf, fromCents } = require('../src/utils/money');
const API = 'http://localhost:3100/api';
let pass = 0, fail = 0;
const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log(`  ${c ? 'PASS' : 'FAIL'}  ${m}${x ? '  ' + x : ''}`); };
const call = async (tok, method, path, body) => {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const type = r.headers.get('content-type') || '';
  return { status: r.status, type, body: type.includes('json') ? await r.json().catch(() => null) : Buffer.from(await r.arrayBuffer()) };
};
const login = async (e, p) => (await call(null, 'POST', '/auth/login', { email: e, password: p })).body?.data?.accessToken;
const msg = (r) => `${r.status} ${r.body?.message ?? ''}`;
const tag = Date.now().toString(36).slice(-5).toUpperCase();
const GRADE = 6;   // this suite's classes: grade 6 of the today year

(async () => {
  console.log('[g36] db =', (await pool.query('select current_database() d')).rows[0].d);
  const A = await login('admin@asms.et', 'Admin@1234');
  const G = require('./g3.json');
  const TA = await login(G.tA.email, 'Pass#2026');
  const pr = (await call(A, 'POST', '/accounts/principals', { email: `g36p${tag.toLowerCase()}@asms.et`, display_name: 'G36 Principal' })).body.data;
  const P0 = await login(`g36p${tag.toLowerCase()}@asms.et`, pr.temporary_password);
  const P = (await call(P0, 'POST', '/auth/change-password', { currentPassword: pr.temporary_password, newPassword: 'G36#pass2026' })).body.data.accessToken;
  const students = [], classes = [], fees = [];

  console.log('== Exact money and Ethiopian months (unit)');
  ok(parseAmount('1250.5') === 125050 && parseAmount(100) === 10000 && parseAmount('12.345') === null && parseAmount('-1') === null && parseAmount('1e3') === null,
    'parseAmount: 2 decimals at most, no negatives or exponents');
  ok(percentOf(100055, '12.5') === 12507 && percentOf(100000, '33.33') === 33330 && fromCents(-5) === '-0.05', 'percentOf rounds half up to the santim; fromCents');
  ok(toGregorian({ year: 2019, month: 2, day: 10 }) === '2026-10-20' && toGregorian({ year: 2019, month: 1, day: 1 }) === '2026-09-11', 'Tikimt 10, 2019 = 2026-10-20 (D27 example); Meskerem 1 = 2026-09-11');
  const { vectors } = require('./fixtures/ethiopian-dates.json');
  ok(vectors.every((v) => toGregorian({ year: v.ethiopian[0], month: v.ethiopian[1], day: v.ethiopian[2] }) === v.gregorian), `toGregorian matches all ${vectors.length} shared vectors`);

  try {
    const { year, today } = await useTodayYear(call, A);
    const ec = toEthiopian(year.end_date).year;
    const due = (m, day = 10) => toGregorian({ year: ec, month: m, day: Math.min(day, ethiopianMonthLength(ec, m)) });
    console.log(`  (current year ${year.name} = ${ec} E.C., today ${today})`);
    // Earlier interrupted runs: their grade-6 fees in this year
    const oldFees = (await pool.query('SELECT id FROM fee_structures WHERE academic_year_id = $1 AND grade_level = $2', [year.id, GRADE])).rows.map((r) => r.id);
    if (oldFees.length) {
      await pool.query('DELETE FROM payment_allocations WHERE charge_id IN (SELECT id FROM student_charges WHERE fee_structure_id = ANY($1::uuid[]))', [oldFees]);
      await pool.query('DELETE FROM student_charges WHERE fee_structure_id = ANY($1::uuid[])', [oldFees]);
      await pool.query('DELETE FROM fee_structures WHERE id = ANY($1::uuid[])', [oldFees]);
    }
    const used = new Set((await pool.query('SELECT section FROM classes WHERE academic_year_id = $1 AND grade_level = $2', [year.id, GRADE])).rows.map((r) => r.section));
    const free = ['A', 'B', 'C', 'D', 'E'].filter((x) => !used.has(x));
    if (free.length < 2) throw new Error(`grade ${GRADE} of the today year is full; reset the scratch DB`);
    for (const section of free.slice(0, 2)) classes.push((await call(A, 'POST', '/classes', { academic_year_id: year.id, grade_level: GRADE, section })).body.data);
    const [cA, cB] = classes;
    const base = (await pool.query(
      `SELECT COUNT(*)::int n FROM students s JOIN classes c ON c.id = s.class_id WHERE s.status = 'active' AND c.academic_year_id = $1 AND c.grade_level = $2`, [year.id, GRADE])).rows[0].n;
    const stu = async (class_id, n) => { const id = (await call(A, 'POST', '/students', { first_name: `F${n}`, last_name: `G36${tag}`, gender: 'female', class_id })).body.data.id; students.push(id); return id; };
    const s1 = await stu(cA.id, 1), s2 = await stu(cA.id, 2), s3 = await stu(cB.id, 3);

    console.log('== Fee structures');
    const fs = (body) => call(A, 'POST', '/finance/fee-structures', { grade_level: GRADE, ...body });
    const t = await fs({ category: 'tuition', amount: '1000' });
    ok(t.status === 201 && t.body.data.frequency === 'monthly' && t.body.data.months.join() === '1,2,3,4,5,6,7,8,9,10' && t.body.data.due_day === 10 && t.body.data.academic_year_id === year.id,
      'monthly tuition: defaults Meskerem-Sene (1-10), due day 10, current year', msg(t));
    const tuition = t.body.data; fees.push(tuition.id);
    for (const [body, what] of [
      [{ category: 'sport', amount: 0 }, 'amount 0'], [{ category: 'sport', amount: '12.345' }, 'amount with 3 decimals'],
      [{ category: 'sport', amount: 10, months: [0, 1] }, 'month 0'], [{ category: 'sport', amount: 10, months: [2, 2] }, 'a month twice'],
      [{ category: 'sport', amount: 10, due_day: 31 }, 'due day 31'], [{ category: 'books', amount: 10 }, 'unknown category'],
      [{ category: 'sport', amount: 10, frequency: 'weekly' }, 'frequency weekly'], [{ category: 'sport', amount: 10, grade_level: 13 }, 'grade 13'],
      [{ category: 'sport', amount: 10, frequency: 'one_time', due_date: '2026-02-30' }, 'due_date 2026-02-30'],
    ]) ok((await fs(body)).status === 400, `${what} -> 400`);
    ok((await fs({ category: 'tuition', amount: 5 })).status === 409, 'a second grade-6 tuition in the year -> 409');
    ok((await call(A, 'POST', '/finance/fee-structures', { grade_level: null, category: 'tuition', amount: 5 })).status === 409, 'tuition for all grades while grade 6 has one -> 409 (would charge twice)');
    const tr = await fs({ category: 'transport', amount: '300.50', months: [13, 12], due_day: 30 });
    ok(tr.status === 201 && tr.body.data.months.join() === '12,13', 'transport for Nehase and Pagume (months sorted)', msg(tr));
    const transport = tr.body.data; fees.push(transport.id);
    const rg = await fs({ category: 'registration', amount: 500, frequency: 'one_time', due_date: today });
    ok(rg.status === 201 && rg.body.data.months.length === 0 && rg.body.data.due_day === null, 'one-time registration with a due date');
    const registration = rg.body.data; fees.push(registration.id);
    const list = await call(P, 'GET', '/finance/fee-structures');
    ok(list.status === 200 && list.body.data.year.eth_year === ec && fees.every((id) => list.body.data.fee_structures.some((f) => f.id === id)), 'principal lists the fee structures of the current year');
    ok((await call(P, 'POST', '/finance/fee-structures', { grade_level: GRADE, category: 'exam', amount: 1 })).status === 403, 'principal POST -> 403');
    ok((await call(TA, 'GET', '/finance/fee-structures')).status === 403, 'teacher GET -> 403');

    console.log('== Generate charges');
    const pv = await call(A, 'GET', `/finance/fee-structures/${tuition.id}/generate`);
    const n = base + 3;
    ok(pv.status === 200 && pv.body.data.preview && pv.body.data.students === n && pv.body.data.charges_new === n * 10 && pv.body.data.amount_new === fromCents(n * 10 * 100000),
      `preview: ${n} student(s) x 10 months, ${fromCents(n * 1000000)} ETB`, JSON.stringify(pv.body.data));
    ok((await pool.query('SELECT COUNT(*)::int n FROM student_charges WHERE fee_structure_id = $1', [tuition.id])).rows[0].n === 0, 'preview writes nothing');
    const gen = await call(A, 'POST', `/finance/fee-structures/${tuition.id}/generate`);
    ok(gen.status === 201 && gen.body.data.charges_new === n * 10, `run: ${n * 10} charges for the whole year up front`, msg(gen));
    const again = await call(A, 'POST', `/finance/fee-structures/${tuition.id}/generate`);
    ok(again.status === 200 && again.body.data.charges_new === 0 && again.body.data.charges_existing === n * 10, 'running again adds nothing (idempotent)');
    const ch = async (sid, feeId, m) => (await pool.query(
      'SELECT *, due_date::text AS due_date FROM student_charge_balances WHERE student_id = $1 AND fee_structure_id = $2 AND eth_month IS NOT DISTINCT FROM $3', [sid, feeId, m])).rows[0];
    const m2 = await ch(s1, tuition.id, 2);
    ok(m2.due_date === due(2) && m2.amount_due === '1000.00' && m2.status === 'unpaid', `Tikimt charge due ${due(2)} (the 10th of the month, D27)`, m2.due_date);
    await call(A, 'POST', `/finance/fee-structures/${transport.id}/generate`);
    await call(A, 'POST', `/finance/fee-structures/${registration.id}/generate`);
    const pag = await ch(s1, transport.id, 13);
    ok(pag.due_date === due(13, 30) && pag.amount_due === '300.50', `Pagume due day 30 capped at Pagume ${ethiopianMonthLength(ec, 13)} (${pag.due_date})`);
    ok((await ch(s1, registration.id, null))?.due_date === today, 'one-time charge due on its date');
    const s4 = await stu(cB.id, 4);
    const late = await call(A, 'POST', `/finance/fee-structures/${tuition.id}/generate`);
    ok(late.body.data.charges_new === 10, 'a student enrolled later: generating again adds only their 10 months');

    console.log('== Discounts (D22)');
    const disc = (body) => call(A, 'POST', '/finance/discounts', { fee_structure_id: tuition.id, ...body });
    const d1 = await disc({ student_id: s1, kind: 'percent', value: 25, reason: 'sibling' });
    ok(d1.status === 201 && d1.body.data.charges_changed === 10, '25% sibling discount for F1: 10 charges recalculated', msg(d1));
    ok((await ch(s1, tuition.id, 1)).net_due === '750.00', 'F1 tuition 1000 - 25% = 750');
    for (const [body, what] of [[{ student_id: s2, kind: 'percent', value: 101, reason: 'sibling' }, 'percent 101'],
      [{ student_id: s2, kind: 'amount', value: 50, reason: 'other' }, 'reason other without a note'],
      [{ student_id: s2, kind: 'amount', value: 50, reason: 'luck' }, 'unknown reason'],
      [{ student_id: s2, kind: 'amount', value: 50, reason: 'scholarship', from_month: 5, to_month: 3 }, 'from_month after to_month']]) {
      ok((await disc(body)).status === 400, `${what} -> 400`);
    }
    ok((await disc({ student_id: s1, kind: 'amount', value: 10, reason: 'sibling' })).status === 409, 'a second discount on the same fee -> 409');
    const d2 = await disc({ student_id: s2, kind: 'amount', value: 300, reason: 'scholarship', from_month: 3, to_month: 5 });
    ok(d2.status === 201 && d2.body.data.charges_changed === 3 && (await ch(s2, tuition.id, 4)).net_due === '700.00' && (await ch(s2, tuition.id, 6)).net_due === '1000.00',
      'F2: 300 ETB scholarship for Hidar-Tir only', msg(d2));
    ok((await call(P, 'GET', `/finance/discounts?student_id=${s1}`)).body.data.length === 1 && (await call(P, 'POST', '/finance/discounts', {})).status === 403, 'principal reads discounts, cannot add');

    console.log('== Payments and receipts');
    const charge = async (sid, feeId, m) => (await ch(sid, feeId, m)).id;
    const pay = (sid, allocations, extra = {}) => call(A, 'POST', '/finance/payments', { student_id: sid, payment_date: today, payment_method: 'cash', allocations, ...extra });
    const p1 = await pay(s1, [{ charge_id: await charge(s1, tuition.id, 1), amount: '750' }, { charge_id: await charge(s1, tuition.id, 2), amount: 750 }, { charge_id: await charge(s1, tuition.id, 3), amount: '750.00' }]);
    const num = (r) => Number(r.split('-')[2]);
    ok(p1.status === 201 && new RegExp(`^RCP-${toEthiopian(today).year}-\\d{5}$`).test(p1.body.data.receipt_number) && p1.body.data.amount === '2250.00' && p1.body.data.lines.length === 3,
      `three months on one receipt ${p1.body.data?.receipt_number}: 2250.00`, msg(p1));
    ok((await ch(s1, tuition.id, 2)).status === 'paid', 'Tikimt paid');
    const over = await pay(s2, [{ charge_id: await charge(s2, tuition.id, 1), amount: '1000.01' }]);
    ok(over.status === 409 && over.body.errors?.over?.length === 1, 'more than what is open on the charge -> 409 (no overpayment)', msg(over));
    const p2 = await pay(s2, [{ charge_id: await charge(s2, tuition.id, 1), amount: 400 }]);
    ok(p2.status === 201 && num(p2.body.data.receipt_number) === num(p1.body.data.receipt_number) + 1, 'next receipt number +1', p2.body.data?.receipt_number);
    const c21 = await ch(s2, tuition.id, 1);
    ok(c21.status === 'partial' && c21.balance === '600.00', 'partial payment: 400 of 1000, 600 open');
    ok((await pay(s2, [{ charge_id: c21.id, amount: 1 }], { payment_method: 'telebirr' })).status === 400, 'telebirr without a reference -> 400');
    const p3 = await pay(s2, [{ charge_id: c21.id, amount: 100 }], { payment_method: 'mpesa', reference: 'MP-123' });
    ok(p3.status === 201 && p3.body.data.payment_method === 'mpesa' && p3.body.data.reference === 'MP-123', 'M-Pesa with a reference');
    ok((await pay(s2, [{ charge_id: await charge(s1, tuition.id, 4), amount: 1 }])).status === 400, "another student's charge -> 400");
    const fy = (await pool.query("SELECT id FROM academic_years WHERE name = '2024/2025'")).rows[0].id;
    const old = await legacyPayment(pool, { student_id: s3, academic_year_id: fy, due: 200, paid: 0 });
    ok((await pay(s3, [{ charge_id: old.charge_id, amount: 1 }, { charge_id: await charge(s3, tuition.id, 1), amount: 1 }])).status === 400, 'charges of two academic years on one payment -> 400');
    ok((await pay(s3, [{ charge_id: old.charge_id, amount: 50 }])).status === 201, 'an older year\'s open legacy charge can be paid on its own');
    const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
    ok((await pay(s3, [{ charge_id: await charge(s3, tuition.id, 1), amount: 1 }], { payment_date: tomorrow })).status === 400, 'payment date tomorrow -> 400');
    ok((await pay(s3, [{ charge_id: await charge(s3, tuition.id, 1), amount: 0 }])).status === 400, 'amount 0 -> 400');
    ok((await pay(s3, [])).status === 400, 'no allocations -> 400');
    const ahead = await pay(s1, [{ charge_id: await charge(s1, tuition.id, 10), amount: 750 }]);
    ok(ahead.status === 201 && (await ch(s1, tuition.id, 10)).status === 'paid', 'Sene paid in advance (charges for the whole year exist)');
    ok((await call(P, 'POST', '/finance/payments', { student_id: s1 })).status === 403 && (await call(TA, 'GET', '/finance/payments')).status === 403, 'principal cannot record; teacher cannot list');

    console.log('== Receipt numbers under concurrent payments');
    const conc = await Promise.all([5, 6, 7].map(async (m) => pay(s4, [{ charge_id: await charge(s4, tuition.id, m), amount: 100 }])));
    const nums = conc.map((r) => num(r.body.data.receipt_number)).sort((a, b) => a - b);
    ok(conc.every((r) => r.status === 201) && nums[1] === nums[0] + 1 && nums[2] === nums[0] + 2, 'three payments at once: three consecutive numbers', nums.join());
    const last = await charge(s4, tuition.id, 8);
    const race = await Promise.all([pay(s4, [{ charge_id: last, amount: 1000 }]), pay(s4, [{ charge_id: last, amount: 1000 }])]);
    ok(race.map((r) => r.status).sort().join() === '201,409', 'two payments for the same open 1000 at once: one 201, one 409', race.map((r) => r.status).join());
    const gaps = (await pool.query(
      `SELECT COUNT(*)::int n, MAX(split_part(receipt_number, '-', 3)::int) mx, MIN(split_part(receipt_number, '-', 3)::int) mn
       FROM payments WHERE receipt_number LIKE $1 AND student_id = ANY($2::uuid[])`, [`RCP-${toEthiopian(today).year}-%`, students])).rows[0];
    ok(gaps.n === gaps.mx - gaps.mn + 1, `this run's receipt numbers have no gaps, refused payments included (${gaps.n} numbers ${gaps.mn}..${gaps.mx})`);

    console.log('== Discount changed mid-year');
    const up = await call(A, 'PUT', `/finance/discounts/${d1.body.data.id}`, { value: 50 });
    ok(up.status === 200 && up.body.data.charges_changed === 6, 'F1 discount 25% -> 50%: 6 unpaid months recalculated (4 paid kept)', msg(up));
    ok((await ch(s1, tuition.id, 2)).net_due === '750.00' && (await ch(s1, tuition.id, 4)).net_due === '500.00', 'paid Tikimt still 750; unpaid Tahsas now 500');
    const d3 = await disc({ student_id: s2, kind: 'percent', value: 80, reason: 'staff_child' });
    ok(d3.status === 409, 'F2 already has a discount on tuition -> 409');
    await call(A, 'PUT', `/finance/discounts/${d2.body.data.id}`, { kind: 'percent', value: 80, from_month: null, to_month: null });
    const c21b = await ch(s2, tuition.id, 1);
    ok(c21b.discount_amount === '500.00' && c21b.net_due === '500.00' && c21b.status === 'paid', 'F2 Meskerem: 80% would be 800 but 500 is paid -> discount 500, paid (never below what is paid)', `${c21b.discount_amount}/${c21b.status}`);
    const del = await call(A, 'DELETE', `/finance/discounts/${d2.body.data.id}`);
    ok(del.status === 200 && (await ch(s2, tuition.id, 4)).net_due === '1000.00' && (await ch(s2, tuition.id, 1)).net_due === '500.00', 'discount removed: unpaid months back to 1000, the paid month keeps its amount');

    console.log('== Reversal');
    ok((await call(A, 'POST', `/finance/payments/${p3.body.data.id}/reverse`, {})).status === 400, 'reverse without a reason -> 400');
    const rv = await call(A, 'POST', `/finance/payments/${p3.body.data.id}/reverse`, { reason: 'Recorded twice' });
    ok(rv.status === 200 && rv.body.data.status === 'reversed' && rv.body.data.receipt_number === p3.body.data.receipt_number, 'reversed: the receipt keeps its number', msg(rv));
    const c21c = await ch(s2, tuition.id, 1);
    ok(c21c.paid === '400.00' && c21c.status === 'partial', 'the charge is open again by the reversed 100');
    ok((await call(A, 'POST', `/finance/payments/${p3.body.data.id}/reverse`, { reason: 'again' })).status === 409, 'reverse again -> 409');
    ok((await call(P, 'POST', `/finance/payments/${p2.body.data.id}/reverse`, { reason: 'x' })).status === 403, 'principal cannot reverse');
    ok((await call(A, 'DELETE', `/finance/payments/${p2.body.data.id}`)).status === 404, 'no DELETE for payments');
    const lp = await call(P, 'GET', `/finance/payments?student_id=${s2}`);
    ok(lp.status === 200 && lp.body.data.payments.some((p) => p.id === p3.body.data.id && p.status === 'reversed'), 'payment list shows the reversed receipt');

    console.log('== Waiver and manual charges');
    const w = await ch(s3, tuition.id, 2);
    ok((await call(A, 'POST', `/finance/charges/${w.id}/waive`, {})).status === 400, 'waive without a reason -> 400');
    const wv = await call(A, 'POST', `/finance/charges/${w.id}/waive`, { reason: 'Family hardship' });
    ok(wv.status === 200 && wv.body.data.status === 'waived' && wv.body.data.balance === '0.00', 'waived: balance 0', msg(wv));
    ok((await call(A, 'POST', `/finance/charges/${w.id}/waive`, { reason: 'x' })).status === 409, 'waive again -> 409');
    ok((await call(A, 'POST', `/finance/charges/${await charge(s1, tuition.id, 2)}/waive`, { reason: 'x' })).status === 409, 'waive a paid charge -> 409');
    ok((await pay(s3, [{ charge_id: w.id, amount: 1 }])).status === 409, 'pay a waived charge -> 409');
    ok((await call(A, 'POST', '/finance/charges', { student_id: s3, category: 'material', amount: 150 })).status === 400, 'manual charge without a description -> 400');
    const mc = await call(A, 'POST', '/finance/charges', { student_id: s3, category: 'material', amount: '150', description: 'Lost book' });
    ok(mc.status === 201 && mc.body.data.academic_year_id === year.id && mc.body.data.eth_month === null, "manual charge in the student's class year", msg(mc));

    console.log('== Changing a fee structure');
    const put = await call(A, 'PUT', `/finance/fee-structures/${tuition.id}`, { amount: '1200', due_day: 15 });
    ok(put.status === 200, 'tuition 1000 -> 1200, due day 15', msg(put));
    ok((await ch(s3, tuition.id, 5)).amount_due === '1200.00' && (await ch(s1, tuition.id, 2)).amount_due === '1000.00' && (await ch(s2, tuition.id, 1)).amount_due === '1000.00',
      'the new amount applies to charges with nothing paid; paid and partly paid keep 1000');
    ok((await ch(s1, tuition.id, 4)).net_due === '600.00', 'with the 50% discount: 1200 -> 600');
    ok((await ch(s3, tuition.id, 2)).status === 'waived', 'the waived charge stays waived');
    ok((await ch(s1, tuition.id, 2)).due_date === due(2, 15), `due dates moved to the 15th (${due(2, 15)})`);
    const rm = await call(A, 'PUT', `/finance/fee-structures/${tuition.id}`, { months: [1, 2, 3, 4, 5, 6, 7, 8, 9] });
    ok(rm.status === 409 && rm.body.errors?.months?.join() === '10', 'removing Sene, paid in advance -> 409');
    ok((await call(A, 'PUT', `/finance/fee-structures/${tuition.id}`, { category: 'exam' })).status === 409, 'category change with charges -> 409');
    const rm9 = await call(A, 'PUT', `/finance/fee-structures/${transport.id}`, { months: [12] });
    ok(rm9.status === 200 && rm9.body.data.removed_charges === n && !(await ch(s1, transport.id, 13)), 'transport without Pagume: the unpaid Pagume charges are removed', msg(rm9));
    ok((await call(A, 'DELETE', `/finance/fee-structures/${tuition.id}`)).status === 409, 'delete a fee with payments -> 409');
    const dl = await call(A, 'DELETE', `/finance/fee-structures/${transport.id}`);
    ok(dl.status === 200 && dl.body.data.charges === n, 'delete transport (nothing paid) with its charges', msg(dl));
    fees.splice(fees.indexOf(transport.id), 1);

    console.log('== Reports');
    const sm = (await call(P, 'GET', '/finance/summary')).body.data;
    const s = sm.summary; const c = (v) => Math.round(Number(v) * 100);
    ok(c(s.net_balance) === c(s.total_expected) - c(s.total_collected) && c(s.total_outstanding) - c(s.total_credit) + c(s.total_upcoming) === c(s.net_balance),
      'summary: net = expected - collected = outstanding - credit + upcoming', `${s.total_outstanding} - ${s.total_credit} + ${s.total_upcoming} = ${s.net_balance}`);
    ok(sm.by_month.length >= 10 && sm.by_month[0].eth_month === 1 && sm.by_method.some((m) => m.payment_method === 'cash') && !sm.by_method.some((m) => m.payment_method === 'mpesa' && Number(m.total) === 100),
      'by month (1..), by method without the reversed M-Pesa 100');
    const os = (await call(P, 'GET', `/finance/outstanding?class_id=${cA.id}&scope=all`)).body.data;
    const f1 = os.students.find((x) => x.student_id === s1), f2 = os.students.find((x) => x.student_id === s2);
    // F1: tuition months 4-9 open at 600 each; registration 500. F2: Meskerem 600 (1000 - 400 paid), 2-10 at 1200, registration 500.
    ok(f1?.balance === '4100.00' && f2?.balance === '11900.00' && os.classes.length === 1 && os.classes[0].students === 2 && os.classes[0].balance === '16000.00',
      `outstanding ${cA.name}, whole year: F1 4100, F2 11900, class 16000`, `${f1?.balance} ${f2?.balance} ${os.classes[0]?.balance}`);
    const om = (await call(A, 'GET', `/finance/outstanding?class_id=${cA.id}&eth_month=2`)).body.data;
    ok(om.students.length === 1 && om.students[0].student_id === s2 && om.students[0].balance === '1200.00', 'Tikimt only: F2 owes 1200 (F1 paid)');
    const nowOwed = (await call(A, 'GET', `/finance/outstanding?class_id=${cA.id}`)).body.data;
    const owedNow = (sid, months) => {
      const r = nowOwed.students.find((x) => x.student_id === sid);
      return { r, months };
    };
    const dueMonths = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].filter((m) => due(m, 15) <= today);
    const f2now = (dueMonths.includes(1) ? 600 : 0) + dueMonths.filter((m) => m > 1).length * 1200 + (registration.due_date <= today ? 500 : 0);
    ok(Number(owedNow(s2).r?.balance ?? 0) === f2now, `due now (today): F2 owes ${f2now} (months ${dueMonths.join(',') || 'none'} + registration)`, owedNow(s2).r?.balance);
    ok((await call(A, 'GET', '/finance/outstanding?eth_month=14')).status === 400 && (await call(A, 'GET', '/finance/outstanding?scope=some')).status === 400, 'bad month / scope -> 400');
    const sb = (await call(P, 'GET', `/finance/student/${s1}`)).body.data;
    ok(sb.year.id === year.id && sb.year.months.length === 10 && sb.year.one_time.length === 1 && sb.year.discounts.length === 1 && sb.payments.length === 2,
      'student grid: 10 months, 1 one-time, the discount, 2 receipts');
    ok(Number(sb.overview.total_paid) === 3000 && sb.overview.status !== 'no_records', `F1 paid 3000 (2250 + 750 ahead)`, sb.overview.total_paid);
    const ovd = (await pool.query('SELECT COUNT(*)::int n FROM student_charge_balances WHERE student_id = $1 AND balance > 0 AND due_date < CURRENT_DATE', [s2])).rows[0].n;
    ok(sb && (await call(A, 'GET', `/finance/charges?student_id=${s2}&status=overdue`)).body.data.charges.length === ovd, `charges?status=overdue lists F2's ${ovd} overdue charge(s)`);

    console.log('== Parent: monthly view (D21) and receipts');
    const par = (await call(A, 'POST', '/accounts/parents', { full_name: 'G36 Parent', phone: '0911', email: `g36par${tag.toLowerCase()}@asms.et` })).body.data;
    await call(A, 'POST', `/accounts/parents/${par.id}/children`, { student_id: s1, relationship: 'mother' });
    await call(A, 'POST', `/accounts/parents/${par.id}/children`, { student_id: s2, relationship: 'mother' });
    const pl = await login(`g36par${tag.toLowerCase()}@asms.et`, par.temporary_password);
    const PT = (await call(pl, 'POST', '/auth/change-password', { currentPassword: par.temporary_password, newPassword: 'G36#par2026' })).body.data.accessToken;
    const cf = await call(PT, 'GET', `/parent/child/${s1}/fees`);
    const tik = cf.body.data.months?.find((m) => m.eth_month === 2);
    ok(cf.status === 200 && cf.body.data.months.length === 10 && tik?.status === 'paid' && cf.body.data.months.find((m) => m.eth_month === 4)?.status === 'unpaid' && cf.body.data.year.eth_year === ec,
      'child fees: 10 months, Tikimt paid, Tahsas unpaid', msg(cf));
    ok(cf.body.data.payments.length === 2 && cf.body.data.payments.every((p) => p.receipt_number && p.lines?.length), 'receipts with what they paid');
    const ff = (await call(PT, 'GET', '/parent/fees')).body.data;
    ok(ff.children.length === 2 && Number(ff.family.total_due) === ff.children.reduce((a, x) => a + Number(x.total_due), 0) && 'upcoming' in ff.family, 'family totals over both children');
    ok((await call(PT, 'GET', `/parent/child/${s3}/fees`)).status === 403, "another child's fees -> 403");
    const pdf = await call(PT, 'GET', `/pdf/receipt/${p1.body.data.id}`);
    ok(pdf.status === 200 && pdf.type.includes('application/pdf') && pdf.body.slice(0, 5).toString() === '%PDF-', 'parent downloads their child\'s receipt PDF', `${pdf.status} ${pdf.type}`);
    const s3pay = (await call(A, 'GET', `/finance/payments?student_id=${s3}`)).body.data.payments[0].id;
    ok((await call(PT, 'GET', `/pdf/receipt/${s3pay}`)).status === 403, "another child's receipt -> 403");
    const rvPdf = await call(P, 'GET', `/pdf/receipt/${p3.body.data.id}`);
    ok(rvPdf.status === 200 && rvPdf.body.slice(0, 5).toString() === '%PDF-', 'principal prints the reversed receipt');
    ok((await call(TA, 'GET', `/pdf/receipt/${p1.body.data.id}`)).status === 403 && (await call(A, 'GET', '/pdf/receipt/not-a-uuid')).status === 404, 'teacher 403; bad id 404');
    const rc = (await call(A, 'GET', `/finance/payments/${p3.body.data.id}`)).body.data;
    ok(rc.status === 'reversed' && rc.reversal_reason === 'Recorded twice' && rc.lines.length === 1 && rc.eth_year === toEthiopian(today).year, 'receipt data: reversed, reason, lines');

    console.log('== Old frontend (term shape)');
    const op = await call(A, 'POST', '/finance/payments', { student_id: s3, amount_due: 100, amount_paid: 50, payment_method: 'cash', payment_date: today, term: 'term2', category: 'exam' });
    ok(op.status === 201 && /^RCP-\d{4}-\d{5}$/.test(op.body.data.receipt_number) && op.body.data.term === 'term2' && op.body.data.amount_due === '100.00', 'term shape: a charge without a month and a payment', msg(op));
    ok((await call(A, 'POST', '/finance/payments', { student_id: s3, amount_due: 100, amount_paid: 150, payment_method: 'cash', payment_date: today })).status === 409, 'term shape above amount_due -> 409');

    console.log('== Audit');
    const acts = (await pool.query(
      `SELECT action, COUNT(*)::int n FROM audit_logs WHERE created_at > NOW() - INTERVAL '30 minutes'
         AND (target_id = ANY($1::uuid[]) OR new_data->>'student_id' = ANY($2::text[])) GROUP BY action`,
      [[...fees, transport.id], students])).rows;
    const has = (a) => acts.some((x) => x.action === a);
    const want = ['fee_structure.created', 'fee_structure.charges_generated', 'fee_structure.updated', 'fee_structure.deleted', 'discount.created', 'discount.updated',
      'discount.deleted', 'payment.recorded', 'payment.reversed', 'charge.waived', 'charge.created'];
    ok(want.every(has), 'audited: fee structures, generation, discounts, payments, reversal, waiver, manual charge', want.filter((a) => !has(a)).join(', ') || '');
    const ra = (await pool.query("SELECT old_data, new_data FROM audit_logs WHERE action = 'payment.reversed' AND target_id = $1", [p3.body.data.id])).rows[0];
    ok(ra?.new_data?.reason === 'Recorded twice' && ra?.old_data?.receipt_number === p3.body.data.receipt_number, 'reversal entry with the reason and the receipt before');
  } finally {
    await restoreFixtureYear(call, A);
    await clearFees(pool, students);
    await pool.query('DELETE FROM fee_structures WHERE id = ANY($1::uuid[])', [fees]);
    await pool.query('DELETE FROM student_parents WHERE student_id = ANY($1::uuid[])', [students]);
    await pool.query('DELETE FROM students WHERE id = ANY($1::uuid[])', [students]);
    await pool.query('DELETE FROM classes WHERE id = ANY($1::uuid[])', [classes.map((c) => c.id)]);
    const left = (await pool.query('SELECT COUNT(*)::int n FROM student_charges WHERE student_id = ANY($1::uuid[])', [students])).rows[0].n
      + (await pool.query('SELECT COUNT(*)::int n FROM fee_structures WHERE id = ANY($1::uuid[])', [fees])).rows[0].n;
    ok(left === 0, 'test fees, charges, payments, students and classes removed', String(left));
  }
  await pool.end();
  console.log(`PASS=${pass} FAIL=${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
