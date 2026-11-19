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
import type { ModalidadeFrete, TipoFreteNormalizado } from "../types";
import { normalizarTipoFrete } from "./tipo-frete";
import { resolverTransportadoraParceira } from "@/features/orcamentos/lib/transportadoras-parceiras";
import { categoriaDoServico, type CategoriaFrete } from "@/features/orcamentos/lib/categoria-frete";

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
  /** Modo de cobranca (18/11/2026). Ausentes antes da migration 20261118c: DIFERENCA. */
  modo_cobranca?: string | null;
  valor_cobrar?: number | string | null;
  /** Envio do ciclo (19/11/2026): a opcao cotada, o endereco e o rastreio do envio que voltou. */
  opcao_frete?: { id?: string | null; servico?: string | null; transportadora?: string | null } | null;
  id_endereco_novo?: string | null;
  rastreio_anterior?: string | null;
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
    /** Como o frete do reenvio e cobrado e quanto (o que entra na trava de saldo). */
    modoCobranca: ModoCobrancaReenvio;
    valorCobrar: number;
    /** O envio do ciclo (19/11/2026): o que o redespacho tem de levar. */
    opcao: { servico: string | null; transportadora: string | null } | null;
    idEnderecoNovo: string | null;
    freteNovo: number | null;
    /** Rastreio do envio que voltou (copia em `envio_anterior`). */
    rastreioAnterior: string | null;
  } | null;
  /** Frete gravado pelo ultimo ciclo que gravou frete (base do proximo). */
  ultimoFrete: number | null;
}

function numeroOuNulo(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function textoOuNulo(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
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
        freteDecidido: ultimo.frete_origem === "COTACAO" || ultimo.frete_origem === "DIGITADO_ADM",
        modoCobranca: normalizarModoCobranca(ultimo.modo_cobranca),
        valorCobrar: numeroOuNulo(ultimo.valor_cobrar) ?? numeroOuNulo(ultimo.diferenca) ?? 0,
        opcao: ultimo.opcao_frete
          ? {
              servico: textoOuNulo(ultimo.opcao_frete.servico),
              transportadora: textoOuNulo(ultimo.opcao_frete.transportadora)
            }
          : null,
        idEnderecoNovo: textoOuNulo(ultimo.id_endereco_novo),
        freteNovo: numeroOuNulo(ultimo.frete_novo),
        rastreioAnterior: textoOuNulo(ultimo.rastreio_anterior)
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

// -----------------------------------------------------------------------------
// MODO DE COBRANCA DO FRETE DO REENVIO (18/11/2026)
// -----------------------------------------------------------------------------

/**
 * DIFERENCA: frete novo - anterior (menor e recusado). CHEIO: o frete novo
 * inteiro. SEM_COBRANCA: nada (so administrador, com motivo). O valor a cobrar
 * e coluna gerada no banco (`expedicao_reenvios.valor_cobrar`).
 */
export type ModoCobrancaReenvio = "DIFERENCA" | "CHEIO" | "SEM_COBRANCA";

export const MODOS_COBRANCA_REENVIO: ModoCobrancaReenvio[] = ["DIFERENCA", "CHEIO", "SEM_COBRANCA"];

/** Rotulo curto do modo, como o chat e a aba Fretes escrevem. */
export const ROTULO_MODO_COBRANCA: Record<ModoCobrancaReenvio, string> = {
  DIFERENCA: "diferença",
  CHEIO: "frete cheio",
  SEM_COBRANCA: "sem cobrança"
};

/** Titulo do quadro da aba Pagamentos para o modo. */
export function tituloDoFreteDoReenvio(modo: ModoCobrancaReenvio): string {
  if (modo === "CHEIO") return "Frete do reenvio (valor cheio)";
  if (modo === "SEM_COBRANCA") return "Reenvio sem cobrança";
  return "Diferença de frete do reenvio";
}

export function normalizarModoCobranca(v: unknown): ModoCobrancaReenvio {
  const s = String(v ?? "").trim().toUpperCase();
  return s === "CHEIO" || s === "SEM_COBRANCA" ? s : "DIFERENCA";
}

/**
 * O que a tela mostra do valor a cobrar antes de gravar (a conta que vale e a
 * coluna gerada no banco). `recusado`: frete menor no modo DIFERENCA.
 */
export function valorACobrarDoReenvio(
  modo: ModoCobrancaReenvio,
  freteAnterior: number,
  freteNovo: number
): { valor: number; diferenca: number; recusado: boolean } {
  const { diferenca, recusada } = diferencaDoReenvio(freteAnterior, freteNovo);
  if (modo === "CHEIO") return { valor: Math.round(freteNovo * 100) / 100, diferenca, recusado: false };
  if (modo === "SEM_COBRANCA") return { valor: 0, diferenca, recusado: false };
  return { valor: recusada ? 0 : diferenca, diferenca, recusado: recusada };
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
  modoCobranca: ModoCobrancaReenvio;
  valorCobrar: number;
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
    modoCobranca: normalizarModoCobranca(r.modo_cobranca),
    valorCobrar: numeroOuNulo(r.valor_cobrar) ?? numeroOuNulo(r.diferenca) ?? 0,
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
  /** Tipo de envio e transportadora do ciclo (a opcao cotada, quando houve). */
  tipoFreteNovo: string | null;
  transportadora: string | null;
  /** Informacao: frete novo - anterior (pode ser negativa fora do modo DIFERENCA). */
  diferenca: number;
  modoCobranca: ModoCobrancaReenvio;
  modoMotivo: string | null;
  modoDefinidoPor: string | null;
  /** O que se cobra do ciclo (pelo modo). */
  valorCobrar: number;
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
      tipoFreteNovo: typeof r.tipo_frete_novo === "string" ? r.tipo_frete_novo : null,
      transportadora: typeof r.transportadora === "string" && r.transportadora.trim() ? r.transportadora : null,
      diferenca: numeroOuNulo(r.diferenca) ?? 0,
      modoCobranca: normalizarModoCobranca(r.modo_cobranca),
      modoMotivo: typeof r.modo_motivo === "string" ? r.modo_motivo : null,
      modoDefinidoPor: typeof r.modo_definido_por === "string" ? r.modo_definido_por : null,
      valorCobrar: numeroOuNulo(r.valor_cobrar) ?? numeroOuNulo(r.diferenca) ?? 0,
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

// -----------------------------------------------------------------------------
// O ENVIO DO CICLO ABERTO (19/11/2026, caso #24552)
// -----------------------------------------------------------------------------

/**
 * Com reenvio aberto, quem diz como o pedido sai e o CICLO, nao `expedicoes`
 * (que guarda a data de despacho do envio que voltou) nem a proposta (que guarda
 * o frete da venda). O #24552 mostrava SEDEX no card e no Despachar depois de
 * reenviado pela Transportadora Sao Miguel.
 *
 * Tipo: o do ciclo. Transportadora: a da opcao cotada (sem opcao, a gravada).
 * Vinculo e categoria: a mesma traducao do orcamento
 * (`resolverTransportadoraParceira`, `categoriaDoServico`), sem regra nova; sem
 * parceira reconhecida, o que esta gravado.
 */
export function envioDoReenvioAberto(
  aberto: Pick<NonNullable<ReenvioDoPedido["aberto"]>, "tipoFreteNovo" | "opcao">,
  gravado: {
    modalidade: ModalidadeFrete | null | undefined;
    transportadoraNome: string | null | undefined;
    idTransportadoraCliente: number | null | undefined;
    categoriaFrete: CategoriaFrete | null | undefined;
  }
): {
  tipoFrete: TipoFreteNormalizado | null;
  transportadoraNome: string | null;
  idTransportadoraCliente: number | null;
  categoriaFrete: CategoriaFrete | null;
} {
  const tipoFrete = tipoDoCiclo(aberto.tipoFreteNovo);
  const opcao = aberto.opcao;
  const nomeDaOpcao = opcao?.transportadora ?? opcao?.servico ?? null;
  if (!nomeDaOpcao) {
    return {
      tipoFrete,
      transportadoraNome: gravado.transportadoraNome?.trim() || null,
      idTransportadoraCliente: gravado.idTransportadoraCliente ?? null,
      categoriaFrete: gravado.categoriaFrete ?? null
    };
  }
  const parceira = resolverTransportadoraParceira(opcao);
  const modalidade = gravado.modalidade === "CIF" || gravado.modalidade === "FOB" || gravado.modalidade === "RETIRA" ? gravado.modalidade : null;
  return {
    tipoFrete,
    transportadoraNome: nomeDaOpcao,
    idTransportadoraCliente: parceira ?? gravado.idTransportadoraCliente ?? null,
    categoriaFrete: categoriaDoServico(opcao?.transportadora, opcao?.servico, modalidade) ?? gravado.categoriaFrete ?? null
  };
}

/**
 * O tipo de envio gravado no ciclo (`tipo_frete_novo`), no vocabulario do
 * Despachar. NAO passa por `normalizarTipoFrete`, que classifica texto de
 * servico ("CORREIOS" puro la vira INDEFINIDO).
 */
export function tipoDoCiclo(v: string | null | undefined): "CORREIOS" | "MOTOBOY" | "TRANSPORTADORA" | null {
  const s = String(v ?? "").trim().toUpperCase();
  return s === "CORREIOS" || s === "MOTOBOY" || s === "TRANSPORTADORA" ? s : null;
}

/**
 * Rastreio com reenvio aberto: o do envio que voltou NAO vale (nem o gravado,
 * nem o espelho `propostas_os`). So um codigo diferente dele, informado depois
 * do reenvio.
 */
export function rastreioDoReenvioAberto(codigoGravado: string | null | undefined, rastreioAnterior: string | null | undefined): string {
  const codigo = String(codigoGravado ?? "").trim();
  if (!codigo) return "";
  return rastreioAnterior && codigo.toUpperCase() === rastreioAnterior.trim().toUpperCase() ? "" : codigo;
}

/**
 * O frete que o card e a lista mostram: com reenvio, o do ultimo ciclo que
 * gravou frete (o envio que sai ou saiu por ultimo); sem, o da proposta.
 * So exibicao: o frete da venda (total e NF) continua em `freteCobrado`.
 */
export function freteDoEnvioExibido(p: { reenvio?: ReenvioDoPedido | null; freteCobrado: number | null }): number | null {
  return p.reenvio?.ultimoFrete ?? p.freteCobrado;
}

/**
 * A prepostagem dos Correios e recusada com reenvio ABERTO de outro tipo
 * (19/11/2026). "Aberto" e a regra do banco (`exp_reenvio_redespacho`): data de
 * despacho nula ou nao posterior ao registro do ciclo. Devolve a mensagem da
 * recusa, ou null quando a prepostagem pode seguir.
 */
export function reenvioBloqueiaPrepostagem(
  ultimo: { ciclo: number | string; tipo_frete_novo: string | null; criado_em: string } | null | undefined,
  dataDespacho: string | null | undefined
): string | null {
  if (!ultimo) return null;
  const criado = Date.parse(ultimo.criado_em);
  const despacho = dataDespacho ? Date.parse(dataDespacho) : NaN;
  const aberto = !dataDespacho || (Number.isFinite(despacho) && Number.isFinite(criado) && despacho <= criado);
  if (!aberto) return null;
  if (tipoDoCiclo(ultimo.tipo_frete_novo) === "CORREIOS") return null;
  return `O reenvio ${ultimo.ciclo} deste pedido sai por ${ultimo.tipo_frete_novo ?? "outro tipo de envio"}, não pelos Correios. Nenhuma prepostagem foi criada.`;
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
