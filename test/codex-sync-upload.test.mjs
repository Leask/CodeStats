import { describe, expect, it, vi } from 'vitest';
import { uploadObservation } from '../scripts/sync-codex.mjs';

const target = new URL('https://fixture.workers.dev/api/usage/codex');
const token = 'isolated-upload-test-secret';
const reading = { observedAt: '2026-10-28T00:00:00Z' };

describe('Codex sync after Worker secret provisioning', () => {
    it('waits for rejected pre-save requests, then sends one accepted observation', async () => {
        const send = vi.fn()
            .mockResolvedValueOnce(new Response('Not configured', { status: 404 }))
            .mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))
            .mockResolvedValueOnce(new Response('{}'));
        const wait = vi.fn(async () => {});
        await uploadObservation(target, token, reading, { fetch: send, wait });
        expect(send).toHaveBeenCalledTimes(3);
        expect(wait.mock.calls).toEqual([[1000], [2000]]);
        for (const [url, request] of send.mock.calls) {
            expect(url).toBe(target);
            expect(request.redirect).toBe('manual');
            expect(request.body).toBe(JSON.stringify(reading));
            expect(request.headers.Authorization).toBe('Bearer ' + token);
        }
    });

    it('bounds secret propagation waits to 31 seconds', async () => {
        const send = vi.fn(async () => new Response('', { status: 401 }));
        const wait = vi.fn(async () => {});
        await expect(uploadObservation(target, token, reading, { fetch: send, wait }))
            .rejects.toThrow('HTTP 401');
        expect(send).toHaveBeenCalledTimes(6);
        expect(wait.mock.calls.flat().reduce((a, b) => a + b, 0)).toBe(31_000);
    });

    it.each([400, 500, 503])('does not repeat an HTTP %s write', async status => {
        const send = vi.fn(async () => new Response('', { status }));
        const wait = vi.fn(async () => {});
        await expect(uploadObservation(target, token, reading, { fetch: send, wait }))
            .rejects.toThrow('HTTP ' + status);
        expect(send).toHaveBeenCalledTimes(1);
        expect(wait).not.toHaveBeenCalled();
    });

    it('does not repeat uncertain network results or expose their diagnostics', async () => {
        const send = vi.fn(async () => { throw new Error(token); });
        await expect(uploadObservation(target, token, reading, { fetch: send }))
            .rejects.toThrow('could not be reached');
        expect(send).toHaveBeenCalledTimes(1);
    });
});
