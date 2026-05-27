import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'

const root = process.cwd()
const cjsRoot = resolve(root, '.tmp/cjs')
const distRoot = resolve(root, 'dist')

if (!existsSync(cjsRoot)) {
  throw new Error(`Missing CommonJS build output: ${cjsRoot}`)
}

copyCjsFiles(cjsRoot)
rmSync(resolve(root, '.tmp'), { recursive: true, force: true })

console.log('build finalized: dist/index.js, dist/index.cjs, dist/index.d.ts')

function copyCjsFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const input = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      copyCjsFiles(input)
      continue
    }

    if (!entry.name.endsWith('.js')) {
      continue
    }

    const relativePath = relative(cjsRoot, input).replace(/\.js$/, '.cjs')
    const output = resolve(distRoot, relativePath)
    mkdirSync(dirname(output), { recursive: true })

    const content = readFileSync(input, 'utf8').replace(
      /require\((['"])(\.{1,2}\/[^'"]+)\.js\1\)/g,
      'require($1$2.cjs$1)',
    )
    writeFileSync(output, content)
  }
}
