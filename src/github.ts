import { UpstreamError } from './errors';
import { count, createGitHubClient, object, page, text } from './github-api';
import type { Env, Fetcher, GitHubData } from './types';

const PROFILE = `query Profile($login: String!, $prs: String!,
    $merged: String!, $issues: String!, $all: Boolean!) {
    user(login: $login) {
        login name followers { totalCount }
        publicRepositories: repositories(first: 1, privacy: PUBLIC,
            ownerAffiliations: [OWNER]) { totalCount }
        privateRepositories: repositories(first: 1, privacy: PRIVATE,
            ownerAffiliations: [OWNER]) @include(if: $all) { totalCount }
        repositories(first: 1, ownerAffiliations: [OWNER])
            @include(if: $all) { totalCount }
    }
    prs: search(query: $prs, type: ISSUE, first: 1) { issueCount }
    merged: search(query: $merged, type: ISSUE, first: 1) { issueCount }
    issues: search(query: $issues, type: ISSUE, first: 1) { issueCount }
}`;
const REPOSITORIES = `query Repositories($login: String!, $after: String,
    $privacy: RepositoryPrivacy) {
    user(login: $login) {
        login
        repositories(first: 50, after: $after, privacy: $privacy,
            ownerAffiliations: [OWNER], isFork: false,
            orderBy: {field: NAME, direction: ASC}) {
            totalCount pageInfo { hasNextPage endCursor }
            nodes {
                id isPrivate isFork stargazerCount forkCount
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

/** Complete owned non-fork bytes without exposing repository identities. */
export async function fetchGitHub(
    env: Pick<Env, 'GITHUB_USERNAME' | 'GITHUB_TOKEN' | 'GITHUB_VISIBILITY'>,
    fetcher: Fetcher = fetch,
): Promise<GitHubData> {
    const visibility = env.GITHUB_VISIBILITY ?? 'public';
    if (visibility !== 'public' && visibility !== 'all') {
        throw new UpstreamError('GitHub visibility is invalid.');
    }
    const all = visibility === 'all';
    const { login, query } = createGitHubClient(env, fetcher, {
        requiredScopes: all ? ['repo'] : [],
    });
    const searchBase = `author:${login}${all ? '' : ' is:public'}`;
    const profile = await query(PROFILE, {
        login, all,
        prs: `${searchBase} is:pr`,
        merged: `${searchBase} is:pr is:merged`,
        issues: `${searchBase} is:issue`,
    });
    const user = object(profile.user);
    const username = text(user.login);
    if (username.toLowerCase() !== login.toLowerCase()) {
        throw new UpstreamError('GitHub profile identity changed.');
    }
    const result: GitHubData = {
        username,
        name: typeof user.name === 'string' && user.name.trim()
            ? text(user.name) : text(user.login),
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
        totalBytes: 0,
        scope: all
            ? 'All token-visible owned non-fork repositories, including archived; '
                + 'language share by bytes. PRs and issues: token-visible, '
                + 'lifetime, authored across GitHub, including organizations '
                + 'and external repositories. Repository counts include forks.'
            : 'All owned public non-fork repositories, including archived; '
                + 'language share by bytes. PRs and issues: public, lifetime, '
                + 'authored across GitHub. Public repository count includes forks.',
    };
    if (all) {
        result.repositories = count(object(user.repositories).totalCount);
        result.privateRepositories = count(object(user.privateRepositories).totalCount);
        if (result.publicRepositories + result.privateRepositories
            !== result.repositories) {
            throw new UpstreamError('GitHub repository totals are inconsistent.');
        }
    }
    if (result.mergedPullRequests > result.pullRequests) {
        throw new UpstreamError('GitHub returned inconsistent pull request counts.');
    }
    const languages = new Map<string, { bytes: number; color: string }>();
    const repositoryIds = new Set<string>();
    const repositoryCursors = new Set<string>();
    let privateRepositories = 0;
    let after: string | null = null;
    let expectedRepositories: number | null = null;
    do {
        const data = await query(REPOSITORIES, {
            login, after, privacy: all ? null : 'PUBLIC',
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
                || repo.isFork !== false) {
                throw new UpstreamError('GitHub repository scope or pagination changed.');
            }
            repositoryIds.add(id);
            privateRepositories += Number(repo.isPrivate);
            result.stars = count(result.stars + count(repo.stargazerCount));
            result.forks = count(result.forks + count(repo.forkCount));
            let languageConnection = object(repo.languages);
            const expectedBytes = count(languageConnection.totalSize);
            let repositoryBytes = 0;
            const languageNames = new Set<string>();
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
                if (more.isPrivate !== repo.isPrivate || more.isFork !== false) {
                    throw new UpstreamError('GitHub repository visibility changed.');
                }
                languageConnection = object(more.languages);
            }
            if (repositoryBytes !== expectedBytes) {
                throw new UpstreamError('GitHub language bytes are incomplete.');
            }
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
    if (all && (privateRepositories > (result.privateRepositories ?? 0)
        || repositoryIds.size - privateRepositories > result.publicRepositories)) {
        throw new UpstreamError('GitHub repository totals changed during refresh.');
    }
    result.analyzedRepositories = repositoryIds.size;
    result.languages = [...languages].map(([name, data]) => ({ name, ...data }))
        .sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));
    result.totalBytes = result.languages.reduce((sum, item) => sum + item.bytes, 0);
    if (!Number.isSafeInteger(result.totalBytes)) {
        throw new UpstreamError('GitHub byte total exceeds the supported numeric range.');
    }
    return result;
}
