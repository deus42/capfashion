/**
 * Interface languages: Ukrainian, the language the interface is written in, and English.
 * `t()` takes the Ukrainian text itself as the key, so a screen reads as it always did and a missing English line
 * falls back to Ukrainian instead of a blank; `{name}` placeholders are filled from `vars`. The test suite checks
 * that every literal `t('…')` in src has an English line. No external library.
 */
import type { Language } from '../server/schema.ts';
import { en, enPatterns } from './i18n/en.ts';

let lang: Language = 'uk';

/** The language a person sees: their profile choice, then the browser's, then Ukrainian. */
export function pickLanguage(profile?: Language): Language {
  if (profile) return profile;
  const browser = typeof navigator === 'undefined' ? '' : navigator.language.toLowerCase();
  return browser.startsWith('en') ? 'en' : 'uk';
}

export function setLanguage(next: Language) {
  lang = next;
  if (typeof document !== 'undefined') document.documentElement.lang = next;
}
export const currentLanguage = () => lang;

export function t(text: string, vars?: Record<string, string | number>): string {
  let out = text;
  if (lang === 'en') {
    if (text in en) out = en[text];
    else for (const [re, to] of enPatterns) if (re.test(text)) { out = text.replace(re, to); break; }
  }
  return vars ? out.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : out;
}

/** Ukrainian plural forms: one (1, 21), few (2–4, 22–24), many (0, 5–20…); English uses one/other. */
export function plural(n: number, forms: { one: string; few: string; many: string }): string {
  if (lang === 'en') return t(n === 1 ? forms.one : forms.many, { n });
  const m10 = n % 10;
  const m100 = n % 100;
  const form = m10 === 1 && m100 !== 11 ? forms.one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? forms.few : forms.many;
  return t(form, { n });
}

/** «1 образ», «3 образи», «5 образів». */
export const LOOKS = { one: '{n} образ', few: '{n} образи', many: '{n} образів' };
