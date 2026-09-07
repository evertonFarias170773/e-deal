"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AppToastProvider } from "@/components/common/AppToast";
import { AuthProvider } from "@/features/auth/AuthProvider";
import { CobrancasProvider } from "@/features/cobrancas/CobrancasProvider";
import { CompanyProvider } from "@/features/companies/CompanyProvider";

/**
 * Fronteira de providers do app.
 * Os segmentos PÚBLICOS (sem login) NÃO montam nenhum provider privado — evita
 * sessão, contexto do ERP e fetches de dados (ex.: boletos do CobrancasProvider)
 * para visitantes anônimos. Demais rotas mantêm a árvore atual.
 *
 * QUEM CRIAR UMA ROTA PÚBLICA NOVA PRECISA ACRESCENTÁ-LA AQUI. Não é opcional, e
 * o esquecimento é silencioso: em 07/09/2026 as páginas do cadastro online
 * subiram sem entrar nesta lista, e cada abertura de /c/[token] disparava SETE
 * consultas anônimas a `clientes` pedindo `limite_credito` e `credito` — o
 * prefetch do CobrancasProvider. Todas voltaram 401 porque o `anon` havia sido
 * revogado de `clientes` dias antes; sem aquele REVOKE, o formulário público
 * estaria servindo limite e saldo de clientes reais a qualquer visitante.
 *
 * Ou seja: a última linha de defesa segurou o que a primeira deixou passar. As
 * duas precisam valer.
 */
const PREFIXOS_PUBLICOS = ["/os", "/c", "/privacidade"];

export function AppProviders({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const ehPublica = PREFIXOS_PUBLICOS.some(
    (prefixo) => pathname === prefixo || pathname?.startsWith(`${prefixo}/`)
  );

  if (ehPublica) {
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
