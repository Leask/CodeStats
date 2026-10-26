export const RANGES = ['all_time', 'last_7_days', 'last_30_days'] as const;
export type Range = typeof RANGES[number];

export interface GitHubData {
    collectionVersion?: 4 | 5 | 6;
    repositoryAffiliations?: string[];
    includeForks?: boolean;
    analyzedForks?: number;
    username: string;
    name: string;
    bio?: string | null;
    profileStatus?: string | null;
    avatarDataUri?: string | null;
    followers: number;
    publicRepositories: number;
    repositories?: number;
    privateRepositories?: number;
    visibility?: 'public' | 'all';
    analyzedRepositories: number;
    stars: number;
    forks: number;
    pullRequests: number;
    mergedPullRequests: number;
    issues: number;
    languages: Array<{ name: string; bytes: number; color: string }>;
    totalBytes: number;
    scope: string;
}

/** Aggregate personal activity; never expose private repository identities. */
export interface GitHubActivityData {
    /** Missing on older saved snapshots that omitted review-only repositories. */
    collectionVersion?: 2 | 3;
    includesOwnRepositories?: boolean;
    username: string;
    visibility: 'public' | 'all';
    scope: string;
    commits: number;
    pullRequestsCommented: number;
    pullRequestsReviewed: number;
    issuesCommented: number;
    discussionsStarted: number;
    discussionsAnswered: number;
    reviewContributions: number;
    contributedRepositories: number;
    allTimeContributedRepositories: number;
    allTimeContributions: number;
    contributionsByYear: Array<{ year: number; contributions: number }>;
    recentFrom: string;
    recentTo: string;
    allTimeFrom: string;
    allTimeTo: string;
    organizationCount: number;
}

export interface WakaData {
    username: string;
    range: Range;
    totalSeconds: number;
    dailyAverageSeconds: number;
    start: string | null;
    end: string | null;
    includesToday: boolean;
    rangeLabel: string | null;
    languages: Array<{ name: string; seconds: number; percent: number }>;
}

export interface SourceSnapshot<T> {
    data: T | null;
    lastSuccessAt: string | null;
    lastAttemptAt: string | null;
    lastError: string | null;
    retryAt: string | null;
    status: 'fresh' | 'stale' | 'unavailable';
}

export interface StatsSnapshot {
    schemaVersion: 1;
    github: SourceSnapshot<GitHubData>;
    githubActivity?: SourceSnapshot<GitHubActivityData>;
    wakatime: SourceSnapshot<WakaData>;
    range: Range;
    generatedAt: string;
}

export interface LanguageRow {
    name: string;
    color: string;
    seconds: number;
    timePercent: number;
    codeBytes: number | null;
    codePercent: number | null;
}

export interface CardOptions {
    theme: 'dark' | 'light' | 'transparent';
    view: 'overview' | 'languages' | 'activity';
    limit: number;
    sort: 'alternating' | 'time' | 'code' | 'name';
    /** Include the profile block; shown unless explicitly disabled. */
    header?: boolean;
}

export interface Settings {
    GITHUB_USERNAME: string;
    WAKATIME_USERNAME: string;
    DEFAULT_RANGE: string;
    FRESH_SECONDS: string;
    RETRY_SECONDS: string;
    GITHUB_TOKEN?: string;
    GITHUB_VISIBILITY?: 'public' | 'all';
    GITHUB_REPOSITORY_AFFILIATIONS?: string;
    GITHUB_INCLUDE_FORKS?: string;
    GITHUB_INCLUDE_OWN_CONTRIBUTIONS?: string;
    WAKATIME_TOKEN?: string;
}

export interface Env extends Settings {
    SNAPSHOTS: DurableObjectNamespace;
}

export type Fetcher = typeof fetch;
