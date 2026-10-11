// Minimal Chrome DevTools Protocol client for headless Edge (no dependencies).
//
// Each launch() uses a new, empty temporary profile that close() deletes,
// so no browsing data (Edge may import it at start) is kept between runs.
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EDGE = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9333;
const LOAD_TIMEOUT = Number(process.env.PAGE_LOAD_TIMEOUT || 15000);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Is something already answering on the debugging port?
async function portInUse() {
  try { await fetch(`http://localhost:${PORT}/json/version`, { signal: AbortSignal.timeout(1000) }); return true; }
  catch { return false; }
}

async function launch() {
  if (await portInUse()) {
    throw new Error(`port ${PORT} is already in use (another browser with remote debugging?). ` +
                    'Close it and run the tests again.');
  }

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'asms-test-edge-'));
  const proc = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync', 'about:blank',
  ], { stdio: 'ignore' });
  let exitCode = null;
  proc.on('exit', (code) => { exitCode = code ?? 'signal'; });

  // Kill Edge's whole process tree, then delete the profile (retries while files are still locked)
  let closed = false;
  const closeSync = () => {
    if (closed) return; closed = true;
    try { execFileSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* already gone */ }
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }); } catch { /* reported below */ }
    if (fs.existsSync(profile)) console.error(`WARNING: could not delete temporary Edge profile ${profile}`);
  };
  process.on('exit', closeSync);   // safety net if a suite exits without close()
  const close = async () => closeSync();

  for (let i = 0; i < 50; i++) {
    if (exitCode !== null) { closeSync(); throw new Error(`Edge exited during start (exit code ${exitCode})`); }
    try {
      const v = await (await fetch(`http://localhost:${PORT}/json/version`)).json();
      return { proc, wsUrl: v.webSocketDebuggerUrl, close, profile };
    } catch { await sleep(200); }
  }
  closeSync();
  throw new Error('Edge did not start');
}

class Browser {
  constructor(wsUrl) { this.wsUrl = wsUrl; this.id = 0; this.pending = new Map(); this.listeners = []; }
  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((ok, err) => { this.ws.onopen = ok; this.ws.onerror = err; });
    this.ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { ok, err } = this.pending.get(msg.id); this.pending.delete(msg.id);
        msg.error ? err(new Error(msg.error.message)) : ok(msg.result);
      } else if (msg.method) this.listeners.forEach(l => l(msg));
    };
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((ok, err) => this.pending.set(id, { ok, err }));
  }
  // New isolated context (own cookies + localStorage) with one page
  async newPage() {
    const { browserContextId } = await this.send('Target.createBrowserContext');
    const { targetId } = await this.send('Target.createTarget', { url: 'about:blank', browserContextId });
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    const page = new Page(this, sessionId);
    await page.init();
    return page;
  }
}

class Page {
  constructor(b, sessionId) {
    this.b = b; this.s = sessionId; this.errors = []; this.requests = []; this.dialogs = [];
    this.netErrors = []; this.reqUrls = new Map(); this.loads = 0;
  }
  send(m, p) { return this.b.send(m, p, this.s); }
  async init() {
    this.b.listeners.push((msg) => {
      if (msg.sessionId !== this.s) return;
      const p = msg.params;
      if (msg.method === 'Runtime.exceptionThrown') this.errors.push(p.exceptionDetails.exception?.description || p.exceptionDetails.text);
      if (msg.method === 'Runtime.consoleAPICalled' && p.type === 'error') this.errors.push('console.error: ' + p.args.map(a => a.value ?? a.description).join(' '));
      if (msg.method === 'Network.requestWillBeSent') {
        this.requests.push({ url: p.request.url, method: p.request.method });
        this.reqUrls.set(p.requestId, p.request.url);
      }
      // Failed requests and HTTP errors, for diagnostics (last 20)
      if (msg.method === 'Network.loadingFailed' && !p.canceled) this.netError(`${this.reqUrls.get(p.requestId) || '?'} -> ${p.errorText}`);
      if (msg.method === 'Network.responseReceived' && p.response.status >= 400) this.netError(`${p.response.url} -> HTTP ${p.response.status}`);
      if (msg.method === 'Page.loadEventFired') this.loads++;
      if (msg.method === 'Page.javascriptDialogOpening') {
        this.dialogs.push(p.message);
        this.send('Page.handleJavaScriptDialog', { accept: true });
      }
    });
    await this.send('Page.enable'); await this.send('Runtime.enable'); await this.send('Network.enable');
  }
  netError(line) { this.netErrors.push(line); if (this.netErrors.length > 20) this.netErrors.shift(); }

  // What the tab is showing right now, for error messages
  async describe() {
    let state = {};
    try {
      const r = await this.send('Runtime.evaluate', {
        expression: 'JSON.stringify({ href: location.href, readyState: document.readyState, title: document.title })',
        returnByValue: true });
      state = JSON.parse(r.result.value);
    } catch (e) { state = { href: `(unavailable: ${e.message})` }; }
    return [`page: ${state.href}`, `readyState: ${state.readyState}`, `title: ${JSON.stringify(state.title)}`,
            `network errors: ${this.netErrors.length ? '\n      ' + this.netErrors.join('\n      ') : 'none'}`,
            `page errors: ${this.errors.length ? '\n      ' + this.errors.slice(-5).join('\n      ') : 'none'}`]
      .join('\n    ');
  }

  // Navigate, wait for the page's load event and check the tab is on that site,
  // then give the page's own scripts settleMs to run.
  async goto(url, settleMs = 1500) {
    const before = this.loads;
    const nav = await this.send('Page.navigate', { url });
    const fail = async (why) => { throw new Error(`page did not load: ${url} (${why})\n    ${await this.describe()}`); };
    if (nav.errorText) await fail(nav.errorText);

    const end = Date.now() + LOAD_TIMEOUT;
    while (this.loads === before && Date.now() < end) await sleep(50);
    if (this.loads === before) await fail(`no load event within ${LOAD_TIMEOUT} ms`);

    // The app may redirect (e.g. to login.html), but it must stay on the same site
    const origin = new URL(url).origin;
    const r = await this.send('Runtime.evaluate', { expression: 'location.origin', returnByValue: true });
    if (r.result.value !== origin) await fail(`tab is on ${r.result.value}, expected ${origin}`);

    await sleep(settleMs);
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) {
      throw new Error('eval failed: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text) +
                      `\n    ${await this.describe()}`);
    }
    return r.result.value;
  }
  url() { return this.eval('location.pathname'); }
  async waitFor(expr, timeoutMs = 8000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      try { if ((await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value) return true; }
      catch { /* keep waiting */ }
      await sleep(150);
    }
    return false;
  }
  async cookies() { return (await this.send('Network.getCookies', { urls: ['http://localhost:3100', 'http://127.0.0.1:3100'] })).cookies; }
}

module.exports = { launch, Browser, sleep };
