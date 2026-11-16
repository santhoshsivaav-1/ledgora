// R4.1 (docs/FEATURE_GAPS_2026-11.md): the fixed-asset register's arithmetic. Pure.
//
// Two depreciations, never mixed up:
//  - Income tax (Income-tax Act 1961 s.32, Rule 5, Appendix I; AY 2026-27 still runs on it): written-down-value BLOCKS, not
//    single assets. Additions used 180 days or more in the year earn the full rate, those used less earn half; sale
//    proceeds come off the block; a block sold below zero is a short-term capital gain (s.50), and a block with no asset
//    left but a balance is a short-term capital loss (s.50(2)). Depreciation is allowed whether or not it was claimed
//    (Explanation 5 to s.32), so the written-down value rolls forward every year. The figures land in the ITR-3
//    Schedules DPM, DOA and DEP, whose fields the result names.
//  - Books (Companies Act 2013, Schedule II): straight line over the useful life with a 5% residual, from the day the asset
//    is put to use. This is the depreciation in the profit and loss account.
//
// Not covered, and refused rather than guessed: additional depreciation (s.32(1)(iia), manufacturers), 100% / 40%
// special-rate assets that need their own conditions, and part-year private use (s.38(2)).

import { daysBetween } from './compliance.ts';
import { fyBounds, fyLabelOf, nextFyLabel } from './fiscal.ts';

const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const whole = (v: number) => Math.round(v + 1e-9);

export type BlockCode =
  | 'LAND'
  | 'BLD5'
  | 'BLD10'
  | 'BLD40'
  | 'FF10'
  | 'PM15'
  | 'PM30'
  | 'PM40'
  | 'PM45'
  | 'INT25'
  | 'SHIP20';

export interface BlockInfo {
  code: BlockCode;
  name: string;
  /** Percent on the written-down value; 0 for land. */
  rate: number;
  /** Which ITR-3 schedule the block is reported in. */
  schedule: 'DPM' | 'DOA';
  examples: string;
}

export const BLOCKS: BlockInfo[] = [
  {
    code: 'LAND',
    name: 'Land (not depreciable)',
    rate: 0,
    schedule: 'DOA',
    examples: 'Freehold land',
  },
  {
    code: 'BLD5',
    name: 'Residential buildings',
    rate: 5,
    schedule: 'DOA',
    examples: 'Residential house used for business',
  },
  {
    code: 'BLD10',
    name: 'Other buildings',
    rate: 10,
    schedule: 'DOA',
    examples: 'Shop, office, factory, warehouse',
  },
  {
    code: 'BLD40',
    name: 'Temporary structures',
    rate: 40,
    schedule: 'DOA',
    examples: 'Wooden structures, sheds',
  },
  {
    code: 'FF10',
    name: 'Furniture and fittings',
    rate: 10,
    schedule: 'DOA',
    examples: 'Tables, shelves, electrical fittings',
  },
  {
    code: 'PM15',
    name: 'Plant and machinery (general)',
    rate: 15,
    schedule: 'DPM',
    examples: 'Machines, motor cars, office equipment',
  },
  {
    code: 'PM30',
    name: 'Motor vehicles on hire',
    rate: 30,
    schedule: 'DPM',
    examples: 'Buses, lorries, taxis run on hire',
  },
  {
    code: 'PM40',
    name: 'Computers and software',
    rate: 40,
    schedule: 'DPM',
    examples: 'Desktops, laptops, servers, printers, software',
  },
  {
    code: 'PM45',
    name: 'Commercial vehicles (bought 23-Aug-2019 to 31-Mar-2020)',
    rate: 45,
    schedule: 'DPM',
    examples: 'Vehicles under the 2019 stimulus',
  },
  {
    code: 'INT25',
    name: 'Intangible assets',
    rate: 25,
    schedule: 'DOA',
    examples: 'Patents, copyrights, trademarks, licences, franchises, know-how',
  },
  {
    code: 'SHIP20',
    name: 'Ships',
    rate: 20,
    schedule: 'DOA',
    examples: 'Ocean-going ships, vessels',
  },
];
const BLOCK_BY_CODE = new Map(BLOCKS.map((b) => [b.code, b]));
export const blockInfo = (code: string) => BLOCK_BY_CODE.get(code as BlockCode);

export interface FixedAsset {
  id: string;
  name: string;
  block: BlockCode;
  /** Purchase price plus the cost of bringing it into use, in rupees. */
  cost: number;
  /** The day it was first used for the business. An addition belongs to the year this falls in. */
  putToUse: string;
  disposal?: { date: string; proceeds: number; expenses?: number };
  /** Companies Act: useful life in years and residual percent; the class default when not given. */
  lifeYears?: number;
  residualPct?: number;
}

/** One block for one year, in the words and order of Schedule DPM / DOA. */
export interface BlockYear {
  block: BlockCode;
  fy: string;
  rate: number;
  WDVFirstDay: number;
  AdditionsGrThan180Days: number;
  RealizationTotalPeriod: number;
  FullRateDeprAmt: number;
  AdditionsLessThan180Days: number;
  RealizationPeriodLessThan180days: number;
  HalfRateDeprAmt: number;
  DepreciationAtFullRate: number;
  DepreciationAtHalfRate: number;
  TotalDepreciation: number;
  DepDisAllowUs38_2: number;
  NetAggregateDepreciation: number;
  ProportionateAggDepreciation: number;
  ExpdrOnTrforSaleAsset: number;
  /** Positive: short-term capital gain; negative: short-term capital loss (s.50). */
  CapGainUs50: number;
  WDVLastDay: number;
  /** Assets of the block still owned at the end of the year. */
  assetsLeft: number;
  notes: string[];
}

export interface BlockYearOptions {
  /** True when every asset behind the opening balance is listed, so an empty register proves the block ended. Without it a sale never ends a block. */
  trackedAll?: boolean;
}

/** Whole days an asset is used in the year when put to use on `from`, counting both ends (the department's count). */
export const daysUsedInYear = (from: string, fy: string) => daysBetween(from, fyBounds(fy).end) + 1;

const inYear = (date: string, fy: string) => {
  const { start, end } = fyBounds(fy);
  return date >= start && date <= end;
};

/** One block, one financial year. `opening` is the written-down value on 1 April. */
export function computeBlockYear(
  block: BlockCode,
  fy: string,
  opening: number,
  assets: FixedAsset[],
  options: BlockYearOptions = {},
): BlockYear {
  const info = blockInfo(block);
  if (!info) throw new Error(`Unknown asset block ${block}`);
  const { end } = fyBounds(fy);
  const mine = assets.filter((a) => a.block === block);
  const notes: string[] = [];

  let full = 0;
  let half = 0;
  let realised = 0;
  let expenses = 0;
  for (const a of mine) {
    if (inYear(a.putToUse, fy)) {
      if (block === 'LAND' || daysUsedInYear(a.putToUse, fy) >= 180) full += a.cost;
      else half += a.cost;
    }
    if (a.disposal && inYear(a.disposal.date, fy)) {
      realised += a.disposal.proceeds;
      expenses += a.disposal.expenses ?? 0;
    }
  }
  const assetsLeft = mine.filter(
    (a) => a.putToUse <= end && !(a.disposal && a.disposal.date <= end),
  ).length;

  // Sale proceeds first reduce the pool that earns the full rate; only what is left over reduces the half-rate additions.
  const toFull = Math.min(realised, opening + full);
  const toHalf = Math.min(realised - toFull, half);
  const excess = r2(realised - toFull - toHalf);
  const fullPool = r2(opening + full - toFull);
  const halfPool = r2(half - toHalf);
  const pool = r2(fullPool + halfPool);

  let dep = 0;
  let capGain = 0;
  let last = pool;
  const ended = assetsLeft === 0 && realised > 0 && options.trackedAll === true && block !== 'LAND';
  if (block === 'LAND') {
    capGain = 0;
    if (excess > 0)
      notes.push(
        'Land sold above its cost: the gain is long-term capital gain, not part of this schedule.',
      );
    last = Math.max(0, pool);
  } else if (excess > 0) {
    capGain = excess - expenses;
    last = 0;
    notes.push(
      'Sale proceeds exceed the block: the excess is a short-term capital gain (s.50); no depreciation this year.',
    );
  } else if (ended) {
    capGain = -pool - expenses;
    last = 0;
    notes.push(
      'Every asset of the block is sold: the balance is a short-term capital loss (s.50(2)); no depreciation this year.',
    );
  } else {
    dep = whole((info.rate / 100) * fullPool) + whole((info.rate / 200) * halfPool);
    last = r2(pool - dep);
  }

  return {
    block,
    fy,
    rate: info.rate,
    WDVFirstDay: whole(opening),
    AdditionsGrThan180Days: whole(full),
    RealizationTotalPeriod: whole(toFull),
    FullRateDeprAmt: whole(Math.max(0, fullPool)),
    AdditionsLessThan180Days: whole(half),
    RealizationPeriodLessThan180days: whole(toHalf),
    HalfRateDeprAmt: whole(Math.max(0, halfPool)),
    DepreciationAtFullRate: block === 'LAND' || dep === 0 ? 0 : whole((info.rate / 100) * fullPool),
    DepreciationAtHalfRate: block === 'LAND' || dep === 0 ? 0 : whole((info.rate / 200) * halfPool),
    TotalDepreciation: dep,
    DepDisAllowUs38_2: 0,
    NetAggregateDepreciation: dep,
    ProportionateAggDepreciation: dep,
    ExpdrOnTrforSaleAsset: whole(expenses),
    CapGainUs50: whole(capGain),
    WDVLastDay: whole(last),
    assetsLeft,
    notes,
  };
}

export interface BlockOpening {
  block: BlockCode;
  /** Written-down value on 1 April of `fy` (the register's first year for this block). */
  wdv: number;
  fy: string;
  /** True only when the figure is the balance of assets all listed in the register; a balance brought from elsewhere (the default) means a sold-out register is not proof the block ended. */
  trackedAll?: boolean;
}

/**
 * Every block for `fy`, rolling the written-down value forward from each block's opening year (or from the first year an
 * asset of the block was put to use). The year before an opening year is not touched: the opening figure is the truth.
 */
export function computeBlocks(
  fy: string,
  assets: FixedAsset[],
  openings: BlockOpening[] = [],
): BlockYear[] {
  const codes = new Set<BlockCode>([
    ...assets.map((a) => a.block),
    ...openings.map((o) => o.block),
  ]);
  const out: BlockYear[] = [];
  for (const code of [...codes].sort()) {
    const open = openings.find((o) => o.block === code);
    const firstAsset = assets
      .filter((a) => a.block === code)
      .map((a) => fyLabelOf(a.putToUse))
      .sort()[0];
    const startFy = [open?.fy, firstAsset].filter(Boolean).sort()[0] as string | undefined;
    if (!startFy || startFy > fy) continue;
    let wdv = open && open.fy === startFy ? open.wdv : 0;
    let result: BlockYear | undefined;
    for (let y = startFy; y <= fy; y = nextFyLabel(y)) {
      // An opening figure given for a later year replaces the rolled figure (the person's own balance is the truth).
      if (open && open.fy === y && y !== startFy) wdv = open.wdv;
      result = computeBlockYear(code, y, wdv, assets, {
        trackedAll: !open || open.trackedAll === true,
      });
      wdv = result.WDVLastDay;
    }
    if (result) out.push(result);
  }
  return out;
}
// ---------------------------------------------------------------- Books (Companies Act, Schedule II)

/** Useful life in years by class, Schedule II Part C (the common classes; others take the person's own figure). */
export const SCHEDULE_II_LIVES: Record<string, { life: number; name: string }> = {
  LAND: { life: 0, name: 'Land (not depreciated)' },
  BLD5: { life: 60, name: 'Residential building (RCC)' },
  BLD10: { life: 30, name: 'Other building (factory, shop, office)' },
  BLD40: { life: 3, name: 'Temporary structure' },
  FF10: { life: 10, name: 'Furniture and fittings' },
  PM15: { life: 15, name: 'Plant and machinery (general)' },
  PM30: { life: 8, name: 'Motor vehicle' },
  PM40: { life: 3, name: 'Computers and software' },
  PM45: { life: 8, name: 'Commercial vehicle' },
  INT25: { life: 5, name: 'Intangible asset' },
  SHIP20: { life: 20, name: 'Ship' },
};

export interface BookYear {
  assetId: string;
  fy: string;
  /** Depreciation charged in the profit and loss account for the year. */
  depreciation: number;
  /** Depreciation charged up to the end of the year. */
  accumulated: number;
  /** Cost less accumulated depreciation at the end of the year (zero once sold). */
  netBlock: number;
  /** Profit (positive) or loss on sale in the year, against the book value at the sale date. */
  saleProfit: number;
}

/** Straight line to the 5% residual (or the asset's own), daily from the day put to use; none for land. */
export function bookDepreciation(asset: FixedAsset, fy: string): BookYear {
  const life = asset.lifeYears ?? SCHEDULE_II_LIVES[asset.block]?.life ?? 0;
  const residual = (asset.residualPct ?? 5) / 100;
  const base = asset.cost * (1 - residual);
  const perDay = life > 0 && asset.block !== 'LAND' ? base / (life * 365) : 0;
  const { start, end } = fyBounds(fy);

  const upTo = (date: string) => {
    // Days from the day put to use to `date`, both counted, never beyond the useful life.
    const days = Math.max(0, daysBetween(asset.putToUse, date) + 1);
    return Math.min(base, perDay * days);
  };
  const stop = asset.disposal && asset.disposal.date < end ? asset.disposal.date : end;
  const accumulatedBefore = asset.putToUse >= start ? 0 : upTo(prevDay(start));
  const accumulated = asset.putToUse > end ? 0 : upTo(stop);
  const depreciation = r2(Math.max(0, accumulated - accumulatedBefore));
  const sold = !!asset.disposal && asset.disposal.date <= end;
  const inThisYear = !!asset.disposal && asset.disposal.date >= start && asset.disposal.date <= end;
  return {
    assetId: asset.id,
    fy,
    depreciation,
    accumulated: r2(accumulated),
    netBlock: sold ? 0 : r2(asset.putToUse > end ? 0 : asset.cost - accumulated),
    saleProfit: inThisYear
      ? r2(
          (asset.disposal?.proceeds ?? 0) -
            (asset.disposal?.expenses ?? 0) -
            (asset.cost - accumulated),
        )
      : 0,
  };
}
const prevDay = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

/** The year's books depreciation for every asset, plus the totals the profit and loss account and balance sheet need. */
export function bookRegister(assets: FixedAsset[], fy: string) {
  const rows = assets.map((a) => ({ asset: a, ...bookDepreciation(a, fy) }));
  return {
    rows,
    depreciation: r2(rows.reduce((s, r) => s + r.depreciation, 0)),
    grossBlock: r2(
      rows.reduce(
        (s, r) =>
          r.netBlock > 0 || (r.asset.putToUse <= fyBounds(fy).end && !r.asset.disposal)
            ? s + r.asset.cost
            : s,
        0,
      ),
    ),
    accumulated: r2(rows.filter((r) => r.netBlock > 0).reduce((s, r) => s + r.accumulated, 0)),
    netBlock: r2(rows.reduce((s, r) => s + r.netBlock, 0)),
    saleProfit: r2(rows.reduce((s, r) => s + r.saleProfit, 0)),
  };
}
