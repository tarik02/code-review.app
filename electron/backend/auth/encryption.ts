import { safeStorage } from "electron";
import { Effect, Layer } from "effect";

type EncryptionServiceShape = {
  encryptString(value: string): Effect.Effect<string, Error>;
  decryptString(value: string): Effect.Effect<string, Error>;
};

class EncryptionService extends Effect.Tag("EncryptionService")<
  EncryptionService,
  EncryptionServiceShape
>() {}

function toError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

function assertEncryptionAvailable() {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Secure credential storage is not available on this system.");
  }

  if (
    process.platform === "linux" &&
    safeStorage.getSelectedStorageBackend?.() === "basic_text"
  ) {
    throw new Error("Secure credential storage is not available for this Linux session.");
  }
}

const makeElectronSafeStorageEncryption = Effect.gen(function* () {
  const encryptString: EncryptionServiceShape["encryptString"] = Effect.fn(
    "EncryptionService.encryptString",
  )((value) =>
    Effect.try({
      try: () => {
        assertEncryptionAvailable();
        return safeStorage.encryptString(value).toString("base64");
      },
      catch: toError,
    }),
  );

  const decryptString: EncryptionServiceShape["decryptString"] = Effect.fn(
    "EncryptionService.decryptString",
  )((value) =>
    Effect.try({
      try: () => {
        assertEncryptionAvailable();
        return safeStorage.decryptString(Buffer.from(value, "base64"));
      },
      catch: toError,
    }),
  );

  return {
    encryptString,
    decryptString,
  } satisfies EncryptionServiceShape;
});

const ElectronSafeStorageEncryption = Layer.effect(
  EncryptionService,
  makeElectronSafeStorageEncryption,
);

export { ElectronSafeStorageEncryption, EncryptionService };
