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
