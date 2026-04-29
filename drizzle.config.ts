import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./electron/backend/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: "file:./.drizzle/dev.sqlite",
  },
});
