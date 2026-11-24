import { describe, it, expect } from 'vitest'
import { formatPaise } from './money'

describe('formatPaise', () => {
  it('formats zero', () => {
    expect(formatPaise(0)).toBe('₹0.00')
  })

  it('formats a few paise', () => {
    expect(formatPaise(5)).toBe('₹0.05')
  })

  it('uses Indian digit grouping', () => {
    expect(formatPaise(12345678)).toBe('₹1,23,456.78')
  })

  it('matches the contract example', () => {
    expect(formatPaise(123450)).toBe('₹1,234.50')
  })

  it('formats large values without float drift', () => {
    expect(formatPaise(1234567890123)).toBe('₹12,34,56,78,901.23')
    expect(formatPaise(Number.MAX_SAFE_INTEGER)).toBe('₹9,00,71,99,25,47,409.91')
  })

  it('rejects values that are not integer paise', () => {
    expect(() => formatPaise(12.5)).toThrow(TypeError)
    expect(() => formatPaise('100')).toThrow(TypeError)
    expect(() => formatPaise(null)).toThrow(TypeError)
  })
})
