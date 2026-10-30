// Accepts es-CR and en formats: "1.250.000,50", "1,250,000.50", "250.000",
// "250 000", "₡250000". A lone dot followed by exactly three digits is read
// as a thousands separator, as written in Costa Rica.
export function parseMoney(value: string) {
  const raw = value.trim().replace(/[\s\u00a0₡]/g, "").replace(/^CRC/i, "");
  if (!raw) return NaN;
  const comma = raw.lastIndexOf(","),
    dot = raw.lastIndexOf(".");
  let normalized = raw;
  if (comma > dot) normalized = raw.replace(/\./g, "").replace(",", ".");
  else if (dot > comma && comma >= 0) normalized = raw.replace(/,/g, "");
  else if (comma >= 0) normalized = raw.replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(raw)) normalized = raw.replace(/\./g, "");
  return Number(normalized);
}
