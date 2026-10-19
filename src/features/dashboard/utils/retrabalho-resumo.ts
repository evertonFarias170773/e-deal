import { retrabalhoConfirmadoParaLista } from "@/lib/retrabalho";
import { getLocalDateInSaoPaulo } from "@/features/cobrancas/cobrancas-utils";

/**
 * QUADRO "RETRABALHO" DO DASHBOARD (19/10/2026) — so informativo.
 *
 * Conta as MESMAS cobrancas da lista "Retrabalhos" da aba Cobrancas Confirmadas
 * (`retrabalhoConfirmadoParaLista`: E-RETRABALHO viva, confirmada, PAID ou A_VENCER),
 * no MESMO recorte de periodo da lista: o dia de `data_confirmacao` em Sao Paulo
 * dentro de [inicio, fim]. Retrabalho NUNCA entra nos totais de faturamento
 * (`contaNoFaturamento`, 61a7b0f): este quadro e a parte.
 */

export type CobrancaParaResumoDeRetrabalho = {
  tipo_cobranca: string | null;
  status: string | null;
  confirmado: boolean | null;
  valor: number | string | null;
  id_empresa: number | null;
  data_confirmacao: string | null;
};

export type ResumoDeRetrabalho = {
  quantidade: number;
  valor: number;
  /** Por `id_empresa` (1, 2, 3; outro id entra so no total). */
  porEmpresa: Record<number, { quantidade: number; valor: number }>;
};

export function resumoDeRetrabalho(
  cobrancas: readonly CobrancaParaResumoDeRetrabalho[],
  periodo: { inicio: string; fim: string }
): ResumoDeRetrabalho {
  const resumo: ResumoDeRetrabalho = { quantidade: 0, valor: 0, porEmpresa: {} };
  for (const c of cobrancas) {
    if (!retrabalhoConfirmadoParaLista(c)) continue;
    const dia = getLocalDateInSaoPaulo(c.data_confirmacao);
    if (!dia || dia < periodo.inicio || dia > periodo.fim) continue;
    const valor = Number(c.valor) || 0;
    resumo.quantidade += 1;
    resumo.valor += valor;
    const empresa = Number(c.id_empresa);
    if (Number.isFinite(empresa)) {
      const atual = resumo.porEmpresa[empresa] ?? { quantidade: 0, valor: 0 };
      resumo.porEmpresa[empresa] = { quantidade: atual.quantidade + 1, valor: atual.valor + valor };
    }
  }
  resumo.valor = Math.round(resumo.valor * 100) / 100;
  for (const k of Object.keys(resumo.porEmpresa)) {
    const e = resumo.porEmpresa[Number(k)];
    e.valor = Math.round(e.valor * 100) / 100;
  }
  return resumo;
}
