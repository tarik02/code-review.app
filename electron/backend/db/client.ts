import { createClient, type Client } from "@libsql/client/sqlite3";
import { app } from "electron";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { Effect, Layer } from "effect";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { CacheError } from "../errors";
import * as schema from "./schema";

type Database = LibSQLDatabase<typeof schema>;
type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

type DatabaseHandle = {
  client: Client;
  db: Database;
};

type DatabaseServiceShape = {
  query<A>(
    operation: (database: Database) => Promise<A>,
  ): Effect.Effect<A, CacheError>;
  transaction<A>(
    operation: (database: DatabaseTransaction) => Promise<A>,
  ): Effect.Effect<A, CacheError>;
};

class DatabaseService extends Effect.Tag("DatabaseService")<
  DatabaseService,
  DatabaseServiceShape
>() {}

function toCacheError(error: unknown) {
  return new CacheError(error instanceof Error ? error.message : String(error));
}

async function initializeDatabase(): Promise<DatabaseHandle> {
  const dbPath = path.join(app.getPath("userData"), "db.sqlite");
  const client = createClient({ url: pathToFileURL(dbPath).href });
  const db = drizzle(client, { schema });

  try {
    await client.execute("PRAGMA journal_mode = WAL");
    await client.execute("PRAGMA synchronous = NORMAL");
    await client.execute("PRAGMA busy_timeout = 5000");
    await migrate(db, {
      migrationsFolder: path.join(app.getAppPath(), "drizzle"),
    });

    return { client, db };
  } catch (error) {
    client.close();
    throw error;
  }
}

const makeDatabaseService = Effect.acquireRelease(
  Effect.tryPromise({
    try: initializeDatabase,
    catch: toCacheError,
  }),
  (handle) =>
    Effect.sync(() => {
      handle.client.close();
    }),
).pipe(
  Effect.map((handle) => {
    let operationQueue: Promise<unknown> = Promise.resolve();

    const runQueued = async <A>(operation: () => Promise<A>) => {
      const queuedOperation = operationQueue
        .catch(() => undefined)
        .then(operation);
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
      transaction: <A>(
        operation: (database: DatabaseTransaction) => Promise<A>,
      ) =>
        Effect.tryPromise({
          try: () => runQueued(() => handle.db.transaction(operation)),
          catch: toCacheError,
        }),
    } satisfies DatabaseServiceShape;
  }),
);

const DatabaseServiceLive = Layer.scoped(
  DatabaseService,
  makeDatabaseService,
);

export { DatabaseService, DatabaseServiceLive };
export type { Database, DatabaseTransaction };
