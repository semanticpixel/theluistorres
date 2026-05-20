/*
 * i18n string lookup.
 *
 * Strings live in `src/i18n/<locale>.json` and are loaded synchronously
 * by JSON import (resolved at build time, no runtime cost). The `t()`
 * helper takes a string key like `"nav.work"` and resolves against the
 * given locale's bundle, falling back to English if the key is missing
 * in the target locale — so adding a new key never breaks the Spanish
 * build, it just shows the English placeholder until the translation
 * lands.
 */

import en from "~/i18n/en.json";
import es from "~/i18n/es.json";

export type Locale = "en" | "es";

const bundles: Record<Locale, Record<string, string>> = { en, es };

export function t(locale: Locale, key: string): string {
  const fromTarget = bundles[locale]?.[key];
  if (fromTarget !== undefined) return fromTarget;
  return bundles.en[key] ?? key;
}

export function localePrefix(locale: Locale): string {
  return locale === "en" ? "" : `/${locale}`;
}

/* Strip the leading /<locale>/ from a pathname, returning the locale-agnostic path. */
export function stripLocale(pathname: string, locales: Locale[] = ["en", "es"]): string {
  for (const locale of locales) {
    if (locale === "en") continue; /* English is unprefixed */
    if (pathname === `/${locale}`) return "/";
    if (pathname.startsWith(`/${locale}/`)) return pathname.slice(`/${locale}`.length);
  }
  return pathname;
}

export function withLocale(pathname: string, locale: Locale): string {
  const stripped = stripLocale(pathname);
  if (locale === "en") return stripped;
  return stripped === "/" ? `/${locale}` : `/${locale}${stripped}`;
}
