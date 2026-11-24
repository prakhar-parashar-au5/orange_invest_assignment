const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

// Integer paise → "₹1,23,456.78". Builds a decimal string instead of dividing by 100,
// so no float ever touches the money.
export function formatPaise(paise) {
  if (!Number.isSafeInteger(paise)) {
    throw new TypeError(`formatPaise expects integer paise, got ${String(paise)}`)
  }
  const sign = paise < 0 ? '-' : ''
  const abs = String(Math.abs(paise)).padStart(3, '0')
  return inr.format(`${sign}${abs.slice(0, -2)}.${abs.slice(-2)}`)
}
