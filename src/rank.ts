import type { GitHubActivityData, GitHubData } from './types';

// Adapted from GitHub Stats Extended calculateRank.ts; MIT notice in third_party.
const LEVELS = ['S', 'A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C'];
const THRESHOLDS = [1, 12.5, 25, 37.5, 50, 62.5, 75, 87.5, 100];

/** Reference heuristic percentile, using the lifetime-commit normalization. */
export function profileRank(
    github: GitHubData | null, activity: GitHubActivityData | null,
): { level: string; percentile: number } | null {
    if (!github || !activity) return null;
    const values = [activity.commits, github.pullRequests, github.issues,
        activity.reviewContributions, github.stars, github.followers];
    if (!values.every((value): value is number => typeof value === 'number'
        && Number.isSafeInteger(value) && value >= 0)) return null;
    const [commits, prs, issues, reviews, stars, followers] = values;
    const exponential = (value: number) => 1 - 2 ** -value;
    const normalized = (value: number) => value / (1 + value);
    const score = 2 * exponential(commits / 1000)
        + 3 * exponential(prs / 50)
        + exponential(issues / 25)
        + exponential(reviews / 2)
        + 4 * normalized(stars / 50)
        + normalized(followers / 10);
    const percentile = Math.max(0, Math.min(100, 100 * (1 - score / 12)));
    return { level: LEVELS[THRESHOLDS.findIndex(limit => percentile <= limit)],
        percentile };
}
