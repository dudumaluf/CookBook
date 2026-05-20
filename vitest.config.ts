import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // `server-only` is a Next.js build-time guard that throws when the
      // module is imported from the browser bundle. In tests we don't care
      // about the guard — alias to an empty shim so server modules can
      // still be imported by unit tests.
      "server-only": path.resolve(__dirname, "./tests/shims/server-only.ts"),
    },
  },
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules", ".next", "dist"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.d.ts",
        "src/**/types.ts",
        "src/app/**/layout.tsx",
        "src/app/**/page.tsx",
      ],
    },
  },
});
