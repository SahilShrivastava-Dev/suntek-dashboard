import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Vitest loads this file automatically at test time. It is intentionally kept
// separate from vite.config.ts so the production `tsc -b` build (which type-checks
// vite.config.ts under tsconfig.node.json) does not depend on Vitest's type
// augmentation, and to avoid the Vite 8 (rolldown) / vitest-bundled-Vite plugin
// type mismatch surfacing in the build.
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    css: false,
  },
})
