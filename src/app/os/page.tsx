import type { Metadata } from "next";
import { OsQrClient } from "./os-qr-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "OS — Produção",
  robots: { index: false, follow: false },
  referrer: "no-referrer"
};

/**
 * Página pública do QR de produção. O token viaja no FRAGMENT da URL
 * (/os#<token>) e nunca chega ao servidor — a resolução do estado acontece
 * no client via POST (token no body). Nunca atualiza status ao abrir.
 */
export default function OsPublicPage() {
  const habilitado = process.env.OS_QR_PUBLICO_ENABLED === "true";
  if (!habilitado) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-600 shadow-sm">
        Acompanhamento por QR Code indisponível.
      </div>
    );
  }
  return <OsQrClient />;
}
