export const RANGES = ['all_time', 'last_7_days', 'last_30_days'] as const;
export type Range = typeof RANGES[number];

export interface GitHubData {
    username: string;
    name: string;
    followers: number;
    publicRepositories: number;
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
    sort: 'time' | 'code' | 'name';
}

export interface Env {
    SNAPSHOTS: DurableObjectNamespace;
    GITHUB_USERNAME: string;
    WAKATIME_USERNAME: string;
    DEFAULT_RANGE: string;
    FRESH_SECONDS: string;
    RETRY_SECONDS: string;
    GITHUB_TOKEN?: string;
    WAKATIME_TOKEN?: string;
}

export type Fetcher = typeof fetch;
