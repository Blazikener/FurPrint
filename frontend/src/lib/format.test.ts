import { describe, expect, it } from 'vitest'
import { catLabel, meters, timeAgo } from './format'

describe('format', () => {
  it('formats distances', () => {
    expect(meters(39)).toBe('39 m')
    expect(meters(1609)).toBe('1.6 km')
    expect(meters(12000)).toBe('12 km')
  })
  it('formats elapsed time', () => {
    const now = Date.parse('2026-11-07T12:00:00Z')
    expect(timeAgo('2026-11-07T11:59:30Z', now)).toBe('just now')
    expect(timeAgo('2026-11-07T09:00:00Z', now)).toBe('3 h ago')
    expect(timeAgo('2026-11-06T09:00:00Z', now)).toBe('yesterday')
    expect(timeAgo('2026-11-03T09:00:00Z', now)).toBe('4 days ago')
  })
  it('falls back to a generic name', () => {
    expect(catLabel(null)).toBe('Lost cat')
    expect(catLabel('  ', 'found')).toBe('Found cat')
    expect(catLabel('Mishmish')).toBe('Mishmish')
  })
})
