/**
 * O que a VISUALIZAÇÃO do pedido ("Detalhe da proposta") mostra — as regras de
 * exibição, cada uma num lugar só.
 *
 * POR QUE EXISTE (auditoria de 08/10/2026)
 *   A visualização lia campos errados ou fixos e contradizia a edição e o banco:
 *   frete da cotação num pedido FOB com Motoboy, "Pagamento: A combinar" (coluna
 *   que não existe), "Prazo de produção: 7 dias" fixo, tabela especial "-R$ 0,00".
 *
 * SÓ EXIBIÇÃO
 *   Nada aqui grava, e nada aqui muda a edição, a Expedição, a etiqueta, a OS,
 *   os PDFs ou a lista. As regras de frete REAPROVEITAM o que já existe
 *   (`LABEL_MODALIDADE`, `cifPorTransportadora`, `normalizarTipoFrete`) sem
 *   alterá-las.
 */
import { LABEL_MODALIDADE } from "@/features/orcamentos/lib/modalidade-frete";
import { cifPorTransportadora, normalizarTipoFrete } from "@/features/expedicao/lib/tipo-frete";
import type { ModalidadeFrete } from "@/features/expedicao/types";
import { estaNaFaseDeOrcamento } from "@/features/orcamentos/lib/modalidade-frete";
import {
  getLiberacaoPedidoLabel,
  getLiberacaoPedidoStatus,
  getTipoCobrancaLabel,
  isCreditoPendente
} from "@/features/cobrancas/cobrancas-utils";
import type { Cobranca } from "@/features/cobrancas/types";
import { humanizeStatus } from "@/lib/formatters/status";

/* ---------------------------------------------------------------------- frete */

export type CotacaoDaVisualizacao = { transportadora: string; servico: string; prazo: string };

export type EntradaDoFrete = {
  modalidade: ModalidadeFrete | null | undefined;
  /** `propostas.transporte_categoria`: RETIRA, MOTOBOY, CORREIOS, TRANSPORTADORA ou nulo. */
  transporteCategoria: string | null | undefined;
  idTransportadora: number | null | undefined;
  /** Nome do cadastro da transportadora vinculada; nulo se não lido ou sem vínculo. */
  nomeTransportadora: string | null | undefined;
  /** A cotação marcada como escolhida, ou nulo. */
  cotacaoEscolhida: CotacaoDaVisualizacao | null | undefined;
  despachoConfirmado: boolean;
  correiosIdPrepostagem?: string | null;
  prepostagemCanceladaEm?: string | null;
  /** Pedido complementar: o número do principal. */
  idIntPedidoPrincipal?: number | null;
  /**
   * O que a Expedição gravou no despacho CONFIRMADO (`expedicoes`). Depois do
   * despacho é ele que diz por onde o pedido foi — o predicado de CIF por
   * transportadora se desliga de propósito nesse ponto.
   */
  despacho?: { tipoFrete: string | null; transportadoraNome: string | null; modalidade: ModalidadeFrete | null } | null;
};

export type FreteDaVisualizacao = {
  /** O texto do cartão "Frete escolhido". */
  rotulo: string;
  /** O frete do pedido é a cotação escolhida? Só então ela leva o selo ESCOLHIDO. */
  usaCotacao: boolean;
  /** Aviso de "Fretes disponíveis" quando o frete real não é nenhuma cotação. */
  nota: string | null;
  /** "Prazo de entrega" do resumo: o da cotação só quando ela é o frete. */
  prazoDeEntrega: string;
};

export const SEM_PRAZO_DE_ENTREGA = "Não se aplica";

/**
 * O frete que o pedido TEM, como a aba Fretes da edição mostra:
 *   complementar        "Herdado do pedido #X: <modalidade>"
 *   RETIRA              "Retira no balcão"
 *   FOB                 "Cliente contrata: <transportadora ou Motoboy>"
 *   CIF + transportadora declarada (não Correios, sem prepostagem viva)
 *                       "Transportadora: <nome>"
 *   CIF + motoboy       "Motoboy"
 *   CIF sem nada, ou modalidade não declarada: a cotação escolhida, como sempre.
 *
 * DEPOIS DO DESPACHO CONFIRMADO vale o que a Expedição declarou (tipo de frete,
 * transportadora e modalidade do despacho), com os mesmos textos.
 */
export function freteDaVisualizacao(e: EntradaDoFrete): FreteDaVisualizacao {
  const cotacao = e.cotacaoEscolhida ?? null;
  const foraDaCotacao = (rotulo: string): FreteDaVisualizacao => ({
    rotulo,
    usaCotacao: false,
    nota: cotacao ? `Frete definido: ${rotulo}. As cotações abaixo não estão em uso.` : null,
    prazoDeEntrega: SEM_PRAZO_DE_ENTREGA
  });

  if (e.idIntPedidoPrincipal) {
    return foraDaCotacao(`Herdado do pedido #${e.idIntPedidoPrincipal}: ${e.modalidade ?? "modalidade não declarada"}`);
  }

  // Despacho confirmado: a declaração do expedidor é soberana.
  const despacho = e.despachoConfirmado ? e.despacho ?? null : null;
  const tipoDespachado = String(despacho?.tipoFrete ?? "").toUpperCase();
  const modalidade = despacho?.modalidade ?? e.modalidade;

  if (modalidade === "RETIRA" || tipoDespachado === "RETIRA_BALCAO") {
    // A cotação marcada já é a de retirada: ela É o frete, só com o texto da modalidade.
    if (cotacao && normalizarTipoFrete(cotacao.servico) === "RETIRA_BALCAO") {
      return { rotulo: LABEL_MODALIDADE.RETIRA, usaCotacao: true, nota: null, prazoDeEntrega: SEM_PRAZO_DE_ENTREGA };
    }
    return foraDaCotacao(LABEL_MODALIDADE.RETIRA);
  }

  const nome = String((despacho?.transportadoraNome || e.nomeTransportadora) ?? "").trim();
  const motoboy = tipoDespachado
    ? tipoDespachado === "MOTOBOY"
    : String(e.transporteCategoria ?? "").toUpperCase() === "MOTOBOY";

  if (modalidade === "FOB") {
    return foraDaCotacao(`Cliente contrata: ${motoboy ? "Motoboy" : nome || "transportadora a definir"}`);
  }

  // Cotação que já É de motoboy continua sendo o frete (com o valor dela).
  const tipoCotado = normalizarTipoFrete(cotacao?.servico ?? "");
  const motoboyForaDaCotacao = motoboy && tipoCotado !== "MOTOBOY";

  if (modalidade === "CIF" && tipoDespachado) {
    if (tipoDespachado === "TRANSPORTADORA" && nome) return foraDaCotacao(`Transportadora: ${nome}`);
    if (motoboyForaDaCotacao) return foraDaCotacao("Motoboy");
  } else if (modalidade === "CIF") {
    const porTransportadora = cifPorTransportadora({
      modalidade: "CIF",
      despachoConfirmado: e.despachoConfirmado,
      idTransportadora: e.idTransportadora,
      nomeTransportadora: nome || null,
      tipoFreteCotado: tipoCotado,
      correiosIdPrepostagem: e.correiosIdPrepostagem,
      prepostagemCanceladaEm: e.prepostagemCanceladaEm
    });
    if (porTransportadora) return foraDaCotacao(`Transportadora: ${nome}`);
    if (motoboyForaDaCotacao) return foraDaCotacao("Motoboy");
  }

  if (!cotacao) return { rotulo: "Frete não definido", usaCotacao: false, nota: null, prazoDeEntrega: SEM_PRAZO_DE_ENTREGA };
  const prazo = String(cotacao.prazo ?? "").trim();
  return {
    rotulo: prazo ? `${cotacao.transportadora} - ${prazo}` : cotacao.transportadora,
    usaCotacao: true,
    nota: null,
    prazoDeEntrega: prazo || SEM_PRAZO_DE_ENTREGA
  };
}

/* ------------------------------------------------------------ prazo de produção */

type ItemComPrazo = {
  statusItem?: string | null;
  prazo?: string | null;
  produto?: { prazo_dias_uteis?: number | string | null } | null;
};

/** Dias úteis de um item: o número do cadastro; sem ele, o número escrito no texto ("3 dias úteis"). */
function diasUteisDoItem(item: ItemComPrazo): number | null {
  const doCadastro = Number(item.produto?.prazo_dias_uteis);
  if (Number.isFinite(doCadastro) && doCadastro > 0) return Math.trunc(doCadastro);
  const texto = String(item.prazo ?? "");
  const achado = /(\d+)\s*dias?\s*[uú]te?i/i.exec(texto);
  return achado ? Number(achado[1]) : null;
}

/** "Prazo de produção" do resumo: o MAIOR prazo, em dias úteis, entre os itens ativos. */
export function prazoDeProducao(itens: readonly ItemComPrazo[]): string {
  const dias = itens
    .filter((item) => String(item.statusItem ?? "").toUpperCase() !== "CANCELADO")
    .map(diasUteisDoItem)
    .filter((n): n is number => n !== null);
  if (dias.length === 0) return "Não definido";
  const maior = Math.max(...dias);
  return `${maior} ${maior === 1 ? "dia útil" : "dias úteis"}`;
}

/* ------------------------------------------------------------- tabela especial */

type ItemComValores = { statusItem?: string | null; subtotalBruto: number; acrescimoBonus: number; subtotal: number };

export type ValoresDaTabelaEspecial =
  /** Sem tabela especial neste pedido: as linhas não aparecem. */
  | { mostrar: false; motivo: "SEM_TABELA" | "NAO_DERIVAVEL" }
  | { mostrar: true; bruto: number; desconto: number; liquido: number };

const centavos = (valor: number) => Math.round((Number(valor) || 0) * 100);

/**
 * Subtotal bruto, desconto da tabela especial e líquido.
 *
 * O desconto NÃO é gravado: o gatilho do banco sobrescreve o subtotal do item
 * pelo bruto, e o desconto só sobrevive dentro de `valor_total`. Mas o
 * carregamento da proposta já recalcula cada item com o bônus gravado
 * (`calculateItemSubtotal`, o mesmo cálculo da edição) — então as três somas
 * saem dos ITENS. Confere com o subtotal do resumo; se não fechar no centavo,
 * não mostra nada: melhor esconder do que exibir "-R$ 0,00".
 */
export function valoresDaTabelaEspecial(
  itens: readonly ItemComValores[],
  subtotalProdutosDoResumo: number,
  bonusPercent: number
): ValoresDaTabelaEspecial {
  if (!(Number(bonusPercent) > 0)) return { mostrar: false, motivo: "SEM_TABELA" };
  const ativos = itens.filter((item) => String(item.statusItem ?? "").toUpperCase() !== "CANCELADO");
  const bruto = ativos.reduce((t, i) => t + (Number(i.subtotalBruto) || 0), 0);
  const desconto = ativos.reduce((t, i) => t + (Number(i.acrescimoBonus) || 0), 0);
  const liquido = ativos.reduce((t, i) => t + (Number(i.subtotal) || 0), 0);
  const fecha =
    centavos(desconto) > 0 &&
    Math.abs(centavos(bruto) - centavos(desconto) - centavos(liquido)) <= 1 &&
    Math.abs(centavos(liquido) - centavos(subtotalProdutosDoResumo)) <= 1;
  if (!fecha) return { mostrar: false, motivo: "NAO_DERIVAVEL" };
  return { mostrar: true, bruto, desconto, liquido };
}

/* ------------------------------------------------------------------- pagamento */

const ativa = (c: Pick<Cobranca, "status">) => c.status !== "CANCELADO";

/** O estado de UMA cobrança — a mesma regra da coluna de confirmação da aba Pagamentos. */
export function estadoDaCobranca(cobranca: Cobranca): string {
  if (cobranca.status === "CANCELADO") return humanizeStatus("CANCELADO");
  if (cobranca.confirmado) return humanizeStatus("CONFIRMADO");
  if (isCreditoPendente(cobranca)) return humanizeStatus("AGUARDANDO_CREDITO");
  if (cobranca.status === "A_VENCER") return humanizeStatus("A_VENCER");
  if (cobranca.status === "PAID") return humanizeStatus("PAGO_A_LIBERAR");
  return humanizeStatus("NAO_CONFIRMADO");
}

/** "Pagamento" do cartão Total final: forma e estado das cobranças ATIVAS. */
export function pagamentoDaVisualizacao(cobrancas: readonly Cobranca[]): string {
  const ativas = cobrancas.filter(ativa);
  if (ativas.length === 0) return "Sem cobrança";
  const partes = ativas.map((c) => `${getTipoCobrancaLabel(String(c.tipo_cobranca ?? ""))} (${estadoDaCobranca(c)})`);
  return [...new Set(partes)].join(" + ");
}

/** O pedido já passou da liberação? NOVO, AGUARDANDO e APROVADO ainda não. */
export function pedidoJaLiberado(statusInterno: string | null | undefined): boolean {
  if (estaNaFaseDeOrcamento(statusInterno)) return false;
  const base = String(statusInterno ?? "").split("/")[0].trim().toUpperCase();
  return base !== "APROVADO" && base !== "CANCELADO";
}

/**
 * A situação do cartão "Cobranças".
 * Antes da liberação: o rótulo de liberação de sempre ("Pronta para liberar",
 * "Aguardando pagamento"...). Depois dela esse rótulo não faz sentido — o pedido
 * já foi liberado —, e o cartão passa a dizer o estado real das cobranças.
 */
export function situacaoDasCobrancas(cobrancas: readonly Cobranca[], statusInterno: string | null | undefined): string {
  if (!pedidoJaLiberado(statusInterno)) return getLiberacaoPedidoLabel(getLiberacaoPedidoStatus([...cobrancas]));
  const estados = [...new Set(cobrancas.filter(ativa).map(estadoDaCobranca))];
  return estados.join(" + ") || "Sem cobrança";
}

/* --------------------------------------------------------------------- contato */

export const MARCADOR_SEM_CONTATO = "(sem contato registrado)";

/**
 * O contato do cartão "Contato responsável".
 * O cadastro tem contatos cujo NOME é o marcador "(sem contato registrado)",
 * com telefone e e-mail de verdade: a tela dizia "sem contato" e mostrava os
 * dados logo abaixo. O cadastro não é alterado — só o texto.
 */
export function contatoDaVisualizacao(contato: { nome?: string | null; whatsapp?: string | null; email?: string | null } | null | undefined): {
  nome: string;
  detalhe: string;
} {
  const nome = String(contato?.nome ?? "").trim();
  const dados = [contato?.whatsapp, contato?.email].map((v) => String(v ?? "").trim()).filter(Boolean);
  const semNome = !nome || nome === MARCADOR_SEM_CONTATO;
  if (semNome) return { nome: dados.length ? "Contato sem nome cadastrado" : "Sem contato cadastrado", detalhe: dados.join(" - ") };
  return { nome, detalhe: dados.join(" - ") };
}

/* ------------------------------------------------------------------ acompanhar */

/**
 * A linha "Acompanha: #A, #B" da visualizacao: so leitura, sem acionar nada.
 * `ids` sao os OUTROS pedidos do grupo Acompanhar (sem o proprio). Sem grupo, nao ha linha.
 */
export function linhaAcompanha(ids: readonly number[] | null | undefined): string | null {
  const lista = Array.from(new Set((ids ?? []).filter((i) => Number.isInteger(i) && i > 0)));
  return lista.length > 0 ? `Acompanha: ${lista.map((i) => `#${i}`).join(", ")}` : null;
}
