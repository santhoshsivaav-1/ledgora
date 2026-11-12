import { afterEach, describe, expect, it } from 'vitest';
import { CATALOGS, LANGS } from '../src/i18n/catalog';
import { currentLang, setLocalLang, t } from '../src/i18n';
import { NAV } from '../src/app/navigation';
import { resetAppSettings, setAppSettings } from '../src/lib/appSettings';

// P11-S6: the translation catalogue. Every menu entry has a Hindi and a Tamil name; the same keys in both; English is the fallback.
const leaves = (nav) => nav.flatMap((e) => [e, ...(e.children || [])]);
afterEach(() => { setLocalLang(''); resetAppSettings(); });

describe('catalogue coverage', () => {
  it('every menu entry is translated in each language', () => {
    for (const lang of ['hi', 'ta']) {
      const missing = leaves(NAV).filter((e) => !CATALOGS[lang][`nav.${e.id}`]).map((e) => e.id);
      expect(missing, lang).toEqual([]);
    }
  });
  it('Hindi and Tamil have the same keys', () => {
    expect(Object.keys(CATALOGS.hi).sort()).toEqual(Object.keys(CATALOGS.ta).sort());
    expect(LANGS.map((l) => l.id)).toEqual(['en', 'hi', 'ta']);
  });
});

describe('t()', () => {
  it('English text by default and as the fallback', () => {
    expect(t('nav.home', 'Home')).toBe('Home');
    expect(t('nope.key', 'Fallback', 'hi')).toBe('Fallback');
  });
  it('the business language, overridden by this browser\'s choice', () => {
    setAppSettings('b1', { 'ui.lang': 'ta' });
    expect(currentLang()).toBe('ta');
    expect(t('nav.home', 'Home')).toBe('முகப்பு');
    setLocalLang('hi');
    expect(t('nav.home', 'Home')).toBe('होम');
    setLocalLang('xx'); // unknown clears the choice
    expect(currentLang()).toBe('ta');
  });
});
