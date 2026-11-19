/**
 * PIX da Birô "em preparação" (04/11/2026, proposta A aprovada pelo dono).
 *
 * O Inter devolve o código da cobrança na hora, mas pode levar minutos para
 * emiti-la (12 a 24 min em 04/11). O QR só é entregue quando a cobrança está
 * A_RECEBER: até lá a cobrança tem o código gravado e o copia e cola vazio.
 * O aviso A_RECEBER do Inter (NOTIFICA-INTER IDEAL) grava o copia e cola
 * depois. Sem migration: o estado sai das colunas que já existem.
 *
 * Nunca se cria outra cobrança no Inter para um título nesse estado.
 *
 * Só vale para título do INTER (código UUID, 18/11/2026): o PIX da Birô no C6
 * nasce com o QR na resposta, como o da Ideal, e código do C6 sem QR é o mesmo
 * "emitido sem QR" das outras empresas.
 */
import { bancoDoCodigoPix } from "@/features/cobrancas/lib/banco-pix-biro";

/** Título da Birô no Inter: o único que pode ficar "em preparação". */
export function pixDaBiroNoInter(idEmpresa: number | string | null | undefined, codigo: string | null | undefined): boolean {
  return Number(idEmpresa) === 2 && bancoDoCodigoPix(codigo) === "INTER";
}

export const CODIGO_PIX_EM_PREPARACAO = "PIX_EM_PREPARACAO";
export const MENSAGEM_PIX_EM_PREPARACAO = "Seu PIX está sendo preparado pelo banco. Esta página atualiza sozinha.";
export const SELO_PIX_EM_PREPARACAO = "PIX em preparação no banco";

const EMPRESA_BIRO = 2;

type CobrancaComPix = {
  tipo_cobranca?: string | null;
  id_empresa?: number | string | null;
  cod_solicitacao_inter?: string | null;
  pix_copia_cola?: string | null;
  status?: string | null;
};

const preenchido = (v: unknown) => String(v ?? "").trim() !== "";

export function pixEmPreparacao(c: CobrancaComPix): boolean {
  const status = String(c.status ?? "").toUpperCase();
  return (
    String(c.tipo_cobranca ?? "").toUpperCase() === "PIX" &&
    Number(c.id_empresa) === EMPRESA_BIRO &&
    bancoDoCodigoPix(c.cod_solicitacao_inter) === "INTER" &&
    !preenchido(c.pix_copia_cola) &&
    status !== "PAID" &&
    status !== "CANCELADO"
  );
}
