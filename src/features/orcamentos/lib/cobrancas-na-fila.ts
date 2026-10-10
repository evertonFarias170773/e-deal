/**
 * "Confirmar Conferência" no menu Ações da lista de Pedidos — quais cobranças de
 * cada pedido estão na FILA DE CONFERÊNCIA.
 *
 * O CRITÉRIO NÃO É ESCRITO AQUI
 *   Quem decide é `isFilaPadrao` (cobrancas-utils), a mesma função que a tela da
 *   Conferência usa para montar a Fila. Este módulo só entrega a ela a MESMA
 *   entrada que a Conferência entrega: o `status` normalizado
 *   (`normalizeCobrancaStatus`, como o mapper da Conferência) e o `confirmado`
 *   como booleano (nulo vira falso). Assim o mesmo conjunto de cobranças dá a
 *   mesma Fila nas duas telas.
 *
 * É uma regra POR COBRANÇA (`pagamentos_v2.id`): um pedido pode ter mais de uma
 * na Fila, e cada uma é conferida à parte, como na Conferência.
 *
 * Só leitura e só exibição. Quem confirma é a rota oficial
 * `POST /api/cobrancas/confirmar`, que confere a permissão no servidor.
 */
import {
  getTipoCobrancaLabel,
  isFilaPadrao,
  normalizeCobrancaStatus
} from "@/features/cobrancas/cobrancas-utils";
import { formatCurrency } from "@/lib/formatters/currency";
import type { Cobranca } from "@/features/cobrancas/types";

/** As colunas de `pagamentos_v2` que a lista lê (a Fila só precisa destas). */
export type PagamentoDaLista = {
  id?: unknown;
  id_int?: unknown;
  tipo_cobranca?: unknown;
  status?: unknown;
  confirmado?: unknown;
  confirmado_por?: unknown;
  paid_at?: unknown;
  valor?: unknown;
  created_at?: unknown;
};

export type CobrancaNaFilaDaLista = {
  /** `pagamentos_v2.id`: o que a rota de confirmação recebe. */
  id: string;
  tipoCobranca: string;
  valor: number;
};

const texto = (valor: unknown) => (valor === null || valor === undefined ? "" : String(valor));

/** A cobrança está na Fila de Conferência? Mesmo critério e mesma entrada da Conferência. */
export function cobrancaDaListaEstaNaFila(linha: PagamentoDaLista): boolean {
  const confirmado = linha.confirmado === true;
  const status = normalizeCobrancaStatus({
    status: texto(linha.status),
    paidAt: texto(linha.paid_at),
    confirmado
  });
  const valor = Number(linha.valor);
  return isFilaPadrao({
    status,
    confirmado,
    tipo_cobranca: texto(linha.tipo_cobranca) as Cobranca["tipo_cobranca"],
    confirmado_por: texto(linha.confirmado_por) || undefined,
    valor: Number.isFinite(valor) ? valor : 0
  });
}

/** As cobranças na Fila de cada pedido (chave: `id_int` em texto), da mais antiga para a mais nova. */
export function cobrancasNaFilaPorPedido(linhas: readonly PagamentoDaLista[]): Map<string, CobrancaNaFilaDaLista[]> {
  const porPedido = new Map<string, Array<CobrancaNaFilaDaLista & { criadoEm: string }>>();
  for (const linha of linhas) {
    const id = texto(linha.id);
    const idInt = texto(linha.id_int);
    if (!id || !idInt) continue;
    if (!cobrancaDaListaEstaNaFila(linha)) continue;
    const valor = Number(linha.valor);
    const lista = porPedido.get(idInt) ?? [];
    lista.push({ id, tipoCobranca: texto(linha.tipo_cobranca), valor: Number.isFinite(valor) ? valor : 0, criadoEm: texto(linha.created_at) });
    porPedido.set(idInt, lista);
  }

  const resultado = new Map<string, CobrancaNaFilaDaLista[]>();
  for (const [idInt, lista] of porPedido) {
    lista.sort((a, b) => a.criadoEm.localeCompare(b.criadoEm) || a.id.localeCompare(b.id));
    resultado.set(idInt, lista.map(({ id, tipoCobranca, valor }) => ({ id, tipoCobranca, valor })));
  }
  return resultado;
}

/**
 * O texto da opção no menu Ações. Uma cobrança na Fila: "Confirmar Conferência".
 * Duas ou mais: uma opção por cobrança, com a forma e o valor para distinguir.
 */
export function rotuloDaOpcaoDeConferencia(cobranca: CobrancaNaFilaDaLista, totalNaFila: number): string {
  if (totalNaFila <= 1) return "Confirmar Conferência";
  return `Confirmar Conferência — ${getTipoCobrancaLabel(cobranca.tipoCobranca)} ${formatCurrency(cobranca.valor)}`;
}

/** A opção aparece só para ADM — o mesmo teste de ADM da página. A rota confere no servidor de qualquer forma. */
export function podeVerConfirmarConferenciaNaLista(usuario: { isSuperAdmin?: boolean | null; isAdmin?: boolean | null } | null | undefined): boolean {
  return Boolean(usuario?.isSuperAdmin || usuario?.isAdmin);
}
