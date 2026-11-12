import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Everything that decides a score or a text must agree to the bit on every JS engine, for as long as logs replay.
    files: ["src/engine/{core,score,replay,log,prng,generate,layout,day}.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        ...["Date", "Intl", "window", "document", "navigator", "performance", "globalThis"].map((name) => ({
          name,
          message: "The frozen engine must stay pure and identical on every JS engine.",
        })),
      ],
      "no-restricted-properties": [
        "error",
        ...["random", "pow", "exp"].map((property) => ({
          object: "Math",
          property,
          message: "Not reproducible across JS engines. Use + - * / and Math.round.",
        })),
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[property.name=/^(localeCompare|normalize|toLocale.*)$/]",
          message: "Locale and Unicode tables differ between JS engines. Use an explicit table.",
        },
        {
          selector: "BinaryExpression[operator='**'], AssignmentExpression[operator='**=']",
          message: "Exponentiation is Math.pow by another name.",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Git-ignored mocks and probes kept on this machine only.
    "private/**",
  ]),
]);

export default eslintConfig;
