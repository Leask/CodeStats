/** A controlled upstream message safe for public source-status output. */
export class UpstreamError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'UpstreamError';
    }
}
