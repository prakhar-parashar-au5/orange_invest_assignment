const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * Formats a UTC instant as ISO 8601 in IST, with seconds precision.
 * Example: 2026-11-24T15:00:00Z → '2026-11-24T20:30:00+05:30'
 * @param {Date} date
 */
export function toIstIso(date) {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  return `${shifted.toISOString().slice(0, 19)}+05:30`;
}
