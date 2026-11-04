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
 */
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
    preenchido(c.cod_solicitacao_inter) &&
    !preenchido(c.pix_copia_cola) &&
    status !== "PAID" &&
    status !== "CANCELADO"
  );
}
