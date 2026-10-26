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

Start your configured local Node or Worker service, then run:

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
profile header, SVG bounds and mobile overflow. Ignored screenshots/receipts go
to `artifacts/`.

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
