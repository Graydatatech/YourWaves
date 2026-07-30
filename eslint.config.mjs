import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";
import rtl from "./eslint-rules/no-physical-direction.mjs";

const eslintConfig = defineConfig([
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The rule implementation necessarily names the classes it bans.
    "eslint-rules/**",
  ]),
  ...nextVitals,
  ...nextTs,
  {
    files: ["**/*.{ts,tsx,js,jsx,mjs}"],
    plugins: { rtl },
    rules: {
      // Non-negotiable: Arabic is the default locale, so physical-direction
      // utilities are a bug, not a style preference.
      "rtl/no-physical-direction": "error",
    },
  },
  // Must stay last so formatting rules lose to Prettier.
  prettier,
]);

export default eslintConfig;
