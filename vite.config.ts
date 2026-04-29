import { defineConfig } from 'vite-plus';

export default defineConfig({
  lint: {
    jsPlugins: [
      {
        name: 'react-hooks-js',
        specifier: 'eslint-plugin-react-hooks',
      },
    ],
    rules: {
      'react-hooks-js/rules-of-hooks': 'error',
      'react-hooks-js/exhaustive-deps': 'warn',
      'react-hooks-js/config': 'error',
      'react-hooks-js/error-boundaries': 'error',
      'react-hooks-js/gating': 'error',
      'react-hooks-js/globals': 'error',
      'react-hooks-js/immutability': 'error',
      'react-hooks-js/preserve-manual-memoization': 'error',
      'react-hooks-js/purity': 'error',
      'react-hooks-js/refs': 'error',
      'react-hooks-js/set-state-in-effect': 'error',
      'react-hooks-js/set-state-in-render': 'error',
      'react-hooks-js/static-components': 'error',
      'react-hooks-js/unsupported-syntax': 'warn',
      'react-hooks-js/use-memo': 'error',
      'react-hooks-js/incompatible-library': 'warn',
    },
  },
  fmt: {
    semi: true,
    singleQuote: true,
    tabWidth: 2,
  },
});
