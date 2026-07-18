import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Test files share one Postgres database in the dual-dialect run and each
    // file resets the schema; parallel files would clobber each other.
    fileParallelism: false,
  },
})
