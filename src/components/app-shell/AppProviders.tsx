"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AppToastProvider } from "@/components/common/AppToast";
import { AuthProvider } from "@/features/auth/AuthProvider";
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
const PREFIXOS_PUBLICOS = ["/os", "/c", "/p", "/privacidade"];

/**
 * Telas de entrada: também sem login, mas `/login` e `/boas-vindas` usam
 * `useAuth()`, então o AuthProvider fica. Saem o CompanyProvider e o
 * CobrancasProvider — nada de dado do ERP antes de haver sessão.
 */
const PREFIXOS_DE_ENTRADA = ["/login", "/cadastro", "/esqueci-minha-senha", "/atualizar-senha", "/boas-vindas"];

function casaPrefixo(pathname: string | null, prefixos: string[]) {
  return prefixos.some((prefixo) => pathname === prefixo || pathname?.startsWith(`${prefixo}/`));
}

export function AppProviders({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  if (casaPrefixo(pathname, PREFIXOS_PUBLICOS)) {
    return <>{children}</>;
  }

  if (casaPrefixo(pathname, PREFIXOS_DE_ENTRADA)) {
    return (
      <AuthProvider>
        <AppToastProvider>{children}</AppToastProvider>
      </AuthProvider>
    );
  }

  // O CobrancasProvider NÃO fica aqui desde 15/10/2026. Ele lê o pagamentos_v2
  // inteiro (≈10 mil linhas, mais propostas, clientes e boletos) e, no topo,
  // fazia isso ao abrir qualquer tela. Agora monta só onde a lista completa é
  // usada: layouts de /cobrancas, /contas-a-receber, /orcamentos/novo,
  // /orcamentos/[id] e /pagamento; a página /notas-fiscais; e, na lista de
  // Pedidos, sob demanda (CobrancasSobDemanda) nas três ações que precisam dela.
  return (
    <AuthProvider>
      <CompanyProvider>
        <AppToastProvider>{children}</AppToastProvider>
      </CompanyProvider>
    </AuthProvider>
  );
}
