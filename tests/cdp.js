// Minimal Chrome DevTools Protocol client for headless Edge (no dependencies).
const { spawn } = require('child_process');
const path = require('path');

const EDGE = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PROFILE = path.join(__dirname, 'edge-profile');
const PORT = 9333;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function launch() {
  const proc = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', 'about:blank',
  ], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { const v = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); return { proc, wsUrl: v.webSocketDebuggerUrl }; }
    catch { await sleep(200); }
  }
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
  constructor(b, sessionId) { this.b = b; this.s = sessionId; this.errors = []; this.requests = []; this.dialogs = []; }
  send(m, p) { return this.b.send(m, p, this.s); }
  async init() {
    this.b.listeners.push((msg) => {
      if (msg.sessionId !== this.s) return;
      if (msg.method === 'Runtime.exceptionThrown') this.errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') this.errors.push('console.error: ' + msg.params.args.map(a => a.value ?? a.description).join(' '));
      if (msg.method === 'Network.requestWillBeSent') this.requests.push({ url: msg.params.request.url, method: msg.params.request.method });
      if (msg.method === 'Page.javascriptDialogOpening') {
        this.dialogs.push(msg.params.message);
        this.send('Page.handleJavaScriptDialog', { accept: true });
      }
    });
    await this.send('Page.enable'); await this.send('Runtime.enable'); await this.send('Network.enable');
  }
  async goto(url, settleMs = 1500) {
    await this.send('Page.navigate', { url });
    await sleep(settleMs);
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('eval failed: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
  url() { return this.eval('location.pathname'); }
  async waitFor(expr, timeoutMs = 8000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) { try { if (await this.eval(expr)) return true; } catch {} await sleep(150); }
    return false;
  }
  async cookies() { return (await this.send('Network.getCookies', { urls: ['http://localhost:3100', 'http://127.0.0.1:3100'] })).cookies; }
}

module.exports = { launch, Browser, sleep };
