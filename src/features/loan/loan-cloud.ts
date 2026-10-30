import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { fingerprint, isLoanState } from "./loan-backup";
import type { LoanState } from "./loan-types";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** null when Supabase is not configured: the app then stays local-only. */
export const cloud: SupabaseClient | null = url && key ? createClient(url, key) : null;

const META_KEY = "control-prestamo:cloud-meta";
/** What this device last agreed on with the server. */
export type CloudMeta = { userId: string; updatedAt: string | null; fingerprint: string };

export function loadMeta(userId: string): CloudMeta | null {
  try {
    const meta = JSON.parse(localStorage.getItem(META_KEY) || "null") as CloudMeta | null;
    return meta?.userId === userId ? meta : null;
  } catch {
    return null;
  }
}
export function saveMeta(meta: CloudMeta) {
  localStorage.setItem(META_KEY, JSON.stringify(meta));
}
export function clearMeta() {
  localStorage.removeItem(META_KEY);
}
export const metaFor = (userId: string, state: LoanState, updatedAt: string | null): CloudMeta => ({
  userId,
  updatedAt,
  fingerprint: fingerprint(state),
});

export async function fetchRemote(userId: string) {
  const { data, error } = await cloud!
    .from("loan_state")
    .select("data, updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  if (!isLoanState(data.data)) throw new Error("Los datos guardados en la nube no son válidos.");
  return { state: data.data as LoanState, updatedAt: data.updated_at as string };
}

export type SaveResult =
  | { ok: true; updatedAt: string }
  | { ok: false; conflict: true };

/**
 * Saves only if the server still holds the version this device started from
 * (`baseUpdatedAt`), so one device can never silently overwrite another's
 * newer payments.
 */
export async function saveRemote(
  userId: string,
  state: LoanState,
  baseUpdatedAt: string | null,
): Promise<SaveResult> {
  const updated_at = new Date().toISOString();
  if (baseUpdatedAt === null) {
    const { data, error } = await cloud!
      .from("loan_state")
      .insert({ user_id: userId, data: state, updated_at })
      .select("updated_at")
      .single();
    if (error?.code === "23505") return { ok: false, conflict: true };
    if (error) throw error;
    return { ok: true, updatedAt: data.updated_at };
  }
  const { data, error } = await cloud!
    .from("loan_state")
    .update({ data: state, updated_at })
    .eq("user_id", userId)
    .eq("updated_at", baseUpdatedAt)
    .select("updated_at");
  if (error) throw error;
  if (!data.length) return { ok: false, conflict: true };
  return { ok: true, updatedAt: data[0].updated_at };
}
