// Settings > GST > Return filing and Registration type: which GST returns fall due for a tax period, and when.
//
// Monthly filer: GSTR-1 on the 11th and GSTR-3B on the 20th of the next month.
// QRMP (turnover up to ₹5 crore, quarterly): in the first two months of a quarter the optional IFF by the 13th and the
//   PMT-06 tax payment by the 25th of the next month; for the quarter, GSTR-1 by the 13th and GSTR-3B by the 22nd or
//   the 24th of the month after the quarter, by the state of registration (Notification 76/2020-CT and later).
// Composition: CMP-08 by the 18th of the month after each quarter and GSTR-4 (annual) by 30 April after the year.
//
// Due dates move by government notification; these are the standing dates. The state split below is the one table to
// change if the categories move.

export type GstFrequency = 'monthly' | 'qrmp';
export type GstRegType = 'regular' | 'composition' | 'unregistered';

/** States and UTs whose quarterly GSTR-3B is due on the 22nd (Category I); every other state's is due on the 24th. */
export const QRMP_22ND_STATE_CODES = [
  '22', // Chhattisgarh
  '23', // Madhya Pradesh
  '24', // Gujarat
  '25', // Daman and Diu
  '26', // Dadra and Nagar Haveli (and Daman and Diu)
  '27', // Maharashtra
  '28', // Andhra Pradesh (old code)
  '29', // Karnataka
  '30', // Goa
  '31', // Lakshadweep
  '32', // Kerala
  '33', // Tamil Nadu
  '34', // Puducherry
  '35', // Andaman and Nicobar Islands
  '36', // Telangana
  '37', // Andhra Pradesh
] as const;

export const qrmp3bDay = (stateCode?: string | null) =>
  (QRMP_22ND_STATE_CODES as readonly string[]).includes(String(stateCode ?? '').padStart(2, '0'))
    ? 22
    : 24;

export interface GstDue {
  form: string;
  /** The tax period it is for: '2026-04' for a month, '2026-Q1' style labels are only in `label`. */
  period: string;
  label: string;
  due: string; // yyyy-mm-dd
  optional?: boolean;
}

const iso = (y: number, m: number, d: number) => {
  // m is 1-based and may run past 12; Date normalises it.
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.toISOString().slice(0, 10);
};
const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
const quarterLabel = (y: number, m: number) => {
  const end = m;
  const start = m - 2;
  return `${MONTHS[start - 1]}-${MONTHS[end - 1]} ${y}`;
};

/** Every return due for one calendar month of tax (period 'yyyy-mm'). */
export function gstDuesForPeriod(
  period: string,
  o: { frequency?: GstFrequency; regType?: GstRegType; stateCode?: string | null } = {},
): GstDue[] {
  const m0 = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m0) return [];
  const y = Number(m0[1]);
  const m = Number(m0[2]);
  const monthLabel = `${MONTHS[m - 1]} ${y}`;
  const regType = o.regType ?? 'regular';
  if (regType === 'unregistered') return [];
  const quarterEnd = m % 3 === 0;
  if (regType === 'composition') {
    const out: GstDue[] = [];
    if (quarterEnd)
      out.push({
        form: 'CMP-08',
        period,
        label: `CMP-08 (${quarterLabel(y, m)})`,
        due: iso(y, m + 1, 18),
      });
    if (m === 3)
      out.push({
        form: 'GSTR-4',
        period,
        label: `GSTR-4 (FY ${y - 1}-${String(y).slice(-2)})`,
        due: iso(y, 4, 30),
      });
    return out;
  }
  if ((o.frequency ?? 'monthly') === 'monthly') {
    return [
      { form: 'GSTR-1', period, label: `GSTR-1 (${monthLabel})`, due: iso(y, m + 1, 11) },
      { form: 'GSTR-3B', period, label: `GSTR-3B (${monthLabel})`, due: iso(y, m + 1, 20) },
    ];
  }
  if (!quarterEnd)
    return [
      {
        form: 'IFF',
        period,
        label: `IFF (${monthLabel}, optional)`,
        due: iso(y, m + 1, 13),
        optional: true,
      },
      {
        form: 'PMT-06',
        period,
        label: `PMT-06 tax payment (${monthLabel})`,
        due: iso(y, m + 1, 25),
      },
    ];
  return [
    { form: 'GSTR-1', period, label: `GSTR-1 (${quarterLabel(y, m)})`, due: iso(y, m + 1, 13) },
    {
      form: 'GSTR-3B',
      period,
      label: `GSTR-3B (${quarterLabel(y, m)})`,
      due: iso(y, m + 1, qrmp3bDay(o.stateCode)),
    },
  ];
}

/** A short "R1 by 11th, 3B by 20th" line for the filing guide, by frequency and registration. */
export function gstDueSummary(
  o: { frequency?: GstFrequency; regType?: GstRegType; stateCode?: string | null } = {},
) {
  if (o.regType === 'composition')
    return 'CMP-08 by the 18th after each quarter, GSTR-4 by 30 April';
  if (o.regType === 'unregistered') return 'No GST returns while unregistered';
  if (o.frequency === 'qrmp')
    return `Quarterly: R1 by the 13th, 3B by the ${qrmp3bDay(o.stateCode) === 22 ? '22nd' : '24th'} after the quarter; PMT-06 by the 25th in the other months`;
  return 'R1 by 11th, 3B by 20th of next month';
}

/**
 * Settings > GST > Composition rate: the tax a composition dealer pays out of pocket on a quarter's turnover (CMP-08),
 * split equally between central and state tax. Turnover is the value of taxable outward supplies, exempt supplies
 * excluded; it carries no tax on the invoice (a Bill of Supply).
 */
export function compositionTax(turnover: number, ratePercent: number) {
  const total =
    Math.round(Math.max(0, Number(turnover) || 0) * Math.max(0, Number(ratePercent) || 0)) / 100;
  const half = Math.round((total / 2) * 100) / 100;
  return { total, central: half, state: Math.round((total - half) * 100) / 100 };
}
