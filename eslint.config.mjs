import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated Prisma client.
    "src/generated/**",
    // Transient benchmarking/profiling scratch files at the repo root — real
    // project code lives in src/, prisma/, and worker/ (also gitignored).
    "bench*.ts",
    "probe*.ts",
    "_probe*.ts",
    "__*.ts",
    "*.audit.ts",
  ]),
]);

export default eslintConfig;
