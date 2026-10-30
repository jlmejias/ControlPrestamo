import type { LoanState } from "./loan-types";

const SNAPSHOTS_KEY = "control-prestamo:snapshots";
const BACKUP_KEY = "control-prestamo:last-backup";
const MAX_SNAPSHOTS = 25;

export type Snapshot = { at: string; label: string; state: LoanState };
export type BackupInfo = { at: string; fingerprint: string; target: "file" | "download" };

export function isLoanState(value: unknown): value is LoanState {
  const s = value as LoanState;
  return Boolean(
    s &&
      s.version === 1 &&
      s.config &&
      typeof s.config.principal === "number" &&
      Array.isArray(s.payments),
  );
}

export function fingerprint(state: LoanState) {
  const text = JSON.stringify(state);
  let hash = 5381;
  for (let i = 0; i < text.length; i++)
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return `${text.length}:${hash >>> 0}`;
}

function read<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}

// Local version history: every destructive change keeps the previous state.
export const loadSnapshots = () => read<Snapshot[]>(SNAPSHOTS_KEY, []);
export function pushSnapshot(state: LoanState, label: string) {
  const list = loadSnapshots();
  if (list[0] && fingerprint(list[0].state) === fingerprint(state)) return;
  list.unshift({ at: new Date().toISOString(), label, state });
  try {
    localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(list.slice(0, MAX_SNAPSHOTS)));
  } catch {
    // storage full: keep fewer versions rather than failing the change
    localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(list.slice(0, 5)));
  }
}

export const loadBackupInfo = () => read<BackupInfo | null>(BACKUP_KEY, null);
export function markBackedUp(state: LoanState, target: BackupInfo["target"]) {
  const info: BackupInfo = {
    at: new Date().toISOString(),
    fingerprint: fingerprint(state),
    target,
  };
  localStorage.setItem(BACKUP_KEY, JSON.stringify(info));
  return info;
}

export const backupFilename = () =>
  `control-prestamo-respaldo-${new Date().toISOString().slice(0, 10)}.json`;

// ---- Automatic backup to a file the user picks (Chrome / Edge) ----
type FileHandle = {
  name: string;
  createWritable: () => Promise<{
    write: (data: string) => Promise<void>;
    close: () => Promise<void>;
  }>;
  queryPermission?: (o: { mode: "readwrite" }) => Promise<PermissionState>;
  requestPermission?: (o: { mode: "readwrite" }) => Promise<PermissionState>;
};
type PickerWindow = Window & {
  showSaveFilePicker?: (options: unknown) => Promise<FileHandle>;
};

export const autoBackupSupported = () =>
  typeof window !== "undefined" &&
  typeof (window as PickerWindow).showSaveFilePicker === "function";

function db() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open("control-prestamo", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("handles");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idb<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest) {
  const conn = await db();
  return new Promise<T>((resolve, reject) => {
    const req = run(conn.transaction("handles", mode).objectStore("handles"));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

export async function getBackupHandle() {
  try {
    return (await idb<FileHandle | undefined>("readonly", (s) => s.get("backup"))) ?? null;
  } catch {
    return null;
  }
}
export async function pickBackupFile() {
  const handle = await (window as PickerWindow).showSaveFilePicker!({
    suggestedName: "control-prestamo-respaldo.json",
    types: [{ description: "Respaldo JSON", accept: { "application/json": [".json"] } }],
  });
  await idb("readwrite", (s) => s.put(handle, "backup"));
  return handle;
}
export async function forgetBackupFile() {
  await idb("readwrite", (s) => s.delete("backup"));
}
export async function hasPermission(handle: FileHandle, ask = false) {
  if (!handle.queryPermission) return true;
  const opts = { mode: "readwrite" as const };
  if ((await handle.queryPermission(opts)) === "granted") return true;
  return ask && handle.requestPermission
    ? (await handle.requestPermission(opts)) === "granted"
    : false;
}
export async function writeBackup(handle: FileHandle, state: LoanState) {
  const file = await handle.createWritable();
  await file.write(JSON.stringify(state, null, 2));
  await file.close();
}
export type { FileHandle };
