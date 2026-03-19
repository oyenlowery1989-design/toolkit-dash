import { defineConfig } from "eslint/config";
import next from "eslint-config-next";

export default defineConfig([{
  extends: [...next],
  rules: {
    "react/no-unescaped-entities": "off",
    "react-hooks/set-state-in-effect": "off",
  },
}]);
