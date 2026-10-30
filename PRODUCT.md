# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
A homeowner in Costa Rica tracking their own construction loan. Confirmed: an informal private loan (not a bank), with no insurance, fees or commissions. Single person, uses it monthly when a payment is made and occasionally to see progress; on a desktop browser and on a phone.

## Product Purpose
Track a construction loan in colones (CRC): register each monthly payment, see how overpayments and extra principal contributions reduce the balance, and keep an always-current amortization schedule. Success: at any moment the owner knows the real balance, the next installment, and how much interest extra payments have saved.

## Positioning
Unlike a bank statement or a generic calculator, it applies the owner's actual payments (partial, exact, overpaid, or extra principal before the installment is due) to a live schedule and lets them choose between recalculating the installment or shortening the term.

## Operating Context
Used privately, data stays in the browser (localStorage) with JSON export/import as backup. Generates a PDF receipt per payment. Spanish (Costa Rica) copy, es-CR number and date formats, ₡ currency.

## Capabilities and Constraints
- Routes: Panel (dashboard), Pagos (register + history + PDF receipt), Amortización (360-row table + CSV), Configuración (principal, rate, term, first date, strategy; JSON export/import; print).
- Calculation logic in src/features/loan is the source of truth and must not change during visual work.
- React 19 + Vite + Tailwind 4 (plain CSS in styles.css), Radix dialogs, lucide icons.

## Brand Commitments
Name shown in app: "Mi Préstamo" / "Préstamo de construcción". No other brand assets.

## Evidence on Hand
Real data is the owner's own loan (default principal ₡34 509 726,97, 8%, 30 years). No testimonials or external claims; none should be invented.

## Product Principles
- The numbers are the product: balance, next installment, savings must be legible at a glance.
- Never let the owner record or delete a payment by accident.
- Calm and trustworthy, like a well-kept ledger, not a fintech promo.
