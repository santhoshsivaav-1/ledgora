// Invoice-number helpers shared by the editor's number peeking, saving and PDF naming. Pure on purpose, so they
// can be unit-tested without the editor mounted.
import { INVOICE_TYPES } from '../../../utils';

/**
 * The prefix a document type numbers with: the per-type override from Print Settings wins, then the type's own,
 * then INV. Also says whether an override was set — the save call passes that along so the counter is not
 * advanced under two different prefixes.
 */
export function numberPrefixFor(printSettings, type) {
  const rawOverride = printSettings?.customPrefixes?.[type];
  const overridePrefix = rawOverride && rawOverride.trim();
  return { prefix: overridePrefix || INVOICE_TYPES[type]?.prefix || 'INV', overridePrefix: !!overridePrefix };
}

/** The PDF file name for a saved bill: the type's prefix, the number, slashes dashed. */
export const pdfFileName = (prefix, number) => `${prefix}_${String(number).replace(/\//g, '-')}.pdf`;
