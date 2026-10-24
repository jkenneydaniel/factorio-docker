import fs from 'node:fs';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {assert, HttpError} from '../../common.js';
import {parseStorageJSON} from './files.js';

const applicationId = 0x4c474442;
const schemaVersion = 1;
const schema = `
CREATE TABLE storage_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
CREATE TABLE storage_migrations (version INTEGER PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT;
CREATE TABLE documents (
 namespace TEXT NOT NULL, key TEXT NOT NULL,
 schema_version INTEGER NOT NULL CHECK(schema_version>0),
 revision INTEGER NOT NULL CHECK(revision>0),
 deleted INTEGER NOT NULL CHECK(deleted IN (0,1)),
 value TEXT NOT NULL CHECK(json_valid(value)),
 updated_at TEXT NOT NULL,
 PRIMARY KEY(namespace,key)
) STRICT;
`;
const checksum = crypto.createHash('sha256').update(schema).digest('hex');
const name = (value) =>
  typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
const key = (value) =>
  typeof value === 'string' &&
  /^[A-Za-z0-9][A-Za-z0-9_./:-]{0,199}$/.test(value) &&
  !value.split('/').includes('..');
const revision = (value) => Number.isSafeInteger(value) && value >= 0;
const uuid = (value) =>
  typeof value === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const copy = (value) => parseStorageJSON(JSON.stringify(value));
const conflict = () =>
  new HttpError(
    409,
    'Panel state changed in another writer. Reload before saving again.',
  );

// Transactions contain only synchronous SQL and bound JSON values. Application
// callbacks and filesystem/network effects never run while a SQL lock is held.
export class SqliteDocumentStore {
  #db;
  constructor(
    file,
    {
      create = false,
      identity,
      profile,
      planHash,
      extensions = [],
      timeout = 2500,
    } = {},
  ) {
    assert(
      Number.isInteger(timeout) && timeout >= 0 && timeout <= 30000,
      'Invalid storage timeout.',
    );
    if (create) {
      const fd = fs.openSync(file, 'wx', 0o600);
      fs.closeSync(fd);
    }
    const stat = fs.lstatSync(file);
    assert(
      stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0,
      'Panel database must be a private regular file.',
      503,
    );
    try {
      this.#db = new DatabaseSync(file, {timeout, allowExtension: false});
      if (!create)
        assert(
          this.#db.prepare('PRAGMA application_id').get().application_id ===
            applicationId &&
            this.#db.prepare('PRAGMA user_version').get().user_version ===
              schemaVersion,
          'Unsupported panel database schema. Preserve it for review.',
          503,
        );
      this.#db.enableDefensive?.(true);
      const mode = this.#db
        .prepare(create ? 'PRAGMA journal_mode=DELETE' : 'PRAGMA journal_mode')
        .get().journal_mode;
      assert(
        mode === 'delete',
        'The panel database requires rollback journaling.',
        503,
      );
      this.#db.exec(
        'PRAGMA synchronous=EXTRA; PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF;',
      );
      assert(
        this.#db.prepare('PRAGMA synchronous').get().synchronous === 3,
        'Panel storage synchronization is unavailable.',
        503,
      );
      if (create) {
        assert(
          uuid(identity) && name(profile) && /^[a-f0-9]{64}$/.test(planHash),
          'Invalid storage identity.',
        );
        this.#db.exec('BEGIN IMMEDIATE');
        try {
          this.#db.exec(schema);
          const put = this.#db.prepare(
            'INSERT INTO storage_metadata(key,value) VALUES (?,?)',
          );
          for (const [key, value] of Object.entries({
            identity,
            profile,
            planHash,
            extensions: JSON.stringify(extensions),
          }))
            put.run(key, value);
          this.#db
            .prepare('INSERT INTO storage_migrations VALUES (?,?,?)')
            .run(schemaVersion, checksum, new Date().toISOString());
          this.#db.exec(
            `PRAGMA application_id=${applicationId}; PRAGMA user_version=${schemaVersion}; COMMIT;`,
          );
        } catch (error) {
          if (this.#db.isTransaction) this.#db.exec('ROLLBACK');
          throw error;
        }
      }
      assert(
        this.#db.prepare('PRAGMA application_id').get().application_id ===
          applicationId &&
          this.#db.prepare('PRAGMA user_version').get().user_version ===
            schemaVersion,
        'Unsupported panel database schema. Preserve it for review.',
        503,
      );
      assert(
        this.#db
          .prepare('SELECT checksum FROM storage_migrations WHERE version=?')
          .get(schemaVersion)?.checksum === checksum,
        'Panel database migration history is invalid.',
        503,
      );
      this.metadata = Object.fromEntries(
        this.#db
          .prepare('SELECT key,value FROM storage_metadata')
          .all()
          .map((row) => [row.key, row.value]),
      );
      assert(
        uuid(this.metadata.identity) &&
          name(this.metadata.profile) &&
          /^[a-f0-9]{64}$/.test(this.metadata.planHash),
        'Panel database metadata is invalid. Preserve it for review.',
        503,
      );
      if (identity)
        assert(
          this.metadata.identity === identity,
          'Panel database identity does not match its storage marker.',
          503,
        );
      if (profile)
        assert(
          this.metadata.profile === profile,
          'Panel database profile changed.',
          503,
        );
      this.file = file;
      this.fileIdentity = Object.freeze({dev: stat.dev, ino: stat.ino});
      this.closed = false;
    } catch (error) {
      this.#db?.close();
      throw error;
    }
  }
  read(namespace, documentKey) {
    assert(name(namespace) && key(documentKey), 'Invalid repository key.');
    const row = this.#db
      .prepare(
        'SELECT schema_version,revision,deleted,value FROM documents WHERE namespace=? AND key=?',
      )
      .get(namespace, documentKey);
    return row
      ? {
          exists: !row.deleted,
          revision: row.revision,
          schemaVersion: row.schema_version,
          value: row.deleted ? null : parseStorageJSON(row.value),
        }
      : {exists: false, revision: 0, schemaVersion: 0, value: null};
  }
  readMany(keys) {
    assert(
      Array.isArray(keys) && keys.length <= 10000,
      'Too many repository reads.',
    );
    this.#db.exec('BEGIN');
    try {
      const records = keys.map(({namespace, key}) => this.read(namespace, key));
      this.#db.exec('COMMIT');
      return records;
    } catch (error) {
      if (this.#db.isTransaction) this.#db.exec('ROLLBACK');
      throw error;
    }
  }
  commit(changes) {
    assert(
      Array.isArray(changes) && changes.length > 0 && changes.length <= 10000,
      'Choose a bounded repository transaction.',
    );
    const keys = new Set(),
      prepared = changes.map((change) => {
        assert(
          name(change.namespace) &&
            key(change.key) &&
            revision(change.expectedRevision) &&
            Number.isSafeInteger(change.schemaVersion) &&
            change.schemaVersion > 0 &&
            change.schemaVersion <= 1000,
          'Invalid repository transaction.',
        );
        const id = change.namespace + '\0' + change.key;
        assert(!keys.has(id), 'A transaction cannot write a document twice.');
        keys.add(id);
        const value = JSON.stringify(change.delete ? null : change.value);
        assert(
          typeof value === 'string' &&
            Buffer.byteLength(value) <= 32 * 1024 * 1024,
          'Repository document is too large.',
        );
        return {...change, json: value};
      });
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const put = this.#db.prepare(
        'INSERT INTO documents(namespace,key,schema_version,revision,deleted,value,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(namespace,key) DO UPDATE SET schema_version=excluded.schema_version,revision=excluded.revision,deleted=excluded.deleted,value=excluded.value,updated_at=excluded.updated_at',
      );
      const result = [];
      for (const change of prepared) {
        const current = this.read(change.namespace, change.key);
        if (current.revision !== change.expectedRevision) throw conflict();
        assert(
          current.revision < Number.MAX_SAFE_INTEGER,
          'Repository revision limit reached.',
          503,
        );
        const next = current.revision + 1;
        put.run(
          change.namespace,
          change.key,
          change.schemaVersion,
          next,
          change.delete ? 1 : 0,
          change.json,
          new Date().toISOString(),
        );
        result.push(next);
      }
      this.#db.exec('COMMIT');
      return result;
    } catch (error) {
      if (this.#db.isTransaction) this.#db.exec('ROLLBACK');
      throw error;
    }
  }
  exportSnapshot() {
    this.#db.exec('BEGIN');
    try {
      const records = this.#db
        .prepare(
          'SELECT namespace,key,schema_version,revision,deleted,value FROM documents ORDER BY namespace,key',
        )
        .all()
        .map((row) => ({
          namespace: row.namespace,
          key: row.key,
          schemaVersion: row.schema_version,
          revision: row.revision,
          deleted: !!row.deleted,
          value: parseStorageJSON(row.value),
        }));
      this.#db.exec('COMMIT');
      return copy({
        version: schemaVersion,
        identity: this.metadata.identity,
        profile: this.metadata.profile,
        planHash: this.metadata.planHash,
        extensions: parseStorageJSON(this.metadata.extensions || '[]'),
        records,
      });
    } catch (error) {
      if (this.#db.isTransaction) this.#db.exec('ROLLBACK');
      throw error;
    }
  }
  close() {
    if (!this.closed) {
      this.#db.close();
      this.closed = true;
    }
  }
}
