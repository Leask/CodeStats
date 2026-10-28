import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawnSync } from 'node:child_process';
import type { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readCodexUsage } from '../src/codex-node';

const summary = { lifetimeTokens: 1234567, peakDailyTokens: 45678,
    longestRunningTurnSec: 540.5, currentStreakDays: 8, longestStreakDays: 14 };
const processes: Array<ReturnType<typeof fixture>> = [];

function fixture(reply?: (message: Record<string, unknown>) => unknown) {
    const child = new EventEmitter() as ChildProcessWithoutNullStreams & {
        stdout: PassThrough;
        stderr: PassThrough;
    };
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    Object.defineProperties(child, {
        exitCode: { value: null }, signalCode: { value: null },
    });
    child.kill = vi.fn(() => {
        queueMicrotask(() => child.emit('close', 0));
        return true;
    });
    const requests: Array<Record<string, unknown>> = [];
    child.stdin.on('data', (chunk: Buffer) => {
        for (const line of chunk.toString().trim().split('\n')) {
            const message = JSON.parse(line) as Record<string, unknown>;
            requests.push(message);
            const response = reply?.(message);
            if (response !== undefined) {
                queueMicrotask(() => child.stdout.write(JSON.stringify(response) + '\n'));
            }
        }
    });
    const start = vi.fn(() => child) as unknown as typeof spawn;
    return { child, start, requests };
}

function server(reply?: (message: Record<string, unknown>) => unknown) {
    const process = fixture(reply);
    processes.push(process);
    return process;
}

afterEach(() => {
    for (const process of processes.splice(0)) {
        process.child.stdin.destroy();
        process.child.stdout.destroy();
        process.child.stderr.destroy();
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
});

describe('local Codex account-usage bridge', () => {
    it('reads only five summary metrics after initializing its own app-server', async () => {
        const source = server(message => message.id === 1 ? { id: 1,
            result: { userAgent: 'fixture' } } : message.id === 2 ? {
            id: 2, result: { summary: { ...summary, privateAccount: 'not-public' },
                dailyUsageBuckets: [{ privateThread: 'not-public' }] },
        } : undefined);
        vi.stubEnv('CODEX_SYNC_TOKEN', 'fixture-sync-secret');
        const info = await readCodexUsage({ spawn: source.start,
            now: () => new Date('2026-10-28T12:00:00Z') });
        expect(info).toEqual({ summary, observedAt: '2026-10-28T12:00:00.000Z' });
        expect(JSON.stringify(info)).not.toContain('not-public');
        expect(source.requests.map(value => value.method)).toEqual([
            'initialize', 'initialized', 'account/usage/read',
        ]);
        expect(source.requests[0]).toMatchObject({ params: {
            clientInfo: { name: 'codestats' },
            capabilities: { experimentalApi: true },
        } });
        const call = vi.mocked(source.start).mock.calls[0];
        expect(call.slice(0, 2)).toEqual(['codex', ['app-server', '--stdio']]);
        expect(call[2]).toMatchObject({ stdio: ['pipe', 'pipe', 'pipe'] });
        expect(call[2]?.env).not.toHaveProperty('CODEX_SYNC_TOKEN');
        expect(source.child.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('preserves service-reported nulls without replacing them with zeros', async () => {
        const unknown = Object.fromEntries(Object.keys(summary).map(key => [key, null]));
        const source = server(message => message.id === 1
            ? { id: 1, result: {} } : message.id === 2
                ? { id: 2, result: { summary: unknown } } : undefined);
        expect((await readCodexUsage({ spawn: source.start })).summary).toEqual(unknown);
    });

    it('sanitizes unsupported-login errors and drains private diagnostics', async () => {
        const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const source = server(message => {
            source.child.stderr.write('private-auth-diagnostic');
            return message.id === 1 ? { id: 1, result: {} } : message.id === 2
                ? { id: 2, error: { message: 'private-auth-diagnostic', code: -1 } }
                : undefined;
        });
        await expect(readCodexUsage({ spawn: source.start })).rejects.toThrow(
            'use a supported Codex-service login',
        );
        expect(output).not.toHaveBeenCalled();
        expect(errors).not.toHaveBeenCalled();
    });

    it('times out and terminates only its own child', async () => {
        vi.useFakeTimers();
        const source = server();
        const request = expect(readCodexUsage({ spawn: source.start,
            timeoutMs: 30_000 })).rejects.toThrow('timed out');
        await vi.advanceTimersByTimeAsync(30_000);
        await request;
        expect(source.child.kill).toHaveBeenCalledTimes(1);
        expect(source.child.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it.each([
        { ...summary, lifetimeTokens: -1 },
        { ...summary, lifetimeTokens: '123' },
        { ...summary, currentStreakDays: 1.2 },
        { ...summary, lifetimeTokens: Number.MAX_SAFE_INTEGER + 1 },
        { lifetimeTokens: 1 },
        null,
    ])('rejects invalid or incomplete summaries', async (invalid) => {
        const source = server(message => message.id === 1 ? { id: 1, result: {} }
            : message.id === 2 ? { id: 2, result: { summary: invalid } } : undefined);
        await expect(readCodexUsage({ spawn: source.start })).rejects.toThrow(
            'invalid usage summary',
        );
    });

    it('bounds response size and never exposes unframed stdout', async () => {
        const source = server();
        const reading = readCodexUsage({ spawn: source.start });
        source.child.stdout.write('private-diagnostic'.repeat(70_000));
        await expect(reading).rejects.toThrow('exceeded the size limit');
    });

    it('sanitizes binary launch failures', async () => {
        const start = vi.fn(() => { throw new Error('private-path-or-environment'); });
        await expect(readCodexUsage({ spawn: start as unknown as typeof spawn }))
            .rejects.toThrow('Could not start the local Codex app-server.');
    });

    it.each([
        'http://example.com', 'file:///tmp/fixture',
        'https://user:password@example.com', 'https://example.com/path',
        'https://example.com/?token=fixture',
    ])('rejects unsafe sync targets before reading local Codex', target => {
        const result = spawnSync(process.execPath,
            ['scripts/sync-codex.mjs', target], {
                encoding: 'utf8',
                env: { ...process.env, CODEX_SYNC_TOKEN: 'fixture-sync-secret' },
            });
        expect(result.status).toBe(1);
        expect(result.stdout).toBe('');
        expect(result.stderr).toContain('Use an HTTPS origin');
        expect(result.stderr).not.toContain('fixture-sync-secret');
        expect(result.stderr).not.toContain('password');
    });
});
