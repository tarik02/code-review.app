import { app, BrowserWindow } from "electron";
import { createMainWindow } from "./window";
import { configureUpdater } from "./updater";
import { runtime } from "../backend/runtime";

app.setName("rudu");

app.whenReady().then(async () => {
  configureUpdater();
  await createMainWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  void runtime.dispose();
});
