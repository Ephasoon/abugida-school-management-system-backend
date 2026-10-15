// Test helper: create an academic year with a name earlier runs have not used.
// Names are unique and must match the start year ("3123/3124" starts 3123-09-01),
// so pick a year in [from, to) and move on while the name is taken (409).
const createFreeYear = async (call, tok, from, to) => {
  const span = to - from;
  const first = from + Math.floor(Math.random() * span);
  for (let i = 0; i < span; i++) {
    const y = from + ((first - from + i) % span);
    const r = await call(tok, 'POST', '/academic-years', { name: `${y}/${y + 1}`, start_date: `${y}-09-01`, end_date: `${y + 1}-07-31` });
    if (r.status !== 409) return r;
  }
  throw new Error(`no free academic year name in ${from}..${to}`);
};

module.exports = { createFreeYear };
