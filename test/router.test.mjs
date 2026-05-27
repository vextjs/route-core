import { describe, it } from 'node:test'
import {
  InvalidMethodError,
  InvalidPathError,
  InvalidStoreIdError,
  RouteConflictError,
  createRouter,
} from '../dist/index.js'
import { runRouterCases } from './shared/cases.mjs'

describe('route-core router', () => {
  it('passes the shared semantic case suite', () => {
    runRouterCases(createRouter, {
      InvalidMethodError,
      InvalidPathError,
      InvalidStoreIdError,
      RouteConflictError,
    })
  })
})
