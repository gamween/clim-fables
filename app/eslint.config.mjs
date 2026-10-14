import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // Vendored copies (byte-identical to shared/ and docs/integrate/, checked by `npm run sync -- --check`) and
  // generated data are linted where they live, not here.
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "src/vendor/**", "src/generated/**", "playwright-report/**", "test-results/**"]),
]);
