import { useCallback, useEffect, useState } from "react";

/** Colones per US dollar, as published by the source on `date`. */
export type UsdRate = { rate: number; date: string; source: string; fetchedAt: number };

const KEY = "control-prestamo:usd-rate";
const MAX_AGE = 6 * 60 * 60 * 1000;

const valid = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n > 100 && n < 5000;

type Source = { name: string; url: string; parse: (json: unknown) => { rate: number; date: string } | null };

// Tried in order. Hacienda publishes the official BCCR reference rate; the
// other two are general exchange-rate feeds used only if it is unreachable.
export const SOURCES: Source[] = [
  {
    name: "Ministerio de Hacienda (BCCR)",
    url: "https://api.hacienda.go.cr/indicadores/tc/dolar",
    parse: (json) => {
      const venta = (json as { venta?: { valor?: unknown; fecha?: unknown } })?.venta;
      return venta && valid(venta.valor)
        ? { rate: venta.valor, date: String(venta.fecha ?? "").slice(0, 10) }
        : null;
    },
  },
  {
    name: "ExchangeRate-API",
    url: "https://open.er-api.com/v6/latest/USD",
    parse: (json) => {
      const j = json as { rates?: { CRC?: unknown }; time_last_update_unix?: number };
      return valid(j?.rates?.CRC)
        ? {
            rate: j.rates.CRC,
            date: j.time_last_update_unix
              ? new Date(j.time_last_update_unix * 1000).toISOString().slice(0, 10)
              : "",
          }
        : null;
    },
  },
  {
    name: "Currency API",
    url: "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json",
    parse: (json) => {
      const j = json as { usd?: { crc?: unknown }; date?: unknown };
      return valid(j?.usd?.crc) ? { rate: j.usd.crc, date: String(j.date ?? "") } : null;
    },
  },
];

export function cachedUsdRate(): UsdRate | null {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "null") as UsdRate | null;
    return saved && valid(saved.rate) ? saved : null;
  } catch {
    return null;
  }
}

export async function fetchUsdRate(fetcher: typeof fetch = fetch): Promise<UsdRate> {
  for (const source of SOURCES) {
    try {
      const response = await fetcher(source.url, { cache: "no-store" });
      if (!response.ok) continue;
      const parsed = source.parse(await response.json());
      if (!parsed) continue;
      const result = {
        rate: Math.round(parsed.rate * 100) / 100,
        date: parsed.date,
        source: source.name,
        fetchedAt: Date.now(),
      };
      try {
        localStorage.setItem(KEY, JSON.stringify(result));
      } catch {
        // Storage full or blocked: the rate still works for this session.
      }
      return result;
    } catch {
      // Network or CORS error: try the next source.
    }
  }
  throw new Error("No se pudo obtener el tipo de cambio.");
}

/**
 * Today's dollar rate, refreshed automatically when the cached one is older
 * than a few hours. Falls back to the last rate obtained when offline.
 */
export function useUsdRate() {
  const [rate, setRate] = useState<UsdRate | null>(cachedUsdRate);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setRate(await fetchUsdRate());
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const saved = cachedUsdRate();
    if (!saved || Date.now() - saved.fetchedAt > MAX_AGE) void refresh();
  }, [refresh]);

  return { rate, loading, failed, refresh };
}
