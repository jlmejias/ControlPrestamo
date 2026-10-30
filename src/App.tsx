import { useCallback, useEffect, useMemo, useState } from "react";
import {
  NavLink,
  Navigate,
  Route,
  Routes,
  useNavigate,
} from "react-router-dom";
import * as Dialog from "@radix-ui/react-dialog";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  AlertTriangle,
  BarChart3,
  Calculator,
  CalendarClock,
  CircleDollarSign,
  Download,
  FileText,
  FileUp,
  Cloud,
  CloudOff,
  History,
  MessageCircle,
  Share2,
  LogOut,
  Pencil,
  RotateCcw,
  ShieldCheck,
  ShieldAlert,
  Plus,
  Printer,
  Settings,
  Table2,
  Trash2,
} from "lucide-react";
import { loadState, saveState } from "./features/loan/loan-storage";
import {
  allocatePayment,
  dueStatus,
  round2,
  simulateExtra,
  monthlyPayment,
  registeredRows,
  schedule,
  totalInterest,
} from "./features/loan/loan-calculations";
import type { LoanState, Payment } from "./features/loan/loan-types";
import {
  breakdown,
  generatePaymentReceipt,
  receiptData,
  receiptText,
} from "./features/loan/payment-receipt";
import { generateStatement } from "./features/loan/statement";
import { parseMoney } from "./lib/number-parser";
import { useUsdRate } from "./features/loan/exchange-rate";
import { useCloudSync, type CloudSync } from "./features/loan/use-cloud-sync";
import {
  autoBackupSupported,
  backupFilename,
  fingerprint,
  forgetBackupFile,
  getBackupHandle,
  hasPermission,
  isLoanState,
  loadBackupInfo,
  loadSnapshots,
  markBackedUp,
  pickBackupFile,
  pushSnapshot,
  writeBackup,
  type BackupInfo,
  type FileHandle,
} from "./features/loan/loan-backup";
const crc = new Intl.NumberFormat("es-CR", {
  style: "currency",
  currency: "CRC",
  minimumFractionDigits: 2,
});
const money = (n: number) => crc.format(n);
const usdFormat = new Intl.NumberFormat("es-CR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const usd = (n: number) => `US$${usdFormat.format(n)}`;
const date = (s: string) =>
  new Intl.DateTimeFormat("es-CR", { dateStyle: "medium" }).format(
    new Date(`${s}T12:00:00`),
  );
const todayISO = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};
const paidDate = (p: Payment) => p.paidOn ?? p.date;
type SetLoan = (s: LoanState, label?: string) => void;
type Backup = {
  info: BackupInfo | null;
  dirty: boolean;
  supported: boolean;
  fileName: string | null;
  status: "off" | "active" | "needs-permission" | "error";
  download: () => void;
  choose: () => Promise<void>;
  reactivate: () => Promise<void>;
  forget: () => Promise<void>;
};
const nav = [
  ["/dashboard", "Panel", BarChart3],
  ["/pagos", "Pagos", CircleDollarSign],
  ["/amortizacion", "Amortización", Table2],
  ["/simulador", "Simulador", Calculator],
  ["/configuracion", "Configuración", Settings],
] as const;
function nextInstallment(state: LoanState) {
  const rows = schedule(state.config, state.payments);
  return rows.find((r) => r.status === "Parcial" || r.status === "Proyectado");
}
function BrandMark() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className="mark">
      <rect x="2.5" y="2.5" width="27" height="27" rx="2" />
      <path d="M2.5 21.5h27M18.5 21.5v8M7 17V11l6-4.5L19 11v6" />
      <path d="M11 17v-4h4v4" />
    </svg>
  );
}
const syncLabel: Record<CloudSync["status"], string> = {
  local: "",
  saving: "Guardando…",
  saved: "Guardado en tu cuenta",
  offline: "Sin conexión: se guardará al volver",
  conflict: "Cambios en otro dispositivo",
};
type Receipt = {
  filename: string;
  url: string;
  blob: Blob;
  state: LoanState;
  payment: Payment;
  justSaved: boolean;
};
const waNumber = (phone?: string) => {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length === 8 ? `506${digits}` : digits;
};
const waLink = (phone: string | undefined, text: string) =>
  `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(text)}`;
function downloadUrl(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
/**
 * On phones this opens the share sheet with the PDF attached, so it can go to
 * WhatsApp; where files can't be shared it downloads the PDF and opens the
 * WhatsApp chat with the summary text.
 */
async function sendReceipt(r: Receipt) {
  const text = receiptText(r.state, r.payment);
  const file = new File([r.blob], r.filename, { type: "application/pdf" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text, title: r.filename });
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
    }
  }
  downloadUrl(r.url, r.filename);
  window.open(waLink(r.state.config.lenderPhone, text), "_blank", "noopener");
}
function openStatement(state: LoanState) {
  const { url, filename } = generateStatement(state);
  downloadUrl(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
function Shell({
  state,
  sync,
  children,
}: {
  state: LoanState;
  sync: CloudSync;
  children: React.ReactNode;
}) {
  const upcoming = useMemo(() => nextInstallment(state), [state]);
  const late = Boolean(upcoming && upcoming.date < todayISO());
  return (
    <div className="app">
      <h1 className="sr-only">Control de préstamo de construcción</h1>
      <header className="topbar">
        <NavLink to="/dashboard" className="brand" aria-label="Mi Préstamo, ir al panel">
          <BrandMark />
          <span>
            <b>Mi Préstamo</b>
            <small>Préstamo de construcción</small>
          </span>
        </NavLink>
        <nav className="tabs" aria-label="Secciones">
          {nav.map(([to, label, Icon]) => (
            <NavLink key={to} to={to}>
              <Icon aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        {sync.status !== "local" && (
          <span
            className={`sync ${sync.status}`}
            role="status"
            title={syncLabel[sync.status]}
          >
            {sync.status === "offline" || sync.status === "conflict" ? (
              <CloudOff aria-hidden="true" />
            ) : (
              <Cloud aria-hidden="true" />
            )}
            <span className="sync-text">{syncLabel[sync.status]}</span>
          </span>
        )}
        <div className={late ? "next-pay late" : "next-pay"}>
          <small>{late ? "Pago atrasado" : "Próximo pago"}</small>
          {upcoming ? (
            <span>
              <b className="num">{money(upcoming.due)}</b>
              <em>{date(upcoming.date)}</em>
            </span>
          ) : (
            <span>
              <b>Liquidado</b>
            </span>
          )}
        </div>
      </header>
      {sync.status === "conflict" && (
        <div className="conflict-bar" role="alert">
          <div>
            <b>Los datos de tu cuenta cambiaron en otro dispositivo</b>
            <span>
              Elige con cuáles seguir. Los otros quedan guardados como versión
              anterior.
            </span>
          </div>
          <div className="head-actions">
            <button className="button primary" onClick={() => void sync.loadRemote()}>
              Usar los de la cuenta
            </button>
            <button className="button" onClick={() => void sync.keepMine()}>
              Conservar los de este dispositivo
            </button>
          </div>
        </div>
      )}
      <main>{children}</main>
    </div>
  );
}
function Dimension({
  paid,
  total,
}: {
  paid: number;
  total: number;
}) {
  const share = total > 0 ? Math.min(1, Math.max(0, paid / total)) : 0;
  const pct = (share * 100).toLocaleString("es-CR", {
    maximumFractionDigits: 1,
  });
  return (
    <figure className="cota" aria-label={`Capital pagado: ${pct}%`}>
      <div className="cota-labels">
        <span>
          <small>Capital pagado</small>
          <span className="cota-paid">
            <b className="num">{money(paid)}</b>
            <span className="cota-pct num">{pct}%</span>
          </span>
        </span>
        <span className="end">
          <small>Monto financiado</small>
          <b className="num">{money(total)}</b>
        </span>
      </div>
      <div
        className="cota-line"
        role="progressbar"
        aria-label="Capital pagado"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(share * 100)}
      >
        <i style={{ width: `${share * 100}%` }} />
        <b style={{ left: `${share * 100}%` }} />
      </div>
    </figure>
  );
}
const shortDate = (s: string) =>
  new Intl.DateTimeFormat("es-CR", { day: "2-digit", month: "short" })
    .format(new Date(`${s}T12:00:00`))
    .replace(".", "");
function relativeDays(iso: string) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return days <= 0 ? "hoy" : days === 1 ? "ayer" : `hace ${days} días`;
}
function DueAlert({ state }: { state: LoanState }) {
  const status = dueStatus(schedule(state.config, state.payments), todayISO());
  if (status.kind === "done" || status.kind === "ok") return null;
  const tone = status.kind === "overdue" ? "late" : "soon";
  const title =
    status.kind === "overdue"
      ? status.overdueCount > 1
        ? `Tienes ${status.overdueCount} cuotas atrasadas`
        : `La cuota del periodo ${status.period} está atrasada ${-status.days === 1 ? "1 día" : `${-status.days} días`}`
      : status.kind === "today"
        ? `Tu cuota vence hoy`
        : `Tu cuota vence en ${status.days === 1 ? "1 día" : `${status.days} días`}`;
  const detail =
    status.kind === "overdue" && status.overdueCount > 1
      ? `Debes ${money(status.overdueTotal)} en total. La más antigua venció el ${date(status.date)}.`
      : status.partial
        ? `Te faltan ${money(status.owed)} para completar la cuota del periodo ${status.period}.`
        : `${money(status.owed)} · periodo ${status.period} · vence el ${date(status.date)}.`;
  return (
    <div className={`due-bar ${tone}`} role={tone === "late" ? "alert" : "status"}>
      {tone === "late" ? <AlertTriangle aria-hidden="true" /> : <CalendarClock aria-hidden="true" />}
      <div>
        <b>{title}</b>
        <span>{detail}</span>
      </div>
      <NavLink className="button" to="/pagos">
        Pagar ahora
      </NavLink>
    </div>
  );
}
function BackupBanner({ backup, state }: { backup: Backup; state: LoanState }) {
  if (!backup.dirty || state.payments.length === 0) return null;
  return (
    <div className="backup-bar" role="status">
      <ShieldAlert aria-hidden="true" />
      <div>
        <b>Tienes cambios sin respaldar</b>
        <span>
          {backup.info
            ? `Último respaldo ${relativeDays(backup.info.at)}, el ${date(backup.info.at.slice(0, 10))}.`
            : "Todavía no has guardado ningún respaldo fuera de este navegador."}
        </span>
      </div>
      {backup.status === "needs-permission" ? (
        <button className="button" onClick={backup.reactivate}>
          <ShieldCheck />
          Reactivar respaldo automático
        </button>
      ) : (
        <button className="button" onClick={backup.download}>
          <Download />
          Descargar respaldo
        </button>
      )}
    </div>
  );
}
function Dashboard({
  state,
  backup,
  inCloud,
}: {
  state: LoanState;
  backup: Backup;
  inCloud: boolean;
}) {
  const rows = useMemo(() => schedule(state.config, state.payments), [state]),
    registered = registeredRows(rows, state.payments),
    current = registered.at(-1),
    balance = current?.closing ?? rows[0]?.opening ?? state.config.principal,
    next = current?.nextDue ?? rows[0].due,
    base = monthlyPayment(
      state.config.principal,
      state.config.annualRate / 1200,
      state.config.years * 12,
    );
  const pending = rows.filter(
      (r) => r.status !== "Posterior" && !registered.includes(r),
    ),
    projected = pending.reduce((sum, r) => sum + r.interest, 0),
    lastPeriod = rows.filter((r) => r.status !== "Posterior").length,
    baseline = base * state.config.years * 12 - state.config.principal,
    saved = Math.max(0, baseline - totalInterest(rows)),
    totalPaid = state.payments.reduce(
      (sum, p) => sum + p.amount + p.manualExtra,
      0,
    ),
    remaining = pending.length,
    upcoming = rows.find(
      (r) => r.status === "Parcial" || r.status === "Proyectado",
    );
  return (
    <section className="page">
      <div className="page-head">
        <div>
          <h2>Resumen del préstamo</h2>
          <p>Saldo, próxima cuota y el efecto de tus abonos al capital.</p>
        </div>
        <NavLink className="button primary" to="/pagos">
          <Plus />
          Registrar pago
        </NavLink>
      </div>
      <DueAlert state={state} />
      {!inCloud && <BackupBanner backup={backup} state={state} />}
      <div className="sheet hero">
        <div className="hero-main">
          <span className="label">Saldo pendiente</span>
          <strong className="figure num">{money(balance)}</strong>
          <Dimension
            paid={Math.max(0, state.config.principal - balance)}
            total={state.config.principal}
          />
        </div>
        <div className="hero-side">
          <span className="label">Siguiente cuota</span>
          <strong className="figure small num">
            {money(upcoming?.due ?? next)}
          </strong>
          <p>
            {upcoming ? (
              <>
                Periodo {upcoming.period} de {lastPeriod}
                <br />
                Vence el {date(upcoming.date)}
              </>
            ) : (
              "Sin cuotas pendientes"
            )}
          </p>
        </div>
      </div>
      <dl className="figures">
        <div>
          <dt>Cuotas restantes</dt>
          <dd className="num">{remaining}</dd>
        </div>
        <div>
          <dt>Total pagado</dt>
          <dd className="num">{money(totalPaid)}</dd>
        </div>
        <div className="good">
          <dt>Intereses ahorrados</dt>
          <dd className="num">{money(saved)}</dd>
        </div>
        <div>
          <dt>Intereses por pagar</dt>
          <dd className="num">{money(projected)}</dd>
        </div>
      </dl>
      <div className="grid2">
        <div className="sheet">
          <div className="sheet-title">
            <h3>Datos del préstamo</h3>
            <NavLink to="/configuracion">Editar</NavLink>
          </div>
          <dl className="cajetin">
            <div className="span2">
              <dt>Monto financiado</dt>
              <dd className="num">{money(state.config.principal)}</dd>
            </div>
            <div>
              <dt>Tasa anual</dt>
              <dd className="num">{state.config.annualRate}%</dd>
            </div>
            <div>
              <dt>Plazo</dt>
              <dd className="num">
                {state.config.years} años · {state.config.years * 12} cuotas
              </dd>
            </div>
            <div>
              <dt>Primera cuota</dt>
              <dd>{date(state.config.startDate)}</dd>
            </div>
            <div>
              <dt>Estrategia</dt>
              <dd>
                {state.config.strategy === "recalculate"
                  ? "Recalcular cuota"
                  : "Reducir plazo"}
              </dd>
            </div>
          </dl>
        </div>
        <div className="sheet">
          <div className="sheet-title">
            <h3>Últimos movimientos</h3>
            <NavLink to="/pagos">Ver todos</NavLink>
          </div>
          {state.payments.length ? (
            <ol className="ledger">
              {[...state.payments]
                .sort((a, b) => paidDate(b).localeCompare(paidDate(a)))
                .slice(0, 4)
                .map((p) => (
                  <li key={p.id}>
                    <time className="num" dateTime={paidDate(p)}>
                      {shortDate(paidDate(p))}
                      <small>{paidDate(p).slice(0, 4)}</small>
                    </time>
                    <div>
                      <b>
                        {p.kind === "principal-only"
                          ? "Abono extraordinario al capital"
                          : `Pago periodo ${p.period}`}
                      </b>
                      {p.note && <small>{p.note}</small>}
                    </div>
                    <strong className="num">
                      {money(p.amount + p.manualExtra)}
                    </strong>
                  </li>
                ))}
            </ol>
          ) : (
            <div className="empty">
              Aún no hay pagos registrados.
              <NavLink to="/pagos">Registrar el primero</NavLink>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
const paySchema = z.object({
  period: z.number().int().positive(),
  date: z.string().min(1),
  amount: z
    .string()
    .refine((v) => parseMoney(v) > 0, "Ingresa un monto válido"),
  manualExtra: z
    .string()
    .refine(
      (v) => !v.trim() || parseMoney(v) >= 0,
      "El abono no puede ser negativo",
    ),
  note: z.string(),
  advance: z.boolean(),
  paidOn: z
    .string()
    .min(1, "Indica la fecha en que pagaste")
    .refine((v) => v <= todayISO(), "La fecha de pago no puede ser futura"),
});
type PayForm = z.infer<typeof paySchema>;
function Payments({
  state,
  setState,
}: {
  state: LoanState;
  setState: SetLoan;
}) {
  const nav = useNavigate();
  const [editing, setEditing] = useState<Payment | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [receiptError, setReceiptError] = useState("");
  const [pendingDelete, setPendingDelete] = useState<Payment | null>(null);
  useEffect(() => () => {
    if (receipt) URL.revokeObjectURL(receipt.url);
  }, [receipt]);
  function showReceipt(receiptState: LoanState, payment: Payment, justSaved = false) {
    try {
      const generated = generatePaymentReceipt(receiptState, payment);
      setReceipt({ ...generated, state: receiptState, payment, justSaved });
      setReceiptError("");
    } catch (error) {
      setReceiptError(`No se pudo generar el PDF: ${error instanceof Error ? error.message : "Intenta descargarlo desde el historial."}`);
    }
  }
  const rows = schedule(state.config, state.payments),
    nextPeriod = rows.find((row) => row.status === "Parcial" || row.status === "Proyectado")?.period ?? state.config.years * 12,
    [draft, setDraft] = useState<PayForm | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<PayForm>({
    resolver: zodResolver(paySchema),
    defaultValues: {
      period: nextPeriod,
      date: rows[nextPeriod - 1]?.date,
      amount: "",
      manualExtra: "0",
      note: "",
      paidOn: todayISO(),
      advance: true,
    },
  });
  const selectedPeriod = watch("period");
  const selectedRow = rows[Number(selectedPeriod) - 1];
  // one-tap amounts: the installment owed and the last amount paid
  const owedNow = selectedRow
    ? round2(selectedRow.status === "Parcial" ? selectedRow.due - selectedRow.paid : selectedRow.due)
    : 0;
  const lastPaidOn = state.payments.reduce(
    (max, p) => (paidDate(p) > max ? paidDate(p) : max),
    "",
  );
  const lastTotal = round2(
    state.payments
      .filter((p) => paidDate(p) === lastPaidOn)
      .reduce((sum, p) => sum + p.amount + p.manualExtra, 0),
  );
  const quickAmounts: Array<[string, number]> = [
    ...(owedNow > 0 ? [["Cuota", owedNow] as [string, number]] : []),
    ...(lastTotal > 0 && lastTotal !== owedNow
      ? [["Mi pago habitual", lastTotal] as [string, number]]
      : []),
  ];
  const today = todayISO();
  const paidOnInput = watch("paidOn") || today;
  // Rule: if the installment is not due yet on the payment date (the current
  // one is already paid), the money goes straight to principal.
  const scheduledPaymentAvailable = Boolean(
    selectedRow &&
      selectedRow.date <= paidOnInput &&
      selectedRow.status !== "Posterior",
  );
  const advance = watch("advance");
  const paysInstallment = scheduledPaymentAvailable || Boolean(selectedRow && advance);
  const amount = draft ? parseMoney(draft.amount) : 0;
  const manual = draft ? parseMoney(draft.manualExtra) || 0 : 0;
  const allocate = (makeId: () => string) =>
    draft
      ? allocatePayment(
          state.config,
          state.payments,
                    {
            amount,
            manualExtra: manual,
            paidOn: draft.paidOn,
            note: draft.note,
            advance: !scheduledPaymentAvailable && draft.advance,
          },
          makeId,
        )
      : [];
  let previewSeq = 0;
  const allocation = allocate(() => `preview-${previewSeq++}`);
  const capitalOnly = allocation[0]?.kind === "principal-only";
  const lastEntry = allocation.at(-1);
  const contributionPeriod = capitalOnly ? (lastEntry?.period ?? 0) : 0;
  const previewRow = lastEntry
    ? schedule(state.config, [...state.payments, ...allocation])[
        Math.max(0, lastEntry.period - 1)
      ]
    : null;
  // how this payment splits between interest and principal, entry by entry
  const split = allocation.reduce(
    (acc, entry, i) => {
      const prior = [...state.payments, ...allocation.slice(0, i)];
      const row =
        entry.kind === "principal-only"
          ? undefined
          : schedule(state.config, [...prior, entry])[entry.period - 1];
      const parts = breakdown(entry, row, prior);
      return {
        interest: round2(acc.interest + parts.interest),
        principal: round2(acc.principal + parts.principal),
        extra: round2(acc.extra + parts.extra),
      };
    },
    { interest: 0, principal: 0, extra: 0 },
  );
  const toCapital = round2(split.principal + split.extra);
  const dollar = useUsdRate();
  const usdRate = dollar.rate?.rate ?? 0;
  const previewBalance =
    capitalOnly && contributionPeriod === 0
      ? (previewRow?.opening ?? 0)
      : (previewRow?.closing ?? 0);
  const previewNextDue =
    capitalOnly && contributionPeriod === 0
      ? (previewRow?.due ?? 0)
      : (previewRow?.nextDue ?? 0);

  function review(values: PayForm) {
    setDraft(values);
  }
  function save() {
    if (!draft) return;
    const entries = allocate(() => crypto.randomUUID());
    const p = entries.at(-1);
    if (!p) return;
    const nextState = {
      ...state,
      payments: [...state.payments, ...entries].sort(
        (a, b) => a.period - b.period,
      ),
    };
    setState(
      nextState,
      capitalOnly
        ? "Antes de registrar un abono al capital"
        : `Antes de registrar el pago del periodo ${entries[0].period}`,
    );
    showReceipt(nextState, p, true);
    setDraft(null);
    const updatedRows = schedule(nextState.config, nextState.payments);
    const pendingRow = updatedRows.find((row) => row.status === "Parcial" || row.status === "Proyectado");
    reset({
      period: pendingRow?.period ?? nextPeriod,
      date: pendingRow?.date ?? draft.date,
      amount: "",
      manualExtra: "0",
      note: "",
      paidOn: todayISO(),
      advance: true,
    });
  }
  return (
    <section className="page">
      <div className="page-head">
        <div>
          <h2>Registrar pago</h2>
          <p>
            El excedente sobre la cuota se aplica automáticamente al capital.
          </p>
        </div>
      </div>
      <div className="grid2 payments-grid">
        {receiptError && (
          <p className="wide alert" role="alert">
            {receiptError}
          </p>
        )}
        <form className="panel form" onSubmit={handleSubmit(review)}>
          {!scheduledPaymentAvailable && selectedRow && (
            <div className="period-notice wide" role="status">
              <CalendarClock />
              <div>
                <b>La cuota del periodo {selectedPeriod} vence el {date(selectedRow.date)}</b>
                <span>La cuota actual ya está pagada. ¿Cómo aplicas este pago?</span>
                <div className="choice" role="radiogroup" aria-label="Cómo aplicar el pago">
                  <label className={advance ? "on" : ""}>
                    <input
                      type="radio"
                      checked={advance}
                      onChange={() => setValue("advance", true)}
                    />
                    <b>Adelantar la cuota {selectedPeriod}</b>
                    <small>Queda pagada desde ya; lo que sobre va a capital.</small>
                  </label>
                  <label className={!advance ? "on" : ""}>
                    <input
                      type="radio"
                      checked={!advance}
                      onChange={() => setValue("advance", false)}
                    />
                    <b>Abono al capital</b>
                    <small>Todo rebaja el saldo; la cuota sigue pendiente.</small>
                  </label>
                </div>
              </div>
            </div>
          )}
          <label>
            Periodo
            <input
              className="locked"
              type="number"
              readOnly
              tabIndex={-1}
              {...register("period", { valueAsNumber: true })}
            />
            {errors.period && <em>{errors.period.message}</em>}
          </label>
          <div className="field">
            <span className="field-label">Fecha programada</span>
            <span className="locked-value">
              {selectedRow ? date(watch("date") || selectedRow.date) : "—"}
            </span>
            <input type="hidden" {...register("date")} />
          </div>
          <label>
            Fecha de pago
            <input
              className="editable"
              type="date"
              max={today}
              aria-invalid={errors.paidOn ? true : undefined}
              {...register("paidOn")}
            />
            {errors.paidOn ? (
              <em role="alert">{errors.paidOn.message}</em>
            ) : (
              <small className="hint">El día en que entregaste el dinero.</small>
            )}
          </label>
          <label>
            Pago total realizado
            <input
              className="editable"
              inputMode="decimal"
              autoComplete="off"
              placeholder={money(selectedRow?.due ?? 0)}
              aria-invalid={errors.amount ? true : undefined}
              {...register("amount")}
            />
            {errors.amount ? (
              <em role="alert">{errors.amount.message}</em>
            ) : (
              selectedRow && (
                <small className="hint">
                  Cuota del periodo: {money(selectedRow.due)}
                </small>
              )
            )}
          </label>
          {quickAmounts.length > 0 && (
            <div className="chips quick wide" aria-label="Montos rápidos">
              {quickAmounts.map(([name, value]) => (
                <button
                  key={name}
                  type="button"
                  className="chip"
                  onClick={() =>
                    setValue("amount", value.toFixed(2).replace(".", ","), {
                      shouldValidate: true,
                    })
                  }
                >
                  {name} <b className="num">{money(value)}</b>
                </button>
              ))}
            </div>
          )}
          <label>
            Abono adicional manual
            <input
              className="editable"
              inputMode="decimal"
              autoComplete="off"
              {...register("manualExtra")}
            />
            {errors.manualExtra ? (
              <em role="alert">{errors.manualExtra.message}</em>
            ) : (
              <small className="hint">Se suma directo al capital.</small>
            )}
          </label>
          <label className="wide">
            Observación
            <textarea
              {...register("note")}
              placeholder="Opcional"
            />
          </label>
          <button
            className="button primary wide"
            type="submit"
          >
            {paysInstallment ? "Revisar y guardar" : "Revisar abono al capital"}
          </button>
        </form>
        <div className="panel">
          <div className="panel-title">
            <h3>
              Historial{" "}
              {state.payments.length > 0 && (
                <span className="count">{state.payments.length}</span>
              )}
            </h3>
            {state.payments.length > 0 && (
              <button className="button small" onClick={() => openStatement(state)}>
                <FileText />
                Estado de cuenta
              </button>
            )}
          </div>
          {state.payments.length ? (
            <div className="history">
              {state.payments.map((p) => (
                <div key={p.id}>
                  <div>
                    <b>
                      {p.kind === "principal-only"
                        ? "Abono extraordinario al capital"
                        : `Pago periodo ${p.period}`}
                    </b>
                    <small>
                      Pagado el {date(paidDate(p))} ·{" "}
                      <span className="num">
                        {money(p.amount + p.manualExtra)}
                      </span>
                      {p.note ? ` · ${p.note}` : ""}
                    </small>
                  </div>
                  <button
                    className="icon"
                    aria-label={
                      p.kind === "principal-only"
                        ? "Editar abono al capital"
                        : `Editar pago del periodo ${p.period}`
                    }
                    title="Editar"
                    onClick={() => setEditing(p)}
                  >
                    <Pencil />
                  </button>
                  <button
                    className="icon"
                    aria-label={
                      p.kind === "principal-only"
                        ? "Comprobante del abono al capital"
                        : `Comprobante del periodo ${p.period}`
                    }
                    title="Enviar o ver comprobante"
                    onClick={() => showReceipt(state, p)}
                  >
                    <Share2 />
                  </button>
                  <button
                    className="icon danger"
                    aria-label={
                      p.kind === "principal-only"
                        ? "Eliminar abono al capital"
                        : `Eliminar pago del periodo ${p.period}`
                    }
                    title="Eliminar"
                    onClick={() => setPendingDelete(p)}
                  >
                    <Trash2 />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty">
              <FileText />
              Los pagos confirmados aparecerán aquí, con su comprobante PDF.
            </div>
          )}
        </div>
      </div>
      <Dialog.Root open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="overlay" />
          <Dialog.Content className="dialog">
            <Dialog.Title>
              {capitalOnly ? "Confirmar abono al capital" : "Confirmar pago"}
            </Dialog.Title>
            <Dialog.Description>
              Revisa cómo se aplicará este movimiento antes de guardarlo.
            </Dialog.Description>
            <dl>
              <div>
                <dt>{capitalOnly ? "Fecha del abono" : "Periodo y vencimiento"}</dt>
                <dd>
                  {capitalOnly
                    ? draft && date(draft.paidOn)
                    : `${draft?.period} · ${draft ? date(draft.date) : ""}`}
                </dd>
              </div>
              {!capitalOnly && draft && (
                <div>
                  <dt>Fecha de pago</dt>
                  <dd>
                    {date(draft.paidOn)}
                    {draft.paidOn < draft.date &&
                      ` · ${Math.round((Date.parse(draft.date) - Date.parse(draft.paidOn)) / 86400000)} días antes`}
                  </dd>
                </div>
              )}
              {allocation.length > 1 && (
                <div>
                  <dt>Cuotas atrasadas que cubre</dt>
                  <dd>
                    Periodos {allocation.map((e) => e.period).join(", ")}
                  </dd>
                </div>
              )}
              <div>
                <dt>Cuota correspondiente</dt>
                <dd>{money(selectedRow?.due ?? 0)}</dd>
              </div>
              <div>
                <dt>Monto que pagas</dt>
                <dd>{money(round2(amount + manual))}</dd>
              </div>
            </dl>
            <div className="split" aria-label="Cómo se reparte el pago">
              <div className="split-bar" aria-hidden="true">
                {split.interest > 0 && (
                  <i
                    className="interest"
                    style={{ flexGrow: split.interest }}
                  />
                )}
                {toCapital > 0 && (
                  <i className="capital" style={{ flexGrow: toCapital }} />
                )}
              </div>
              <div className="split-row">
                <span>
                  <i className="dot interest" aria-hidden="true" />
                  Se va a intereses
                </span>
                <b className="num">{money(split.interest)}</b>
              </div>
              <div className="split-row">
                <span>
                  <i className="dot capital" aria-hidden="true" />
                  Se va a capital
                </span>
                <b className="num good">{money(toCapital)}</b>
              </div>
              {usdRate > 0 ? (
                <p className="split-usd">
                  Equivale a <b className="num">{usd(toCapital / usdRate)}</b>{" "}
                  <span>a {money(usdRate)} por dólar</span>
                </p>
              ) : (
                <p className="split-usd">
                  <span>
                    {dollar.loading
                      ? "Consultando el tipo de cambio…"
                      : "Sin conexión para consultar el tipo de cambio."}
                  </span>
                </p>
              )}
              {split.principal > 0 && split.extra > 0 && (
                <p className="split-note">
                  {money(split.principal)} de la cuota +{" "}
                  {money(split.extra)} de abono extra
                </p>
              )}
            </div>
            <dl>
              {!capitalOnly && previewRow?.status === "Parcial" && (
                <div>
                  <dt>Pendiente de esta cuota</dt>
                  <dd>{money(Math.max(0, previewRow.due - previewRow.paid))}</dd>
                </div>
              )}
              <div className="result">
                <dt>Nuevo saldo estimado</dt>
                <dd>{money(previewBalance)}</dd>
              </div>
              <div className="result">
                <dt>Nueva cuota estimada</dt>
                <dd>{money(previewNextDue)}</dd>
              </div>
            </dl>
            <div className="actions">
              <button className="button" onClick={() => setDraft(null)}>
                Cancelar
              </button>
              <button className="button primary" onClick={save}>
                Confirmar y guardar
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <AlertDialog.Root
        open={Boolean(pendingDelete)}
        onOpenChange={(o) => !o && setPendingDelete(null)}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="overlay" />
          <AlertDialog.Content className="dialog">
            <AlertDialog.Title>
              {pendingDelete?.kind === "principal-only"
                ? "¿Eliminar este abono al capital?"
                : `¿Eliminar el pago del periodo ${pendingDelete?.period}?`}
            </AlertDialog.Title>
            <AlertDialog.Description>
              {pendingDelete &&
                `${date(paidDate(pendingDelete))} · ${money(pendingDelete.amount + pendingDelete.manualExtra)}. `}
              La tabla de amortización y el saldo se recalcularán sin este
              movimiento. Si te equivocas, puedes recuperarlo desde
              Configuración, en Versiones anteriores.
            </AlertDialog.Description>
            <div className="actions">
              <AlertDialog.Cancel className="button">Cancelar</AlertDialog.Cancel>
              <AlertDialog.Action
                className="button destructive"
                onClick={() => {
                  if (!pendingDelete) return;
                  setState(
                    {
                      ...state,
                      payments: state.payments.filter(
                        (x) => x.id !== pendingDelete.id,
                      ),
                    },
                    pendingDelete.kind === "principal-only"
                      ? "Antes de eliminar un abono al capital"
                      : `Antes de eliminar el pago del periodo ${pendingDelete.period}`,
                  );
                  setPendingDelete(null);
                }}
              >
                <Trash2 />
                Eliminar
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
      <EditPaymentDialog
        payment={editing}
        onClose={() => setEditing(null)}
        onSave={(updated) => {
          setState(
            {
              ...state,
              payments: state.payments.map((x) =>
                x.id === updated.id ? updated : x,
              ),
            },
            updated.kind === "principal-only"
              ? "Antes de editar un abono al capital"
              : `Antes de editar el pago del periodo ${updated.period}`,
          );
          setEditing(null);
        }}
      />
      <ReceiptDialog
        receipt={receipt}
        onClose={() => {
          // after saving a new payment, go back to the summary to see it applied
          if (receipt?.justSaved) {
            nav("/dashboard");
            window.scrollTo(0, 0);
          }
          setReceipt(null);
        }}
      />
    </section>
  );
}
function ReceiptDialog({
  receipt,
  onClose,
}: {
  receipt: Receipt | null;
  onClose: () => void;
}) {
  const d = receipt ? receiptData(receipt.state, receipt.payment) : null;
  const phone = receipt?.state.config.lenderPhone;
  return (
    <Dialog.Root open={Boolean(receipt)} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="dialog receipt-dialog">
          {receipt && d && (
            <>
              <Dialog.Title>
                {receipt.justSaved ? "Pago guardado" : `Comprobante N.º ${String(d.index + 1).padStart(4, "0")}`}
              </Dialog.Title>
              <Dialog.Description>
                {d.capitalOnly
                  ? "Abono extraordinario al capital"
                  : `Cuota ${receipt.payment.period}`}{" "}
                · pagado el {date(receipt.payment.paidOn ?? receipt.payment.date)}
              </Dialog.Description>
              <div className="receipt-amount">
                <span className="label">Monto pagado</span>
                <strong className="num">{money(d.parts.total)}</strong>
                <span className="receipt-balance">
                  Saldo nuevo <b className="num">{money(d.balanceNow)}</b>
                </span>
              </div>
              <div className="receipt-actions">
                <button className="button whatsapp" onClick={() => void sendReceipt(receipt)}>
                  <MessageCircle />
                  Enviar comprobante por WhatsApp
                </button>
                <a
                  className="button"
                  href={waLink(phone, receiptText(receipt.state, receipt.payment))}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <MessageCircle />
                  Enviar solo el resumen en texto
                </a>
                <a className="button" href={receipt.url} target="_blank" rel="noopener noreferrer">
                  <FileText />
                  Ver PDF
                </a>
              </div>
              <p className="hint">
                {phone
                  ? "El resumen en texto se abre directo en el chat del prestamista."
                  : "Guarda el WhatsApp del prestamista en Configuración para abrir su chat directo."}
              </p>
              <div className="actions">
                <button className="button" onClick={onClose}>
                  {receipt.justSaved ? "Listo" : "Cerrar"}
                </button>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
function EditPaymentDialog({
  payment,
  onClose,
  onSave,
}: {
  payment: Payment | null;
  onClose: () => void;
  onSave: (p: Payment) => void;
}) {
  const capitalOnly = payment?.kind === "principal-only";
  const [form, setForm] = useState({ paidOn: "", amount: "", extra: "", note: "" });
  const [error, setError] = useState("");
  useEffect(() => {
    if (!payment) return;
    setError("");
    setForm({
      paidOn: paidDate(payment),
      amount: String(capitalOnly ? payment.manualExtra : payment.amount),
      extra: String(payment.manualExtra),
      note: payment.note,
    });
  }, [payment, capitalOnly]);
  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!payment) return;
    const amount = parseMoney(form.amount);
    const extra = form.extra.trim() ? parseMoney(form.extra) : 0;
    if (!(amount > 0)) return setError("Ingresa un monto válido mayor que cero.");
    if (!capitalOnly && !(extra >= 0))
      return setError("El abono adicional no puede ser negativo.");
    if (!form.paidOn || form.paidOn > todayISO())
      return setError("La fecha de pago no puede estar vacía ni ser futura.");
    onSave(
      capitalOnly
        ? { ...payment, paidOn: form.paidOn, date: form.paidOn, manualExtra: amount, note: form.note }
        : { ...payment, paidOn: form.paidOn, amount, manualExtra: extra, note: form.note },
    );
  }
  return (
    <Dialog.Root open={Boolean(payment)} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="dialog">
          <Dialog.Title>
            {capitalOnly
              ? "Editar abono al capital"
              : `Editar pago del periodo ${payment?.period}`}
          </Dialog.Title>
          <Dialog.Description>
            El saldo y la tabla se recalculan con los nuevos montos. La versión
            anterior queda guardada por si necesitas recuperarla.
          </Dialog.Description>
          <form className="form edit-form" onSubmit={submit}>
            <label>
              Fecha de pago
              <input
                type="date"
                max={todayISO()}
                value={form.paidOn}
                onChange={(e) => setForm({ ...form, paidOn: e.target.value })}
              />
            </label>
            <label>
              {capitalOnly ? "Monto del abono" : "Pago total realizado"}
              <input
                inputMode="decimal"
                autoComplete="off"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            </label>
            {!capitalOnly && (
              <label>
                Abono adicional manual
                <input
                  inputMode="decimal"
                  autoComplete="off"
                  value={form.extra}
                  onChange={(e) => setForm({ ...form, extra: e.target.value })}
                />
              </label>
            )}
            <label className="wide">
              Observación
              <textarea
                value={form.note}
                placeholder="Opcional"
                onChange={(e) => setForm({ ...form, note: e.target.value })}
              />
            </label>
            {error && (
              <p className="wide alert" role="alert">
                {error}
              </p>
            )}
            <div className="actions wide">
              <button type="button" className="button" onClick={onClose}>
                Cancelar
              </button>
              <button type="submit" className="button primary">
                Guardar cambios
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
function Simulator({ state }: { state: LoanState }) {
  const [input, setInput] = useState("500000");
  const amount = parseMoney(input);
  const valid = amount > 0;
  const results = useMemo(
    () =>
      valid
        ? (["recalculate", "reduce-term"] as const).map((strategy) => ({
            strategy,
            ...simulateExtra(state.config, state.payments, amount, strategy),
          }))
        : [],
    [state, amount, valid],
  );
  const base = valid ? results.find((r) => r.strategy === state.config.strategy)!.before : null;
  return (
    <section className="page">
      <div className="page-head">
        <div>
          <h2>Simulador de abonos</h2>
          <p>Prueba cuánto te ahorras con un abono extra al capital. No se guarda nada.</p>
        </div>
      </div>
      <div className="sheet sim-input">
        <label className="form">
          <span className="field-label">Monto del abono</span>
          <input
            inputMode="decimal"
            autoComplete="off"
            value={input}
            aria-invalid={!valid && input.trim() ? true : undefined}
            onChange={(e) => setInput(e.target.value)}
          />
          <small className="hint">
            {valid ? money(amount) : "Escribe un monto, por ejemplo 500.000"}
          </small>
        </label>
        <div className="chips" aria-label="Montos rápidos">
          {[250000, 500000, 1000000, 2000000].map((v) => (
            <button key={v} className="chip" onClick={() => setInput(String(v))}>
              {money(v).replace(",00", "")}
            </button>
          ))}
        </div>
      </div>
      {base && (
        <>
          <p className="sim-base">
            Sin abono: te quedan <b className="num">{base.installmentsLeft}</b> cuotas de{" "}
            <b className="num">{money(base.nextDue)}</b>, terminas el{" "}
            <b>{date(base.lastDate)}</b> y pagarías{" "}
            <b className="num">{money(base.interestLeft)}</b> en intereses.
          </p>
          <div className="grid2 sim-results">
            {results.map((r) => (
              <div
                key={r.strategy}
                className={r.strategy === state.config.strategy ? "sheet sim-card current" : "sheet sim-card"}
              >
                <div className="sheet-title">
                  <h3>{r.strategy === "recalculate" ? "Si rebajas la cuota" : "Si acortas el plazo"}</h3>
                  {r.strategy === state.config.strategy && <span className="pill ok">Tu estrategia</span>}
                </div>
                <span className="label">Intereses que te ahorras</span>
                <strong className="figure small good num">{money(r.interestSaved)}</strong>
                <dl className="cajetin">
                  <div>
                    <dt>Nueva cuota</dt>
                    <dd className="num">{money(r.after.nextDue)}</dd>
                  </div>
                  <div>
                    <dt>Terminas el</dt>
                    <dd>{date(r.after.lastDate)}</dd>
                  </div>
                  <div>
                    <dt>Cuotas menos</dt>
                    <dd className="num">{r.installmentsSaved}</dd>
                  </div>
                  <div>
                    <dt>Rebaja de la cuota</dt>
                    <dd className="num">{money(Math.max(0, r.before.nextDue - r.after.nextDue))}</dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
          <p className="hint sim-note">
            Para aplicar un abono, regístralo en Pagos. La estrategia se cambia en Configuración.
          </p>
        </>
      )}
    </section>
  );
}
const statusClass: Record<string, string> = {
  Proyectado: "projected",
  Parcial: "partial",
  Registrado: "registered",
  Liquidado: "settled",
  Posterior: "after",
};
function Amortization({ state }: { state: LoanState }) {
  const rows = schedule(state.config, state.payments);
  const current = rows.find(
    (r) => r.status === "Parcial" || r.status === "Proyectado",
  );
  function goToCurrent() {
    if (!current) return;
    document
      .getElementById(`periodo-${current.period}`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  function csv() {
    // Semicolons and decimal commas so Excel in Spanish opens it in columns.
    const n = (v: number) => v.toFixed(2).replace(".", ",");
    const head =
      "Periodo;Fecha;Saldo inicial;Cuota;Pago;Abono;Capital;Interés;Saldo final;Estado";
    const body = rows
      .map((r) =>
        [
          r.period,
          r.date,
          n(r.opening),
          n(r.due),
          n(r.paid),
          n(r.extra),
          n(r.principal),
          n(r.interest),
          n(r.closing),
          r.status,
        ].join(";"),
      )
      .join("\n");
    download(
      "amortizacion.csv",
      "\ufeff" + head + "\n" + body,
      "text/csv;charset=utf-8",
    );
  }
  return (
    <section className="page">
      <div className="page-head">
        <div>
          <h2>Tabla de amortización</h2>
          <p>Proyección completa ajustada con cada pago y abono.</p>
        </div>
        <div className="head-actions">
          {current && (
            <button className="button" onClick={goToCurrent}>
              <CalendarClock />
              Ir al periodo {current.period}
            </button>
          )}
          <button className="button" onClick={csv}>
            <Download />
            Descargar CSV
          </button>
        </div>
      </div>
      <div className="table-wrap" tabIndex={0} aria-label="Tabla de amortización">
        <table>
          <thead>
            <tr>
              {[
                "Periodo",
                "Fecha",
                "Saldo inicial",
                "Cuota",
                "Pago total",
                "Abono capital",
                "Capital cuota",
                "Interés",
                "Saldo final",
                "Estado",
              ].map((h, i) => (
                <th key={h} scope="col" className={i > 1 && i < 9 ? "n" : undefined}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.period}
                id={`periodo-${r.period}`}
                className={`${r.status.toLowerCase()}${r === current ? " current" : ""}`}
                aria-current={r === current ? "step" : undefined}
              >
                <td>{r.period}</td>
                <td>{date(r.date)}</td>
                <td className="n">{money(r.opening)}</td>
                <td className="n">{money(r.due)}</td>
                <td className="n">{money(r.paid)}</td>
                <td className="n">{r.extra > 0 ? money(r.extra) : "—"}</td>
                <td className="n">{money(r.principal)}</td>
                <td className="n">{money(r.interest)}</td>
                <td className="n">{money(r.closing)}</td>
                <td>
                  <span className={`status ${statusClass[r.status]}`}>
                    {r.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
function download(name: string, data: string, type = "application/json") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
function SettingsPage({
  state,
  setState,
  backup,
  sync,
}: {
  state: LoanState;
  setState: SetLoan;
  backup: Backup;
  sync: CloudSync;
}) {
  const [c, setC] = useState(state.config);
  const dollar = useUsdRate();
  const [incoming, setIncoming] = useState<LoanState | null>(null);
  const [snapshots, setSnapshots] = useState(loadSnapshots);
  const [restoring, setRestoring] = useState<(typeof snapshots)[number] | null>(
    null,
  );
  useEffect(() => setSnapshots(loadSnapshots()), [state]);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const nav = useNavigate();
  const invalid =
    !(c.principal > 0)
      ? "El monto financiado debe ser mayor que cero."
      : !(c.annualRate >= 0)
        ? "La tasa anual no puede ser negativa."
        : !(Number.isInteger(c.years) && c.years >= 1 && c.years <= 50)
          ? "El plazo debe ser un número entero de años entre 1 y 50."
          : !c.startDate
            ? "Indica la primera fecha de pago."
            : "";
  function imp(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.target;
    const f = input.files?.[0];
    if (f)
      f.text().then((t) => {
        try {
          const s = JSON.parse(t);
          if (isLoanState(s)) {
            setIncoming(s);
          } else {
            setNotice({
              ok: false,
              text: "El archivo no corresponde a un respaldo de Control de Préstamo.",
            });
          }
        } catch {
          setNotice({
            ok: false,
            text: "El archivo no es un JSON válido. Usa un respaldo exportado desde esta aplicación.",
          });
        }
        input.value = "";
      });
  }
  return (
    <section className="page">
      <div className="page-head">
        <div>
          <h2>Configuración</h2>
          <p>Ajusta las condiciones y la estrategia del préstamo.</p>
        </div>
      </div>
      <form
        className="panel settings"
        onSubmit={(e) => {
          e.preventDefault();
          if (invalid) return;
          setState({ ...state, config: c }, "Antes de cambiar la configuración");
          nav("/dashboard");
        }}
      >
        <label>
          Monto financiado
          <input
            className="editable"
            inputMode="decimal"
            autoComplete="off"
            value={c.principal}
            onChange={(e) => setC({ ...c, principal: Number(e.target.value) })}
          />
          <small className="hint">
            {c.principal > 0 ? money(c.principal) : "Ingresa el monto sin separadores de miles"}
          </small>
        </label>
        <label>
          Tasa anual (%)
          <input
            className="editable"
            type="number"
            step="0.01"
            min="0"
            value={c.annualRate}
            onChange={(e) => setC({ ...c, annualRate: Number(e.target.value) })}
          />
        </label>
        <label>
          Plazo (años)
          <input
            className="editable"
            type="number"
            min="1"
            max="50"
            value={c.years}
            onChange={(e) => setC({ ...c, years: Number(e.target.value) })}
          />
        </label>
        <label>
          Primera fecha de pago
          <input
            className="editable"
            type="date"
            value={c.startDate}
            onChange={(e) => setC({ ...c, startDate: e.target.value })}
          />
        </label>
        <label className="wide">
          WhatsApp del prestamista (opcional)
          <input
            className="editable"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            placeholder="8888 8888"
            value={c.lenderPhone ?? ""}
            onChange={(e) => setC({ ...c, lenderPhone: e.target.value })}
          />
          <small className="hint">
            Para abrir su chat directo al enviar un comprobante. Números de Costa
            Rica sin el 506.
          </small>
        </label>
        <div className="wide rate-info">
          <span className="rate-label">Tipo de cambio del dólar</span>
          <div className="rate-line">
            <b className="num">
              {dollar.rate ? `${money(dollar.rate.rate)} por dólar` : "Sin datos"}
            </b>
            <button
              type="button"
              className="button small"
              onClick={() => void dollar.refresh()}
              disabled={dollar.loading}
            >
              {dollar.loading ? "Consultando…" : "Actualizar"}
            </button>
          </div>
          <small className="hint">
            {dollar.failed
              ? "No se pudo consultar ahora; se usa el último tipo de cambio obtenido."
              : dollar.rate
                ? `Tipo de cambio de venta${dollar.rate.date ? ` del ${date(dollar.rate.date)}` : ""}, según ${dollar.rate.source}. Se actualiza solo.`
                : "Se consulta automáticamente al abrir la app."}
          </small>
        </div>
        <fieldset className="wide">
          <legend>Estrategia de amortización</legend>
          <label className="radio">
            <input
              type="radio"
              name="strategy"
              checked={c.strategy === "recalculate"}
              onChange={() => setC({ ...c, strategy: "recalculate" })}
            />
            <span>
              <b>Recalcular cuota y mantener plazo</b>
              <small>Reduce el monto de las cuotas futuras.</small>
            </span>
          </label>
          <label className="radio">
            <input
              type="radio"
              name="strategy"
              checked={c.strategy === "reduce-term"}
              onChange={() => setC({ ...c, strategy: "reduce-term" })}
            />
            <span>
              <b>Mantener cuota y reducir plazo</b>
              <small>Termina de pagar antes.</small>
            </span>
          </label>
        </fieldset>
        {invalid && (
          <p className="wide alert" role="alert">
            {invalid}
          </p>
        )}
        <button className="button primary wide" disabled={Boolean(invalid)}>
          Guardar cambios
        </button>
      </form>
      {sync.email && (
        <div className="panel backup-panel">
          <div className="panel-title">
            <h3>Cuenta</h3>
            <span className={sync.status === "saved" ? "pill ok" : "pill warn"}>
              {syncLabel[sync.status]}
            </span>
          </div>
          <p className="muted">
            Conectado como <b>{sync.email}</b>. Cada cambio se guarda en tu
            cuenta y se ve igual en el celular y la computadora. Al cerrar
            sesión se borra la copia de este dispositivo.
          </p>
          <div className="tools">
            <button
              className="button"
              disabled={sync.status === "saving"}
              onClick={() => {
                if (
                  sync.status !== "saved" &&
                  !window.confirm(
                    "Hay cambios que todavía no se guardaron en tu cuenta. Si cierras sesión se perderán. ¿Cerrar sesión de todos modos?",
                  )
                )
                  return;
                void sync.signOut?.();
              }}
            >
              <LogOut />
              Cerrar sesión
            </button>
          </div>
        </div>
      )}
      <div className="panel backup-panel">
        <div className="panel-title">
          <h3>Respaldo</h3>
          <span className={backup.dirty ? "pill warn" : "pill ok"}>
            {backup.dirty ? "Cambios sin respaldar" : "Respaldado"}
          </span>
        </div>
        <p className="muted">
          Tus datos se guardan en este navegador. Si borras el historial o
          cambias de computadora, se pierden, así que guarda una copia afuera:
          en una carpeta de OneDrive, Google Drive o una memoria USB.
        </p>
        <div className="backup-auto">
          <div>
            <b>Respaldo automático</b>
            <span>
              {!backup.supported
                ? "Tu navegador no lo permite. Ábrelo en Chrome o Edge, o usa Descargar respaldo."
                : backup.status === "active"
                  ? `Activo: cada cambio se guarda en "${backup.fileName}".`
                  : backup.status === "needs-permission"
                    ? `Configurado en "${backup.fileName}", pero el navegador pide permiso otra vez.`
                    : backup.status === "error"
                      ? "No se pudo escribir el archivo. Elige el archivo de nuevo."
                      : "Elige un archivo (idealmente en OneDrive o Drive) y cada cambio se guardará ahí."}
            </span>
          </div>
          {backup.supported && (
            <div className="head-actions">
              {backup.status === "needs-permission" && (
                <button className="button primary" onClick={backup.reactivate}>
                  <ShieldCheck />
                  Reactivar
                </button>
              )}
              <button className="button" onClick={backup.choose}>
                <ShieldCheck />
                {backup.status === "off" ? "Elegir archivo" : "Cambiar archivo"}
              </button>
              {backup.status !== "off" && (
                <button className="button" onClick={backup.forget}>
                  Desactivar
                </button>
              )}
            </div>
          )}
        </div>
        <div className="tools">
          <button className="button" onClick={backup.download}>
            <Download />
            Descargar respaldo
          </button>
          <label className="button">
            <FileUp />
            Importar respaldo
            <input
              className="sr-only"
              type="file"
              accept="application/json,.json"
              onChange={imp}
            />
          </label>
          <button className="button" onClick={() => openStatement(state)}>
            <Printer />
            Estado de cuenta (PDF)
          </button>
        </div>
        {backup.info && (
          <p className="hint">
            Último respaldo: {date(backup.info.at.slice(0, 10))} a las{" "}
            {new Date(backup.info.at).toLocaleTimeString("es-CR", {
              hour: "2-digit",
              minute: "2-digit",
            })}
            {backup.info.target === "file" ? " (automático)" : " (descarga)"}
          </p>
        )}
        {notice && (
          <p className={notice.ok ? "notice ok" : "notice alert"} role="status">
            {notice.text}
          </p>
        )}
      </div>
      <div className="panel versions">
        <div className="panel-title">
          <h3>Versiones anteriores</h3>
          <History aria-hidden="true" className="title-icon" />
        </div>
        <p className="muted">
          Antes de eliminar, editar, importar o cambiar la configuración se
          guarda una copia. Puedes volver a cualquiera de ellas.
        </p>
        {snapshots.length ? (
          <ol className="ledger">
            {snapshots.map((snap) => (
              <li key={snap.at}>
                <time className="num" dateTime={snap.at}>
                  {shortDate(snap.at.slice(0, 10))}
                  <small>
                    {new Date(snap.at).toLocaleTimeString("es-CR", {
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                    })}
                  </small>
                </time>
                <div>
                  <b>{snap.label}</b>
                  <small>
                    {snap.state.payments.length === 1
                      ? "1 pago registrado"
                      : `${snap.state.payments.length} pagos registrados`}
                  </small>
                </div>
                <button className="button" onClick={() => setRestoring(snap)}>
                  <RotateCcw />
                  Restaurar
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <div className="empty small">Aún no hay versiones guardadas.</div>
        )}
      </div>
      <AlertDialog.Root
        open={Boolean(incoming)}
        onOpenChange={(o) => !o && setIncoming(null)}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="overlay" />
          <AlertDialog.Content className="dialog">
            <AlertDialog.Title>¿Reemplazar los datos con este respaldo?</AlertDialog.Title>
            <AlertDialog.Description>
              El respaldo tiene {incoming?.payments.length} pagos y un monto
              financiado de {incoming && money(incoming.config.principal)}. Tus
              datos actuales ({state.payments.length} pagos) quedan guardados en
              Versiones anteriores.
            </AlertDialog.Description>
            <div className="actions">
              <AlertDialog.Cancel className="button">Cancelar</AlertDialog.Cancel>
              <AlertDialog.Action
                className="button primary"
                onClick={() => {
                  if (!incoming) return;
                  setState(incoming, "Antes de importar un respaldo");
                  setC(incoming.config);
                  setNotice({
                    ok: true,
                    text: `Respaldo importado: ${incoming.payments.length} pagos registrados.`,
                  });
                  setIncoming(null);
                }}
              >
                Reemplazar datos
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
      <AlertDialog.Root
        open={Boolean(restoring)}
        onOpenChange={(o) => !o && setRestoring(null)}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="overlay" />
          <AlertDialog.Content className="dialog">
            <AlertDialog.Title>¿Volver a esta versión?</AlertDialog.Title>
            <AlertDialog.Description>
              {restoring &&
                `Versión del ${date(restoring.at.slice(0, 10))}, guardada "${restoring.label.toLowerCase()}", con ${restoring.state.payments.length} pagos. `}
              Los datos actuales también se guardan como versión, así que
              puedes deshacerlo.
            </AlertDialog.Description>
            <div className="actions">
              <AlertDialog.Cancel className="button">Cancelar</AlertDialog.Cancel>
              <AlertDialog.Action
                className="button primary"
                onClick={() => {
                  if (!restoring) return;
                  setState(restoring.state, "Antes de restaurar una versión");
                  setC(restoring.state.config);
                  setRestoring(null);
                }}
              >
                <RotateCcw />
                Restaurar
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </section>
  );
}
function useBackup(state: LoanState): Backup {
  const [info, setInfo] = useState(loadBackupInfo);
  const [handle, setHandle] = useState<FileHandle | null>(null);
  const [status, setStatus] = useState<Backup["status"]>("off");
  const supported = autoBackupSupported();
  useEffect(() => {
    if (!supported) return;
    void getBackupHandle().then(async (h) => {
      if (!h) return;
      setHandle(h);
      setStatus((await hasPermission(h)) ? "active" : "needs-permission");
    });
  }, [supported]);
  const save = useCallback(
    async (h: FileHandle, s: LoanState) => {
      try {
        await writeBackup(h, s);
        setInfo(markBackedUp(s, "file"));
        setStatus("active");
      } catch {
        setStatus("error");
      }
    },
    [],
  );
  useEffect(() => {
    if (handle && status === "active") void save(handle, state);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, handle]);
  return {
    info,
    dirty: !info || info.fingerprint !== fingerprint(state),
    supported,
    fileName: handle?.name ?? null,
    status,
    download() {
      download(backupFilename(), JSON.stringify(state, null, 2));
      setInfo(markBackedUp(state, "download"));
    },
    async choose() {
      try {
        const h = await pickBackupFile();
        setHandle(h);
        await save(h, state);
      } catch {
        // picker cancelled
      }
    },
    async reactivate() {
      if (handle && (await hasPermission(handle, true))) await save(handle, state);
    },
    async forget() {
      await forgetBackupFile();
      setHandle(null);
      setStatus("off");
    },
  };
}
export default function App() {
  const [state, setRawState] = useState(loadState);
  const setState: SetLoan = useCallback(
    (next, label = "Antes de un cambio") => {
      setRawState((prev) => {
        pushSnapshot(prev, label);
        return next;
      });
    },
    [],
  );
  const backup = useBackup(state);
  const replaceState = useCallback((next: LoanState) => {
    setRawState((prev) => {
      pushSnapshot(prev, "Antes de cargar cambios de otro dispositivo");
      return next;
    });
  }, []);
  const sync = useCloudSync(state, replaceState);
  useEffect(() => saveState(state), [state]);
  useEffect(() => {
    const ctx = (
      document as Document & {
        modelContext?: {
          registerTool: (
            tool: unknown,
            options?: { signal: AbortSignal },
          ) => void | Promise<void>;
        };
      }
    ).modelContext;
    if (!ctx?.registerTool) return;
    const controller = new AbortController();
    void Promise.resolve(
      ctx.registerTool(
        {
          name: "read_loan_summary",
          title: "Consultar resumen del préstamo",
          description:
            "Devuelve el saldo, la cuota siguiente y la cantidad de pagos registrados, sin modificar datos.",
          inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
          annotations: { readOnlyHint: true, untrustedContentHint: false },
          execute() {
            const rows = schedule(state.config, state.payments),
              last = registeredRows(rows, state.payments).at(-1);
            return {
              currency: "CRC",
              balance: last?.closing ?? state.config.principal,
              nextPayment: last?.nextDue ?? rows[0].due,
              registeredPayments: state.payments.length,
            };
          },
        },
        { signal: controller.signal },
      ),
    ).catch(() => {});
    return () => controller.abort();
  }, [state]);
  return (
    <Shell state={state} sync={sync}>
      <Routes>
        <Route
          path="/dashboard"
          element={
            <Dashboard
              state={state}
              backup={backup}
              inCloud={sync.status !== "local"}
            />
          }
        />
        <Route
          path="/pagos"
          element={<Payments state={state} setState={setState} />}
        />
        <Route path="/amortizacion" element={<Amortization state={state} />} />
        <Route path="/simulador" element={<Simulator state={state} />} />
        <Route
          path="/configuracion"
          element={
            <SettingsPage
              state={state}
              setState={setState}
              backup={backup}
              sync={sync}
            />
          }
        />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Shell>
  );
}
