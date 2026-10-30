import { describe, expect, it } from "vitest";
import { allocatePayment, round2, schedule } from "../features/loan/loan-calculations";
import { balanceAfter, breakdown, generatePaymentReceipt } from "../features/loan/payment-receipt";
import type { LoanState, Payment } from "../features/loan/loan-types";

const base: LoanState = {
  version: 1,
  config: { principal: 34509726.97, annualRate: 8, years: 30, startDate: "2026-09-01", strategy: "recalculate" },
  payments: [],
};
function pay(state: LoanState, amount: number, paidOn: string, manualExtra = 0) {
  const entries = allocatePayment(state.config, state.payments, { amount, manualExtra, paidOn, note: "" }, () => crypto.randomUUID());
  return { state: { ...state, payments: [...state.payments, ...entries] }, entries };
}

describe("comprobante", () => {
  it("el desglose suma exactamente lo pagado y cuadra con la rebaja del saldo", () => {
    let s = base;
    const steps: Array<[number, string, number?]> = [
      [100000, "2026-09-01"], // parcial
      [153220.15, "2026-09-10"], // completa la cuota 1
      [300000, "2026-10-01", 25000], // con excedente y abono manual
      [80000, "2026-10-15"], // abono antes de la siguiente cuota
    ];
    for (const [amount, paidOn, manual] of steps) {
      const before = s;
      const r = pay(s, amount, paidOn, manual ?? 0);
      s = r.state;
      for (const p of r.entries) {
        const earlier = s.payments.filter((x) => !r.entries.includes(x) || r.entries.indexOf(x) < r.entries.indexOf(p));
        const prior = earlier.filter((x) => x !== p);
        const row = p.kind === "principal-only" ? undefined : schedule(s.config, [...prior, p])[p.period - 1];
        const parts = breakdown(p, row, prior);
        expect(round2(parts.interest + parts.principal + parts.extra)).toBe(round2(p.amount + p.manualExtra));
        const drop = round2(
          balanceAfter(s, prior, schedule(s.config, prior)) - balanceAfter(s, [...prior, p], schedule(s.config, [...prior, p])),
        );
        expect(drop).toBe(round2(parts.principal + parts.extra));
      }
      expect(before).not.toBe(s);
    }
    // the PDF renders for every payment without errors
    for (const p of s.payments) expect(generatePaymentReceipt(s, p as Payment).filename).toMatch(/\.pdf$/);
  });
});

describe("pago en dos monedas", () => {
  it("el capital va en colones y los intereses en dólares al tipo de cambio guardado", async () => {
    const { receiptData, receiptText } = await import("../features/loan/payment-receipt");
    const r = pay(base, 450000, "2026-09-01");
    const p = { ...r.entries[0], usdRate: 505.62 };
    const state = { ...r.state, payments: [p] };
    const d = receiptData(state, p);
    expect(d.parts.interest).toBe(230064.85);
    // intereses en colones; la cuota y el extra en dólares; el total se convierte una sola vez
    expect(d.currency).toEqual({
      rate: 505.62,
      colones: 230064.85,
      cuotaUsd: 45.8,
      extraUsd: 389.18,
      dollars: 434.98,
      cuotaCrc: 23155.3,
      extraCrc: 196779.85,
      capitalCrc: 219935.15,
    });
    expect(round2(d.currency!.cuotaUsd + d.currency!.extraUsd)).toBe(d.currency!.dollars);
    const text = receiptText(state, p);
    expect(text).toContain("Intereses en colones: ₡230");
    expect(text).toContain("Capital de la cuota en dólares: US$45,80");
    expect(text).toContain("Monto extra en dólares: US$389,18");
    expect(text).toContain("Total en dólares: US$434,98 (equivale a ₡219");
    expect(text).toContain("US$45,80 (equivale a ₡23");
    const pdf = generatePaymentReceipt(state, p);
    expect(pdf.blob.size).toBeGreaterThan(1000);
  });

  it("sin tipo de cambio guardado el comprobante queda solo en colones", async () => {
    const { receiptData } = await import("../features/loan/payment-receipt");
    const r = pay(base, 450000, "2026-09-01");
    expect(receiptData(r.state, r.entries[0]).currency).toBeNull();
  });
});
