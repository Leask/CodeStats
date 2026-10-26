import { describe, expect, it } from 'vitest';
import { profileRank } from '../src/rank';
import type { GitHubActivityData, GitHubData } from '../src/types';

const github = {
    pullRequests: 648, issues: 288, stars: 1386, followers: 501,
} as GitHubData;
const activity = { commits: 47439, reviewContributions: 479 } as GitHubActivityData;

describe('Reference-project rank model', () => {
    it('matches the reference formula for the observed aggregate inputs', () => {
        expect(profileRank(github, activity)).toEqual({
            level: 'A+', percentile: 1.3296854813310333,
        });
    });

    it('uses no invented score when either dataset is unavailable', () => {
        expect(profileRank(null, activity)).toBeNull();
        expect(profileRank(github, null)).toBeNull();
        expect(profileRank({ ...github, stars: NaN }, activity)).toBeNull();
    });

    it('handles empty accounts and does not include repository counts in the score', () => {
        expect(profileRank({ ...github, pullRequests: 0, issues: 0,
            stars: 0, followers: 0 }, { ...activity, commits: 0, reviewContributions: 0 }))
            .toEqual({ level: 'C', percentile: 100 });
        expect(profileRank({ ...github, repositories: 1_000_000 }, activity))
            .toEqual(profileRank(github, activity));
        expect(profileRank({ ...github, stars: 10_000 }, activity)?.percentile)
            .toBeLessThan(profileRank(github, activity)!.percentile);
    });
});
