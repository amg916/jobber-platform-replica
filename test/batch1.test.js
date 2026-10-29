import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext, runInContext, Script} from 'node:vm';

const source = readFileSync(new URL('../src/public/app.js', import.meta.url), 'utf8');
function harness() {
  const elements = new Map();
  const context = createContext({
    URL, Intl, Date, console, setTimeout() {},
    location: {pathname: '/hub/test', search: ''},
    sessionStorage: {getItem() { return null; }},
    history: {pushState() {}}, window: {},
    document: {
      querySelector: selector => elements.get(selector) || null,
      querySelectorAll: () => [], addEventListener() {}
    },
    fetch: async () => ({ok: true, json: async () => []})
  });
  runInContext(source.slice(0, source.lastIndexOf('init().catch')), context);
  return {context, elements, run: code => runInContext(code, context)};
}

test('Batch 1 remains a classic script with the final init entry point', () => {
  assert.doesNotThrow(() => new Script(source));
  assert.doesNotMatch(source, /^\s*(import|export)\s/m);
  assert.match(source.slice(source.lastIndexOf('init().catch')), /Unable to load workspace/);
});

test('Home currency keeps compact whole dollars without changing money()', () => {
  const h = harness();
  assert.equal(h.run('homeMoney(0)'), '$0');
  assert.equal(h.run('homeMoney(120000)'), '$1,200');
  assert.equal(h.run('homeMoney(120050)'), '$1,200.50');
  assert.equal(h.run('money(0)'), '$0.00');
});

test('Workflow filters handle derived statuses and partial invoice payments', () => {
  const h = harness();
  assert.equal(h.run("matchesRouteStatus({status:'late'}, 'action_required', 'jobs')"), true);
  assert.equal(h.run("matchesRouteStatus({status:'active'}, 'action_required', 'jobs')"), false);
  assert.equal(h.run("matchesRouteStatus({status:'assessment_complete'}, 'assessment_completed', 'requests')"), true);
  assert.equal(h.run("matchesRouteStatus({status:'new',assessment_date:'2000-01-01'}, 'overdue', 'requests')"), true);
  assert.equal(h.run("matchesRouteStatus({status:'converted',assessment_date:'2000-01-01'}, 'overdue', 'requests')"), false);
  assert.equal(h.run("matchesRouteStatus({status:'partial'}, 'awaiting_payment', 'invoices')"), true);
});

test('Query routing separates route names and clears filters on plain navigation', async () => {
  const h = harness();
  h.run('close = () => {}; render = async () => {};');
  await h.run("go('requests?status=new')");
  assert.equal(h.run('route'), 'requests');
  assert.equal(h.run("routeQuery.get('status')"), 'new');
  await h.run("go('requests')");
  assert.equal(h.run("routeQuery.has('status')"), false);
  await h.run("go('payments?tab=payouts')");
  assert.equal(h.run('paymentTab'), 'Payouts');
  await h.run("go('payments')");
  assert.equal(h.run('paymentTab'), 'Overview');
});

test('Route link hydration adds real hrefs without replacing explicit targets', () => {
  const h = harness();
  assert.equal(h.run(`withRouteHrefs('<a data-go="report/Client balance summary">Report</a>')`),
    '<a href="/report/Client%20balance%20summary" data-go="report/Client balance summary">Report</a>');
  assert.equal(h.run(`withRouteHrefs('<a href="/home" data-go="home">Home</a>')`),
    '<a href="/home" data-go="home">Home</a>');
});

test('Feed categories and prompt inventory cover the requested controls', () => {
  const h = harness();
  assert.equal(h.run('feedCategories.length'), 13);
  assert.equal(h.run('aiPrompts.length'), 6);
  assert.equal(h.run('productUpdates.length'), 9);
  assert.equal(h.run('onboardingSteps.length'), 6);
  assert.equal(h.run("notificationCategory({event_type:'quote_approved'})"), 'Quotes approved');
  assert.equal(h.run("notificationCategory({title:'Payment received'})"), 'Payment received');
});
