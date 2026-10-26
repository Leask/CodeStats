import { describe, expect, it } from 'vitest';
import { fetchAvatar, profileText, publicStatus } from '../src/github-profile';
import type { Fetcher } from '../src/types';

describe('Public GitHub profile metadata', () => {
    it('normalizes blank descriptions and preserves bio text as plain text', () => {
        expect(profileText(null)).toBeNull();
        expect(profileText(' \n ')).toBeNull();
        expect(profileText('  Builds\n<script>tools</script>  '))
            .toBe('Builds <script>tools</script>');
    });

    it('publishes only a public and unexpired status message', () => {
        const status = { message: 'Building', organization: null, expiresAt: null };
        expect(publicStatus(status)).toBe('Building');
        expect(publicStatus({ ...status, organization: { id: 'private-org' } })).toBeNull();
        expect(publicStatus({ ...status, organization: undefined })).toBeNull();
        expect(publicStatus({ ...status, expiresAt: '2020-01-01T00:00:00Z' })).toBeNull();
        expect(publicStatus({ ...status, expiresAt: 'invalid' })).toBeNull();
    });

    it('embeds raster bytes without sending API authentication or following redirects', async () => {
        const bytes = new Uint8Array([137, 80, 78, 71]);
        const fetcher = (async (input, init) => {
            expect(String(input)).toBe('https://avatars.githubusercontent.com/u/123?s=128');
            expect(init?.headers).toBeUndefined();
            expect(init?.redirect).toBe('manual');
            return new Response(bytes, { headers: { 'content-type': 'image/png' } });
        }) as Fetcher;
        expect(await fetchAvatar('https://avatars.githubusercontent.com/u/123?s=128', fetcher))
            .toBe('data:image/png;base64,iVBORw==');
    });

    it('does not fetch untrusted avatar origins', async () => {
        const fetcher = (async () => { throw new Error('Unexpected request'); }) as Fetcher;
        for (const url of ['http://avatars.githubusercontent.com/u/1',
            'https://example.com/u/1', 'https://token@avatars.githubusercontent.com/u/1']) {
            expect(await fetchAvatar(url, fetcher)).toBeNull();
        }
    });

    it('rejects SVG, redirects and oversized bodies while tolerating image failures', async () => {
        const url = 'https://avatars.githubusercontent.com/u/1';
        for (const response of [
            new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }),
            new Response(null, { status: 302, headers: { location: 'https://example.com' } }),
            new Response(new Uint8Array(128 * 1024 + 1), {
                headers: { 'content-type': 'image/png' },
            }),
        ]) {
            expect(await fetchAvatar(url, (async () => response) as Fetcher)).toBeNull();
        }
        expect(await fetchAvatar(url, (async () => { throw new Error('offline'); }) as Fetcher))
            .toBeNull();
    });
});
