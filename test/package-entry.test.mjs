import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { describe, it } from 'node:test'

const require = createRequire(import.meta.url)

describe('package entries', () => {
  it('supports ESM named exports', async () => {
    const mod = await import('../dist/index.js')
    assert.equal(typeof mod.createRouter, 'function')
    assert.equal('default' in mod, false)
    assert.equal(typeof mod.createRouter().lookup, 'function')
  })

  it('supports CJS named exports', () => {
    const mod = require('../dist/index.cjs')
    assert.equal(typeof mod.createRouter, 'function')
    assert.equal(typeof mod.RouteConflictError, 'function')
    assert.equal(typeof mod.createRouter().lookup, 'function')
  })
})
