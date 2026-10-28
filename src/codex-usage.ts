import type { AIUsageData } from './ai-usage';
import { UpstreamError } from './errors';

/** Only aggregate fields are accepted; authentication never enters this payload. */
export function normalizeCodexUsage(
    value: unknown, now = Date.now(),
): { data: AIUsageData; observedAt: string } {
    if (!value || typeof value !== 'object') {
        throw new UpstreamError('Codex usage payload is invalid.');
    }
    const payload = value as Record<string, unknown>;
    const summary = payload.summary as Record<string, unknown> | null;
    const at = typeof payload.observedAt === 'string'
        ? Date.parse(payload.observedAt) : NaN;
    if (!summary || typeof summary !== 'object' || Array.isArray(summary)
        || !Number.isFinite(at) || at > now + 60_000) {
        throw new UpstreamError('Codex usage summary or observation time is invalid.');
    }
    for (const field of ['lifetimeTokens', 'peakDailyTokens',
        'longestRunningTurnSec', 'currentStreakDays', 'longestStreakDays']) {
        const number = summary[field];
        if (number !== null && (typeof number !== 'number'
            || !Number.isFinite(number) || number < 0
            || (field !== 'longestRunningTurnSec' && !Number.isSafeInteger(number)))) {
            throw new UpstreamError('Codex usage summary is incomplete.');
        }
    }
    return {
        observedAt: new Date(at).toISOString(),
        data: {
            service: 'codex', label: 'Codex',
            totalTokens: summary.lifetimeTokens as number | null,
            period: 'Lifetime tokens', since: null,
            until: new Date(at).toISOString(),
            scope: 'Official ChatGPT account token activity for the active workspace; '
                + 'includes Work/Codex activity under the provider accounting rules. '
                + 'Not an API billing total or a sum with other providers.',
        },
    };
}
