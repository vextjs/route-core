import { rmSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()

for (const directory of ['dist', '.tmp']) {
  rmSync(resolve(root, directory), { recursive: true, force: true })
}

console.log('build prepared: cleaned dist and .tmp')
