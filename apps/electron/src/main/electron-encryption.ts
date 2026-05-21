import { safeStorage } from 'electron';
import { Cause, Effect, Layer } from 'effect';
import {
  EncryptionService,
  type EncryptionServiceShape,
} from '@code-review-app/backend';

function assertEncryptionAvailable() {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure credential storage is not available on this system.');
  }

  if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend?.() === 'basic_text') {
    throw new Error('Secure credential storage is not available for this Linux session.');
  }
}

const makeElectronSafeStorageEncryption = Effect.sync(() => {
  const encryptString: EncryptionServiceShape['encryptString'] = Effect.fn(
    'EncryptionService.encryptString',
  )((value) =>
    Effect.try({
      try: () => {
        assertEncryptionAvailable();
        return safeStorage.encryptString(value).toString('base64');
      },
      catch: (cause) => new Cause.UnknownException(cause),
    }),
  );

  const decryptString: EncryptionServiceShape['decryptString'] = Effect.fn(
    'EncryptionService.decryptString',
  )((value) =>
    Effect.try({
      try: () => {
        assertEncryptionAvailable();
        return safeStorage.decryptString(Buffer.from(value, 'base64'));
      },
      catch: (cause) => new Cause.UnknownException(cause),
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
