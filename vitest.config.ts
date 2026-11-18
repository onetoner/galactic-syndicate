import { defineConfig } from 'vitest/config';

// Die Core-Simulation ist DOM-frei -> Tests laufen in reiner Node-Umgebung.
export default defineConfig({
  test: { environment: 'node', include: ['tests/**/*.test.ts'], testTimeout: 30000 },
});
