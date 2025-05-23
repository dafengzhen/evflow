import type { Plugin } from 'vite';

import { loadPartialConfig, transformAsync } from '@babel/core';

export default function viteBabelPlugin(): Plugin {
  return {
    name: 'vite-babel-plugin',
    async transform(code, id) {
      if (!id.endsWith('.ts')) {
        return null;
      }

      const partialConfig = loadPartialConfig({
        cwd: process.cwd(),
        envName: process.env.BABEL_ENV || process.env.NODE_ENV || 'development',
        filename: id,
        sourceMaps: true,
      });

      if (!partialConfig) {
        return null;
      }

      const result = await transformAsync(code, partialConfig.options);

      if (!result?.code) {
        return null;
      }

      return {
        code: result.code,
        map: result.map,
      };
    },
  };
}
