import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import yaml from '@rollup/plugin-yaml';
import { loadEnv } from 'vite';

const isDevelopmentServer = process.argv.includes('dev');
const mode = isDevelopmentServer ? 'development' : 'production';
const env = loadEnv(mode, process.cwd(), '');
const siteUrl = env.SITE_URL || 'https://mrityunjaykumar911.github.io';
const deploymentUrl = new URL(siteUrl);
const base = deploymentUrl.pathname.replace(/\/$/, '') || '/';

// This repo is a GitHub *user* site (mrityunjaykumar911.github.io), so it is
// served from the domain root and needs no `base`. A project site would.
//
// Preview query flags require per-request rendering under `astro dev`.
// Production remains a static build and needs no SSR adapter.
export default defineConfig({
  site: deploymentUrl.origin,
  base,
  output: isDevelopmentServer ? 'server' : 'static',
  trailingSlash: 'ignore',
  integrations: [
    sitemap({
      // Neither the error page nor flag-gated detail is a search destination.
      filter: (page) => !page.includes('/404') && !page.includes('/latest'),
    }),
  ],
  build: {
    // Emit /404.html rather than /404/index.html — GitHub Pages only serves
    // a custom 404 from the former.
    format: 'file',
  },
  vite: {
    // Lets `import resume from './resume.yaml'` work as a plain module import,
    // so the data file stays human-editable YAML rather than JSON or TS.
    plugins: [yaml()],
  },
});
