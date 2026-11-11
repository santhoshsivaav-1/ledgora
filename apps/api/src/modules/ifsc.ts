// Vyapar parity P5-S1 follow-up: IFSC → bank and branch for the Add Bank Account form. The API server asks the IFSC
// directory (env IFSC_API_URL, Razorpay's open IFSC API by default) so the browser never talks to a third party; answers
// are cached for a day. Offline (IFSC_API_URL=off), or when the directory is slow, the bundled bank-name table answers.
import { ifscDetails, ifscParam } from '@ledgora/contracts';
import { bankFromIfsc } from '@ledgora/tax-engine';
import { notFound } from '../errors.ts';
import type { Registrar } from '../http.ts';

type Details = {
  ifsc: string;
  bank: string;
  branch: string;
  address: string;
  city: string;
  state: string;
  micr: string;
  source: 'live' | 'bundled';
};
const DAY = 86_400_000;
const cache = new Map<string, { at: number; value: Details | null }>();
const MAX = 2000;

const bundled = (code: string): Details => ({
  ifsc: code,
  bank: bankFromIfsc(code),
  branch: '',
  address: '',
  city: '',
  state: '',
  micr: '',
  source: 'bundled',
});

/** Looks an IFSC up. null = the directory says it does not exist. Never throws on network trouble: falls back. */
export async function lookupIfsc(code: string, baseUrl: string): Promise<Details | null> {
  const hit = cache.get(code);
  if (hit && Date.now() - hit.at < DAY) return hit.value;
  if (!baseUrl || baseUrl === 'off') return bundled(code);
  let value: Details | null;
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/${encodeURIComponent(code)}`, {
      signal: AbortSignal.timeout(4000),
      headers: { accept: 'application/json' },
    });
    if (res.status === 404) value = null;
    else if (!res.ok) return bundled(code);
    else {
      const j = (await res.json()) as Record<string, unknown>;
      const s = (k: string) => (typeof j[k] === 'string' ? (j[k] as string).trim() : '');
      value = {
        ifsc: code,
        bank: s('BANK') || bankFromIfsc(code),
        branch: s('BRANCH'),
        address: s('ADDRESS'),
        city: s('CITY'),
        state: s('STATE'),
        micr: s('MICR'),
        source: 'live',
      };
    }
  } catch {
    return bundled(code);
  }
  if (cache.size >= MAX) cache.delete(cache.keys().next().value as string);
  cache.set(code, { at: Date.now(), value });
  return value;
}

export function ifscModule({ route }: Registrar) {
  route({
    method: 'get',
    path: '/v1/ifsc/:code',
    tag: 'Cash & Bank',
    summary:
      'Bank, branch, address and MICR of an IFSC (from the IFSC directory; offline, the bank name from the bundled table)',
    params: ifscParam,
    response: ifscDetails,
    permission: null,
    handler: async ({ params, deps }) => {
      const d = await lookupIfsc(params.code, deps.env.IFSC_API_URL);
      if (!d) throw notFound('IFSC');
      return d;
    },
  });
}
