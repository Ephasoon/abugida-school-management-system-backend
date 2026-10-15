// Test helper (g2b): graduates one student through the safe promotion (M7a), on its own
// years, never the scratch current year: a grade 12 class in a new source year, the student
// moved there, preview, apply. Prints the HTTP status of the apply.
// Usage: node tests/graduate.js <admin access token> <student id>
const { createFreeYear } = require('./years');
const API = 'http://localhost:3100/api';
const call = async (tok, method, path, body) => {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
(async () => {
  const [A, studentId] = process.argv.slice(2);
  const from = (await createFreeYear(call, A, 9000, 9900)).body.data;
  let to;
  for (let y = +from.name.slice(0, 4) + 1; !to; y++) {
    const r = await call(A, 'POST', '/academic-years', { name: `${y}/${y + 1}`, start_date: `${y}-09-01`, end_date: `${y + 1}-07-31` });
    if (r.status === 201) to = r.body.data;
  }
  const cls = (await call(A, 'POST', '/classes', { academic_year_id: from.id, grade_level: 12, section: 'A' })).body.data.id;
  await call(A, 'PUT', `/students/${studentId}`, { class_id: cls });
  const plan = (await call(A, 'POST', `/academic-years/${to.id}/promotion-preview`, { from_year_id: from.id })).body.data;
  const r = await call(A, 'POST', `/academic-years/${to.id}/promote`, { from_year_id: from.id, confirm_count: plan.totals.total });
  console.log(r.status);
})().catch((e) => { console.error(e); console.log(0); });
