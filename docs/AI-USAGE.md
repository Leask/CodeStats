# Optional AI token usage

[Back to CodeStats](../README.md)

Configured services appear below the language table and add their own successful
refresh times to the footer. Unconfigured services stay hidden. Each service has
an independent last-good cache: failed fetches preserve its prior value and time;
unknown data is a dash, not zero. Provider totals are never added together because
their time windows and token-accounting rules differ and may overlap.

## OpenRouter

Set `OPENROUTER_API_KEY` to an OpenRouter **Management key**. Ordinary inference
keys can report their spending but cannot read account token analytics. Management
keys have broad account administration privileges; CodeStats calls only the
read-only analytics query. Keep the credential server-side as a Worker Secret or
in an ignored local environment file.

CodeStats makes one aggregate `POST /api/v1/analytics/query`, with
`metrics: ['tokens_total']`, an explicit UTC `time_range`, and no dimensions or
per-generation traversal. It accepts one complete, untruncated aggregate only.

The default range is the last 30 **completed UTC days**. Set
`OPENROUTER_USAGE_SINCE=YYYY-MM-DD` for a different explicit start. The metric
supports at most 367 days per query; a rejected or incomplete query preserves
the saved data rather than quietly narrowing its scope. Labels say `Last 30 days`
or `Since YYYY-MM-DD`. This is an account-wide reporting interval, not a claimed
full lifetime or just the activity of the supplied inference key.

Official references: [analytics query](https://openrouter.ai/docs/api/api-reference/analytics/query-analytics-data),
[metric schema and window limits](https://openrouter.ai/skills/openrouter-analytics-schema),
[management-key permissions](https://openrouter.ai/docs/guides/overview/auth/management-api-keys).

## Codex / ChatGPT account activity

The shareable `chatgpt.com/u/…` profile requires a signed-in viewer. It is not an
anonymous Worker statistics API. CodeStats uses the documented Codex app-server
`account/usage/read` method instead, through the existing **local** Codex login.
No ChatGPT cookie, access token, refresh token or conversation content is copied
to CodeStats or sent to a Worker.

### Node

Install the Codex CLI and sign in normally, then set:

```dotenv
CODEX_USAGE_ENABLED=true
```

The service reads the official lifetime token summary when its independent cache
is due. It creates a short-lived app-server child for the read and closes only
that child. API-key-only and Bedrock logins do not provide this account statistic.
This uses the provider's account/workspace activity accounting, which can include
Work/Codex activity and cached context. It is not an API billing estimate.

### Cloudflare Worker

A Worker cannot run the local Codex CLI. Enable `CODEX_USAGE_ENABLED=true` in its
runtime variables, and configure a separate random `CODEX_SYNC_TOKEN` of at least
32 characters as a Worker Secret and in your ignored local `.env`. For example,
generate a dedicated sync secret locally with `openssl rand -hex 32`; do not reuse
a provider credential.

From a machine already signed in to Codex, run:

```sh
npm run sync:codex -- https://your-worker.example
```

This reads the official summary locally and sends only its five numeric/null
summary fields and the observation time to `POST /api/usage/codex`. The separate
secret is sent in an Authorization header, never in the URL. The endpoint is
disabled unless explicitly configured; it rejects unauthenticated, oversized,
invalid and older observations. The command does not create any timer or daemon.
Use your existing maintenance workflow when another sync is desired.

The footer's Codex time is the actual observation time, not the time a visitor
loaded the card. A late or failed sync leaves the previous observation readable
and eventually marked stale. This prevents visits from making old data look new.

Official reference: [account token usage](https://learn.chatgpt.com/docs/app-server#7-token-usage-chatgpt).

## Anthropic API

Set optional `ANTHROPIC_ADMIN_KEY` to an organization Admin credential. This
supports Claude **API organization usage**, not an individual's Claude Pro/Max
subscription, and is labelled `Anthropic API`. No anonymous personal usage
profile is assumed. Without a configured credential, the service remains hidden.

The collector reads `/v1/organizations/usage_report/messages` without grouping
filters. The default is 30 completed UTC days; optional
`ANTHROPIC_USAGE_SINCE=YYYY-MM-DD` changes the start. It sums uncached input,
cache reads, both cache-creation categories and output tokens. Daily bucket pages
are completed before saving a success, with a finite 32-page/45-second budget.
An incomplete run never replaces the saved total with a partial one.

This adapter is covered by isolated schema/error tests. A deployment without an
Anthropic Admin key has no live Anthropic acceptance result.

Official reference: [Usage and Cost API](https://platform.claude.com/docs/en/manage-claude/usage-cost-api).
