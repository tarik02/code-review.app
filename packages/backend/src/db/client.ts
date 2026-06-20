import { drizzle, type NodeSQLiteDatabase } from 'drizzle-orm/node-sqlite';
import { migrate } from 'drizzle-orm/node-sqlite/migrator';
import { Cause, Effect, Layer } from 'effect';
import { DatabaseSync } from 'node:sqlite';
import { BackendConfig, type BackendRuntimeConfig } from '../config.ts';
import { CacheError } from '../errors.ts';
import * as schema from './schema.ts';

type Database = NodeSQLiteDatabase<typeof schema>;
type DatabaseTransaction = Database;

type DatabaseHandle = {
  client: DatabaseSync;
  db: Database;
};

type DatabaseServiceShape = {
  query<A>(operation: (database: Database) => Promise<A>): Effect.Effect<A, CacheError>;
  transaction<A>(
    operation: (database: DatabaseTransaction) => Promise<A>,
  ): Effect.Effect<A, CacheError>;
};

class DatabaseService extends Effect.Tag('DatabaseService')<
  DatabaseService,
  DatabaseServiceShape
>() {}

function toCacheError(cause: unknown) {
  const error = new Cause.UnknownException(cause);
  return new CacheError(error.message, { cause: error });
}

async function runTransaction<A>(
  client: DatabaseSync,
  db: Database,
  operation: (database: DatabaseTransaction) => Promise<A>,
): Promise<A> {
  client.exec('BEGIN IMMEDIATE');

  try {
    const result = await operation(db);
    client.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      client.exec('ROLLBACK');
    } catch {
      // Ignore rollback failures while surfacing the original error.
    }

    throw error;
  }
}

function initializeDatabase(config: BackendRuntimeConfig): DatabaseHandle {
  const client = new DatabaseSync(config.databasePath, { timeout: 5000 });
  const db = drizzle({ client, schema });

  try {
    client.exec('PRAGMA journal_mode = WAL');
    client.exec('PRAGMA synchronous = NORMAL');
    migrate(db, {
      migrationsFolder: config.migrationsPath,
    });

    return { client, db };
  } catch (error) {
    client.close();
    throw error;
  }
}

const makeDatabaseService = Effect.gen(function* () {
  const config = yield* BackendConfig;
  const handle = yield* Effect.acquireRelease(
    Effect.try({
      try: () => initializeDatabase(config),
      catch: toCacheError,
    }),
    (databaseHandle) =>
      Effect.sync(() => {
        databaseHandle.client.close();
      }),
  );

  let operationQueue: Promise<unknown> = Promise.resolve();

  const runQueued = async <A>(operation: () => Promise<A>) => {
    const queuedOperation = operationQueue.catch(() => undefined).then(operation);
    operationQueue = queuedOperation.then(
      () => undefined,
      () => undefined,
    );
    return queuedOperation;
  };

  return {
    query: <A>(operation: (database: Database) => Promise<A>) =>
      Effect.tryPromise({
        try: () => runQueued(() => operation(handle.db)),
        catch: toCacheError,
      }),
    transaction: <A>(operation: (database: DatabaseTransaction) => Promise<A>) =>
      Effect.tryPromise({
        try: () => runQueued(() => runTransaction(handle.client, handle.db, operation)),
        catch: toCacheError,
      }),
  } satisfies DatabaseServiceShape;
});

const DatabaseServiceLive = Layer.scoped(DatabaseService, makeDatabaseService);

export { DatabaseService, DatabaseServiceLive };
export type { Database, DatabaseTransaction };
