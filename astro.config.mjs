import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://projectluis.com',
  output: 'static',
  trailingSlash: 'never',
  integrations: [mdx(), sitemap()],
  build: {
    inlineStylesheets: 'auto',
  },
});
