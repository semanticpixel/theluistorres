import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://projectluis.com',
  output: 'static',
  trailingSlash: 'never',
  // Astro's native i18n routing. English (default) at root, Spanish at /es/*.
  // `prefixDefaultLocale: false` keeps the English URLs un-prefixed so we don't
  // break existing links or canonical URLs.
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'es'],
    routing: {
      prefixDefaultLocale: false,
    },
  },
  integrations: [mdx(), sitemap()],
  build: {
    inlineStylesheets: 'auto',
  },
});
