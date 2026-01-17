# Site

This folder contains the Next.js site that renders the scraped snapshots and Markdown overrides.

## How it works

- `pages/[[...slug]].jsx` loads the HTML snapshot from `migration/content/**/index.json`.
- `lib/overrides.mjs` replaces specific sections using `site/content/overrides.json`.
- `content/markdown/` holds the editable Markdown per language (modules + pages).
- `public/remote-assets/` holds the downloaded CSS/JS/media from the scrape.

Shared modules (header/footer or reusable sections) can live under
`content/markdown/<lang>/`.
Full-page content lives under `content/markdown/<lang>/pages/`.

Header/footer link helpers:

- Set `"localizeLinks": true` in overrides to auto-prefix internal links for `/en/*`.
- Add `data-no-localize` on any link that should keep its exact href.
- Set `"highlightActiveLinks": true` to auto-apply active menu classes based on the route.

## Run locally

From the repo root:

```bash
npm run dev
```

Optional env vars:

- `CONTENT_ROOT` to point to a different content directory.
- `OVERRIDES_ROOT` to point to a different overrides/Markdown directory.
- `BASE_PATH` if the site will be hosted under a subpath.

## External links report

From the repo root:

```bash
npm run external-links
```

The report is written to `migration/EXTERNAL_LINKS.md`.

## Build

```bash
npm run build
```

Static output is generated in `site/out/`.
