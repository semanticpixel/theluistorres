/*
 * Locale-aware content lookup.
 *
 * `getWorkEntry(slug, locale)` returns the work entry from the locale-
 * specific collection if it exists, otherwise falls back to the default
 * (English) entry along with `translated: false` so the renderer can show
 * the fallback ribbon and surface that this is the wrong language.
 */

import { getCollection, getEntry, type CollectionEntry } from "astro:content";
import type { Locale } from "~/lib/i18n";

type WorkCollection = "work" | "work-es";

const collectionForLocale = (locale: Locale): WorkCollection =>
  locale === "es" ? "work-es" : "work";

export interface LocaleWorkResult {
  entry: CollectionEntry<"work"> | CollectionEntry<"work-es">;
  translated: boolean;
}

export async function getWorkEntryForLocale(
  slug: string,
  locale: Locale,
): Promise<LocaleWorkResult | null> {
  const targetCollection = collectionForLocale(locale);

  if (locale !== "en") {
    const translated = await getEntry(targetCollection, slug);
    if (translated) return { entry: translated, translated: true };
  }

  /* Fall back to English. */
  const fallback = await getEntry("work", slug);
  if (!fallback) return null;
  return { entry: fallback, translated: locale === "en" };
}

export async function listWorkForLocale(
  locale: Locale,
): Promise<{ slug: string; entry: CollectionEntry<"work"> | CollectionEntry<"work-es">; translated: boolean }[]> {
  const english = await getCollection("work", entry => !entry.data.draft);
  if (locale === "en") {
    return english.map(entry => ({
      slug: entry.id.replace(/\.(md|mdx)$/, ""),
      entry,
      translated: true,
    }));
  }

  const spanish = await getCollection("work-es", entry => !entry.data.draft);
  const spanishBySlug = new Map(spanish.map(e => [e.id.replace(/\.(md|mdx)$/, ""), e]));

  return english.map(entry => {
    const slug = entry.id.replace(/\.(md|mdx)$/, "");
    const localized = spanishBySlug.get(slug);
    return localized
      ? { slug, entry: localized, translated: true }
      : { slug, entry, translated: false };
  });
}
