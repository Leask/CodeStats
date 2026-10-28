import { UpstreamError } from './errors';
import { count, createGitHubClient, object, page, text } from './github-api';
import type { Env, Fetcher, GitHubData } from './types';
import { repositoryOptions } from './github-options';
import { fetchAvatar, profileText, publicStatus } from './github-profile';

const PROFILE = `query Profile($login: String!, $prs: String!,
    $merged: String!, $issues: String!, $all: Boolean!,
    $affiliations: [RepositoryAffiliation!], $isFork: Boolean) {
    user(login: $login) {
        login name bio avatarUrl(size: 128) followers { totalCount }
        status { message expiresAt organization { id } }
        publicRepositories: repositories(first: 1, privacy: PUBLIC,
            ownerAffiliations: $affiliations, isFork: $isFork) { totalCount }
        privateRepositories: repositories(first: 1, privacy: PRIVATE,
            ownerAffiliations: $affiliations, isFork: $isFork) @include(if: $all) { totalCount }
        repositories(first: 1, ownerAffiliations: $affiliations, isFork: $isFork)
            @include(if: $all) { totalCount }
    }
    prs: search(query: $prs, type: ISSUE, first: 1) { issueCount }
    merged: search(query: $merged, type: ISSUE, first: 1) { issueCount }
    issues: search(query: $issues, type: ISSUE, first: 1) { issueCount }
}`;
const REPOSITORIES = `query Repositories($login: String!, $after: String,
    $privacy: RepositoryPrivacy,
    $affiliations: [RepositoryAffiliation!], $isFork: Boolean) {
    user(login: $login) {
        login
        repositories(first: 100, after: $after, privacy: $privacy,
            ownerAffiliations: $affiliations, isFork: $isFork,
            orderBy: {field: NAME, direction: ASC}) {
            totalCount pageInfo { hasNextPage endCursor }
            nodes {
                id isPrivate isFork stargazerCount forkCount
                owner { login }
                languages(first: 100, orderBy: {field: SIZE, direction: DESC}) {
                    totalSize pageInfo { hasNextPage endCursor }
                    edges { size node { name color } }
                }
            }
        }
    }
}`;
const MORE_LANGUAGES = `query Languages($id: ID!, $after: String!) {
    node(id: $id) {
        ... on Repository {
            isPrivate isFork
            languages(first: 100, after: $after,
                orderBy: {field: SIZE, direction: DESC}) {
                totalSize pageInfo { hasNextPage endCursor }
                edges { size node { name color } }
            }
        }
    }
}`;

/** Native paginated repository-language aggregates; no Git history walk. */
export async function fetchGitHub(
    env: Pick<Env, 'GITHUB_USERNAME' | 'GITHUB_TOKEN' | 'GITHUB_VISIBILITY'
        | 'GITHUB_REPOSITORY_AFFILIATIONS' | 'GITHUB_INCLUDE_FORKS'>,
    fetcher: Fetcher = fetch,
): Promise<GitHubData> {
    const visibility = env.GITHUB_VISIBILITY ?? 'public';
    if (visibility !== 'public' && visibility !== 'all') {
        throw new UpstreamError('GitHub visibility is invalid.');
    }
    const all = visibility === 'all';
    const options = repositoryOptions(env);
    const filters = {
        affiliations: options.affiliations,
        isFork: options.includeForks ? null : false,
    };
    const { login, query } = createGitHubClient(env, fetcher, {
        requiredScopes: all ? ['repo'] : [],
        timeoutMs: 45_000,
    });
    const searchBase = `author:${login}${all ? '' : ' is:public'}`;
    const profile = await query(PROFILE, {
        login, all, ...filters,
        prs: `${searchBase} is:pr`,
        merged: `${searchBase} is:pr is:merged`,
        issues: `${searchBase} is:issue`,
    });
    const user = object(profile.user);
    const username = text(user.login);
    if (username.toLowerCase() !== login.toLowerCase()) {
        throw new UpstreamError('GitHub profile identity changed.');
    }
    const avatar = fetchAvatar(user.avatarUrl, fetcher);
    const result: GitHubData = {
        collectionVersion: 7,
        repositoryAffiliations: options.affiliations,
        includeForks: options.includeForks,
        analyzedForks: 0,
        username,
        name: typeof user.name === 'string' && user.name.trim()
            ? text(user.name) : text(user.login),
        bio: profileText(user.bio),
        profileStatus: publicStatus(user.status),
        avatarDataUri: null,
        followers: count(object(user.followers).totalCount),
        publicRepositories: count(object(user.publicRepositories).totalCount),
        visibility,
        analyzedRepositories: 0,
        stars: 0,
        forks: 0,
        pullRequests: count(object(profile.prs).issueCount),
        mergedPullRequests: count(object(profile.merged).issueCount),
        issues: count(object(profile.issues).issueCount),
        languages: [],
        repositoryLanguageCounts: [],
        totalBytes: 0,
        scope: `Repository content selected by GitHub ownerAffiliations: `
            + `${options.affiliations.join(', ')}; `
            + `${options.includeForks ? 'forks included' : 'forks excluded'}, `
            + 'archived repositories included. All repository/language pages; '
            + 'language share by current bytes, including other authors. '
            + 'Per-language repository counts use this same selected inventory; '
            + 'merged languages count each repository once. '
            + (all ? 'Private/internal data is limited to token-visible repositories. '
                : 'Public repositories only. ')
            + 'Stars: selected repositories owned by this user only, including '
            + 'their own forks when enabled; organization/collaborator stars excluded. '
            + 'PRs/issues: lifetime authored across GitHub, including organizations '
            + 'and external open source. Fork popularity excludes fork networks.',
    };
    if (all) {
        result.repositories = count(object(user.repositories).totalCount);
        result.privateRepositories = count(object(user.privateRepositories).totalCount);
        if (count(result.publicRepositories) + result.privateRepositories
            !== result.repositories) {
            throw new UpstreamError('GitHub repository totals are inconsistent.');
        }
    }
    if (count(result.mergedPullRequests) > count(result.pullRequests)) {
        throw new UpstreamError('GitHub returned inconsistent pull request counts.');
    }
    const languages = new Map<string, { bytes: number; color: string }>();
    // Aggregate language co-occurrences without storing repository identities.
    // This stays internal; the public API exposes only selected row counts.
    const repositoryLanguageCounts = new Map<string, {
        languages: string[];
        repositories: number;
    }>();
    const repositoryIds = new Set<string>();
    const repositoryCursors = new Set<string>();
    let privateRepositories = 0;
    let after: string | null = null;
    let expectedRepositories: number | null = null;
    do {
        const data = await query(REPOSITORIES, {
            login, after, privacy: all ? null : 'PUBLIC', ...filters,
        });
        const owner = object(data.user);
        if ((all || owner.login !== undefined)
            && text(owner.login).toLowerCase() !== login.toLowerCase()) {
            throw new UpstreamError('GitHub repository owner identity changed.');
        }
        const connection = object(owner.repositories);
        const expected = count(connection.totalCount);
        if (expectedRepositories !== null && expected !== expectedRepositories) {
            throw new UpstreamError('GitHub repository inventory changed during refresh.');
        }
        expectedRepositories = expected;
        if (!Array.isArray(connection.nodes)) {
            throw new UpstreamError('GitHub repository page is incomplete.');
        }
        for (const value of connection.nodes) {
            const repo = object(value);
            const id = text(repo.id);
            if (repositoryIds.has(id) || typeof repo.isPrivate !== 'boolean'
                || (!all && repo.isPrivate)
                || typeof repo.isFork !== 'boolean'
                || (!options.includeForks && repo.isFork)) {
                throw new UpstreamError('GitHub repository scope or pagination changed.');
            }
            repositoryIds.add(id);
            privateRepositories += Number(repo.isPrivate);
            const repositoryStars = count(repo.stargazerCount);
            if (text(object(repo.owner).login).toLowerCase()
                === username.toLowerCase()) {
                result.stars = count(count(result.stars) + repositoryStars);
            }
            result.analyzedForks = (result.analyzedForks ?? 0) + Number(repo.isFork);
            if (!repo.isFork) {
                result.forks = count(count(result.forks) + count(repo.forkCount));
            }
            let languageConnection = object(repo.languages);
            const expectedBytes = count(languageConnection.totalSize);
            let repositoryBytes = 0;
            const languageNames = new Set<string>();
            const usedLanguages: string[] = [];
            const languageCursors = new Set<string>();
            for (;;) {
                if (count(languageConnection.totalSize) !== expectedBytes
                    || !Array.isArray(languageConnection.edges)) {
                    throw new UpstreamError('GitHub language inventory changed during refresh.');
                }
                for (const edge of languageConnection.edges) {
                    const item = object(edge);
                    const language = object(item.node);
                    const name = text(language.name);
                    if (languageNames.has(name)) {
                        throw new UpstreamError('GitHub repeated a language page.');
                    }
                    languageNames.add(name);
                    const bytes = count(item.size);
                    if (bytes > 0) {
                        usedLanguages.push(name);
                    }
                    const color = typeof language.color === 'string'
                        && /^#[\da-f]{6}$/i.test(language.color)
                        ? language.color : '#8b949e';
                    const old = languages.get(name);
                    languages.set(name, {
                        bytes: (old?.bytes ?? 0) + bytes,
                        color: old?.color ?? color,
                    });
                    repositoryBytes += bytes;
                }
                const next = page(languageConnection);
                if (next === null) {
                    break;
                }
                if (languageCursors.has(next)) {
                    throw new UpstreamError('GitHub repeated a language cursor.');
                }
                languageCursors.add(next);
                const more = object((await query(MORE_LANGUAGES, {
                    id, after: next,
                })).node);
                if (more.isPrivate !== repo.isPrivate || more.isFork !== repo.isFork) {
                    throw new UpstreamError('GitHub repository visibility changed.');
                }
                languageConnection = object(more.languages);
            }
            if (repositoryBytes !== expectedBytes) {
                throw new UpstreamError('GitHub language bytes are incomplete.');
            }
            // A completed language-empty repository still belongs to the
            // headline inventory, but contributes to no language's count.
            usedLanguages.sort();
            const signature = JSON.stringify(usedLanguages);
            const previous = repositoryLanguageCounts.get(signature);
            repositoryLanguageCounts.set(signature, {
                languages: usedLanguages,
                repositories: count((previous?.repositories ?? 0) + 1),
            });
        }
        after = page(connection);
        if (after !== null) {
            if (repositoryCursors.has(after)) {
                throw new UpstreamError('GitHub repeated a repository cursor.');
            }
            repositoryCursors.add(after);
        }
    } while (after !== null);
    if (repositoryIds.size !== expectedRepositories) {
        throw new UpstreamError('GitHub repository pagination is incomplete.');
    }
    if (all && (privateRepositories !== result.privateRepositories
        || repositoryIds.size - privateRepositories !== result.publicRepositories)) {
        throw new UpstreamError('GitHub repository totals changed during refresh.');
    }
    if (!all && repositoryIds.size !== result.publicRepositories) {
        throw new UpstreamError('GitHub repository totals changed during refresh.');
    }
    result.analyzedRepositories = repositoryIds.size;
    // Sort signatures as well, so this never preserves NAME pagination order.
    result.repositoryLanguageCounts = [...repositoryLanguageCounts]
        .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .map(([, data]) => data);
    if (result.repositoryLanguageCounts.reduce(
        (sum, group) => sum + group.repositories, 0,
    ) !== result.analyzedRepositories) {
        throw new UpstreamError('GitHub repository language counts are incomplete.');
    }
    result.languages = [...languages].map(([name, data]) => ({ name, ...data }))
        .sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));
    result.totalBytes = result.languages.reduce((sum, item) => sum + item.bytes, 0);
    if (!Number.isSafeInteger(result.totalBytes)) {
        throw new UpstreamError('GitHub byte total exceeds the supported numeric range.');
    }
    result.avatarDataUri = await avatar;
    return result;
}
