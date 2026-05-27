import { existsSync, readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

if (pkg.private === true) {
  console.error('route-core is not publishable yet: package.json still has private=true')
  process.exit(1)
}

for (const file of ['dist/index.js', 'dist/index.cjs', 'dist/index.d.ts']) {
  if (!existsSync(new URL(`../${file}`, import.meta.url))) {
    console.error(`route-core is not publishable yet: missing ${file}`)
    process.exit(1)
  }
}

console.log('prepublish check passed')
