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
import { normalizarTipoFrete } from "./tipo-frete";

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
  /** Fase 2B (18/11/2026). Ausentes antes da migration 20261118: valem 0/false. */
  diferenca?: number | string | null;
  exige_nota?: boolean | null;
  frete_origem?: string | null;
  frete_novo?: number | string | null;
  abono_valor?: number | string | null;
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
    /** Fase 2B: diferenca de frete do ciclo (0 sem diferenca). */
    diferenca: number;
    /** Fase 2B: o tipo de envio mudou; o redespacho exige nota nova. */
    exigeNota: boolean;
    /** Fase 2B: o ciclo cotou o frete (COTACAO ou DIGITADO_ADM). */
    freteDecidido: boolean;
  } | null;
  /** Frete gravado pelo ultimo ciclo que gravou frete (base do proximo). */
  ultimoFrete: number | null;
}

function numeroOuNulo(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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
        tipoFreteNovo: ultimo.tipo_frete_novo ?? null,
        diferenca: numeroOuNulo(ultimo.diferenca) ?? 0,
        exigeNota: ultimo.exige_nota === true,
        freteDecidido: ultimo.frete_origem === "COTACAO" || ultimo.frete_origem === "DIGITADO_ADM"
      }
    : null;
  const comFrete = ordenadas.find((l) => numeroOuNulo(l.frete_novo) !== null);
  return { ciclos: Number(ultimo.ciclo), aberto, ultimoFrete: comFrete ? numeroOuNulo(comFrete.frete_novo) : null };
}

// -----------------------------------------------------------------------------
// FASE 2B (18/11/2026): frete do reenvio, diferenca e redespacho
// -----------------------------------------------------------------------------

/** Uma opcao da cotacao (`/api/expedicao/recotacao/cotar`). */
export interface OpcaoCotadaReenvio {
  id: string;
  transportadora: string;
  servico: string;
  valor: number;
  prazo: string;
}

/**
 * Tipo de envio de uma opcao: o mesmo criterio do banco em
 * `exp_reenviar_pedido` (servico; se nao classificar, a transportadora).
 */
export function tipoDaOpcao(o: Pick<OpcaoCotadaReenvio, "servico" | "transportadora">): TipoFreteNormalizado {
  const peloServico = normalizarTipoFrete(o.servico || o.transportadora);
  if (peloServico === "CORREIOS" || peloServico === "MOTOBOY" || peloServico === "TRANSPORTADORA") return peloServico;
  return normalizarTipoFrete(o.transportadora);
}

/** So as opcoes do tipo de envio escolhido, da mais barata para a mais cara. */
export function opcoesDoTipo<T extends OpcaoCotadaReenvio>(opcoes: T[], tipo: TipoFreteNormalizado): T[] {
  return opcoes.filter((o) => tipoDaOpcao(o) === tipo && Number.isFinite(o.valor)).sort((a, b) => a.valor - b.valor);
}

/** Frete do envio anterior: o do ultimo ciclo com frete, ou o da proposta. */
export function freteDoEnvioAnterior(reenvio: ReenvioDoPedido | null | undefined, freteProposta: number | null | undefined): number {
  const base = reenvio?.ultimoFrete ?? freteProposta ?? 0;
  return Math.round(Number(base) * 100) / 100;
}

/** O que a tela mostra da diferenca antes de gravar. A conta que vale e a do banco. */
export function diferencaDoReenvio(freteAnterior: number, freteNovo: number): { diferenca: number; recusada: boolean } {
  const centavos = Math.round(freteNovo * 100) - Math.round(freteAnterior * 100);
  return { diferenca: centavos / 100, recusada: centavos < 0 };
}

/** Veredito de `exp_reenvio_redespacho`, a mesma funcao do gatilho do redespacho. */
export interface VereditoRedespacho {
  aberto: boolean;
  bloqueia: boolean;
  situacao: string;
  mensagem: string | null;
  ciclo: number | null;
  freteDecidido: boolean;
  diferenca: number;
  exigeNota: boolean;
  notaNova: { tipo: string; numero: string | null } | null;
}

export function lerVereditoRedespacho(raw: unknown): VereditoRedespacho | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const nota = r.nota_nova && typeof r.nota_nova === "object" ? (r.nota_nova as Record<string, unknown>) : null;
  return {
    aberto: r.aberto === true,
    bloqueia: r.bloqueia === true,
    situacao: String(r.situacao ?? ""),
    mensagem: typeof r.mensagem === "string" ? r.mensagem : null,
    ciclo: numeroOuNulo(r.ciclo),
    freteDecidido: r.frete_decidido === true,
    diferenca: numeroOuNulo(r.diferenca) ?? 0,
    exigeNota: r.exige_nota === true,
    notaNova: nota ? { tipo: String(nota.tipo ?? ""), numero: nota.numero === null || nota.numero === undefined ? null : String(nota.numero) } : null
  };
}

/** Um ciclo como `exp_reenvio_situacao` devolve (aba Pagamentos). */
export interface SituacaoCicloReenvio {
  ciclo: number;
  chave: string;
  freteAnterior: number | null;
  freteNovo: number | null;
  diferenca: number;
  abono: number | null;
  abonadoPor: string | null;
  pago: number;
  pendente: number;
  cobrancaViva: { id: string; idPagamento: string | null; status: string; valor: number; idEmpresa: number | null; temPix: boolean } | null;
}

export function lerSituacaoDoReenvio(raw: unknown): SituacaoCicloReenvio[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const r = (item ?? {}) as Record<string, unknown>;
    const viva = r.cobranca_viva && typeof r.cobranca_viva === "object" ? (r.cobranca_viva as Record<string, unknown>) : null;
    return {
      ciclo: Number(r.ciclo),
      chave: String(r.chave ?? ""),
      freteAnterior: numeroOuNulo(r.frete_anterior),
      freteNovo: numeroOuNulo(r.frete_novo),
      diferenca: numeroOuNulo(r.diferenca) ?? 0,
      abono: numeroOuNulo(r.abono),
      abonadoPor: typeof r.abonado_por === "string" ? r.abonado_por : null,
      pago: numeroOuNulo(r.pago) ?? 0,
      pendente: numeroOuNulo(r.pendente) ?? 0,
      cobrancaViva: viva
        ? {
            id: String(viva.id),
            idPagamento: viva.id_pagamento ? String(viva.id_pagamento) : null,
            status: String(viva.status ?? ""),
            valor: numeroOuNulo(viva.valor) ?? 0,
            idEmpresa: numeroOuNulo(viva.id_empresa),
            temPix: viva.pix_copia_cola === true
          }
        : null
    };
  });
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

/** Erro cru da RPC ("EXP_REENVIO_FRETE: ...", "EXP_REDESPACHO_...: ...", "PERM: ...") -> so o texto. */
export function textoDoErroDeReenvio(mensagem: string): string {
  const semCodigo = mensagem.replace(/^EXP_RE(ENVIO|DESPACHO)_[A-Z_]+:\s*/, "");
  if (/^PERM:/.test(semCodigo)) return "Você não tem a permissão de reenviar pedido (expedicao.reenvio).";
  return semCodigo;
}
