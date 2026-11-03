import type { ComponentType } from "react";
import { SLUG_PAGAMENTO_COMISSAO } from "../definicoes/pagamento-comissao";
import type { ConsultaRelatorio, LinhaRelatorio } from "../types";
import { ReciboComissaoAcoes } from "./ReciboComissaoAcoes";

/**
 * Ações por linha (03/11/2026): relatório que precisa de um menu no fim da linha registra aqui o
 * componente, pelo slug. A página base acrescenta a coluna Ações só para esses relatórios; os
 * demais não mudam. Fica fora de `types.ts` porque é React (a definição continua pura).
 */
export type AcoesDaLinhaProps = { linha: LinhaRelatorio; consulta: ConsultaRelatorio };

export const ACOES_DA_LINHA: Record<string, ComponentType<AcoesDaLinhaProps>> = {
  [SLUG_PAGAMENTO_COMISSAO]: ReciboComissaoAcoes
};
