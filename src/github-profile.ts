import type { Fetcher } from './types';

const MAX_AVATAR_BYTES = 128 * 1024;

export function profileText(value: unknown): string | null {
    return typeof value === 'string' && value.trim()
        ? value.trim().replace(/\s+/g, ' ').slice(0, 1024) : null;
}

/** Organization-only statuses must never enter a public README card. */
export function publicStatus(value: unknown, now = Date.now()): string | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const status = value as Record<string, unknown>;
    if (status.organization !== null) return null;
    if (status.expiresAt != null && (typeof status.expiresAt !== 'string'
        || !Number.isFinite(Date.parse(status.expiresAt))
        || Date.parse(status.expiresAt) <= now)) return null;
    return profileText(status.message);
}

/** Embed a small public avatar so SVG image consumers need no nested requests. */
export async function fetchAvatar(
    value: unknown, fetcher: Fetcher,
): Promise<string | null> {
    try {
        if (typeof value !== 'string' || value.length > 2048) return null;
        const url = new URL(value);
        if (url.origin !== 'https://avatars.githubusercontent.com'
            || url.username || url.password) return null;
        const response = await fetcher(url.toString(), {
            redirect: 'manual', signal: AbortSignal.timeout(5000),
        });
        const mime = response.headers.get('content-type')?.split(';')[0];
        if (!response.ok || !mime || !/^image\/(png|jpeg|webp|gif)$/.test(mime)
            || Number(response.headers.get('content-length')) > MAX_AVATAR_BYTES) {
            await response.body?.cancel();
            return null;
        }
        const reader = response.body?.getReader();
        if (!reader) return null;
        let binary = '';
        for (;;) {
            const { value: chunk, done } = await reader.read();
            if (done) break;
            if (binary.length + chunk.length > MAX_AVATAR_BYTES) {
                await reader.cancel();
                return null;
            }
            for (const byte of chunk) binary += String.fromCharCode(byte);
        }
        return binary ? `data:${mime};base64,${btoa(binary)}` : null;
    } catch {
        // A missing optional image must not discard successful GitHub metrics.
        return null;
    }
}
