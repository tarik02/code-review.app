import { Effect } from "effect";

type BackendRuntimeConfig = {
  databasePath: string;
  migrationsPath: string;
  userDataPath: string;
};

class BackendConfig extends Effect.Tag("BackendConfig")<BackendConfig, BackendRuntimeConfig>() {}

export { BackendConfig };
export type { BackendRuntimeConfig };
