import { spawn } from 'node:child_process';

export interface CodexUsageSummary {
    lifetimeTokens: number | null;
    peakDailyTokens: number | null;
    longestRunningTurnSec: number | null;
    currentStreakDays: number | null;
    longestStreakDays: number | null;
}

export interface CodexUsageReading {
    summary: CodexUsageSummary;
    observedAt: string;
}

interface CodexReadOptions {
    spawn?: typeof spawn;
    timeoutMs?: number;
    now?: () => Date;
}

function summaryFrom(value: unknown): CodexUsageSummary {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Codex returned an invalid usage summary.');
    }
    const source = value as Record<string, unknown>;
    const fields = ['lifetimeTokens', 'peakDailyTokens', 'longestRunningTurnSec',
        'currentStreakDays', 'longestStreakDays'] as const;
    const summary = {} as CodexUsageSummary;
    for (const key of fields) {
        const item = source[key];
        if (item !== null && (typeof item !== 'number'
            || !Number.isFinite(item) || item < 0
            || (key !== 'longestRunningTurnSec' && !Number.isSafeInteger(item)))) {
            throw new Error('Codex returned an invalid usage summary.');
        }
        summary[key] = item;
    }
    return summary;
}

/** Read account aggregates through Codex's own login, never its credentials. */
export function readCodexUsage(
    options: CodexReadOptions = {},
): Promise<CodexUsageReading> {
    return new Promise((accept, reject) => {
        const environment = { ...process.env };
        for (const key of ['CODEX_SYNC_TOKEN', 'OPENROUTER_API_KEY',
            'ANTHROPIC_ADMIN_KEY', 'GITHUB_TOKEN', 'GH_TOKEN', 'WAKATIME_TOKEN']) {
            delete environment[key];
        }
        let child: ReturnType<typeof spawn>;
        try {
            child = (options.spawn ?? spawn)('codex', ['app-server', '--stdio'], {
                stdio: ['pipe', 'pipe', 'pipe'],
                windowsHide: true,
                env: environment,
            });
        } catch {
            reject(new Error('Could not start the local Codex app-server.'));
            return;
        }
        let settled = false;
        let initialized = false;
        let buffer = '';
        let bytes = 0;
        let killTimer: ReturnType<typeof setTimeout> | undefined;
        const timeout = setTimeout(() => finish(
            new Error('Codex usage read timed out.'),
        ), options.timeoutMs ?? 30_000);

        function finish(error?: Error, value?: CodexUsageReading) {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            buffer = '';
            child.stdin?.end();
            // Only terminate the app-server child created by this call.
            child.kill('SIGTERM');
            killTimer = setTimeout(() => {
                if (child.exitCode === null && child.signalCode === null) {
                    child.kill('SIGKILL');
                }
            }, 500);
            killTimer.unref();
            if (error) reject(error);
            else accept(value!);
        }

        function send(message: unknown) {
            if (!child.stdin || child.stdin.destroyed) {
                finish(new Error('Codex app-server input is unavailable.'));
                return;
            }
            child.stdin.write(JSON.stringify(message) + '\n');
        }

        child.once('error', () => finish(
            new Error('Could not start the local Codex app-server.'),
        ));
        child.once('close', () => {
            if (killTimer) clearTimeout(killTimer);
            finish(new Error('Codex app-server ended before returning usage.'));
        });
        child.stdin?.on('error', () => finish(
            new Error('Codex app-server input is unavailable.'),
        ));
        // Drain private diagnostics without printing or retaining them.
        child.stderr?.resume();
        child.stdout?.setEncoding('utf8');
        child.stdout?.on('error', () => finish(
            new Error('Could not read local Codex app-server output.'),
        ));
        child.stdout?.on('data', (chunk: string) => {
            if (settled) return;
            bytes += Buffer.byteLength(chunk);
            if (bytes > 1024 * 1024) {
                finish(new Error('Codex usage response exceeded the size limit.'));
                return;
            }
            buffer += chunk;
            let end: number;
            while (!settled && (end = buffer.indexOf('\n')) !== -1) {
                const line = buffer.slice(0, end).trim();
                buffer = buffer.slice(end + 1);
                if (!line) continue;
                try {
                    const message = JSON.parse(line) as Record<string, unknown>;
                    if (!message || typeof message !== 'object'
                        || Array.isArray(message)) {
                        throw new Error();
                    }
                    if (message.id === 1 && !initialized) {
                        if (message.error || !message.result) {
                            finish(new Error('Codex app-server initialization failed.'));
                            return;
                        }
                        initialized = true;
                        send({ method: 'initialized' });
                        send({ id: 2, method: 'account/usage/read' });
                    } else if (message.id === 2 && initialized) {
                        if (message.error) {
                            finish(new Error('Codex usage is unavailable; '
                                + 'use a supported Codex-service login.'));
                            return;
                        }
                        const result = message.result as Record<string, unknown>;
                        const summary = summaryFrom(result?.summary);
                        finish(undefined, { summary,
                            observedAt: (options.now?.() ?? new Date()).toISOString() });
                    }
                } catch {
                    finish(new Error('Codex returned an invalid usage summary.'));
                }
            }
        });
        send({ id: 1, method: 'initialize', params: {
            clientInfo: { name: 'codestats', version: '0.1.0' },
            capabilities: { experimentalApi: true },
        } });
    });
}
