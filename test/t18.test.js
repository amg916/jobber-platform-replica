import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { calculateDocument } from '../src/services/calculations.js';
import { generatePDF } from '../src/services/pdf.js';
import { editDocument } from '../src/services/workspace.js';
import { createDatabase } from '../src/db/database.js';
import { seedDatabase } from '../src/db/seed.js';
import { workflows } from '../src/services/workflows.js';

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

test('T19 & T20: 1:1 workflow closure — inline client quick-create, property auto-filter, optional line items, in-place client tabs, signature pad, paper preview, and unscheduled drawer', async () => {
  assert.match(appSource, /function quickClientMarkup\(/);
  assert.match(appSource, /function syncBuilderClientProperties\(/);
  assert.match(appSource, /function bindBuilderClientQuickCreate\(/);
  assert.match(appSource, /data-add-optional-line/);
  assert.match(appSource, /data-optional aria-label="Optional line item"/);
  assert.match(appSource, /data-selected aria-label="Recommended \/ Selected"/);
  assert.match(appSource, /function bindSignaturePad\(/);
  assert.match(appSource, /canvas data-signature-pad/);
  assert.match(appSource, /async function documentPreviewModal\(/);
  assert.match(appSource, /id="document-preview-panel" class="atlantis-paper-preview"/);
  assert.match(appSource, /data-unscheduled-drawer/);
  assert.match(parityCss, /#document-preview-panel\.atlantis-paper-preview/);
  assert.match(parityCss, /\.signature-pad-wrap canvas\[data-signature-pad\]/);
  assert.match(parityCss, /\.unscheduled-drawer/);

  const lineFnBody = appSource.slice(
    appSource.indexOf('function docDecimal('),
    appSource.indexOf('const defaultClientDetailTabs=')
  );
  const { calcDocumentPreview, lineEditor } = new Function(
    'esc',
    'money',
    'calculateDocument',
    `${lineFnBody}; return { calcDocumentPreview, lineEditor };`
  )(
    v => String(v ?? ''),
    v => `$${((v || 0) / 100).toFixed(2)}`,
    calculateDocument
  );

  const optMarkup = lineEditor({ name: 'Heated towel rail', unit_price_cents: 25000, quantity: 1, is_optional: 1, is_selected: 0 }, false, true);
  assert.match(optMarkup, /data-optional[^>]*checked/);
  assert.doesNotMatch(optMarkup, /data-selected[^>]*checked/);

  const invMarkup = lineEditor({ name: 'Invoice labor', unit_price_cents: 10000, quantity: 1 }, true, false);
  assert.doesNotMatch(invMarkup, /data-optional/);
  assert.doesNotMatch(invMarkup, /data-selected/);

  assert.match(appSource, /<fieldset class="full quick-client-panel" data-client-quick-panel hidden disabled>/);
  assert.match(appSource, /activeClientTab\.id===Number\(id\)&&activeClientTab\.action/);
  assert.match(appSource, /sig\.name\|\|x\.approved_by_name/);

  const previewExcluded = calcDocumentPreview([
    { name: 'Base tile', quantity: 1, unit_price_cents: 50000, taxable: 1 },
    { name: 'Heated towel rail', quantity: 1, unit_price_cents: 25000, taxable: 1, is_optional: 1, is_selected: 0 }
  ], { tax_rate: 10 });
  assert.equal(previewExcluded.subtotal_cents, 50000);
  assert.equal(previewExcluded.total_cents, 55000);

  const previewSelected = calcDocumentPreview([
    { name: 'Base tile', quantity: 1, unit_price_cents: 50000, taxable: 1 },
    { name: 'Heated towel rail', quantity: 1, unit_price_cents: 25000, taxable: 1, is_optional: 1, is_selected: 1 }
  ], { tax_rate: 10 });
  assert.equal(previewSelected.subtotal_cents, 75000);
  assert.equal(previewSelected.total_cents, 82500);

  // Runtime test 1: Quick-create uses .quick-client-actions so Save and... stays in #builder > .actions
  assert.doesNotMatch(appSource.slice(appSource.indexOf('function quickClientMarkup()'), appSource.indexOf('function syncBuilderClientProperties(')), /class="actions"/);
  assert.match(appSource, /\(q\('#builder > \.actions'\)\|\|q\('\.actions'\)\)\?\.insertAdjacentHTML/);

  // Runtime test 2: editDocument rejects property belonging to another client
  const db = createDatabase();
  seedDatabase(db);
  const w = workflows(db, 1, 1);
  const c1 = w.createClient({ display_name: 'Client One' });
  const c2 = w.createClient({ display_name: 'Client Two' });
  const p2 = w.r.insert('properties', { client_id: c2.id, street1: '200 Foreign Ave', is_primary: 1 });
  const q1 = w.createQuote({ client_id: c1.id, title: 'Original Quote' }, [{ name: 'Tile', quantity: 1, unit_price_cents: 10000 }]);
  assert.throws(() => editDocument(w, 'quotes', q1.id, { property_id: p2.id }), /Property belongs to another client/);
  db.close();

  // Runtime test 3: bindSignaturePad stops drawing when mouse released outside (buttons === 0)
  const sigBody = appSource.slice(appSource.indexOf('function bindSignaturePad('), appSource.indexOf('async function documentPreviewModal('));
  const runBindSig = new Function(`${sigBody}; return bindSignaturePad;`)();
  let strokes = 0;
  const fakeCanvas = {
    width: 360,
    height: 110,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 360, height: 110 }),
    getContext: () => ({ beginPath() {}, moveTo() {}, lineTo() {}, stroke() { strokes++; }, clearRect() {} }),
    toDataURL: () => 'data:image/png;base64,drawn'
  };
  const dataInput = { value: '' }, sigInput = { value: '' }, clearBtn = {};
  runBindSig({
    querySelector: sel => sel === '[data-signature-pad]' ? fakeCanvas : sel === '[name="signature_data"]' ? dataInput : sel === '[name="signature"]' ? sigInput : sel === '[data-signature-clear]' ? clearBtn : null
  });
  fakeCanvas.onpointerdown({ clientX: 20, clientY: 20, buttons: 1, pointerId: 1 });
  fakeCanvas.onpointermove({ clientX: 40, clientY: 30, buttons: 1 });
  assert.equal(strokes, 1);
  // Released outside canvas -> hover back with buttons: 0 must not draw
  fakeCanvas.onpointermove({ clientX: 80, clientY: 50, buttons: 0 });
  assert.equal(strokes, 1);
  fakeCanvas.onpointermove({ clientX: 90, clientY: 60, buttons: 1 });
  assert.equal(strokes, 1);

  // Runtime test 4: generatePDF embeds /Subtype /Image XObject and /Sig1 Do when signature_data is present
  const makeMiniPng = () => {
    const crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); crcTable[n] = c; }
    const crc32 = buf => { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
    const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0); const tb = Buffer.from(type, 'ascii'); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([tb, data])), 0); return Buffer.concat([len, tb, data, crc]); };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(2, 4); ihdr[8] = 8; ihdr[9] = 6;
    const raw = Buffer.from([0, 17, 24, 39, 255, 255, 255, 255, 0, 0, 255, 255, 255, 0, 17, 24, 39, 255]);
    return 'data:image/png;base64,' + Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]).toString('base64');
  };
  const pdfBuf = generatePDF({ id: 7, title: 'Signed Quote', subtotal_cents: 10000, total_cents: 10000, status: 'approved' }, [], { name: 'J S Custom Tile' }, { name: 'Jane Client', signature: 'Drawn signature', signature_data: makeMiniPng() });
  const pdfText = pdfBuf.toString();
  assert.match(pdfText, /\/Subtype \/Image \/Width 2 \/Height 2/);
  assert.match(pdfText, /\/Sig1 Do/);
  const xref = Number(pdfText.match(/startxref\n(\d+)/)[1]);
  assert.equal(pdfText.slice(xref, xref + 4), 'xref');

  // Runtime test 5: Print CSS hides underlying #workspace and unclips #overlay without hiding .paper-header
  assert.match(parityCss, /@media print\{body>header,#app>header,#sidebar/);
  assert.match(parityCss, /body:has\(#document-preview-panel\) #workspace[^{]*\{display:none!important\}/);
  assert.match(parityCss, /#overlay:has\(#document-preview-panel\)\{position:static!important;inset:auto!important;height:auto!important;max-height:none!important;overflow:visible!important/);

  // Runtime test 6: Invalid signature_data is omitted (not fabricated) and bounded by maxOutputLength
  const invalidSigPdf = generatePDF({ id: 8, title: 'Invalid Sig Quote', subtotal_cents: 5000, total_cents: 5000, status: 'approved' }, [], { name: 'J S Custom Tile' }, { name: 'Jane Client', signature: 'Drawn signature', signature_data: 'data:image/png;base64,not-a-valid-png' }).toString();
  assert.match(invalidSigPdf, /Signed by: Jane Client/);
  assert.doesNotMatch(invalidSigPdf, /\/Subtype \/Image/);
  assert.match(appSource, /org\?\.address\|\|org\?\.address_line1/);
  assert.match(appSource, /return await documentPreviewModal\(type,Number\(id\)\)/);
  assert.match(appSource, /if\(version===panelVersion\)error\(err\);else toast\(err\.message\);return;/);
  assert.match(appSource, /x\.disclaimer_notes&&x\.disclaimer_notes!==x\.client_message/);
  assert.match(parityCss, /#document-preview-panel \.paper-header\{[^}]*height:auto;padding:0 0 20px;background:transparent/);
  assert.match(parityCss, /#document-preview-panel \.badge\{position:static;display:inline-block/);
});
