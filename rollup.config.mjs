import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import replace from '@rollup/plugin-replace';
import dts from 'rollup-plugin-dts';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pkg = require('./package.json');

const isProduction = process.env.NODE_ENV === 'production';

const sharedPlugins = [
  resolve({ preferBuiltins: true }),
  commonjs(),
  replace({
    preventAssignment: true,
    values: {
      // In production builds, __DOOW_DEBUG__ is false → tree-shaker eliminates all debug code
      '__DOOW_DEBUG__': isProduction ? 'false' : 'true',
      // __SDK_VERSION__ is replaced at build time with the version from package.json
      '__SDK_VERSION__': JSON.stringify(pkg.version),
    },
  }),
];

export default [
  // ESM build
  {
    input: 'src/index.ts',
    output: {
      dir: 'dist/esm',
      format: 'esm',
      sourcemap: true,
      preserveModules: true,
      preserveModulesRoot: 'src',
    },
    plugins: [
      ...sharedPlugins,
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
        declarationMap: false,
        compilerOptions: { outDir: 'dist/esm', declarationDir: undefined },
      }),
    ],
    external: [],
  },
  // CJS build
  {
    input: 'src/index.ts',
    output: {
      dir: 'dist/cjs',
      format: 'cjs',
      sourcemap: true,
      preserveModules: true,
      preserveModulesRoot: 'src',
      exports: 'named',
    },
    plugins: [
      ...sharedPlugins,
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
        declarationMap: false,
        compilerOptions: { outDir: 'dist/cjs', declarationDir: undefined },
      }),
    ],
    external: [],
  },
  // Sidecar entry point (CJS — Node executable)
  {
    input: 'src/sidecar/index.ts',
    output: {
      file: 'dist/sidecar.cjs',
      format: 'cjs',
      sourcemap: true,
      exports: 'named',
    },
    plugins: [
      ...sharedPlugins,
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
        declarationMap: false,
        compilerOptions: { outDir: 'dist', declarationDir: undefined },
      }),
    ],
    external: [],
  },
  // CLI entry point (CJS — Node executable)
  {
    input: 'src/cli/index.ts',
    output: {
      file: 'dist/cli.cjs',
      format: 'cjs',
      sourcemap: true,
      exports: 'named',
    },
    plugins: [
      ...sharedPlugins,
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
        declarationMap: false,
        compilerOptions: { outDir: 'dist', declarationDir: undefined },
      }),
    ],
    external: [],
  },
  // Types build
  {
    input: 'src/index.ts',
    output: {
      dir: 'dist/types',
      format: 'esm',
    },
    plugins: [dts()],
  },
];
