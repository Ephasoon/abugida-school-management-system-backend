// Follow-up items 1-4, headless Edge against scratch-DB backend (:3100) + static frontend (:5599)
const { launch, Browser, sleep } = require('./cdp');
const G = require('./g3.json');
const API = 'http://localhost:3100/api', FE = 'http://localhost:5599';
const ABEBE = '7fc8ff6c-f082-4f54-a015-df0bb49ae61a';   // fixture student: 1 present, 1 absent
let pass = 0, fail = 0;
const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log(`  ${c ? 'PASS' : 'FAIL'}  ${m}${x ? '  ' + x : ''}`); };
const apiLogin = async (email, password) => (await (await fetch(API + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })).json()).data?.accessToken;

async function login(page, loginPage, email, password) {
  await page.goto(`${FE}/${loginPage}`, 800);
  await page.eval('localStorage.clear(); true');
  await page.goto(`${FE}/${loginPage}`, 800);
  await page.waitFor(`typeof handleLogin === 'function'`, 15000);
  await page.eval(`document.getElementById('email').value=${JSON.stringify(email)}; document.getElementById('password').value=${JSON.stringify(password)}; handleLogin(); true`);
  await page.waitFor(`!location.pathname.endsWith('${loginPage}')`, 15000);
  await page.waitFor(`typeof api === 'object'`, 15000);
}
// Capture what the page "downloads": patch <a>.click to record the filename and blob bytes
const CAPTURE = `window.__dl = []; HTMLAnchorElement.prototype.click = function () {
  if (this.download) fetch(this.href).then(r => r.arrayBuffer()).then(b => window.__dl.push({ name: this.download, size: b.byteLength,
    head: String.fromCharCode(...new Uint8Array(b).slice(0, 5)) }));
}; true`;

(async () => {
  const { proc, wsUrl } = await launch(); const b = new Browser(wsUrl); await b.connect();
  try {
    // ── 1. Parent portal on the shared api.js ───────────────────
    console.log('== 1. Parent portal uses shared api.js');
    const P = await b.newPage();
    await login(P, 'parent-login.html', G.parent.email, 'Pass#2026');
    ok((await P.url()).endsWith('parent-dashboard.html'), 'parent login lands on parent-dashboard');
    ok(await P.waitFor(`document.body.innerText.includes('S 1')`, 10000), 'child rendered');
    ok(await P.eval(`typeof apiFetch === 'function' && getToken() === localStorage.getItem('parent_token')`), 'page uses api.js with parent_token');
    await P.eval(`localStorage.setItem('parent_token', 'expired.token'); true`); P.requests.length = 0;
    const r = await P.eval(`Promise.all([apiFetch('/parent/children'), apiFetch('/parent/profile'), apiFetch('/parent/children')]).then(x => x.map(y => !!(y && y.success)))`);
    ok(r.every(Boolean), '3 parallel calls with an expired token succeed', JSON.stringify(r));
    ok(P.requests.filter(q => q.url.endsWith('/auth/refresh')).length === 1, 'exactly one /auth/refresh');
    ok(await P.eval(`localStorage.getItem('parent_token') !== 'expired.token' && !localStorage.getItem('asms_token')`), 'new token stored under parent_token only');
    for (const t of ['grades', 'attendance', 'fees', 'timetable']) { await P.eval(`showTab('${t}'); true`); await sleep(1000); }
    ok(P.errors.length === 0, 'all tabs load without JS errors', P.errors.slice(0, 2).join(' | '));

    // ── 2b. Parent report card download ─────────────────────────
    console.log('== 2. Downloads');
    await P.eval(CAPTURE);
    await P.eval(`document.getElementById('rcLink').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); true`);
    ok(await P.waitFor(`window.__dl.length > 0`, 10000), 'report card link triggers an authenticated download');
    const rc = await P.eval('window.__dl[0]');
    ok(rc && /^report-card-.+\.pdf$/.test(rc.name) && rc.head === '%PDF-' && rc.size > 1000, 'report card: server filename and a real PDF', JSON.stringify(rc));

    P.requests.length = 0;
    await P.eval(`logout(); true`);
    ok(await P.waitFor(`location.pathname.endsWith('parent-login.html')`), 'parent logout() lands on parent-login.html');
    ok(P.requests.some(q => q.url.endsWith('/auth/logout')), 'parent logout() revokes via POST /auth/logout');
    await login(P, 'parent-login.html', G.parent.email, 'Pass#2026');
    await P.send('Network.deleteCookies', { name: 'refreshToken', domain: 'localhost' });
    await P.eval(`localStorage.setItem('parent_token','bad'); apiFetch('/parent/children'); true`);
    ok(await P.waitFor(`location.pathname.endsWith('parent-login.html')`), 'failed refresh sends a parent to parent-login.html (not the staff login)');

    // ── 2a. Document downloads (admin + teachers) ───────────────
    const A = await b.newPage();
    await login(A, 'login.html', 'admin@asms.et', 'Admin@1234');
    const adminTok = await A.eval(`localStorage.getItem('asms_token')`);
    const tAtok = await apiLogin(G.tA.email, 'Pass#2026');
    const upload = async (tok, name, priv) => {
      const fd = new FormData();
      fd.append('file', new Blob([Buffer.from('%PDF-1.4\n% test document\n')], { type: 'application/pdf' }), name);
      fd.append('title', 'DL ' + name); fd.append('category', 'report'); fd.append('is_private', String(priv));
      return (await (await fetch(API + '/documents/upload', { method: 'POST', headers: { Authorization: `Bearer ${tok}` }, body: fd })).json()).data;
    };
    const amharic = await upload(adminTok, 'የተማሪ ሰነድ.pdf', false);
    const privA = await upload(tAtok, 'teacher-a-private.pdf', true);
    await A.goto(`${FE}/documents.html`, 2500); await A.eval(CAPTURE);
    ok(!(await A.eval(`!!document.querySelector('a[href*="/documents/download/"]')`)), 'no token-less download links remain');
    await A.eval(`[...document.querySelectorAll('.doc-card')].find(c => c.innerText.includes('DL የተማሪ'))?.querySelector('button.btn-ghost')?.click(); true`);
    ok(await A.waitFor(`window.__dl.length > 0`, 10000), 'document download triggers');
    const d1 = await A.eval('window.__dl[0]');
    ok(d1 && d1.name === 'የተማሪ ሰነድ.pdf' && d1.head === '%PDF-', 'Amharic filename preserved from Content-Disposition', JSON.stringify(d1));

    const TB = await b.newPage();
    await login(TB, 'login.html', G.tB.email, 'Pass#2026');
    TB.requests.length = 0;
    await TB.eval(CAPTURE);
    await TB.eval(`downloadFile('/documents/download/${privA.id}', 'x.pdf'); true`);
    await sleep(1500);
    ok((await TB.eval('window.__dl.length')) === 0 && await TB.eval(`[...document.querySelectorAll('.toast')].some(t => t.textContent.includes('Document not found'))`),
      "teacher B cannot download teacher A's private document (error toast, no file)");
    for (const id of [amharic.id, privA.id]) await fetch(`${API}/documents/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${adminTok}` } });

    // ── 3. Finance hidden from teachers ─────────────────────────
    console.log('== 3. Finance UI hidden from teachers');
    const T = await b.newPage();
    await login(T, 'login.html', G.tA.email, 'Pass#2026');
    T.requests.length = 0;
    await T.goto(`${FE}/dashboard.html`, 2500);
    ok(!(await T.eval(`!!document.querySelector('[data-finance]') || !!document.querySelector('a[href="finance.html"]')`)), 'teacher dashboard: no finance panel or links');
    T.requests.length = 0;
    await T.goto(`${FE}/student-detail.html?id=${ABEBE}`, 2500);
    ok(!T.requests.some(q => q.url.includes('/finance/')), 'teacher student page: no /finance request');
    ok(await T.eval(`![...document.querySelectorAll('.panel')].some(p => p.offsetParent !== null && p.innerText.includes('Fee Balance'))`), 'teacher student page: fee panel not shown');
    await T.goto(`${FE}/finance.html`, 2000);
    ok((await T.url()).endsWith('dashboard.html'), 'teacher opening finance.html is sent to the dashboard');
    ok(T.errors.length === 0, 'no JS errors for teacher', T.errors.slice(0, 2).join(' | '));
    await A.goto(`${FE}/dashboard.html`, 2500);
    ok(await A.eval(`!!document.querySelector('[data-finance]') && !!document.querySelector('a[href="finance.html"]') && !document.getElementById('financeSummary').innerText.includes('Loading')`), 'admin still sees finance panel and link');

    // ── 4. Attendance card reads stats ──────────────────────────
    console.log('== 4. Student page attendance card');
    for (const p of ['student-detail.html', 'student-detail-new.html']) {
      await A.goto(`${FE}/${p}?id=${ABEBE}`, 2500);
      const txt = await A.eval(`[...document.querySelectorAll('.panel')].find(x => x.innerText.includes('Attendance'))?.innerText.replace(/\\s+/g, ' ')`);
      ok(/50(\.0)?%/.test(txt) && /1 Present/.test(txt) && /1 Absent/.test(txt), `${p}: shows rate 50%, 1 present, 1 absent`, txt);
      ok(await A.eval(`[...document.querySelectorAll('.panel')].some(x => x.offsetParent !== null && x.innerText.includes('Fee Balance'))`), `${p}: admin still sees fee panel`);
    }
    await A.goto(`${FE}/student-detail.html?id=${G.s2.sid}`, 2500);
    ok(await A.eval(`[...document.querySelectorAll('.panel')].find(x => x.innerText.includes('Attendance'))?.innerText.includes('No attendance')`), 'student without records: "No attendance yet"');
    ok(A.errors.length === 0, 'no JS errors for admin', A.errors.slice(0, 2).join(' | '));
  } catch (e) { fail++; console.log('  FAIL  harness error:', e.message); }
  finally { console.log(`\nPASS=${pass} FAIL=${fail}`); proc.kill(); process.exit(0); }
})();
