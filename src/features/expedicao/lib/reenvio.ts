/**
 * REENVIO DE PEDIDO DEVOLVIDO, FASE 1 (22/10/2026) — o lado da tela.
 *
 * Quem decide e o BANCO: `exp_reenviar_pedido` (migration
 * `20261022_exp_reenvio_fase1.sql`) confere a permissao `expedicao.reenvio`,
 * trava o pedido, recusa diferenca de frete e troca de quem paga, grava o
 * registro em `expedicao_reenvios` (com a copia do envio anterior) e leva o
 * pedido de EM TRANSITO para EXPEDICAO. Aqui so o que a tela precisa para
 * mostrar o item, os avisos e o estado "reenvio aberto".
 *
 * REENVIO ABERTO
 *   O reenvio NAO zera `expedicoes.data_despacho`: depois do despacho vale o
 *   endereco gravado (lib/endereco-entrega.ts), e e isso que faz o endereco
 *   novo valer. O reenvio esta aberto enquanto a data de despacho gravada for
 *   a mesma que o registro copiou (`data_despacho_anterior`); o proximo
 *   Despachar grava data nova e o fecha. Sem coluna nem trigger novos.
 */
import type { TipoFreteNormalizado } from "../types";

/** Uma linha de `expedicao_reenvios`, como a lista le. */
export interface LinhaReenvio {
  id_int: number | string;
  ciclo: number | string;
  motivo: string | null;
  autor_nome: string | null;
  criado_em: string;
  tipo_frete_anterior: string | null;
  tipo_frete_novo: string | null;
  data_despacho_anterior: string;
}

/** O que o pedido carrega sobre reenvio. */
export interface ReenvioDoPedido {
  /** Quantos reenvios o pedido ja teve. O proximo e `ciclos + 1`. */
  ciclos: number;
  /** O ultimo reenvio, quando ainda nao foi redespachado. */
  aberto: {
    ciclo: number;
    motivo: string;
    autorNome: string | null;
    criadoEm: string;
    tipoFreteAnterior: string | null;
    tipoFreteNovo: string | null;
  } | null;
}

function mesmoInstante(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  return Number.isFinite(ta) && Number.isFinite(tb) && ta === tb;
}

/**
 * Junta as linhas de um pedido. `dataDespachoAtual` e `expedicoes.data_despacho`
 * de agora: o ultimo ciclo esta aberto se ela ainda e a que ele copiou.
 */
export function reenvioDoPedido(linhas: LinhaReenvio[], dataDespachoAtual: string | null | undefined): ReenvioDoPedido | null {
  if (linhas.length === 0) return null;
  const ordenadas = [...linhas].sort((a, b) => Number(b.ciclo) - Number(a.ciclo));
  const ultimo = ordenadas[0];
  const aberto = mesmoInstante(ultimo.data_despacho_anterior, dataDespachoAtual)
    ? {
        ciclo: Number(ultimo.ciclo),
        motivo: String(ultimo.motivo ?? ""),
        autorNome: ultimo.autor_nome ?? null,
        criadoEm: String(ultimo.criado_em),
        tipoFreteAnterior: ultimo.tipo_frete_anterior ?? null,
        tipoFreteNovo: ultimo.tipo_frete_novo ?? null
      }
    : null;
  return { ciclos: Number(ultimo.ciclo), aberto };
}

/** Agrupa a consulta da lista por pedido. */
export function agruparReenvios(linhas: LinhaReenvio[]): Map<number, LinhaReenvio[]> {
  const mapa = new Map<number, LinhaReenvio[]>();
  for (const l of linhas) {
    const id = Number(l.id_int);
    if (!Number.isFinite(id)) continue;
    const lista = mapa.get(id) ?? [];
    lista.push(l);
    mapa.set(id, lista);
  }
  return mapa;
}

/**
 * O item "Reenviar" aparece? Espelha as recusas que o banco faz ANTES do frete,
 * para nao oferecer o que vai ser recusado de cara. Quem garante e a RPC.
 */
export function podeOferecerReenvio(p: {
  statusInterno: string;
  despachoConfirmado: boolean;
  dataEntrega: string | null | undefined;
  pedidoPrincipal: { idInt: number } | null;
  complementos: unknown[];
}): boolean {
  return (
    p.statusInterno.trim().toUpperCase() === "EM TRANSITO" &&
    p.despachoConfirmado &&
    !p.dataEntrega &&
    p.pedidoPrincipal === null &&
    p.complementos.length === 0
  );
}

/** Chave idempotente do proximo ciclo — a mesma regra do banco. */
export function chaveDoReenvio(idInt: number, ciclo: number): string {
  return `REENVIO:${idInt}:${ciclo}`;
}

/** Os avisos que a tela mostra no reenvio e no redespacho. */
export function avisosDoReenvio(e: {
  tipoFreteAtual: TipoFreteNormalizado | string | null | undefined;
  correiosCodigoObjeto: string | null | undefined;
  prepostagemCanceladaEm: string | null | undefined;
  azulAwb: string | null | undefined;
}): string[] {
  const avisos: string[] = [];
  if (e.correiosCodigoObjeto && !e.prepostagemCanceladaEm) {
    avisos.push(
      `O objeto antigo dos Correios (${e.correiosCodigoObjeto}) continua gerando cobrança até ser cancelado no portal dos Correios. ` +
        "A etiqueta nova sai pelo Despachar: gere a prepostagem de novo (a tela pede confirmação)."
    );
  }
  if (e.azulAwb) {
    avisos.push(
      `A Azul emite uma AWB por pedido e este já tem a AWB ${e.azulAwb}. O sistema ainda não emite uma segunda: combine o reenvio direto com a Azul.`
    );
  }
  return avisos;
}

/** Erro cru da RPC ("EXP_REENVIO_FRETE: ...", "PERM: ...") -> so o texto. */
export function textoDoErroDeReenvio(mensagem: string): string {
  const semCodigo = mensagem.replace(/^EXP_REENVIO_[A-Z_]+:\s*/, "");
  if (/^PERM:/.test(semCodigo)) return "Você não tem a permissão de reenviar pedido (expedicao.reenvio).";
  return semCodigo;
}
