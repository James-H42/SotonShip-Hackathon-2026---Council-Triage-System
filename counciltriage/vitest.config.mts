import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname) } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: { DATA_DIR: path.resolve(import.meta.dirname, "data/test"), DATABASE_PATH: ":memory:" },
  },
});
