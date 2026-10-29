import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { createDatabase, repository } from '../src/db/database.js';
import { migrate } from '../src/db/schema.js';
import { seedDatabase } from '../src/db/seed.js';

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
    '#bookkeeping-highlight', '#community-topics',
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
