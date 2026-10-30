import { useCallback, useEffect, useRef, useState } from "react";
import { useCloudAccount } from "./cloud-context";
import { fingerprint, pushSnapshot } from "./loan-backup";
import { fetchRemote, loadMeta, metaFor, saveMeta, saveRemote } from "./loan-cloud";
import type { LoanState } from "./loan-types";

export type SyncStatus = "local" | "saving" | "saved" | "offline" | "conflict";
export type CloudSync = {
  status: SyncStatus;
  email: string | null;
  loadRemote: () => Promise<void>;
  keepMine: () => Promise<void>;
  signOut: (() => Promise<void>) | null;
};

/** Keeps the loan in the signed-in account, never overwriting newer data. */
export function useCloudSync(
  state: LoanState,
  replace: (s: LoanState) => void,
): CloudSync {
  const account = useCloudAccount();
  const userId = account?.userId;
  const [status, setStatus] = useState<SyncStatus>(account ? "saved" : "local");
  const [retry, setRetry] = useState(0);
  const latest = useRef(state);
  latest.current = state;

  // push local changes (debounced)
  useEffect(() => {
    if (!userId) return;
    const meta = loadMeta(userId);
    if (meta && meta.fingerprint === fingerprint(state)) {
      setStatus((s) => (s === "conflict" ? s : "saved"));
      return;
    }
    if (status === "conflict") return;
    setStatus("saving");
    const timer = setTimeout(async () => {
      try {
        const result = await saveRemote(userId, state, meta?.updatedAt ?? null);
        if (result.ok) {
          saveMeta(metaFor(userId, state, result.updatedAt));
          setStatus("saved");
        } else setStatus("conflict");
      } catch {
        setStatus("offline");
      }
    }, 700);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, userId, retry]);

  // retry when the connection comes back
  useEffect(() => {
    if (status !== "offline") return;
    const again = () => setRetry((n) => n + 1);
    window.addEventListener("online", again);
    const timer = setInterval(again, 30_000);
    return () => {
      window.removeEventListener("online", again);
      clearInterval(timer);
    };
  }, [status]);

  // pick up changes made on another device when returning to the app
  useEffect(() => {
    if (!userId) return;
    const pull = async () => {
      if (document.visibilityState !== "visible") return;
      const meta = loadMeta(userId);
      if (!meta || meta.fingerprint !== fingerprint(latest.current)) return;
      try {
        const remote = await fetchRemote(userId);
        if (remote && remote.updatedAt !== meta.updatedAt) {
          saveMeta(metaFor(userId, remote.state, remote.updatedAt));
          replace(remote.state);
        }
      } catch {
        // offline: try again next time
      }
    };
    document.addEventListener("visibilitychange", pull);
    window.addEventListener("focus", pull);
    return () => {
      document.removeEventListener("visibilitychange", pull);
      window.removeEventListener("focus", pull);
    };
  }, [userId, replace]);

  const loadRemote = useCallback(async () => {
    if (!userId) return;
    const remote = await fetchRemote(userId);
    if (!remote) return;
    pushSnapshot(latest.current, "Cambios de este dispositivo antes de cargar los de la cuenta");
    saveMeta(metaFor(userId, remote.state, remote.updatedAt));
    setStatus("saved");
    replace(remote.state);
  }, [userId, replace]);

  const keepMine = useCallback(async () => {
    if (!userId) return;
    const remote = await fetchRemote(userId);
    const result = await saveRemote(userId, latest.current, remote?.updatedAt ?? null);
    if (result.ok) {
      saveMeta(metaFor(userId, latest.current, result.updatedAt));
      setStatus("saved");
    }
  }, [userId]);

  return {
    status,
    email: account?.email ?? null,
    loadRemote,
    keepMine,
    signOut: account?.signOut ?? null,
  };
}
