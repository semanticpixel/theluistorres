import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

/*
 * Content collections.
 *
 * Both collections use the `glob` loader (Astro 5's replacement for the
 * legacy `type: "content"` API). Each `.mdx` file under `src/content/<col>/`
 * becomes one entry; Zod validates frontmatter at build time so a misshapen
 * file fails `astro build` with a clear error rather than failing silently.
 *
 * The English / Spanish split for `work` is intentional — ST-6 adds
 * `work-es` as a sibling collection that mirrors this schema. Keeping it
 * as a separate collection (vs a `locale` field on one collection) means
 * Spanish entries can opt out of being shipped with the English bundle.
 */

const work = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/work" }),
  schema: ({ image }) =>
    z.object({
      title: z.string().min(1),
      slug: z.string().regex(/^[a-z0-9-]+$/).optional(),
      summary: z.string().min(1).max(280),
      heroImage: image().optional(),
      heroImageAlt: z.string().optional(),
      tags: z.array(z.string().min(1)).default([]),
      date: z.coerce.date(),
      featured: z.boolean().default(false),
      draft: z.boolean().default(false),
      role: z.string().optional(),
      company: z.string().optional(),
      period: z.string().optional(),
    }),
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

export const collections = { work, writing };
