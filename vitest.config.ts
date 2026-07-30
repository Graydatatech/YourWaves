import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` throws unless resolved under the "react-server"
      // condition, which vitest does not use. Point it at the package's own
      // no-op build so server modules can be unit-tested directly. This does
      // not weaken the guard: the real protection is Next's bundler refusing
      // the import in a Client Component at build time.
      "server-only": fileURLToPath(
        new URL(
          "./node_modules/.pnpm/server-only@0.0.1/node_modules/server-only/empty.js",
          import.meta.url,
        ),
      ),
    },
  },
  test: {
    environment: "node",
    globals: false,
    setupFiles: ["./tests/setup.ts"],
    // Database tests share one schema and truncate between cases, so they must
    // not run concurrently against each other.
    fileParallelism: false,
    sequence: { concurrent: false },
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
