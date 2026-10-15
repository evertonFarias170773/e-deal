import type { ReactNode } from "react";
import { CobrancasProvider } from "@/features/cobrancas/CobrancasProvider";

/**
 * Conferência, detalhe da cobrança e nova cobrança: usam a lista completa de cobranças.
 *
 * O CobrancasProvider saiu do topo do app em 15/10/2026: ele lê o pagamentos_v2
 * inteiro, e só as telas que usam a lista completa de cobranças o montam.
 */
export default function CobrancasLayout({ children }: { children: ReactNode }) {
  return <CobrancasProvider>{children}</CobrancasProvider>;
}
