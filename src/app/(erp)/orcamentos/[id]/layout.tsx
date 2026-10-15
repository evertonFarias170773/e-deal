import type { ReactNode } from "react";
import { CobrancasProvider } from "@/features/cobrancas/CobrancasProvider";

/**
 * Detalhe e editor da proposta: o painel de cobrança calcula o saldo com a base completa.
 *
 * O CobrancasProvider saiu do topo do app em 15/10/2026: ele lê o pagamentos_v2
 * inteiro, e só as telas que usam a lista completa de cobranças o montam.
 */
export default function PropostaLayout({ children }: { children: ReactNode }) {
  return <CobrancasProvider>{children}</CobrancasProvider>;
}
