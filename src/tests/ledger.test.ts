import { describe, expect, it } from "vitest";
import {
  allocatePayment,
  monthlyPayment,
  round2,
  schedule,
} from "../features/loan/loan-calculations";
import type { LoanConfig, Payment, Row } from "../features/loan/loan-types";

// Deterministic pseudo-random generator so failures are reproducible.
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}
const isCents = (n: number) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
const active = (rows: Row[]) => rows.filter((r) => r.status !== "Posterior");

function checkLedger(config: LoanConfig, payments: Payment[]) {
  const rows = schedule(config, payments);
  const rate = config.annualRate / 100 / 12;
  const live = active(rows);
  const bad = rows.find((r) =>
    [r.opening, r.due, r.paid, r.interest, r.principal, r.extra, r.closing, r.nextDue].some(
      (v) => !isCents(v) || v < 0,
    ),
  );
  expect(bad).toBeUndefined();
  live.forEach((r, i) => {
    expect(r.interest).toBe(round2(r.opening * rate));
    expect(round2(r.principal + r.extra + r.closing)).toBe(r.opening);
    expect(r.due).toBeLessThanOrEqual(round2(r.opening + r.interest));
    const next = live[i + 1];
    if (next) {
      const expected =
        r.status === "Parcial"
          ? round2(r.opening - Math.min(Math.max(r.due - r.interest, 0), r.opening) - r.extra)
          : r.closing;
      expect(next.opening).toBe(expected);
      expect(next.date > r.date).toBe(true);
    }
  });
  // with no further payments the projection always ends at exactly zero
  const last = live.at(-1)!;
  expect(last.closing).toBe(0);
  expect(last.status).toBe("Liquidado");
  return rows;
}

describe("libro del préstamo (escenarios aleatorios)", () => {
  it("cuadra al céntimo en 250 escenarios con pagos exactos, parciales, excedentes, abonos y atrasos", () => {
    const rand = rng(20261029);
    for (let s = 0; s < 250; s++) {
      const config: LoanConfig = {
        principal: round2(100_000 + rand() * 80_000_000),
        annualRate: round2(rand() * 24),
        years: 1 + Math.floor(rand() * 30),
        startDate: `20${24 + Math.floor(rand() * 4)}-${String(1 + Math.floor(rand() * 12)).padStart(2, "0")}-${String(1 + Math.floor(rand() * 31)).padStart(2, "0")}`.replace(/-(29|30|31)$/, (m) => m),
        strategy: rand() < 0.5 ? "recalculate" : "reduce-term",
      };
      // normalise impossible dates such as 30 Feb to the 28th
      const [y, mo, d] = config.startDate.split("-").map(Number);
      const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
      config.startDate = `${y}-${String(mo).padStart(2, "0")}-${String(Math.min(d, lastDay)).padStart(2, "0")}`;

      let payments: Payment[] = [];
      let id = 0;
      const steps = Math.floor(rand() * 40);
      for (let k = 0; k < steps; k++) {
        const rows = schedule(config, payments);
        const pending = rows.find((r) => r.status === "Parcial" || r.status === "Proyectado");
        if (!pending) break;
        const owed = pending.status === "Parcial" ? pending.due - pending.paid : pending.due;
        const roll = rand();
        // sometimes pay late, covering several installments at once
        const lateBy = roll < 0.15 ? 1 + Math.floor(rand() * 3) : 0;
        const payRow = rows[Math.min(rows.length - 1, pending.period - 1 + lateBy)];
        const amount = round2(
          roll < 0.35 ? owed : roll < 0.55 ? owed * rand() + 1 : roll < 0.8 ? owed * (1 + rand() * 3) : owed * (lateBy + 1),
        );
        const manual = rand() < 0.2 ? round2(rand() * 500_000) : 0;
        // occasionally an extraordinary contribution before the next due date
        const paidOn =
          rand() < 0.1 && pending.status === "Proyectado" && pending.period > 1
            ? rows[pending.period - 2].date
            : payRow.date;
        const entries = allocatePayment(config, payments, { amount, manualExtra: manual, paidOn, note: "" }, () => `p${id++}`);
        const total = round2(entries.reduce((sum, e) => sum + e.amount + e.manualExtra, 0));
        expect(total).toBe(round2(amount + manual));
        payments = [...payments, ...entries].sort((a, b) => a.period - b.period);
        if (k % 4 === 0) checkLedger(config, payments);
      }
      checkLedger(config, payments);
    }
  }, 120_000);

  it("sin abonos: lo pagado es exactamente el capital más los intereses", () => {
    const config: LoanConfig = { principal: 34509726.97, annualRate: 8, years: 30, startDate: "2026-10-01", strategy: "recalculate" };
    const rows = checkLedger(config, []);
    const paid = round2(rows.reduce((s, r) => s + r.paid, 0));
    const interest = round2(rows.reduce((s, r) => s + r.interest, 0));
    expect(round2(paid - interest)).toBe(config.principal);
    expect(rows[0].due).toBe(round2(monthlyPayment(config.principal, 0.08 / 12, 360)));
  });

  it("un pago que cubre dos cuotas atrasadas completa ambas antes de abonar", () => {
    const config: LoanConfig = { principal: 10_000_000, annualRate: 12, years: 10, startDate: "2026-01-15", strategy: "recalculate" };
    const due = schedule(config, [])[0].due;
    const entries = allocatePayment(config, [], { amount: round2(due * 2 + 50_000), manualExtra: 0, paidOn: "2026-02-20", note: "" }, () => crypto.randomUUID());
    expect(entries.map((e) => e.period)).toEqual([1, 2]);
    expect(entries[0].amount).toBe(due);
    const rows = schedule(config, entries);
    expect(rows[0].status).toBe("Registrado");
    expect(rows[1].status).toBe("Registrado");
    expect(rows[1].autoExtra).toBe(50_000);
  });

  it("un pago parcial deja pendiente la diferencia y el siguiente la completa primero", () => {
    const config: LoanConfig = { principal: 10_000_000, annualRate: 12, years: 10, startDate: "2026-01-15", strategy: "recalculate" };
    const due = schedule(config, [])[0].due;
    const first = allocatePayment(config, [], { amount: 50_000, manualExtra: 0, paidOn: "2026-01-15", note: "" }, () => "a");
    let rows = schedule(config, first);
    expect(rows[0].status).toBe("Parcial");
    expect(round2(rows[0].due - rows[0].paid)).toBe(round2(due - 50_000));
    const second = allocatePayment(config, first, { amount: round2(due - 50_000), manualExtra: 0, paidOn: "2026-01-20", note: "" }, () => "b");
    expect(second.map((e) => e.period)).toEqual([1]);
    rows = schedule(config, [...first, ...second]);
    expect(rows[0].status).toBe("Registrado");
    expect(rows[0].autoExtra).toBe(0);
  });

  it("si la cuota aún no vence, el pago va completo al capital", () => {
    const config: LoanConfig = { principal: 10_000_000, annualRate: 12, years: 10, startDate: "2026-01-15", strategy: "recalculate" };
    const first = allocatePayment(config, [], { amount: schedule(config, [])[0].due, manualExtra: 0, paidOn: "2026-01-15", note: "" }, () => "a");
    const early = allocatePayment(config, first, { amount: 100_000, manualExtra: 0, paidOn: "2026-02-01", note: "" }, () => "b");
    expect(early).toHaveLength(1);
    expect(early[0].kind).toBe("principal-only");
    expect(early[0].manualExtra).toBe(100_000);
    const rows = schedule(config, [...first, ...early]);
    expect(rows[0].extra).toBe(100_000);
  });
});
