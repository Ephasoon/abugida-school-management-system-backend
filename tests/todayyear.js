// Test helper (M4): attendance can only be marked inside the current academic year and up to
// today, but the scratch fixtures' current year (2024/2025) is in the past. useTodayYear makes a
// test year that contains today current for the duration of a test; restoreFixtureYear puts
// 2024/2025 back (also at the start, in case an earlier run was interrupted).
// Scratch DB only: the API calls go to the test server on :3100.
const FIXTURE_YEAR = '2024/2025';

const localDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

const restoreFixtureYear = async (call, A) => {
  const years = (await call(A, 'GET', '/academic-years')).body.data;
  const fx = years.find((y) => y.name === FIXTURE_YEAR);
  if (fx && !fx.is_current) await call(A, 'POST', `/academic-years/${fx.id}/activate`);
};

// The year "Y/Y+1" around today (Sept 1 to Aug 31), created if missing, made current
const useTodayYear = async (call, A) => {
  await restoreFixtureYear(call, A);
  const today = localDate();
  const Y = Number(today.slice(0, 4)) - (Number(today.slice(5, 7)) < 9 ? 1 : 0);
  const name = `${Y}/${Y + 1}`;
  let year = (await call(A, 'GET', '/academic-years')).body.data.find((y) => y.name === name);
  if (!year) year = (await call(A, 'POST', '/academic-years', { name, start_date: `${Y}-09-01`, end_date: `${Y + 1}-08-31` })).body.data;
  if (!(year.start_date <= today && today <= year.end_date)) throw new Error(`${name} (${year.start_date}..${year.end_date}) does not contain ${today}`);
  await call(A, 'POST', `/academic-years/${year.id}/activate`);
  return { year, today };
};

module.exports = { FIXTURE_YEAR, localDate, addDays, useTodayYear, restoreFixtureYear };
