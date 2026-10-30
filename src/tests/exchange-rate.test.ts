import { describe, expect, it } from "vitest";
import { fetchUsdRate } from "../features/loan/exchange-rate";

const respond = (body: unknown, ok = true) =>
  Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response);

describe("tipo de cambio", () => {
  it("usa el tipo de venta de Hacienda", async () => {
    const r = await fetchUsdRate((() =>
      respond({ compra: { fecha: "2026-10-30", valor: 498.12 }, venta: { fecha: "2026-10-30 00:00:00", valor: 504.876 } })) as typeof fetch);
    expect(r.rate).toBe(504.88);
    expect(r.date).toBe("2026-10-30");
    expect(r.source).toContain("Hacienda");
  });

  it("pasa a la siguiente fuente si una falla o trae datos raros", async () => {
    let call = 0;
    const r = await fetchUsdRate(((url: string) => {
      call++;
      if (url.includes("hacienda")) return Promise.reject(new TypeError("CORS"));
      if (url.includes("er-api")) return respond({ rates: { CRC: 0 } });
      return respond({ date: "2026-10-29", usd: { crc: 507.3 } });
    }) as typeof fetch);
    expect(call).toBe(3);
    expect(r.rate).toBe(507.3);
  });

  it("avisa si ninguna fuente responde", async () => {
    await expect(fetchUsdRate((() => respond({}, false)) as typeof fetch)).rejects.toThrow();
  });
});
