import type { Cobranca } from "@/features/cobrancas/types";

export type PlanoParcelamento = {
  qtdParcelas: number;
  valorEntrada: number;
  diasPraInicio: number;
  intervalo: number;
};

export type RecebivelParaRegistro = {
  cobranca: Cobranca;
  plano: PlanoParcelamento | null;
  possuiBoletos: boolean;
  empresaIndefinida: boolean;
};

export type RecebiveisParaRegistroResult = {
  itens: RecebivelParaRegistro[];
  errorMessage: string | null;
};
