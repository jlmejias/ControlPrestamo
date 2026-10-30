import { describe, expect, it } from "vitest";
import { allocatePayment, dueStatus, round2, schedule, simulateExtra } from "../features/loan/loan-calculations";
import { generateStatement, statementLines } from "../features/loan/statement";
import type { LoanState } from "../features/loan/loan-types";

const base: LoanState = {
  version: 1,
  config: { principal: 34509726.97, annualRate: 8, years: 30, startDate: "2026-09-01", strategy: "recalculate" },
  payments: [],
};
const add = (s: LoanState, amount: number, paidOn: string, manualExtra = 0): LoanState => ({
  ...s,
  payments: [
    ...s.payments,
    ...allocatePayment(s.config, s.payments, { amount, manualExtra, paidOn, note: "" }, () => crypto.randomUUID()),
  ],
});

describe("aviso de cuota", () => {
  it("distingue próxima, hoy, atrasada y parcial", () => {
    const rows = schedule(base.config, []);
    expect(dueStatus(rows, "2026-08-20")).toMatchObject({ kind: "ok", period: 1, days: 12 });
    expect(dueStatus(rows, "2026-08-28")).toMatchObject({ kind: "soon", days: 4 });
    expect(dueStatus(rows, "2026-09-01")).toMatchObject({ kind: "today", days: 0 });
    const late = dueStatus(rows, "2026-10-06");
    expect(late).toMatchObject({ kind: "overdue", days: -35, overdueCount: 2 });
    if (late.kind !== "done") expect(late.overdueTotal).toBe(round2(rows[0].due + rows[1].due));
    const partial = schedule(base.config, add(base, 100000, "2026-09-01").payments);
    expect(dueStatus(partial, "2026-09-02")).toMatchObject({ kind: "overdue", partial: true, owed: round2(partial[0].due - 100000) });
  });
});

describe("simulador", () => {
  it("recalcular baja la cuota; reducir plazo termina antes; ambos ahorran intereses", () => {
    const s = add(base, 253220.15, "2026-09-01");
    const rec = simulateExtra(s.config, s.payments, 1_000_000, "recalculate");
    const red = simulateExtra(s.config, s.payments, 1_000_000, "reduce-term");
    expect(rec.interestSaved).toBeGreaterThan(0);
    expect(rec.after.nextDue).toBeLessThan(rec.before.nextDue);
    expect(rec.installmentsSaved).toBe(0);
    expect(red.installmentsSaved).toBeGreaterThan(0);
    expect(red.after.lastDate < red.before.lastDate).toBe(true);
    expect(red.interestSaved).toBeGreaterThan(rec.interestSaved);
  });
});

describe("estado de cuenta", () => {
  it("los totales cuadran con el saldo", () => {
    let s = base;
    s = add(s, 100000, "2026-09-01");
    s = add(s, 160000, "2026-09-12");
    s = add(s, 300000, "2026-10-01", 20000);
    s = add(s, 75000, "2026-10-20");
    const { lines, totals, balance } = statementLines(s);
    expect(lines).toHaveLength(s.payments.length);
    expect(totals.amount).toBe(round2(s.payments.reduce((a, p) => a + p.amount + p.manualExtra, 0)));
    expect(round2(totals.interest + totals.principal)).toBe(totals.amount);
    expect(round2(base.config.principal - totals.principal)).toBe(balance);
    for (const l of lines) expect(round2(l.interest + l.principal)).toBe(l.amount);
    expect(generateStatement(s).filename).toMatch(/^estado-de-cuenta-/);
  });
});
