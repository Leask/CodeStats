export const RANGES = ['all_time', 'last_7_days', 'last_30_days'] as const;
export type Range = typeof RANGES[number];
export type AIService = 'openrouter' | 'codex' | 'anthropic';
export type { AIUsageData } from './ai-usage';
import type { AIUsageData } from './ai-usage';

export interface GitHubData {
    collectionVersion?: 4 | 5 | 6 | 7;
    repositoryAffiliations?: string[];
    includeForks?: boolean;
    analyzedForks?: number;
    username: string;
    name: string;
    bio?: string | null;
    profileStatus?: string | null;
    avatarDataUri?: string | null;
    followers: number;
    publicRepositories?: number;
    repositories?: number;
    privateRepositories?: number;
    visibility?: 'public' | 'all';
    analyzedRepositories: number;
    stars?: number;
    forks?: number;
    pullRequests?: number;
    mergedPullRequests?: number;
    issues?: number;
    languages: Array<{ name: string; bytes: number; color: string }>;
    /** Internal aggregate membership counts; omitted from public JSON. */
    repositoryLanguageCounts?: RepositoryLanguageCount[];
    totalBytes?: number;
    accessMode?: 'public' | 'token';
    languageCoverage?: 'complete' | 'unavailable';
    scope: string;
}

/** Frequencies of language sets, without repository names or identities. */
export interface RepositoryLanguageCount {
    languages: string[];
    repositories: number;
}

/** Aggregate personal activity; never expose private repository identities. */
export interface GitHubActivityData {
    /** Missing on older saved snapshots that omitted review-only repositories. */
    collectionVersion?: 2 | 3;
    includesOwnRepositories?: boolean;
    username: string;
    visibility: 'public' | 'all';
    scope: string;
    commits?: number;
    pullRequestsCommented?: number;
    pullRequestsReviewed?: number;
    issuesCommented?: number;
    discussionsStarted?: number;
    discussionsAnswered?: number;
    reviewContributions?: number;
    contributedRepositories?: number;
    allTimeContributedRepositories?: number;
    allTimeContributions?: number;
    contributionsByYear: Array<{ year: number; contributions: number }>;
    recentFrom?: string;
    recentTo?: string;
    allTimeFrom?: string;
    allTimeTo?: string;
    organizationCount?: number;
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
    accessMode?: 'public' | 'oauth';
}

export interface SourceSnapshot<T> {
    data: T | null;
    lastSuccessAt: string | null;
    lastAttemptAt: string | null;
    lastError: string | null;
    retryAt: string | null;
    status: 'fresh' | 'stale' | 'unavailable';
    enabled?: boolean;
}

export interface StatsSnapshot {
    schemaVersion: 1;
    github: SourceSnapshot<GitHubData>;
    githubActivity?: SourceSnapshot<GitHubActivityData>;
    wakatime: SourceSnapshot<WakaData>;
    /** Optional services are absent unless configured by the deployment owner. */
    aiUsage?: Partial<Record<AIService, SourceSnapshot<AIUsageData>>>;
    range: Range;
    generatedAt: string;
    selectedSources?: Array<'github' | 'wakatime' | 'codex' | 'openrouter'>;
    profile?: {
        mode: 'configured' | 'public';
        accounts: { github?: string; wakatime?: string; codex?: string };
    };
}

export interface LanguageRow {
    name: string;
    color: string;
    seconds: number;
    timePercent: number;
    codeBytes: number | null;
    codePercent: number | null;
    /** Distinct repositories using any language in this merged group. */
    repositoryCount?: number | null;
}

export interface CardOptions {
    theme: 'dark' | 'light' | 'transparent';
    view: 'overview' | 'languages' | 'activity' | 'github' | 'wakatime'
        | 'codex' | 'openrouter';
    limit: number;
    sort: 'alternating' | 'time' | 'code' | 'name';
    /** Include the profile block; shown unless explicitly disabled. */
    header?: boolean;
}

export interface Settings {
    GITHUB_USERNAME: string;
    WAKATIME_USERNAME: string;
    DEFAULT_RANGE?: string;
    FRESH_SECONDS: string;
    RETRY_SECONDS: string;
    GITHUB_TOKEN?: string;
    GITHUB_VISIBILITY?: 'public' | 'all';
    GITHUB_REPOSITORY_AFFILIATIONS?: string;
    GITHUB_INCLUDE_FORKS?: string;
    GITHUB_INCLUDE_OWN_CONTRIBUTIONS?: string;
    WAKATIME_TOKEN?: string;
    OPENROUTER_API_KEY?: string;
    OPENROUTER_USAGE_SINCE?: string;
    ANTHROPIC_ADMIN_KEY?: string;
    ANTHROPIC_USAGE_SINCE?: string;
    CODEX_USAGE_ENABLED?: string;
    CODEX_USERNAME?: string;
    CODEX_SYNC_TOKEN?: string;
    AUTO_REFRESH_SECONDS?: string;
}

export interface Env extends Settings {
    SNAPSHOTS: DurableObjectNamespace;
}

export type Fetcher = typeof fetch;
