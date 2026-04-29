import { eq } from 'drizzle-orm';
import { Effect, Layer } from 'effect';
import { DatabaseService } from '../db/client.ts';
import { appSettings } from '../db/schema.ts';
import { CacheError } from '../errors.ts';

type AppSettingsServiceShape = {
  read<T>(key: string): Effect.Effect<T | null, CacheError>;
  write<T>(key: string, value: T): Effect.Effect<void, CacheError>;
};

class AppSettingsService extends Effect.Tag('AppSettingsService')<
  AppSettingsService,
  AppSettingsServiceShape
>() {}

function nowUnixTimestamp() {
  return Math.floor(Date.now() / 1000);
}

const makeAppSettingsService = Effect.gen(function* () {
  const database = yield* DatabaseService;

  const read = (<T>(key: string) =>
    database.query(async (db): Promise<T | null> => {
      const [row] = await db
        .select({ valueJson: appSettings.valueJson })
        .from(appSettings)
        .where(eq(appSettings.key, key))
        .limit(1);

      return row ? (JSON.parse(row.valueJson) as T) : null;
    })) satisfies AppSettingsServiceShape['read'];

  const write = (<T>(key: string, value: T) =>
    database.transaction(async (tx) => {
      const timestamp = nowUnixTimestamp();
      const valueJson = JSON.stringify(value);

      await tx
        .insert(appSettings)
        .values({ key, valueJson, updatedAt: timestamp })
        .onConflictDoUpdate({
          target: appSettings.key,
          set: {
            valueJson,
            updatedAt: timestamp,
          },
        });
    })) satisfies AppSettingsServiceShape['write'];

  return {
    read,
    write,
  } satisfies AppSettingsServiceShape;
});

const AppSettingsServiceLive = Layer.effect(AppSettingsService, makeAppSettingsService);

export { AppSettingsService, AppSettingsServiceLive };
