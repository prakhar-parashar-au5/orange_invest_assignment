const GROUP = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/** Integer paise → '₹1,23,456.78', using integer maths only. */
export function formatInr(paise) {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const rest = String(abs % 100).padStart(2, '0');
  return `${sign}₹${GROUP.format(rupees)}.${rest}`;
}

/** The money shape every agent tool returns: exact paise plus a display string. */
export const money = (paise) => ({ paise, inr: formatInr(paise) });
