import { UpstreamError } from './errors';
import {
    count,
    createGitHubClient,
    object,
    page,
    text,
} from './github-api';
import type { JsonObject } from './github-api';
import type { Env, Fetcher, GitHubActivityData } from './types';

const DAY_MS = 86_400_000;
const REPOSITORY_LIMIT = 100;
const RANGE_BATCH = 4;
const YEAR_BATCH = 10;
const REPOSITORY_FIELDS = 'repository { id owner { id } }';
const CREATION_FIELDS = `totalCount pageInfo { hasNextPage endCursor }
    nodes { ${REPOSITORY_FIELDS} }`;

const PROFILE = `query ActivityProfile($login: String!,
    $from: DateTime!, $to: DateTime!) {
    viewer { id login organizations(first: 1) { totalCount } }
    user(login: $login) {
        id login createdAt
        repositoryDiscussions(first: 1) { totalCount }
        repositoryDiscussionComments(first: 1, onlyAnswers: true) {
            totalCount
        }
        contributionsCollection { contributionYears }
        recent: contributionsCollection(from: $from, to: $to) {
            totalPullRequestReviewContributions
        }
        repositoriesContributedTo(first: 1, includeUserRepositories: false,
            contributionTypes: [COMMIT, ISSUE, PULL_REQUEST, REPOSITORY]) {
            totalCount
        }
    }
}`;

const MORE_CREATIONS = `query ActivityCreatedRepositories($login: String!,
    $from: DateTime!, $to: DateTime!, $after: String!) {
    user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
            repositoryContributions(first: 100, after: $after) {
                ${CREATION_FIELDS}
            }
        }
    }
}`;

interface DateRange {
    from: number;
    to: number;
}

function instant(value: number): string {
    return new Date(value).toISOString().slice(0, 19) + 'Z';
}

function timestamp(value: unknown): number {
    const parsed = Date.parse(text(value));
    if (!Number.isFinite(parsed)) {
        throw new UpstreamError('GitHub returned an invalid activity date.');
    }
    return parsed;
}

function add(left: number, right: number): number {
    return count(left + right);
}

function list(value: unknown): unknown[] {
    if (!Array.isArray(value)) {
        throw new UpstreamError('GitHub activity list is incomplete.');
    }
    return value;
}

/** Split on UTC days because contribution grouping has day precision. */
function split(range: DateRange): [DateRange, DateRange] {
    const firstDay = Math.floor(range.from / DAY_MS);
    const lastDay = Math.floor(range.to / DAY_MS);
    if (firstDay === lastDay) {
        throw new UpstreamError(
            'GitHub activity exceeds a daily repository limit; saved data retained.',
        );
    }
    const middle = (firstDay + Math.ceil((lastDay - firstDay) / 2))
        * DAY_MS;
    return [
        { from: range.from, to: middle - 1000 },
        { from: middle, to: range.to },
    ];
}

function rangeFields(ranges: DateRange[], fields: string): string {
    return ranges.map((range, index) => `range_${index}:
        contributionsCollection(from: "${instant(range.from)}",
            to: "${instant(range.to)}") { ${fields} }`).join('\n');
}

/**
 * Personal aggregates across every repository visible to the configured token.
 * Repository identities exist only in temporary sets and never enter results.
 */
export async function fetchGitHubActivity(
    env: Pick<Env,
        'GITHUB_USERNAME' | 'GITHUB_TOKEN' | 'GITHUB_VISIBILITY'>,
    fetcher: Fetcher = fetch,
    now: number | (() => number) = Date.now,
): Promise<GitHubActivityData> {
    // User-level aggregate connections lack a public-only visibility filter.
    // Keep the independent public repository/language source usable instead.
    if ((env.GITHUB_VISIBILITY ?? 'public') !== 'all') {
        throw new UpstreamError(
            'GitHub activity requires all visibility; public-only activity is unavailable.',
        );
    }
    const current = typeof now === 'function' ? now() : now;
    if (!Number.isFinite(current) || current < Date.UTC(2008, 0, 1)
        || current > Date.UTC(2200, 0, 1)) {
        throw new UpstreamError('GitHub activity collection time is invalid.');
    }
    const to = Math.floor(current / 1000) * 1000;
    const fromDate = new Date(to);
    fromDate.setUTCFullYear(fromDate.getUTCFullYear() - 1);
    const recentFrom = instant(fromDate.valueOf());
    const recentTo = instant(to);
    const client = createGitHubClient(env, fetcher, {
        timeoutMs: 45_000,
        maxRequests: 128,
        requiredScopes: ['repo', 'read:user', 'read:org'],
    });
    const profile = await client.query(PROFILE, {
        login: client.login, from: recentFrom, to: recentTo,
    });
    const user = object(profile.user);
    const viewer = object(profile.viewer);
    const username = text(user.login);
    const userId = text(user.id);
    if (username.toLowerCase() !== client.login.toLowerCase()
        || text(viewer.login).toLowerCase() !== username.toLowerCase()
        || text(viewer.id) !== userId) {
        throw new UpstreamError(
            'GitHub activity token must belong to the configured account.',
        );
    }
    const createdAt = timestamp(user.createdAt);
    if (createdAt > to) {
        throw new UpstreamError('GitHub returned an inconsistent account date.');
    }
    const currentYear = new Date(to).getUTCFullYear();
    const years = list(object(user.contributionsCollection).contributionYears)
        .map(value => count(value));
    if (new Set(years).size !== years.length
        || years.some(year => year < 2008 || year > currentYear)) {
        throw new UpstreamError('GitHub contribution years are inconsistent.');
    }
    years.sort((a, b) => a - b);
    const ranges = years.map(year => ({
        from: Date.UTC(year, 0, 1),
        to: Math.min(Date.UTC(year + 1, 0, 1) - 1000, to),
    }));
    const contributionsByYear: GitHubActivityData['contributionsByYear'] = [];
    let allTimeContributions = 0;
    let restrictedContributions = 0;
    for (let offset = 0; offset < ranges.length; offset += YEAR_BATCH) {
        const batch = ranges.slice(offset, offset + YEAR_BATCH);
        const fields = 'contributionCalendar { totalContributions } '
            + 'restrictedContributionsCount';
        const data = await client.query(`query ActivityCalendar($login: String!) {
            user(login: $login) { ${rangeFields(batch, fields)} }
        }`, { login: username });
        const calendarUser = object(data.user);
        for (let index = 0; index < batch.length; index++) {
            const collection = object(calendarUser[`range_${index}`]);
            const contributions = count(
                object(collection.contributionCalendar).totalContributions,
            );
            const restricted = count(collection.restrictedContributionsCount);
            if (restricted > contributions) {
                throw new UpstreamError('GitHub contribution totals are inconsistent.');
            }
            allTimeContributions = add(allTimeContributions, contributions);
            restrictedContributions = add(restrictedContributions, restricted);
            contributionsByYear.push({
                year: years[offset + index], contributions,
            });
        }
    }

    const repositoryOwners = new Map<string, string>();
    const repositories = new Set<string>();
    const remember = (value: unknown): string => {
        const repository = object(object(value).repository);
        const id = text(repository.id);
        const ownerId = text(object(repository.owner).id);
        const previousOwner = repositoryOwners.get(id);
        if (previousOwner !== undefined && previousOwner !== ownerId) {
            throw new UpstreamError(
                'GitHub repository ownership changed during activity refresh.',
            );
        }
        repositoryOwners.set(id, ownerId);
        if (ownerId !== userId) {
            repositories.add(id);
        }
        return id;
    };
    const repositoryFields = [
        'commitContributionsByRepository',
        'issueContributionsByRepository',
        'pullRequestContributionsByRepository',
    ];
    const fields = repositoryFields.map(field => `${field}(maxRepositories: 100)
        { ${REPOSITORY_FIELDS} }`).join('\n')
        + `repositoryContributions(first: 100) { ${CREATION_FIELDS} }`;
    const pending = [...ranges];
    while (pending.length) {
        const batch = pending.splice(0, RANGE_BATCH);
        const data = await client.query(`query ActivityRepositories($login: String!) {
            user(login: $login) { ${rangeFields(batch, fields)} }
        }`, { login: username });
        const rangeUser = object(data.user);
        for (let index = 0; index < batch.length; index++) {
            const collection = object(rangeUser[`range_${index}`]);
            const lists = repositoryFields.map(field => list(collection[field]));
            if (lists.some(entries => entries.length >= REPOSITORY_LIMIT)) {
                pending.push(...split(batch[index]));
                continue;
            }
            lists.forEach(entries => entries.forEach(remember));
            let creations = object(collection.repositoryContributions);
            const expected = count(creations.totalCount);
            const creationIds = new Set<string>();
            const cursors = new Set<string>();
            for (;;) {
                if (count(creations.totalCount) !== expected) {
                    throw new UpstreamError(
                        'GitHub repository creation inventory changed during refresh.',
                    );
                }
                for (const value of list(creations.nodes)) {
                    const id = remember(value);
                    if (creationIds.has(id)) {
                        throw new UpstreamError('GitHub repeated an activity page.');
                    }
                    creationIds.add(id);
                }
                const after = page(creations);
                if (after === null) {
                    break;
                }
                if (cursors.has(after)) {
                    throw new UpstreamError('GitHub repeated an activity cursor.');
                }
                cursors.add(after);
                const more = await client.query(MORE_CREATIONS, {
                    login: username,
                    from: instant(batch[index].from),
                    to: instant(batch[index].to),
                    after,
                });
                creations = object(object(object(more.user)
                    .contributionsCollection).repositoryContributions);
            }
            if (creationIds.size !== expected) {
                throw new UpstreamError('GitHub activity pagination is incomplete.');
            }
        }
    }

    const search = async (kind: 'commits' | 'issues', query: string) => {
        const parameters = new URLSearchParams({ q: query, per_page: '1' });
        const data = await client.get(`/search/${kind}?${parameters}`);
        if (data.incomplete_results !== false) {
            throw new UpstreamError(
                'GitHub search returned incomplete activity; saved data retained.',
            );
        }
        return count(data.total_count);
    };
    const commits = await search('commits', `author:${username}`);
    const pullRequestsCommented = await search('issues',
        `commenter:${username} -author:${username} type:pr`);
    const pullRequestsReviewed = await search('issues',
        `reviewed-by:${username} -author:${username} type:pr`);
    const issuesCommented = await search('issues',
        `commenter:${username} -author:${username} type:issue`);

    return {
        username,
        visibility: 'all',
        scope: 'Personal activity across token-visible public, private and internal '
            + 'repositories, including organizations and external open source. '
            + 'Commits: lifetime search-indexed default branches. Commented and '
            + 'reviewed items: distinct non-self-authored issues or PRs. '
            + 'Review contributions and contributed repositories: recent year. '
            + 'Lifetime repository count: visible commit, issue, PR and repository '
            + 'creation contributions, excluding currently owned repositories. '
            + 'Annual totals: GitHub contribution calendar; restricted counts '
            + (restrictedContributions > 0 ? 'are included once.' : 'are zero.')
            + ' Access remains limited by token permissions and organization policy.',
        commits,
        pullRequestsCommented,
        pullRequestsReviewed,
        issuesCommented,
        discussionsStarted: count(object(user.repositoryDiscussions).totalCount),
        discussionsAnswered: count(
            object(user.repositoryDiscussionComments).totalCount,
        ),
        reviewContributions: count(
            object(user.recent).totalPullRequestReviewContributions,
        ),
        contributedRepositories: count(
            object(user.repositoriesContributedTo).totalCount,
        ),
        allTimeContributedRepositories: repositories.size,
        allTimeContributions,
        contributionsByYear,
        recentFrom,
        recentTo,
        allTimeFrom: ranges.length ? instant(ranges[0].from) : instant(createdAt),
        allTimeTo: recentTo,
        organizationCount: count(object(viewer.organizations).totalCount),
    };
}
