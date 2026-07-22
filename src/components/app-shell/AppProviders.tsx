"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AppToastProvider } from "@/components/common/AppToast";
import { AuthProvider } from "@/features/auth/AuthProvider";
import { CobrancasProvider } from "@/features/cobrancas/CobrancasProvider";
import { CompanyProvider } from "@/features/companies/CompanyProvider";

/**
 * Fronteira de providers do app.
 * O segmento público /os (QR de produção, sem login) NÃO monta nenhum provider
 * privado — evita sessão, contexto do ERP e fetches de dados (ex.: boletos do
 * CobrancasProvider) para visitantes anônimos. Demais rotas mantêm a árvore atual.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isOsPublico = pathname === "/os" || pathname?.startsWith("/os/");

  if (isOsPublico) {
    return <>{children}</>;
  }

  return (
    <AuthProvider>
      <CompanyProvider>
        <CobrancasProvider>
          <AppToastProvider>{children}</AppToastProvider>
        </CobrancasProvider>
      </CompanyProvider>
    </AuthProvider>
  );
}
