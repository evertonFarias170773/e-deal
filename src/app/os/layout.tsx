import type { ReactNode } from "react";

/**
 * Layout do segmento público /os (QR de produção).
 * Sem navegação, menus ou links internos — isolado do restante do ERP.
 */
export default function OsPublicLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-start justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-md">{children}</div>
    </main>
  );
}
