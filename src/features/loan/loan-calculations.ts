import type { LoanConfig, Payment, Row } from "./loan-types";
export const monthlyPayment = (
  balance: number,
  rate: number,
  months: number,
) =>
  months <= 0 || balance <= 0
    ? 0
    : rate === 0
      ? balance / months
      : (balance * rate) / (1 - Math.pow(1 + rate, -months));
// Keeps the original day of month, clamped to the month's last day
// (31 Jan -> 28 Feb -> 31 Mar) instead of overflowing into the next month.
const addMonths = (iso: string, n: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
};
// Money is kept in exact céntimos at every step, like a real ledger, so
// row amounts always add up and no fractions of a céntimo accumulate.
export const round2 = (n: number) =>
  Math.round((n + Number.EPSILON) * 100) / 100;
export function schedule(config: LoanConfig, payments: Payment[]): Row[] {
  const months = config.years * 12,
    rate = config.annualRate / 100 / 12,
    original = round2(monthlyPayment(config.principal, rate, months));
  const upfrontCapital = round2(
    payments
      .filter(
        (payment) => payment.kind === "principal-only" && payment.period === 0,
      )
      .reduce((sum, payment) => sum + payment.amount + payment.manualExtra, 0),
  );
  let balance = round2(Math.max(0, config.principal - upfrontCapital)),
    due =
      config.strategy === "recalculate"
        ? round2(monthlyPayment(balance, rate, months))
        : original,
    liquidated = false;
  const map = new Map<number, Payment[]>();
  for (const payment of payments) {
    if (payment.period === 0) continue;
    map.set(payment.period, [...(map.get(payment.period) ?? []), payment]);
  }
  const rows: Row[] = [];
  for (let i = 1; i <= months; i++) {
    if (liquidated) {
      rows.push({
        period: i,
        date: addMonths(config.startDate, i - 1),
        opening: 0,
        due: 0,
        paid: 0,
        interest: 0,
        principal: 0,
        autoExtra: 0,
        manualExtra: 0,
        extra: 0,
        closing: 0,
        nextDue: 0,
        status: "Posterior",
      });
      continue;
    }
    const entries = map.get(i) ?? [];
    const regularPayments = entries.filter((payment) => payment.kind !== "principal-only");
    const p = regularPayments[0];
    const interest = round2(balance * rate);
    // The installment can never exceed what is owed, and the last one
    // settles the exact remainder.
    if (i === months || due > balance + interest) due = round2(balance + interest);
    const capitalOnly = round2(
        entries
          .filter((payment) => payment.kind === "principal-only")
          .reduce((sum, payment) => sum + payment.amount + payment.manualExtra, 0),
      ),
      paid = round2(regularPayments.reduce((sum, payment) => sum + payment.amount, 0)),
      normalApplied = p ? Math.min(paid, due) : due,
      autoExtra = p ? round2(Math.max(paid - due, 0)) : 0,
      manual = round2(
        regularPayments.reduce((sum, payment) => sum + payment.manualExtra, 0) +
          capitalOnly,
      ),
      principal = round2(Math.min(Math.max(normalApplied - interest, 0), balance)),
      extra = round2(Math.max(0, Math.min(autoExtra + manual, balance - principal))),
      closing = round2(Math.max(0, balance - principal - extra)),
      remaining = months - i,
      next =
        config.strategy === "recalculate"
          ? round2(monthlyPayment(closing, rate, remaining))
          : round2(Math.min(original, closing + closing * rate));
    const partial = Boolean(p && paid < due && closing > 0);
    const projectedClosing = partial
      ? round2(Math.max(0, balance - Math.min(Math.max(due - interest, 0), balance) - extra))
      : closing;
    const projectedNext = config.strategy === "recalculate"
      ? round2(monthlyPayment(projectedClosing, rate, remaining))
      : next;
    const status =
      closing <= 0 ? "Liquidado" : partial ? "Parcial" : p ? "Registrado" : "Proyectado";
    rows.push({
      period: i,
      date: p?.date ?? addMonths(config.startDate, i - 1),
      opening: balance,
      due,
      paid: p ? paid : due,
      interest,
      principal,
      autoExtra,
      manualExtra: manual,
      extra,
      closing,
      nextDue: projectedNext,
      status,
    });
    balance = projectedClosing;
    due = projectedNext;
    if (status === "Liquidado") liquidated = true;
  }
  return rows;
}
export const totalInterest = (rows: Row[]) =>
  rows
    .filter((r) => r.status !== "Posterior")
    .reduce((s, r) => s + r.interest, 0);
// The projection always closes the final period as "Liquidado", so only
// rows backed by an actual payment count as registered.
export function registeredRows(rows: Row[], payments: Payment[]) {
  const paidPeriods = new Set(
    payments
      .filter((payment) => payment.kind !== "principal-only")
      .map((payment) => payment.period),
  );
  return rows.filter(
    (r) =>
      paidPeriods.has(r.period) &&
      (r.status === "Registrado" || r.status === "Liquidado"),
  );
}
export type PaymentInput = {
  amount: number;
  manualExtra: number;
  paidOn: string;
  note: string;
};
// Turns one real payment into ledger entries:
// - installments already due on `paidOn` are covered oldest first (a partial
//   one is completed before the next), and any surplus goes to principal;
// - with nothing due yet (the current installment is paid), it all goes to
//   principal as an extraordinary contribution.
export function allocatePayment(
  config: LoanConfig,
  payments: Payment[],
  input: PaymentInput,
  makeId: () => string,
): Payment[] {
  const amount = round2(input.amount),
    manual = round2(input.manualExtra || 0);
  const rows = schedule(config, payments);
  const due = rows.filter(
    (r) =>
      (r.status === "Parcial" || r.status === "Proyectado") &&
      r.date <= input.paidOn,
  );
  if (!due.length) {
    const contributionPeriod = Math.max(
      0,
      ...payments
        .filter((payment) => payment.kind !== "principal-only")
        .map((payment) => payment.period),
    );
    return [
      {
        id: makeId(),
        period: contributionPeriod,
        date: input.paidOn,
        amount: 0,
        manualExtra: round2(amount + manual),
        note: input.note,
        kind: "principal-only",
        paidOn: input.paidOn,
      },
    ];
  }
  const out: Payment[] = [];
  let left = amount,
    current = payments;
  for (const target of due) {
    const row = schedule(config, current)[target.period - 1];
    if (row.status !== "Parcial" && row.status !== "Proyectado") break;
    const owed = round2(row.status === "Parcial" ? row.due - row.paid : row.due);
    const take = round2(Math.min(left, owed));
    if (take <= 0) break;
    const entry: Payment = {
      id: makeId(),
      period: row.period,
      date: row.date,
      amount: take,
      manualExtra: 0,
      note: input.note,
      kind: "payment",
      paidOn: input.paidOn,
    };
    out.push(entry);
    current = [...current, entry];
    left = round2(left - take);
    if (left <= 0) break;
  }
  const last = out[out.length - 1];
  if (!last) return [];
  last.amount = round2(last.amount + left);
  last.manualExtra = manual;
  return out;
}

const dayMs = 86_400_000;
const daysBetween = (from: string, to: string) =>
  Math.round(
    (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / dayMs,
  );
const owedOn = (r: Row) => round2(r.status === "Parcial" ? r.due - r.paid : r.due);

export type DueStatus =
  | { kind: "done" }
  | {
      kind: "overdue" | "today" | "soon" | "ok";
      period: number;
      date: string;
      /** days until the due date (negative when overdue) */
      days: number;
      owed: number;
      partial: boolean;
      overdueCount: number;
      overdueTotal: number;
    };
/** Where the borrower stands today with the next installment. */
export function dueStatus(rows: Row[], today: string): DueStatus {
  const pending = rows.filter((r) => r.status === "Parcial" || r.status === "Proyectado");
  const next = pending[0];
  if (!next) return { kind: "done" };
  const overdue = pending.filter((r) => r.date < today);
  const days = daysBetween(today, next.date);
  return {
    kind: days < 0 ? "overdue" : days === 0 ? "today" : days <= 7 ? "soon" : "ok",
    period: next.period,
    date: next.date,
    days,
    owed: owedOn(next),
    partial: next.status === "Parcial",
    overdueCount: overdue.length,
    overdueTotal: round2(overdue.reduce((sum, r) => sum + owedOn(r), 0)),
  };
}

export type Projection = {
  interestLeft: number;
  lastDate: string;
  installmentsLeft: number;
  nextDue: number;
};
function project(rows: Row[], payments: Payment[]): Projection {
  const paid = new Set(registeredRows(rows, payments));
  const left = rows.filter((r) => r.status !== "Posterior" && !paid.has(r));
  return {
    interestLeft: round2(left.reduce((sum, r) => sum + r.interest, 0)),
    lastDate: left.at(-1)?.date ?? rows.filter((r) => r.status !== "Posterior").at(-1)?.date ?? "",
    installmentsLeft: left.length,
    nextDue: left[0]?.due ?? 0,
  };
}
/**
 * What an extra principal contribution made now would change, under the
 * given strategy. Nothing is saved.
 */
export function simulateExtra(
  config: LoanConfig,
  payments: Payment[],
  amount: number,
  strategy: LoanConfig["strategy"],
) {
  const cfg = { ...config, strategy };
  const contributionPeriod = Math.max(
    0,
    ...payments.filter((p) => p.kind !== "principal-only").map((p) => p.period),
  );
  const extra: Payment = {
    id: "simulacion",
    period: contributionPeriod,
    date: "",
    amount: 0,
    manualExtra: round2(amount),
    note: "",
    kind: "principal-only",
  };
  const before = project(schedule(cfg, payments), payments);
  const after = project(schedule(cfg, [...payments, extra]), payments);
  return {
    before,
    after,
    interestSaved: round2(before.interestLeft - after.interestLeft),
    installmentsSaved: before.installmentsLeft - after.installmentsLeft,
  };
}
