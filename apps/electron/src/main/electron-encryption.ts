import { safeStorage } from 'electron';
import { Cause, Effect, Layer } from 'effect';
import { EncryptionService, type EncryptionServiceShape } from '@code-review-app/backend';

const PLAINTEXT_PREFIX = 'plain:v1:';

function canUseSafeStorage() {
  if (!safeStorage.isEncryptionAvailable()) {
    return false;
  }

  if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend?.() === 'basic_text') {
    return false;
  }

  return true;
}

function plaintextEncode(value: string) {
  return `${PLAINTEXT_PREFIX}${Buffer.from(value, 'utf8').toString('base64')}`;
}

function plaintextDecode(value: string) {
  return Buffer.from(value.slice(PLAINTEXT_PREFIX.length), 'base64').toString('utf8');
}

function toEncryptionError(cause: unknown) {
  return cause instanceof Error ? cause : new Cause.UnknownException(cause);
}

const makeElectronSafeStorageEncryption = Effect.sync(() => {
  const encryptString: EncryptionServiceShape['encryptString'] = Effect.fn(
    'EncryptionService.encryptString',
  )((value) =>
    Effect.try({
      try: () => {
        if (!canUseSafeStorage()) {
          return plaintextEncode(value);
        }

        return safeStorage.encryptString(value).toString('base64');
      },
      catch: toEncryptionError,
    }),
  );

  const decryptString: EncryptionServiceShape['decryptString'] = Effect.fn(
    'EncryptionService.decryptString',
  )((value) =>
    Effect.try({
      try: () => {
        if (value.startsWith(PLAINTEXT_PREFIX)) {
          return plaintextDecode(value);
        }

        if (!canUseSafeStorage()) {
          return '';
        }

        return safeStorage.decryptString(Buffer.from(value, 'base64'));
      },
      catch: toEncryptionError,
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

export { ElectronSafeStorageEncryption };
