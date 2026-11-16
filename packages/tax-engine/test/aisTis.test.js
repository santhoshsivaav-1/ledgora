// R2.2: AIS / TIS import and reconciliation. The importer reads by column name and says what it understood; a file it
// can not read is an error, never an empty success.
import { describe, expect, it } from 'vitest';
import {
  aisCategoryOf,
  formatFingerprint,
  parseAis,
  parseAisCsv,
  parseAisJson,
  reconcileAis,
} from '../src/index.ts';

const CSV = `Annual Information Statement,,,,
Name: TEST PERSON,PAN: ABCPK1234F,,,
Information Category,Information Source,TAN/PAN,Reported Value,Processed Value,Tax Deducted,Section
"Interest from savings bank","HDFC BANK LTD, CHENNAI",CHEH12345A,"12,500",12500,0,
Interest from time deposit,SBI,MUMS12345B,50000,50000,0,
Dividend,ACME LTD,DELA12345C,3000,3000,0,
TDS - payment to contractors,ACME CONTRACTORS PVT LTD,CHEA12345B,"5,00,000","5,00,000",10000,194C
TDS - fees for professional services,BIG CLIENT LTD,BLRB12345C,200000,200000,20000,194J(b)
TDS - interest other than on securities,SBI,MUMS12345B,50000,50000,5000,194A
GST turnover (GSTR-3B),33ABCPK1234F1Z5,,6000000,6000000,0,
Total,,,6265500,,35000,
`;

describe('the CSV importer', () => {
  const p = parseAisCsv(CSV);
  it('finds the heading line below the notes and reads every data row', () => {
    expect(p.errors).toEqual([]);
    expect(p.rows).toHaveLength(7);
    expect(p.mapping).toMatchObject({
      description: 'Information Category',
      source: 'Information Source',
      reported: 'Reported Value',
      accepted: 'Processed Value',
      tds: 'Tax Deducted',
    });
  });
  it('skips the total line and the notes above the heading', () => {
    expect(p.skipped).toBeGreaterThanOrEqual(4);
    expect(p.rows.some((r) => /total/i.test(r.description))).toBe(false);
  });
  it('reads quoted names with commas and Indian digit grouping', () => {
    expect(p.rows[0]).toMatchObject({
      source: 'HDFC BANK LTD, CHENNAI',
      reported: 12500,
      sourceId: 'CHEH12345A',
    });
    expect(p.rows[3]).toMatchObject({ reported: 500000, tds: 10000, section: '194C' });
  });
  it('sorts lines into categories, and a line with tax is TDS even when it describes interest', () => {
    expect(p.rows.map((r) => r.category)).toEqual([
      'interest_savings',
      'interest_deposits',
      'dividend',
      'tds',
      'tds',
      'tds',
      'gst_turnover',
    ]);
  });
  it('a byte-order mark and CRLF line ends do not matter', () => {
    expect(parseAisCsv(`\uFEFF${CSV.replace(/\n/g, '\r\n')}`).rows).toHaveLength(7);
  });
  it('other spellings of the same columns are found', () => {
    const q = parseAisCsv(
      'Description,Name of Deductor,Amount Paid,Tax Deducted at Source,Section\nPayment to contractor,ACME,100000,2000,194C',
    );
    expect(q.rows[0]).toMatchObject({
      description: 'Payment to contractor',
      source: 'ACME',
      reported: 100000,
      tds: 2000,
      category: 'tds',
    });
  });
});

describe('a file that can not be read is an error', () => {
  it('no recognisable columns', () => {
    const p = parseAisCsv('a,b,c\n1,2,3');
    expect(p.rows).toEqual([]);
    expect(p.errors[0]).toMatch(/Could not find the columns/);
  });
  it('columns but no amounts', () => {
    expect(parseAisCsv('Information Category,Reported Value\nSomething,').errors[0]).toMatch(
      /no row has an amount/,
    );
  });
  it('JSON that is not JSON, and JSON with no records', () => {
    expect(parseAisJson('{oops').errors[0]).toMatch(/not a JSON/);
    expect(parseAisJson('{"a":[1,2,3],"b":{"c":"d"}}').errors[0]).toMatch(/No records/);
  });
  it('an empty file', () => {
    expect(parseAis('').errors.length).toBe(1);
  });
});

describe('the JSON importer', () => {
  const doc = {
    AIS: {
      partB: {
        tdsTcsInformation: [
          {
            informationDescription: 'TDS 194C',
            sourceName: 'ACME CONTRACTORS',
            tanPan: 'CHEA12345B',
            reportedValue: '5,00,000',
            taxDeducted: 10000,
            section: '194C',
          },
        ],
      },
      sftInformation: {
        interest: [
          {
            description: 'Interest from savings bank',
            informationSource: 'HDFC',
            amountReported: 12500,
          },
          { description: 'Empty', amountReported: 0 },
        ],
      },
    },
  };
  it('finds records wherever they are nested', () => {
    const p = parseAisJson(JSON.stringify(doc));
    expect(p.errors).toEqual([]);
    expect(p.rows.map((r) => [r.category, r.reported, r.tds])).toEqual([
      ['tds', 500000, 10000],
      ['interest_savings', 12500, 0],
    ]);
    expect(p.skipped).toBe(1);
    expect(p.rows[1].description).toBe('interest · Interest from savings bank'); // the parent key becomes part of the label
  });
  it('parseAis picks the reader by the first character', () => {
    expect(parseAis(JSON.stringify(doc)).rows).toHaveLength(2);
    expect(parseAis(CSV).rows).toHaveLength(7);
  });
});

describe('categories', () => {
  it.each([
    ['Interest from savings bank (SFT-016)', false, '', 'interest_savings'],
    ['Interest from time deposit', false, '', 'interest_deposits'],
    ['Dividend income', false, '', 'dividend'],
    ['Rent received', false, '', 'rent'],
    ['Purchase of mutual fund units', false, '', 'securities'],
    ['Sale of equity shares', false, '', 'securities'],
    ['Registrar of property: sale of immovable property', false, '', 'property'],
    ['Foreign remittance (LRS)', false, '', 'foreign'],
    ['Interest on income-tax refund', false, '', 'refund_interest'],
    ['Salary', true, '192', 'salary'],
    ['Payment to contractors', true, '194C', 'tds'],
    ['Interest on deposit with bank', true, '194A', 'tds'],
    ['Tax collected at source on sale of goods', true, '206C(1H)', 'tcs'],
    ['Something nobody has heard of', false, '', 'other'],
  ])('%s → %s', (text, tax, section, want) => {
    expect(aisCategoryOf(text, tax, section)).toBe(want);
  });
});

describe('reconciliation with the books', () => {
  const rows = parseAisCsv(CSV).rows;
  const books = {
    gstTurnover: 6_000_000,
    declaredReceipts: 6_000_000,
    interestSavings: 12_500,
    interestDeposits: 50_000,
    dividend: 3_000,
    tds: [
      { deductor: 'Acme Contractors Pvt. Ltd.', tan: 'CHEA12345B', tds: 10_000 },
      { deductor: 'Big Client Limited', tan: 'BLRB12345C', tds: 20_000 },
      { deductor: 'SBI', tan: 'MUMS12345B', tds: 5_000 },
    ],
  };
  it('everything agrees: no warnings, every income line matches', () => {
    const r = reconcileAis(rows, books);
    expect(r.issues).toEqual([]);
    expect(r.lines.every((l) => l.status === 'matches')).toBe(true);
    expect(r.tds.rows.every((x) => x.status === 'matched')).toBe(true);
  });
  it('interest in AIS that is not in the books is a warning with what to do', () => {
    const r = reconcileAis(rows, { ...books, interestDeposits: 0 });
    const line = r.lines.find((l) => l.category === 'interest_deposits');
    expect(line).toMatchObject({ status: 'only_ais', ais: 50_000, books: 0 });
    expect(r.issues.map((i) => i.code)).toContain('AIS_INTEREST_DEPOSITS');
    expect(r.feedback.some((f) => /not in your books/i.test(f.why))).toBe(true);
  });
  it('TDS in the books that AIS does not show must not be claimed; TDS in AIS the books lack can be', () => {
    const r = reconcileAis(rows, {
      ...books,
      tds: [...books.tds.slice(0, 2), { deductor: 'Ghost Co', tan: 'DELG12345D', tds: 7_000 }],
    });
    const codes = r.issues.map((i) => i.code);
    expect(codes).toContain('AIS_TDS_MISSING');
    expect(codes).toContain('AIS_TDS_UNRECORDED');
  });
  it('declared receipts below the GST turnover are flagged', () => {
    expect(
      reconcileAis(rows, { ...books, declaredReceipts: 4_000_000 }).issues.map((i) => i.code),
    ).toContain('AIS_RECEIPTS_BELOW_GST');
  });
  it('GST turnover in the books higher than the GST returns is "books higher", not a warning', () => {
    const r = reconcileAis(rows, { ...books, gstTurnover: 7_000_000 });
    expect(r.lines.find((l) => l.category === 'gst_turnover').status).toBe('books_higher');
  });
  it('rent, securities, property and foreign remittances warn that ITR-4 may not apply', () => {
    const more = [
      ...rows,
      ...parseAisCsv(
        'Information Category,Reported Value\nRent received from tenants,120000\nSale of equity shares,300000\nForeign remittance (LRS),500000',
      ).rows,
    ];
    const codes = reconcileAis(more, books).issues.map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['AIS_RENT', 'AIS_SECURITIES', 'AIS_FOREIGN']));
  });
  it('a row that appears twice is offered for "duplicate" feedback', () => {
    const dup = [...rows, rows[0]];
    expect(reconcileAis(dup, books).feedback.filter((f) => /duplicate/.test(f.why)).length).toBe(2);
  });
  it('the accepted value is used when the taxpayer has changed it', () => {
    const changed = rows.map((r) => (r.category === 'dividend' ? { ...r, accepted: 1000 } : r));
    expect(reconcileAis(changed, books).lines.find((l) => l.category === 'dividend')).toMatchObject(
      { ais: 1000, status: 'books_higher' },
    );
  });
});

describe('formatFingerprint shares headings only', () => {
  it('takes a CSV heading row, not a title above it or any values', () => {
    const f = formatFingerprint(
      'AIS for RAVI KUMAR\nCategory,Source,Reported Value\nInterest,HDFC BANK,12500\n',
    );
    expect(f).toEqual({ type: 'csv', columns: ['Category', 'Source', 'Reported Value'] });
  });
  it('drops anything that looks like a value, and reads JSON key names only', () => {
    expect(formatFingerprint('PAN ABCPK1234F,Amount\n').columns).toEqual(['Amount']);
    const j = formatFingerprint('{"aisData":[{"infoCategory":"x","amount":5,"9876543210":1}]}');
    expect(j).toEqual({ type: 'json', columns: ['aisData', 'infoCategory', 'amount'] });
    expect(formatFingerprint('not a file {')).toMatchObject({ type: 'csv' });
    expect(formatFingerprint('{bad json')).toEqual({ type: 'unknown', columns: [] });
  });
});
