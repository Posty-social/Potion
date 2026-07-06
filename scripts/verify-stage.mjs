import { spawnSync } from 'node:child_process'

/* eslint-disable no-console */

const steps = [
  ['Format', 'bun', ['run', 'format:check']],
  ['Lint', 'bun', ['run', 'lint']],
  ['Types', 'bun', ['x', 'tsc', '--noEmit']],
  ['Unit tests', 'bun', ['run', 'test']],
  ['Route generation', 'bun', ['run', 'generate-routes']],
  ['D1 schema generation', 'bun', ['run', 'db:generate']],
  ['Cloudflare type generation', 'bun', ['run', 'cf-typegen']],
  ['Production build', 'bun', ['run', 'build']],
  ['Browser e2e', 'bun', ['run', 'e2e']],
]

for (const [label, command, args] of steps) {
  console.log(`\n==> ${label}`)
  const result = spawnSync(command, args, {
    stdio: 'inherit',
  })

  if (result.status !== 0) {
    console.error(`\nVerification failed at: ${label}`)
    process.exit(result.status ?? 1)
  }
}

console.log('\nAll verification gates passed.')
