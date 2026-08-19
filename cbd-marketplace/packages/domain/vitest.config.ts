import { defineConfig } from "vitest/config";

// Config locale explicite : sans elle, Vitest remonte l'arborescence et charge
// le vite.config.ts d'un projet voisin sans rapport avec celui-ci.
export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ["src/**/*.test.ts"],
  },
});
