import { defineConfig } from "vitest/config";

// Config locale explicite : Vitest remonte l'arborescence à la recherche d'une
// config, et ce package doit rester indépendant de ce que la racine du monorepo
// contiendra une fois les apps en place.
export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ["src/**/*.test.ts"],
  },
});
