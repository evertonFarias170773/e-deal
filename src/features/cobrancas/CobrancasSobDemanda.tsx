"use client";

import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { CobrancasProvider, useCobrancas } from "@/features/cobrancas/CobrancasProvider";

/**
 * CARGA DE COBRANÇAS SÓ QUANDO A AÇÃO É ABERTA (15/10/2026).
 *
 * Até aqui o `CobrancasProvider` ficava no topo do app e lia o `pagamentos_v2`
 * inteiro (≈10 mil linhas, mais propostas, clientes e boletos) ao abrir
 * QUALQUER tela. A lista de Pedidos pagava essa carga para usar só três ações.
 * Agora ela monta o provider aqui, no instante em que a ação abre, e o
 * desmonta quando a ação fecha.
 *
 * A AÇÃO SÓ APARECE COM A CARGA COMPLETA. Enquanto a leitura não termina, a
 * tela mostra "Carregando" e o componente da ação nem é montado — nenhum botão
 * financeiro ou de cancelamento existe antes disso. Carga completa é `OK` ou
 * `VAZIA`, lida do banco (`source === "supabase"`). `FALHA` e `INCOMPLETA` não
 * liberam a ação: é exatamente o caso em que o saldo e a decisão de cancelar
 * sairiam de uma base parcial.
 *
 * As funções de escrita são as do provider, sem mudança: o que muda é só onde
 * e quando a carga acontece.
 */
export function CobrancasSobDemanda({ children, onFechar }: { children: ReactNode; onFechar: () => void }) {
  return (
    <CobrancasProvider>
      <PortaoDaCargaCompleta onFechar={onFechar}>{children}</PortaoDaCargaCompleta>
    </CobrancasProvider>
  );
}

function PortaoDaCargaCompleta({ children, onFechar }: { children: ReactNode; onFechar: () => void }) {
  const { statusCarga, mensagemCarga, source } = useCobrancas();

  const cargaCompleta = source === "supabase" && (statusCarga === "OK" || statusCarga === "VAZIA");
  if (cargaCompleta) return <>{children}</>;

  const falhou = statusCarga === "FALHA" || statusCarga === "INCOMPLETA";

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-sm space-y-4 rounded-3xl bg-white p-6 shadow-2xl dark:bg-slate-900">
        {falhou ? (
          <>
            <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-100">Não foi possível carregar as cobranças</h2>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {mensagemCarga || "A lista de cobranças não carregou por completo."} A ação fica indisponível até a lista
              carregar inteira. Feche e tente de novo em instantes.
            </p>
          </>
        ) : (
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 shrink-0 animate-spin text-slate-500" aria-hidden="true" />
            <p className="text-sm text-slate-700 dark:text-slate-200">Carregando as cobranças…</p>
          </div>
        )}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onFechar}
            className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {falhou ? "Fechar" : "Cancelar"}
          </button>
        </div>
      </div>
    </div>
  );
}
