import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// A relative base lets the same build run from any GitHub Pages path.
export default defineConfig({
  base: './',
  plugins: [react()],
  test: { include: ['tests/**/*.test.ts'] },
});
