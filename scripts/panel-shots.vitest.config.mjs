import { defineConfig } from 'vitest/config'
// Only for scripts/panel-shots.dump.tsx; the test suite keeps vitest.config.ts.
export default defineConfig({ resolve: { dedupe: ['react', 'react-dom'] }, test: { include: ['scripts/panel-shots.dump.tsx'] } })
