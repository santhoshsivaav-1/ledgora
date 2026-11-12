// Settings > General > Amount in words language: the amount in words in Hindi or Tamil, in the Indian system (crore,
// lakh, thousand, hundred). English stays numberToWords, unchanged. Hindi has a separate word for every number to 99,
// so it is a table; Tamil is built from a unit, a "combining" form for tens and hundreds, and the scale words.

import type { Numeric } from './types.ts';
import { numberToWords } from './words.ts';

export type WordsLang = 'en' | 'hi' | 'ta';

// 0..99, index = number.
const HI =
  `शून्य एक दो तीन चार पाँच छह सात आठ नौ दस ग्यारह बारह तेरह चौदह पंद्रह सोलह सत्रह अठारह उन्नीस बीस इक्कीस बाईस
तेईस चौबीस पच्चीस छब्बीस सत्ताईस अट्ठाईस उनतीस तीस इकतीस बत्तीस तैंतीस चौंतीस पैंतीस छत्तीस सैंतीस अड़तीस उनतालीस
चालीस इकतालीस बयालीस तैंतालीस चौवालीस पैंतालीस छियालीस सैंतालीस अड़तालीस उनचास पचास इक्यावन बावन तिरपन चौवन पचपन
छप्पन सत्तावन अट्ठावन उनसठ साठ इकसठ बासठ तिरसठ चौंसठ पैंसठ छियासठ सड़सठ अड़सठ उनहत्तर सत्तर इकहत्तर बहत्तर तिहत्तर
चौहत्तर पचहत्तर छिहत्तर सतहत्तर अठहत्तर उन्यासी अस्सी इक्यासी बयासी तिरासी चौरासी पचासी छियासी सत्तासी अट्ठासी नवासी
नब्बे इक्यानवे बानवे तिरानवे चौरानवे पचानवे छियानवे सत्तानवे अट्ठानवे निन्यानवे`.split(/\s+/);

/** Splits a whole number into crore, lakh, thousand, hundred and the last two digits. Crore may itself be large. */
const parts = (n: number) => ({
  crore: Math.floor(n / 1e7),
  lakh: Math.floor((n % 1e7) / 1e5),
  thousand: Math.floor((n % 1e5) / 1e3),
  hundred: Math.floor((n % 1e3) / 100),
  rest: n % 100,
});

function hindi(n: number): string {
  if (n === 0) return HI[0]!;
  const p = parts(n);
  const out: string[] = [];
  if (p.crore) out.push(`${p.crore > 99 ? hindi(p.crore) : HI[p.crore]} करोड़`);
  if (p.lakh) out.push(`${HI[p.lakh]} लाख`);
  if (p.thousand) out.push(`${HI[p.thousand]} हज़ार`);
  if (p.hundred) out.push(`${HI[p.hundred]} सौ`);
  if (p.rest) out.push(HI[p.rest]!);
  return out.join(' ');
}

const TA_UNIT = [
  '',
  'ஒன்று',
  'இரண்டு',
  'மூன்று',
  'நான்கு',
  'ஐந்து',
  'ஆறு',
  'ஏழு',
  'எட்டு',
  'ஒன்பது',
];
const TA_TEEN = [
  'பத்து',
  'பதினொன்று',
  'பன்னிரண்டு',
  'பதின்மூன்று',
  'பதினான்கு',
  'பதினைந்து',
  'பதினாறு',
  'பதினேழு',
  'பதினெட்டு',
  'பத்தொன்பது',
];
// Tens alone (20, 30 ...) and before a unit (இருபத்து ஒன்று = 21).
const TA_TEN = [
  '',
  '',
  'இருபது',
  'முப்பது',
  'நாற்பது',
  'ஐம்பது',
  'அறுபது',
  'எழுபது',
  'எண்பது',
  'தொண்ணூறு',
];
const TA_TEN_C = [
  '',
  '',
  'இருபத்து',
  'முப்பத்து',
  'நாற்பத்து',
  'ஐம்பத்து',
  'அறுபத்து',
  'எழுபத்து',
  'எண்பத்து',
  'தொண்ணூற்று',
];
// Hundreds alone (200) and before more digits (இருநூற்று ஐந்து = 205).
const TA_HUN = [
  '',
  'நூறு',
  'இருநூறு',
  'முந்நூறு',
  'நானூறு',
  'ஐந்நூறு',
  'அறுநூறு',
  'எழுநூறு',
  'எண்ணூறு',
  'தொள்ளாயிரம்',
];
const TA_HUN_C = [
  '',
  'நூற்று',
  'இருநூற்று',
  'முந்நூற்று',
  'நானூற்று',
  'ஐந்நூற்று',
  'அறுநூற்று',
  'எழுநூற்று',
  'எண்ணூற்று',
  'தொள்ளாயிரத்து',
];

const tamil2 = (n: number) => {
  if (n < 10) return TA_UNIT[n]!;
  if (n < 20) return TA_TEEN[n - 10]!;
  const t = Math.floor(n / 10);
  const u = n % 10;
  return u ? `${TA_TEN_C[t]} ${TA_UNIT[u]}` : TA_TEN[t]!;
};

function tamil(n: number): string {
  if (n === 0) return 'பூஜ்ஜியம்';
  const p = parts(n);
  const out: string[] = [];
  // Scale word alone, or its combining form when more digits follow (ஆயிரம் / ஆயிரத்து). One thousand is just
  // ஆயிரம்; one lakh and one crore take ஒரு.
  const scale = (count: number, alone: string, joined: string, after: number, big = false) => {
    const word = after > 0 ? joined : alone;
    if (count === 1) return big ? `ஒரு ${word}` : word;
    return `${count > 99 ? tamil(count) : tamil2(count)} ${word}`;
  };
  const afterCrore = n % 1e7;
  const afterLakh = n % 1e5;
  const afterThousand = n % 1e3;
  if (p.crore) out.push(scale(p.crore, 'கோடி', 'கோடியே', afterCrore, true));
  if (p.lakh) out.push(scale(p.lakh, 'இலட்சம்', 'இலட்சத்து', afterLakh, true));
  if (p.thousand) out.push(scale(p.thousand, 'ஆயிரம்', 'ஆயிரத்து', afterThousand));
  if (p.hundred) out.push(p.rest ? TA_HUN_C[p.hundred]! : TA_HUN[p.hundred]!);
  if (p.rest) out.push(tamil2(p.rest));
  return out.join(' ');
}

/**
 * The amount in words in the chosen language. English is numberToWords ("... Rupees Only"); Hindi ends "रुपये मात्र",
 * Tamil "ரூபாய் மட்டும்". Paise are added when there are any. A negative amount is written as its size.
 */
export function amountInWordsLang(num: Numeric, lang: WordsLang | string = 'en') {
  if (lang !== 'hi' && lang !== 'ta') return numberToWords(num);
  const rounded = Math.round(Math.abs(Number(num) || 0) * 100) / 100;
  const rupees = Math.floor(rounded);
  const paise = Math.round((rounded - rupees) * 100);
  if (lang === 'hi') {
    return `${hindi(rupees)} रुपये${paise ? ` और ${hindi(paise)} पैसे` : ''} मात्र`;
  }
  return `${tamil(rupees)} ரூபாய்${paise ? ` ${tamil(paise)} பைசா` : ''} மட்டும்`;
}
