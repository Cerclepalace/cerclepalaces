/**
 * Configuration ESLint.
 *
 * `npm run lint` sortait 0 sans rien vérifier. Un contrôle qui ne peut pas
 * échouer ne contrôle rien, et il était pire qu'absent : il figurait comme
 * « vert » dans chaque rapport de vérification.
 *
 * Le parti pris est étroit. TypeScript couvre déjà les types, et `tsconfig.base`
 * y est sévère — `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`. Ce
 * que le compilateur ne voit pas, et que ces règles attrapent, tient en trois
 * familles : les promesses qu'on oublie d'attendre, les valeurs qu'on jette, et
 * le code mort. Le reste — style, ordre des imports, préférences — n'entre pas :
 * une règle qu'on désactive au premier conflit n'aurait jamais dû être activée.
 */

import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/generated/**", "packages/db/prisma/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          // Les fichiers de configuration ne figurent dans aucun tsconfig.
          // Les analyser sans information de type vaut mieux que les exclure :
          // une promesse oubliée dans une config casse un lancement de test.
          allowDefaultProject: ["*.js", "*/vitest.config.ts", "*/*/vitest.config.ts"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // --- Ce qui compte réellement ici ---

      // Une promesse non attendue dans un service transactionnel écrit après le
      // commit, ou pas du tout. C'est la classe de bug la plus coûteuse de ce
      // dépôt, et le compilateur ne la voit pas.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "require-await": "off",
      "@typescript-eslint/require-await": "off",

      // --- Assouplissements assumés ---

      // Les adaptateurs Prisma traduisent des `string` de base vers des unions
      // du domaine. Le cast est encadré et testé ; l'interdire ferait fabriquer
      // des contournements moins lisibles.
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-explicit-any": "error",

      // Les tests construisent délibérément des valeurs hostiles, avec des casts
      // qui sont le sujet même du test.
      "@typescript-eslint/no-unnecessary-type-assertion": "off",

      // Une expression régulière qui normalise des espaces exotiques doit
      // contenir des espaces exotiques : c'est son sujet. Les signaler là
      // reviendrait à interdire d'écrire le test qui les traite.
      "no-irregular-whitespace": ["error", { skipRegExps: true }],

      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
