# Codex and OpenRouter usage

[Back to CodeStats](../README.md) · [Deployment settings](DEPLOYMENT.md)

CodeStats has four primary sources: **GitHub, WakaTime, Codex and OpenRouter**.
This guide connects the two usage sources. GitHub and WakaTime configuration is
covered in the [deployment guide](DEPLOYMENT.md#credentials).

The card shows configured usage sources below the language table, with **Codex
first, then OpenRouter**. Each has its own reporting period, cache and refresh
time. Their totals are never added together: the periods and accounting rules
differ, and the same activity may appear in more than one system.

| Source | Enable it with | Reporting period |
| --- | --- | --- |
| Codex on Node | A configured `CODEX_USERNAME` or `CODEX_SYNC_TOKEN`, plus the service user's existing Codex CLI login | Official account/workspace lifetime summary |
| Codex on a Worker | Run the local sync command; it can install its own dedicated `CODEX_SYNC_TOKEN` | Lifetime summary as of the last imported observation |
| OpenRouter | `OPENROUTER_API_KEY` containing a Management key | Last 367 completed UTC days, or a shorter configured interval |

Codex auto-enables from its configured ID or sync secret. No extra flag is
required. `CODEX_USAGE_ENABLED=false` explicitly disables it, including when
those settings are present. `true` remains available for Node users who want
local CLI collection without an ID or sync secret. Remove an old sample's
explicit `false` line when switching to automatic enabling.

Usage credentials apply only to the configured profile. `sources=codex` or
`sources=openrouter` can select that configured subset without an account
parameter. Any explicit public `github`, `wakatime` or `codex` ID switches the
entire request to public mode and strips all owner credentials/imports, including
the same-ID case. `view=codex` and `view=openrouter` provide focused cards;
overview remains the default.

The builder always shows the four primary provider cards. An unconfigured
Codex/OpenRouter card says **Not enabled** and links to setup; its usage row and
refresh time remain absent from the SVG. A configured source without usable
data is shown as unavailable, not as zero. After its first success, failed
refreshes preserve the last good value, reporting period and observation time.
The builder reports the failure while the card remains readable.

## Codex

CodeStats reads the official `account/usage/read` method through your existing
**local Codex login**. The shareable `chatgpt.com/u/…` page requires a signed-in
viewer; its URL alone is not an anonymous statistics API for a Worker.

For a profile link, set `CODEX_USERNAME=your-id` or use `?codex=your-id`.
Provide a bare ID; CodeStats constructs `https://chatgpt.com/u/your-id` on the
fixed official host. A dynamic public ID shows that canonical link with unavailable
usage. It never reads the deployment owner's CLI, aggregate imports or stored
usage, even when the public ID matches the configured owner. A server-configured
ID enables the integration but does not authorize account-usage access.
The authenticated summary represents the
active local account/workspace, not a lookup of arbitrary IDs.

No ChatGPT cookie, access token, refresh token or conversation content is copied
to CodeStats or sent to a Worker. API-key-only and Bedrock logins do not provide
this account statistic. The summary follows the active account/workspace's
Work/Codex accounting, including cached context; it is not an API billing estimate.

### Card metrics

The period is labelled **Lifetime**. The five fields appear in this order:

| Card metric | Meaning |
| --- | --- |
| Total tokens | Official lifetime token count |
| Peak tokens | Highest daily token count in the official summary |
| Longest task | Longest reported task/turn, rounded to the nearest minute |
| Longest streak | Longest reported run of consecutive active days |
| Current streak | Current reported run of consecutive active days |

Exact task seconds remain in the source JSON and tooltip. Missing fields remain
unknown rather than becoming zero. Old total-only snapshots stay visible as
stale data while the full summary is refreshed or imported.

### Node

Install the Codex CLI and sign in normally as the operating-system account that
will run CodeStats. Set this in the ignored Node environment file:

```dotenv
# Enables the integration and adds a public profile link:
CODEX_USERNAME=your-id
# Optional override for collection without a configured ID/sync secret:
# CODEX_USAGE_ENABLED=true
```

Restart the service, then open `/build`. When Codex's cache is due, CodeStats
creates a short-lived `codex app-server --stdio` child to read the account
summary and closes only that child. It does not stop existing Codex sessions.
A hosted Node process needs access to that user's working local login; an ID,
sync secret or explicit enable flag alone does not establish that access.

### Cloudflare Worker

A Worker cannot run the local Codex CLI. Deploy the current CodeStats version,
then run its aggregate-only bridge from a machine already signed in to Codex
and Wrangler (`npx wrangler login`). The local `wrangler.jsonc` must name the
Worker serving the target HTTPS origin. Optionally set `CODEX_USERNAME` in that
Worker's runtime Variables for its public profile link.

There is one sync command and no separate initialization step:

```sh
npm run sync:codex -- https://your-worker.example
```

When `CODEX_SYNC_TOKEN` is omitted, the command reads local Codex usage and
verifies the target belongs to the configured Worker and Cloudflare account.
Only then does it generate a 32-byte random key (64 hexadecimal characters). It saves
it in ignored `.data/codex-sync.json` with private file permissions, then passes
it to the configured Worker's `wrangler secret put CODEX_SYNC_TOKEN` through
standard input. It never places the value in command arguments or logs.
Installing the Secret updates the Worker once and automatically enables imports.
Later syncs reuse the saved key without redeploying. If installation fails, the
same generated key remains available for the next run of the command.

Preserve the private sync-key file between runs. If `CODESTATS_DATA_DIR` is set,
the file lives there instead. The saved key is bound to its original origin;
for a different destination, use an explicitly configured shared token rather
than repurposing the saved key.

Automatic verification accepts its live `workers.dev` address or an enabled
production Custom Domain bound to that Worker. Unsupported proxy/route targets
require an explicitly configured token; an unverified target never changes a secret.

**Manual/Node imports:** an explicitly provided `CODEX_SYNC_TOKEN` is used as
configured and skips automatic Worker setup. Put the same independent secret
of at least 32 characters on the destination and in the local sync environment.
This is required for Node-server and HTTP loopback targets: Wrangler cannot
change a Node process's configuration. Never reuse a provider login credential.

The command reads the summary locally and sends only five numeric/null fields
and the observation time to `POST /api/usage/codex`. The bridge secret goes in an
Authorization header, never in the URL. The endpoint is disabled unless
explicitly configured, and rejects unauthenticated, oversized, invalid or older
observations. No timer or daemon is installed; use your existing maintenance
workflow when another sync is wanted.

The footer's Codex time is the **observation time**, not the visitor's page-load
time. A late or failed sync leaves the previous summary readable and eventually
stale. Visiting the Worker does not make old imported data look fresh.
An optional configured-profile cron also cannot renew that age; a newer bridge
observation is required. Public ID requests cannot receive or create these imports.

Official reference: [account token usage](https://learn.chatgpt.com/docs/app-server#7-token-usage-chatgpt).

## OpenRouter

Set `OPENROUTER_API_KEY` to an OpenRouter **Management key**. Ordinary inference
keys can report their spending but cannot read the account token analytics used
here. Management keys have broad administrative privileges; CodeStats calls only
the read-only analytics query. Keep the key server-side in a Worker Secret or an
ignored local environment file.

OpenRouter has no supported anonymous username usage API for this integration.
Public profile requests that select OpenRouter show it as unavailable rather than
reusing the deployment's key or account totals. Configure the Management key on
your own instance for the full five-metric row. There is no key field or
account-usage credential accepted by `/build` or image URL parameters.

### Card metrics

The five fields appear in this order, keeping token measurements together:

| Card metric | Calculation |
| --- | --- |
| Total tokens | Sum of all daily tokens across the returned account-wide aggregate |
| Tokens/day | Average daily tokens over every calendar day in the reporting interval, including inactive days |
| Tokens/week | Average daily tokens multiplied by seven |
| Total prompts | Sum of model request counts, not input tokens or individual chat messages |
| Longest streak | Longest consecutive run of UTC days with positive tokens in this reporting interval |

`Tokens/day` and `Tokens/week` are averages, not today's usage or the most recent
week's total. Total prompts counts API requests, even when one request contains
several chat messages.

### Query and coverage

CodeStats makes one `POST /api/v1/analytics/query` with
`metrics: ['tokens_total', 'request_count']`, `granularity: 'day'`, an explicit UTC
`time_range`, and no model dimensions or key/workspace filters. It aggregates all
models, keys and workspaces visible to the account. It does not traverse
individual generations or sum a website's top-model list.

By default, the collector requests the last **367 completed UTC days** and labels
them `Last 367 days`. Today's incomplete UTC day is excluded. To use a shorter
interval, set `OPENROUTER_USAGE_SINCE=YYYY-MM-DD` at UTC midnight. The label then
reads `Since YYYY-MM-DD`; the end remains the latest completed UTC day.

The collector supports at most 367 days in a single query. It rejects invalid or
longer intervals, incomplete/truncated responses, duplicate or out-of-range
days, and unexpected warnings instead of silently replacing a good snapshot
with partial totals. Sparse responses omit inactive days; those days still count
in averages and break streaks. All five metrics use the same reporting interval.

This is **bounded account-wide API usage**, not a claimed full-lifetime total and
not just traffic from the supplied inference key. The website's
**Settings → Profile → Activity** can cover a different tracked history and use
session-only interfaces. CodeStats does not copy website sessions or relabel its
bounded analytics as profile lifetime statistics.

Official references: [analytics query](https://openrouter.ai/docs/api/api-reference/analytics/query-analytics-data),
[metric schema and window limits](https://openrouter.ai/skills/openrouter-analytics-schema),
[Management keys](https://openrouter.ai/docs/guides/overview/auth/management-api-keys).

## Freshness and troubleshooting

| Builder status | Meaning | Next step |
| --- | --- | --- |
| Not enabled | The usage source is not enabled on this deployment | Follow its setup link and add the server-side setting; no credential is entered in `/build` |
| Unavailable | Configured, but no usable snapshot has succeeded yet | Read the source error in `/build`; verify login/key type and runtime settings |
| Fresh | A current-format observation is within the configured freshness window | Check the source's reporting period before comparing totals |
| Stale / saved data | A previous observation is still displayed while refresh is due or failing | Keep the cache; fix the source error, or sync Codex again |

For OpenRouter HTTP403, check that the configured credential is a **Management
key**, not an inference key. For missing Worker credentials, verify runtime
Secrets rather than build-only secrets. For Codex on Node, verify the service
user's local Codex login; for a Worker, verify the local Wrangler login, matching
Worker name/origin and last successful sync. Keep a generated key after an
installation failure and rerun the same command. Check that an explicit
`CODEX_USAGE_ENABLED=false` is not disabling it. Never paste credentials into
the card URL or public logs.

Default freshness is six hours and failed refreshes use a fifteen-minute retry
cooldown. Upstream changes and GitHub's image cache may delay visible updates.
The card retains per-source timestamps and may wrap the refresh footer when
more configured sources or longer ages need space.

## Advanced: Anthropic API

The optional Anthropic adapter is an extension to the four-source setup. Set
`ANTHROPIC_ADMIN_KEY` to an organization Admin credential to show an additional
**Anthropic API** row after OpenRouter. Without that setting, no row appears.

This measures Claude **API organization usage**, not a personal Claude Pro/Max
subscription or an anonymous personal profile. The collector reads
`/v1/organizations/usage_report/messages` without grouping filters. The default is
30 completed UTC days; `ANTHROPIC_USAGE_SINCE=YYYY-MM-DD` changes the start.
It sums uncached input, cache reads, both cache-creation categories and output.

Daily bucket pages must complete within a finite 32-page/45-second budget before
a success is saved. Partial runs preserve the previous total. The adapter is
covered by isolated schema/error tests; a deployment without an Admin key has no
live Anthropic acceptance result.

Official reference: [Usage and Cost API](https://platform.claude.com/docs/en/manage-claude/usage-cost-api).
