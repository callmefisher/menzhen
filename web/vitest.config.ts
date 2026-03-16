/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    testTimeout: 15000,
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: 3,
      },
    },
    coverage: {
      provider: 'v8',
      exclude: [
        'src/pages/meridians/MeridianView.tsx',
        'src/pages/meridians/MeridianScene.tsx',
        'src/pages/meridians/MeridianPath.tsx',
        'src/pages/meridians/AcupointMarker.tsx',
        'src/pages/meridians/HumanBodyModel.tsx',
        'src/pages/meridians/surfaceProjection.ts',
        'src/pages/meridians/data/**',
        'src/test/**',
        '**/*.d.ts',
        'src/main.tsx',
        'src/App.tsx',
      ],
    },
  },
});
