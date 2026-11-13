/**
 * "Registrar devolução e cancelar pedido" (13/11/2026, caso 25098).
 *
 * O financeiro devolve o dinheiro pelo aplicativo do banco; o Vibe só registra
 * a devolução e cancela o pedido. Quem grava é a função do banco
 * `fin_registrar_devolucao_e_cancelar` (migration
 * 20261113_devolucao_pagamento_cancelar_pedido.sql), que confere tudo de novo.
 * Aqui fica só o que a tela e a rota repetem antes de chamá-la:
 *   - quem vê a ação e em qual cobrança;
 *   - a forma dos campos (e2eId, data, identificação, motivo);
 *   - a tradução dos códigos DEV_* da função para status HTTP.
 */

export type CobrancaParaDevolucao = {
  status?: string | null;
  tipo_cobranca?: string | null;
  valor?: number | string | null;
};

/** Forma sem dinheiro recebido do cliente (E-Faturado, E-Crédito e cortesias). */
export function tipoSemDinheiroRecebido(tipoCobranca: string | null | undefined): boolean {
  const tipo = String(tipoCobranca ?? "").trim().toUpperCase().replace(/_/g, "-");
  return tipo.startsWith("E-") && tipo !== "E-PIX";
}

/** A cobrança aceita devolução: paga, com dinheiro recebido. */
export function cobrancaAceitaDevolucao(cobranca: CobrancaParaDevolucao | null | undefined): boolean {
  if (!cobranca) return false;
  if (String(cobranca.status ?? "").trim().toUpperCase() !== "PAID") return false;
  if (tipoSemDinheiroRecebido(cobranca.tipo_cobranca)) return false;
  return Number(cobranca.valor ?? 0) > 0;
}

/** Só super admin vê e usa a ação (a função do banco confere de novo). */
export function podeRegistrarDevolucao(usuario: { isSuperAdmin?: boolean | null } | null | undefined): boolean {
  return Boolean(usuario?.isSuperAdmin);
}

/** e2eId do PIX: 32 letras e números, em maiúsculas. */
export function normalizarE2e(valor: string | null | undefined): string {
  return String(valor ?? "").replace(/\s+/g, "").toUpperCase();
}

export function e2eValido(valor: string): boolean {
  return /^[A-Z0-9]{32}$/.test(valor);
}

export type CamposDevolucao = {
  dataDevolucao: string; // AAAA-MM-DD
  e2eId: string;
  comprovante: string;
  motivo: string;
};

/**
 * Primeiro problema nos campos, ou null. `hoje` e `dataPagamento` em AAAA-MM-DD
 * (data civil de São Paulo), para comparar como texto.
 */
export function problemaNosCampos(
  campos: CamposDevolucao,
  hoje: string,
  dataPagamento: string | null
): string | null {
  const e2e = normalizarE2e(campos.e2eId);
  const comprovante = campos.comprovante.trim();
  if (!campos.motivo.trim()) return "Informe o motivo da devolução.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(campos.dataDevolucao)) return "Informe a data da devolução.";
  if (campos.dataDevolucao > hoje) return "A data da devolução não pode ser futura.";
  if (dataPagamento && campos.dataDevolucao < dataPagamento) return "A data da devolução é anterior ao pagamento.";
  if (!e2e && !comprovante) return "Informe o e2eId da devolução ou a identificação do comprovante.";
  if (e2e && !e2eValido(e2e)) return "O e2eId tem 32 letras e números, sem espaços.";
  return null;
}

/** Código DEV_* no começo da mensagem de erro da função. */
export function codigoDoErro(mensagem: string | null | undefined): string {
  const achado = String(mensagem ?? "").match(/\b(DEV_[A-Z_]+):/);
  return achado ? achado[1] : "FALHA";
}

/** Mensagem sem o código, para o usuário. */
export function textoDoErro(mensagem: string | null | undefined): string {
  const texto = String(mensagem ?? "").replace(/^.*?\bDEV_[A-Z_]+:\s*/, "").trim();
  if (!texto) return "Não foi possível registrar a devolução. Nada foi alterado.";
  return texto.charAt(0).toUpperCase() + texto.slice(1) + (/[.!?]$/.test(texto) ? "" : ".");
}

const STATUS_POR_CODIGO: Record<string, number> = {
  DEV_AUTH: 401,
  DEV_PERMISSAO: 403,
  DEV_PARAMS: 400,
  DEV_DATA: 400,
  DEV_IDENTIFICACAO: 400,
  DEV_E2E: 400,
  DEV_VALOR: 400,
  DEV_NAO_ENCONTRADA: 404
};

/** Status HTTP da recusa; as travas de negócio são 409. */
export function statusHttpDoErro(codigo: string): number {
  if (STATUS_POR_CODIGO[codigo]) return STATUS_POR_CODIGO[codigo];
  return codigo.startsWith("DEV_") ? 409 : 500;
}

/** Pagamento confirmado em mês anterior ao atual (datas em São Paulo). */
export function confirmadoEmMesFechado(dataConfirmacao: string | null | undefined, agora: Date = new Date()): boolean {
  if (!dataConfirmacao) return false;
  const mes = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" }).format(d);
  const confirmacao = new Date(dataConfirmacao);
  if (Number.isNaN(confirmacao.getTime())) return false;
  return mes(confirmacao) < mes(agora);
}

/** Data civil de São Paulo (AAAA-MM-DD) de um instante. */
export function dataCivilSaoPaulo(instante: string | Date | null | undefined): string | null {
  if (!instante) return null;
  const d = typeof instante === "string" ? new Date(instante) : instante;
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
