// R2.2 (docs/FEATURE_GAPS_2026-11.md): the Annual Information Statement (AIS) and Taxpayer Information Summary (TIS) the
// income-tax portal holds about a PAN, read from the file the person downloads, compared with the books and with the
// return, so the differences that bring notices are found before filing.
//
// The department publishes no file layout for AIS/TIS. So the importer never guesses silently: it finds the columns (CSV)
// or the records (JSON) it can recognise by their names, returns exactly what it understood and what it skipped, and the
// screen shows every row with its category before anything is saved. A file it can not read is an error, not an empty
// success. Treat the import as Beta until a real file of each kind has been read (docs/FEATURE_GAPS_2026-11.md, X3).

import type { FilingIssue } from './filing.ts';
import { compare26AS, deductorKey } from './tds26as.ts';

const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const n = (v: unknown) => Number(String(v ?? '').replace(/[,\s₹]/g, '')) || 0;
const issue = (
  severity: FilingIssue['severity'],
  code: string,
  message: string,
  path = '',
): FilingIssue => ({
  id: path ? `${code}:${path}` : code,
  severity,
  code,
  message,
  path,
});

export const AIS_CATEGORIES = [
  'tds',
  'tcs',
  'salary',
  'interest_savings',
  'interest_deposits',
  'dividend',
  'rent',
  'securities',
  'property',
  'gst_turnover',
  'foreign',
  'refund_interest',
  'other',
] as const;
export type AisCategory = (typeof AIS_CATEGORIES)[number];
export const AIS_CATEGORY_LABELS: Record<AisCategory, string> = {
  tds: 'TDS on payments to you',
  tcs: 'TCS collected from you',
  salary: 'Salary',
  interest_savings: 'Interest on savings accounts',
  interest_deposits: 'Interest on deposits',
  dividend: 'Dividend',
  rent: 'Rent received',
  securities: 'Shares and mutual funds',
  property: 'Immovable property',
  gst_turnover: 'GST turnover',
  foreign: 'Foreign remittances',
  refund_interest: 'Interest on income-tax refund',
  other: 'Other information',
};

export interface AisRow {
  category: AisCategory;
  /** The information as the file words it. */
  description: string;
  /** Who reported it (bank, deductor, GST portal) and their TAN, PAN or GSTIN when the file gives one. */
  source: string;
  sourceId: string;
  /** What the source reported, and what the department processed or the taxpayer accepted (0 when the file has none). */
  reported: number;
  accepted: number;
  /** Tax deducted or collected on it, and the section ('194C'). */
  tds: number;
  section: string;
}

/**
 * The category of a line of AIS, from its description, its TDS section and whether tax was deducted. A line that carries
 * tax or a TDS section is a TDS line first, whatever the income it relates to (the income itself is reported again in its
 * own line by the bank or company), so the tax credit is never lost to an income category.
 */
export function aisCategoryOf(description: string, hasTax = false, section = ''): AisCategory {
  const t = `${description} ${section}`.toLowerCase();
  if (/\btcs\b|206c|collected at source|tax collected/.test(t)) return 'tcs';
  if (/(^|[^0-9])192([^0-9a-z]|$)|\bsalary\b/.test(t) && !/interest|dividend/.test(t))
    return 'salary';
  if (
    hasTax ||
    /(^|[^0-9])19[0-9][a-z0-9()]*|\bsection\s*19\d|tax deducted at source|\btds\b/.test(t)
  )
    return 'tds';
  if (/refund/.test(t) && /interest/.test(t)) return 'refund_interest';
  if (/saving/.test(t) && /interest|sb/.test(t)) return 'interest_savings';
  if (
    /(time|fixed|term|recurring)\s*deposit|\bdeposit\b|\bfd\b|sft-016\(td\)/.test(t) &&
    /interest/.test(t)
  )
    return 'interest_deposits';
  if (/dividend/.test(t)) return 'dividend';
  if (/\brent\b/.test(t) && !/plant and machinery/.test(t)) return 'rent';
  if (
    /(securit|mutual fund|share|equity|unit|debenture|bond)/.test(t) &&
    /(sale|redemption|purchase|buy|transaction)/.test(t)
  )
    return 'securities';
  if (/immovable|property|registrar|sub-registrar/.test(t)) return 'property';
  if (/\bgst\b|gstr|turnover/.test(t)) return 'gst_turnover';
  if (/foreign|remittance|\blrs\b|forex|outward/.test(t)) return 'foreign';
  return 'other';
}

// ---- reading the file ----------------------------------------------------------------------------------------------

export interface AisParse {
  rows: AisRow[];
  /** What could not be read, in words a person can act on. */
  errors: string[];
  /** Lines or records the importer recognised as not being data (headings, totals). */
  skipped: number;
  /** Which column or key each field was read from, so the screen can show what the importer understood. */
  mapping: Partial<
    Record<
      'description' | 'source' | 'sourceId' | 'reported' | 'accepted' | 'tds' | 'section',
      string
    >
  >;
}

const norm = (s: string) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
const SYN: Record<keyof AisParse['mapping'], string[]> = {
  description: [
    'informationcategory',
    'informationdescription',
    'informationcode',
    'category',
    'description',
    'particulars',
    'natureofinformation',
    'infocategory',
    'information',
    'head',
    'transactiondescription',
  ],
  source: [
    'informationsource',
    'sourcename',
    'source',
    'nameofsource',
    'deductorname',
    'nameofdeductor',
    'nameofbank',
    'nameofthesource',
    'nameofdeductorcollector',
  ],
  sourceId: [
    'tanpan',
    'tanpansource',
    'sourceid',
    'tan',
    'pan',
    'tanofdeductor',
    'sourcetan',
    'tanpanofsource',
    'gstin',
    'sourceidentifier',
  ],
  reported: [
    'reportedvalue',
    'amountreported',
    'amountreportedbysource',
    'reportedamount',
    'amountpaidcredited',
    'amountpaid',
    'grossamount',
    'amount',
    'value',
  ],
  accepted: [
    'acceptedvalue',
    'amountaccepted',
    'amountacceptedbytaxpayer',
    'processedvalue',
    'systemprocessedvalue',
    'derivedvalue',
    'acceptedamount',
    'modifiedvalue',
  ],
  tds: ['taxdeducted', 'taxdeductedatsource', 'tdsamount', 'tds', 'taxcollected', 'tcs', 'tax'],
  section: ['section', 'sectioncode', 'tdssection'],
};
/** The first synonym (in priority order) that is among the headers. */
function pick(headers: string[], field: keyof typeof SYN) {
  const have = headers.map(norm);
  for (const s of SYN[field]) {
    const i = have.indexOf(s);
    if (i >= 0) return i;
  }
  return -1;
}

/** One CSV line into cells (quotes and doubled quotes). */
function csvCells(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function toRow(f: {
  description: string;
  source: string;
  sourceId: string;
  reported: unknown;
  accepted: unknown;
  tds: unknown;
  section: string;
}): AisRow {
  const tds = r2(n(f.tds));
  return {
    category: aisCategoryOf(f.description, tds > 0, f.section),
    description: f.description,
    source: f.source,
    sourceId: f.sourceId.toUpperCase(),
    reported: r2(n(f.reported)),
    accepted: r2(n(f.accepted)),
    tds,
    section: f.section.toUpperCase(),
  };
}

/** AIS or TIS as a CSV: finds the header line among the first lines, then one row per data line. */
export function parseAisCsv(text: string): AisParse {
  const lines = String(text ?? '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/);
  let headerAt = -1;
  let cols: Record<keyof typeof SYN, number> | null = null;
  for (let i = 0; i < Math.min(lines.length, 40); i += 1) {
    const h = csvCells(lines[i]!);
    const found = Object.fromEntries(
      (Object.keys(SYN) as (keyof typeof SYN)[]).map((k) => [k, pick(h, k)]),
    ) as Record<keyof typeof SYN, number>;
    if (found.description >= 0 && (found.reported >= 0 || found.accepted >= 0 || found.tds >= 0)) {
      headerAt = i;
      cols = found;
      break;
    }
  }
  if (!cols || headerAt < 0)
    return {
      rows: [],
      errors: [
        'Could not find the columns. The file needs a heading line with a description or category column and an amount column (for example “Information Category” and “Reported Value”). Open the file and check its first lines.',
      ],
      skipped: lines.length,
      mapping: {},
    };
  const headers = csvCells(lines[headerAt]!);
  const mapping: AisParse['mapping'] = {};
  for (const k of Object.keys(cols) as (keyof typeof SYN)[])
    if (cols[k] >= 0) mapping[k] = headers[cols[k]];
  const rows: AisRow[] = [];
  let skipped = headerAt + 1;
  for (const line of lines.slice(headerAt + 1)) {
    if (!line.trim()) continue;
    const c = csvCells(line);
    const cell = (k: keyof typeof SYN) => (cols![k] >= 0 ? (c[cols![k]] ?? '') : '');
    const description = cell('description');
    const amounts = [cell('reported'), cell('accepted'), cell('tds')].some((x) => n(x) !== 0);
    // A line with no amount at all is a heading or a note, a "Total" line is a sum of the rows above it.
    if (!description || !amounts || /^\s*(grand\s+)?total\b/i.test(description)) {
      skipped += 1;
      continue;
    }
    rows.push(
      toRow({
        description,
        source: cell('source'),
        sourceId: cell('sourceId'),
        reported: cell('reported'),
        accepted: cell('accepted'),
        tds: cell('tds'),
        section: cell('section'),
      }),
    );
  }
  return {
    rows,
    errors: rows.length ? [] : ['The columns were found but no row has an amount.'],
    skipped,
    mapping,
  };
}

/** AIS as the JSON the portal offers: finds every list of records that has a description and an amount, wherever it is nested. */
export function parseAisJson(text: string): AisParse {
  let doc: unknown;
  try {
    doc = JSON.parse(String(text ?? ''));
  } catch {
    return { rows: [], errors: ['This is not a JSON file'], skipped: 0, mapping: {} };
  }
  const rows: AisRow[] = [];
  const mapping: AisParse['mapping'] = {};
  let skipped = 0;
  const keysOf = (o: Record<string, unknown>) => Object.keys(o);
  const field = (o: Record<string, unknown>, f: keyof typeof SYN) => {
    const ks = keysOf(o);
    const i = pick(ks, f);
    return i >= 0 ? { key: ks[i]!, value: o[ks[i]!] } : null;
  };
  const walk = (node: unknown, trail: string[]) => {
    if (Array.isArray(node)) {
      for (const item of node) {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          const o = item as Record<string, unknown>;
          const desc = field(o, 'description');
          const amt = field(o, 'reported') ?? field(o, 'accepted') ?? field(o, 'tds');
          if (desc && amt && typeof desc.value !== 'object' && typeof amt.value !== 'object') {
            const rep = field(o, 'reported');
            const acc = field(o, 'accepted');
            const tds = field(o, 'tds');
            const src = field(o, 'source');
            const sid = field(o, 'sourceId');
            const sec = field(o, 'section');
            mapping.description ??= desc.key;
            if (rep) mapping.reported ??= rep.key;
            if (acc) mapping.accepted ??= acc.key;
            if (tds) mapping.tds ??= tds.key;
            if (src) mapping.source ??= src.key;
            if (sid) mapping.sourceId ??= sid.key;
            if (sec) mapping.section ??= sec.key;
            const label = [trail[trail.length - 1], String(desc.value)].filter(Boolean).join(' · ');
            const row = toRow({
              description: label,
              source: String(src?.value ?? ''),
              sourceId: String(sid?.value ?? ''),
              reported: rep?.value,
              accepted: acc?.value,
              tds: tds?.value,
              section: String(sec?.value ?? ''),
            });
            if (row.reported || row.accepted || row.tds) rows.push(row);
            else skipped += 1;
            continue;
          }
        }
        walk(item, trail);
      }
    } else if (node && typeof node === 'object')
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) walk(v, [...trail, k]);
  };
  walk(doc, []);
  return {
    rows,
    errors: rows.length
      ? []
      : [
          'No records with a description and an amount were found in this JSON. It may be a different kind of file, or one this importer does not know.',
        ],
    skipped,
    mapping,
  };
}

/** CSV or JSON, told apart by the first character. */
export const parseAis = (text: string) =>
  /^\s*[[{]/.test(String(text ?? '')) ? parseAisJson(text) : parseAisCsv(text);

// ---- comparing with the books --------------------------------------------------------------------------------------

/** What the books say for the same year, in the same categories. */
export interface AisBooks {
  /** Taxable outward supplies of the year (the GST returns: GSTR-3B 3.1(a)) and the receipts the return will declare. */
  gstTurnover: number;
  declaredReceipts: number;
  interestSavings: number;
  interestDeposits: number;
  dividend: number;
  /** Tax customers deducted, per deductor, from the books and from the return's TDS schedule. */
  tds: { deductor: string; tan?: string; tds: number }[];
}

export type AisStatus = 'matches' | 'ais_higher' | 'books_higher' | 'only_ais' | 'only_books';
export interface AisLine {
  category: AisCategory;
  label: string;
  ais: number;
  books: number;
  diff: number;
  status: AisStatus;
  /** What to do about it. */
  advice: string;
}

export interface AisReconciliation {
  lines: AisLine[];
  /** TDS by deductor: AIS against the books, by TAN or name. */
  tds: ReturnType<typeof compare26AS>;
  issues: FilingIssue[];
  /** Rows to give feedback on at the portal ("information is not mine / duplicate / incorrect"). */
  feedback: { description: string; source: string; amount: number; why: string }[];
}

/** Within ₹100 or 1%, whichever is more, is a match: AIS and books round and time things differently. */
const within = (a: number, b: number) => Math.abs(a - b) <= Math.max(100, 0.01 * Math.max(a, b));

export function reconcileAis(rows: AisRow[], books: AisBooks): AisReconciliation {
  const amount = (r: AisRow) => (r.accepted > 0 ? r.accepted : r.reported);
  const total = (c: AisCategory) =>
    r2(rows.filter((r) => r.category === c).reduce((s, r) => s + amount(r), 0));
  const issues: FilingIssue[] = [];
  const feedback: AisReconciliation['feedback'] = [];
  const lines: AisLine[] = [];
  const compare = (
    category: AisCategory,
    ais: number,
    bk: number,
    advice: { higher: string; lower: string },
  ) => {
    if (ais === 0 && bk === 0) return;
    const diff = r2(ais - bk);
    const status: AisStatus = within(ais, bk)
      ? 'matches'
      : ais === 0
        ? 'only_books'
        : bk === 0
          ? 'only_ais'
          : ais > bk
            ? 'ais_higher'
            : 'books_higher';
    lines.push({
      category,
      label: AIS_CATEGORY_LABELS[category],
      ais,
      books: bk,
      diff,
      status,
      advice:
        status === 'matches'
          ? 'Agrees'
          : status === 'books_higher' || status === 'only_books'
            ? advice.lower
            : advice.higher,
    });
    if (status === 'ais_higher' || status === 'only_ais')
      issues.push(
        issue(
          'warning',
          `AIS_${category.toUpperCase()}`,
          `${AIS_CATEGORY_LABELS[category]}: AIS shows ₹${ais}, your books ₹${bk}. ${advice.higher}`,
          category,
        ),
      );
  };
  compare('interest_savings', total('interest_savings'), books.interestSavings, {
    higher: 'Add the interest to Other sources, or give feedback on the portal if it is not yours',
    lower:
      'Your books show more than the banks reported; fine, but check you have not counted it twice',
  });
  compare('interest_deposits', total('interest_deposits'), books.interestDeposits, {
    higher: 'Add the deposit interest to Other sources, or give feedback if it is not yours',
    lower: 'Your books show more than the banks reported; fine',
  });
  compare('dividend', total('dividend'), books.dividend, {
    higher: 'Add the dividend to Other sources (by quarter), or give feedback if it is not yours',
    lower: 'Your books show more than was reported; fine',
  });
  const gst = total('gst_turnover');
  compare('gst_turnover', gst, books.gstTurnover, {
    higher:
      'The GST portal shows more turnover than your books: check the GSTR-1 and GSTR-3B filed, and missing invoices',
    lower:
      'Your books show more turnover than your GST returns: check invoices missing from GSTR-1',
  });
  if (
    gst > 0 &&
    books.declaredReceipts > 0 &&
    books.declaredReceipts < gst - Math.max(100, 0.01 * gst)
  )
    issues.push(
      issue(
        'warning',
        'AIS_RECEIPTS_BELOW_GST',
        `The receipts this return declares (₹${books.declaredReceipts}) are below the GST turnover reported (₹${gst}). The department compares the two; declare at least the GST turnover or explain the difference`,
        'gst_turnover',
      ),
    );
  // Categories the return can not take: say so instead of leaving the person to find out at the portal.
  for (const [cat, code, text] of [
    [
      'rent',
      'AIS_RENT',
      'Rent is reported to you: that is house property income, which the ITR-4 builder does not cover yet. Use ITR-3 or enter it on the portal',
    ],
    [
      'securities',
      'AIS_SECURITIES',
      'Share or mutual-fund transactions are reported: capital gains need ITR-2 or ITR-3 (only long-term gains under 112A up to ₹1.25 lakh fit ITR-4)',
    ],
    [
      'property',
      'AIS_PROPERTY',
      'A property transaction is reported: check capital gains and house property before filing ITR-4',
    ],
    [
      'foreign',
      'AIS_FOREIGN',
      'A foreign remittance is reported: check whether foreign assets or income need to be disclosed (ITR-2 / ITR-3)',
    ],
  ] as const)
    if (total(cat) > 0)
      issues.push(
        issue('warning', code, `${AIS_CATEGORY_LABELS[cat]}: ₹${total(cat)}. ${text}`, cat),
      );

  const tdsRows = rows.filter(
    (r) => r.category === 'tds' || r.category === 'tcs' || (r.category === 'salary' && r.tds > 0),
  );
  const tds = compare26AS(
    books.tds.map((b) => ({ deductor: b.deductor, tan: b.tan, tds: b.tds })),
    tdsRows.map((r) => ({ deductor: r.source, tan: r.sourceId, amount: amount(r), tds: r.tds })),
  );
  for (const row of tds.rows) {
    if (row.status === 'missing_in_26as')
      issues.push(
        issue(
          'warning',
          'AIS_TDS_MISSING',
          `${row.deductor}: ₹${row.book} of TDS is in your books but not in AIS. Do not claim it until the deductor files it; ask them to correct the return`,
          row.tan || row.deductor,
        ),
      );
    if (row.status === 'missing_in_books')
      issues.push(
        issue(
          'warning',
          'AIS_TDS_UNRECORDED',
          `${row.deductor}: AIS shows ₹${row.statement} of TDS you have not recorded. It is credit you can claim: record the receipt or add it to the return`,
          row.tan || row.deductor,
        ),
      );
    if (row.status === 'mismatch')
      issues.push(
        issue(
          'warning',
          'AIS_TDS_DIFF',
          `${row.deductor}: TDS is ₹${row.statement} in AIS and ₹${row.book} in your books`,
          row.tan || row.deductor,
        ),
      );
  }

  // Duplicates are the commonest reason to give feedback: the same source, description and amount twice.
  const seen = new Map<string, number>();
  for (const r of rows) {
    const key = `${deductorKey(r.source)}|${r.description.toLowerCase()}|${amount(r)}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const r of rows)
    if (
      (seen.get(`${deductorKey(r.source)}|${r.description.toLowerCase()}|${amount(r)}`) ?? 0) > 1 &&
      amount(r) > 0
    )
      feedback.push({
        description: r.description,
        source: r.source,
        amount: amount(r),
        why: 'Appears more than once with the same amount: give feedback “duplicate”',
      });
  for (const l of lines)
    if (l.status === 'only_ais')
      for (const r of rows.filter((x) => x.category === l.category))
        feedback.push({
          description: r.description,
          source: r.source,
          amount: amount(r),
          why: 'Not in your books: add it, or give feedback “not mine”',
        });

  return { lines, tds, issues, feedback };
}

const BOM = new RegExp('^\\uFEFF');

/**
 * What can be shared about a file that did not read, without sharing what is in it: the column headings of a CSV, or the
 * key names of a JSON file. Anything that looks like a value (a long number, an ID, a long text) is left out.
 */
export function formatFingerprint(text: string): {
  type: 'csv' | 'json' | 'unknown';
  columns: string[];
} {
  const safe = (c: string) => {
    const t = c.trim().replace(/^"|"$/g, '').trim();
    return t.length > 0 && t.length <= 40 && !/\d{4,}/.test(t) && !/[@₹]/.test(t) ? t : null;
  };
  const body = text.replace(BOM, '').trimStart();
  if (body.startsWith('{') || body.startsWith('[')) {
    try {
      const keys = new Set<string>();
      const walk = (v: unknown, depth: number) => {
        if (keys.size >= 60 || depth > 4 || v === null || typeof v !== 'object') return;
        for (const item of Array.isArray(v) ? v.slice(0, 5) : [v]) {
          if (item === null || typeof item !== 'object') continue;
          for (const [k, child] of Object.entries(item)) {
            const s = safe(k);
            if (s) keys.add(s);
            walk(child, depth + 1);
          }
        }
      };
      walk(JSON.parse(body), 0);
      return { type: 'json', columns: [...keys] };
    } catch {
      return { type: 'unknown', columns: [] };
    }
  }
  // The heading row is the one with the most columns among the first lines; a title above it has few.
  const lines = body
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .slice(0, 15);
  if (!lines.length) return { type: 'unknown', columns: [] };
  const width = (l: string) => Math.max(...[',', '\t', ';', '|'].map((d) => l.split(d).length));
  const line = lines.reduce((best, l) => (width(l) > width(best) ? l : best));
  const delim = [',', '\t', ';', '|'].sort(
    (a, b) => line.split(b).length - line.split(a).length,
  )[0]!;
  return {
    type: 'csv',
    columns: line
      .split(delim)
      .map(safe)
      .filter((c): c is string => !!c)
      .slice(0, 40),
  };
}
