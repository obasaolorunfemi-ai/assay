# The Assay site

Static pages, built from the real library so they cannot drift from the code. The examples on the home page are produced by running `dist/` when the site is built (and the build fails if one stops behaving as the page says); the Reference, Self-healing, Limits, Security and Changelog pages are rendered from the repository's own `README.md`, `SECURITY.md` and `CHANGELOG.md`.

```bash
npm run site          # builds the library, then site/public
node site/build.mjs   # just the site, if dist/ is already built
npx wrangler deploy   # publishes site/public to Cloudflare (see ../wrangler.jsonc)
```

- `src/` is the source: `style.css`, `theme.js`, `menu.js`, `demo.js` (the offline tools on /try/), `_headers` and `fonts/` (Newsreader and Inter, variable, SIL OFL, self-hosted; nothing loads from Google).
- The /try/ tools import the package's own `quotes`, `figures` and `grounding` modules, copied into `public/lib/` by the build (and only those: the build fails if a network module would be copied). The content-security policy in `src/_headers` allows no requests at all (`connect-src 'none'`), so nothing typed there can leave the page.
- Written by hand in `build.mjs`: the home page, Get started and Technical paper copy.
- Served at https://assay.extrafemi.com (the `routes` entry in `wrangler.jsonc`). `site/public` **is committed**, so Cloudflare needs no build step: `npx wrangler deploy` alone publishes it. CI rebuilds it and fails if the committed copy is out of date; run `npm run site` and commit the result after changing anything under `site/` or the docs it renders.

- **Search and social.** Each page's title and description live in the `SEO` table in `build.mjs`; the share card is `src/assay-share-card-1200x630.png`; structured data is generated from the same table. `site/site.json` holds the date used as the sitemap's `lastmod` and in the pages' `dateModified`: bump it when the content changes. `npm run site:check` (run in CI) fails the build on a missing, duplicated or wrongly sized title or description, a wrong canonical address, missing share tags, structured data that does not parse, a broken internal link or anchor, or a sitemap that disagrees with the pages.
