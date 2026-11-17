// Godowns (Vyapar parity Phase 3) on the web: the pure helpers behind the screen (lib/data/godowns.js) — godown
// options for line and pickers, joining the stock table to item names, the transfer form's validation and payload,
// the BOM preview and the batch choices a transfer line offers.
import { describe, expect, it } from 'vitest';
import {
  batchOptionsFromLots,
  bomPreview,
  buildTransferPayload,
  godownLabel,
  godownLineOptions,
  godownPickerOptions,
  itemTracksBatches,
  stockRowsWithNames,
  transferLineSummary,
  validateAssembleForm,
  validateTransferForm,
} from '../src/lib/data/godowns';

const godowns = [
  { id: 'g1', name: 'Main shop', code: '', isDefault: true },
  { id: 'g2', name: 'Warehouse', code: 'GD-02', isDefault: false },
  { id: 'g3', name: 'Counter', code: '', isDefault: false },
];

describe('godown labels and options', () => {
  it('the code rides along in brackets when there is one', () => {
    expect(godownLabel(godowns[0])).toBe('Main shop');
    expect(godownLabel(godowns[1])).toBe('Warehouse (GD-02)');
    expect(godownLabel(null)).toBe('');
  });

  it('a sale or purchase line: empty means the default godown and says so, the rest follow', () => {
    const opts = godownLineOptions(godowns, 'g1');
    expect(opts[0]).toEqual({ value: '', label: 'Main shop (default)' });
    expect(opts.map((o) => o.value)).toEqual(['', 'g2', 'g3']);
    expect(opts[1].label).toBe('Warehouse (GD-02)');
    // No default marked (an organization before the first godown): still a usable first choice.
    expect(godownLineOptions(godowns, null)[0]).toEqual({ value: '', label: 'Default godown' });
  });

  it('a picker that must name a real godown: default first and marked, no empty choice', () => {
    const opts = godownPickerOptions(godowns, 'g1');
    expect(opts.map((o) => o.value)).toEqual(['g1', 'g2', 'g3']);
    expect(opts[0].label).toBe('Main shop — default');
    expect(opts[1].label).toBe('Warehouse (GD-02)');
  });
});

describe('stock by godown', () => {
  it('the API rows are joined to the item names and units; an unknown item still shows', () => {
    const items = [
      { id: 'i1', name: 'Pencil', unit: 'Nos' },
      { id: 'i2', name: 'Notebook', unit: 'Pcs' },
    ];
    expect(stockRowsWithNames([{ itemId: 'i2', quantity: 3 }, { itemId: 'zz', quantity: -1 }], items)).toEqual([
      { itemId: 'i2', quantity: 3, name: 'Notebook', unit: 'Pcs' },
      { itemId: 'zz', quantity: -1, name: 'Item', unit: '' },
    ]);
    expect(stockRowsWithNames(null)).toEqual([]);
  });
});

describe('transfer form', () => {
  const base = { transferDate: '2026-11-17', fromGodownId: 'g1', toGodownId: 'g2' };

  it('a filled form passes; the empty form names every missing field', () => {
    expect(validateTransferForm({ ...base, lines: [{ itemId: 'i1', quantity: '2' }] })).toEqual([]);
    expect(validateTransferForm({ transferDate: '', fromGodownId: '', toGodownId: '', lines: [] })).toEqual([
      'Choose a date.',
      'Choose the godown stock moves out of.',
      'Choose the godown stock moves into.',
      'Add at least one line with an item and a quantity.',
    ]);
  });

  it('the same godown both ways is refused, and so is a zero quantity', () => {
    expect(validateTransferForm({ ...base, toGodownId: 'g1', lines: [{ itemId: 'i1', quantity: '2' }] })).toEqual([
      'Choose two different godowns.',
    ]);
    expect(validateTransferForm({ ...base, lines: [{ itemId: 'i1', quantity: '0' }] })).toEqual([
      'Line 1: the quantity must be more than zero.',
    ]);
  });

  it('a batch item must name the batch it moves', () => {
    expect(validateTransferForm({ ...base, lines: [{ itemId: 'i1', quantity: '2', tracksBatch: true, batchNo: 'B12' }] })).toEqual([]);
    expect(validateTransferForm({ ...base, lines: [{ itemId: 'i1', quantity: '2', tracksBatch: true }] })).toEqual([
      'Line 1: name the batch to move.',
    ]);
  });

  it('the payload keeps item, quantity and the batch facts that are filled, as numbers', () => {
    expect(buildTransferPayload({ ...base, note: '  shifting  ', lines: [
      { itemId: 'i1', quantity: '2.5', batchNo: ' B12 ', expDate: '2027-01-31' },
      { itemId: '', quantity: '3' },
      { itemId: 'i2', quantity: '' },
    ] })).toEqual({
      transferDate: '2026-11-17',
      fromGodownId: 'g1',
      toGodownId: 'g2',
      note: 'shifting',
      lines: [{ itemId: 'i1', quantity: 2.5, batchNo: 'B12', expDate: '2027-01-31' }],
    });
  });

  it('a transfer row reads as `qty × item (batch n)`', () => {
    const items = [{ id: 'i1', name: 'Pencil' }];
    expect(transferLineSummary([
      { itemId: 'i1', quantity: 2, batchNo: 'B12' },
      { itemId: 'zz', quantity: 1 },
    ], items)).toBe('2 × Pencil (batch B12), 1 × Item');
  });
});

describe('bill of materials preview', () => {
  const items = [
    { id: 'c1', name: 'Frame', purchasePrice: 100 },
    { id: 'c2', name: 'Wheel', purchasePrice: 50.5 },
  ];
  it('one unit costs the components at their purchase price, scrap included', () => {
    const p = bomPreview([
      { componentItemId: 'c1', quantity: 1, scrapPercent: 10 },
      { componentItemId: 'c2', quantity: 2 },
    ], items);
    expect(p.rows).toEqual([
      { componentItemId: 'c1', quantity: 1, scrapPercent: 10, name: 'Frame', need: 1.1, cost: 110 },
      { componentItemId: 'c2', quantity: 2, name: 'Wheel', need: 2, cost: 101 },
    ]);
    expect(p.unitCost).toBe(211);
  });
  it('incomplete lines stay out of the cost', () => {
    expect(bomPreview([{ componentItemId: '', quantity: 3 }], items).unitCost).toBe(0);
  });
});

describe('assemble form and batch choices', () => {
  it('the empty assemble form names what is missing; the API owns the stock check', () => {
    expect(validateAssembleForm({ runDate: '2026-11-17', itemId: 'i1', quantity: '2' })).toEqual([]);
    expect(validateAssembleForm({ runDate: '', itemId: '', quantity: '' })).toEqual([
      'Choose a date.',
      'Pick the item to make.',
      'The quantity must be more than zero.',
    ]);
  });

  it('an item tracks batches on the flag or its opening lots', () => {
    expect(itemTracksBatches({ extra: { trackBatch: true } })).toBe(true);
    expect(itemTracksBatches({ extra: { batches: [{ batchNo: 'B1', qty: 5 }] } })).toBe(true);
    expect(itemTracksBatches({ extra: {} })).toBe(false);
    expect(itemTracksBatches(null)).toBe(false);
  });

  it('the from-godown lots become batch choices, first-expiry fact riding along', () => {
    expect(batchOptionsFromLots({
      batches: [
        { batchNo: 'B2', qty: 4, expDate: '2027-03-01' },
        { batchNo: 'B1', qty: 2, expDate: '' },
      ],
    })).toEqual([
      { batchNo: 'B2', expDate: '2027-03-01', qty: 4, label: 'B2 · 4 left · exp 2027-03-01' },
      { batchNo: 'B1', expDate: '', qty: 2, label: 'B1 · 2 left' },
    ]);
    expect(batchOptionsFromLots(null)).toEqual([]);
  });
});
