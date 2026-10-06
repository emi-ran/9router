export const LOCALES = ["en"];
export const DEFAULT_LOCALE = "en";
export const LOCALE_COOKIE = "locale";
export const LOCALE_NAMES = { en: "English" };

// Legacy cookie values stay untouched; runtime always renders English.
export function normalizeLocale() { return DEFAULT_LOCALE; }
export function isSupportedLocale(locale) { return locale === DEFAULT_LOCALE; }
