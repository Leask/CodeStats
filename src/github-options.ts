import { UpstreamError } from './errors';
import type { Settings } from './types';

const AFFILIATIONS = ['OWNER', 'COLLABORATOR', 'ORGANIZATION_MEMBER'];

/** GitHub's native repository filters; no participation/commit discovery. */
export function repositoryOptions(env: Pick<Settings,
    'GITHUB_REPOSITORY_AFFILIATIONS' | 'GITHUB_INCLUDE_FORKS'>) {
    const affiliations = (env.GITHUB_REPOSITORY_AFFILIATIONS
        ?? AFFILIATIONS.join(',')).split(',').map(value => value.trim());
    if (!affiliations.length
        || affiliations.some(value => !AFFILIATIONS.includes(value))) {
        throw new UpstreamError('GitHub repository affiliations are invalid.');
    }
    const includeForks = env.GITHUB_INCLUDE_FORKS ?? 'true';
    if (!['true', 'false'].includes(includeForks)) {
        throw new UpstreamError('GITHUB_INCLUDE_FORKS must be true or false.');
    }
    return {
        affiliations: [...new Set(affiliations)].sort(),
        includeForks: includeForks === 'true',
    };
}
