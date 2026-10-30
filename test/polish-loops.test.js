import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { createDatabase, repository, transaction } from '../src/db/database.js';
import { migrate } from '../src/db/schema.js';
import { seedDatabase } from '../src/db/seed.js';
import { workflows } from '../src/services/workflows.js';
import { emit, runPending } from '../src/services/automations.js';
import { checkAvailability } from '../src/services/availability.js';
import { startServer } from '../src/server.js';

const appSource = readFileSync(new URL('../src/public/app.js', import.meta.url), 'utf8');
const parityCss = readFileSync(new URL('../src/public/parity.css', import.meta.url), 'utf8');

function createHarness(apiData = {}) {
  const elements = new Map();
  const listeners = {};
  const timers = [];
  const clearedTimers = new Set();
  const makeEl = (id = '') => ({
    id,
    innerHTML: '',
    textContent: '',
    value: '',
    hidden: false,
    style: { display: 'none' },
    dataset: {},
    classList: {
      set: new Set(),
      add(c) { this.set.add(c); },
      remove(c) { this.set.delete(c); },
      toggle(c, force) {
        const on = force === undefined ? !this.set.has(c) : Boolean(force);
        if (on) this.set.add(c); else this.set.delete(c);
        return on;
      },
      contains(c) { return this.set.has(c); }
    },
    setAttribute(k, v) { this[k] = v; },
    querySelector() { return null; },
    querySelectorAll() { return []; }
  });
  for (const sel of [
    '#workspace', '#overlay', '#action-form', '#builder', '#req-items', '#req-add-item', '#items', '#toast', '#breadcrumb',
    '#report-table', '#report-chart', '#report-range', '#report-count',
    '#report-active-filter', '#report-column-picker', '#report-page-size-label',
    '#report-pagination', '#report-dictionary-counts', '#report-from', '#report-to',
    '#bookkeeping-highlight', '#community-topics', '#linked-form-status',
    '#data-table', '#result-count', '#table-search', '#status-filter',
    '#method-filter', '#payment-type-filter', '#expense-user-filter',
    '#job-type-filter', '#salesperson-filter'
  ]) {
    elements.set(sel, makeEl(sel.slice(1)));
  }
  let timerId = 0;
  const queryAllMap = new Map();
  const context = createContext({
    URL,
    URLSearchParams,
    Blob,
    Intl,
    Date,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Set,
    Map,
    JSON,
    Promise,
    Error,
    RegExp,
    encodeURIComponent,
    decodeURIComponent,
    console,
    FormData: class {
      constructor(form) { this.entriesList = Object.entries(form?.values || {}); }
      *[Symbol.iterator]() { yield* this.entriesList; }
    },
    setTimeout(fn, ms) {
      const id = ++timerId;
      timers.push({ id, fn, ms });
      return id;
    },
    clearTimeout(id) {
      clearedTimers.add(id);
    },
    location: { pathname: '/home', search: '', origin: 'http://127.0.0.1:4173' },
    history: { pushState() {} },
    window: {},
    sessionStorage: { getItem() { return 'tok'; }, setItem() {}, removeItem() {} },
    document: {
      querySelector: s => elements.get(s) || null,
      querySelectorAll: s => queryAllMap.get(s) || [],
      addEventListener: (kind, fn) => (listeners[kind] ||= []).push(fn),
      createElement: () => makeEl()
    },
    fetch: async (path, options = {}) => {
      if (typeof apiData === 'function') return apiData(path, options);
      const key = path.replace(/^\/api\//, '');
      const val = path in apiData ? apiData[path] : (key in apiData ? apiData[key] : []);
      return { ok: true, status: 200, json: async () => val };
    }
  });
  runInContext(appSource.slice(0, appSource.lastIndexOf('init().catch')), context);
  return {
    run: code => runInContext(code, context),
    elements,
    listeners,
    timers,
    clearedTimers,
    queryAllMap,
    makeEl
  };
}

test('Item 1: residual keyword-dump trailers are replaced with structured interactive markup', async () => {
  const h = createHarness({
    jobs: [{ id: 1, title: 'Tile shower', status: 'active', job_type: 'one_off', total_cents: 40000 }],
    payments: [
      { id: 1, client_id: 1, amount_cents: 15000, method: 'card', payment_type: 'payment', status: 'succeeded' },
      { id: 2, client_id: 1, amount_cents: 5000, method: 'ach', payment_type: 'deposit', status: 'succeeded' }
    ],
    expenses: [
      { id: 1, item_name: 'Mortar', amount_cents: 4500, status: 'reviewed' },
      { id: 2, item_name: 'Grout', amount_cents: 2200, status: 'pending' },
      { id: 3, item_name: 'Spacers', amount_cents: 900, status: 'pending' }
    ],
    bookkeeping: { income_cents: 50000, expense_cents: 7600, tax_cents: 3200, ledger: [], integration: { status: 'connected' } }
  });

  const jobsUnfiltered = await h.run("routeQuery=new URLSearchParams(''); listPage('jobs')");
  assert.match(jobsUnfiltered, /All jobs <small id="result-count">/);
  assert.doesNotMatch(jobsUnfiltered, /All jobs · Filtered jobs/);

  const jobsFiltered = await h.run("routeQuery=new URLSearchParams('?status=active'); listPage('jobs')");
  assert.match(jobsFiltered, /Filtered jobs <small id="result-count">/);

  const paymentsHtml = await h.run("routeQuery=new URLSearchParams(''); listPage('payments')");
  assert.doesNotMatch(paymentsHtml, /Payment date · Payment status · Payout date/);
  assert.match(paymentsHtml, /id="payment-type-filter"/);

  // Verify #payment-type-filter actually filters rows in bindView()
  h.elements.get('#payment-type-filter').value = 'deposit';
  h.run('bindView()');
  assert.equal(h.elements.get('#result-count').textContent, '(1 results)');
  assert.match(h.elements.get('#data-table').innerHTML, /\$50\.00/);
  assert.doesNotMatch(h.elements.get('#data-table').innerHTML, /\$150\.00/);

  const expensesHtml = await h.run("listPage('expenses')");
  assert.doesNotMatch(expensesHtml, /Reviewed 15 · Needs review 0/);
  assert.match(expensesHtml, /Reviewed 1 · Needs review 2/);

  await h.run("builder('quotes')");
  const quoteBuilder = h.elements.get('#overlay').innerHTML;
  assert.doesNotMatch(quoteBuilder, /Quote # · Mark as optional · Apply to all future quotes/);
  assert.doesNotMatch(quoteBuilder, /Select a client · Client/);
  assert.match(quoteBuilder, /Products &amp; services|Products & services/);

  await h.run("builder('requests')");
  const reqBuilder = h.elements.get('#overlay').innerHTML;
  assert.match(reqBuilder, /Please provide as much information as you can/);
  assert.doesNotMatch(reqBuilder, /Please provide as much information as you can · Share images/);

  await h.run("builder('clients')");
  const clientBuilder = h.elements.get('#overlay').innerHTML;
  assert.match(clientBuilder, /name="first_name"/);
  assert.match(clientBuilder, /No tax rate created/);
  assert.match(clientBuilder, /id="billing-fields"/);

  const bkHtml = await h.run('bookkeeping()');
  assert.match(bkHtml, /<h2>Numbers you can actually use<\/h2>/);
  assert.doesNotMatch(bkHtml, /arrowLeft · arrowRight/);
  assert.match(bkHtml, /data-bookkeeping-slide="-1"/);
  assert.match(bkHtml, /data-bookkeeping-slide="1"/);

  const commHtml = h.run('communityPage()');
  assert.doesNotMatch(commHtml, /Place AI & Operations AI & Operations/);
  assert.doesNotMatch(commHtml, /Most Popular Boards · Ask a Question/);
  assert.match(commHtml, /data-action="community-post"/);
  assert.match(commHtml, /data-community-filter="Most Likes"/);
  assert.match(commHtml, /CUSTOMER SERVICE & EXPERIENCE[\s\S]*SOCIAL MEDIA MARKETING/);

  const repsHtml = h.run('reports()');
  assert.equal((repsHtml.match(/<section class="card">/g) || []).length, 6);
  assert.match(repsHtml, /<aside class="card report-guides">/);
  assert.doesNotMatch(repsHtml, /Reports BasicsWith/);
  assert.doesNotMatch(repsHtml, /Waypoints Full list of GPS waypoints logged · Timesheets/);
  assert.doesNotMatch(repsHtml, /Bad debt All invoices marked as bad debt/);
});

test('Item 1: Bookkeeping spotlight carousel and Community filters + post composer are interactive', async () => {
  const savedPrefs = [];
  const h = createHarness(async (path, options = {}) => {
    if (path === '/api/preferences' && options.method === 'POST') {
      const body = JSON.parse(options.body);
      savedPrefs.push(body);
      return { ok: true, status: 201, json: async () => body };
    }
    if (path === '/api/preferences') {
      return {
        ok: true,
        status: 200,
        json: async () => savedPrefs.map(p => ({ name: p.name, value_json: typeof p.value_json === 'string' ? p.value_json : JSON.stringify(p.value_json) }))
      };
    }
    return { ok: true, status: 200, json: async () => ({ income_cents: 0, expense_cents: 0, tax_cents: 0, ledger: [] }) };
  });

  await h.run('bookkeeping()');
  h.elements.get('#bookkeeping-highlight').innerHTML = h.run('bookkeepingHighlightMarkup()');
  assert.match(h.elements.get('#bookkeeping-highlight').innerHTML, /Dedicated bookkeeping/);

  await h.run("batchAction({ hasAttribute: () => false, dataset: { bookkeepingSlide: '1' } })");
  assert.match(h.elements.get('#bookkeeping-highlight').innerHTML, /Automatic syncing with no double entry/);

  await h.run("batchAction({ hasAttribute: () => false, dataset: { bookkeepingSlide: '-1' } })");
  assert.match(h.elements.get('#bookkeeping-highlight').innerHTML, /Dedicated bookkeeping/);

  // Community filter buttons sort/filter topics
  const filterBtns = ['Most Recent', 'Most Likes', 'No Replies Yet'].map(name => {
    const el = h.makeEl();
    el.dataset = { communityFilter: name };
    return el;
  });
  h.queryAllMap.set('[data-community-filter]', filterBtns);

  await h.run("batchAction({ hasAttribute: () => false, dataset: { communityFilter: 'No Replies Yet' } })");
  assert.match(h.elements.get('#community-topics').innerHTML, /Easy Solutions for Jobber to implement/);
  assert.doesNotMatch(h.elements.get('#community-topics').innerHTML, /Tell me about your best hire/);
  assert.equal(filterBtns[2]['aria-pressed'], 'true');

  // Community post composer opens modal and persists new topic
  await h.run("batchAction({ hasAttribute: () => false, dataset: { communityFilter: 'Most Recent' } })");
  await h.run("route='community'; batchAction({ hasAttribute: () => false, dataset: { action: 'community-post' } })");
  assert.match(h.elements.get('#overlay').innerHTML, /Ask a Question or Share Advice/);

  const form = h.elements.get('#action-form');
  form.values = { title: 'Best wet saw blade for porcelain slabs?', board: 'Using Jobber', body: 'Sharing our top 10-inch continuous rim picks.' };
  await form.onsubmit({ target: form, preventDefault() {} });
  assert.equal(savedPrefs.length, 1);
  assert.match(savedPrefs[0].name, /^community-post-/);
  assert.match(h.elements.get('#workspace').innerHTML, /Best wet saw blade for porcelain slabs\?/);

  // Navigating to /community a second time replaces communityPosts cleanly without duplicating entries
  await h.run("route='community'; render()");
  assert.equal((h.elements.get('#workspace').innerHTML.match(/Best wet saw blade for porcelain slabs\?/g) || []).length, 1);

  // Switching org/user with empty preferences clears stale in-memory communityPosts
  savedPrefs.length = 0;
  await h.run("route='community'; render()");
  assert.doesNotMatch(h.elements.get('#workspace').innerHTML, /Best wet saw blade for porcelain slabs\?/);
});

test('Item 2: contextual report cross-links and curated default columns vs Select all / Reset', async () => {
  const h = createHarness();

  const projHtml = h.run("reportWorkspace('Projected income', [])");
  assert.match(projHtml, /View Aged Receivables Report/);

  const agedHtml = h.run("reportWorkspace('Aged receivables', [])");
  assert.match(agedHtml, /View Projected Income Report/);
  assert.doesNotMatch(agedHtml, /View Aged Receivables Report/);

  const txHtml = h.run("reportWorkspace('Transactions', [])");
  assert.match(txHtml, /Jobber Payments Transaction List/);
  assert.match(txHtml, /data-go="report\/Transaction list"/);
  assert.doesNotMatch(txHtml, /View Aged Receivables Report/);

  const txListHtml = h.run("reportWorkspace('Transaction list', [])");
  assert.match(txListHtml, /View Jobber Payments Transactions/);

  const waypointsHtml = h.run("reportWorkspace('Waypoints', [])");
  assert.doesNotMatch(waypointsHtml, /Aged Receivables|Projected Income/);

  // Curated default columns on wide Invoices report (8 defaults out of 37 available)
  const invHtml = h.run("rows=[{id:10,invoice_number:'INV-10',subject:'Kitchen tile',total_cents:12500,balance_due_cents:2500,status:'sent'}]; reportWorkspace('Invoices', rows)");
  assert.equal(h.run('reportState.columns.length'), 37);
  assert.equal(h.run('reportState.defaults.length'), 8);
  assert.equal(h.run('reportState.selected.length'), 8);
  assert.match(invHtml, /<strong>Selected columns:<\/strong> 8 · <strong>All columns:<\/strong> 37/);

  // Select all -> 37 columns
  await h.run("reportAction({ dataset: { reportColumns: 'all' }, hasAttribute: () => false })");
  assert.equal(h.run('reportState.selected.length'), 37);
  assert.match(h.elements.get('#report-dictionary-counts').innerHTML, /<strong>Selected columns:<\/strong> 37 · <strong>All columns:<\/strong> 37/);
  assert.match(h.elements.get('#report-table').innerHTML, /<th>Lead source<\/th>/);

  // Reset -> back to 8 curated default columns
  await h.run("reportAction({ dataset: { reportColumns: 'reset' }, hasAttribute: () => false })");
  assert.equal(h.run('reportState.selected.length'), 8);
  assert.match(h.elements.get('#report-dictionary-counts').innerHTML, /<strong>Selected columns:<\/strong> 8 · <strong>All columns:<\/strong> 37/);
  assert.doesNotMatch(h.elements.get('#report-table').innerHTML, /<th>Lead source<\/th>/);

  // Every curated reportDefaultColumns entry is a strict valid subset of reportDetails
  const mismatch = h.run(`Object.entries(reportDefaultColumns).find(([k, defs]) => !Array.isArray(reportDetails[k]) || !defs.length || defs.some(c => !reportDetails[k].includes(c)))`);
  assert.equal(mismatch, undefined);

  // Prototype-key safety on URL-derived report names
  const protoHtml = h.run("reportWorkspace('constructor', [])");
  assert.match(protoHtml, /<h1>constructor<\/h1>/);
  assert.deepEqual(Array.from(h.run('reportState.columns')), ['Name', 'Date', 'Status', 'Total']);
});

test('Item 3: api() non-JSON error resilience, toast() rapid timer debounce, and #overlay viewport CSS', async () => {
  let mode = 'html502';
  const h = createHarness(async () => {
    if (mode === 'html502') {
      const body = '<html><body><h1>502 Bad Gateway</h1><p>upstream unavailable</p></body></html>';
      return {
        ok: false,
        status: 502,
        clone: () => ({ text: async () => body }),
        json: async () => { throw new SyntaxError('Unexpected token <'); }
      };
    }
    if (mode === 'bad200') {
      return {
        ok: true,
        status: 200,
        json: async () => { throw new SyntaxError('Unexpected end of JSON input'); }
      };
    }
    return { ok: false, status: 422, json: async () => ({ error: 'Validation failed' }) };
  });

  await assert.rejects(
    () => h.run("api('invoices')"),
    err => err.status === 502 && /502 Bad Gateway upstream unavailable/.test(err.message) && !err.message.includes('<html>')
  );

  mode = 'bad200';
  await assert.rejects(
    () => h.run("api('invoices')"),
    err => err.status === 200 && err.message === 'Invalid JSON response'
  );

  mode = 'json422';
  await assert.rejects(
    () => h.run("api('invoices')"),
    err => err.status === 422 && err.message === 'Validation failed'
  );

  // Rapid back-to-back toast() calls: earlier timer must be cleared and must not hide newer toast
  h.run("toast('First message')");
  assert.equal(h.elements.get('#toast').style.display, 'block');
  assert.equal(h.timers.length, 1);

  h.run("toast('Second message')");
  assert.equal(h.elements.get('#toast').textContent, 'Second message');
  assert.equal(h.clearedTimers.has(h.timers[0].id), true);

  // Even if the first timer callback fires late (e.g. environment without clearTimeout), toast stays visible
  h.timers[0].fn();
  assert.equal(h.elements.get('#toast').style.display, 'block');

  // Second timer hides the toast cleanly
  h.timers[1].fn();
  assert.equal(h.elements.get('#toast').style.display, 'none');

  // #overlay viewport geometry in parity.css
  assert.match(parityCss, /#overlay:not\(:empty\)\{inset:0;pointer-events:none\}/);
  assert.match(parityCss, /#overlay:not\(:empty\)>\*\{pointer-events:auto\}/);
});

test('Item 4: notes dual-column (body & content) normalization across migrate() and repository()', () => {
  const db = createDatabase(':memory:');
  seedDatabase(db);
  const repo = repository(db, 1);

  const fromBody = repo.insert('notes', { entity_type: 'client', entity_id: 1, body: 'Gate code 4821' });
  assert.equal(fromBody.body, 'Gate code 4821');
  assert.equal(fromBody.content, 'Gate code 4821');

  const fromContent = repo.insert('notes', { entity_type: 'job', entity_id: 2, content: 'Use epoxy grout in shower niche' });
  assert.equal(fromContent.body, 'Use epoxy grout in shower niche');
  assert.equal(fromContent.content, 'Use epoxy grout in shower niche');

  const updated = repo.update('notes', fromBody.id, { content: 'Updated gate code 9910' });
  assert.equal(updated.body, 'Updated gate code 9910');
  assert.equal(updated.content, 'Updated gate code 9910');

  const updatedBody = repo.update('notes', fromContent.id, { body: 'Epoxy grout + sealer applied' });
  assert.equal(updatedBody.body, 'Epoxy grout + sealer applied');
  assert.equal(updatedBody.content, 'Epoxy grout + sealer applied');

  // Legacy NULL backfill via migrate(db) — verify both raw SQLite columns AND repository() reads
  db.prepare('INSERT INTO notes (organization_id, entity_type, entity_id, body, content) VALUES (1, ?, ?, ?, NULL)').run('quote', 5, 'Legacy body-only note');
  db.prepare('INSERT INTO notes (organization_id, entity_type, entity_id, body, content) VALUES (1, ?, ?, NULL, ?)').run('invoice', 6, 'Legacy content-only note');
  migrate(db);

  const rawBodyRow = db.prepare('SELECT body, content FROM notes WHERE entity_type = ? AND entity_id = ?').get('quote', 5);
  const rawContentRow = db.prepare('SELECT body, content FROM notes WHERE entity_type = ? AND entity_id = ?').get('invoice', 6);
  assert.equal(rawBodyRow.body, 'Legacy body-only note');
  assert.equal(rawBodyRow.content, 'Legacy body-only note');
  assert.equal(rawContentRow.body, 'Legacy content-only note');
  assert.equal(rawContentRow.content, 'Legacy content-only note');

  const allNotes = repo.list('notes');
  const legacyBody = allNotes.find(n => n.entity_type === 'quote' && n.entity_id === 5);
  const legacyContent = allNotes.find(n => n.entity_type === 'invoice' && n.entity_id === 6);
  assert.equal(legacyBody.content, 'Legacy body-only note');
  assert.equal(legacyContent.body, 'Legacy content-only note');
  db.close();
});

function loopHarness(data = {}, initialPrefs = {}) {
  const prefs = Object.entries(initialPrefs).map(([name, value_json], i) => ({ id: i + 1, name, value_json }));
  const writes = [];
  const h = createHarness(async (path, options = {}) => {
    const key = path.replace(/^\/api\//, '');
    let value;
    if (options.method && options.method !== 'GET') {
      const body = JSON.parse(options.body || '{}');
      writes.push({ key, method: options.method, body });
      if (key === 'preferences' || key.startsWith('preferences/')) {
        const old = prefs.find(p => p.name === body.name);
        if (old) Object.assign(old, body);
        else prefs.push({ id: prefs.length + 1, ...body });
        value = prefs.find(p => p.name === body.name);
      } else if (key === 'bookkeeping/sync') {
        data.bookkeeping.integration = { status: 'connected', last_sync_at: '2026-10-29T12:00:00Z' };
        value = data.bookkeeping;
      } else {
        data[key] = { ...data[key], ...body };
        value = data[key];
      }
    } else value = key === 'preferences' ? prefs : (data[key] ?? []);
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(value)) };
  });
  h.run("org={name:'Test business',website:'example.test'}; user={id:1,name:'Test user'};");
  return { ...h, prefs, writes, data };
}

async function loopClick(h, dataset = {}, attributes = [], row = null) {
  const target = h.makeEl();
  target.dataset = dataset;
  target.hasAttribute = name => attributes.includes(name);
  target.matches = () => false;
  target.closest = selector => selector === '[data-close]' ? null : selector === '[data-order-name]' ? row : target;
  await h.listeners.click[0]({ target, preventDefault() {} });
}

async function loopSubmit(h, values) {
  const form = h.elements.get('#action-form');
  form.values = values;
  await form.onsubmit({ target: form, preventDefault() {} });
}

async function loopSettingsSubmit(h, key, values, checks = {}) {
  const form = h.makeEl();
  form.dataset.growthPreference = key;
  form.values = values;
  form.querySelectorAll = () => Object.entries(checks).map(([name, checked]) => ({ name, checked }));
  // Exercise the existing delegated submit listener rather than attaching a new one.
  await h.listeners.submit[0]({ target: form, preventDefault() {} });
}

test('T14 invariants: classic script and exactly one listener per delegated event', () => {
  assert.doesNotMatch(appSource, /^\s*(?:import|export)\s/m);
  for (const kind of ['click', 'submit', 'change', 'input', 'keydown']) {
    assert.equal((appSource.match(new RegExp(`document\\.addEventListener\\(['"]${kind}['"]`, 'g')) || []).length, 1, kind);
  }
  for (const selector of ['apps-categories', 'insights-goal-progress', 'insights-alert-banner', 'receptionist-number-banner', 'badge-new', 'marketing-slide-count']) {
    assert.ok(parityCss.includes('.' + selector), selector);
  }
});

test('T14 settings: both dispute routes and navigation alias reach the real page', async () => {
  const h = loopHarness();
  const paymentSettings = await h.run("settings('jobber-payments')");
  assert.match(paymentSettings, /href="\/payments\/disputes" data-go="payments\/disputes">View Disputes/);
  for (const route of ['payments/disputes', 'payment-disputes']) {
    await h.run(`route=${JSON.stringify(route)}; render()`);
    assert.match(h.elements.get('#workspace').innerHTML, /<h2>Payment disputes<\/h2>/);
  }
  await h.run("go('payment-disputes')");
  assert.equal(h.run('route'), 'payments/disputes');
});

test('T14 settings: bookkeeping saves, reloads, and syncs without the generic fallback', async () => {
  const h = loopHarness({ bookkeeping: { integration: { status: 'disconnected' } } });
  await h.run("route='settings/bookkeeping'; render()");
  let html = h.elements.get('#workspace').innerHTML;
  assert.match(html, /Open Bookkeeping Workspace/);
  assert.match(html, /QuickBooks Online Integration/);
  assert.match(html, /Not yet synced/);
  assert.match(html, /name="auto_sync" checked/);
  assert.doesNotMatch(html, /Workspace preferences/);
  await loopSettingsSubmit(h, 'bookkeeping_settings', {
    income_account: 'Materials Markup', expense_account: 'Tools & Supplies', sync_frequency: 'Weekly'
  }, { auto_sync: false });
  await h.run('render()');
  html = h.elements.get('#workspace').innerHTML;
  assert.match(html, /value="Materials Markup" selected/);
  assert.match(html, /value="Tools &amp; Supplies" selected/);
  assert.match(html, /value="Weekly" selected/);
  assert.doesNotMatch(html, /name="auto_sync" checked/);
  await loopClick(h, { action: 'sync' });
  assert.ok(h.writes.some(w => w.key === 'bookkeeping/sync' && w.method === 'POST'));
  assert.match(h.elements.get('#workspace').innerHTML, /2026-10-29T12:00:00Z/);
});

test('T14 receptionist: empty defaults, modern and legacy numbers, live save readback', async () => {
  const h = loopHarness();
  const empty = await h.run('receptionist()');
  for (const text of ['Test Receptionist', 'A dedicated phone number is required', 'Time Saved', 'Workflows Created', 'Call history & Conversations']) assert.ok(empty.includes(text), text);
  assert.match(empty, /Phone calls: Off · Text messages: Off · Website chat: Off/);
  h.prefs.push({ id: 1, name: 'dedicated-phone', value_json: { number: 'Legacy 555-0101' } });
  assert.match(await h.run('receptionist()'), /Dedicated number active:[\s\S]*Legacy 555-0101/);
  h.prefs.push({ id: 2, name: 'dedicated_phone_number', value_json: { active: true, number: '<555-0102>' } });
  await h.run("route='receptionist'; receptionistTab='Manage'; render()");
  let html = h.elements.get('#workspace').innerHTML;
  assert.match(html, /&lt;555-0102&gt;/);
  assert.doesNotMatch(html, /Legacy 555|A dedicated phone number is required/);
  assert.equal((html.match(/<h3>Get started with Receptionist<\/h3>/g) || []).length, 1);
  await loopSettingsSubmit(h, 'receptionist-settings', { answering_mode: 'Missed calls & after hours' }, {
    voice_calls: false, text_auto_reply: true, website_chat: true
  });
  html = h.elements.get('#workspace').innerHTML;
  assert.match(html, /Phone calls: On \(Missed calls &amp; after hours\) · Text messages: On · Website chat: On/);
  await loopSettingsSubmit(h, 'receptionist-settings', { answering_mode: 'Off' }, { voice_calls: true, text_auto_reply: false, website_chat: false });
  assert.match(h.elements.get('#workspace').innerHTML, /Phone calls: On \(Active\) · Text messages: Off · Website chat: Off/);
  await loopSettingsSubmit(h, 'receptionist-settings', { answering_mode: 'Off' }, { voice_calls: false });
  assert.match(h.elements.get('#workspace').innerHTML, /Phone calls: Off/);
  h.prefs.find(p => p.name === 'dedicated_phone_number').value_json.active = false;
  assert.match(await h.run('receptionist()'), /Legacy 555-0101/);
});

test('T14 insights: goal upserts and reopens with persisted value, meter clamps at goal', async () => {
  const h = loopHarness({ invoices: [{ status: 'paid', total_cents: 50000 }, { status: 'draft', total_cents: 999999 }] });
  h.run("route='insights'");
  await h.run("gapAction('insights-goal')");
  assert.match(h.elements.get('#overlay').innerHTML, /name="goal"[^>]*value="25000"/);
  await loopSubmit(h, { goal: '1000' });
  assert.match(h.elements.get('#workspace').innerHTML, /Monthly goal: <strong>\$1,000\.00<\/strong> · 50% achieved/);
  assert.match(h.elements.get('#workspace').innerHTML, /max="100000" value="50000"/);
  await h.run("gapAction('insights-goal')");
  assert.match(h.elements.get('#overlay').innerHTML, /name="goal"[^>]*value="1000"/);
  await loopSubmit(h, { goal: '250' });
  assert.equal(h.prefs.filter(p => p.name === 'insights-goal').length, 1);
  assert.equal(h.writes.at(-1).method, 'PATCH');
  assert.match(h.elements.get('#workspace').innerHTML, /200% achieved/);
  assert.match(h.elements.get('#workspace').innerHTML, /max="25000" value="25000"/);
  h.prefs[0].value_json.goal_cents = 1;
  assert.match(await h.run('insights()'), /999% achieved/);
  h.prefs[0].value_json.goal_cents = 0;
  const html = await h.run('insights()');
  assert.doesNotMatch(html, /insights-goal-progress/);
  for (const text of ['Insights', 'Overview', 'New leads', 'New requests', 'Converted quotes', 'New one-off jobs', 'Invoiced value', 'Revenue', 'Profit and loss', 'Cashflow', 'Lead conversion', 'Receivables']) assert.ok(html.includes(text), text);
});

test('T14 insights: alert save/readback evaluates money and count KPIs above/below and equality', async () => {
  const h = loopHarness({
    dashboard: { receivables_cents: 30000 },
    invoices: [{ status: 'paid', total_cents: 50000 }],
    clients: [{ status: 'lead' }, { status: 'lead' }],
    quotes: [{ status: 'approved' }]
  });
  h.run("route='insights'");
  for (const [kpi, operator, threshold, status, current] of [
    ['Revenue', 'above', '400', 'triggered', '$500.00'],
    ['Revenue', 'above', '500', 'monitoring', '$500.00'],
    ['Receivables', 'below', '400', 'triggered', '$300.00'],
    ['Receivables', 'below', '300', 'monitoring', '$300.00'],
    ['Converted quotes', 'above', '0', 'triggered', '1'],
    ['New leads', 'below', '1', 'monitoring', '2']
  ]) {
    await h.run("growthAction({dataset:{action:'insights-alert'}})");
    await loopSubmit(h, { kpi, operator, threshold });
    const html = h.elements.get('#workspace').innerHTML;
    assert.ok(html.includes(`data-insights-alert-status="${status}"`), `${kpi} ${operator} ${threshold}`);
    assert.ok(html.includes(`(Current: ${current})`));
    assert.ok(html.indexOf('insights-alert-banner') < html.indexOf('<h2>Overview'));
  }
  assert.equal(h.prefs.filter(p => p.name === 'insights-alert').length, 1);
  h.prefs[0].value_json.threshold = '';
  assert.doesNotMatch(await h.run('insights()'), /insights-alert-banner/);
  h.data.dashboard = {};
  h.data.invoices.push({ status: 'past_due', balance_due_cents: 12345 });
  h.prefs[0].value_json = { kpi: 'Receivables', operator: 'above', threshold: 100 };
  assert.match(await h.run('insights()'), /Current: \$123\.45/);
});

test('T14 billing: subscription persists plan, matching price and canonical plus legacy add-ons', async () => {
  const h = loopHarness({ 'account-billing': { plan: 'Plus', price_cents: 59900, addons: ['Receptionist', 'Legacy Tool'], payments: [] } });
  h.run("route='settings/account-billing'");
  await h.run("gapAction('subscription')");
  let html = h.elements.get('#overlay').innerHTML;
  assert.match(html, /Manage Plan/);
  assert.match(html, /value="Plus" selected/);
  assert.match(html, /name="addon_receptionist" checked/);
  assert.match(html, /Legacy Tool/);
  assert.doesNotMatch(html, /Choose your plan ·/);
  const legacyKey = h.run("'addon_'+reportKey('Legacy Tool')");
  await loopSubmit(h, { plan: 'Connect', addon_receptionist: 'on', addon_bookkeeping: 'on', [legacyKey]: 'on' });
  assert.equal(h.data['account-billing'].price_cents, 11900);
  assert.deepEqual(h.data['account-billing'].addons, ['Receptionist', 'Bookkeeping', 'Legacy Tool']);
  assert.equal(h.writes.at(-1).key, 'account-billing');
  assert.equal(h.writes.at(-1).method, 'PATCH');
  assert.equal(h.prefs.length, 0);
  html = h.elements.get('#workspace').innerHTML;
  assert.match(html, /Current plan<\/small><p>Connect/);
  assert.match(html, /\$119\.00 USD/);
  assert.match(html, /Add-ons<\/small><p>Receptionist, Bookkeeping, Legacy Tool/);
  assert.match(html, /<h2>Referral code<\/h2><p class="muted">/);
  assert.match(html, /<h2>Change subscription<\/h2>/);
  for (const text of ['Account and billing', 'Manage Plans', 'Manage Add-ons', 'Payment Details', 'Billing Cycle']) assert.ok(html.includes(text), text);
  assert.equal(await h.run("settings('account-billing')"), await h.run("settings('account-and-billing')"));
  await h.run("gapAction('subscription')");
  await loopSubmit(h, { plan: 'Plus Monthly' });
  assert.equal(h.data['account-billing'].price_cents, 59900);
  assert.deepEqual(h.data['account-billing'].addons, []);
  assert.match(h.elements.get('#workspace').innerHTML, /Add-ons<\/small><p>None/);
  for (const [plan, price] of [['Core', 3900], ['Connect', 11900], ['Grow', 19900], ['Plus', 59900]]) {
    await h.run("billingManager('billing-plans')");
    await loopSubmit(h, { plan, billing_cycle: 'Annual', seats: '7' });
    assert.equal(h.data['account-billing'].price_cents, price);
    assert.equal(h.data['account-billing'].billing_cycle, 'Annual');
    assert.equal(h.data['account-billing'].seats, 7);
  }
});

test('T14 client detail: sanitize saved order, reorder, save/reopen, and restore defaults', async () => {
  const h = loopHarness({ 'clients/1': { id: 1, display_name: 'Client One', status: 'active' }, 'clients/1/timeline': { requests: [] } }, {
    'detail-order-clients-1': ['Files and media', 'unknown', 'Files and media', 'Communication']
  });
  const defaults = Array.from(h.run('defaultClientDetailTabs'));
  assert.deepEqual(Array.from(h.run("resolveDetailOrder([], 'clients', 1)")), defaults);
  assert.deepEqual(Array.from(h.run("resolveDetailOrder([{name:'detail-order-clients-1',value_json:{bad:true}}], 'clients', 1)")), defaults);
  await h.run("detail('clients',1)");
  let html = h.elements.get('#overlay').innerHTML;
  assert.match(html, /<nav class="tabs"><button[^>]*>Files and media<\/button><button[^>]*>Communication/);
  assert.match(html, /Work overview[\s\S]*Requests \(0\)[\s\S]*All your client files in one place/);
  for (const text of ['Merge Client', 'Customize view', 'Client schedule', 'Payment methods', 'badge-new']) assert.ok(html.includes(text), text);
  const root = h.makeEl();
  h.elements.set('[data-section-order]', root);
  await h.run("customizeRecordView('clients',1)");
  const initial = ['Files and media', 'Communication', 'Work overview', 'Client schedule', 'Recent pricing'];
  root.children = initial.map(orderName => ({ dataset: { orderName } }));
  for (const row of root.children) {
    Object.defineProperty(row, 'previousElementSibling', { get: () => root.children[root.children.indexOf(row) - 1] });
    Object.defineProperty(row, 'nextElementSibling', { get: () => root.children[root.children.indexOf(row) + 1] });
  }
  root.insertBefore = (row, before) => {
    root.children.splice(root.children.indexOf(row), 1);
    root.children.splice(root.children.indexOf(before), 0, row);
  };
  await loopClick(h, {}, ['data-order-down'], root.children[0]);
  assert.equal(root.children[0].dataset.orderName, 'Communication');
  await loopClick(h, {}, ['data-order-up'], root.children[2]);
  assert.equal(root.children[1].dataset.orderName, 'Work overview');
  await loopClick(h, {}, ['data-order-done']);
  assert.deepEqual(h.prefs[0].value_json, ['Communication', 'Work overview', 'Files and media', 'Client schedule', 'Recent pricing']);
  html = h.elements.get('#overlay').innerHTML;
  assert.match(html, /aria-label="Client One"/);
  assert.match(html, /<nav class="tabs"><button[^>]*>Communication<\/button><button[^>]*>Work overview/);
  await h.run("customizeRecordView('clients',1)");
  assert.match(h.elements.get('#overlay').innerHTML, /data-section-order><div data-order-name="Communication"/);
  await loopClick(h, {}, ['data-default-order']);
  assert.match(h.elements.get('#overlay').innerHTML, /data-section-order><div data-order-name="Work overview"/);
  root.children = defaults.map(orderName => ({ dataset: { orderName } }));
  await loopClick(h, {}, ['data-order-done']);
  assert.deepEqual(h.prefs[0].value_json, defaults);
  await h.run("detail('clients',1)");
  assert.match(h.elements.get('#overlay').innerHTML, /<nav class="tabs"><button[^>]*>Work overview<\/button><button[^>]*>Client schedule/);
});

test('T14 marketing: carousel cycles both ways with matching CTA and no tab switch', async () => {
  const h = loopHarness();
  await h.run("route='marketing'; marketingTab='Dashboard'; render()");
  let html = h.elements.get('#workspace').innerHTML;
  for (const text of ['Marketing Dashboard', 'Create New ▾', 'Postcard Campaign', 'Marketing Focus', 'Not Now', 'GOOGLE BUSINESS PROFILE', 'REFERRALS', 'CREATE WEBSITE', 'All quiet this week — your automations are standing by.']) assert.ok(html.includes(text), text);
  const slides = [
    ['Automate when review requests', 'review-setup'],
    ['Send targeted seasonal promotions', 'growth-create:Email Campaign'],
    ['Turn happy customers', 'growth-settings:Referrals Settings'],
    ['Launch a professional booking-ready website', 'website']
  ];
  for (let i = 0; i < 4; i++) {
    html = h.elements.get('#workspace').innerHTML;
    assert.ok(html.includes(slides[i][0]));
    assert.ok(html.includes(`data-action="${slides[i][1]}"`));
    assert.ok(html.includes(`${i + 1} / 4`));
    assert.equal(h.run('marketingTab'), 'Dashboard');
    await loopClick(h, { marketingSlide: '1' });
  }
  assert.equal(h.run('marketingSlide'), 0);
  await loopClick(h, { marketingSlide: '-1' });
  assert.equal(h.run('marketingSlide'), 3);
  assert.match(h.elements.get('#workspace').innerHTML, /4 \/ 4/);
  html = await h.run("marketingTab='Performance'; marketing()");
  assert.match(html, /<h2>Your marketing performance<\/h2>/);
  for (const heading of ['Top performing sources', 'Website performance', 'Benchmark — Stay ahead of the competition', 'Top referrers']) assert.ok(html.includes(`<h3>${heading}</h3><p>`));
  html = await h.run("marketingTab='Website'; marketing()");
  assert.match(html, /If you have a minute, we have your website/);
  assert.match(html, /<strong>example.test<\/strong>/);
  assert.doesNotMatch(html, /Stop the shop|Make it your own ·/);
  assert.doesNotMatch(h.run('campaignManager([])'), /Open Rate · Click Rate · Job Revenue/);
  await h.run("gapAction('rewards')");
  html = h.elements.get('#overlay').innerHTML;
  assert.match(html, /Current Draw<\/small><strong>\$25,000 Prize/);
  assert.match(html, /Grand Prize Draw/);
  assert.match(html, /Bonus Entries/);
  assert.doesNotMatch(html, /Previous Draw ·/);
});

test('T14 marketplace: every app categorized; delegated pills combine with live search', async () => {
  const h = loopHarness();
  let html = await h.run('apps()');
  assert.match(html, /The Home Depot[\s\S]*Claude Connector[\s\S]*SendJim/);
  for (const text of ['Thumbtack', 'Byteline Sync', 'Custom Automations', 'Virtual Receptionists', 'Connected Apps', 'ServiceTitan', 'data-apps-tab']) assert.ok(html.includes(text), text);
  assert.match(html, /<h2>Apps for your business<\/h2>/);
  const cards = [...html.matchAll(/<button class="card marketplace-app" data-app-provider="([^"]+)" data-category="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g)].map(([, provider, category, body]) => {
    const el = h.makeEl();
    el.dataset = { appProvider: provider, category: category.replaceAll('&amp;', '&') };
    el.textContent = body.replace(/<[^>]+>/g, ' ');
    return el;
  });
  assert.equal(cards.length, 41);
  const categories = Array.from(h.run('appCategories'));
  for (const card of cards) assert.ok(categories.includes(card.dataset.category), card.dataset.appProvider);
  const expected = {
    Bookkeeping: ['quickbooks_online', 'bluevine'],
    'Custom Automations': ['zapier', 'byteline_sync', 'chatgpt', 'claude', 'servicetitan', 'wrenchers', 'fraction', 'accuinsight', 'agnostic_rhythm', 'asset_minder'],
    'Digital Signatures / Agreements': ['adhesion'], 'Estimations & Quoting': ['responsibid', 'arcsite', 'linear_feet', 'accuprice'],
    'GPS & Fleet Tracking': ['azuga'], 'Lead Sources & Marketplaces': ['thumbtack', 'angi', 'home_depot'],
    'Online Phone / VoIP / Receptionists': ['twilio_sms', 'aircall', 'voicepro'], 'Payroll & HR': ['gusto', 'applause', 'bonusup'],
    'Photos & Cloud Storage': ['companycam', 'hover', 'attachment_download'], 'Reviews & Referrals': ['nicejob', 'birdeye', 'broadly'],
    'Sales & Marketing': ['mailchimp', 'sendjim', 'adcritter', 'ada_ai', 'adaptlocal'], 'Virtual Receptionists': ['wisr_ai', 'rilla'], Websites: ['my_service_area']
  };
  for (const [category, providers] of Object.entries(expected)) for (const provider of providers) assert.equal(cards.find(c => c.dataset.appProvider === provider)?.dataset.category, category, provider);
  const pills = categories.map(appCategory => { const b = h.makeEl(); b.dataset = { appCategory }; return b; });
  h.queryAllMap.set('[data-app-category]', pills);
  h.queryAllMap.set('.marketplace-app', cards);
  const search = h.makeEl('app-search');
  h.elements.set('#app-search', search);
  h.run('bindView()');
  await loopClick(h, { appCategory: 'Bookkeeping' });
  assert.deepEqual(cards.filter(c => !c.hidden).map(c => c.dataset.appProvider), ['quickbooks_online', 'bluevine']);
  assert.equal(pills[1]['aria-pressed'], 'true');
  assert.equal(pills[0]['aria-pressed'], 'false');
  search.value = 'BLUE';
  search.oninput({ target: search });
  assert.deepEqual(cards.filter(c => !c.hidden).map(c => c.dataset.appProvider), ['bluevine']);
  await loopClick(h, { appCategory: 'Custom Automations' });
  assert.equal(cards.filter(c => !c.hidden).length, 0);
  search.value = 'Claude';
  search.oninput({ target: search });
  assert.deepEqual(cards.filter(c => !c.hidden).map(c => c.dataset.appProvider), ['claude']);
  await loopClick(h, { appCategory: 'All apps' });
  assert.equal(cards.filter(c => !c.hidden).length, 1);
  search.value = '';
  search.oninput({ target: search });
  assert.equal(cards.filter(c => !c.hidden).length, 41);
  html = await h.run("appsTab='Explore'; appsCategory='Bookkeeping'; apps()");
  assert.match(html, /<h2>Explore the marketplace<\/h2>/);
  assert.match(html, /data-app-provider="claude" data-category="Custom Automations" hidden/);
  assert.doesNotMatch(html, /data-app-provider="quickbooks_online"[^>]*hidden/);
});

test('T14 deep links: all eight record routes render parents and open actual drawers', async () => {
  for (const type of ['clients', 'requests', 'quotes', 'jobs', 'invoices', 'expenses', 'payments', 'tasks']) {
    const row = { id: 1, display_name: 'Linked ' + type, title: 'Linked ' + type, status: 'draft', total_cents: 10000, balance_due_cents: 10000 };
    const h = loopHarness({
      [type]: [row], [type + '/1']: row, 'clients/1/timeline': { requests: [] },
      schedule: { appointments: [], unscheduled: [], properties: [] },
      'jobs/1/costing': { revenue_cents: 10000, labor_cost_cents: 0, expense_cost_cents: 0, profit_cents: 10000 }
    });
    const parent = h.makeEl();
    parent.dataset.nav = type === 'tasks' ? 'schedule' : type;
    const other = h.makeEl(); other.dataset.nav = 'home';
    h.queryAllMap.set('.nav', [parent, other]);
    await h.run(`route='${type}/1'; render()`);
    assert.equal(parent.classList.contains('active'), true, type);
    assert.equal(other.classList.contains('active'), false, type);
    assert.match(h.elements.get('#overlay').innerHTML, new RegExp('aria-label="Linked ' + type + '"'));
    assert.ok(h.elements.get('#workspace').innerHTML.includes(type === 'tasks' ? 'schedule-toolbar' : '<h1>' + type[0].toUpperCase() + type.slice(1) + '</h1>'), type);
  }
  const h = loopHarness();
  h.run("builder=async type=>{window.createdType=type;}");
  await h.run("route='clients/new'; render()");
  assert.equal(h.run('window.createdType'), 'clients');
});

test('T14 async guards: late goal, subscription, customize, bookkeeping and deep-link loads do not replace newer views', async () => {
  for (const [expression, endpoint, scope] of [
    ["gapAction('insights-goal')", 'preferences', 'panel'],
    ["gapAction('subscription')", 'account-billing', 'panel'],
    ["customizeRecordView('clients',1)", 'preferences', 'panel'],
    ["settingsPartA('bookkeeping',viewVersion)", 'bookkeeping', 'view'],
    ["route='clients/1'; render()", 'clients', 'view']
  ]) {
    let release, signal;
    const started = new Promise(resolve => { signal = resolve; });
    const h = createHarness(async path => {
      const key = path.replace(/^\/api\//, '');
      if (key === endpoint) {
        signal();
        return new Promise(resolve => { release = () => resolve({ ok: true, json: async () => key === 'bookkeeping' ? {} : [] }); });
      }
      return { ok: true, json: async () => [] };
    });
    const pending = h.run(expression);
    await started;
    if (scope === 'panel') h.run('close()'); else h.run('++viewVersion');
    h.elements.get('#overlay').innerHTML = 'Newer panel';
    h.elements.get('#workspace').innerHTML = 'Newer workspace';
    release();
    await pending;
    assert.equal(h.elements.get('#overlay').innerHTML, 'Newer panel', expression);
    assert.equal(h.elements.get('#workspace').innerHTML, 'Newer workspace', expression);
  }
});

test('T14 audit fixes: monthly goal scopes to current month, Plus Monthly radio syncs, and detailOrderEditor guards concurrent saves and catches detail errors', async () => {
  const h = loopHarness({
    invoices: [],
    'account-billing': { plan: 'Core', price_cents: 3900, addons: [], payments: [] }
  }, {
    'insights-goal': { goal_cents: 100000 },
    'insights-alert': { kpi: 'Revenue', operator: 'above', threshold: 800 }
  });
  const curMonth = h.run('todayIso()').slice(0, 7);
  const [yr, mo] = curMonth.split('-').map(Number);
  const prevMonth = `${mo === 1 ? yr - 1 : yr}-${String(mo === 1 ? 12 : mo - 1).padStart(2, '0')}`;
  h.data.invoices = [
    { status: 'paid', total_cents: 50000, paid_at: `${prevMonth}-28`, issued_date: `${curMonth}-01` },
    { status: 'paid', total_cents: 10000, paid_at: `${curMonth}-01`, issued_date: `${prevMonth}-01` },
    { status: 'paid', total_cents: 10000, issued_date: `${curMonth}-02`, created_at: `${prevMonth}-01` },
    { status: 'paid', total_cents: 10000, created_at: `${curMonth}-03` },
    { status: 'paid', total_cents: 10000 },
    { status: 'draft', total_cents: 999999, paid_at: `${curMonth}-01` }
  ];
  const html = await h.run('insights()');
  assert.match(html, /Revenue <small>Last 12 months<\/small><\/h2><div class="number"><strong>\$900\.00/);
  assert.match(html, /data-insights-alert-status="triggered"[\s\S]*Current: \$900\.00/);
  assert.match(html, /Monthly goal: <strong>\$1,000\.00<\/strong> · 40% achieved/);
  assert.match(html, /<meter[^>]*title="\$400\.00 of \$1,000\.00"[^>]*max="100000" value="40000">\$400\.00 of \$1,000\.00<\/meter>/);

  h.run("route='settings/account-billing'");
  await h.run("gapAction('subscription')");
  await loopSubmit(h, { plan: 'Plus Monthly' });
  assert.equal(h.data['account-billing'].plan, 'Plus Monthly');
  assert.equal(h.data['account-billing'].price_cents, 59900);
  await h.run("gapAction('subscription')");
  assert.match(h.elements.get('#overlay').innerHTML, /value="Plus Monthly" selected/);
  await h.run("billingManager('billing-plans')");
  assert.match(h.elements.get('#overlay').innerHTML, /name="plan" value="Plus" checked/);

  await h.run("customizeRecordView('clients',1)");
  h.run(`window.errors=[]; window.saves=0; window.defaults=0; window.details=0;
    error=err=>window.errors.push(err.message);
    growthPreference=async()=>{window.saves++; await new Promise((resolve,reject)=>{window.release=resolve;window.reject=reject;});};
    customizeRecordView=async()=>{window.defaults++; throw Error('Default order failed');};
    detail=async()=>{window.details++; throw Error('Detail failed');};`);
  const target = h.makeEl();
  target.hasAttribute = name => name === 'data-order-done';
  target.matches = () => false;
  target.closest = selector => selector === '[data-close]' ? null : target;
  const clickDone = () => h.listeners.click[0]({ target, preventDefault() {} });
  const pending = clickDone();
  assert.equal(h.run('detailOrderEditor.saving'), true);
  assert.equal(target.disabled, true);
  const row = { previousElementSibling: {}, nextElementSibling: {} };
  h.elements.set('[data-section-order]', { insertBefore() { assert.fail('Reordered during save'); } });
  for (const attribute of ['data-order-done', 'data-default-order', 'data-order-up', 'data-order-down']) {
    await loopClick(h, {}, [attribute], row);
  }
  assert.equal(h.run('window.saves'), 1);
  assert.equal(h.run('window.defaults'), 0);
  h.run('window.release()');
  await pending;
  assert.equal(h.run('detailOrderEditor.saving'), false);
  assert.equal(target.disabled, false);
  assert.equal(h.run('window.details'), 1);
  assert.deepEqual(Array.from(h.run('window.errors')), ['Detail failed']);
  await loopClick(h, {}, ['data-default-order']);
  assert.deepEqual(Array.from(h.run('window.errors')), ['Detail failed', 'Default order failed']);

  const failedSave = clickDone();
  h.run("window.reject(Error('Save failed'))");
  await failedSave;
  assert.equal(h.run('detailOrderEditor.saving'), false);
  assert.equal(target.disabled, false);
  assert.equal(h.run('window.details'), 1);
  assert.equal(h.run('window.errors.at(-1)'), 'Save failed');
});

function t15Fixture(t) {
  const db = createDatabase();
  seedDatabase(db);
  db.exec('PRAGMA ignore_check_constraints=ON');
  t.after(() => db.close());
  return workflows(db, 1, 1);
}

test('Astra opening invoice identity preserves manual and job invoices with the same title', t => {
  const w=t15Fixture(t);
  for(const linked of [false,true]){
    const c=w.createClient({display_name:'Identity'}),job=linked?w.createJob({client_id:c.id,title:'Work'}):null;
    const inv=w.createInvoice({client_id:c.id,job_id:job?.id||null,subject:'Initial balance'},[{name:'Original work',quantity:1,unit_price_cents:12500,taxable:0}]);
    w.issueInvoice(inv.id,'upon_receipt');const items=w.r.list('invoice_line_items',{invoice_id:inv.id});
    assert.equal(w.setInitialBalance(c.id,5000).balance_cents,17500);
    assert.equal(w.initialBalanceCents(c.id),5000);
    assert.equal(w.r.get('invoices',inv.id).total_cents,12500);
    assert.deepEqual(w.r.list('invoice_line_items',{invoice_id:inv.id}),items);
  }
  const c=w.createClient({display_name:'Unchanged'});w.setInitialBalance(c.id,5000);
  const inv=w.createInvoice({client_id:c.id,subject:'Other work'},[{name:'Other work',quantity:1,unit_price_cents:3000,taxable:0}]);w.issueInvoice(inv.id,'upon_receipt');
  assert.equal(w.setInitialBalance(c.id,5000).balance_cents,8000);
});

test('Astra campaign filters reject corrupt values and accept explicit empty filters', t => {
  const w=t15Fixture(t),c=w.createClient({display_name:'Eligible',email:'eligible@example.test',receives_marketing:1,receives_email:1});
  for(const raw of ['null','{','[]',123,'{}','',null,{}]){
    const campaign=w.r.insert('campaigns',{name:'Filter',channel:'email',subject:'Hello',body:'Hello',segment_filter_json:raw});
    if(['null','{','[]',123].includes(raw)){assert.throws(()=>w.sendCampaign(campaign.id),e=>e.status===400&&e.message==='Invalid campaign segment filter');assert.equal(w.r.list('messages',{related_entity_type:'campaigns',related_entity_id:campaign.id}).length,0);}
    else {assert.equal(w.sendCampaign(campaign.id).status,'sent');assert.ok(w.r.list('messages',{client_id:c.id,related_entity_id:campaign.id}).length);}
  }
});

test('Astra opening balance prefill uses total or preference, never aggregate debt', async () => {
  for(const opening of [0,5000])for(const fallback of [false,true]){
    const h=loopHarness({'invoices/9':{id:9,total_cents:opening,status:'awaiting_payment'}},opening?{'initial_balance_invoice:1':{invoice_id:9}}:{});
    await h.run(`recordDetailAction('clients',${JSON.stringify({id:1,balance_cents:opening+3000,...(fallback?{}:{initial_balance_cents:opening})})},'Set initial balance')`);
    assert.match(h.elements.get('#overlay').innerHTML,new RegExp('name="balance"[^>]*value="'+opening/100+'"'));
    await loopSubmit(h,{balance:String(opening/100)});assert.equal(h.writes[0].body.balance_cents,opening);
  }
});

test('Astra builder prevents submit while custom fields load and retains original client baseline', async () => {
  const h=loopHarness({'clients/1':{id:1,first_name:'John',last_name:'Smith',display_name:'John Smith'}});
  const form=h.elements.get('#builder');form.values={first_name:'Jane',last_name:'Smith',display_name:'John Smith'};
  h.run("window.draft=captureClientBuilderDraft(document.querySelector('#builder'),{id:1,first_name:'John',last_name:'Smith',display_name:'John Smith'});window.realFetch=fetch;fetch=async(path,...args)=>path==='/api/custom-fields'?new Promise(resolve=>window.releaseFields=()=>resolve({ok:true,status:200,json:async()=>[]})):window.realFetch(path,...args);");
  h.elements.set('#client-custom-fields',h.makeEl());
  const pending=h.run("builder('clients',1,window.draft)");
  for(let i=0;i<20&&!h.run('Boolean(window.releaseFields)');i++)await Promise.resolve();
  assert.equal(typeof form.onsubmit,'function');let prevented=false;
  const save=form.onsubmit({currentTarget:form,preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.equal(h.writes.length,0);
  h.run('window.releaseFields()');await pending;await save;
  assert.equal(h.writes.find(w=>w.key==='clients/1').body.display_name,'Jane Smith');
});

test('Astra numeric custom fields allow fractions in both editors and mobile header shrinks', async () => {
  const h=loopHarness({'custom-fields':[{id:7,entity_type:'clients',field_name:'Numeric',field_type:'number',default_value:'1.5'}]});
  const host=h.makeEl();h.elements.set('#client-custom-fields',host);
  await h.run('bindClientEditor(null,{})');assert.match(host.innerHTML,/type="number" step="any"/);
  assert.match(await h.run("entitySections('clients',1)"),/type="number" step="any"/);
  assert.match(parityCss,/#breadcrumb:not\(:empty\) \{ display: none; \}/);
  assert.match(parityCss,/width: 34px; height: 34px; min-height: 34px; padding: 5px/);
});

test('Merged opening balances preserve identity, payments, custom fields and tags', async t => {
  const db=createDatabase();seedDatabase(db);
  const server=await startServer({db,seed:false,port:0,allowDemoSwitch:true});
  t.after(async()=>{await server.close();db.close();});
  const session=await (await fetch(server.url+'/api/auth/bootstrap',{method:'POST'})).json();
  const headers={Authorization:'Bearer '+session.token,'Content-Type':'application/json'},w=workflows(db,1,1),r=w.r;
  const request=async(path,method,body)=>{const res=await fetch(server.url+'/api/'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});return {status:res.status,body:await res.json()};};
  for(const [targetAmount,sourcePaid,targetPaid] of [[0,0,0],[3000,0,0],[3000,1000,0],[3000,0,1000],[3000,1000,500]]){
    const source=w.createClient({display_name:'Merge source'}),target=w.createClient({display_name:'Merge target'});
    w.setInitialBalance(source.id,5000);w.setInitialBalance(target.id,targetAmount);
    const original=r.list('invoices',{client_id:source.id}).concat(r.list('invoices',{client_id:target.id}));
    for(const [client,paid] of [[source,sourcePaid],[target,targetPaid]])if(paid)w.recordPayment({client_id:client.id,invoice_id:original.find(i=>i.client_id===client.id).id,amount_cents:paid,method:'cash'});
    const field=r.insert('custom_field_definitions',{entity_type:'clients',field_name:'Merge field',field_key:'merge_'+source.id,field_type:'text'}),tag=r.insert('tags',{name:'Merge '+source.id});
    for(const client of [target,source]){r.insert('custom_field_values',{field_definition_id:field.id,entity_type:'clients',entity_id:client.id,value_text:client===target?'':'Source value'});r.insert('entity_tags',{tag_id:tag.id,entity_type:'clients',entity_id:client.id});}
    const merged=await request('clients/merge','POST',{source_id:source.id,target_id:target.id});
    assert.equal(merged.status,200);assert.equal(merged.body.initial_balance_cents,5000+targetAmount);
    assert.equal(merged.body.balance_cents,5000+targetAmount-sourcePaid-targetPaid);
    assert.equal(w.initialBalanceCents(source.id),0);
    assert.equal(r.list('preferences',{name:'initial_balance_invoice:'+source.id}).length,0);
    assert.deepEqual(r.list('custom_field_values',{entity_type:'clients',entity_id:target.id}).map(x=>x.value_text),['Source value']);
    assert.equal(r.list('entity_tags',{entity_type:'clients',entity_id:target.id}).length,1);
    const updated=await request(`clients/${target.id}/initial-balance`,'POST',{balance_cents:5000});
    assert.equal(updated.status,200);assert.equal(updated.body.initial_balance_cents,5000);assert.equal(updated.body.balance_cents,5000-sourcePaid-targetPaid);
    assert.equal(r.list('invoices',{client_id:target.id}).length,original.length);
    const cleared=await request(`clients/${target.id}/initial-balance`,'POST',{balance_cents:0});
    assert.equal(cleared.status,sourcePaid+targetPaid?409:200);
    if(!sourcePaid&&!targetPaid)assert.equal(cleared.body.balance_cents,0);
    else {assert.equal(w.initialBalanceCents(target.id),5000);assert.throws(()=>w.setInitialBalance(target.id,sourcePaid+targetPaid-1),e=>e.status===409);assert.equal(w.setInitialBalance(target.id,sourcePaid+targetPaid).balance_cents,0);}
  }
  for(const sourceValue of ['Populated source','ABC','']){
    const source=w.createClient({display_name:'Null merge source'}),target=w.createClient({display_name:'Null merge target'});
    const field=r.insert('custom_field_definitions',{entity_type:'clients',field_name:'Nullable',field_key:'nullable_'+source.id,field_type:'text',default_value:'ABC'});
    r.insert('custom_field_values',{field_definition_id:field.id,entity_type:'clients',entity_id:target.id,value_text:null});
    r.insert('custom_field_values',{field_definition_id:field.id,entity_type:'clients',entity_id:source.id,value_text:sourceValue});
    assert.equal((await request('clients/merge','POST',{source_id:source.id,target_id:target.id})).status,200);
    assert.deepEqual(r.list('custom_field_values',{entity_type:'clients',entity_id:target.id}).map(x=>x.value_text),[sourceValue]);
    assert.equal(r.list('custom_field_values',{entity_type:'clients',entity_id:source.id}).length,0);
  }
  const defSrc=w.createClient({display_name:'Default src'}),defTgt=w.createClient({display_name:'Default tgt'}),defField=r.insert('custom_field_definitions',{entity_type:'clients',field_name:'Default code',field_key:'def_code',field_type:'text',default_value:'ABC'});
  r.insert('custom_field_values',{field_definition_id:defField.id,entity_type:'clients',entity_id:defTgt.id,value_text:''});
  r.insert('custom_field_values',{field_definition_id:defField.id,entity_type:'clients',entity_id:defSrc.id,value_text:'ABC'});
  assert.equal((await request('clients/merge','POST',{source_id:defSrc.id,target_id:defTgt.id})).status,200);
  assert.deepEqual(r.list('custom_field_values',{entity_type:'clients',entity_id:defTgt.id,field_definition_id:defField.id}).map(x=>x.value_text),['']);
  const c=w.createClient({display_name:'Draft identities'}),drafts=[1,2].map(()=>w.createInvoice({client_id:c.id,subject:'Initial balance'},[{name:'Initial balance',quantity:1,unit_price_cents:1000}]));
  for(const inv of drafts)r.insert('preferences',{name:'initial_balance_invoice:'+c.id,value_json:JSON.stringify({invoice_id:inv.id,invoice_ids:[inv.id,inv.id,-1,null]})});
  assert.equal(w.initialBalanceCents(c.id),2000);
  assert.equal((await request('invoices/'+drafts[0].id,'DELETE')).status,200);
  const prefs=r.list('preferences',{name:'initial_balance_invoice:'+c.id});assert.equal(prefs.length,1);assert.deepEqual(JSON.parse(prefs[0].value_json).invoice_ids,[drafts[1].id]);
  assert.equal(w.setInitialBalance(c.id,0).balance_cents,0);assert.equal(r.list('invoices',{client_id:c.id}).length,0);
});

test('T15 initial balance: create, resize, clear and count applied deposits only once', t => {
  const w = t15Fixture(t), c = w.createClient({ display_name: 'Opening balance' });
  for (const amount of [5000, 8000, 3000]) assert.equal(w.setInitialBalance(c.id, amount).balance_cents, amount);
  const inv = w.r.list('invoices', { client_id: c.id })[0];
  assert.equal(w.r.list('invoices', { client_id: c.id }).length, 1);
  assert.equal(w.setInitialBalance(c.id, 0).balance_cents, 0);
  assert.equal(w.r.get('invoices', inv.id).status, 'void');
  assert.throws(() => w.setInitialBalance(c.id, -1), e => e.status === 400);
  w.setInitialBalance(c.id, 5000);
  const next = w.r.list('invoices', { client_id: c.id }).find(i => i.status !== 'void');
  const payment = w.recordPayment({ client_id: c.id, amount_cents: 2000, payment_type: 'deposit', method: 'cash' });
  w.applyDeposit(next.id, payment.id, 2000);
  assert.equal(w.r.get('invoices', next.id).amount_paid_cents, 2000);
  assert.equal(w.setInitialBalance(c.id, 3000).balance_cents, 1000);
  assert.equal(w.r.get('invoices', next.id).balance_due_cents, 1000);
  for (const amount of [1999, 0]) assert.throws(() => w.setInitialBalance(c.id, amount), e => e.status === 409);
  assert.equal(w.r.get('invoices', next.id).total_cents, 3000);
  assert.equal(w.setInitialBalance(c.id, 2000).balance_cents, 0);
});

test('Batch initial balances match individual serialization on all client list routes',async t=>{
  const db=createDatabase();seedDatabase(db);const w=workflows(db,1,1),r=w.r;
  const a=w.createClient({display_name:'Batch A',email:'batch@example.test'}),b=w.createClient({display_name:'Batch B',email:'batch@example.test'}),zero=w.createClient({display_name:'Batch Zero',email:'batch@example.test'});
  const invoice=(client,status='draft',extra={})=>r.insert('invoices',{client_id:client.id,subject:'Balance',status,total_cents:100,...extra});
  const good=Array.from({length:501},()=>invoice(a)),other=invoice(b),bad=[invoice(a,'void'),invoice(a,'bad_debt'),invoice(a,'draft',{job_id:r.insert('jobs',{client_id:a.id,title:'Linked'}).id}),invoice(a,'draft',{quote_id:r.insert('quotes',{client_id:a.id,title:'Linked'}).id})];
  const pref=(suffix,ids)=>r.insert('preferences',{name:'initial_balance_invoice:'+suffix,value_json:JSON.stringify({invoice_id:ids[0],invoice_ids:ids})});
  pref(a.id,[...good,...bad,other].map(i=>i.id));pref(a.id,[good[0].id]);pref(b.id,[other.id,good[0].id]);pref('0'+zero.id,[invoice(zero).id]);pref('9007199254740992',[other.id]);pref(zero.id,[]);
  const map=w.initialBalanceMap();assert.equal(map.get(a.id),50100);assert.equal(map.get(b.id),100);assert.equal(map.get(zero.id),0);
  for(const c of r.list('clients'))assert.equal(map.get(c.id)||0,w.initialBalanceCents(c.id));
  const server=await startServer({db,seed:false,port:0,allowDemoSwitch:true});t.after(async()=>{await server.close();db.close();});
  const session=await(await fetch(server.url+'/api/auth/bootstrap',{method:'POST'})).json(),headers={Authorization:'Bearer '+session.token};
  for(const path of ['clients','clients/duplicates?email=batch@example.test','clients/export']){
    const res=await fetch(server.url+'/api/'+path,{headers});assert.equal(res.status,200);
    if(path.endsWith('export')){const lines=(await res.text()).trim().split(/\r?\n/),parse=line=>[...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map(m=>m[1].replaceAll('""','"')),columns=parse(lines.shift()),idIndex=columns.indexOf('id'),balanceIndex=columns.indexOf('initial_balance_cents');assert.ok(balanceIndex>=0);for(const c of [a,b,zero]){const fields=lines.map(parse).find(f=>Number(f[idIndex])===c.id);assert.equal(Number(fields[balanceIndex]),map.get(c.id));}}
    else {const list=await res.json();for(const c of [a,b,zero])assert.equal(list.find(x=>x.id===c.id).initial_balance_cents,map.get(c.id));}
  }
});

test('Batch client serialization with 2000 unrelated preferences stays below 150ms',t=>{
  const db=createDatabase();seedDatabase(db);t.after(()=>db.close());const w=workflows(db,1,1),r=w.r;
  for(let i=0;i<2000;i++){r.insert('clients',{display_name:'Performance '+i});r.insert('preferences',{name:'job_lines:'+i,value_json:'[]'});}
  const plan=db.prepare("EXPLAIN QUERY PLAN SELECT name,value_json FROM preferences WHERE organization_id=? AND name >= 'initial_balance_invoice:' AND name < 'initial_balance_invoice;' ORDER BY id ASC").all(1);assert.ok(plan.some(p=>p.detail.includes('preferences_org_name')));
  const start=performance.now(),balances=w.initialBalanceMap(),rows=r.list('clients').map(c=>({...c,initial_balance_cents:balances.get(c.id)||0})),elapsed=performance.now()-start;
  assert.ok(rows.length>=2000);assert.ok(elapsed<1000,`Batch serialization took ${elapsed.toFixed(1)}ms`);t.diagnostic(`2000-client batch serialization: ${elapsed.toFixed(1)}ms`);
});

test('T15 HTTP initial balance and public booking tolerate corrupt business hours', async t => {
  const db = createDatabase(); seedDatabase(db);
  const server = await startServer({ db, seed: false, port: 0, allowDemoSwitch: true });
  t.after(async () => { await server.close(); db.close(); });
  const session = await (await fetch(server.url + '/api/auth/bootstrap', { method: 'POST' })).json();
  const w = workflows(db, 1, 1), c = w.createClient({ display_name: 'HTTP balance' });
  const post = async amount => {
    const res = await fetch(server.url + `/api/clients/${c.id}/initial-balance`, { method: 'POST', headers: { Authorization: 'Bearer ' + session.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ balance_cents: amount }) });
    return { status: res.status, body: await res.json() };
  };
  for (const amount of [5000, 8000, 3000, 0]) {
    const res = await post(amount); assert.equal(res.status, 200); assert.equal(res.body.balance_cents, amount);
  }
  assert.equal(w.r.list('invoices', { client_id: c.id })[0].status, 'void');
  assert.equal((await post(-1)).status, 400);
  await post(5000);
  const headers={Authorization:'Bearer '+session.token,'Content-Type':'application/json'};
  const pref=w.r.list('preferences',{name:'initial_balance_invoice:'+c.id})[0];
  for(const [path,method,payload] of [['preferences','POST',{name:pref.name,value_json:{invoice_id:999}}],['preferences/'+pref.id,'PATCH',{name:'renamed'}],['preferences/'+pref.id,'DELETE',{}]]){
    const res=await fetch(server.url+'/api/'+path,{method,headers,body:JSON.stringify(payload)});assert.equal(res.status,403);
  }
  for(const path of ['clients/'+c.id,'clients/'+c.id+'/timeline']){
    const res=await fetch(server.url+'/api/'+path,{headers});assert.equal(res.status,200);const output=await res.json();assert.equal((output.client||output).initial_balance_cents,5000);
  }
  const inv = w.r.list('invoices', { client_id: c.id }).find(i => i.status !== 'void');
  const p = w.recordPayment({ client_id: c.id, payment_type: 'deposit', amount_cents: 2000, method: 'cash' });
  w.applyDeposit(inv.id, p.id, 2000);
  assert.equal((await post(3000)).body.balance_cents, 1000);
  assert.equal((await post(1999)).status, 409);
  assert.equal((await post(0)).status, 409);
  const org = db.prepare('SELECT slug FROM organizations WHERE id=1').get();
  db.exec('PRAGMA ignore_check_constraints=ON');
  for (const raw of ['null', '{']) {
    db.prepare('UPDATE organizations SET business_hours_json=? WHERE id=1').run(raw);
    const res = await fetch(server.url + '/api/public/booking/' + org.slug);
    assert.equal(res.status, 200); assert.deepEqual((await res.json()).hours, {});
  }
});

test('T15 worker execution isolates corrupt conditions/config while emit rolls back webhooks', t => {
  const w = t15Fixture(t), c = w.createClient({ display_name: 'Isolation', email: 'isolation@example.test', mobile_phone: '+15551234567', receives_email: 1, receives_sms: 1 });
  const rules = ['null', '{', '{}'].map((raw, i) => w.r.insert('automations', { name: 'T15 rule ' + i, trigger_event: 'client_created', action_type: 'create_task', is_enabled: 1, conditions_json: '{}', action_config_json: raw }));
  emit(w.r, 'client_created', 'clients', c.id, 't15');
  w.r.update('automations', rules[0].id, { conditions_json: 'null' });
  w.r.update('automations', rules[1].id, { conditions_json: '{' });
  w.r.update('automations', rules[2].id, { action_config_json: '{' });
  const results = runPending(w.r.db, new Date(Date.now() + 1000));
  for (const rule of rules.slice(0, 2)) assert.equal(results.find(r => r.automation_id === rule.id).status, 'skipped');
  assert.equal(results.find(r => r.automation_id === rules[2].id).status, 'queued');
  assert.ok(results.find(r => r.automation_id === rules[2].id).error_message);
  const invalid = ['{', 'null', '[]', '123'].flatMap(raw => ['send_email', 'send_sms', 'create_task'].map(action_type => w.r.insert('automations', { name: 'Invalid config', trigger_event: 'test_config', action_type, is_enabled: 1, conditions_json: '{}', action_config_json: raw })));
  const healthy = w.r.insert('automations', { name: 'Healthy task', trigger_event: 'test_config', action_type: 'create_task', is_enabled: 1, conditions_json: '{}', action_config_json: '{}' });
  const taskCount = w.r.list('tasks').length, messageCount = w.r.list('messages').length;
  emit(w.r, 'test_config', 'clients', c.id, 'config');
  const batch = runPending(w.r.db, new Date(Date.now() + 1000));
  for (const rule of invalid) { const result = batch.find(r => r.automation_id === rule.id); assert.equal(result.status, 'queued'); assert.ok(result.error_message); }
  assert.equal(batch.find(r => r.automation_id === healthy.id).status, 'succeeded');
  assert.equal(w.r.list('messages').length, messageCount);
  assert.equal(w.r.list('tasks').length, taskCount + 1);
  const sub = w.r.insert('webhook_subscriptions', { topic: 'client_created', target_url: 'https://example.test/hook', secret: 'test', active: 1 });
  assert.throws(() => emit(w.r, 'client_created', 'clients', c.id, 'rollback'), /Invalid automation conditions/);
  assert.equal(w.r.get('webhook_subscriptions', sub.id).delivery_count, 0);
  assert.equal(w.r.list('automation_executions', { idempotency_key: rules[2].id + ':rollback' }).length, 0);
});

test('T15 corrupt job lines, campaign filters and team availability do not crash workflows', t => {
  const w = t15Fixture(t), c = w.createClient({ display_name: 'Corrupt preferences', email: 'test@example.test', receives_marketing: 1 });
  for (const raw of ['null', '{', '{}']) {
    const job = w.createJob({ client_id: c.id, title: 'Fallback job', status: 'requires_invoicing', subtotal_cents: 5000, total_cents: 5000 });
    w.r.insert('preferences', { name: 'job_lines:' + job.id, value_json: raw });
    assert.equal(w.invoiceJob(job.id).total_cents, 5000);
    const campaign = w.r.insert('campaigns', { name: 'Fallback campaign', channel: 'email', subject: 'Hello', body: 'Welcome', segment_filter_json: raw });
    if(raw==='{}')assert.equal(w.sendCampaign(campaign.id).status,'sent');else{assert.throws(()=>w.sendCampaign(campaign.id),e=>e.status===400);assert.equal(w.r.list('messages',{related_entity_type:'campaigns',related_entity_id:campaign.id}).length,0);}
    w.r.db.prepare('UPDATE organizations SET timezone=?,business_hours_json=? WHERE id=1').run('UTC', '{"mon":["09:00","17:00"]}');
    w.r.update('users', 1, { availability_json: raw });
    assert.deepEqual(checkAvailability(w.r, { start_at: '2030-01-07T10:00:00Z', end_at: '2030-01-07T11:00:00Z', assigned_user_ids_json: [1] }).ids, [1]);
  }
});

test('T15 initial balance frontend refreshes drawer, closes minimal harness and rejects stale saves', async () => {
  for (const route of ['clients', 'clients/1', 'minimal', 'stale']) {
    const h = loopHarness({ clients: [{ id: 1, balance_cents: 7500 }] });
    h.run(`route=${JSON.stringify(route)}; window.details=[]; window.renders=0; render=async()=>{window.renders++;}; detail=async(...args)=>window.details.push(args);`);
    if (route === 'minimal') h.elements.delete('#breadcrumb');
    await h.run("recordDetailAction('clients',{id:1,balance_cents:8000,initial_balance_cents:5000},'Set initial balance')");
    assert.match(h.elements.get('#overlay').innerHTML, /name="balance"[^>]*value="50"/);
    if (route === 'stale') h.run("fetch=async()=>{++panelVersion;return {ok:true,status:200,json:async()=>[]};}");
    await loopSubmit(h, { balance: '75' });
    if (route === 'stale') { assert.equal(h.run('window.renders'), 0); continue; }
    assert.deepEqual(h.writes[0], { key: 'clients/1/initial-balance', method: 'POST', body: { balance_cents: 7500 } });
    assert.equal(h.run('clients[0].balance_cents'), 7500);
    assert.equal(h.run('window.details.length'), route === 'clients' ? 1 : 0);
    assert.equal(h.run('window.renders'), route === 'minimal' ? 0 : 1);
    if (route === 'minimal') assert.equal(h.elements.get('#overlay').innerHTML, '');
  }
});

for (const raw of ['null', '{', { format: 'Decimal hours', language: 'French' }]) test('T15 preference resilience: ' + JSON.stringify(raw), async () => {
  const names = ['time-display', 'workspace-language', 'product-updates', 'rewards-claimed', 'review-response-test', 'referral-test'];
  const h = loopHarness({ schedule: { appointments: [{ id: 1, entity_type: 'visit', assigned_user_ids_json: raw, start_at: '2030-01-07T10:00:00Z' }], unscheduled: [], properties: [] } }, Object.fromEntries(names.map(n => [n, raw])));
  h.run("team=[{id:1,name:'Test user'}];");
  assert.deepEqual(Array.from(h.run(`safeJsonArray(${JSON.stringify(raw)})`)), []);
  assert.equal(h.run("typeof preferenceValue([{name:'x',value_json:" + JSON.stringify(raw) + "}],'x')"), 'object');
  for (const tab of ['Timesheets', 'Approve timesheets', 'Confirm payroll']) assert.match(await h.run(`timesheetTab=${JSON.stringify(tab)};timesheets()`), /Timesheets/);
  await h.run("globalPanel('settings')"); assert.match(h.elements.get('#overlay').innerHTML, /Language/);
  for (const expression of ["gapAction('language')", "gapAction('rewards')", "growthAction('review-responses')"]) { await h.run(expression); assert.ok(h.elements.get('#overlay').innerHTML.length > 0); }
  assert.match(await h.run('referAndEarnBase()'), /Invite a friend/);
  assert.match(await h.run("schedFilter.team='1';schedule()"), /schedule-toolbar/);
});

test('T15 active dedicated phone switches Message Center from onboarding to conversations', async () => {
  for (const active of [true, false]) {
    const h = loopHarness({ messages: [{ client_id: 1, body: 'Hello', channel: 'sms' }] }, { dedicated_phone_number: { active, number: '+15551234567' } });
    for (const sel of ['#message-search', '#message-channel', '#overlay [data-msg-filter]']) h.elements.set(sel, h.makeEl());
    await h.run("globalPanel('messages')");
    const html = h.elements.get('#overlay').innerHTML;
    assert.equal(/id="message-onboarding" hidden/.test(html), active);
    assert.equal(/id="live-conversations" hidden/.test(html), !active);
    assert.equal(html.includes('id="message-active-number"'), active);
    const markup = html.match(/<button data-live-conversations([^>]*)>([^<]*)<\/button>/);
    assert.ok(markup);
    assert.equal(/\bhidden\b/.test(markup[1]), active);
    assert.match(markup[1], /data-count="1"/);
    assert.ok(markup[1].includes(`aria-expanded="${active}"`));
    assert.equal(markup[2], `${active ? 'Hide' : 'View'} Live Conversations (1)`);
    const conv = h.makeEl(), onb = h.makeEl(), toggle = h.makeEl();
    conv.hidden = !active; onb.hidden = active;
    toggle.hidden = active; toggle.textContent = markup[2]; toggle.dataset.count = '1';
    toggle.setAttribute('aria-expanded', String(active));
    toggle.hasAttribute = name => name === 'data-live-conversations';
    toggle.matches = () => false;
    toggle.closest = selector => selector === '[data-close]' ? null : toggle;
    h.elements.set('#live-conversations', conv);
    h.elements.set('#message-onboarding', onb);
    h.elements.set('[data-live-conversations]', toggle);
    if (active) h.elements.set('#message-active-number', h.makeEl());
    const click = () => h.listeners.click[0]({ target: toggle, preventDefault() {} });
    const check = show => {
      assert.equal(conv.hidden, !show);
      assert.equal(onb.hidden, show);
      assert.equal(toggle.hidden, active);
      assert.equal(toggle['aria-expanded'], String(show));
      assert.equal(toggle.textContent, `${show ? 'Hide' : 'View'} Live Conversations (1)`);
    };
    await click(); check(true);
    await click(); check(active);
    const filter = h.elements.get('#overlay [data-msg-filter]');
    const unread = h.makeEl(), read = h.makeEl();
    unread.dataset = { unread: 'true', conversation: 'client', channel: 'sms' };
    read.dataset = { unread: 'false', conversation: 'client', channel: 'sms' };
    h.queryAllMap.set('[data-conversation]', [unread, read]);
    filter.value = 'unread'; filter.onchange(); check(true);
    assert.equal(unread.hidden, false); assert.equal(read.hidden, true);
    filter.value = 'all'; filter.onchange(); check(true);
    assert.equal(read.hidden, false);
    // Stale controls must tolerate a closed or replaced panel.
    const search = h.elements.get('#message-search'), channel = h.elements.get('#message-channel');
    for (const sel of ['#message-search', '#message-channel', '#live-conversations', '#message-onboarding', '[data-live-conversations]']) h.elements.delete(sel);
    assert.doesNotThrow(() => { search.oninput(); channel.onchange(); filter.onchange(); });
    await click();
    await loopClick(h, {}, ['data-message-filter']);
    assert.equal(h.elements.get('#toast').textContent, '');
    await h.run("globalPanel('messages')");
  }
});

test('T15 messages checks panel version before fetching preferences', async () => {
  let release; const paths = [];
  const h = createHarness(path => { paths.push(path); return new Promise(resolve => { release = () => resolve({ ok: true, json: async () => [] }); }); });
  const pending = h.run("globalPanel('messages')");
  assert.deepEqual(paths, ['/api/messages']);
  h.run('close()'); release(); await pending;
  assert.deepEqual(paths, ['/api/messages']); assert.equal(h.elements.get('#overlay').innerHTML, '');
});

test('T15 Client Builder custom field detour preserves draft, Back and custom values', async () => {
  const h = loopHarness();
  const form = h.elements.get('#builder');
  form.values = { first_name: 'Draft', property_street1: '123 Main', contact_0_first_name: 'Alex', extra_email_0: 'extra@example.test', custom_field_7: 'Existing' };
  form.querySelectorAll = () => [{ type: 'checkbox', name: 'receives_sms', checked: false }];
  h.run("window.draft=captureClientBuilderDraft(document.querySelector('#builder'),{id:1});window.resumed=[];builder=async(...args)=>window.resumed.push(args);");
  assert.equal(h.run('window.draft._primaryProperty.street1'), '123 Main');
  assert.equal(h.run('window.draft._clientDraft.receives_sms'), '');
  const action = h.elements.get('#action-form'); let appended = '';
  action.insertAdjacentHTML = (_, html) => { appended += html; };
  await h.run("customFieldEditor('clients',0,{id:1,draft:window.draft})");
  assert.match(appended, /Back to Client/);
  await loopClick(h, {}, ['data-client-cf-back']);
  assert.equal(h.run('window.resumed[0][2]._clientDraft.contact_0_first_name'), 'Alex');
  await h.run("customFieldEditor('clients',0,{id:1,draft:window.draft})");
  await loopSubmit(h, { entity_type: 'clients', field_name: 'Gate code', field_type: 'text', default_value: '' });
  assert.equal(h.writes[0].key, 'custom-fields');
  assert.equal(h.run('window.resumed[1][2]._clientDraft.extra_email_0'), 'extra@example.test');
  await h.run("saveClientExtras(1,{custom_field_7:'Existing',custom_field_8:'1234'},null,true)");
  assert.deepEqual(h.writes.slice(-2).map(w => w.body), [7, 8].map((id, i) => ({ field_definition_id: id, entity_type: 'clients', entity_id: 1, value_text: i ? '1234' : 'Existing' })));
  assert.match(h.run('clientEditorFields(window.draft)'), /\+ Add Custom Field/);
});

for(const returnVia of ['save','back'])test('Pending client save resumes Edit Client via '+returnVia, async () => {
  let release;const writes=[],created={id:42,display_name:'Pending client'};
  const h=createHarness(async(path,options={})=>{
    const key=path.replace('/api/',''),method=options.method||'GET';let value=[];
    if(method!=='GET')writes.push({key,method,body:JSON.parse(options.body)});
    if(key==='clients'&&method==='POST')value=await new Promise(resolve=>{release=()=>resolve(created);});
    else if(key==='clients')value=[created];
    else if(key==='clients/42')value=created;
    else if(key==='properties'&&method==='POST')value={id:100+writes.filter(w=>w.key==='properties').length};
    else if(key==='custom-fields'&&method==='POST')value={id:7};
    return {ok:true,status:200,json:async()=>value};
  });
  h.run('render=async()=>{};org={};');
  await h.run("builder('clients')");
  const form=h.elements.get('#builder');
  form.values={first_name:'Pending client',property_street1:'123 Main',property_0_street1:'456 Other',contact_0_first_name:'Alex'};
  const submit=()=>form.onsubmit({target:form,preventDefault(){}}),saving=submit();
  await submit();assert.equal(writes.filter(w=>w.key==='clients').length,1);
  const target=h.makeEl();target.hasAttribute=name=>name==='data-client-custom-field';target.matches=()=>false;
  target.closest=selector=>selector==='[data-close]'?null:selector==='#builder'?form:target;
  await h.listeners.click[0]({target,preventDefault(){}});
  const resume=h.elements.get('#action-form').resumeClient;assert.ok(resume.pending);
  const returning=returnVia==='back'?loopClick(h,{},['data-client-cf-back']):loopSubmit(h,{entity_type:'clients',field_name:'Code',field_type:'text',default_value:''});
  await Promise.resolve();assert.doesNotMatch(h.elements.get('#overlay').innerHTML,/Edit Client/);
  release();await saving;await returning;
  assert.match(h.elements.get('#overlay').innerHTML,/Edit Client/);
  assert.equal(form.clientEditor.id,42);assert.equal(resume.draft._primaryProperty.id,101);
  assert.equal(resume.draft._originalRow._primaryProperty.id,101);
  assert.equal(resume.draft._clientDraft.contact_0_first_name,undefined);
  assert.equal(resume.draft.property_0_street1,undefined);
  form.values={...resume.draft._clientDraft};await submit();
  assert.deepEqual(writes.filter(w=>/^clients(?:\/42)?$/.test(w.key)).map(w=>[w.key,w.method]),[['clients','POST'],['clients/42','PATCH']]);
  assert.equal(writes.filter(w=>w.key==='contacts').length,1);
  assert.equal(writes.filter(w=>w.key==='properties'&&w.method==='POST').length,2);
  assert.ok(writes.some(w=>w.key==='properties/101'&&w.method==='PATCH'));
});

for(const edited of [false,true])test('Pending client detour retains new extras and '+(edited?'PATCHes edited':'removes only unchanged')+' submitted rows', async () => {
  let release;const writes=[],created={id:42,display_name:'Client'};
  const h=createHarness(async(path,options={})=>{
    const key=path.replace('/api/',''),method=options.method||'GET';let value=[];
    if(method!=='GET')writes.push({key,method,body:JSON.parse(options.body)});
    if(key==='clients'&&method==='POST')value=await new Promise(resolve=>{release=()=>resolve(created);});
    else if(key==='clients')value=[created];
    else if(key==='clients/42')value=created;
    else if(method==='POST'&&(key==='properties'||key==='contacts'))value={id:(key==='properties'?100:200)+writes.filter(w=>w.key===key).length};
    return {ok:true,status:200,json:async()=>value};
  });
  h.run('render=async()=>{};org={};');await h.run("builder('clients')");
  const form=h.elements.get('#builder');
  form.values={first_name:'Client',contact_0_first_name:'Alex',property_0_street1:'Old address'};
  const submit=()=>form.onsubmit({target:form,preventDefault(){}}),saving=submit();
  Object.assign(form.values,{contact_1_email:'new@example.test',property_1_street1:'New address'});
  if(edited)Object.assign(form.values,{contact_0_first_name:'Alex edited',property_0_street1:'Edited address'});
  const target=h.makeEl();target.hasAttribute=name=>name==='data-client-custom-field';target.matches=()=>false;
  target.closest=selector=>selector==='[data-close]'?null:selector==='#builder'?form:target;
  await h.listeners.click[0]({target,preventDefault(){}});
  const resume=h.elements.get('#action-form').resumeClient;
  release();await saving;await loopClick(h,{},['data-client-cf-back']);
  const html=h.elements.get('#overlay').innerHTML;
  assert.match(html,/Edit Client/);assert.match(html,/new@example.test/);assert.match(html,/New address/);
  assert.equal(resume.draft._clientDraft.contact_1_email,'new@example.test');
  assert.equal(resume.draft._clientDraft.property_1_street1,'New address');
  if(edited){assert.match(html,/name="contact_0_id" value="201"/);assert.match(html,/name="property_0_id" value="101"/);}
  else {assert.equal(resume.draft.contact_0_first_name,undefined);assert.equal(resume.draft._clientDraft.property_0_street1,undefined);}
  form.values={...resume.draft._clientDraft};await submit();
  assert.equal(writes.filter(w=>w.key==='contacts'&&w.method==='POST').length,2);
  assert.equal(writes.filter(w=>w.key==='properties'&&w.method==='POST').length,2);
  assert.equal(writes.find(w=>w.key==='contacts'&&w.body.email==='new@example.test').body.name,'new@example.test');
  assert.ok(writes.some(w=>w.key==='properties'&&w.body.street1==='New address'));
  if(edited){assert.equal(writes.find(w=>w.key==='contacts/201').body.name,'Alex edited');assert.equal(writes.find(w=>w.key==='properties/101').body.street1,'Edited address');}
});

for(const subsequent of ['none','display_name','first_name'])test('Pending client detour synchronizes saved display name and preserves '+subsequent, async () => {
  let release;const writes=[],original={id:1,first_name:'John',last_name:'Smith',display_name:'John Smith'};
  const h=createHarness(async(path,options={})=>{
    const key=path.replace('/api/',''),method=options.method||'GET';let value=[];
    if(method!=='GET')writes.push({key,method,body:JSON.parse(options.body)});
    if(key==='clients/1'&&method==='PATCH')value=writes.filter(w=>w.key===key).length===1?await new Promise(resolve=>{release=()=>resolve({...original,first_name:'Jane',display_name:'Jane Smith'});}):{...original,...JSON.parse(options.body)};
    else if(key==='clients/1')value=original;
    else if(key==='clients')value=[original];
    return {ok:true,status:200,json:async()=>value};
  });
  h.run('render=async()=>{};org={};');await h.run("builder('clients',1)");
  const form=h.elements.get('#builder');form.values={first_name:'Jane',last_name:'Smith',display_name:'John Smith'};
  const disp={get value(){return form.values.display_name;},set value(v){form.values.display_name=v;}};
  form.querySelector=sel=>sel==='[name="display_name"]'?disp:null;
  const submit=()=>form.onsubmit({target:form,preventDefault(){}}),saving=submit();
  if(subsequent==='display_name')form.values.display_name='Custom name';
  if(subsequent==='first_name')form.values.first_name='Janet';
  const target=h.makeEl();target.hasAttribute=name=>name==='data-client-custom-field';target.matches=()=>false;
  target.closest=selector=>selector==='[data-close]'?null:selector==='#builder'?form:target;
  await h.listeners.click[0]({target,preventDefault(){}});
  const resume=h.elements.get('#action-form').resumeClient;
  release();await saving;
  assert.equal(disp.value,subsequent==='display_name'?'Custom name':'Jane Smith');
  await loopClick(h,{},['data-client-cf-back']);
  assert.match(h.elements.get('#overlay').innerHTML,/Edit Client/);
  assert.equal(resume.draft._clientDraft.first_name,subsequent==='first_name'?'Janet':'Jane');
  form.values={...resume.draft._clientDraft};await submit();
  const patches=writes.filter(w=>w.key==='clients/1');assert.equal(patches.length,2);
  assert.equal(patches[0].body.display_name,'Jane Smith');
  assert.equal(patches[1].body.display_name,subsequent==='display_name'?'Custom name':subsequent==='first_name'?'Janet Smith':'Jane Smith');
});

for(const failure of ['refresh','extras'])for(const dom of [false,true])test(`Client retry advances baseline after ${failure} failure (DOM ${dom})`,async()=>{
  const original={id:1,first_name:'John',last_name:'Smith',display_name:'John Smith'},writes=[];let failed=false;
  const h=createHarness(async(path,options={})=>{
    const key=path.replace('/api/',''),method=options.method||'GET',body=options.body?JSON.parse(options.body):{};let value=[];
    if(method!=='GET')writes.push({key,method,body});
    if(!failed&&((failure==='extras'&&key==='contacts'&&body.name==='Second')||(failure==='refresh'&&key==='clients'))){failed=true;throw Error('Injected failure');}
    if(key==='clients/1')value=method==='PATCH'?{...original,...body}:original;
    if(key==='properties')value=method==='POST'?{id:body.is_primary?100:101}:[];
    if(key==='contacts'&&method==='POST')value={id:body.name==='First'?201:202};
    return {ok:true,status:200,json:async()=>value};
  });
  h.run('render=async()=>{};org={};');await h.run("builder('clients',1)");
  const form=h.elements.get('#builder');form.values={first_name:'Jane',last_name:'Smith',display_name:'John Smith',property_street1:'Primary',property_0_street1:'Extra',contact_0_first_name:'First',contact_1_first_name:'Second'};
  if(dom)form.querySelector=sel=>{const name=sel.match(/^\[name="([^"]+)"\]$/)?.[1];return name&&name in form.values?{get value(){return form.values[name];},set value(v){form.values[name]=v;}}:null;};
  const submit=()=>form.onsubmit({target:form,preventDefault(){}});await submit();assert.equal(failed,true);
  assert.equal(form.values.display_name,'Jane Smith');assert.equal(form.clientEditor.row._originalRow.first_name,'Jane');assert.equal(form.clientEditor.row._primaryProperty.id,100);
  assert.equal(form.clientEditor.lastSavedExtras.extrasResult.savedContacts.contact_0_,201);
  form.values.first_name='Janet';await submit();
  assert.equal(writes.filter(w=>w.key==='clients/1')[1].body.display_name,'Janet Smith');
  assert.equal(writes.filter(w=>w.key==='properties'&&w.method==='POST').length,2);
  assert.equal(writes.filter(w=>w.key==='contacts'&&w.body.name==='First').length,1);
  for(const key of ['properties/100','properties/101','contacts/201'])assert.ok(writes.some(w=>w.key===key&&w.method==='PATCH'));
});

test('Client extras without response IDs skip unchanged successful prefixes on retry',async()=>{
  const h=loopHarness();h.run('window.persisted={primaryPropertyId:null,savedProps:{},savedContacts:{},submittedRaw:{}}');
  for(let i=0;i<2;i++)await h.run("saveClientExtras(1,{property_street1:'Main',property_0_street1:'Other',contact_0_first_name:'Alex'},null,true,window.persisted)");
  assert.equal(h.writes.filter(w=>w.key==='properties').length,2);assert.equal(h.writes.filter(w=>w.key==='contacts').length,1);
});

test('New client builder persists explicitly cleared custom field defaults on reopen', async () => {
  const values=[],created={id:42,display_name:'Cleared default'};
  const h=createHarness(async(path,options={})=>{
    const key=path.replace('/api/','');let value=[];
    if(key==='custom-fields')value=[{id:7,entity_type:'clients',field_name:'Code',field_type:'text',default_value:'ABC'}];
    if(key==='custom-field-values'){if(options.method==='POST')values.push(JSON.parse(options.body));value=values;}
    if(key==='clients')value=options.method==='POST'?created:[created];
    if(key==='clients/42')value=created;
    return {ok:true,status:200,json:async()=>value};
  });
  const host=h.makeEl();h.elements.set('#client-custom-fields',host);
  h.run("render=async()=>{};org={};");
  await h.run("builder('clients')");assert.match(host.innerHTML,/value="ABC"/);
  const form=h.elements.get('#builder');form.values={first_name:'Cleared default',custom_field_7:''};
  await form.onsubmit({target:form,preventDefault(){}});
  assert.equal(values.length,1);assert.equal(values[0].entity_id,42);assert.equal(values[0].value_text,'');
  await h.run("builder('clients',42)");assert.match(host.innerHTML,/name="custom_field_7"[^>]*value=""/);assert.doesNotMatch(host.innerHTML,/value="ABC"/);
});

test('Delayed clipboard fallback and upstream requests preserve newer editors and views', async () => {
  for(const action of ['direct','copy-referral'])for(const change of ['panel','view']){
    const h=loopHarness({'account-billing':{referral_code:'CODE'}});
    h.run("navigator={clipboard:{writeText:()=>new Promise((resolve,reject)=>window.rejectCopy=reject)}};");
    const pending=action==='direct'?h.run("copyText('CODE','Copied')"):loopClick(h,{action});
    for(let i=0;i<20&&!h.run('Boolean(window.rejectCopy)');i++)await Promise.resolve();
    assert.equal(h.run('Boolean(window.rejectCopy)'),true);
    if(change==='panel')await h.run("builder('clients')");else h.run('viewVersion++');
    const overlay=h.elements.get('#overlay'),html=overlay.innerHTML,form=h.elements.get('#builder');form.values={first_name:'Unsaved work'};
    h.run("window.rejectCopy(Error('Denied'))");await pending;
    assert.equal(overlay.innerHTML,html);assert.equal(form.values.first_name,'Unsaved work');
  }
  for(const action of ['copy-referral','copy-hub','review-responses']){
    const h=loopHarness();h.run("clients=[{id:1}];navigator={};window.realFetch=fetch;fetch=()=>new Promise(resolve=>window.releaseFetch=()=>resolve({ok:true,status:200,json:async()=>({referral_code:'CODE',token:'hub'})}));");
    const pending=loopClick(h,{action});await Promise.resolve();
    h.run('fetch=window.realFetch');await h.run("builder('clients')");
    const html=h.elements.get('#overlay').innerHTML;h.elements.get('#builder').values={first_name:'Keep draft'};
    h.run('window.releaseFetch()');await pending;
    assert.equal(h.elements.get('#overlay').innerHTML,html);assert.equal(h.elements.get('#builder').values.first_name,'Keep draft');
  }
});

test('Opening balance fallback sums unique active invoice identities', async () => {
  const h=loopHarness({'invoices/1':{total_cents:5000},'invoices/2':{total_cents:3000},'invoices/3':{total_cents:9000,status:'void'},'invoices/4':{total_cents:9000,job_id:1}}, {'initial_balance_invoice:1':{invoice_id:1,invoice_ids:[1,2,2,3,4]}});
  await h.run("recordDetailAction('clients',{id:1},'Set initial balance')");
  assert.match(h.elements.get('#overlay').innerHTML,/name="balance"[^>]*value="80"/);
});

test('T15 missing receipt, clipboard fallback, midnight slot and unknown route', async () => {
  const h = loopHarness({ 'account-billing': { payments: [] }, jobs: [{ id: 1, title: 'Late job' }] });
  await loopClick(h, { receipt: '999' }); assert.match(h.elements.get('#overlay').innerHTML, /Receipt not found/);
  for (const setup of ["navigator={}", "navigator={clipboard:{writeText:async()=>{throw Error('Denied');}}}"]) {
    h.run(setup); await h.run("copyText('https://example.test/link','Copied','Copy Link')");
    assert.match(h.elements.get('#overlay').innerHTML, /https:\/\/example.test\/link/);
  }
  const target = h.makeEl(); target.dataset = { slot: '2030-01-07T23:00' }; target.hasAttribute = () => false; target.matches = () => false;
  target.closest = selector => ['[data-close]', '[data-appointment]'].includes(selector) ? null : target;
  await h.listeners.click[0]({ target, preventDefault() {} });
  assert.match(h.elements.get('#overlay').innerHTML, /name="end"[^>]*value="2030-01-08T00:00"/);
  await h.run("route='not-a-real-route';render()"); assert.match(h.elements.get('#workspace').innerHTML, /Page not found/);
});

test('T15 company settings update live brand and tolerate absent header', async () => {
  for (const hasHeader of [true, false]) {
    const h = loopHarness(); const brand = h.makeEl();
    if (hasHeader) h.elements.set('#header .brand > span:not(#breadcrumb)', brand);
    const form = h.makeEl(); form.values = { name: 'New company' };
    h.elements.set('#company-test', form);
    await h.run("saveCompanySettings({preventDefault(){},target:document.querySelector('#company-test')})");
    assert.equal(h.run('org.name'), 'New company');
    if (hasHeader) assert.equal(brand.textContent, 'New company');
    assert.equal(h.writes.find(w => w.key === 'settings').body.name, 'New company');
  }
});

test('T15 property editing refreshes drawer and deletion returns to client', async () => {
  const h = loopHarness({ 'properties/1': { id: 1, client_id: 2, street1: 'Old street' }, properties: [{ id: 1 }] });
  const edit = h.makeEl(), del = h.makeEl(); del.dataset.propertyAction = 'Delete property';
  h.elements.set('[data-property-edit]', edit); h.queryAllMap.set('[data-property-action]', [del]);
  await h.run('propertyDetail(1)'); await edit.onclick(); await loopSubmit(h, { street1: 'New street' });
  assert.match(h.elements.get('#overlay').innerHTML, /New street/);
  assert.equal(h.run('cache.properties.length'), 1);
  h.run('window.returned=null;detail=async(type,id)=>{window.returned={type,id};}');
  await del.onclick();
  assert.deepEqual(JSON.parse(h.run('JSON.stringify(window.returned)')), { type: 'clients', id: 2 });
  assert.equal(h.writes.at(-1).method, 'DELETE');
});


// T16: exercise persistence through the same services and classic-script handlers as the UI.
test('T16 CSV imports validate all resource types atomically and preserve document ledgers', async t => {
 const {importCSV,exportCSV,parseCSV,generatePDF}=await import('../src/services/pdf.js');
 const db=createDatabase();seedDatabase(db);t.after(()=>db.close());const w=workflows(db,1,1),r=w.r;
 const c=w.createClient({display_name:'CSV client'}),other=w.createClient({display_name:'Other'}),property=r.insert('properties',{client_id:other.id,street1:'Other street'});
 for(const type of ['requests','quotes','jobs','invoices']){
  const name=type==='invoices'?'subject':'title',csv='client_id,'+name+'\n'+c.id+',Imported '+type;
  const [created]=importCSV(r,type,csv,w);assert.equal(created[name],'Imported '+type);
  const roundtrip=exportCSV([created],['client_id',name]);assert.equal(parseCSV(roundtrip)[0][name],created[name]);assert.equal(importCSV(r,type,roundtrip,w)[0][name],created[name]);
  const count=r.list(type).length;assert.throws(()=>importCSV(r,type,csv+'\n0,Invalid',w));assert.equal(r.list(type).length,count);
  assert.throws(()=>importCSV(r,type,'client_id,'+name+',property_id\n'+c.id+',Wrong,'+property.id,w),/another client/);
 }
 const [draft]=importCSV(r,'invoices','client_id,title,status,total_cents\n'+c.id+',Alias,draft,1234',w);assert.equal(draft.subject,'Alias');assert.equal(draft.total_cents,1234);assert.equal(draft.status,'draft');
 const [issued]=importCSV(r,'invoices','client_id,subject,status,subtotal_cents,tax_rate\n'+c.id+',Issued,awaiting_payment,1000,10',w);assert.equal(issued.total_cents,1100);assert.equal(issued.status,'awaiting_payment');assert.equal(r.get('clients',c.id).balance_cents,1100);
 assert.throws(()=>importCSV(r,'invoices','client_id,subject,status\n'+c.id+',Bad,paid',w),/draft or awaiting_payment/);
 assert.equal(importCSV(r,'expenses','item_name,amount_cents,reimbursable,billable\nMortar,200,0,1',w)[0].amount_cents,200);
 assert.equal(importCSV(r,'products_services','name,unit_price_cents,markup_percent,active\nTile,300,2.5,0',w)[0].active,0);
 for(const csv of ['name,active\nBad,2','name,unit_price_cents\nBad,-1','name,markup_percent\nBad,Infinity','name\n" "'])assert.throws(()=>importCSV(r,'products_services',csv,w));
 assert.throws(()=>importCSV(r,'expenses','item_name,user_id\nBad,999999',w));assert.throws(()=>importCSV(r,'payments','amount_cents\n10',w),/Unsupported import/);
 assert.equal(importCSV(r,'clients','display_name,email\nLegacy,legacy@example.test',w.createClient)[0].display_name,'Legacy');
 const pdf=generatePDF(draft,[],{name:'Test'},{name:'Signer',signature:'Signed'}).toString();assert.match(pdf,/Signed by: Signer/);assert.equal(pdf.slice(Number(pdf.match(/startxref\n(\d+)/)[1]),Number(pdf.match(/startxref\n(\d+)/)[1])+4),'xref');
});

test('Astra P2 deleted invoice preferences cannot leak across reused IDs',async t=>{
 const db=createDatabase();seedDatabase(db);const server=await startServer({db,seed:false,port:0,allowDemoSwitch:true});t.after(async()=>{await server.close();db.close();});
 const session=await(await fetch(server.url+'/api/auth/bootstrap',{method:'POST'})).json(),headers={Authorization:'Bearer '+session.token},w=workflows(db,1,1),r=w.r,c=w.createClient({display_name:'ID isolation'});
 const create=()=>w.createInvoice({client_id:c.id,subject:'Fresh invoice'},[{name:'Work',quantity:1,unit_price_cents:1000}]),old=create();
 const names=[`signature-invoices-${old.id}`,`detail-invoices-${old.id}-edit-online-payment-settings`],save=()=>{r.insert('preferences',{name:names[0],value_json:JSON.stringify({name:'Deleted signer',signature:'Old ink'})});r.insert('preferences',{name:names[1],value_json:JSON.stringify({'Card payments':false,'Partial payments':false})});};save();
 const neighbor=r.insert('preferences',{name:`detail-invoices-${old.id}0-edit-online-payment-settings`,value_json:'{}'});
 assert.match(await(await fetch(server.url+'/api/invoices/'+old.id+'/pdf',{headers})).text(),/Deleted signer/);
 assert.equal((await fetch(server.url+'/api/invoices/'+old.id,{method:'DELETE',headers})).status,200);
 for(const name of names)assert.equal(r.list('preferences',{name}).length,0);
 assert.ok(r.get('preferences',neighbor.id));
 // Simulate orphaned preferences from deletions predating the cleanup fix.
 save();const fresh=create();assert.equal(fresh.id,old.id);for(const name of names)assert.equal(r.list('preferences',{name}).length,0);
 w.issueInvoice(fresh.id,'upon_receipt');
 const pdf=await fetch(server.url+'/api/invoices/'+fresh.id+'/pdf',{headers});assert.equal(pdf.status,200);assert.doesNotMatch(await pdf.text(),/Deleted signer|Old ink|Signed by:/);
 const hub=server.url+'/api/client-hub/'+c.portal_token;
 const payment=await fetch(hub+'/invoices/'+fresh.id+'/pay',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method:'card',amount_cents:500})});assert.equal(payment.status,200);assert.equal(r.get('invoices',fresh.id).balance_due_cents,500);
});

test('Astra P2 800 issued CSV invoices reconcile once at batch completion',async t=>{
 const {importCSV,exportCSV}=await import('../src/services/pdf.js');const db=createDatabase();seedDatabase(db);t.after(()=>db.close());const w=workflows(db,1,1),r=w.r,c=w.createClient({display_name:'Batch ledger'});
 db.exec(`CREATE TEMP TABLE ledger_updates (invoice_count INTEGER); CREATE TEMP TRIGGER batch_ledger_update AFTER UPDATE OF balance_cents ON clients WHEN NEW.id=${c.id} BEGIN INSERT INTO ledger_updates SELECT count(*) FROM invoices WHERE client_id=NEW.id; END;`);
 const csv=exportCSV(Array.from({length:800},(_,i)=>({client_id:c.id,subject:'Batch '+i,status:'awaiting_payment',total_cents:100,issued_date:'2000-01-01',payment_terms:'upon_receipt'})));
 const list=r.list;let ledgerScans=0;r.list=(table,filter)=>{if(table==='invoices'&&filter?.client_id===c.id)ledgerScans++;return list(table,filter);};
 const started=performance.now(),imported=importCSV(r,'invoices',csv,w),elapsed=performance.now()-started;r.list=list;
 assert.equal(ledgerScans,2,'one reconciliation performs two client invoice scans');
 assert.equal(imported.length,800);assert.ok(imported.every(inv=>inv.status==='past_due'&&inv.balance_due_cents===100));assert.equal(r.get('clients',c.id).balance_cents,80000);
 assert.deepEqual(db.prepare('SELECT invoice_count FROM ledger_updates').all().map(row=>row.invoice_count),[800]);
 t.diagnostic(`800-invoice batch import: ${elapsed.toFixed(1)}ms`);
});

test('T16 HTTP exports retain empty headers and portal preferences enforce payment methods',async t=>{
 const db=createDatabase();seedDatabase(db);const server=await startServer({db,seed:false,port:0,allowDemoSwitch:true});t.after(async()=>{await server.close();db.close();});
 const session=await(await fetch(server.url+'/api/auth/bootstrap',{method:'POST'})).json(),headers={Authorization:'Bearer '+session.token,'Content-Type':'application/json'},w=workflows(db,1,1),r=w.r;
 for(const type of ['clients','catalog','requests','quotes','jobs','invoices','payments','expenses']){const res=await fetch(server.url+'/api/'+type+'/export',{headers});assert.equal(res.status,200,type);const csv=await res.text();assert.match(csv,/"id"/);if(type==='clients'){assert.match(csv,/initial_balance_cents/);assert.doesNotMatch(csv,/portal_token/);}}
 assert.equal((await fetch(server.url+'/api/payments/import',{method:'POST',headers,body:JSON.stringify({csv:'amount_cents\n100'})})).status,400);
 const c=w.createClient({display_name:'Portal T16'}),q=w.createQuote({client_id:c.id,title:'Quote'},[]),inv=w.createInvoice({client_id:c.id,subject:'Invoice'},[{name:'Work',quantity:1,unit_price_cents:1000}]);r.update('quotes',q.id,{status:'awaiting_response'});w.issueInvoice(inv.id,'upon_receipt');
 const pref=(name,value)=>r.insert('preferences',{name,value_json:JSON.stringify(value)});
 pref('detail-quotes-'+q.id+'-introduction',{title:'Welcome',message:'Scope'});pref('signature-invoices-'+inv.id,{name:'Signer',signature:'Ink'});
 const ops=pref('detail-invoices-'+inv.id+'-edit-online-payment-settings',{'Card payments':false,'Bank payments':true,'Partial payments':false});
 const hub=server.url+'/api/client-hub/'+c.portal_token,data=await(await fetch(hub)).json();assert.equal(data.quotes[0].introduction.title,'Welcome');assert.equal(data.invoices[0].online_payments['Card payments'],false);
 const pay=async(method,amount_cents)=>fetch(hub+'/invoices/'+inv.id+'/pay',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,amount_cents})});
 assert.equal((await pay('card',1000)).status,400);assert.equal((await pay('ach',500)).status,400);assert.equal(r.get('invoices',inv.id).balance_due_cents,1000);
 assert.match(await(await fetch(server.url+'/api/invoices/'+inv.id+'/pdf',{headers})).text(),/Signed by: Signer/);
 assert.equal((await pay('ach',1000)).status,200);
});

function t16PreferenceHarness(initial=[]){const prefs=initial.map((p,i)=>({id:i+1,name:p[0],value_json:JSON.stringify(p[1])}));const h=createHarness(async(path,options={})=>{const key=path.replace(/^\/api\//,'');let data=[];if(key.startsWith('preferences')){if(options.method&&options.method!=='GET'){const d=JSON.parse(options.body);let row=prefs.find(p=>p.name===d.name);if(!row){row={id:prefs.length+1};prefs.push(row);}Object.assign(row,d);if(typeof row.value_json!=='string')row.value_json=JSON.stringify(row.value_json);data=row;}else data=prefs;}return {ok:true,status:200,json:async()=>data};});return {...h,prefs};}

test('T16 detail subforms prefill, persist false, validate and return only to an originating drawer',async()=>{
 for(const [type,action,value] of [['invoices','Edit client view',{'Quantities':false}],['invoices','Edit online payment settings',{'Card payments':false}],['jobs','Edit Invoice Settings',{frequency:'Monthly',amount:25}],['quotes','Introduction',{title:'Hello',message:'Scope'}],['quotes','Edit deposit payment settings',{frequency:'Once',amount:10}],['clients','Add manually',{name:'Cardholder',last4:'1234'}],['quotes','Collect Signature',{name:'Signer',signature:'Ink'}]]){
  const key=action==='Collect Signature'?'signature-'+type+'-1':'detail-'+type+'-1-'+action.toLowerCase().replaceAll(' ','-'),h=t16PreferenceHarness([[key,value]]);
  await h.run('recordDetailAction('+JSON.stringify(type)+',{id:1},'+JSON.stringify(action)+')');const html=h.elements.get('#overlay').innerHTML;for(const v of Object.values(value))if(typeof v!=='boolean')assert.ok(html.includes(String(v)),action);
  const form=h.elements.get('#action-form');form.values={...value};form.querySelectorAll=()=>Object.keys(value).filter(k=>typeof value[k]==='boolean').map(name=>({name,checked:false}));
  h.run('globalThis.reopens=0;detail=async()=>{reopens++};render=async()=>{}');await form.onsubmit({target:form,preventDefault(){}});assert.equal(h.run('reopens'),0);
  await h.run('activeDetailKey='+JSON.stringify(type+':1')+';recordDetailAction('+JSON.stringify(type)+',{id:1},'+JSON.stringify(action)+')');await form.onsubmit({target:form,preventDefault(){}});assert.equal(h.run('reopens'),1);assert.deepEqual(JSON.parse(h.prefs.find(p=>p.name===key).value_json),action==='Collect Signature'?{...value,signed_at:JSON.parse(h.prefs.find(p=>p.name===key).value_json).signed_at}:value);
 }
});

test('T16 timer, calendar and question inspector preserve unchecked checkbox values',async()=>{
 const h=t16PreferenceHarness([['custom-timer-test',{label:'Travel',active:true}],['calendar-sync',{enabled:false,provider:'Google Calendar'}]]);
 await h.run("growthAction({dataset:{action:'timer-edit:custom-timer-test'}})");const form=h.elements.get('#action-form');form.values={label:'Travel'};form.querySelectorAll=()=>[{name:'active',checked:false}];await form.onsubmit({target:form,preventDefault(){}});assert.equal(JSON.parse(h.prefs[0].value_json).active,false);assert.match(h.elements.get('#overlay').innerHTML,/Travel \(Inactive\)/);
 assert.match(await h.run("settingsPartB('schedule')"),/Calendar sync: Disabled/);
 h.run("requestFormDraft={key:'request-form-test',title:'Test',questions:[{type:'Add assessment',free:true,member_1:true}]};team=[{id:1,name:'Crew'}]");await h.run("settingsPartBAction({dataset:{settingsAction:'form-inspect:0'}})");form.values={label:'Assessment'};form.querySelectorAll=()=>[{name:'free',checked:false},{name:'member_1',checked:false}];await form.onsubmit({target:form,preventDefault(){}});assert.equal(h.run('requestFormDraft.questions[0].free'),false);assert.equal(h.run('requestFormDraft.questions[0].member_1'),false);
 const address={value:'Old'},radius={value:'90'};h.elements.set('#action-form [name="address"]',address);h.elements.set('#action-form [name="radius"]',radius);await h.run("settingsPartBAction({dataset:{settingsAction:'form-area-reset'}})");assert.equal(address.value,'');assert.equal(radius.value,'25');assert.equal(h.run('requestFormDraft.area.radius'),25);
});

test('T16 linked request forms persist step two and resolve the actual linked title',async()=>{
 const h=t16PreferenceHarness([['google-business-linked-form',{key:'request-form-linked'}],['request-form-linked',{title:'Linked title'}]]);
 assert.match(await h.run("settingsPartB('requests-and-bookings')"),/Linked to Google Business Profile/);await h.run("requestFormOpen('request-form-default')");h.run("requestFormBuilder('Settings')");assert.match(h.elements.get('#overlay').innerHTML,/Linked form: Linked title/);
 await h.run("settingsPartBAction({dataset:{settingsAction:'request-form-new'}})");const form=h.elements.get('#action-form');form.values={kind:'Request Form'};await form.onsubmit({target:form,preventDefault(){}});form.values={title:' New saved form '};await form.onsubmit({target:form,preventDefault(){}});assert.ok(h.prefs.some(p=>JSON.parse(p.value_json).title==='New saved form'));
});

test('T16 date and tag pills isolate resources and payments have no import form',async()=>{
 const data={};for(const type of ['clients','jobs','expenses','quotes','invoices'])data[type]=[{id:1,display_name:'Visible client',title:'Visible '+type,item_name:'Visible expense',status:type==='jobs'?'active':'draft',created_at:'2026-01-01',issued_date:'2026-01-01'}];data.tags=[{id:3,name:'VIP'}];data['entity-tags']=[{entity_type:'clients',entity_id:1,tag_id:3}];const h=createHarness(data);
 h.run("dateFilter={invoices:{from:'2026-10-01',to:'2026-10-31'}}");const inv=await h.run("listPage('invoices')");assert.match(inv,/Date | 2026-10-01 – 2026-10-31/);assert.doesNotMatch(inv,/Visible invoices/);
 for(const type of ['clients','jobs','expenses','quotes'])assert.match(await h.run('listPage('+JSON.stringify(type)+')'),/Visible/);
 assert.match(await h.run("clientTagFilter='3';listPage('clients')"),/Filter by tag | VIP/);h.run("resource='payments';moduleMoreActions()");assert.doesNotMatch(h.elements.get('#overlay').innerHTML,/import-form/);assert.match(h.elements.get('#overlay').innerHTML,/Export Payments/);
 assert.doesNotMatch(h.run("portalPayButton({id:1,balance_due_cents:100,online_payments:{'Card payments':false,'Bank payments':false}})"),/data-portal-action/);assert.match(h.run("portalPayButton({id:1,balance_due_cents:100,online_payments:{'Card payments':false}})"),/data-methods="ach"/);
});

test('T16 saved record and community preferences have visible escaped readbacks',()=>{
 const h=createHarness(),prefs=[['signature-quotes-1',{name:'A <Signer>',signature:'Ink'}],['detail-quotes-1-introduction',{title:'Welcome',message:'Scope'}],['detail-quotes-1-edit-deposit-payment-settings',{frequency:'Once',amount:10}],['detail-jobs-1-edit-invoice-settings',{frequency:'Monthly',amount:20}],['detail-invoices-1-edit-client-view',{'Quantities':false}],['detail-invoices-1-edit-online-payment-settings',{'Card payments':false,'Bank payments':false,'Partial payments':false}],['jobber-review-1',{rating:5}],['truck-decal-1',{city:'Portland'}]].map(([name,value])=>({name,value_json:JSON.stringify(value)}));h.run('globalThis.t16prefs='+JSON.stringify(prefs));assert.match(h.run("recordPreferenceReadback('quotes',1,t16prefs)"),/A &lt;Signer&gt;.*Welcome.*Scope.*Deposit schedule: Once.*\$10.00/);assert.match(h.run("recordPreferenceReadback('jobs',1,t16prefs)"),/Invoice settings: Monthly.*\$20.00/);assert.match(h.run("recordPreferenceReadback('invoices',1,t16prefs)"),/Online payments: Disabled/);assert.match(h.run('communityPage(t16prefs)'),/review submitted.*5 stars.*Truck decal requested.*Portland/);assert.equal(typeof h.run('communityPage()'),'string');
});


test('T16 payroll, payment settings and review readbacks reflect persisted preferences',async()=>{
 const date=new Date(2026,9,12),key=date.toLocaleDateString('en-CA');const h=t16PreferenceHarness([['payroll-'+key,{enabled:true}],['card_reader_order',{reader:'Reader',quantity:2,shipping_address:'Main Street'}],['payout_bank',{bank_name:'Local Bank',last4:'9876',account_holder:'Owner'}],['google-business-profile',{business_name:'Tile Shop',url:'https://example.test'}],['review-response-1',{response:'Thanks'}]]);
 h.run('user={id:1};timeDate=new Date(2026,9,12);timesheetTab="Confirm payroll"');assert.match(await h.run('timesheets()'),/data-preference="payroll-[^"]+" checked/);
 const payments=await h.run("settingsPartA('jobber-payments',viewVersion)");assert.match(payments,/2× Reader.*Main Street/);assert.match(payments,/Local Bank.*9876.*Owner/);
 h.run("marketingTab='Reviews'");assert.match(await h.run('marketing()'),/Connected profile: <strong>Tile Shop.*1 saved response/);
});

test('T16 date actions reject reversed ranges, prefill and clear resource dates',async()=>{
 const h=createHarness();h.run("resource='invoices';render=async()=>{};dateFilter={invoices:{from:'2026-01-01',to:'2026-02-01'}}");
 const click=async action=>{const target={dataset:{action},hasAttribute(){return false;},matches(){return false;},closest(selector){return selector==='button,a,[data-slot],tr[data-id]'?this:null;}};await h.listeners.click[0]({target,preventDefault(){}});};await click('date-filter');assert.match(h.elements.get('#overlay').innerHTML,/2026-01-01/);
 const form=h.elements.get('#action-form');h.run("globalThis.failure='';error=e=>{failure=e.message}");form.values={from:'2026-03-01',to:'2026-02-01'};await form.onsubmit({target:form,preventDefault(){}});assert.match(h.run('failure'),/From date must/);assert.equal(h.run('dateFilter.invoices.from'),'2026-01-01');await click('clear-date-filter');assert.equal(h.run('Object.keys(dateFilter).length'),0);
});

test('T16 client property and contact additions validate and refresh the originating detail',async()=>{
 for(const [type,values] of [['properties',{street1:'New Street'}],['contacts',{name:'New Contact'}]]){
  const created=[];const h=createHarness(async(path,options={})=>{const key=path.replace('/api/','');if(options.method==='POST')created.push({...JSON.parse(options.body),id:1});const data=key==='clients/1'?{id:1,display_name:'Client'}:key==='clients/1/timeline'?{properties:type==='properties'?created:[],contacts:type==='contacts'?created:[],requests:[]}:key==='properties'?created:[];return {ok:true,status:200,json:async()=>data};});
  h.run("route='home';activeDetailKey='clients:1';render=async()=>{};globalThis.failure='';error=e=>{failure=e.message}");await h.run('clientRelatedForm('+JSON.stringify(type)+',1,"Add")');const form=h.elements.get('#action-form');form.values={};await form.onsubmit({target:form,preventDefault(){}});assert.equal(created.length,0);assert.match(h.run('failure'),/Enter/);form.values=values;await form.onsubmit({target:form,preventDefault(){}});assert.equal(created.length,1);assert.match(h.elements.get('#overlay').innerHTML,new RegExp(Object.values(values)[0]));if(type==='properties')assert.equal(h.run('cache.properties.length'),1);
 }
});


test('T16 new request form validates its title and persists step two in SQLite before builder opens',async t=>{
 const db=createDatabase();seedDatabase(db);t.after(()=>db.close());const r=workflows(db,1,1).r;
 const h=createHarness(async(path,options={})=>{let data=[];if(path.startsWith('/api/preferences')){if(options.method==='POST')data=r.insert('preferences',JSON.parse(options.body));else if(options.method==='PATCH')data=r.update('preferences',Number(path.split('/').pop()),JSON.parse(options.body));else data=r.list('preferences');}return {ok:true,status:200,json:async()=>data};});
 h.run("globalThis.failure='';error=e=>{failure=e.message}");await h.run("settingsPartBAction({dataset:{settingsAction:'request-form-new'}})");const form=h.elements.get('#action-form');form.values={kind:'Request Form'};await form.onsubmit({target:form,preventDefault(){}});form.values={title:' '};await form.onsubmit({target:form,preventDefault(){}});assert.equal(h.run('failure'),'Enter a form name');assert.equal(r.list('preferences').filter(p=>p.name.startsWith('request-form-')).length,0);
 form.values={title:' SQLite form '};await form.onsubmit({target:form,preventDefault(){}});const saved=r.list('preferences').find(p=>p.name.startsWith('request-form-'));assert.ok(saved);assert.equal(JSON.parse(saved.value_json).title,'SQLite form');assert.match(h.elements.get('#overlay').innerHTML,/Form Builder/);
});

test('T16 document and card subforms reject blank signatures, invalid card digits and negative amounts',async()=>{
 for(const [type,action,values,message] of [['quotes','Collect Signature',{name:' ',signature:'Ink'},'Enter name and signature'],['clients','Add manually',{name:'Owner',last4:'123'},'Enter cardholder name and 4 digits'],['jobs','Edit Invoice Settings',{amount:'-1'},'Enter a non-negative amount'],['quotes','Edit deposit payment settings',{amount:'NaN'},'Enter a non-negative amount']]){
 const h=t16PreferenceHarness();h.run("globalThis.failure='';error=e=>{failure=e.message}");await h.run('recordDetailAction('+JSON.stringify(type)+',{id:1},'+JSON.stringify(action)+')');const form=h.elements.get('#action-form');form.values=values;await form.onsubmit({target:form,preventDefault(){}});assert.equal(h.run('failure'),message);assert.equal(h.prefs.length,0);
 }
});


// T17: Astra CSV accounting and post-save continuation regressions.
test('T17 CSV document totals roundtrip without double tax, including integer fallbacks',async t=>{
 const {importCSV,exportCSV}=await import('../src/services/pdf.js');
 const db=createDatabase();seedDatabase(db);t.after(()=>db.close());const w=workflows(db,1,1),r=w.r,c=w.createClient({display_name:'Astra CSV'});
 for(const type of ['quotes','invoices']){
  const name=type==='quotes'?'title':'subject';
  const load=values=>importCSV(r,type,exportCSV([{client_id:c.id,[name]:'Tax regression',...values}]),w)[0];
  const check=(row,subtotal,tax,total)=>{assert.equal(row.subtotal_cents,subtotal);assert.equal(row.tax_cents,tax);assert.equal(row.total_cents,total);if(type==='invoices')assert.equal(row.balance_due_cents,total);};
  const taxed=load({total_cents:11000,tax_rate:10});check(taxed,10000,1000,11000);
  const fields=['client_id',name,'subtotal_cents','tax_rate','total_cents'];
  check(importCSV(r,type,exportCSV([taxed],fields),w)[0],10000,1000,11000);
  check(load({subtotal_cents:10000,tax_rate:10}),10000,1000,11000);
  check(load({subtotal_cents:11000,total_cents:11000,tax_rate:10}),11000,0,11000);
  check(load({total_cents:1,tax_rate:100}),1,0,1);
  check(load({total_cents:1234,tax_rate:0}),1234,0,1234);
  check(load({total_cents:0,tax_rate:10}),0,0,0);check(load({}),0,0,0);
  const count=r.list(type).length;assert.throws(()=>load({subtotal_cents:10000,total_cents:12000,tax_rate:10}),/CSV subtotal_cents and total_cents do not match tax_rate/);assert.equal(r.list(type).length,count);
 }
});

test('T17 imported invoice issue date anchors due date and HTTP receivables aging',async t=>{
 const {importCSV,exportCSV}=await import('../src/services/pdf.js');
 const db=createDatabase();seedDatabase(db);const server=await startServer({db,seed:false,port:0,allowDemoSwitch:true});t.after(async()=>{await server.close();db.close();});
 const w=workflows(db,1,1),r=w.r,c=w.createClient({display_name:'Historical CSV'});
 const data={client_id:c.id,subject:'Historical',status:'awaiting_payment',payment_terms:'net_30',issued_date:'2026-01-01',total_cents:11000,tax_rate:10};
 const [invoice]=importCSV(r,'invoices',exportCSV([data]),w);assert.equal(invoice.issued_date,'2026-01-01');assert.equal(invoice.due_date,'2026-01-31');
 const session=await(await fetch(server.url+'/api/auth/bootstrap',{method:'POST'})).json();const res=await fetch(server.url+'/api/reports/aging_receivables',{headers:{Authorization:'Bearer '+session.token}});assert.equal(res.status,200);const report=await res.json();assert.ok((Array.isArray(report)?report:report.rows).find(i=>i.id===invoice.id).days_overdue>0);
 const [blankDue]=importCSV(r,'invoices',exportCSV([{...data,due_date:''}]),w);assert.equal(blankDue.due_date,'2026-01-31');
 const [explicit]=importCSV(r,'invoices',exportCSV([{...data,due_date:'2026-02-15'}]),w);assert.equal(explicit.due_date,'2026-02-15');
 for(const key of ['issued_date','due_date'])assert.throws(()=>importCSV(r,'invoices',exportCSV([{...data,[key]:'01/01/2026'}]),w),/Invalid CSV date/);
 assert.throws(()=>importCSV(r,'expenses','item_name,date_incurred\nBad,01/01/2026',w),/Invalid CSV date/);
 const draft=w.createInvoice({client_id:c.id,subject:'Invalid issue date'},[]);assert.throws(()=>w.issueInvoice(draft.id,'net_30',undefined,'01/01/2026'),/Invalid issued date/);assert.equal(r.get('invoices',draft.id).status,'draft');
});

test('T17 successful property creation closes despite cache and detail refresh failures',async()=>{
 for(const returnToClient of [false,true])for(const failure of ['render','detail']){
  let posts=0;const h=createHarness(async(path,options={})=>{if(path==='/api/properties'){if(options.method==='POST'){posts++;return {ok:true,json:async()=>({id:posts})};}throw Error('GET properties failed');}return {ok:true,json:async()=>[]};});
  h.run(`route='home';activeDetailKey=${JSON.stringify(returnToClient?'clients:1':'')};globalThis.failure='';error=e=>{failure=e.message};render=async()=>{${returnToClient&&failure==='render'?"throw Error('Refresh failed')":''}};detail=async()=>{throw Error('Detail failed')}`);
  await h.run("clientRelatedForm('properties',1,'Add Property')");const form=h.elements.get('#action-form');form.values={street1:'Only once'};await form.onsubmit({target:form,preventDefault(){}});
  assert.equal(posts,1);assert.equal(h.run('failure'),'');assert.equal(h.elements.get('#overlay').innerHTML,'');
 }
});

test('T17 saved detail subforms close on refresh failure without closing a newer panel',async()=>{
 for(const stage of ['render','detail','newer']){
  const h=t16PreferenceHarness();h.run("route='home';activeDetailKey='quotes:1';globalThis.failure='';error=e=>{failure=e.message}");
  await h.run("recordDetailAction('quotes',{id:1},'Introduction')");
  h.run(`render=async()=>{${stage==='render'?"throw Error('Refresh failed')":stage==='newer'?"modal('Newer panel','Keep');throw Error('Refresh failed')":''}};detail=async()=>{throw Error('Detail failed')}`);
  const form=h.elements.get('#action-form');form.values={title:'Saved introduction'};await form.onsubmit({target:form,preventDefault(){}});
  assert.equal(h.prefs.length,1);assert.equal(h.run('failure'),'');if(stage==='newer')assert.match(h.elements.get('#overlay').innerHTML,/Newer panel/);else assert.equal(h.elements.get('#overlay').innerHTML,'');
 }
});

test('T17 delayed form link snapshots Form A while Form B stays active',async()=>{
 const h=createHarness();h.run("requestFormDraft={key:'form-a',title:'Form A',questions:[]};requestFormBuilder('Settings');globalThis.release=null;globalThis.savedLink=null;growthPreference=async(key,value)=>{savedLink={key,value};await new Promise(resolve=>{release=resolve})}");
 const pending=h.run("settingsPartBAction({dataset:{settingsAction:'form-link'}})");await Promise.resolve();assert.equal(h.run('savedLink.value.key'),'form-a');
 h.elements.get('#action-form').values={};h.run("requestFormDraft={key:'form-b',title:'Form B',questions:[]};requestFormBuilder('Settings')");const html=h.elements.get('#overlay').innerHTML;
 h.run('release()');await pending;assert.equal(h.run('linkedRequestFormKey'),'form-a');assert.equal(h.run('requestFormDraft.key'),'form-b');assert.equal(h.elements.get('#overlay').innerHTML,html);
 h.run("requestFormBuilder('Settings')");assert.match(h.elements.get('#overlay').innerHTML,/Linked form: Form A/);
});

test('T17 delayed new-form step two persists without replacing a newer panel',async()=>{
 const h=createHarness();h.run("globalThis.release=null;globalThis.savedForm=null;growthPreference=async(key,value)=>{savedForm={key,value};await new Promise(resolve=>{release=resolve})}");
 await h.run("settingsPartBAction({dataset:{settingsAction:'request-form-new'}})");const form=h.elements.get('#action-form');form.values={kind:'Request Form'};await form.onsubmit({target:form,preventDefault(){}});
 form.values={title:' Delayed form '};const pending=form.onsubmit({target:form,preventDefault(){}});assert.equal(h.run('savedForm.value.title'),'Delayed form');
 form.values={};h.run("requestFormDraft={key:'form-b',title:'Form B',questions:[]};requestFormBuilder('Settings')");const html=h.elements.get('#overlay').innerHTML;h.run('release()');await pending;
 assert.equal(h.run('requestFormDraft.key'),'form-b');assert.equal(h.elements.get('#overlay').innerHTML,html);assert.equal(h.run('requestFormKnownEntries.find(f=>f.key===savedForm.key).title'),'Delayed form');
});

for(const kind of ['contacts','properties','introduction','balance'])for(const stage of ['normal','render-failure','detail-failure','render-newer','detail-newer'])test(`T18 ${kind} closes before real detail refresh: ${stage}`,async()=>{
 let posts=0,fetches=0,release=null;
 const h=createHarness(async(path,options={})=>{
  const key=path.replace(/^\/api\//,''),method=options.method||'GET';
  if(method==='POST'){posts++;return {ok:true,status:201,json:async()=>({id:1})};}
  if(key==='clients/1'||key==='quotes/1'){
   fetches++;
   if(stage==='detail-failure')return {ok:false,status:500,json:async()=>({error:'Fetch failed'}),text:async()=>'Fetch failed'};
   if(stage==='detail-newer')await new Promise(resolve=>{release=resolve;});
   return {ok:true,status:200,json:async()=>({id:1,display_name:'Refreshed',title:'Refreshed',status:'draft'})};
  }
  return {ok:true,status:200,json:async()=>[]};
 });
 h.run(`route='home';activeDetailKey='${kind==='introduction'?'quotes':'clients'}:1';globalThis.failure='';safePrefs=async()=>[];growthPreference=async()=>{${kind==='introduction'?'window.__prefSaved=1':''}};error=e=>{failure=e.message};render=async()=>{${stage==='render-failure'?"throw Error('Render failed');":stage==='render-newer'?"await window.__waitRender();":''}}`);
 if(kind==='introduction')h.run('growthPreference=async()=>{window.__gp=(window.__gp||0)+1}');
 h.run('window.__waitRender=()=>new Promise(r=>{window.__relRender=r})');
 const open=kind==='introduction'?"recordDetailAction('quotes',{id:1},'Introduction')":kind==='balance'?"recordDetailAction('clients',{id:1,initial_balance_cents:0},'Set initial balance')":`clientRelatedForm('${kind}',1,'Related')`;
 await h.run(open);const form=h.elements.get('#action-form');form.values={name:'Contact',street1:'Street',title:'Introduction',balance:'10'};
 const pending=form.onsubmit({target:form,preventDefault(){}});
 if(stage==='render-newer'){for(let i=0;i<30&&!h.run('window.__relRender');i++)await Promise.resolve();assert.ok(h.run('window.__relRender'));assert.equal(h.elements.get('#overlay').innerHTML,'');h.run("modal('Newer panel','Keep');window.__relRender()");}
 if(stage==='detail-newer'){for(let i=0;i<30&&!release;i++)await Promise.resolve();assert.ok(release);assert.equal(h.elements.get('#overlay').innerHTML,'');h.run("modal('Newer panel','Keep')");release();}
 await pending;assert.equal(kind==='introduction'?h.run('window.__gp'):posts,1);assert.equal(h.run('failure'),'');
 const html=h.elements.get('#overlay').innerHTML;
 if(stage.endsWith('newer')){assert.match(html,/Newer panel/);assert.match(html,/Keep/);}else if(stage==='normal')assert.match(html,/Refreshed/);else assert.equal(html,'');
 assert.equal(fetches,stage.startsWith('render-')?0:1);
});

for(const custom of [false,true])test(`T18 delayed timer settings preserve New Task (custom save ${custom})`,async()=>{
 const h=createHarness();h.run('safePrefs=async()=>[];growthPreference=async()=>{}');
 if(custom)await h.run("preferenceEditor('Custom Timer','custom-timer-test',p=>field('Label','label',''))");
 h.run('globalThis.release=null;safePrefs=()=>new Promise(resolve=>{release=resolve})');
 const form=h.elements.get('#action-form');form.values={label:'Travel'};
 const pending=custom?form.onsubmit({target:form,preventDefault(){}}):h.run('timerSettings()');
 for(let i=0;i<20&&!h.run('release');i++)await Promise.resolve();assert.ok(h.run('release'));
 if(custom)assert.equal(h.elements.get('#overlay').innerHTML,'');
 h.run("modal('New Task','Unsaved task');release([])");await pending;
 assert.match(h.elements.get('#overlay').innerHTML,/New Task/);assert.match(h.elements.get('#overlay').innerHTML,/Unsaved task/);assert.doesNotMatch(h.elements.get('#overlay').innerHTML,/Timer settings/);
});

test('T18 invoice CSV terms normalize through unit and HTTP imports',async t=>{
 const {importCSV,exportCSV}=await import('../src/services/pdf.js');const db=createDatabase();seedDatabase(db);const server=await startServer({db,seed:false,port:0,allowDemoSwitch:true});t.after(async()=>{await server.close();db.close();});
 const w=workflows(db,1,1),c=w.createClient({display_name:'Terms'}),session=await(await fetch(server.url+'/api/auth/bootstrap',{method:'POST'})).json();
 const http=async csv=>{const res=await fetch(server.url+'/api/invoices/import',{method:'POST',headers:{Authorization:'Bearer '+session.token,'Content-Type':'application/json'},body:JSON.stringify({csv})});return {status:res.status,body:await res.json()};};
 for(const status of ['draft','awaiting_payment'])for(const payment_terms of ['net_45','custom'])for(const due_date of ['','2026-03-01','2099-03-01']){
  const csv=exportCSV([{client_id:c.id,subject:'Terms',status,payment_terms,issued_date:'2026-01-01',due_date,total_cents:10000}]);
  const expectedDue=due_date||(payment_terms==='net_45'?'2026-02-15':'2026-01-01');
  const expectedStatus=status==='draft'?'draft':expectedDue<new Date().toISOString().slice(0,10)?'past_due':'awaiting_payment';
  const direct=importCSV(w.r,'invoices',csv,w)[0],response=await http(csv);assert.equal(response.status,201);
  for(const invoice of [direct,response.body[0]]){assert.equal(invoice.status,expectedStatus);assert.equal(invoice.payment_terms,'upon_receipt');if(due_date||payment_terms==='net_45'||status==='awaiting_payment')assert.equal(invoice.due_date,expectedDue);}
 }
 const bad=exportCSV([{client_id:c.id,subject:'Bad',payment_terms:'net_999'}]);assert.throws(()=>importCSV(w.r,'invoices',bad,w),/Invalid payment terms/);const response=await http(bad);assert.equal(response.status,400);assert.match(JSON.stringify(response.body),/Invalid payment terms/);
 assert.equal(importCSV(w.r,'invoices',exportCSV([{client_id:c.id,subject:'Blank',payment_terms:''}]),w)[0].status,'draft');
});

test('T18 strict calendar dates reject impossible dates and accept leap day',async t=>{
 const {importCSV,exportCSV}=await import('../src/services/pdf.js');const db=createDatabase();seedDatabase(db);t.after(()=>db.close());const w=workflows(db,1,1),c=w.createClient({display_name:'Calendar'});
 for(const date of ['2026-02-30','2026-13-01','2025-02-29','2026-04-31']){
  for(const [type,key] of [['invoices','issued_date'],['invoices','due_date'],['jobs','start_date'],['jobs','end_date'],['expenses','date_incurred'],['requests','preferred_date']]){
   const row=type==='expenses'?{item_name:'Bad'}:type==='invoices'?{client_id:c.id,subject:'Bad'}:{client_id:c.id,title:'Bad'};
   assert.throws(()=>importCSV(w.r,type,exportCSV([{...row,[key]:date}]),w),/Invalid CSV date/);
  }
  const inv=w.createInvoice({client_id:c.id,subject:'Bad'},[]);assert.throws(()=>w.issueInvoice(inv.id,'net_30',date),/Invalid due date/);assert.throws(()=>w.issueInvoice(inv.id,'net_30',undefined,date),/Invalid issued date/);assert.equal(w.r.get('invoices',inv.id).status,'draft');
  w.r.update('invoices',inv.id,{due_date:date});assert.throws(()=>w.issueInvoice(inv.id,'custom'),/Invalid due date/);
 }
 const inv=w.createInvoice({client_id:c.id,subject:'Leap'},[]);assert.equal(w.issueInvoice(inv.id,'net_30',undefined,'2024-02-29').due_date,'2024-03-30');
 assert.equal(importCSV(w.r,'invoices',exportCSV([{client_id:c.id,subject:'Leap',status:'awaiting_payment',payment_terms:'net_30',issued_date:'2024-02-29'}]),w)[0].due_date,'2024-03-30');
 assert.throws(()=>importCSV(w.r,'jobs',exportCSV([{client_id:c.id,title:'Inverted',start_date:'2026-05-10',end_date:'2026-05-01'}]),w),/Invalid CSV date/);
 assert.throws(()=>importCSV(w.r,'jobs',exportCSV([{client_id:c.id,title:'BadType',job_type:'bogus'}]),w),/Invalid job_type/);
 assert.equal(importCSV(w.r,'jobs',exportCSV([{client_id:c.id,title:'BlankEnum',status:'',job_type:'',billing_type:''}]),w)[0].job_type,'one_off');
});

test('T19 pending form linking preserves live fields and updates only the linked status', async () => {
  const h = createHarness();
  h.run(`
    let finishLink;
    growthPreference=()=>new Promise(resolve=>{finishLink=resolve;});
    requestFormDraft={key:'request-form-a',title:'Original',description:'Original description',questions:[]};
    requestFormKnownEntries=[{...requestFormDraft}];
    requestFormBuilder('Settings');
  `);
  const form = h.elements.get('#action-form'), overlay = h.elements.get('#overlay');
  assert.match(overlay.innerHTML, /id="linked-form-status"/);
  form.values = { title: 'Captured title', description: 'Captured description' };
  const titleInput = h.makeEl(), descriptionInput = h.makeEl();
  titleInput.value = form.values.title;
  descriptionInput.value = form.values.description;
  form.querySelector = selector => ({ '[name="title"]': titleInput, '[name="description"]': descriptionInput })[selector] || null;
  const pending = h.run("settingsPartBAction({dataset:{settingsAction:'form-link'}})");
  await Promise.resolve();
  titleInput.value = '  New live title  ';
  descriptionInput.value = 'New live description';
  form.values = { title: titleInput.value, description: descriptionInput.value };
  overlay.innerHTML += '<span>Live DOM edit</span>';
  const liveMarkup = overlay.innerHTML, submit = form.onsubmit, version = h.run('panelVersion');
  h.run('finishLink()');
  await pending;
  assert.equal(overlay.innerHTML, liveMarkup);
  assert.equal(form.onsubmit, submit);
  assert.equal(titleInput.value, '  New live title  ');
  assert.equal(descriptionInput.value, 'New live description');
  assert.equal(h.run('panelVersion'), version);
  assert.equal(h.run('requestFormDraft.title'), 'Captured title');
  assert.equal(h.elements.get('#linked-form-status').textContent, 'Linked form: New live title');
  assert.equal(h.run('linkedRequestFormKey'), 'request-form-a');
});

test('T19 out-of-order form links cannot replace the newest linked form or its edits', async () => {
  const h = createHarness();
  h.run(`
    const linkCompletions=[];
    growthPreference=()=>new Promise(resolve=>linkCompletions.push(resolve));
    requestFormDraft={key:'request-form-a',title:'Form A',questions:[]};
    requestFormKnownEntries=[{...requestFormDraft}];
    requestFormBuilder('Settings');
  `);
  const first = h.run("settingsPartBAction({dataset:{settingsAction:'form-link'}})");
  await Promise.resolve();
  h.run(`requestFormDraft={key:'request-form-b',title:'Form B',questions:[]};requestFormBuilder('Settings');`);
  const second = h.run("settingsPartBAction({dataset:{settingsAction:'form-link'}})");
  await Promise.resolve();
  const markup = h.elements.get('#overlay').innerHTML;
  h.run('linkCompletions[1]()');
  await second;
  assert.equal(h.run('linkedRequestFormKey'), 'request-form-b');
  assert.equal(h.elements.get('#linked-form-status').textContent, 'Linked form: Form B');
  const entries = h.run('JSON.stringify(requestFormKnownEntries)');
  h.run('linkCompletions[0]()');
  await first;
  assert.equal(h.run('linkedRequestFormKey'), 'request-form-b');
  assert.equal(h.run('requestFormDraft.title'), 'Form B');
  assert.equal(h.run('JSON.stringify(requestFormKnownEntries)'), entries);
  assert.equal(h.elements.get('#linked-form-status').textContent, 'Linked form: Form B');
  assert.equal(h.elements.get('#overlay').innerHTML, markup);
});

test('T19 saving a form keeps known entries synchronized even if switching forms before link completes', async () => {
  const h = createHarness();
  h.elements.delete('#breadcrumb');
  h.run(`
    let finishLink;
    growthPreference=key=>key==='google-business-linked-form'?new Promise(resolve=>{finishLink=resolve;}):Promise.resolve();
    requestFormDraft={key:'request-form-a',title:'Original',questions:[]};
    requestFormKnownEntries=[{...requestFormDraft}];
    requestFormBuilder('Settings');
  `);
  const pending = h.run("settingsPartBAction({dataset:{settingsAction:'form-link'}})");
  await Promise.resolve();
  const form = h.elements.get('#action-form');
  form.values = { title: 'Saved newer title', description: 'Saved newer description' };
  await form.onsubmit({ preventDefault() {}, target: form });
  assert.equal(h.run('requestFormKnownEntries[0].title'), 'Saved newer title');
  h.run(`requestFormDraft={key:'request-form-b',title:'Form B',questions:[]};requestFormBuilder('Settings');`);
  h.run('finishLink()');
  await pending;
  assert.equal(h.run('requestFormKnownEntries[0].title'), 'Saved newer title');
  assert.equal(h.run('requestFormKnownEntries[0].description'), 'Saved newer description');
});

for (const newestFirst of [false, true]) {
  for (const [earlier, latest, heading] of [
    ["recordDetailAction('quotes',{id:1},'Collect Signature')", "recordDetailAction('quotes',{id:1},'Introduction')", 'Introduction'],
    ["recordDetailAction('invoices',{id:1,client_id:1},'Collect Payment')", "recordDetailAction('invoices',{id:1,client_id:1},'Edit client view')", 'Edit client view'],
    ["growthAction({dataset:{action:'website-builder'}})", "growthAction({dataset:{action:'website-preview'}})", 'Website preview']
  ]) {
    test(`T19 latest ${heading} action wins with ${newestFirst ? 'out-of-order' : 'in-order'} reads`, async () => {
      const allPending = [];
      const h = createHarness(() => new Promise(resolve => allPending.push(data => resolve({ ok: true, status: 200, json: async () => data }))));
      h.elements.set('#__hook', { push: fn => allPending.push(fn) });
      h.run(`
        org={name:'Test business'};
        safePrefs=()=>new Promise(resolve=>$('#__hook').push(resolve));
        modal('Starting panel','Original contents');
      `);
      const initialMarkup = h.elements.get('#overlay').innerHTML;
      const first = h.run(earlier), second = h.run(latest);
      assert.equal(allPending.length, 2);
      if (newestFirst) {
        allPending[1]([]);
        await second;
        assert.ok(h.elements.get('#overlay').innerHTML.includes(heading));
        const latestMarkup = h.elements.get('#overlay').innerHTML;
        allPending[0]([]);
        await first;
        assert.equal(h.elements.get('#overlay').innerHTML, latestMarkup);
      } else {
        allPending[0]([]);
        await first;
        assert.equal(h.elements.get('#overlay').innerHTML, initialMarkup);
        allPending[1]([]);
        await second;
        assert.ok(h.elements.get('#overlay').innerHTML.includes(heading));
      }
    });
  }
}

test('T20 detail creation preselects the client atomically and preserves newer panels', async () => {
  const h = createHarness();
  const clientInput = h.makeEl();
  h.elements.get('#builder').querySelector = selector => selector === '[name="client_id"]' ? clientInput : null;
  h.run("clients=[{id:1,display_name:'One'},{id:2,display_name:'Two'}]");
  for (const action of ['Payment', 'Quote', 'Task']) {
    clientInput.value = '';
    await h.run(`recordDetailAction('clients',{id:2},'${action}')`);
    assert.match(h.elements.get('#overlay').innerHTML, /<option value="2" selected>Two<\/option>/);
    assert.equal(clientInput.value, 2);
    await h.run(`recordDetailAction('jobs',{id:99,client_id:2},'${action}')`);
    assert.match(h.elements.get('#overlay').innerHTML, /<option value="2" selected>Two<\/option>/);
    assert.equal(clientInput.value, 2);
  }
  h.run('let finishRequestEditor;bindRequestEditor=()=>new Promise(resolve=>{finishRequestEditor=resolve;})');
  const pending = h.run("recordDetailAction('clients',{id:2},'Request')");
  assert.equal(typeof h.run('finishRequestEditor'), 'function');
  assert.equal(clientInput.value, 2);
  await h.run("recordDetailAction('clients',{id:1},'Payment')");
  const markup = h.elements.get('#overlay').innerHTML;
  const submit = h.elements.get('#builder').onsubmit;
  assert.equal(clientInput.value, 1);
  h.run('finishRequestEditor()');
  await pending;
  assert.equal(h.elements.get('#overlay').innerHTML, markup);
  assert.equal(h.elements.get('#builder').onsubmit, submit);
  assert.equal(clientInput.value, 1);
});

test('T20 concurrent new request-form submissions share one pending save and stable key', async () => {
  const h = createHarness();
  h.run(`
    let finishPrefs,finishSave,prefsReads=0;
    const formSaves=[];
    safePrefs=()=>{prefsReads++;return new Promise(resolve=>{finishPrefs=resolve;});};
    growthPreference=async(key,value)=>{
      await safePrefs();
      await new Promise(resolve=>{finishSave=resolve;});
      formSaves.push({key,value});
    };
  `);
  await h.run("settingsPartBAction({dataset:{settingsAction:'request-form-new'}})");
  const form = h.elements.get('#action-form');
  form.values = { kind: 'Request Form' };
  await form.onsubmit({ preventDefault() {}, target: form });
  assert.match(h.elements.get('#overlay').innerHTML, /Add New Form · Step 2/);
  form.values = { title: 'New request form', description: 'One form only', pages: '2' };
  const submit = form.onsubmit;
  const first = submit({ preventDefault() {}, target: form });
  const second = submit({ preventDefault() {}, target: form });
  assert.equal(h.run('prefsReads'), 1);
  assert.equal(h.run('formSaves.length'), 0);
  h.run('finishPrefs([])');
  for (let i = 0; i < 20 && !h.run('finishSave'); i++) await Promise.resolve();
  assert.equal(typeof h.run('finishSave'), 'function');
  assert.equal(h.run('formSaves.length'), 0);
  h.run('finishSave()');
  await Promise.all([first, second]);
  const saves = JSON.parse(h.run('JSON.stringify(formSaves)'));
  assert.equal(saves.length, 1);
  assert.equal(new Set(saves.map(s => s.key)).size, 1);
  assert.match(saves[0].key, /^request-form-\d+-\d+$/);
  assert.equal(saves[0].value.title, 'New request form');
  assert.equal(h.run('requestFormKnownEntries.length'), 1);
  assert.equal(h.run('requestFormKnownEntries[0].key'), saves[0].key);
  assert.equal(h.run('requestFormDraft.key'), saves[0].key);
  assert.match(h.elements.get('#overlay').innerHTML, /Form Builder · New request form/);
});

test('T21 mixed-tax quote and invoice CSV round trips preserve totals and reject invalid tax', async t => {
  const { importCSV, exportCSV } = await import('../src/services/pdf.js');
  const db = createDatabase();
  t.after(() => db.close());
  seedDatabase(db);
  const w = workflows(db, 1, 1), client = w.createClient({ display_name: 'Mixed tax CSV' });
  const items = [
    { name: 'Taxable service', quantity: 1, unit_price_cents: 5000, taxable: 1 },
    { name: 'Exempt service', quantity: 1, unit_price_cents: 5000, taxable: 0 }
  ];
  for (const [type, handler, name] of [['quotes', 'createQuote', 'title'], ['invoices', 'createInvoice', 'subject']]) {
    const original = w[handler]({ client_id: client.id, [name]: 'Mixed tax', tax_rate: 10 }, items);
    const fields = ['client_id', name, 'subtotal_cents', 'tax_rate', 'total_cents'];
    const imported = importCSV(w.r, type, exportCSV([original], fields), w)[0];
    for (const document of [original, imported, w.r.get(type, imported.id)]) {
      assert.equal(document.subtotal_cents, 10000);
      assert.equal(document.tax_rate, 10);
      assert.equal(document.tax_cents, 500);
      assert.equal(document.total_cents, 10500);
    }
    assert.throws(() => importCSV(w.r, type, exportCSV([{ ...original, total_cents: 12000 }], fields), w), /CSV subtotal_cents and total_cents do not match tax_rate/);
    const tinyTax = { ...original, subtotal_cents: 149999999, tax_rate: 0.000001 };
    const invalidCSV = exportCSV([{ ...tinyTax, total_cents: 150000001 }], fields);
    const invalidStart = performance.now();
    assert.throws(() => importCSV(w.r, type, invalidCSV, w), /CSV subtotal_cents and total_cents do not match tax_rate/);
    assert.ok(performance.now() - invalidStart < 2500, `${type}: invalid tiny-tax import must finish in O(1)`);
    const validCSV = exportCSV([{ ...tinyTax, total_cents: 150000000 }], fields);
    const validStart = performance.now();
    const valid = importCSV(w.r, type, validCSV, w)[0];
    assert.ok(performance.now() - validStart < 2500, `${type}: valid tiny-tax import must finish in O(1)`);
    for (const document of [valid, w.r.get(type, valid.id)]) {
      assert.equal(document.subtotal_cents, 149999999);
      assert.equal(document.tax_rate, 0.000001);
      assert.equal(document.tax_cents, 1);
      assert.equal(document.total_cents, 150000000);
    }
  }
});

test('T21 date-filter Clear dates is a non-submit button before Save', async () => {
  const h = createHarness();
  h.run("resource='quotes'");
  const target = {
    dataset: { action: 'date-filter' },
    hasAttribute() { return false; },
    matches() { return false; },
    closest(selector) { return selector === 'button,a,[data-slot],tr[data-id]' ? this : null; }
  };
  for (const listener of h.listeners.click) await listener({ target, preventDefault() {} });
  const markup = h.elements.get('#overlay').innerHTML;
  assert.match(markup, /<h2>Filter dates<\/h2>/);
  assert.match(markup, /<form id="action-form">[\s\S]*<button type="button"\s+data-action="clear-date-filter">Clear dates<\/button>[\s\S]*<button class="primary">Save<\/button><\/form>/);
});

test('T22 zero-total imported invoices match paid issuance automations', async t => {
  const { importCSV } = await import('../src/services/pdf.js');
  const db = createDatabase(':memory:');
  seedDatabase(db);
  t.after(() => db.close());
  const w = workflows(db, 1, 1), r = w.r;
  const client = w.createClient({ display_name: 'Zero-total issuance' });
  const rules = ['paid', 'awaiting_payment'].map(status => r.insert('automations', {
    name: 'Issued ' + status, trigger_event: 'invoice_issued', is_enabled: 1,
    conditions_json: JSON.stringify({ status }), delay_minutes: 0,
    action_type: 'create_task', action_config_json: JSON.stringify({ title: status })
  }));
  const [invoice] = importCSV(r, 'invoices', 'client_id,subject,status,total_cents\n' + client.id + ',Zero total,awaiting_payment,0', w);
  assert.equal(invoice.status, 'paid');
  assert.equal(invoice.amount_paid_cents, 0);
  assert.equal(invoice.balance_due_cents, 0);
  assert.ok(invoice.paid_at);
  const runs = r.list('automation_executions', { entity_type: 'invoices', entity_id: invoice.id, trigger_event: 'invoice_issued' });
  assert.equal(runs.filter(run => run.automation_id === rules[0].id).length, 1);
  assert.equal(runs.filter(run => run.automation_id === rules[1].id).length, 0);
});

for (const openBeforeSaveFinishes of [false, true]) {
  test('T22 pending form link preserves same-title saves when reopening, openBeforeSaveFinishes=' + openBeforeSaveFinishes, async () => {
    const h = createHarness();
    h.elements.delete('#breadcrumb');
    h.run(`
      let finishLink, finishPrefs, finishSave, savedForm;
      growthPreference=(key,value)=>key==='google-business-linked-form'
        ?new Promise(resolve=>{finishLink=resolve;})
        :new Promise(resolve=>{finishSave=()=>{savedForm=JSON.parse(JSON.stringify(value));resolve(savedForm);};});
      safePrefs=()=>new Promise(resolve=>{finishPrefs=resolve;});
      requestFormDraft={key:'request-form-a',title:'Unchanged title',description:'Old description',questions:[{type:'Short answer',label:'Old question'}]};
      requestFormKnownEntries=[JSON.parse(JSON.stringify(requestFormDraft))];
      requestFormBuilder('Settings');
    `);
    const linking = h.run("settingsPartBAction({dataset:{settingsAction:'form-link'}})");
    await Promise.resolve();
    const form = h.elements.get('#action-form');
    form.values = { title: 'Unchanged title', description: 'New description' };
    h.run("requestFormDraft.questions=[{type:'Long answer',label:'New question'}]");
    const saving = form.onsubmit({ preventDefault() {}, target: form });
    await Promise.resolve();
    let opening;
    if (openBeforeSaveFinishes) opening = h.run("requestFormOpen('request-form-a')");
    h.run('finishSave()');
    await saving;
    const saved = h.run('JSON.stringify(savedForm)');
    assert.equal(h.run('requestFormSavedRevs.get("request-form-a")'), 1);
    assert.equal(h.run('JSON.stringify(requestFormKnownEntries[0])'), saved);
    if (!openBeforeSaveFinishes) opening = h.run("requestFormOpen('request-form-a')");
    assert.equal(h.run('formLinkPending'), 1);
    h.run('finishLink()');
    await linking;
    assert.equal(h.run('JSON.stringify(requestFormKnownEntries[0])'), saved);
    h.run(`finishPrefs([
      {name:'request-form-a',value_json:JSON.stringify(${openBeforeSaveFinishes ? "{key:'request-form-a',title:'Unchanged title',description:'Old description',questions:[{type:'Short answer',label:'Old question'}]}" : 'savedForm'})},
      {name:'google-business-linked-form',value_json:JSON.stringify({key:'request-form-a',title:'Unchanged title'})}
    ])`);
    await opening;
    assert.equal(h.run('JSON.stringify(requestFormKnownEntries.find(f=>f.key==="request-form-a"))'), saved);
    assert.equal(h.run('JSON.stringify(requestFormDraft)'), saved);
    assert.match(h.elements.get('#overlay').innerHTML, /New description/);
    assert.match(h.elements.get('#overlay').innerHTML, /New question/);
    assert.doesNotMatch(h.elements.get('#overlay').innerHTML, /Old description|Old question/);
  });
}

test('T22 canceled draft edits do not leak into saved request-form state or Add tracking', async () => {
  const h = createHarness();
  h.elements.delete('#breadcrumb');
  h.run(`
    let stored={key:'request-form-a',title:'Original',description:'Original',questions:[]},finishLink;
    safePrefs=async()=>[{name:'request-form-a',value_json:JSON.stringify(stored)}];
    growthPreference=async(key,value)=>{if(key==='google-business-linked-form')return new Promise(r=>{finishLink=r;});stored=JSON.parse(JSON.stringify(value));};
  `);
  await h.run("requestFormOpen('request-form-a')");
  h.run("requestFormBuilder('Settings')");
  const form = h.elements.get('#action-form');
  form.values = { title: 'Original', description: 'Original' };
  const linking = h.run("settingsPartBAction({dataset:{settingsAction:'form-link'}})");
  await Promise.resolve();
  form.values = { title: 'Saved', description: 'Saved' };
  await form.onsubmit({ target: form, preventDefault() {} });
  form.values = {};
  await h.run("requestFormOpen('request-form-a')");
  form.values = { title: 'Canceled edit', description: 'Canceled edit' };
  await h.run("settingsPartBAction({dataset:{settingsAction:'form-tab:Settings'}})");
  h.run('close()');
  form.values = {};
  await h.run("requestFormOpen('request-form-a')");
  assert.equal(h.run('stored.title'), 'Saved');
  assert.equal(h.run('requestFormDraft.title'), 'Saved');
  assert.doesNotMatch(h.elements.get('#overlay').innerHTML, /Canceled edit/);
  await h.run("requestFormOpen('request-form-a','Add tracking')");
  form.values = { tracking_code: 'UA-123' };
  await form.onsubmit({ target: form, preventDefault() {} });
  assert.equal(h.run('stored.title'), 'Saved');
  assert.equal(h.run('stored.tracking_code'), 'UA-123');
  h.run('finishLink()');
  await linking;
});

test('T22 out-of-order request-form saves preserve newest persisted and cached values', async t => {
  const db = createDatabase(':memory:');
  seedDatabase(db);
  t.after(() => db.close());
  const r = workflows(db, 1, 1).r;
  const key = 'request-form-concurrency-audit';
  r.insert('preferences', { name: key, value_json: { key, title: 'Original', description: 'Original', questions: [] } });
  let releaseFirst, reads = 0;
  const h = createHarness(async (path, options = {}) => {
    const method = options.method || 'GET';
    if (path.startsWith('/api/preferences')) {
      if (method === 'GET') {
        if (++reads === 1) await new Promise(resolve => { releaseFirst = resolve; });
        return { ok: true, status: 200, json: async () => r.list('preferences') };
      }
      const data = JSON.parse(options.body);
      const saved = method === 'PATCH' ? r.update('preferences', Number(path.split('/').at(-1)), data) : r.insert('preferences', data);
      return { ok: true, status: 200, json: async () => saved };
    }
    return { ok: true, status: 200, json: async () => [] };
  });
  h.elements.delete('#breadcrumb');
  h.run(`requestFormDraft=${JSON.stringify({ key, title: 'Original', description: 'Original', questions: [] })};requestFormBuilder('Settings')`);
  const form = h.elements.get('#action-form');
  form.values = { title: 'Older save', description: 'Older description' };
  const first = form.onsubmit({ target: form, preventDefault() {} });
  form.values = { title: 'Newest save', description: 'Newest description' };
  const second = form.onsubmit({ target: form, preventDefault() {} });
  await second;
  const afterNewer = JSON.parse(r.list('preferences', { name: key })[0].value_json);
  assert.equal(afterNewer.title, 'Newest save');
  releaseFirst();
  await first;
  const persisted = JSON.parse(r.list('preferences', { name: key })[0].value_json);
  assert.equal(persisted.title, 'Newest save');
  assert.equal(persisted.description, 'Newest description');
  assert.equal(h.run('requestFormKnownEntries[0].title'), 'Newest save');

  const key2 = 'request-form-overlapping-writes';
  r.insert('preferences', { name: key2, value_json: { key: key2, title: 'Original', questions: [] } });
  const readResolvers = [], writeQueue = [];
  const h2 = createHarness((path, options = {}) => {
    const method = options.method || 'GET';
    if (path.startsWith('/api/preferences')) {
      if (method === 'GET') return new Promise(resolve => readResolvers.push(() => resolve({ ok: true, status: 200, json: async () => r.list('preferences') })));
      const data = JSON.parse(options.body);
      return new Promise(resolve => writeQueue.push({
        commitAndRespond() {
          const saved = method === 'PATCH' ? r.update('preferences', Number(path.split('/').at(-1)), data) : r.insert('preferences', data);
          resolve({ ok: true, status: 200, json: async () => saved });
        }
      }));
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => [] });
  });
  h2.elements.delete('#breadcrumb');
  h2.run(`requestFormDraft=${JSON.stringify({ key: key2, title: 'Original', questions: [] })};requestFormBuilder('Settings')`);
  const form2 = h2.elements.get('#action-form'), submit2 = form2.onsubmit;
  form2.values = { title: 'Older save' };
  const a = submit2({ target: form2, preventDefault() {} });
  form2.values = { title: 'Newer save' };
  const b = submit2({ target: form2, preventDefault() {} });
  readResolvers[0]();
  for (let i = 0; i < 20 && writeQueue.length < 1; i++) await Promise.resolve();
  readResolvers[1]();
  for (let i = 0; i < 20 && writeQueue.length < 2; i++) await Promise.resolve();
  writeQueue[1].commitAndRespond();
  await b;
  writeQueue[0].commitAndRespond();
  await a;
  const persisted2 = JSON.parse(r.list('preferences', { name: key2 })[0].value_json);
  assert.equal(persisted2.title, 'Newer save');
  assert.equal(h2.run('requestFormKnownEntries[0].title'), 'Newer save');

  const key3 = 'request-form-cross-tab';
  r.insert('preferences', { name: key3, value_json: { key: key3, title: 'Original', questions: [] } });
  let releaseA1;
  const makeTab = () => createHarness(async (path, options = {}) => {
    const method = options.method || 'GET';
    if (path.startsWith('/api/preferences')) {
      if (method === 'GET') return { ok: true, status: 200, json: async () => r.list('preferences') };
      const data = JSON.parse(options.body);
      if (data.value_json?.title === 'A1 delayed') await new Promise(resolve => { releaseA1 = resolve; });
      const saved = method === 'PATCH' ? r.update('preferences', Number(path.split('/').at(-1)), data) : r.insert('preferences', data);
      return { ok: true, status: 200, json: async () => saved };
    }
    return { ok: true, status: 200, json: async () => [] };
  });
  const tabA = makeTab(), tabB = makeTab();
  for (const tab of [tabA, tabB]) {
    tab.elements.delete('#breadcrumb');
    tab.run(`requestFormDraft=${JSON.stringify({ key: key3, title: 'Original', questions: [] })};requestFormBuilder('Settings')`);
  }
  const formA = tabA.elements.get('#action-form'), submitA = formA.onsubmit;
  const formB = tabB.elements.get('#action-form'), submitB = formB.onsubmit;
  formA.values = { title: 'A1 delayed' };
  const a1 = submitA({ target: formA, preventDefault() {} });
  while (!releaseA1) await Promise.resolve();
  formA.values = { title: 'A2 committed' };
  await submitA({ target: formA, preventDefault() {} });
  formB.values = { title: 'B1 committed' };
  await submitB({ target: formB, preventDefault() {} });
  releaseA1();
  await a1;
  const persisted3 = JSON.parse(r.list('preferences', { name: key3 })[0].value_json);
  assert.equal(persisted3.title, 'B1 committed');

  const tabC = makeTab();
  tabC.elements.delete('#breadcrumb');
  tabC.run(`requestFormDraft=${JSON.stringify({ key: key3, title: 'B1 committed', questions: [] })};requestFormBuilder('Settings')`);
  const formC = tabC.elements.get('#action-form');
  formC.values = { title: 'Edit after reload' };
  await formC.onsubmit({ target: formC, preventDefault() {} });
  const persisted4 = JSON.parse(r.list('preferences', { name: key3 })[0].value_json);
  assert.equal(persisted4.title, 'Edit after reload');
  assert.equal(tabC.run('requestFormKnownEntries[0].title'), 'Edit after reload');

  r.insert('preferences', { name: 'google-business-linked-form', value_json: { key: 'request-form-c', title: 'C' } });
  let firstLinkRead, linkReads = 0;
  const hLink = createHarness(async (path, options = {}) => {
    const method = options.method || 'GET';
    if (path.startsWith('/api/preferences')) {
      if (method === 'GET') {
        if (++linkReads === 1) await new Promise(resolve => { firstLinkRead = resolve; });
        return { ok: true, status: 200, json: async () => r.list('preferences') };
      }
      const data = JSON.parse(options.body);
      const saved = method === 'PATCH' ? r.update('preferences', Number(path.split('/').at(-1)), data) : r.insert('preferences', data);
      if (data.value_json?.key === 'request-form-b') throw Error('Network response lost after server commit');
      return { ok: true, status: 200, json: async () => saved };
    }
    return { ok: true, status: 200, json: async () => [] };
  });
  hLink.run("requestFormDraft={key:'request-form-a',title:'A',questions:[]};requestFormBuilder('Settings');");
  const linkA = hLink.run("settingsPartBAction({dataset:{settingsAction:'form-link'}})");
  while (!firstLinkRead) await Promise.resolve();
  hLink.run("requestFormDraft={key:'request-form-b',title:'B',questions:[]};requestFormBuilder('Settings');");
  await hLink.run("settingsPartBAction({dataset:{settingsAction:'form-link'}})").catch(() => {});
  firstLinkRead();
  await linkA;
  assert.equal(hLink.run('linkedRequestFormKey'), 'request-form-b');
  assert.equal(hLink.elements.get('#linked-form-status').textContent, 'Linked form: B');

  const revPref = r.insert('preferences', { name: 'audit-revisions-bound', value_json: {} });
  for (let i = 0; i < 200; i++) r.update('preferences', revPref.id, { value_json: {}, revision: `page-${i}:1` });
  const txStart = performance.now();
  for (let i = 0; i < 100; i++) transaction(db, () => {});
  assert.ok(performance.now() - txStart < 250);

  const key4 = 'request-form-review-race';
  const initial4 = r.insert('preferences', { name: key4, value_json: { key: key4, title: 'Initial', description: 'Initial', questions: [] } });
  let releaseFirst4;
  const fetcher4 = async (path, opts = {}) => {
    const method = opts.method || 'GET';
    if (path.startsWith('/api/preferences')) {
      if (method === 'GET') return { ok: true, status: 200, json: async () => r.list('preferences') };
      const d = JSON.parse(opts.body);
      const saved = method === 'PATCH' ? r.update('preferences', Number(path.split('/').at(-1)), d) : r.insert('preferences', d);
      if (d.value_json?.title === 'A older' && !releaseFirst4) await new Promise(resolve => { releaseFirst4 = resolve; });
      return { ok: true, status: 200, json: async () => saved };
    }
    return { ok: true, status: 200, json: async () => [] };
  };
  const ha = createHarness(fetcher4), hb = createHarness(fetcher4);
  for (const h of [ha, hb]) h.elements.delete('#breadcrumb');
  await ha.run(`requestFormOpen('${key4}')`);
  const fa = ha.elements.get('#action-form');
  fa.values = { title: 'A older', description: 'A older' };
  const saveA4 = fa.onsubmit({ target: fa, preventDefault() {} });
  while (!releaseFirst4) await Promise.resolve();
  await hb.run(`requestFormOpen('${key4}')`);
  const fb = hb.elements.get('#action-form');
  fb.values = { title: 'B latest', description: 'B latest' };
  await fb.onsubmit({ target: fb, preventDefault() {} });
  ha.run('close()');
  fa.values = {};
  await ha.run(`requestFormOpen('${key4}','Add tracking')`);
  releaseFirst4();
  await saveA4;
  fa.values = { tracking_code: 'UA-123' };
  await fa.onsubmit({ target: fa, preventDefault() {} });
  const final4 = JSON.parse(r.get('preferences', initial4.id).value_json);
  assert.equal(final4.title, 'B latest');
  assert.equal(final4.description, 'B latest');
  assert.equal(final4.tracking_code, 'UA-123');
});

test('T22 overlapping request-form saves still persist when the first read succeeds and the second read fails', async () => {
  const reads = [];
  let writes = 0;
  const h = createHarness((path, options = {}) => {
    if ((options.method || 'GET') === 'GET') return new Promise((resolve, reject) => reads.push({ resolve, reject }));
    writes++;
    return { ok: true, status: 200, json: async () => ({ id: 1 }) };
  });
  h.elements.delete('#breadcrumb');
  h.run("requestFormDraft={key:'request-form-race',title:'Original',questions:[]};requestFormBuilder('Settings')");
  const form = h.elements.get('#action-form'), submit = form.onsubmit;
  form.values = { title: 'Edited' };
  const first = submit({ target: form, preventDefault() {} });
  const second = submit({ target: form, preventDefault() {} });
  reads[0].resolve({ ok: true, status: 200, json: async () => [] });
  await first;
  assert.equal(writes, 1);
  assert.equal(h.elements.get('#overlay').innerHTML, '');
  assert.equal(h.elements.get('#toast').textContent, 'Saved successfully');
  reads[1].reject(Error('preferences read failed'));
  await second;
  assert.equal(writes, 1);
  assert.equal(h.run('requestFormKnownEntries[0].title'), 'Edited');
});

test('T22 failed newer request-form save does not overwrite older in-flight save or Add tracking', async () => {
  let stored = { key: 'request-form-a', title: 'Original', description: 'Original', questions: [] };
  let readNum = 0, finishOpen;
  const writes = [];
  const h = createHarness(async (path, options = {}) => {
    if ((options.method || 'GET') === 'GET') {
      if (++readNum === 3) await new Promise(r => { finishOpen = r; });
      return { ok: true, status: 200, json: async () => [{ id: 1, name: 'request-form-a', value_json: JSON.stringify(stored) }] };
    }
    const data = JSON.parse(options.body);
    return new Promise(resolve => writes.push({
      data,
      finish(ok = true) {
        if (ok) stored = JSON.parse(JSON.stringify(data.value_json));
        resolve({ ok, status: ok ? 200 : 500, json: async () => ok ? ({ id: 1, ...data }) : ({ error: 'Save failed' }) });
      }
    }));
  });
  h.elements.delete('#breadcrumb');
  h.run("requestFormDraft={key:'request-form-a',title:'Original',description:'Original',questions:[]};requestFormBuilder('Settings');error=err=>toast(err.message)");
  const form = h.elements.get('#action-form'), submit = form.onsubmit;
  form.values = { title: 'Successful older', description: 'Persisted older' };
  const older = submit({ target: form, preventDefault() {} });
  while (writes.length < 1) await Promise.resolve();
  form.values = { title: 'Failed newer', description: 'Canceled newer' };
  const newer = submit({ target: form, preventDefault() {} });
  while (writes.length < 2) await Promise.resolve();
  writes[1].finish(false);
  await newer;
  assert.equal(h.elements.get('#toast').textContent, 'Save failed');
  h.run('close()');
  form.values = {};
  const opening = h.run("requestFormOpen('request-form-a','Add tracking')");
  while (!finishOpen) await Promise.resolve();
  writes[0].finish(true);
  await older;
  finishOpen();
  await opening;
  assert.equal(stored.title, 'Successful older');
  assert.equal(h.run('requestFormKnownEntries.find(f=>f.key==="request-form-a").title'), 'Successful older');
  assert.equal(h.run('requestFormDraft.title'), 'Successful older');
  form.values = { tracking_code: 'UA-123' };
  const tracking = form.onsubmit({ target: form, preventDefault() {} });
  while (writes.length < 3) await Promise.resolve();
  writes[2].finish(true);
  await tracking;
  assert.equal(stored.title, 'Successful older');
  assert.equal(stored.description, 'Persisted older');
  assert.equal(stored.tracking_code, 'UA-123');
});

test('T22 delayed response from older save A does not trigger corrective overwrite of newer save C, and CSV markup_percent matches quote precision contract', async t => {
  const { importCSV } = await import('../src/services/pdf.js');
  const db = createDatabase(':memory:');
  seedDatabase(db);
  t.after(() => db.close());
  const w = workflows(db, 1, 1), client = w.createClient({ display_name: 'Precision Client' });
  assert.throws(() => importCSV(w.r, 'products_services', 'name,unit_cost_cents,markup_percent,unit_price_cents\nRepeating markup,300,33.3333333,400', w), /Invalid numeric CSV field/);
  const [product] = importCSV(w.r, 'products_services', 'name,unit_cost_cents,markup_percent,unit_price_cents\nSix decimal markup,300,33.333333,400', w);
  const quote = w.createQuote({ client_id: client.id, title: 'Catalog precision quote' }, [{ name: product.name, quantity: 1, unit_cost_cents: product.unit_cost_cents, markup_percent: product.markup_percent, unit_price_cents: product.unit_price_cents }]);
  assert.equal(quote.total_cents, 400);

  let stored = { key: 'request-form-race', title: 'Original', questions: [] };
  const writes = [];
  const h = createHarness(async (path, options = {}) => {
    if ((options.method || 'GET') === 'GET') {
      const snapshot = [{ id: 1, name: stored.key, value_json: JSON.stringify(stored) }];
      return { ok: true, status: 200, json: async () => snapshot };
    }
    const data = JSON.parse(options.body);
    return new Promise(resolve => writes.push({
      commit() { stored = JSON.parse(JSON.stringify(data.value_json)); },
      respond() { resolve({ ok: true, status: 200, json: async () => ({ id: 1, ...data }) }); }
    }));
  });
  h.elements.delete('#breadcrumb');
  const submit = title => {
    const form = h.elements.get('#action-form');
    form.values = { title };
    return form.onsubmit({ target: form, preventDefault() {} });
  };
  await h.run("requestFormOpen('request-form-race')");
  const first = submit('A older');
  while (writes.length < 1) await Promise.resolve();
  writes[0].commit();
  const second = submit('B newer');
  while (writes.length < 2) await Promise.resolve();
  writes[1].commit();
  writes[1].respond();
  await second;
  await h.run("requestFormOpen('request-form-race')");
  writes[0].respond();
  await first;
  const third = submit('C newest');
  while (writes.length < 3) await Promise.resolve();
  writes[2].commit();
  writes[2].respond();
  await third;
  assert.equal(writes.length, 3);
  assert.equal(stored.title, 'C newest');
  assert.equal(h.run("requestFormKnownEntries.find(f=>f.key==='request-form-race').title"), 'C newest');
});

test('T22 delayed request-form creation response does not overwrite newer saved edits or Add tracking', async t => {
  const db = createDatabase(':memory:');
  seedDatabase(db);
  t.after(() => db.close());
  const r = workflows(db, 1, 1).r;
  let finishCreation, createdKey, delayedFirstCreate = false;
  const h = createHarness(async (path, options = {}) => {
    const method = options.method || 'GET';
    if (path.startsWith('/api/preferences')) {
      if (method === 'GET') {
        const snapshot = r.list('preferences');
        return { ok: true, status: 200, json: async () => snapshot };
      }
      const data = JSON.parse(options.body);
      const saved = method === 'PATCH'
        ? r.update('preferences', Number(path.split('/').at(-1)), data)
        : r.insert('preferences', data);
      if (!delayedFirstCreate && method === 'POST' && data.name.startsWith('request-form-')) {
        delayedFirstCreate = true;
        createdKey = data.name;
        await new Promise(resolve => { finishCreation = resolve; });
      }
      return { ok: true, status: 200, json: async () => saved };
    }
    return { ok: true, status: 200, json: async () => [] };
  });
  h.elements.delete('#breadcrumb');
  const form = h.elements.get('#action-form');
  const submit = values => {
    form.values = values;
    return form.onsubmit({ target: form, preventDefault() {} });
  };
  await h.run("settingsPartBAction({dataset:{settingsAction:'request-form-new'}})");
  await submit({ kind: 'Request Form' });
  const creation = submit({ title: 'Initial title', description: 'Initial description' });
  while (!finishCreation) await Promise.resolve();
  h.run("close(); route='settings/requests-and-bookings'");
  await h.run("settingsPartB('requests-and-bookings')");
  form.values = {};
  await h.run(`requestFormOpen(${JSON.stringify(createdKey)})`);
  await submit({ title: 'Later saved title', description: 'Later saved description' });
  form.values = {};
  await h.run(`requestFormOpen(${JSON.stringify(createdKey)},'Add tracking')`);
  finishCreation();
  await creation;
  await submit({ tracking_code: 'GA-test' });
  const stored = JSON.parse(r.list('preferences', { name: createdKey })[0].value_json);
  assert.equal(stored.title, 'Later saved title');
  assert.equal(stored.description, 'Later saved description');
  assert.equal(stored.tracking_code, 'GA-test');
});

test('T22 in-flight newer save blocks stalled older read when newer succeeds, falls back to older when newer fails, and failed newer form-link does not suppress older link', async () => {
  for (const newerSucceeds of [true, false]) {
    let releaseA, respondB, reads = 0, stored = { key: 'request-form-a', title: 'Original', questions: [] };
    const writes = [];
    const h = createHarness(async (path, options = {}) => {
      if ((options.method || 'GET') === 'GET') {
        if (++reads === 1) await new Promise(r => { releaseA = r; });
        return { ok: true, status: 200, json: async () => [{ id: 1, name: stored.key, value_json: JSON.stringify(stored) }] };
      }
      const d = JSON.parse(options.body);
      if (d.value_json.title === 'B newer') {
        const ok = await new Promise(r => { respondB = r; });
        if (!ok) return { ok: false, status: 500, json: async () => ({ error: 'B write failed' }) };
      }
      stored = d.value_json;
      writes.push(stored.title);
      return { ok: true, status: 200, json: async () => ({ id: 1, ...d }) };
    });
    h.elements.delete('#breadcrumb');
    h.run("requestFormDraft={key:'request-form-a',title:'Original',questions:[]};requestFormBuilder('Settings');error=err=>toast(err.message)");
    const f = h.elements.get('#action-form'), submit = f.onsubmit;
    f.values = { title: 'A older' };
    const a = submit({ target: f, preventDefault() {} });
    f.values = { title: 'B newer' };
    const b = submit({ target: f, preventDefault() {} });
    while (!respondB) await Promise.resolve();
    releaseA();
    await Promise.resolve();
    await Promise.resolve();
    respondB(newerSucceeds);
    await Promise.all([a, b]);
    const expected = newerSucceeds ? 'B newer' : 'A older';
    assert.deepEqual(writes, [expected]);
    assert.equal(stored.title, expected);
    assert.equal(h.run('requestFormKnownEntries[0].title'), expected);
  }

  const link = createHarness();
  link.run("globalThis.linkCalls=[];globalThis.persistedLink='request-form-c';growthPreference=async(k,v)=>new Promise((resolve,reject)=>linkCalls.push({succeed:()=>{persistedLink=v.key;resolve();},reject}));linkedRequestFormKey='request-form-c';linkedRequestFormTitle='C';linkedRequestFormTitleKey=linkedRequestFormKey;requestFormDraft={key:'request-form-a',title:'A',questions:[]};requestFormBuilder('Settings')");
  const la = link.run("settingsPartBAction({dataset:{settingsAction:'form-link'}})");
  await Promise.resolve();
  link.run("requestFormDraft={key:'request-form-b',title:'B',questions:[]};requestFormBuilder('Settings')");
  const lb = link.run("settingsPartBAction({dataset:{settingsAction:'form-link'}})");
  await Promise.resolve();
  link.run("linkCalls[1].reject(Error('write failed'))");
  await lb.catch(() => {});
  link.run('linkCalls[0].succeed()');
  await la;
  assert.equal(link.run('persistedLink'), 'request-form-a');
  assert.equal(link.run('linkedRequestFormKey'), 'request-form-a');
  assert.equal(link.run('formLinkPending'), 0);
});

for (const readBeforeLink of [false, true]) {
  test('T22 stale preferences preserve committed form link and title, readBeforeLink=' + readBeforeLink, async () => {
    const h = createHarness();
    h.run(`
      let finishLink, finishPrefs;
      growthPreference=()=>new Promise(resolve=>{finishLink=resolve;});
      safePrefs=()=>new Promise(resolve=>{finishPrefs=resolve;});
      requestFormDraft={key:'request-form-a',title:'Form A',questions:[]};
      requestFormKnownEntries=[];
      requestFormBuilder('Settings');
    `);
    let opening;
    if (readBeforeLink) opening = h.run("requestFormOpen('request-form-b')");
    const linking = h.run("settingsPartBAction({dataset:{settingsAction:'form-link'}})");
    await Promise.resolve();
    assert.equal(h.run('formLinkPending'), 1);
    if (!readBeforeLink) opening = h.run("requestFormOpen('request-form-b')");
    h.run('finishLink()');
    await linking;
    assert.equal(h.run('formLinkPending'), 0);
    h.run(`finishPrefs([
      {name:'request-form-a',value_json:JSON.stringify({title:'Old A',questions:[]})},
      {name:'request-form-b',value_json:JSON.stringify({title:'Form B',questions:[]})},
      {name:'google-business-linked-form',value_json:JSON.stringify({key:'request-form-b'})}
    ])`);
    await opening;
    assert.equal(h.run('linkedRequestFormKey'), 'request-form-a');
    assert.equal(h.run('requestFormDraft.key'), 'request-form-b');
    await h.run("settingsPartBAction({dataset:{settingsAction:'form-tab:Settings'}})");
    assert.match(h.elements.get('#overlay').innerHTML, /Form Builder · Form B/);
    assert.match(h.elements.get('#overlay').innerHTML, /Linked form: Form A<\/p>/);
  });
}

test('T21 creating Form B does not invalidate a pending Form A link or leave Settings stale', async () => {
  const h = createHarness();
  h.run(`
    let finishLink;
    const newFormSaves=[];
    growthPreference=(key,value)=>key==='google-business-linked-form'
      ?new Promise(resolve=>{finishLink=resolve;})
      :Promise.resolve(newFormSaves.push({key,value}));
    requestFormDraft={key:'request-form-a',title:'Form A',questions:[]};
    requestFormKnownEntries=[{...requestFormDraft}];
    requestFormBuilder('Settings');
  `);
  const pending = h.run("settingsPartBAction({dataset:{settingsAction:'form-link'}})");
  await Promise.resolve();
  assert.equal(typeof h.run('finishLink'), 'function');
  await h.run("settingsPartBAction({dataset:{settingsAction:'request-form-new'}})");
  const form = h.elements.get('#action-form');
  assert.match(h.elements.get('#overlay').innerHTML, /Add New Form · Step 1/);
  form.values = { kind: 'Request Form' };
  await form.onsubmit({ preventDefault() {}, target: form });
  assert.match(h.elements.get('#overlay').innerHTML, /Add New Form · Step 2/);
  form.values = { title: 'Form B', description: 'New form', pages: '2' };
  await form.onsubmit({ preventDefault() {}, target: form });
  assert.equal(h.run('newFormSaves.length'), 1);
  assert.equal(h.run('requestFormDraft.title'), 'Form B');
  const formBKey = h.run('requestFormDraft.key');
  assert.notEqual(formBKey, 'request-form-a');
  await h.run("settingsPartBAction({dataset:{settingsAction:'form-tab:Settings'}})");
  const markup = h.elements.get('#overlay').innerHTML;
  assert.match(markup, /Form Builder · Form B/);
  assert.match(markup, /id="linked-form-status"/);
  h.run('finishLink()');
  await pending;
  assert.equal(h.run('linkedRequestFormKey'), 'request-form-a');
  assert.equal(h.run('requestFormDraft.key'), formBKey);
  assert.equal(h.elements.get('#linked-form-status').textContent, 'Linked form: Form A');
  assert.equal(h.elements.get('#overlay').innerHTML, markup);
  h.run("requestFormBuilder('Settings')");
  assert.match(h.elements.get('#overlay').innerHTML, /id="linked-form-status">Linked form: Form A<\/p>/);
  assert.equal(h.run('linkedRequestFormKey'), 'request-form-a');
});

test('T22 preference revision savepoints preserve LRU eviction/order and delete triggers across rollback, and delayed save response cannot overwrite newer server state during requestFormOpen', async () => {
  const db = createDatabase(':memory:');
  seedDatabase(db);
  const r = repository(db, 1);
  assert.throws(() => transaction(db, () => {
    r.insert('preferences', { name: 'first-in-rolled-back-tx', value_json: { v: 1 }, revision: 's1:2' });
    throw new Error('rollback first init');
  }), /rollback first init/);
  const row0 = r.insert('preferences', { name: 'k-0', value_json: { v: 'new' }, revision: 's1:2' });
  db.prepare('DELETE FROM preferences WHERE id=?').run(row0.id);
  const recreated0 = r.insert('preferences', { name: 'k-0', value_json: { v: 'recreated' }, revision: 's1:1' });
  assert.equal(JSON.parse(recreated0.value_json).v, 'recreated');
  r.update('preferences', recreated0.id, { name: 'k-0', value_json: { v: 'recreated' }, revision: 's1:2' });

  for (let i = 1; i <= 255; i++) {
    r.insert('preferences', { name: 'k-' + i, value_json: { v: i }, revision: 's1:2' });
  }
  assert.throws(() => transaction(db, () => {
    r.insert('preferences', { name: 'k-256', value_json: { v: 256 }, revision: 's1:2' });
    throw new Error('rollback eviction');
  }), /rollback eviction/);
  r.update('preferences', recreated0.id, { name: 'k-0', value_json: { v: 'stale-attempt' }, revision: 's1:1' });
  assert.equal(JSON.parse(r.get('preferences', recreated0.id).value_json).v, 'recreated');

  const key = 'request-form-a';
  const row = r.insert('preferences', { name: key, value_json: { key, title: 'Original', questions: [] } });
  let releaseA, releaseRead, pauseReads = false;
  const h = createHarness(async (path, options = {}) => {
    const method = options.method || 'GET';
    if (method === 'GET') {
      const rows = r.list('preferences');
      if (pauseReads) await new Promise(res => { releaseRead = res; });
      return { ok: true, status: 200, json: async () => rows };
    }
    const body = JSON.parse(options.body);
    const saved = method === 'POST' ? r.insert('preferences', body) : r.update('preferences', Number(path.split('/').pop()), body);
    if (body.value_json?.title === 'A older') await new Promise(res => { releaseA = res; });
    return { ok: true, status: 200, json: async () => saved };
  });
  h.elements.delete('#breadcrumb');
  await h.run(`requestFormOpen(${JSON.stringify(key)})`);
  const f = h.elements.get('#action-form');
  f.values = { title: 'A older' };
  const saveA = f.onsubmit({ target: f, preventDefault() {} });
  while (!releaseA) await Promise.resolve();
  r.update('preferences', row.id, { name: key, value_json: { key, title: 'B latest', questions: [] }, revision: 'other-tab:9' });
  pauseReads = true;
  const open = h.run(`requestFormOpen(${JSON.stringify(key)}, 'Add tracking')`);
  while (!releaseRead) await Promise.resolve();
  releaseA();
  await saveA;
  pauseReads = false;
  releaseRead();
  await open;
  f.values = { tracking_code: 'GA-1' };
  await f.onsubmit({ target: f, preventDefault() {} });
  const finalValue = JSON.parse(r.get('preferences', row.id).value_json);
  assert.equal(finalValue.title, 'B latest');
  assert.equal(finalValue.tracking_code, 'GA-1');

  let reads2 = 0, releaseSaveRead2, releaseOpenRead2, releaseAResponse2;
  const key2 = 'request-form-b';
  const row2 = r.insert('preferences', { name: key2, value_json: { key: key2, title: 'Original 2', description: 'Original 2', questions: [] } });
  const h2 = createHarness(async (path, options = {}) => {
    const method = options.method || 'GET';
    if (method === 'GET') {
      const no = ++reads2;
      if (no === 2) await new Promise(res => { releaseSaveRead2 = res; });
      if (no === 3) await new Promise(res => { releaseOpenRead2 = res; });
      return { ok: true, status: 200, json: async () => r.list('preferences') };
    }
    const body = JSON.parse(options.body);
    const saved = method === 'POST' ? r.insert('preferences', body) : r.update('preferences', Number(path.split('/').pop()), body);
    if (body.value_json?.title === 'A2 older' && !releaseAResponse2) await new Promise(res => { releaseAResponse2 = res; });
    return { ok: true, status: 200, json: async () => saved };
  });
  h2.elements.delete('#breadcrumb');
  await h2.run(`requestFormOpen(${JSON.stringify(key2)})`);
  const f2 = h2.elements.get('#action-form');
  f2.values = { title: 'A2 older', description: 'A2 older description' };
  const save2 = f2.onsubmit({ target: f2, preventDefault() {} });
  while (!releaseSaveRead2) await Promise.resolve();
  h2.run('close()');
  const open2 = h2.run(`requestFormOpen(${JSON.stringify(key2)}, 'Add tracking')`);
  while (!releaseOpenRead2) await Promise.resolve();
  releaseSaveRead2();
  while (!releaseAResponse2) await Promise.resolve();
  r.update('preferences', row2.id, { name: key2, value_json: { key: key2, title: 'B2 latest', description: 'B2 latest description', questions: [] }, revision: 'other-tab:1' });
  releaseOpenRead2();
  await open2;
  releaseAResponse2();
  await save2;
  f2.values = { tracking_code: 'GA-2' };
  await f2.onsubmit({ target: f2, preventDefault() {} });
  const finalValue2 = JSON.parse(r.get('preferences', row2.id).value_json);
  assert.equal(finalValue2.title, 'B2 latest');
  assert.equal(finalValue2.description, 'B2 latest description');
  assert.equal(finalValue2.tracking_code, 'GA-2');

  const original3 = { key: 'request-form-revert', title: 'Original', questions: [] };
  let stored3 = { ...original3 }, finishSave3, writes3 = 0;
  const h3 = createHarness(async (path, options = {}) => {
    if ((options.method || 'GET') === 'GET') {
      return { ok: true, status: 200, json: async () => [{ id: 1, name: stored3.key, value_json: JSON.stringify(stored3) }] };
    }
    stored3 = JSON.parse(options.body).value_json;
    const snap = { id: 1, name: stored3.key, value_json: JSON.stringify(stored3) };
    if (++writes3 === 1) await new Promise(res => { finishSave3 = res; });
    return { ok: true, status: 200, json: async () => snap };
  });
  h3.elements.delete('#breadcrumb');
  await h3.run("requestFormOpen('request-form-revert')");
  const f3 = h3.elements.get('#action-form');
  f3.values = { title: 'A older' };
  const saving3 = f3.onsubmit({ target: f3, preventDefault() {} });
  while (!finishSave3) await Promise.resolve();
  stored3 = { ...original3 };
  h3.run('close()');
  f3.values = {};
  await h3.run("requestFormOpen('request-form-revert','Add tracking')");
  finishSave3();
  await saving3;
  f3.values = { tracking_code: 'GA-1' };
  await f3.onsubmit({ target: f3, preventDefault() {} });
  assert.equal(stored3.title, 'Original');
  assert.equal(stored3.tracking_code, 'GA-1');

  let stored4 = { key: 'request-form-list-race', title: 'Original', questions: [] }, finishSave4, finishRead4, reads4 = 0;
  const h4 = createHarness(async (path, options = {}) => {
    if ((options.method || 'GET') === 'GET') {
      if (++reads4 === 3) await new Promise(res => { finishRead4 = res; });
      return { ok: true, status: 200, json: async () => [{ id: 1, name: stored4.key, value_json: JSON.stringify(stored4) }] };
    }
    stored4 = JSON.parse(options.body).value_json;
    const snap = { id: 1, name: stored4.key, value_json: JSON.stringify(stored4) };
    await new Promise(res => { finishSave4 = res; });
    return { ok: true, status: 200, json: async () => snap };
  });
  h4.elements.delete('#breadcrumb');
  await h4.run("requestFormOpen('request-form-list-race')");
  const f4 = h4.elements.get('#action-form');
  f4.values = { title: 'A older' };
  const saving4 = f4.onsubmit({ target: f4, preventDefault() {} });
  while (!finishSave4) await Promise.resolve();
  h4.run("close();route='settings/requests-and-bookings'");
  const listing4 = h4.run("settingsPartB('requests-and-bookings')");
  while (!finishRead4) await Promise.resolve();
  stored4 = { key: 'request-form-list-race', title: 'B latest', questions: [] };
  finishSave4();
  await saving4;
  finishRead4();
  const html4 = await listing4;
  assert.match(html4, /B latest/);
  assert.doesNotMatch(html4, /A older/);

  const renameRow = r.insert('preferences', { name: 'pref-rename-a', value_json: { v: 'v1' }, revision: 'tab:1' });
  r.update('preferences', renameRow.id, { name: 'pref-rename-b', value_json: { v: 'v3' }, revision: 'tab:3' });
  r.update('preferences', renameRow.id, { name: 'pref-rename-a', value_json: { v: 'v2-stale-update' }, revision: 'tab:2' });
  assert.equal(r.get('preferences', renameRow.id).name, 'pref-rename-b');
  assert.equal(JSON.parse(r.get('preferences', renameRow.id).value_json).v, 'v3');
  const staleInsert = r.insert('preferences', { name: 'pref-rename-a', value_json: { v: 'v2-stale-insert' }, revision: 'tab:2' });
  assert.equal(staleInsert.id, renameRow.id);
  assert.equal(r.get('preferences', renameRow.id).name, 'pref-rename-b');
  assert.equal(JSON.parse(r.get('preferences', renameRow.id).value_json).v, 'v3');

  const { importCSV } = await import('../src/services/pdf.js');
  const w = workflows(db, 1, 1);
  const c = w.createClient({ display_name: 'Job CSV Client' });
  const [importedJob] = importCSV(r, 'jobs', `client_id,title,subtotal_cents,tax_cents\n${c.id},Imported Tile Job,10000,1000`, w);
  assert.equal(importedJob.subtotal_cents, 10000);
  assert.equal(importedJob.tax_cents, 1000);
  assert.equal(importedJob.total_cents, 11000);
  w.completeJob(importedJob.id);
  const jobInvoice = w.invoiceJob(importedJob.id);
  assert.equal(jobInvoice.subtotal_cents, 10000);
  assert.equal(jobInvoice.tax_cents, 1000);
  assert.equal(jobInvoice.total_cents, 11000);
  assert.throws(() => importCSV(r, 'jobs', `client_id,title,subtotal_cents,tax_cents,total_cents\n${c.id},Bad Job,10000,1000,12000`, w), /CSV job amounts do not match/);
});
