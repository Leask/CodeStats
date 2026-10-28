# Validation — four-source builder, 2026-10-28

This review covers the current local CodeStats implementation and documentation
for GitHub, WakaTime, Codex and OpenRouter. It supersedes the earlier same-day
milestone's setup and scale descriptions; those records remain historical.
See the [validation guide](../VALIDATION.md) for reproducible commands.

## Implemented behavior

- Four primary provider cards, with repository/activity details grouped inside
  GitHub. Disabled Codex/OpenRouter cards say **Not enabled** and link to setup;
  their public SVG rows and usage snapshots remain absent until enabled.
- Expandable AI usage details share the card's metric definitions. Exact counts,
  units, reporting periods, unknown values and real zeros remain distinguishable.
  Legacy Codex period labels display as **Lifetime** without rewriting the cache.
- Server-side setup guides, public Markdown generation and credential-free
  examples cover Node.js and Workers. WakaTime range controls do not change
  GitHub or AI reporting windows. Anthropic remains an opt-in extension.
- Existing card refinements remain intact: 32px outer edges, right-aligned rank
  and credit, a 20px rank/overview gap without a header, grouped repo counts,
  and independently scaled bars rounded upward in 10-percentage-point steps.
- The builder works at 1440, 900, 390 and 320px widths. Narrow controls use a
  single column so selected text fits beside the inset dropdown arrows.

## Verification

| Check | Result |
| --- | --- |
| Strict TypeScript | Passed |
| Unit tests | 270 passed across 12 files |
| Node bundle | Passed |
| Wrangler Worker dry-run bundle | Passed; no production publication |
| Live Node/Chrome Beta checks | 69 passed |
| Generated Worker/workerd/Chrome checks | 33 passed |
| Isolated workerd/SQLite cache checks | 13 passed |
| Independent four-source browser review | 49 passed |
| Diff whitespace and credential-pattern scan | Passed; 71 source paths checked |

Worker tests use temporary storage and mocked upstreams. They validate the
actual generated Worker, aggregate imports, unavailable values, source-unit
display, Markdown, and browser helpers. Cache tests verify retained successful
values/times, retries and SQLite persistence without changing the preview store.

The independent review also intercepted aggregate responses in memory for four
bounded scenarios: disabled AI services, unavailable data with valid zero values,
stale saved data, and missing GitHub activity. It did not alter the live cache.
Desktop, mobile and expanded-AI screenshots were inspected.

## Local observation

At 2026-10-28 17:03 UTC, the local preview reported GitHub repositories and
activity, WakaTime, Codex and OpenRouter as fresh. WakaTime used `all_time`, Codex
displayed Lifetime, and OpenRouter used Last 367 days. These are saved-observation
states, not evidence of identical reporting periods or unlimited API coverage.
Anthropic had no live configuration; its adapter was checked with fixtures only.

The service remains available at `http://127.0.0.1:8791/build`. This review covers
the local build and isolated Worker runtime, rather than production deployment.

Ignored native receipts and screenshots are under `artifacts/`:
`browser-review.json`, `worker-browser-review.json`, `cache-runtime-review.json`,
`four-sources-browser-review.json`, `four-sources-desktop.png`,
`four-sources-mobile.png` and `four-sources-ai-detail.png`.
