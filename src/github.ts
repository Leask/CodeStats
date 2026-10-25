import { UpstreamError } from './errors';
import type { Env, Fetcher, GitHubData } from './types';

const ENDPOINT = 'https://api.github.com/graphql';
const REFRESH_TIMEOUT_MS = 20_000;
const MAX_PAGES = 128;
const PROFILE = `query Profile($login: String!, $prs: String!,
    $merged: String!, $issues: String!) {
    user(login: $login) {
        login name followers { totalCount }
        publicRepositories: repositories(first: 1, privacy: PUBLIC,
            ownerAffiliations: [OWNER]) { totalCount }
    }
    prs: search(query: $prs, type: ISSUE, first: 1) { issueCount }
    merged: search(query: $merged, type: ISSUE, first: 1) { issueCount }
    issues: search(query: $issues, type: ISSUE, first: 1) { issueCount }
}`;
const REPOSITORIES = `query Repositories($login: String!, $after: String) {
    user(login: $login) {
        repositories(first: 50, after: $after, privacy: PUBLIC,
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

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new UpstreamError('GitHub returned incomplete data.');
    }
    return value as JsonObject;
}

function text(value: unknown): string {
    if (typeof value !== 'string' || !value || value.length > 256) {
        throw new UpstreamError('GitHub returned invalid text.');
    }
    return value;
}

function count(value: unknown): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value)
        || value < 0) {
        throw new UpstreamError('GitHub returned an invalid count.');
    }
    return value;
}

function page(connection: JsonObject): string | null {
    const info = object(connection.pageInfo);
    if (typeof info.hasNextPage !== 'boolean') {
        throw new UpstreamError('GitHub pagination is incomplete.');
    }
    return info.hasNextPage ? text(info.endCursor) : null;
}

/** Complete public, owned, non-fork repository bytes; no private names leave here. */
export async function fetchGitHub(
    env: Pick<Env, 'GITHUB_USERNAME' | 'GITHUB_TOKEN'>,
    fetcher: Fetcher = fetch,
): Promise<GitHubData> {
    const login = env.GITHUB_USERNAME;
    if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(login)) {
        throw new UpstreamError('GitHub username is invalid.');
    }
    if (!env.GITHUB_TOKEN?.trim()) {
        throw new UpstreamError('Configure a server-side GITHUB_TOKEN for GitHub stats.');
    }
    const signal = AbortSignal.timeout(REFRESH_TIMEOUT_MS);
    let requests = 0;
    const query = async (
        document: string,
        variables: Record<string, unknown>,
    ): Promise<JsonObject> => {
        if (++requests > MAX_PAGES) {
            throw new UpstreamError('GitHub pagination budget exceeded; snapshot retained.');
        }
        let response: Response;
        try {
            response = await fetcher(ENDPOINT, {
                method: 'POST',
                redirect: 'manual',
                signal,
                headers: {
                    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
                    'User-Agent': 'CodeStats',
                    Accept: 'application/vnd.github+json',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ query: document, variables }),
            });
        } catch {
            throw new UpstreamError('GitHub request failed or timed out.');
        }
        if (!response.ok) {
            throw new UpstreamError(`GitHub API returned HTTP ${response.status}.`);
        }
        let envelope: JsonObject;
        try {
            envelope = object(await response.json());
        } catch {
            throw new UpstreamError('GitHub returned invalid JSON.');
        }
        if (envelope.errors !== undefined) {
            if (!Array.isArray(envelope.errors) || envelope.errors.length > 0) {
                throw new UpstreamError('GitHub GraphQL returned partial or failed data.');
            }
        }
        return object(envelope.data);
    };

    const searchBase = `author:${login} is:public`;
    const profile = await query(PROFILE, {
        login,
        prs: `${searchBase} is:pr`,
        merged: `${searchBase} is:pr is:merged`,
        issues: `${searchBase} is:issue`,
    });
    const user = object(profile.user);
    const result: GitHubData = {
        username: text(user.login),
        name: typeof user.name === 'string' && user.name.trim()
            ? text(user.name) : text(user.login),
        followers: count(object(user.followers).totalCount),
        publicRepositories: count(object(user.publicRepositories).totalCount),
        analyzedRepositories: 0,
        stars: 0,
        forks: 0,
        pullRequests: count(object(profile.prs).issueCount),
        mergedPullRequests: count(object(profile.merged).issueCount),
        issues: count(object(profile.issues).issueCount),
        languages: [],
        totalBytes: 0,
        scope: 'All owned public non-fork repositories, including archived; '
            + 'language share by bytes. PRs and issues: public, lifetime, '
            + 'authored across GitHub. Public repository count includes forks.',
    };
    if (result.mergedPullRequests > result.pullRequests) {
        throw new UpstreamError('GitHub returned inconsistent pull request counts.');
    }
    const languages = new Map<string, { bytes: number; color: string }>();
    const repositoryIds = new Set<string>();
    const repositoryCursors = new Set<string>();
    let after: string | null = null;
    let expectedRepositories: number | null = null;
    do {
        const data = await query(REPOSITORIES, { login, after });
        const connection = object(object(data.user).repositories);
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
            if (repositoryIds.has(id) || repo.isPrivate !== false
                || repo.isFork !== false) {
                throw new UpstreamError('GitHub repository scope or pagination changed.');
            }
            repositoryIds.add(id);
            result.stars += count(repo.stargazerCount);
            result.forks += count(repo.forkCount);
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
                if (more.isPrivate !== false || more.isFork !== false) {
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
    result.analyzedRepositories = repositoryIds.size;
    result.languages = [...languages].map(([name, data]) => ({ name, ...data }))
        .sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));
    result.totalBytes = result.languages.reduce((sum, item) => sum + item.bytes, 0);
    if (!Number.isSafeInteger(result.totalBytes)) {
        throw new UpstreamError('GitHub byte total exceeds the supported numeric range.');
    }
    return result;
}
