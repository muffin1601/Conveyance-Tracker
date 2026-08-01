import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

// Next 16 removed the built-in `next lint` command, which left this project
// with an `npm run lint` script that could not run at all. This restores
// linting on the standard flat-config ESLint CLI.
const config = [
  { ignores: [".next/**", "node_modules/**", "public/**"] },
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      // Unused code is a defect, not a style preference — but allow the
      // conventional `_`-prefixed placeholder for deliberately ignored args.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
];

export default config;
