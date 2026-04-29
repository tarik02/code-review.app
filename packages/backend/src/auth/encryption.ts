import { Effect } from "effect";

type EncryptionServiceShape = {
  encryptString(value: string): Effect.Effect<string, Error>;
  decryptString(value: string): Effect.Effect<string, Error>;
};

class EncryptionService extends Effect.Tag("EncryptionService")<
  EncryptionService,
  EncryptionServiceShape
>() {}

export { EncryptionService };
export type { EncryptionServiceShape };
