import { describe, expect, test } from 'bun:test'

import { randomId } from './random-id'

describe('randomId', () => {
  test('uses the browser UUID API when available', () => {
    const id = randomId({
      randomUUID: () => 'browser-uuid',
      getRandomValues: () => {
        throw new Error('fallback should not run')
      }
    })
    expect(id).toBe('browser-uuid')
  })

  test('creates a version 4 UUID when randomUUID is unavailable', () => {
    const id = randomId({
      getRandomValues: array => {
        for (let i = 0; i < array.length; i++) array[i] = i
        return array
      }
    })
    expect(id).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f')
  })
})
