export type Strategy = "recalculate" | "reduce-term";
export type LoanConfig = {
  principal: number;
  annualRate: number;
  years: number;
  startDate: string;
  strategy: Strategy;
  /** Lender's WhatsApp number, used to send receipts. */
  lenderPhone?: string;
};
export type Payment = {
  id: string;
  period: number;
  date: string;
  amount: number;
  manualExtra: number;
  note: string;
  kind?: "payment" | "principal-only";
  /** Date the money was actually paid; `date` is the scheduled date. */
  paidOn?: string;
  /**
   * Colones per US dollar on the day of the payment. When set, the interest
   * part was handed over in dollars at this rate and the principal in colones.
   */
  usdRate?: number;
};
export type LoanState = { version: 1; config: LoanConfig; payments: Payment[] };
export type Row = {
  period: number;
  date: string;
  opening: number;
  due: number;
  paid: number;
  interest: number;
  principal: number;
  autoExtra: number;
  manualExtra: number;
  extra: number;
  closing: number;
  nextDue: number;
  status: "Proyectado" | "Parcial" | "Registrado" | "Liquidado" | "Posterior";
};
