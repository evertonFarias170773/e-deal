import type { ReactNode } from "react";
import { CobrancasProvider } from "@/features/cobrancas/CobrancasProvider";

/**
 * Contas a Receber e Registro de Recebíveis: os modais de boleto atualizam a lista de cobranças.
 *
 * O CobrancasProvider saiu do topo do app em 15/10/2026: ele lê o pagamentos_v2
 * inteiro, e só as telas que usam a lista completa de cobranças o montam.
 */
export default function ContasAReceberLayout({ children }: { children: ReactNode }) {
  return <CobrancasProvider>{children}</CobrancasProvider>;
}
