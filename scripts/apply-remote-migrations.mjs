import { spawnSync } from 'node:child_process'

const databaseName = process.env.D1_DATABASE_NAME || 'potion-db'

const result = spawnSync(
  'wrangler',
  ['d1', 'migrations', 'apply', databaseName, '--remote'],
  {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  },
)

process.exit(result.status ?? 1)
