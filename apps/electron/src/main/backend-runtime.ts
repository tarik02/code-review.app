import { app } from "electron";
import path from "node:path";
import { createBackendRuntime } from "@code-review-app/backend";
import { ElectronSafeStorageEncryption } from "./electron-encryption";

function resolveBackendMigrationsPath() {
  if (app.isPackaged) {
    return path.join(app.getAppPath(), "drizzle");
  }

  return path.resolve(process.cwd(), "../../packages/backend/drizzle");
}

const backendRuntime = createBackendRuntime({
  databasePath: path.join(app.getPath("userData"), "db.sqlite"),
  migrationsPath: resolveBackendMigrationsPath(),
  userDataPath: app.getPath("userData"),
  encryptionLayer: ElectronSafeStorageEncryption,
});

export { backendRuntime };
