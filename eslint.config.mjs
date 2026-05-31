import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  {
    ignores: ["scratch/**"]
  },
  ...nextVitals,
  ...nextTypescript
];

export default eslintConfig;
