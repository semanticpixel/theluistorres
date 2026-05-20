import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

/*
 * Content collections.
 *
 * The English / Spanish split for `work` is intentional — `work-es` is a
 * sibling collection that mirrors the schema. Keeping it as a separate
 * collection (vs a `locale` field on one collection) means Spanish entries
 * can opt out of being shipped with the English bundle, and the fallback
 * helper in `src/lib/content.ts` can address `work-es` first with `work`
 * as the safety net.
 *
 * The schema is duplicated inline rather than extracted because Astro's
 * `defineCollection` schema callback receives an `image()` factory typed
 * to its caller — a standalone helper would lose that contextual type.
 */

const workShape = z.object({
  title: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9-]+$/).optional(),
  summary: z.string().min(1).max(280),
  heroImageAlt: z.string().optional(),
  tags: z.array(z.string().min(1)).default([]),
  date: z.coerce.date(),
  featured: z.boolean().default(false),
  draft: z.boolean().default(false),
  role: z.string().optional(),
  company: z.string().optional(),
  period: z.string().optional(),
});

const work = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/work" }),
  schema: ({ image }) => workShape.extend({ heroImage: image().optional() }),
});

const workEs = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/work-es" }),
  schema: ({ image }) => workShape.extend({ heroImage: image().optional() }),
});

const writing = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/writing" }),
  schema: z.object({
    title: z.string().min(1),
    slug: z.string().regex(/^[a-z0-9-]+$/).optional(),
    summary: z.string().min(1).max(280),
    externalUrl: z.string().url(),
    date: z.coerce.date(),
    readingTime: z.string().optional(),
    tags: z.array(z.string().min(1)).default([]),
  }),
});

export const collections = { work, "work-es": workEs, writing };
