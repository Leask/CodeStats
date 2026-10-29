import type { Settings } from './types';
import { UpstreamError } from './errors';
import { codexUsageEnabled } from './profile';

export const CODEX_IMPORT_PATH = '/api/usage/codex';
export const MAX_USAGE_BODY = 16_384;

/** A narrow write path: a separate secret authorizes aggregate imports only. */
export async function importCodexRequest(
    request: Request, settings: Settings,
    save: (payload: unknown) => Promise<void>,
): Promise<Response> {
    const headers = { 'Cache-Control': 'no-store' };
    if (request.method !== 'POST') {
        return new Response('Method not allowed', {
            status: 405, headers: { ...headers, Allow: 'POST' },
        });
    }
    const secret = settings.CODEX_SYNC_TOKEN?.trim();
    if (!codexUsageEnabled(settings) || !secret) {
        return new Response('Codex import is not configured.', { status: 404, headers });
    }
    if (secret.length < 32) {
        return new Response('Configure a Codex sync secret of at least 32 characters.', {
            status: 503, headers,
        });
    }
    const expected = 'Bearer ' + secret;
    const supplied = request.headers.get('Authorization') ?? '';
    let mismatch = supplied.length ^ expected.length;
    for (let index = 0; index < expected.length; index++) {
        mismatch |= expected.charCodeAt(index) ^ (supplied.charCodeAt(index) || 0);
    }
    if (mismatch !== 0) {
        return new Response('Unauthorized', { status: 401, headers });
    }
    if (request.headers.get('Content-Type')?.split(';')[0].trim()
        !== 'application/json') {
        return new Response('Expected application/json.', { status: 415, headers });
    }
    const reader = request.body?.getReader();
    if (!reader) return new Response('Missing usage payload.', { status: 400, headers });
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_USAGE_BODY) {
            await reader.cancel();
            return new Response('Usage payload is too large.', { status: 413, headers });
        }
        chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    let payload: unknown;
    try {
        payload = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
        return new Response('Invalid usage JSON.', { status: 400, headers });
    }
    try {
        await save(payload);
    } catch (error) {
        return new Response(error instanceof UpstreamError
            ? error.message : 'Could not save Codex aggregates.', {
            status: error instanceof UpstreamError ? 400 : 503, headers,
        });
    }
    return Response.json({ saved: true }, { headers });
}
