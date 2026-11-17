import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import yaml from '@rollup/plugin-yaml';
import { loadEnv } from 'vite';

/**
 * In design-study markdown under src/data/studies/, replace each ```mermaid
 * block with a link to the figure the page renders natively from the same
 * source. Keeps the full doc readable without rendering any diagram twice.
 */
function remarkStudyFigureRefs() {
  return (tree, file) => {
    const filePath = String(file?.path ?? file?.history?.[0] ?? '').replaceAll('\\', '/');
    if (!filePath.includes('/src/data/studies/')) return;
    let figure = 0;
    tree.children = tree.children.map((node) => {
      if (node.type !== 'code' || node.lang !== 'mermaid') return node;
      figure += 1;
      return {
        type: 'paragraph',
        data: { hProperties: { className: ['doc-figure-ref'] } },
        children: [
          { type: 'text', value: 'Diagram: rendered above as ' },
          { type: 'link', url: `#figure-${figure}`, children: [{ type: 'text', value: `Figure ${figure}` }] },
          { type: 'text', value: '.' },
        ],
      };
    });
  };
}

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
      // Error and plain-text utility routes are not search destinations.
      filter: (page) =>
        !page.includes('/404') &&
        !page.endsWith('.txt'),
      serialize: (item) => ({
        ...item,
        url: ['/latest', '/method', '/studies/eval-pipeline'].some((route) => item.url.endsWith(route))
          ? `${item.url}.html`
          : item.url,
      }),
    }),
  ],
  markdown: {
    remarkPlugins: [remarkStudyFigureRefs],
  },
  build: {
    // Emit /404.html rather than /404/index.html — GitHub Pages only serves
    // a custom 404 from the former.
    format: 'file',
  },
  vite: {
    // Lets `import resume from './resume.yaml'` work as a plain module import,
    // so the data file stays human-editable YAML rather than JSON or TS.
    plugins: [yaml()],
    server: {
      allowedHosts: env.DEV_ALLOWED_HOST ? [env.DEV_ALLOWED_HOST] : [],
    },
  },
});
