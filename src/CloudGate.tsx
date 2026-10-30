import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { CloudUpload, LogIn, MonitorSmartphone } from "lucide-react";
import {
  clearMeta,
  cloud,
  fetchRemote,
  loadMeta,
  metaFor,
  saveMeta,
  saveRemote,
} from "./features/loan/loan-cloud";
import { fingerprint, pushSnapshot } from "./features/loan/loan-backup";
import { KEY, loadState, saveState } from "./features/loan/loan-storage";
import type { LoanState } from "./features/loan/loan-types";
import { CloudContext } from "./features/loan/cloud-context";


function Mark() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className="mark">
      <rect x="2.5" y="2.5" width="27" height="27" rx="2" />
      <path d="M2.5 21.5h27M18.5 21.5v8M7 17V11l6-4.5L19 11v6" />
      <path d="M11 17v-4h4v4" />
    </svg>
  );
}
function Screen({ children }: { children: React.ReactNode }) {
  return (
    <div className="gate">
      <div className="gate-brand">
        <Mark />
        <span>
          <b>Mi Préstamo</b>
          <small>Préstamo de construcción</small>
        </span>
      </div>
      <div className="sheet gate-card">{children}</div>
    </div>
  );
}

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await cloud!.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error)
      setError(
        error.message.includes("Invalid login")
          ? "Correo o contraseña incorrectos."
          : `No se pudo iniciar sesión: ${error.message}`,
      );
  }
  return (
    <Screen>
      <h2>Iniciar sesión</h2>
      <p className="muted">Tus pagos se guardan en tu cuenta y se ven igual en todos tus dispositivos.</p>
      <form className="form gate-form" onSubmit={submit}>
        <label className="wide">
          Correo
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="wide">
          Contraseña
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && (
          <p className="wide alert" role="alert">
            {error}
          </p>
        )}
        <button className="button primary wide" disabled={busy}>
          <LogIn />
          {busy ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </Screen>
  );
}

type Choice = { local: LoanState; remote: LoanState; remoteUpdatedAt: string };

/**
 * Decides which data this device starts with, so that signing in never
 * silently replaces payments that exist only on this device or only online.
 */
async function bootstrap(userId: string): Promise<Choice | null> {
  const remote = await fetchRemote(userId);
  const meta = loadMeta(userId);
  const hasLocal = localStorage.getItem(KEY) !== null;
  const local = loadState();
  if (!remote) {
    const result = await saveRemote(userId, local, null);
    if (!result.ok) return bootstrap(userId);
    saveMeta(metaFor(userId, local, result.updatedAt));
    return null;
  }
  const same = fingerprint(local) === fingerprint(remote.state);
  const takeRemote = () => {
    saveState(remote.state);
    saveMeta(metaFor(userId, remote.state, remote.updatedAt));
    return null;
  };
  if (same || !hasLocal) return takeRemote();
  if (!meta) return { local, remote: remote.state, remoteUpdatedAt: remote.updatedAt };
  const localChanged = fingerprint(local) !== meta.fingerprint;
  const remoteChanged = remote.updatedAt !== meta.updatedAt;
  if (!localChanged) return takeRemote();
  if (!remoteChanged) {
    const result = await saveRemote(userId, local, meta.updatedAt);
    if (result.ok) {
      saveMeta(metaFor(userId, local, result.updatedAt));
      return null;
    }
    return bootstrap(userId);
  }
  return { local, remote: remote.state, remoteUpdatedAt: remote.updatedAt };
}

function ChooseData({
  choice,
  onPick,
}: {
  choice: Choice;
  onPick: (which: "local" | "remote") => void;
}) {
  return (
    <Screen>
      <h2>¿Qué datos quieres usar?</h2>
      <p className="muted">
        Este dispositivo y tu cuenta tienen datos distintos. Elige con cuáles seguir. Los otros no se
        borran: quedan guardados como versión anterior.
      </p>
      <div className="gate-choices">
        <button className="radio" onClick={() => onPick("remote")}>
          <CloudUpload aria-hidden="true" />
          <span>
            <b>Los de mi cuenta</b>
            <small>{choice.remote.payments.length} pagos registrados</small>
          </span>
        </button>
        <button className="radio" onClick={() => onPick("local")}>
          <MonitorSmartphone aria-hidden="true" />
          <span>
            <b>Los de este dispositivo</b>
            <small>{choice.local.payments.length} pagos registrados</small>
          </span>
        </button>
      </div>
    </Screen>
  );
}

export default function CloudGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(cloud ? undefined : null);
  const [phase, setPhase] = useState<"loading" | "choose" | "ready" | "error">("loading");
  const [choice, setChoice] = useState<Choice | null>(null);
  const [error, setError] = useState("");
  const userId = session?.user.id;

  useEffect(() => {
    if (!cloud) return;
    void cloud.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = cloud.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!userId) return;
    setPhase("loading");
    bootstrap(userId)
      .then((c) => {
        setChoice(c);
        setPhase(c ? "choose" : "ready");
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setPhase("error");
      });
  }, [userId]);

  if (!cloud) return <>{children}</>;
  if (session === undefined) return <Screen><p className="muted">Cargando…</p></Screen>;
  if (!session) return <Login />;
  if (phase === "loading") return <Screen><p className="muted">Sincronizando tus datos…</p></Screen>;
  if (phase === "error")
    return (
      <Screen>
        <h2>No se pudo conectar</h2>
        <p className="alert">{error}</p>
        <p className="muted">Revisa tu conexión a internet e inténtalo de nuevo.</p>
        <button className="button primary" onClick={() => location.reload()}>
          Reintentar
        </button>
      </Screen>
    );
  if (phase === "choose" && choice)
    return (
      <ChooseData
        choice={choice}
        onPick={async (which) => {
          setPhase("loading");
          try {
            if (which === "remote") {
              pushSnapshot(choice.local, "Datos de este dispositivo antes de usar los de la cuenta");
              saveState(choice.remote);
              saveMeta(metaFor(userId!, choice.remote, choice.remoteUpdatedAt));
            } else {
              const result = await saveRemote(userId!, choice.local, choice.remoteUpdatedAt);
              if (!result.ok) throw new Error("Los datos de la cuenta cambiaron mientras elegías. Vuelve a intentarlo.");
              saveMeta(metaFor(userId!, choice.local, result.updatedAt));
            }
            setPhase("ready");
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            setPhase("error");
          }
        }}
      />
    );
  return (
    <CloudContext.Provider
      value={{
        userId: session.user.id,
        email: session.user.email ?? "",
        async signOut() {
          await cloud!.auth.signOut();
          // the data lives in the account; don't leave a copy on this device
          clearMeta();
          localStorage.removeItem(KEY);
          localStorage.removeItem("control-prestamo:snapshots");
        },
      }}
    >
      {children}
    </CloudContext.Provider>
  );
}
