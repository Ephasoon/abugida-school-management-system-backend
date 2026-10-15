// Group 5 browser tests: headless Edge via CDP against the scratch-DB backend (:3100)
// and the static frontend (:5599). Run with the guard (DB_NAME=asms_phase0_test).
const { launch, Browser, sleep } = require('./cdp');
const G = require('./g3.json');
const API = 'http://localhost:3100/api';
const FE = 'http://localhost:5599';
let pass = 0, fail = 0;
const ok = (cond, label, extra = '') => { cond ? pass++ : fail++; console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`); };
const call = async (method, p, token, body) => {
  const r = await fetch(API + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const apiLogin = async (email, password) => (await call('POST', '/auth/login', null, { email, password })).body?.data?.accessToken;

async function uiLogin(page, base, email, password) {
  await page.goto(`${base}/login.html`, 800);
  await page.eval(`localStorage.clear(); true`);
  await page.goto(`${base}/login.html`, 800);
  await page.waitFor(`typeof handleLogin === 'function'`, 15000);
  await page.eval(`document.getElementById('email').value=${JSON.stringify(email)};
                   document.getElementById('password').value=${JSON.stringify(password)}; handleLogin(); true`);
  await page.waitFor(`!location.pathname.endsWith('login.html')`);
}

(async () => {
  const { close, wsUrl } = await launch();
  const b = new Browser(wsUrl); await b.connect();
  try {
    // ── 1. Every page loads as admin without JS errors ──────────
    console.log('== 1. Page smoke test (admin)');
    const A = await b.newPage();
    await uiLogin(A, FE, 'admin@asms.et', 'Admin@1234');
    ok((await A.url()).endsWith('dashboard.html'), 'admin login lands on dashboard');
    const pages = ['dashboard', 'students', 'teachers', 'teacher-assignments', 'attendance', 'grades', 'exam-schedule',
      'finance', 'timetable', 'documents', 'academic-years', 'analytics',
      `student-detail.html?id=${G.s1.sid}`, `student-detail-new.html?id=${G.s1.sid}`];
    for (const p of pages) {
      A.errors.length = 0;
      await A.goto(`${FE}/${p.includes('.html') ? p : p + '.html'}`, 2200);
      ok(A.errors.length === 0, `no JS errors: ${p.split('?')[0]}`, A.errors.slice(0, 2).join(' | '));
    }
    ok(await A.waitFor(`document.getElementById('pageTitle')?.innerText.includes('S 1')`), 'student-detail renders the student (was a SyntaxError before)', await A.eval(`document.getElementById('pageTitle')?.innerText`));
    const adminToken = await A.eval(`localStorage.getItem('asms_token')`);

    // ── 2. XSS payloads render as text ─────────────────────────
    console.log('== 2. XSS');
    const XSS = `<img src=x onerror="window.__xss=1">"');window.__xss=2;//`;
    const st = await call('POST', '/students', adminToken, { first_name: XSS, last_name: 'Payload', gender: 'male', class_id: G.c9A });
    ok(st.status === 201, 'create student with HTML/JS payload name');
    const fd = new FormData();
    fd.append('file', new Blob([Buffer.from('%PDF-1.4\n')], { type: 'application/pdf' }), 'x.pdf');
    fd.append('title', XSS); fd.append('category', 'report'); fd.append('description', XSS); fd.append('is_private', 'false');
    const up = await (await fetch(API + '/documents/upload', { method: 'POST', headers: { Authorization: `Bearer ${adminToken}` }, body: fd })).json();
    ok(up.success, 'upload document with payload title/description');
    await call('POST', '/finance/payments', adminToken, { student_id: st.body.data.id, amount_due: 100, amount_paid: 10, payment_method: 'cash', payment_date: '2026-10-07' });
    for (const [p, sel] of [['students.html?x', '#studentsBody'], ['documents.html', '#docsList, .doc-title'], ['attendance.html', '#attendanceBody'], ['finance.html', 'body']]) {
      await A.eval('window.__xss = undefined; true');
      await A.goto(`${FE}/${p}`, 2500);
      const fired = await A.eval('window.__xss');
      const shown = await A.eval(`document.body.innerText.includes(${JSON.stringify('<img src=x onerror=')}) || [...document.querySelectorAll('option')].some(o=>o.text.includes(${JSON.stringify('<img src=x onerror=')}))`);
      ok(fired === undefined && shown, `${p.split('?')[0]}: payload shown as text, not executed`, `xss=${fired} visibleAsText=${shown}`);
    }
    await A.goto(`${FE}/documents.html`, 2500);
    const delArgs = await A.eval(`(() => { const b=[...document.querySelectorAll('button[onclick^="deleteDoc"]')].find(x=>x.getAttribute('onclick').includes('Payload')||x.getAttribute('onclick').includes('img')); if(!b) return null;
       let got=null; const orig=window.deleteDoc; window.deleteDoc=(id,t)=>{got=t}; b.click(); window.deleteDoc=orig; return got; })()`);
    ok(delArgs === XSS, 'inline onclick receives the exact title (no JS breakout)');
    await call('DELETE', `/documents/${up.data.id}`, adminToken);

    // ── 3. Assignment screen ───────────────────────────────────
    console.log('== 3. Teacher assignment screen');
    await A.goto(`${FE}/teacher-assignments.html`, 2500);
    const opts = await A.eval(`['a_teacher','a_class','a_subject'].map(id=>document.getElementById(id).options.length)`);
    ok(opts.every(n => n > 1), 'teacher/class/subject dropdowns populated', JSON.stringify(opts));
    const tB = await apiLogin(G.tB.email, 'Pass#2026');
    const exam = (cls, sub) => call('POST', '/grades/exams', tB, { class_id: cls, subject_id: sub, name: 'UI-assign check', exam_type: 'quiz', term: 'term1', max_score: 1 });
    ok((await exam(G.c9B, G.eng)).status === 403, 'before: teacher B cannot create 9B English exam');
    await A.eval(`document.getElementById('a_teacher').value=${JSON.stringify(G.tB.tid)};
                  document.getElementById('a_class').value=${JSON.stringify(G.c9B)};
                  document.getElementById('a_subject').value=${JSON.stringify(G.eng)}; assign(); true`);
    // The row for teacher B (by email) in 9 Section B / English; other teachers' rows don't count
    ok(await A.waitFor(`[...document.querySelectorAll('#assignmentsBody tr')].some(tr=>tr.innerText.includes(${JSON.stringify(G.tB.email)}) && tr.innerText.includes('9 Section B') && tr.innerText.includes('English'))`), 'new row appears in table');
    const tableText = await A.eval(`document.getElementById('assignmentsBody').innerText`);
    console.log('     table:', tableText.replace(/\s*Remove\s*/g, ' | ').replace(/\s+/g, ' ').trim());
    const e1 = await exam(G.c9B, G.eng);
    ok(e1.status === 201, 'after: teacher B creates 9B English exam');
    ok((await call('POST', '/grades', tB, { exam_id: e1.body.data.id, grades: [{ student_id: G.s3.sid, score: 0.77 }] })).status === 200, 'after: teacher B enters grade for 9B student');
    ok((await exam(G.c9A, G.eng)).status === 403, 'still blocked: 9A English');
    ok((await exam(G.c9B, G.math)).status === 403, 'still blocked: 9B Math');
    ok((await call('POST', '/grades', tB, { exam_id: e1.body.data.id, grades: [{ student_id: G.s1.sid, score: 0.5 }] })).status === 403, 'still blocked: grade for a 9A student on that exam');
    A.dialogs.length = 0;
    await A.eval(`[...document.querySelectorAll('#assignmentsBody tr')].find(tr=>tr.innerText.includes('English') && tr.innerText.includes('9 Section B'))?.querySelector('button')?.click(); true`);
    ok(await A.waitFor(`![...document.querySelectorAll('#assignmentsBody tr')].some(tr=>tr.innerText.includes('English') && tr.innerText.includes('9 Section B'))`), 'Remove (after confirm dialog) deletes the row', `dialog: ${A.dialogs[0] || 'none'}`);
    ok((await exam(G.c9B, G.eng)).status === 403, 'after removal: teacher B blocked again');

    // ── 4. Temporary password modal ────────────────────────────
    console.log('== 4. New teacher: one-time password modal');
    await A.goto(`${FE}/teachers.html`, 2000);
    ok(!(await A.eval(`document.documentElement.innerHTML.includes('Teacher@1234')`)), 'page contains no Teacher@1234');
    const email = `ui.teacher.${Date.now()}@asms.et`;
    await A.eval(`openAddModal(); document.getElementById('t_firstName').value='Hana'; document.getElementById('t_lastName').value='Bekele';
                  document.getElementById('t_email').value=${JSON.stringify(email)}; saveTeacher(); true`);
    ok(await A.waitFor(`document.getElementById('tempPasswordModal').classList.contains('open')`), 'modal opens after save');
    const tempPw = await A.eval(`document.getElementById('tp_password').value`);
    ok(/^[A-Za-z0-9]{12}$/.test(tempPw), 'modal shows 12-char temporary password');
    ok(await A.eval(`document.getElementById('tp_email').textContent === ${JSON.stringify(email)}`), 'modal shows login email');
    ok(await A.eval(`document.getElementById('tempPasswordModal').innerText.includes('only once')`), 'modal says it is shown only once');
    await A.eval(`copyTempPassword(); true`); await sleep(300);
    await A.eval(`closeTempPasswordModal(); true`);
    ok(await A.eval(`document.getElementById('tp_password').value === '' && !document.getElementById('tempPasswordModal').classList.contains('open')`), 'closing clears the password from the page');

    // ── 5. Forced password change flow (fresh browser context) ──
    console.log('== 5. Must-change-password redirect');
    const T = await b.newPage();
    await uiLogin(T, FE, email, tempPw);
    ok(await T.waitFor(`location.pathname.endsWith('change-password.html')`), 'first API call (403 PASSWORD_CHANGE_REQUIRED) redirects to change-password.html');
    await T.eval(`document.getElementById('currentPassword').value='wrong-password';
                  document.getElementById('newPassword').value='Hana#Strong2026'; document.getElementById('confirmPassword').value='Hana#Strong2026'; changePassword(); true`);
    ok(await T.waitFor(`document.getElementById('errorMsg').style.display==='block'`), 'wrong current password shows an error');
    ok((await T.url()).endsWith('change-password.html'), '...and does NOT log the user out');
    await T.eval(`document.getElementById('currentPassword').value=${JSON.stringify(tempPw)}; changePassword(); true`);
    ok(await T.waitFor(`location.pathname.endsWith('dashboard.html')`), 'successful change returns to dashboard');
    await sleep(2500);
    ok((await T.url()).endsWith('dashboard.html') && T.errors.length === 0, 'stays on dashboard (gate lifted), no JS errors', T.errors.join(' | '));

    // ── 6. Single-flight refresh on 401 ────────────────────────
    console.log('== 6. Refresh-on-401');
    await A.goto(`${FE}/students.html`, 2000);
    const before = await A.eval(`localStorage.getItem('asms_token')`);
    await A.eval(`localStorage.setItem('asms_token', 'expired.or.invalid.token'); true`);
    A.requests.length = 0;
    const results = await A.eval(`Promise.all([api.get('/students?limit=1'), api.get('/teachers'), api.get('/timetable/classes'), api.get('/teachers/subjects'), api.get('/exam-schedule/upcoming')]).then(r=>r.map(x=>x&&x.success))`);
    const refreshes = A.requests.filter(r => r.url.endsWith('/auth/refresh')).length;
    ok(results.every(Boolean), '5 parallel requests with a bad token all succeed after refresh', JSON.stringify(results));
    ok(refreshes === 1, 'exactly ONE /auth/refresh call for 5 parallel 401s', `refresh calls: ${refreshes}`);
    const after = await A.eval(`localStorage.getItem('asms_token')`);
    ok(after && after !== 'expired.or.invalid.token' && after !== before, 'new access token stored');
    const ck = (await A.cookies()).find(c => c.name === 'refreshToken');
    ok(ck && ck.httpOnly && ck.sameSite === 'Strict', 'refresh cookie is HttpOnly + SameSite=Strict and was sent cross-port', ck ? `${ck.domain} httpOnly=${ck.httpOnly} sameSite=${ck.sameSite}` : 'missing');

    // ── 7. Logout revokes; failed refresh logs out ─────────────
    console.log('== 7. Logout and failed refresh');
    const cookieVal = ck.value;
    A.requests.length = 0;
    await A.eval(`logout(); true`);
    ok(await A.waitFor(`location.pathname.endsWith('login.html')`), 'logout() lands on login.html');
    ok(A.requests.some(r => r.url.endsWith('/auth/logout') && r.method === 'POST'), 'logout() called POST /auth/logout');
    const r7 = await fetch(API + '/auth/refresh', { method: 'POST', headers: { Cookie: `refreshToken=${cookieVal}` } });
    ok(r7.status === 401, 'the pre-logout refresh token is revoked server-side');
    await uiLogin(A, FE, 'admin@asms.et', 'Admin@1234');
    await A.goto(`${FE}/students.html`, 1500);
    await A.send('Network.deleteCookies', { name: 'refreshToken', domain: 'localhost' });
    await A.eval(`localStorage.setItem('asms_token','bad'); api.get('/students'); true`);
    ok(await A.waitFor(`location.pathname.endsWith('login.html')`), 'when refresh fails, the user is logged out to login.html');

    // ── 8. Opening the frontend via 127.0.0.1 ──────────────────
    console.log('== 8. 127.0.0.1 origin (hostname-matched API base)');
    const C = await b.newPage();
    await uiLogin(C, 'http://127.0.0.1:5599', 'admin@asms.et', 'Admin@1234');
    await C.waitFor(`!!window.ASMS_CONFIG && typeof api === 'object'`, 15000);
    console.log('     landed on:', await C.eval('location.href'), '| JS errors:', C.errors.length);
    ok((await C.url()).endsWith('dashboard.html'), 'admin login via 127.0.0.1 lands on dashboard');
    ok(await C.eval(`window.ASMS_CONFIG.API_BASE === 'http://127.0.0.1:3100/api'`), 'API_BASE follows the page hostname', await C.eval('window.ASMS_CONFIG.API_BASE'));
    await C.eval(`localStorage.setItem('asms_token','bad'); true`);
    C.requests.length = 0;
    ok(await C.eval(`api.get('/students?limit=1').then(r=>!!(r&&r.success))`), 'refresh works from 127.0.0.1 too');
  } catch (e) {
    fail++; console.log('  FAIL  harness error:', e.message);
  } finally {
    console.log(`\nPASS=${pass} FAIL=${fail}`);
    await close();
    process.exit(0);
  }
})();
