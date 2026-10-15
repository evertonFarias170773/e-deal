import type { ReactNode } from "react";
import { CobrancasProvider } from "@/features/cobrancas/CobrancasProvider";

/**
 * Página pública de pagamento (/pagamento/[token]): lê a cobrança pela lista do provider.
 *
 * O CobrancasProvider saiu do topo do app em 15/10/2026: ele lê o pagamentos_v2
 * inteiro, e só as telas que usam a lista completa de cobranças o montam.
 */
export default function PagamentoLayout({ children }: { children: ReactNode }) {
  return <CobrancasProvider>{children}</CobrancasProvider>;
}
