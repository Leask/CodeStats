import {
    chmodSync, closeSync, constants, existsSync, lstatSync,
    mkdirSync, openSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Storage } from './cache';

/** Synchronous filesystem work keeps temporary umask changes bounded. */
function privately<T>(operation: () => T): T {
    const previous = process.umask(0o077);
    try {
        return operation();
    } finally {
        process.umask(previous);
    }
}

/** Persistent Node snapshots, isolated by the same profile identity as Workers. */
export class SqliteStorage implements Storage {
    readonly filename: string;
    private readonly database: DatabaseSync;
    private closed = false;

    constructor(directory: string, private readonly namespace: string) {
        const absolute = resolve(directory);
        mkdirSync(absolute, { recursive: true, mode: 0o700 });
        const parent = lstatSync(absolute);
        if (!parent.isDirectory() || parent.isSymbolicLink()
            || (parent.mode & 0o077) !== 0
            || (process.getuid && parent.uid !== process.getuid())) {
            throw new Error('CODESTATS_DATA_DIR must be an owned private directory (0700).');
        }
        this.filename = join(absolute, 'codestats.sqlite');
        if (!existsSync(this.filename)) {
            const descriptor = openSync(this.filename,
                constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY
                | constants.O_NOFOLLOW, 0o600);
            closeSync(descriptor);
        }
        const file = lstatSync(this.filename);
        if (!file.isFile() || file.isSymbolicLink()
            || (process.getuid && file.uid !== process.getuid())) {
            throw new Error('The snapshot database must be an owned regular file.');
        }
        chmodSync(this.filename, 0o600);
        this.database = privately(() => {
            const database = new DatabaseSync(this.filename);
            try {
                database.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;'
                    + ' PRAGMA synchronous = FULL;'
                    + ' CREATE TABLE IF NOT EXISTS snapshots ('
                    + ' profile TEXT NOT NULL, key TEXT NOT NULL, payload TEXT NOT NULL,'
                    + ' PRIMARY KEY (profile, key));');
                return database;
            } catch (error) {
                database.close();
                throw error;
            }
        });
    }

    async get<T>(key: string): Promise<T | undefined> {
        const row = this.database.prepare(
            'SELECT payload FROM snapshots WHERE profile = ? AND key = ?',
        ).get(this.namespace, key);
        return row ? JSON.parse(String(row.payload)) as T : undefined;
    }

    async put<T>(key: string, value: T): Promise<void> {
        const payload = JSON.stringify(value);
        if (payload === undefined) {
            throw new Error('Snapshots must be JSON serializable.');
        }
        privately(() => this.database.prepare(
            'INSERT INTO snapshots (profile, key, payload) VALUES (?, ?, ?)'
            + ' ON CONFLICT (profile, key) DO UPDATE SET payload = excluded.payload',
        ).run(this.namespace, key, payload));
    }

    close(): void {
        if (!this.closed) {
            this.database.close();
            this.closed = true;
        }
    }
}
