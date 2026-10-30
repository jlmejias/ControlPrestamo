import { jsPDF } from "jspdf";
import { round2, schedule } from "./loan-calculations";
import type { LoanState, Payment, Row } from "./loan-types";

const amountFormat = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
// The built-in PDF fonts have no colón sign (₡), so amounts read "CRC 1.234,56".
export const money = (value: number) => `CRC ${amountFormat.format(round2(value)).replace(/\./g, " ")}`;
export const usdMoney = (value: number) => `USD ${amountFormat.format(round2(value)).replace(/\./g, " ")}`;

/**
 * What was handed over in each currency: principal in colones, interest in
 * dollars at the rate saved with the payment. Null when no rate was saved.
 */
export function currencySplit(payment: Payment, parts: { interest: number; principal: number; extra: number }) {
  const rate = payment.usdRate;
  if (!rate || !(rate > 0)) return null;
  return {
    rate,
    colones: round2(parts.principal + parts.extra),
    dollars: round2(parts.interest / rate),
    interestCrc: parts.interest,
  };
}
export const longDate = (value: string) =>
  new Intl.DateTimeFormat("es-CR", { dateStyle: "long" }).format(
    new Date(`${value}T12:00:00`),
  );
export const paidDate = (p: Payment) => p.paidOn ?? p.date;
export const ordered = (payments: Payment[]) =>
  [...payments].sort(
    (a, b) => paidDate(a).localeCompare(paidDate(b)) || a.period - b.period,
  );

/** Principal still owed after the given payments, exactly as the ledger has it. */
export function balanceAfter(state: LoanState, payments: Payment[], rows: Row[]) {
  const upfront = payments
    .filter((p) => p.kind === "principal-only" && p.period === 0)
    .reduce((sum, p) => sum + p.amount + p.manualExtra, 0);
  const paidPeriods = new Set(payments.filter((p) => p.period > 0).map((p) => p.period));
  const reduced = rows
    .filter((r) => paidPeriods.has(r.period))
    .reduce((sum, r) => sum + r.principal + r.extra, 0);
  return round2(Math.max(0, state.config.principal - upfront - reduced));
}

/**
 * How this one payment was applied: interest first, then the installment's
 * principal, and anything above the installment goes to principal as an
 * extra contribution. The parts always add up to the amount paid.
 */
export function breakdown(payment: Payment, row: Row | undefined, earlier: Payment[]) {
  const total = round2(payment.amount + payment.manualExtra);
  if (payment.kind === "principal-only" || !row) {
    return { interest: 0, principal: 0, extra: total, total };
  }
  const before = earlier
    .filter((p) => p.period === payment.period && p.kind !== "principal-only")
    .reduce((sum, p) => sum + p.amount, 0);
  const from = before,
    to = before + payment.amount;
  const overlap = (a: number, b: number) => Math.max(0, Math.min(to, b) - Math.max(from, a));
  const interest = round2(overlap(0, row.interest));
  const principal = round2(overlap(row.interest, row.due));
  const extra = round2(total - interest - principal);
  return { interest, principal, extra, total };
}

export function receiptData(state: LoanState, payment: Payment) {
  const all = ordered(state.payments);
  const index = all.findIndex((p) => p.id === payment.id);
  if (index < 0) throw new Error("No se encontró el pago.");
  const earlier = all.slice(0, index);
  const upToThis = all.slice(0, index + 1);
  const rowsBefore = schedule(state.config, earlier);
  const rowsAfter = schedule(state.config, upToThis);
  const capitalOnly = payment.kind === "principal-only";
  const row = capitalOnly ? undefined : rowsAfter[payment.period - 1];
  const parts = breakdown(payment, row, earlier);
  const balanceBefore = balanceAfter(state, earlier, rowsBefore);
  const balanceNow = balanceAfter(state, upToThis, rowsAfter);
  const next = rowsAfter.find((r) => r.status === "Parcial" || r.status === "Proyectado");
  const pending = row && row.status === "Parcial" ? round2(row.due - row.paid) : 0;
  const currency = currencySplit(payment, parts);
  return { index, capitalOnly, row, parts, balanceBefore, balanceNow, next, pending, currency };
}

/** Plain-text summary to send by WhatsApp, with the real colón sign. */
export function receiptText(state: LoanState, payment: Payment) {
  const d = receiptData(state, payment);
  const crc = (v: number) =>
    new Intl.NumberFormat("es-CR", { style: "currency", currency: "CRC" }).format(v);
  const usdText = (v: number) =>
    new Intl.NumberFormat("es-CR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
  const lines = [
    `*${d.capitalOnly ? "Comprobante de abono al capital" : "Comprobante de pago"} N.º ${String(d.index + 1).padStart(4, "0")}*`,
    `Fecha de pago: ${longDate(paidDate(payment))}`,
    d.capitalOnly ? "Abono extraordinario al capital" : `Cuota ${payment.period} de ${state.config.years * 12}`,
    "",
    `*Monto pagado: ${crc(d.parts.total)}*`,
    ...(d.capitalOnly
      ? []
      : [`• Intereses: ${crc(d.parts.interest)}`, `• Capital de la cuota: ${crc(d.parts.principal)}`]),
    ...(d.parts.extra > 0 ? [`• Abono extra al capital: ${crc(d.parts.extra)}`] : []),
    ...(d.currency
      ? [
          "",
          "*Cómo se pagó*",
          `• Capital en colones: ${crc(d.currency.colones)}`,
          ...(d.currency.dollars > 0
            ? [`• Intereses en dólares: US$${usdText(d.currency.dollars)} (a ${crc(d.currency.rate)} por dólar)`]
            : []),
        ]
      : []),
    "",
    `Saldo anterior: ${crc(d.balanceBefore)}`,
    `*Saldo nuevo: ${crc(d.balanceNow)}*`,
    d.pending > 0
      ? `Pendiente de esta cuota: ${crc(d.pending)}`
      : d.next
        ? `Próxima cuota: ${crc(d.next.due)} · vence el ${longDate(d.next.date)}`
        : "Préstamo liquidado",
    ...(payment.note.trim() ? ["", `Nota: ${payment.note.trim()}`] : []),
  ];
  return lines.join("\n");
}

export function generatePaymentReceipt(state: LoanState, payment: Payment) {
  const { index, capitalOnly, row, parts, balanceBefore, balanceNow, next, pending, currency } =
    receiptData(state, payment);
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const L = 20,
    R = W - 20;
  const ink: [number, number, number] = [27, 34, 32];
  const muted: [number, number, number] = [95, 107, 102];
  const rule: [number, number, number] = [201, 208, 203];
  const blue: [number, number, number] = [29, 79, 158];
  const text = (
    value: string,
    x: number,
    y: number,
    opts: { size?: number; bold?: boolean; color?: [number, number, number]; align?: "left" | "right" | "center" } = {},
  ) => {
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    doc.setFontSize(opts.size ?? 10);
    doc.setTextColor(...(opts.color ?? ink));
    doc.text(value, x, y, { align: opts.align ?? "left" });
  };
  const line = (y: number, color = rule, width = 0.3) => {
    doc.setDrawColor(...color);
    doc.setLineWidth(width);
    doc.line(L, y, R, y);
  };
  const label = (value: string, x: number, y: number, align: "left" | "right" = "left") =>
    text(value.toUpperCase(), x, y, { size: 7.5, bold: true, color: muted, align });

  // Header
  text(capitalOnly ? "Comprobante de abono al capital" : "Comprobante de pago", L, 26, { size: 19, bold: true });
  text("Préstamo de construcción", L, 33, { size: 10, color: muted });
  text(`N.º ${String(index + 1).padStart(4, "0")}`, R, 26, { size: 12, bold: true, align: "right" });
  text(`Fecha de pago: ${longDate(paidDate(payment))}`, R, 33, { size: 10, color: muted, align: "right" });
  line(39, ink, 0.6);

  // Amount paid, the one number that matters most
  // With a saved rate the box also says what went in each currency
  const boxH = currency ? 49 : 30;
  doc.setFillColor(228, 235, 245);
  doc.rect(L, 46, R - L, boxH, "F");
  if (currency) {
    doc.setDrawColor(190, 204, 226);
    doc.setLineWidth(0.3);
    doc.line(L + 6, 76, R - 6, 76);
    label("En colones (capital)", L + 6, 82);
    text(money(currency.colones), L + 6, 88, { size: 11, bold: true });
    if (currency.dollars > 0) {
      label("En dólares (intereses)", L + 72, 82);
      text(usdMoney(currency.dollars), L + 72, 88, { size: 11, bold: true });
      label("Tipo de cambio", R - 6, 82, "right");
      text(money(currency.rate), R - 6, 88, { size: 11, bold: true, align: "right" });
    }
  }
  label("Monto pagado", L + 6, 55);
  text(money(parts.total), L + 6, 68, { size: 24, bold: true, color: blue });
  label(capitalOnly ? "Aplicado como" : "Cuota", R - 6, 55, "right");
  text(
    capitalOnly ? "Abono extraordinario" : `Periodo ${payment.period} de ${state.config.years * 12}`,
    R - 6,
    63,
    { size: 11, bold: true, align: "right" },
  );
  if (row)
    text(`Vencimiento: ${longDate(row.date)}`, R - 6, 69.5, { size: 9, color: muted, align: "right" });

  // How it was applied
  let y = 46 + boxH + 14;
  text("Cómo se aplicó el pago", L, y, { size: 12, bold: true });
  y += 4;
  line(y);
  const rowLine = (name: string, value: number, note?: string) => {
    y += 8;
    text(name, L, y, { size: 10.5 });
    if (note) text(note, L, y + 4.5, { size: 8, color: muted });
    text(money(value), R, y, { size: 10.5, bold: true, align: "right" });
    y += note ? 5 : 0;
    y += 3;
    line(y);
  };
  if (!capitalOnly) {
    rowLine("Intereses del mes", parts.interest);
    rowLine("Capital incluido en la cuota", parts.principal);
  }
  rowLine(
    "Abono extra al capital",
    parts.extra,
    capitalOnly
      ? "La cuota del mes ya estaba pagada; todo el monto rebaja el capital."
      : parts.extra > 0
        ? "Lo pagado por encima de la cuota rebaja el capital."
        : undefined,
  );
  y += 8;
  text("Total", L, y, { size: 11, bold: true });
  text(money(parts.total), R, y, { size: 11, bold: true, align: "right" });
  y += 3;
  line(y, ink, 0.6);

  // Loan after this payment
  y += 14;
  text("Estado del préstamo después de este pago", L, y, { size: 12, bold: true });
  y += 6;
  const colW = (R - L) / 3;
  const cell = (i: number, name: string, value: string, sub?: string) => {
    const x = L + colW * i;
    doc.setDrawColor(...rule);
    doc.setLineWidth(0.3);
    doc.rect(x, y, colW, 24);
    label(name, x + 4, y + 7);
    text(value, x + 4, y + 15, { size: 12, bold: true });
    if (sub) text(sub, x + 4, y + 20.5, { size: 8, color: muted });
  };
  cell(0, "Saldo anterior", money(balanceBefore));
  cell(1, "Saldo nuevo", money(balanceNow), `Rebajó ${money(balanceBefore - balanceNow)}`);
  cell(
    2,
    pending > 0 ? "Pendiente de esta cuota" : "Próxima cuota",
    pending > 0 ? money(pending) : next ? money(next.due) : "Liquidado",
    pending > 0 ? "Se completa con el próximo pago" : next ? `Vence el ${longDate(next.date)}` : undefined,
  );
  y += 24;

  if (payment.note.trim()) {
    y += 12;
    label("Observación", L, y);
    const lines = doc.splitTextToSize(payment.note, R - L) as string[];
    text(lines.join("\n"), L, y + 6, { size: 10 });
    y += 6 + lines.length * 4.5;
  }

  // Loan terms, small
  y += 14;
  label("Condiciones del préstamo", L, y);
  y += 6;
  text(
    `Monto financiado ${money(state.config.principal)}  ·  Tasa ${state.config.annualRate}% anual  ·  Plazo ${state.config.years} años  ·  ${
      state.config.strategy === "recalculate" ? "Los abonos rebajan la cuota" : "Los abonos acortan el plazo"
    }`,
    L,
    y,
    { size: 8.5, color: muted },
  );

  // Signatures: useful for a private loan between people
  const sy = Math.min(272, Math.max(255, y + 12));
  doc.setDrawColor(...ink);
  doc.setLineWidth(0.3);
  doc.line(L, sy, L + 70, sy);
  doc.line(R - 70, sy, R, sy);
  text("Entregado por", L, sy + 5, { size: 8.5, color: muted });
  text("Recibido por", R - 70, sy + 5, { size: 8.5, color: muted });

  text(
    `Generado el ${longDate(new Date().toISOString().slice(0, 10))} con Mi Préstamo. Montos en colones costarricenses (CRC)${currency ? " salvo los indicados en dólares (USD)" : ""}.`,
    W / 2,
    285,
    { size: 7.5, color: muted, align: "center" },
  );

  const filename = capitalOnly
    ? `comprobante-abono-capital-${paidDate(payment)}.pdf`
    : `comprobante-pago-periodo-${payment.period}.pdf`;
  const blob = doc.output("blob");
  const url = URL.createObjectURL(blob);
  return { filename, url, blob };
}
