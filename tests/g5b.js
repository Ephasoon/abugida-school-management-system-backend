// Parent portal smoke test (separate login page + parent_token)
const { launch, Browser, sleep } = require('./cdp');
const G = require('./g3.json');
(async () => {
  const { close, wsUrl } = await launch(); const b = new Browser(wsUrl); await b.connect();
  let ok = true; const log = (c, m, x = '') => { ok = ok && c; console.log(`  ${c ? 'PASS' : 'FAIL'}  ${m} ${x}`); };
  try {
    const P = await b.newPage();
    await P.goto('http://localhost:5599/parent-login.html', 1000);
    await P.waitFor(`typeof handleLogin === 'function'`, 15000);
    await P.eval(`document.getElementById('email').value=${JSON.stringify(G.parent.email)}; document.getElementById('password').value='Pass#2026'; handleLogin(); true`);
    log(await P.waitFor(`location.pathname.endsWith('parent-dashboard.html')`), 'parent login lands on parent-dashboard');
    log(await P.waitFor(`document.body.innerText.includes('S 1')`, 10000), 'linked child is rendered');
    for (const tab of ['grades', 'attendance', 'fees', 'timetable']) { await P.eval(`showTab('${tab}'); true`); await sleep(1200); }
    log(P.errors.length === 0, 'no JS errors across all tabs', P.errors.slice(0, 2).join(' | '));
    log(await P.eval(`window.ASMS_CONFIG.API_BASE`) === 'http://localhost:3100/api', 'uses API base from config.js');
  } catch (e) { ok = false; console.log('  FAIL harness:', e.message); }
  console.log(ok ? 'parent portal: ALL PASS' : 'parent portal: FAILURES'); await close(); process.exit(0);
})();
