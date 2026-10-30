import { jsPDF } from "jspdf";
import { monthlyPayment, round2, schedule, totalInterest } from "./loan-calculations";
import { balanceAfter, breakdown, longDate, money, ordered, paidDate } from "./payment-receipt";
import type { LoanState } from "./loan-types";

export type StatementLine = {
  n: number;
  paidOn: string;
  concept: string;
  amount: number;
  interest: number;
  principal: number;
  balance: number;
};

/** Every payment in date order with how it was applied and the balance after it. */
export function statementLines(state: LoanState) {
  const all = ordered(state.payments);
  const lines: StatementLine[] = all.map((p, i) => {
    const earlier = all.slice(0, i);
    const upTo = all.slice(0, i + 1);
    const rows = schedule(state.config, upTo);
    const row = p.kind === "principal-only" ? undefined : rows[p.period - 1];
    const parts = breakdown(p, row, earlier);
    return {
      n: i + 1,
      paidOn: paidDate(p),
      concept: p.kind === "principal-only" ? "Abono al capital" : `Cuota ${p.period}`,
      amount: parts.total,
      interest: parts.interest,
      principal: round2(parts.principal + parts.extra),
      balance: balanceAfter(state, upTo, rows),
    };
  });
  const totals = {
    amount: round2(lines.reduce((s, l) => s + l.amount, 0)),
    interest: round2(lines.reduce((s, l) => s + l.interest, 0)),
    principal: round2(lines.reduce((s, l) => s + l.principal, 0)),
  };
  const balance = lines.at(-1)?.balance ?? state.config.principal;
  return { lines, totals, balance };
}

export function generateStatement(state: LoanState) {
  const { lines, totals, balance } = statementLines(state);
  const rows = schedule(state.config, state.payments);
  const next = rows.find((r) => r.status === "Parcial" || r.status === "Proyectado");
  const base = monthlyPayment(state.config.principal, state.config.annualRate / 1200, state.config.years * 12);
  const saved = Math.max(0, round2(base * state.config.years * 12 - state.config.principal - totalInterest(rows)));
  const today = new Date().toISOString().slice(0, 10);

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth(),
    H = doc.internal.pageSize.getHeight();
  const L = 16,
    R = W - 16;
  const ink: [number, number, number] = [27, 34, 32];
  const muted: [number, number, number] = [95, 107, 102];
  const rule: [number, number, number] = [201, 208, 203];
  const blue: [number, number, number] = [29, 79, 158];
  const text = (
    v: string,
    x: number,
    y: number,
    o: { size?: number; bold?: boolean; color?: [number, number, number]; align?: "left" | "right" | "center" } = {},
  ) => {
    doc.setFont("helvetica", o.bold ? "bold" : "normal");
    doc.setFontSize(o.size ?? 9);
    doc.setTextColor(...(o.color ?? ink));
    doc.text(v, x, y, { align: o.align ?? "left" });
  };
  const hline = (y: number, color = rule, w = 0.3) => {
    doc.setDrawColor(...color);
    doc.setLineWidth(w);
    doc.line(L, y, R, y);
  };
  const label = (v: string, x: number, y: number) => text(v.toUpperCase(), x, y, { size: 7, bold: true, color: muted });

  text("Estado de cuenta", L, 24, { size: 19, bold: true });
  text("Préstamo de construcción", L, 31, { size: 10, color: muted });
  text(`Al ${longDate(today)}`, R, 24, { size: 10, bold: true, align: "right" });
  text(`${lines.length} pagos registrados`, R, 31, { size: 9, color: muted, align: "right" });
  hline(36, ink, 0.6);

  // Summary grid
  const cells: Array<[string, string, boolean?]> = [
    ["Monto financiado", money(state.config.principal)],
    ["Total pagado", money(totals.amount)],
    ["Saldo pendiente", money(balance), true],
    ["Capital pagado", money(totals.principal)],
    ["Intereses pagados", money(totals.interest)],
    [next ? `Próxima cuota · ${longDate(next.date)}` : "Próxima cuota", next ? money(next.status === "Parcial" ? next.due - next.paid : next.due) : "Liquidado"],
  ];
  const cw = (R - L) / 3;
  cells.forEach(([name, value, strong], i) => {
    const x = L + cw * (i % 3),
      y = 42 + Math.floor(i / 3) * 20;
    doc.setDrawColor(...rule);
    doc.setLineWidth(0.3);
    if (strong) {
      doc.setFillColor(228, 235, 245);
      doc.rect(x, y, cw, 20, "FD");
    } else doc.rect(x, y, cw, 20);
    label(name, x + 4, y + 7);
    text(value, x + 4, y + 15, { size: 11.5, bold: true, color: strong ? blue : ink });
  });
  text(
    `Tasa ${state.config.annualRate}% anual · Plazo ${state.config.years} años · ${
      state.config.strategy === "recalculate" ? "Los abonos rebajan la cuota" : "Los abonos acortan el plazo"
    } · Intereses ahorrados con abonos: ${money(saved)}`,
    L,
    90,
    { size: 8, color: muted },
  );

  // Payments table
  const cols = [
    { h: "N.º", x: L + 1, align: "left" as const },
    { h: "Fecha de pago", x: L + 11, align: "left" as const },
    { h: "Concepto", x: L + 44, align: "left" as const },
    { h: "Monto pagado", x: L + 100, align: "right" as const },
    { h: "Intereses", x: L + 127, align: "right" as const },
    { h: "Capital", x: L + 152, align: "right" as const },
    { h: "Saldo", x: R - 1, align: "right" as const },
  ];
  let y = 102;
  const header = () => {
    cols.forEach((c) => text(c.h.toUpperCase(), c.x, y, { size: 7, bold: true, color: muted, align: c.align }));
    y += 3;
    hline(y, ink, 0.5);
    y += 6;
  };
  header();
  const shortDate = (d: string) =>
    new Intl.DateTimeFormat("es-CR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${d}T12:00:00`));
  const num = (v: number) => money(v).replace("CRC ", "");
  for (const l of lines) {
    if (y > H - 30) {
      doc.addPage();
      y = 20;
      header();
    }
    const vals = [String(l.n), shortDate(l.paidOn), l.concept, num(l.amount), num(l.interest), num(l.principal), num(l.balance)];
    vals.forEach((v, i) => text(v, cols[i].x, y, { size: 8.5, align: cols[i].align, bold: i === 3 }));
    y += 2.5;
    hline(y);
    y += 5;
  }
  if (!lines.length) {
    text("Todavía no hay pagos registrados.", L, y, { size: 9, color: muted });
    y += 8;
  }
  y += 1;
  text("Totales", cols[0].x, y, { size: 9, bold: true });
  [totals.amount, totals.interest, totals.principal].forEach((v, i) =>
    text(num(v), cols[3 + i].x, y, { size: 9, bold: true, align: "right" }),
  );
  y += 3;
  hline(y, ink, 0.5);
  y += 6;
  text("Montos en colones costarricenses (CRC). Capital incluye la parte de la cuota y los abonos extra.", L, y, {
    size: 7.5,
    color: muted,
  });

  if (y > H - 50) {
    doc.addPage();
    y = 20;
  }
  const sy = Math.max(y + 30, H - 40);
  doc.setDrawColor(...ink);
  doc.line(L, sy, L + 70, sy);
  doc.line(R - 70, sy, R, sy);
  text("Deudor", L, sy + 5, { size: 8.5, color: muted });
  text("Acreedor", R - 70, sy + 5, { size: 8.5, color: muted });

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    text(`Mi Préstamo · Estado de cuenta al ${longDate(today)} · Página ${p} de ${pages}`, W / 2, H - 10, {
      size: 7.5,
      color: muted,
      align: "center",
    });
  }
  const url = URL.createObjectURL(doc.output("blob"));
  return { filename: `estado-de-cuenta-${today}.pdf`, url };
}
