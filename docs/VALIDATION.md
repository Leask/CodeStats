# Development and validation

[Back to CodeStats](../README.md) · [Implementation contract](CONTRACT.md)

Run from the repository root with Node.js26+ and `npm ci` already completed:

```sh
npm run check
npm test
npm run build:node
npm run build
npm run test:runtime
```

- `check`: strict TypeScript checks.
- `test`: collectors, source validation, private-data boundaries, profile/rank,
  grouping, percentage totals, SVG escaping, concurrency and persistent Node cache.
- `build:node`: creates the Node entry point in `dist/node.mjs`.
- `build`: Worker bundle with `wrangler deploy --dry-run`; it does not publish.
- `test:runtime`: real Cloudflare workerd and SQLite Durable Objects in temporary
  isolated storage, with mocked upstreams. Checks embedded avatars, HTTP503
  fallback, preserved successful data/timestamps, retry cooldown and restart
  persistence. No real tokens or deployed resources are used.

## Browser review

Start your configured local Node or Worker service, open `/build`, then run:

```sh
npm run test:preview
```

The browser test uses an isolated installed Chrome Beta when available, otherwise
Playwright Chromium. Install the test browser if neither is available:

```sh
npx playwright install chromium
```

`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` selects another browser executable;
`PREVIEW_URL` selects another local test URL. The profile-specific browser check
expects the populated default ten-row card and available datasets; it is a review
of the running real profile, not an offline unit test for every account shape.
It checks controls, Markdown copying, grouped language totals, themes/ranges,
profile header, independent scale geometry, repository unions, metadata placement,
SVG bounds and mobile overflow. The repository collection and WakaTime must be
fresh; activity's actual stale/error state must match the displayed source panel.
Ignored screenshots/receipts go to `artifacts/`.

Verify the route contract as well: `/` and `/card.svg` return transparent SVG by
default; `/build` and `/build/` return HTML. The builder defaults to transparent,
shows one compact linked Markdown image, and adds expandable cards only when
selected. Its snippet must remain usable when `/api/stats` fails.

Exercise the generated Worker bundle in a browser, not only the Node build:

```sh
npm run test:worker:browser
```

This builds with the actual Wrangler configuration and serves its generated
Worker in workerd with isolated SQLite storage and mocked upstreams. It checks
the builder, compact Markdown/clipboard, partial source failure, transparent
homepage and HTTP/JSON error reporting without using real tokens or cloud resources.

Serialized helper functions must not refer to an undefined `__name`. Keep
Wrangler's `keep_names: false` and `minify: false`; do not enable minification as
a workaround for name-preservation instrumentation. A passing bundle command
alone does not establish that the browser builder runs.

Node cache is stored in `.data/`; local Worker cache is in `.wrangler/state`.
Keep both private and preserve the chosen runtime's store across restarts. Tests
use isolated stores and do not clear the live preview cache. Configuration samples
contain placeholders only; never record token values or hashes in test output.

The dependency lock is committed. SVG path data/template fragments can exceed
normal code line limits to keep complete vectors/markup intact. Ordinary code
uses the project's four-space indentation and strict TypeScript settings.

[Historical local validation observations](history/validation-2026-10-26.md) are
retained separately. Those dated measurements are not claims about a new account,
current upstream freshness, deployed Cloudflare capacity or GitHub image-proxy timing.

[Independent scales and repository-count validation](history/validation-2026-10-28.md)
records the later local review, including the separate activity-scope limitation.
