import { computed, signal } from '@angular/core';
import { EN, type MessageKey, type Messages } from './en';
import { FR } from './fr';

export type { MessageKey } from './en';

/**
 * Runtime i18n, no dependency: the current language is a global signal, so `t()` and the
 * formatters (`format.ts`) can be called straight from templates and re-render on a switch.
 * English by default; the choice is remembered in the browser.
 */
export type Lang = 'en' | 'fr';
export const LANGS: readonly Lang[] = ['en', 'fr'];

const DICTIONARIES: Record<Lang, Messages> = { en: EN, fr: FR };
// en-GB: day/month order and 24-hour clock, like the French locale
const LOCALES: Record<Lang, string> = { en: 'en-GB', fr: 'fr-FR' };
const STORAGE_KEY = 'fleet.lang';

const isLang = (value: unknown): value is Lang => value === 'en' || value === 'fr';

function storedLang(): Lang {
  try {
    const value = globalThis.localStorage?.getItem(STORAGE_KEY);
    return isLang(value) ? value : 'en';
  } catch {
    return 'en';
  }
}

const lang = signal<Lang>(storedLang());

export const currentLang = lang.asReadonly();
export const currentLocale = computed(() => LOCALES[lang()]);

export type MessageParams = Record<string, string | number>;

export function t(key: MessageKey, params?: MessageParams): string {
  const text = DICTIONARIES[lang()][key] ?? EN[key];
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

export function setLang(value: Lang) {
  lang.set(value);
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, value);
  } catch {
    // storage unavailable (private browsing…): the choice only lasts for this page
  }
  syncDocument();
}

/** `<html lang>` and the tab title follow the current language. */
export function syncDocument() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = lang();
  document.title = t('app.title');
}
