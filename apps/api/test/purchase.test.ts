import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeHarness, type Tenant } from './helpers.ts';

// Vyapar parity Phase 3: purchase bills, Payment Out, purchase orders, debit notes, expenses and other income
// (docs/VYAPAR_IMPLEMENTATION_PHASES.md, "Phase 3 test plan", API layer).
const h = makeHarness();
let t: Tenant;
let other: Tenant;

const supplier = async (who: Tenant, name = `S ${Math.random()}`) => {
  const res = await who.call('POST', '/v1/parties', { name, state: 'Karnataka' });
  expect(res.status, res.text).toBe(201);
  return res.body.id as string;
};
const item = async (who: Tenant, name = `I ${Math.random()}`) =>
  (await who.call('POST', '/v1/items', { name })).body.id as string;
const stockOf = async (who: Tenant, id: string) =>
  (await who.call('GET', `/v1/items/${id}`)).body.stock as number;
const bill = (who: Tenant, body: Record<string, unknown>) =>
  who.call('POST', '/v1/purchases', {
    businessId: who.businessId,
    purchaseDate: '2026-11-05',
    invoiceNumber: `B-${Math.random().toString(36).slice(2, 8)}`,
    items: [{ name: 'Pen', quantity: 100, rate: 10, taxPercent: 18 }],
    ...body,
  });
const payOut = (who: Tenant, body: Record<string, unknown>) =>
  who.call('POST', '/v1/payments', {
    businessId: who.businessId,
    direction: 'out',
    paymentDate: '2026-11-06',
    mode: 'bank',
    ...body,
  });

beforeAll(async () => {
  t = await h.newTenant();
  other = await h.newTenant();
});
afterAll(() => h.close());

describe('P3-S1 purchase bill upgrades', () => {
  it('numbers bills PUR-n, splits ITC by line flag, and stocks in at landed cost', async () => {
    const s = await supplier(t);
    const pen = await item(t);
    const car = await item(t);
    const res = await bill(t, {
      supplierId: s,
      items: [
        { itemId: pen, name: 'Pen', quantity: 100, rate: 10, taxPercent: 18 },
        {
          itemId: car,
          name: 'Car',
          quantity: 1,
          rate: 1000,
          taxPercent: 28,
          itcStatus: 'ineligible_17_5',
        },
      ],
      charges: [{ name: 'Freight', amount: 200, gstRate: 18 }],
    });
    expect(res.status, res.text).toBe(201);
    expect(res.body.number).toMatch(/^PUR-\d+$/);
    expect(res.body.supplierName).toMatch(/^S /);
    // Taxable 1000 + 1000 + charges 200; tax 180 + 280 + 36.
    expect(res.body).toMatchObject({ taxableAmount: 2200, cgst: 248, sgst: 248, total: 2696 });
    expect(res.body.itc.eligible).toEqual({ igst: 0, cgst: 108, sgst: 108, cess: 0 });
    expect(res.body.itc.ineligible).toEqual({ igst: 0, cgst: 140, sgst: 140, cess: 0 });
    // Freight split by value 100/100; the car's lost credit (280) is part of its cost.
    expect(res.body.items.map((l: any) => l.landedCost)).toEqual([11, 1380]);
    expect(await stockOf(t, pen)).toBe(100);
    const got = (await t.call('GET', `/v1/purchases/${res.body.id}`)).body;
    expect(got.items[1].itcStatus).toBe('ineligible_17_5');
    expect(got.charges[0].name).toBe('Freight');
  });

  it('records RCM and §194Q TDS; what we owe is the total less the TDS', async () => {
    const s = await supplier(t);
    const res = await bill(t, {
      supplierId: s,
      reverseCharge: true,
      placeOfSupply: 'Karnataka',
      tds194QPercent: 0.1,
      items: [{ name: 'Steel', quantity: 1, rate: 100000, taxPercent: 18 }],
    });
    expect(res.status, res.text).toBe(201);
    expect(res.body).toMatchObject({
      reverseCharge: true,
      placeOfSupply: 'Karnataka',
      total: 118000,
      tdsAmount: 100,
    });
    const st = (await t.call('GET', `/v1/suppliers/${s}/statement`)).body;
    expect(st).toEqual({ documents: 117900, settled: 0, returns: 0, balance: 117900 });
  });

  it('pays at the time of purchase: rows become Payment Out vouchers allocated to the bill', async () => {
    const s = await supplier(t);
    const res = await bill(t, {
      supplierId: s,
      items: [{ name: 'Ink', quantity: 1, rate: 1000, taxPercent: 0 }],
      payments: [
        { mode: 'cash', amount: 400 },
        { mode: 'upi', amount: 600, reference: 'UTR1' },
      ],
    });
    expect(res.status, res.text).toBe(201);
    expect(res.body).toMatchObject({ paidAmount: 1000, paymentStatus: 'Paid' });
    const outs = (await t.call('GET', `/v1/payments?partyId=${s}&direction=out`)).body.data;
    expect(outs.map((p: any) => p.source)).toEqual(['purchase_inline', 'purchase_inline']);
    expect(outs[0].allocations[0]).toEqual({ purchaseId: res.body.id, amount: expect.any(Number) });
    // Over-paying is refused.
    const over = await bill(t, {
      supplierId: s,
      items: [{ name: 'Ink', quantity: 1, rate: 100, taxPercent: 0 }],
      payments: [{ mode: 'cash', amount: 101 }],
    });
    expect(over.status).toBe(422);
    expect(over.body.error.code).toBe('over_allocated');
  });

  it('warns on a repeated supplier bill number in the same FY and saves it once confirmed (use case 4)', async () => {
    const s = await supplier(t);
    const first = await bill(t, { supplierId: s, invoiceNumber: 'OM/221' });
    expect(first.status).toBe(201);
    const check = await t.call(
      'GET',
      `/v1/purchases/duplicate-check?supplierId=${s}&billNo=om-221&date=2026-12-01`,
    );
    expect(check.body.duplicate.id).toBe(first.body.id);
    const again = await bill(t, { supplierId: s, invoiceNumber: 'OM-221' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('duplicate_bill');
    expect(again.body.error.details.id).toBe(first.body.id);
    const forced = await bill(t, { supplierId: s, invoiceNumber: 'OM-221', allowDuplicate: true });
    expect(forced.status).toBe(201);
    expect(forced.body.duplicateOf).toBe(first.body.id);
    // Next financial year the supplier's series restarts: no warning.
    expect(
      (await bill(t, { supplierId: s, invoiceNumber: 'OM/221', purchaseDate: '2027-04-02' }))
        .status,
    ).toBe(201);
  });

  it('old-style bodies still work and read as eligible (acceptance 3)', async () => {
    const res = await t.call('POST', '/v1/purchases', {
      businessId: t.businessId,
      supplierName: 'Walk-in',
      purchaseDate: '2026-10-01',
      items: [{ name: 'Thing', quantity: 10, rate: 50, taxPercent: 12 }],
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      taxableAmount: 500,
      cgst: 30,
      sgst: 30,
      total: 560,
      docType: 'bill',
    });
    expect(res.body.items[0].itcStatus).toBe('eligible');
    expect(res.body.itc.ineligible).toEqual({ igst: 0, cgst: 0, sgst: 0, cess: 0 });
  });
});

describe('P3-S2 Payment Out', () => {
  it('allocates oldest bill first with TDS deducted by us, numbered PAY-n; mirrored on the statement', async () => {
    const s = await supplier(t);
    const older = (
      await bill(t, {
        supplierId: s,
        purchaseDate: '2026-11-01',
        items: [{ name: 'A', quantity: 1, rate: 3000, taxPercent: 0 }],
      })
    ).body;
    const newer = (
      await bill(t, {
        supplierId: s,
        purchaseDate: '2026-11-04',
        items: [{ name: 'B', quantity: 1, rate: 1500, taxPercent: 0 }],
      })
    ).body;
    const res = await payOut(t, {
      partyId: s,
      amount: 4455,
      tdsAmount: 45,
      tdsSection: '194C',
      autoAllocate: true,
    });
    expect(res.status, res.text).toBe(201);
    expect(res.body).toMatchObject({
      direction: 'out',
      source: 'payment',
      tdsSection: '194C',
      unallocated: 0,
    });
    expect(res.body.number).toMatch(/^PAY-\d+$/);
    expect(res.body.allocations).toEqual([
      { purchaseId: older.id, amount: 3000 },
      { purchaseId: newer.id, amount: 1500 },
    ]);
    expect((await t.call('GET', `/v1/purchases/${newer.id}`)).body.paymentStatus).toBe('Paid');
    expect((await t.call('GET', `/v1/suppliers/${s}/statement`)).body.balance).toBe(0);

    // Deleting the payment reverses its allocations and its TDS (acceptance 3).
    expect((await t.call('DELETE', `/v1/payments/${res.body.id}`)).status).toBe(200);
    expect((await t.call('GET', `/v1/purchases/${older.id}`)).body).toMatchObject({
      paidAmount: 0,
      paymentStatus: 'Unpaid',
    });
    expect((await t.call('GET', `/v1/suppliers/${s}/statement`)).body.balance).toBe(4500);
  });

  it('manual allocation, editing re-settles both bills, and the wrong direction is refused', async () => {
    const s = await supplier(t);
    const a = (
      await bill(t, {
        supplierId: s,
        items: [{ name: 'A', quantity: 1, rate: 1000, taxPercent: 0 }],
      })
    ).body;
    const b = (
      await bill(t, {
        supplierId: s,
        items: [{ name: 'B', quantity: 1, rate: 1000, taxPercent: 0 }],
      })
    ).body;
    const p = (
      await payOut(t, { partyId: s, amount: 600, allocations: [{ purchaseId: a.id, amount: 600 }] })
    ).body;
    const edited = await t.call('PUT', `/v1/payments/${p.id}`, {
      businessId: t.businessId,
      partyId: s,
      direction: 'out',
      paymentDate: '2026-11-06',
      mode: 'bank',
      amount: 600,
      allocations: [{ purchaseId: b.id, amount: 600 }],
    });
    expect(edited.status, edited.text).toBe(200);
    expect((await t.call('GET', `/v1/purchases/${a.id}`)).body.paidAmount).toBe(0);
    expect((await t.call('GET', `/v1/purchases/${b.id}`)).body.paidAmount).toBe(600);
    // More than is pending, an invoice on a payment out, a bill on a payment in, a direction flip: all refused.
    expect(
      (
        await payOut(t, {
          partyId: s,
          amount: 2000,
          allocations: [{ purchaseId: a.id, amount: 1001 }],
        })
      ).status,
    ).toBe(422);
    const sale = (
      await t.call('POST', '/v1/invoices', {
        businessId: t.businessId,
        partyId: s,
        invoiceDate: '2026-11-05',
        items: [{ name: 'X', quantity: 1, rate: 100, taxPercent: 0 }],
      })
    ).body;
    expect(
      (
        await payOut(t, {
          partyId: s,
          amount: 100,
          allocations: [{ invoiceId: sale.id, amount: 100 }],
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await t.call('POST', '/v1/payments', {
          businessId: t.businessId,
          partyId: s,
          paymentDate: '2026-11-06',
          amount: 100,
          allocations: [{ purchaseId: a.id, amount: 100 }],
        })
      ).status,
    ).toBe(422);
    const flip = await t.call('PUT', `/v1/payments/${p.id}`, {
      businessId: t.businessId,
      partyId: s,
      paymentDate: '2026-11-06',
      amount: 600,
    });
    expect(flip.status).toBe(422);
  });

  it('does not apply the §269ST cash-received limit to cash paid out; a TDS section is only for payments out', async () => {
    const s = await supplier(t);
    expect((await payOut(t, { partyId: s, amount: 250000, mode: 'cash' })).status).toBe(201);
    const bad = await t.call('POST', '/v1/payments', {
      businessId: t.businessId,
      partyId: s,
      paymentDate: '2026-11-06',
      amount: 10,
      tdsSection: '194C',
    });
    expect(bad.status).toBe(422);
  });
});

describe('P3-S3 purchase orders', () => {
  it('has no stock effect; converts partially, applies the advance, refuses over-conversion', async () => {
    const s = await supplier(t);
    const pen = await item(t);
    const po = await t.call('POST', '/v1/purchase-orders', {
      businessId: t.businessId,
      supplierId: s,
      orderDate: '2026-11-01',
      expectedDate: '2026-11-10',
      items: [{ itemId: pen, name: 'Pen', quantity: 100, rate: 10, taxPercent: 0 }],
      advance: { mode: 'bank', amount: 300 },
    });
    expect(po.status, po.text).toBe(201);
    expect(po.body).toMatchObject({
      status: 'open',
      total: 1000,
      advance: 300,
      pendingValue: 1000,
    });
    expect(po.body.number).toMatch(/^PO-\d+$/);
    expect(await stockOf(t, pen)).toBe(0); // acceptance 1: no stock effect

    const conv = await t.call('POST', `/v1/purchase-orders/${po.body.id}/convert`, {
      purchaseDate: '2026-11-08',
      invoiceNumber: 'SUP-77',
      lines: [{ itemId: pen, name: 'Pen', quantity: 60 }],
    });
    expect(conv.status, conv.text).toBe(201);
    expect(conv.body).toMatchObject({
      poId: po.body.id,
      total: 600,
      paidAmount: 300,
      paymentStatus: 'Partial',
    });
    expect(await stockOf(t, pen)).toBe(60);
    const after = (await t.call('GET', `/v1/purchase-orders/${po.body.id}`)).body;
    expect(after).toMatchObject({ status: 'partial', pendingValue: 400 });
    expect(after.items[0]).toMatchObject({ receivedQty: 60, pendingQty: 40 });

    const over = await t.call('POST', `/v1/purchase-orders/${po.body.id}/convert`, {
      purchaseDate: '2026-11-09',
      lines: [{ itemId: pen, name: 'Pen', quantity: 41 }],
    });
    expect(over.status).toBe(422);
    expect(over.body.error.code).toBe('over_conversion');
    const rest = await t.call('POST', `/v1/purchase-orders/${po.body.id}/convert`, {
      purchaseDate: '2026-11-09',
      lines: [{ itemId: pen, name: 'Pen', quantity: 40 }],
    });
    expect(rest.status, rest.text).toBe(201);
    expect((await t.call('GET', `/v1/purchase-orders/${po.body.id}`)).body.status).toBe('received');
    expect(
      (await t.call('GET', '/v1/purchase-orders?status=received')).body.data.map((o: any) => o.id),
    ).toContain(po.body.id);
    // Something was received: it can be cancelled, not deleted.
    expect((await t.call('DELETE', `/v1/purchase-orders/${po.body.id}`)).status).toBe(409);
  });

  it('cancel stops conversion and keeps the advance with the supplier', async () => {
    const s = await supplier(t);
    const po = (
      await t.call('POST', '/v1/purchase-orders', {
        businessId: t.businessId,
        supplierId: s,
        orderDate: '2026-11-01',
        items: [{ name: 'Glue', quantity: 5, rate: 20, taxPercent: 0 }],
        advance: { mode: 'cash', amount: 50 },
      })
    ).body;
    expect((await t.call('POST', `/v1/purchase-orders/${po.id}/cancel`)).body.status).toBe(
      'cancelled',
    );
    expect(
      (
        await t.call('POST', `/v1/purchase-orders/${po.id}/convert`, {
          purchaseDate: '2026-11-02',
          lines: [{ name: 'Glue', quantity: 1 }],
        })
      ).status,
    ).toBe(422);
    const adv = (await t.call('GET', `/v1/payments?partyId=${s}&direction=out`)).body.data[0];
    expect(adv).toMatchObject({ source: 'po_advance', amount: 50, unallocated: 50 });
  });
});

describe('P3-S4 debit notes', () => {
  it('returns goods: stock out, payable down, cannot return more than is left (acceptance 2)', async () => {
    const s = await supplier(t);
    const pen = await item(t);
    const b = (
      await bill(t, {
        supplierId: s,
        items: [{ itemId: pen, name: 'Pen', quantity: 100, rate: 6, taxPercent: 18 }],
      })
    ).body;
    const note = (qty: number, extra = {}) =>
      t.call('POST', '/v1/purchases', {
        businessId: t.businessId,
        docType: 'debit-note',
        supplierId: s,
        purchaseDate: '2026-11-06',
        againstPurchaseId: b.id,
        returnReason: 'purchase-return',
        items: [{ itemId: pen, name: 'Pen', quantity: qty, rate: 6, taxPercent: 18 }],
        ...extra,
      });
    const dn = await note(10);
    expect(dn.status, dn.text).toBe(201);
    expect(dn.body).toMatchObject({
      docType: 'debit-note',
      taxableAmount: 60,
      cgst: 5.4,
      sgst: 5.4,
      total: 70.8,
    });
    expect(dn.body.number).toMatch(/^DN-\d+$/);
    expect(await stockOf(t, pen)).toBe(90);
    const left = (await t.call('GET', `/v1/purchases/${b.id}/returnable`)).body.lines[0];
    expect(left).toMatchObject({ billed: 100, returned: 10, returnable: 90 });
    const over = await note(91);
    expect(over.status).toBe(422);
    expect(over.body.error.code).toBe('over_return');
    // Supplier statement = bills − payments − returns (phase acceptance 3).
    expect((await t.call('GET', `/v1/suppliers/${s}/statement`)).body).toEqual({
      documents: 708,
      settled: 0,
      returns: 70.8,
      balance: 637.2,
    });
    // Paying the rest of the bill settles it: the adjusted debit note lowered what was due.
    await payOut(t, {
      partyId: s,
      amount: 637.2,
      allocations: [{ purchaseId: b.id, amount: 637.2 }],
    });
    expect((await t.call('GET', `/v1/purchases/${b.id}`)).body.paymentStatus).toBe('Paid');
  });

  it('a rate difference moves no stock; a cash refund is money coming back; a reason is required', async () => {
    const s = await supplier(t);
    const pen = await item(t);
    const b = (
      await bill(t, {
        supplierId: s,
        items: [{ itemId: pen, name: 'Pen', quantity: 10, rate: 100, taxPercent: 0 }],
      })
    ).body;
    const base = {
      businessId: t.businessId,
      docType: 'debit-note',
      supplierId: s,
      purchaseDate: '2026-11-07',
      againstPurchaseId: b.id,
    };
    expect(
      (
        await t.call('POST', '/v1/purchases', {
          ...base,
          items: [{ name: 'Rate diff', quantity: 1, rate: 50, taxPercent: 0 }],
        })
      ).status,
    ).toBe(400);
    const rd = await t.call('POST', '/v1/purchases', {
      ...base,
      returnReason: 'rate-difference',
      refundMode: 'cash',
      items: [{ name: 'Rate diff', quantity: 1, rate: 50, taxPercent: 0 }],
    });
    expect(rd.status, rd.text).toBe(201);
    expect(await stockOf(t, pen)).toBe(10);
    const refund = (await t.call('GET', `/v1/payments?partyId=${s}`)).body.data.find(
      (p: any) => p.source === 'debit_note_refund',
    );
    expect(refund).toMatchObject({ direction: 'in', amount: 50, mode: 'cash' });
    // The supplier paid the 50 back: the statement still owes the full bill.
    expect((await t.call('GET', `/v1/suppliers/${s}/statement`)).body.balance).toBe(1000);
    // Trashing the note takes its refund with it.
    await t.call('DELETE', `/v1/purchases/${rd.body.id}`);
    expect(
      (await t.call('GET', `/v1/payments?partyId=${s}`)).body.data.some(
        (p: any) => p.source === 'debit_note_refund',
      ),
    ).toBe(false);
  });
});

describe('P3-S5 / P3-S6 expenses and other income', () => {
  it('itemised expense: EXP-n, GST from the lines, ITC flag, payee and category kind checked', async () => {
    const payee = await supplier(t, 'Landlord');
    const cats = (await t.call('GET', '/v1/expense-categories?kind=expense')).body.data;
    const res = await t.call('POST', '/v1/expenses', {
      businessId: t.businessId,
      expenseDate: '2026-11-06',
      categoryId: cats[0].id,
      payeePartyId: payee,
      amount: 1,
      itcEligible: true,
      items: [{ name: 'Office rent', sac: '9972', quantity: 1, rate: 25000, gstRate: 18 }],
      paidAmount: 20000,
    });
    expect(res.status, res.text).toBe(201);
    expect(res.body).toMatchObject({
      kind: 'expense',
      amount: 25000,
      taxAmount: 4500,
      total: 29500,
      paidAmount: 20000,
      itcEligible: true,
    });
    expect(res.body.number).toMatch(/^EXP-\d+$/);
    const incomeCat = (await t.call('GET', '/v1/expense-categories?kind=income')).body.data[0];
    expect(
      (
        await t.call('POST', '/v1/expenses', {
          businessId: t.businessId,
          expenseDate: '2026-11-06',
          categoryId: incomeCat.id,
          amount: 10,
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await t.call('POST', '/v1/expenses', {
          businessId: t.businessId,
          expenseDate: '2026-11-06',
          amount: 10,
          paidAmount: 11,
        })
      ).status,
    ).toBe(422);
  });

  it('categories form a tree; expense items keep SAC and rate', async () => {
    const parent = (
      await t.call('POST', '/v1/expense-categories', { name: 'Utilities P3', kind: 'indirect' })
    ).body;
    const child = await t.call('POST', '/v1/expense-categories', {
      name: 'Electricity P3',
      parentId: parent.id,
    });
    expect(child.status).toBe(201);
    expect(child.body).toMatchObject({ parentId: parent.id, kind: 'indirect', isSystem: false });
    const it1 = await t.call('POST', '/v1/expense-items', {
      name: 'Electricity',
      sac: '9969',
      defaultRate: 5000,
      gstRate: 18,
      defaultCategoryId: child.body.id,
    });
    expect(it1.status).toBe(201);
    expect((await t.call('GET', '/v1/expense-items')).body.data.map((i: any) => i.name)).toContain(
      'Electricity',
    );
  });

  it('other income: seeded income categories, INC-n, listed apart from expenses', async () => {
    const cats = (await t.call('GET', '/v1/expense-categories?kind=income')).body.data;
    expect(cats.map((c: any) => c.name)).toEqual([
      'Commission',
      'Discount received',
      'Interest received',
      'Misc',
      'Rent received',
    ]);
    expect(cats.every((c: any) => c.isSystem)).toBe(true);
    // Asking again does not seed twice.
    expect((await t.call('GET', '/v1/expense-categories?kind=income')).body.data).toHaveLength(5);
    const interest = cats.find((c: any) => c.name === 'Interest received');
    const inc = await t.call('POST', '/v1/expenses', {
      businessId: t.businessId,
      kind: 'income',
      expenseDate: '2026-11-06',
      categoryId: interest.id,
      amount: 1200,
      description: 'FD interest',
    });
    expect(inc.status, inc.text).toBe(201);
    expect(inc.body.number).toMatch(/^INC-\d+$/);
    const income = (await t.call('GET', '/v1/expenses?kind=income')).body.data;
    const spent = (await t.call('GET', '/v1/expenses?kind=expense')).body.data;
    expect(income.map((e: any) => e.id)).toEqual([inc.body.id]);
    expect(spent.some((e: any) => e.id === inc.body.id)).toBe(false);
    // Exempt income carries no GST.
    const ex = await t.call('POST', '/v1/expenses', {
      businessId: t.businessId,
      kind: 'income',
      expenseDate: '2026-11-06',
      amount: 500,
      taxAmount: 90,
      exempt: true,
    });
    expect(ex.body.taxAmount).toBe(0);
  });
});

describe('Phase 3 tenant isolation', () => {
  it('another organization can not see or touch purchase documents, orders, payments out or expense items', async () => {
    const s = await supplier(t);
    const b = (await bill(t, { supplierId: s })).body;
    const po = (
      await t.call('POST', '/v1/purchase-orders', {
        businessId: t.businessId,
        orderDate: '2026-11-01',
        items: [{ name: 'X', quantity: 1, rate: 1, taxPercent: 0 }],
      })
    ).body;
    const pay = (await payOut(t, { partyId: s, amount: 10 })).body;
    for (const path of [
      '/v1/purchases',
      '/v1/purchase-orders',
      '/v1/payments?direction=out',
      '/v1/expense-items',
      '/v1/expenses?kind=income',
    ]) {
      const res = await other.call('GET', path);
      expect(res.status, path).toBe(200);
      expect(res.body.data, path).toEqual([]);
    }
    expect((await other.call('GET', `/v1/purchases/${b.id}`)).status).toBe(404);
    expect((await other.call('GET', `/v1/purchases/${b.id}/returnable`)).status).toBe(404);
    expect((await other.call('GET', `/v1/purchase-orders/${po.id}`)).status).toBe(404);
    expect(
      (
        await other.call('POST', `/v1/purchase-orders/${po.id}/convert`, {
          purchaseDate: '2026-11-02',
          lines: [{ name: 'X', quantity: 1 }],
        })
      ).status,
    ).toBe(404);
    expect((await other.call('POST', `/v1/purchase-orders/${po.id}/cancel`)).status).toBe(404);
    expect((await other.call('GET', `/v1/payments/${pay.id}`)).status).toBe(404);
    expect((await other.call('GET', `/v1/suppliers/${s}/statement`)).status).toBe(404);
    // Nor point a document of its own at ours.
    const mine = await supplier(other);
    expect(
      (
        await payOut(other, {
          partyId: mine,
          amount: 10,
          allocations: [{ purchaseId: b.id, amount: 10 }],
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await other.call('POST', '/v1/purchases', {
          businessId: other.businessId,
          docType: 'debit-note',
          returnReason: 'purchase-return',
          purchaseDate: '2026-11-06',
          againstPurchaseId: b.id,
          items: [{ name: 'Pen', quantity: 1, rate: 10, taxPercent: 0 }],
        })
      ).status,
    ).toBe(404);
  });
});
