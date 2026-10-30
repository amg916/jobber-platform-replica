import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculateDocument } from '../src/services/calculations.js';

const parityCss = readFileSync(new URL('../src/public/parity.css', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../src/public/app.js', import.meta.url), 'utf8');

test('T18: frontend calcDocumentPreview matches backend calculateDocument penny-for-penny across half-up rounding, mixed tax, discounts, deposits, and margin', async () => {
  const fnBody = appSource.slice(
    appSource.indexOf('function docDecimal('),
    appSource.indexOf('function updateDocumentTotals(')
  );
  const calcPreview = new Function(`${fnBody}; return calcDocumentPreview;`)();

  const cases = [
    {
      items: [
        { name: 'Tile install', quantity: '1.333', unit_price_cents: 1999, unit_cost_cents: 850, taxable: 1 },
        { name: 'Grout sealer', quantity: '2.5', unit_price_cents: 333, unit_cost_cents: 120, taxable: 0 },
        { name: 'Optional heated mat', quantity: 1, unit_price_cents: 15000, unit_cost_cents: 9000, taxable: 1, is_optional: 1, is_selected: 0 },
        { name: 'Selected trim', quantity: 2, unit_cost_cents: 1000, markup_percent: '12.5', taxable: 1, is_optional: 1, is_selected: 1 }
      ],
      options: { tax_rate: '8.375', discount_type: 'percent', discount_value: '7.5', required_deposit_type: 'percent', required_deposit_value: '25' }
    },
    {
      items: [
        { name: 'Demolition', quantity: 3, unit_price_cents: 4500, unit_cost_cents: 2000, taxable: 1 },
        { name: 'Haul away', quantity: 1, unit_price_cents: 2500, unit_cost_cents: 500, taxable: 0 }
      ],
      options: { tax_rate: '6.25', discount_type: 'fixed', discount_value: 3000, required_deposit_type: 'fixed', required_deposit_value: 5000 }
    }
  ];

  for (const c of cases) {
    const oracle = calculateDocument(c.items, c.options);
    const preview = calcPreview(c.items, c.options);
    assert.equal(preview.subtotal_cents, oracle.subtotal_cents);
    assert.equal(preview.discount_cents, oracle.discount_cents);
    assert.equal(preview.tax_cents, oracle.tax_cents);
    assert.equal(preview.total_cents, oracle.total_cents);
    assert.equal(preview.required_deposit_cents, oracle.required_deposit_cents);
    assert.deepEqual(
      preview.lines.map(l => l.total_cents),
      oracle.lines.map(l => l.total_cents)
    );
  }

  const leadingDot = calcPreview([{ name: 'Half hour labor', quantity: '.5', unit_price_cents: 10000, taxable: 1 }], { tax_rate: '10' });
  assert.equal(leadingDot.subtotal_cents, 5000);
  assert.equal(leadingDot.tax_cents, 500);
  assert.equal(leadingDot.total_cents, 5500);
});

test('T18: full-canvas Atlantis CSS rules dock #builder and .detail-grid over #workspace without breaking popovers', () => {
  assert.match(parityCss, /#overlay:has\(#builder\),#overlay:has\(\.detail-grid\)\{inset:60px 0 0 188px/);
  assert.match(parityCss, /body:has\(#sidebar\.collapsed\) #overlay:has\(#builder\)/);
  assert.match(parityCss, /#doc-totals-summary\.doc-totals-card/);
  assert.match(parityCss, /#builder \.line-item \[data-line-total\]/);
  assert.match(appSource, /id="doc-totals-summary"/);
  assert.match(appSource, /data-line-total aria-label="Line total"/);
  assert.match(appSource, /class="detail-grid" data-detail-type=/);
  assert.match(appSource, /toFixed\(6\)/);
});
