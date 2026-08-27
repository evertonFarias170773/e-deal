import type { StatusTone } from "@/lib/types";
import type { Cobranca, EmpresaRecebedoraOption, LiberacaoPedidoStatus } from "@/features/cobrancas/types";
import { formatCurrencyWithoutPrefix } from "@/lib/formatters/currency";
import { formatDate } from "@/lib/formatters/date";

export const EMPRESAS_RECEBEDORAS_FIXAS: EmpresaRecebedoraOption[] = [
  {
    id: 1,
    nome: "IDEAL GRÁFICA EXPRESSA EIRELI",
    labelCurta: "Ideal Gráfica",
    documento: "",
    fluxoFuturo: "",
    descricao: ""
  },
  {
    id: 2,
    nome: "IDEAL BIRÔ SERV. GRAFICOS",
    labelCurta: "Ideal Birô",
    documento: "",
    fluxoFuturo: "",
    descricao: ""
  },
  {
    id: 3,
    nome: "E3 BRINDES LTDA",
    labelCurta: "E3 Brindes",
    documento: "",
    fluxoFuturo: "",
    descricao: ""
  }
];

export function getEmpresaRecebedoraFixaById(idEmpresa: number) {
  return EMPRESAS_RECEBEDORAS_FIXAS.find((item) => item.id === idEmpresa);
}

/**
 * Converte o campo textual `propostas.empresa` no id numérico usado em
 * `pagamentos_v2.id_empresa` e `propostas_pendencias.id_empresa`.
 *
 * Segue a mesma lógica de resolução já usada em:
 *   - getEmpresaGrupoKey()
 *   - getEmpresaExibicao()
 *   - orcamentos/mappers.ts → getEmpresaLabel()
 *
 * Retorna `null` se não for possível determinar com segurança.
 */
export function resolveEmpresaIdFromTexto(empresaRaw: string | null | undefined): number | null {
  if (!empresaRaw) return null;

  const texto = normalize(empresaRaw.trim());

  // 1. Valor numérico puro (ex: "1", "2", "3")
  const parsed = Number(empresaRaw.trim());
  if (!isNaN(parsed) && parsed > 0 && Number.isInteger(parsed)) {
    // Só aceita se for uma empresa conhecida ou plausível
    if (EMPRESAS_RECEBEDORAS_FIXAS.some(e => e.id === parsed)) {
      return parsed;
    }
    return parsed; // empresa futura — aceitar valor inteiro positivo
  }

  // 2. Match por texto normalizado (mesma lógica de getEmpresaGrupoKey)
  if (texto.includes("ideal grafica") || texto.includes("ingresso ideal")) {
    return 1;
  }
  if (texto.includes("ideal biro") || texto.includes("biro grafica")) {
    return 2;
  }
  if (texto.includes("e3")) {
    return 3;
  }

  return null;
}

export function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function toText(value: unknown) {
  return value === null || value === undefined ? "" : String(value);
}

function titleCase(value: string) {
  return value
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function getNumeroCobranca(cobranca: Pick<Cobranca, "id_pagamento" | "id_int" | "id">) {
  return cobranca.id_pagamento || String(cobranca.id_int || cobranca.id);
}

export function getDataReferenciaCobranca(
  cobranca: Pick<Cobranca, "paid_at" | "created_at" | "data_confirmacao">
) {
  return cobranca.data_confirmacao || cobranca.paid_at || cobranca.created_at;
}

export function getDataReferenciaFaturamento(cobranca: Pick<Cobranca, "paid_at" | "data_confirmacao">) {
  return cobranca.paid_at || cobranca.data_confirmacao || "";
}

export function isPendenteAprovacao(
  cobranca: Pick<
    Cobranca,
    | "tipo_cobranca"
    | "confirmado"
    | "status"
    | "cliente_restricao"
    | "cliente_limite_credito"
    | "cliente_credito"
    | "valor"
    | "confirmado_por"
  >
) {
  const tipoNormalizado = (cobranca.tipo_cobranca || "").trim().toUpperCase().replace(/_/g, "-");
  const isEFaturado = tipoNormalizado.startsWith("E-") || tipoNormalizado === "EFATURADO" || tipoNormalizado === "FATURADO";
  const statusUpper = (cobranca.status || "").trim().toUpperCase();

  if (!isEFaturado) return false;
  if (cobranca.confirmado === true) return false;
  if (statusUpper === "CANCELADO" || statusUpper === "PAID") return false;

  // Se for A_VENCER, verificamos se foi explicitamente autorizado/liberado (manual ou via limite)
  if (statusUpper === "A_VENCER") {
    const isManuallyAuthorized = Boolean(cobranca.confirmado_por);

    if (isManuallyAuthorized) {
      return false; // Autorizado (automaticamente ou manualmente) -> NÃO é pendente financeiro
    }
  }

  return true; // Todos os outros casos (como A_RECEBER, ou A_VENCER sem autorização explícita) são pendentes
}



export function getDataHoraListaCobranca(cobranca: Pick<Cobranca, "status" | "paid_at" | "created_at">) {
  if (cobranca.status === "PAID" && cobranca.paid_at) {
    return cobranca.paid_at;
  }

  return cobranca.created_at || cobranca.paid_at;
}

export function getConferenciaStatusLabel(
  cobranca: Pick<Cobranca, "status" | "confirmado" | "tipo_cobranca" | "cliente_restricao" | "cliente_limite_credito" | "cliente_credito" | "valor">
) {
  const statusUpper = (cobranca.status || "").trim().toUpperCase();

  if (statusUpper === "CANCELADO") {
    return "Cancelado";
  }

  if (isPendenteAprovacao(cobranca)) {
    return "Aguardando financeiro";
  }

  // Regra definitiva: status PAID/A_VENCER indica condição financeira. confirmado=false indica aguardando conferência humana. confirmado=true indica liberado para produção.
  if ((statusUpper === "PAID" || statusUpper === "A_VENCER") && cobranca.confirmado) {
    return "Liberado";
  }

  if (statusUpper === "PAID" && !cobranca.confirmado) {
    return "Pago / A liberar";
  }

  if (statusUpper === "A_VENCER" && !cobranca.confirmado) {
    return "Faturamento autorizado / A liberar";
  }

  if (statusUpper === "A_RECEBER") {
    return "A receber";
  }

  return "A receber";
}

export function getConferenciaStatusTone(
  cobranca: Pick<Cobranca, "status" | "confirmado" | "tipo_cobranca" | "cliente_restricao" | "cliente_limite_credito" | "cliente_credito" | "valor">
) {
  const statusUpper = (cobranca.status || "").trim().toUpperCase();

  if (statusUpper === "CANCELADO") {
    return "neutral";
  }

  if (isPendenteAprovacao(cobranca)) {
    return "warning";
  }

  if ((statusUpper === "PAID" || statusUpper === "A_VENCER") && cobranca.confirmado) {
    return "success";
  }

  if (statusUpper === "PAID" && !cobranca.confirmado) {
    return "info";
  }

  if (statusUpper === "A_VENCER" && !cobranca.confirmado) {
    return "info";
  }

  return "info";
}

export function getLocalDateKey(value: string | Date) {
  const text = typeof value === "string" ? value.trim() : "";
  if (text && text.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(text)) {
    return text.slice(0, 10);
  }

  const dateObj = typeof value === "string" ? new Date(value) : value;
  if (dateObj instanceof Date && !isNaN(dateObj.getTime())) {
    return dateObj.toISOString().slice(0, 10);
  }

  return "";
}

export function getLocalMonthKey(value: string | Date) {
  const dateKey = getLocalDateKey(value);
  return dateKey ? dateKey.slice(0, 7) : "";
}

export function getEmpresaExibicao(cobranca: Pick<Cobranca, "empresa" | "id_empresa">) {
  const empresaId = Number(cobranca.id_empresa);
  const empresaTextoRaw = cobranca.empresa?.trim() || "";

  if (empresaTextoRaw === "Definir empresa" || empresaTextoRaw === "1" || !empresaTextoRaw) {
    if (empresaId === 1) return "IDEAL GRÁFICA EXPRESSA EIRELI";
    if (empresaId === 2) return "IDEAL BIRÔ SERV. GRAFICOS";
    if (empresaId === 3) return "E3 BRINDES LTDA";
  }

  if (empresaId === 1) {
    return "Ideal Gráfica";
  }
  if (empresaId === 2) {
    return "Ideal Birô";
  }
  if (empresaId === 3) {
    return "E3 Brindes";
  }

  const empresaTexto = normalize(toText(cobranca.empresa));

  if (empresaTexto.includes("ideal grafica") || empresaTexto.includes("ingresso ideal")) {
    return "Ideal Gráfica";
  }

  if (empresaTexto.includes("ideal biro") || empresaTexto.includes("ideal birô") || empresaTexto.includes("biro grafica")) {
    return "Ideal Birô";
  }

  if (empresaTexto.includes("e3")) {
    return "E3 Brindes";
  }

  return cobranca.empresa?.trim() || (empresaId ? `Empresa ${empresaId}` : "Empresa não informada");
}

export function getEmpresaGrupoKey(cobranca: Pick<Cobranca, "empresa" | "id_empresa">) {
  const empresaId = Number(cobranca.id_empresa);

  if (empresaId === 1) {
    return "IDEAL_GRAFICA";
  }
  if (empresaId === 2) {
    return "IDEAL_BIRO";
  }
  if (empresaId === 3) {
    return "E3_BRINDES";
  }

  const empresaTexto = normalize(toText(cobranca.empresa));

  if (empresaTexto.includes("ideal grafica") || empresaTexto.includes("ingresso ideal")) {
    return "IDEAL_GRAFICA";
  }

  if (empresaTexto.includes("ideal biro") || empresaTexto.includes("ideal birô") || empresaTexto.includes("biro grafica")) {
    return "IDEAL_BIRO";
  }

  if (empresaTexto.includes("e3")) {
    return "E3_BRINDES";
  }

  return empresaTexto || String(empresaId || "SEM_EMPRESA");
}

export function getLocalDateInSaoPaulo(value: string | Date | null | undefined): string {
  if (!value) return "";
  try {
    const dateObj = typeof value === "string" ? new Date(value) : value;
    if (dateObj instanceof Date && !isNaN(dateObj.getTime())) {
      return dateObj.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
    }
  } catch (e) {
    console.error("Erro ao converter data para fuso SP:", e);
  }
  return "";
}

const NOMES_MES_PT_BR = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"
];

/**
 * Formata uma data como "mês/ano" por extenso em PT-BR, minúsculo (ex.:
 * "agosto/2026") — usado na confirmação de cancelamento de cobrança paga
 * quando a confirmação caiu em mês já fechado (ver isConfirmacaoDeMesAnterior
 * em cancelamento-pago.ts). Passa pelo fuso de São Paulo, igual ao resto da
 * tela, antes de extrair o mês.
 */
export function formatMesAnoPtBr(value: string | Date | null | undefined): string {
  const monthKey = getLocalMonthKey(getLocalDateInSaoPaulo(value));
  if (!monthKey) return "";
  const [ano, mes] = monthKey.split("-");
  const nomeMes = NOMES_MES_PT_BR[Number(mes) - 1];
  return nomeMes ? `${nomeMes}/${ano}` : "";
}

export function cobrancaMatchesSearch(cobranca: Cobranca, search: string) {
  const normalizedSearch = normalize(search.trim());

  if (!normalizedSearch) {
    return true;
  }

  return normalize(
    [
      cobranca.id_pagamento,
      cobranca.id_int,
      cobranca.id_cliente,
      cobranca.os_ideal,
      cobranca.cliente,
      cobranca.documento,
      cobranca.empresa,
      cobranca.tipo_cobranca,
      cobranca.status,
      cobranca.token_publico,
      cobranca.url_cobranca
    ]
      .map((value) => toText(value))
      .join(" ")
  ).includes(normalizedSearch);
}

export function normalizeCobrancaStatus(params: {
  status: string;
  vencimento?: string;
  paidAt?: string;
  confirmado?: boolean;
}): Cobranca["status"] {
  const status = normalize(params.status.trim());

  if (!status) {
    return params.confirmado || Boolean(params.paidAt) ? "PAID" : "A_RECEBER";
  }

  if (status.includes("cancel")) {
    return "CANCELADO";
  }

  if (status === "paid" || status.includes("pago") || status.includes("confirm")) {
    return "PAID";
  }

  if (status === "a_vencer" || status.includes("venc")) {
    return "A_VENCER";
  }

  if (status === "a_receber" || status === "pending" || status === "pendente" || status.includes("aguard") || status.includes("process")) {
    return "A_RECEBER";
  }

  if (params.confirmado || Boolean(params.paidAt)) {
    return "PAID";
  }

  return "A_RECEBER";
}

export function getCobrancaStatusTone(status: string): StatusTone {
  if (status === "PAID" || status === "CONFIRMADO") return "success";
  if (status === "A_RECEBER" || status === "AGUARDANDO_PAGAMENTO" || status === "AGUARDANDO") return "info";
  if (status === "A_VENCER" || status === "PENDENTE" || status === "AGUARDANDO_CREDITO" || status === "PRONTA_PARA_LIBERACAO") return "warning";
  if (status === "CANCELADO") return "neutral";
  if (status === "VENCIDO" || status === "REJEITADA" || status === "ERRO" || status === "ERRO_AUTORIZACAO") return "danger";
  return "neutral";
}

export function isCobrancaVencida(cobranca: Pick<Cobranca, "status" | "vencimento">) {
  if (!cobranca.vencimento || cobranca.status === "PAID" || cobranca.status === "CANCELADO") {
    return false;
  }

  return new Date(cobranca.vencimento).getTime() < Date.now();
}

export function getCobrancaStatusDescription(cobranca: Cobranca) {
  if (cobranca.status === "PAID") return "Pagamento confirmado.";
  if (cobranca.status === "CANCELADO") return "Cobrança cancelada.";
  if (isCobrancaVencida(cobranca)) return "Cobrança vencida sem confirmação.";
  if (cobranca.status === "A_VENCER") return "Cobrança futura aprovada.";
  if (cobranca.status === "A_RECEBER") return "Cobrança aberta aguardando pagamento.";
  return "Cobrança importada e aguardando conferência.";
}

export function getTipoCobrancaLabel(tipo: string) {
  const normalized = tipo.trim().toUpperCase();

  if (!normalized) {
    return "Não informado";
  }

  if (normalized === "PIX") return "PIX";
  if (normalized === "BOLETO") return "Boleto";
  if (normalized === "CREDIT_CARD") return "Cartão de crédito";
  if (normalized === "CARD_PARCELADO") return "Cartão de crédito";
  if (normalized === "E-FATURADO") return "E-Faturado";
  if (normalized === "E-RETRABALHO") return "E-Retrabalho";
  if (normalized === "E-PERMUTA") return "E-Permuta";
  if (normalized === "E-AMOSTRA" || normalized === "E-AMOSTRAS") return "E-Amostra";
  if (normalized === "E-CREDITO") return "E-Crédito";

  return titleCase(
    normalized
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
  );
}

/**
 * Texto pronto para colar no sistema antigo (DetalhePedido.aspx) quando o
 * usuário abre a OS Ideal a partir da Conferência de pagamentos. Formato
 * definido pelo dono:
 *
 *   Proposta N° 20454 - Tipo: PIX - Valor: 327,90 - Data do pagamento 11/08/2026 - Empresa IDEAL GRÁFICA EXPRESSA EIRELI
 *
 * A empresa sai pela razão social (EMPRESAS_RECEBEDORAS_FIXAS) e não pelo rótulo
 * curto que a tela mostra na coluna Empresa. A data usa `paid_at`; quando a
 * cobrança ainda não tem pagamento registrado cai para a confirmação e depois
 * para a criação, para o campo nunca sair vazio no texto colado.
 */
export function montarTextoConferenciaOsIdeal(
  cobranca: Pick<
    Cobranca,
    "id_int" | "tipo_cobranca" | "valor" | "paid_at" | "data_confirmacao" | "created_at" | "empresa" | "id_empresa"
  >
): string {
  const empresa =
    getEmpresaRecebedoraFixaById(Number(cobranca.id_empresa))?.nome ||
    (cobranca.empresa || "").trim() ||
    "Nao informada";

  const dataPagamento = cobranca.paid_at || cobranca.data_confirmacao || cobranca.created_at;

  return [
    `Proposta N° ${cobranca.id_int}`,
    `Tipo: ${getTipoCobrancaLabel(cobranca.tipo_cobranca)}`,
    `Valor: ${formatCurrencyWithoutPrefix(cobranca.valor)}`,
    `Data do pagamento ${dataPagamento ? formatDate(dataPagamento) : "Nao informada"}`,
    `Empresa ${empresa}`
  ].join(" - ");
}

/**
 * PREDICADO CANÔNICO da família faturado — a modalidade em que o título é
 * artefato separado da cobrança (Registro de Recebíveis), com ação própria de
 * cancelamento.
 *
 * Consolidado aqui em 26/08/2026 (Etapa 12 do plano de refaturamento). Existiam
 * QUATRO definições divergentes espalhadas: `isCobrancaEFaturado` (só
 * `E-FATURADO`), a lista literal do filtro de banco em `pagamentos-v2.service`,
 * uma cópia local no núcleo do veredito e outra no coletor. Divergência aqui é
 * silenciosa: a cobrança some de uma lista e aparece em outra.
 *
 * NÃO confundir com `TIPOS_SEM_LINK_EXTERNO`, logo abaixo: aquele conjunto
 * responde outra pergunta ("tem checkout para abrir?") e inclui E-CREDITO e a
 * família de brindes. São propósitos diferentes e continuam separados.
 *
 * A comparação é sobre o valor normalizado (caixa, espaços e underscore),
 * nunca igualdade literal: o banco guarda "E-Faturado" (173) e "E-FATURADO"
 * (109), e uma grafia nova não pode furar a checagem em silêncio.
 */
const FAMILIA_FATURADO = new Set(["E-FATURADO", "EFATURADO", "FATURADO"]);

export function isFamiliaFaturado(tipo: string | null | undefined): boolean {
  return FAMILIA_FATURADO.has(String(tipo || "").trim().toUpperCase().replace(/_/g, "-"));
}

/**
 * Grafias da família faturado como estão gravadas em `pagamentos_v2`, para uso
 * em filtro de banco (`.in(...)`), onde não dá para rodar predicado.
 *
 * Mantido ao lado de `isFamiliaFaturado` de propósito: mexer numa lista sem
 * mexer na outra foi o que produziu as definições divergentes.
 */
export const FAMILIA_FATURADO_TIPOS = ["E-FATURADO", "E-Faturado", "EFATURADO", "FATURADO"] as const;

/**
 * Identifica cobrança E-Faturado.
 *
 * @deprecated Use `isFamiliaFaturado`. Mantido porque é o nome usado no
 * destaque de linha da Conferência; delega para o predicado canônico. A
 * diferença prática é nula: o banco só tem "E-Faturado" e "E-FATURADO".
 */
export function isCobrancaEFaturado(tipo: string | null | undefined) {
  return isFamiliaFaturado(tipo);
}

export function isPagamentoAprovado(cobranca: Cobranca) {
  return cobranca.status === "PAID" || (cobranca.status === "A_VENCER" && cobranca.confirmado);
}

/**
 * Retorna true se a cobrança é do tipo E-CREDITO (uso de crédito do cliente como pagamento).
 *
 * Regra de faturamento:
 * - E-CREDITO como PAGAMENTO → ENTRA no faturamento (compõe a receita da venda)
 * - Geração de crédito → vai APENAS para movimento_credito, nunca para pagamentos_v2
 *
 * A função é usada para garantir que o E-CREDITO:
 *   1. Apareça apenas quando o cliente tiver saldo disponível
 *   2. Seja contabilizado corretamente no faturamento (sem dupla contagem)
 */
export function isCobrancaECredito(cobranca: Pick<Cobranca, "tipo_cobranca">): boolean {
  return (cobranca.tipo_cobranca || "").trim().toUpperCase() === "E-CREDITO";
}

/**
 * Modalidades que NÃO têm link de pagamento externo — não há checkout a abrir
 * nem link a copiar.
 *
 * E-CREDITO é abatimento de saldo em conta corrente; a família faturado é
 * cobrança contra o cliente, sem página de pagamento. Que exista uma
 * `url_cobranca` gravada não muda isso: o fluxo do crédito estampa um token
 * público na própria linha (`usar-credito`), e essa URL serve de identificador,
 * não de checkout.
 *
 * Grafias mistas ("E-Faturado") e underscore ("CARD_PARCELADO") são
 * normalizadas antes da comparação — o banco tem as duas formas.
 */
const TIPOS_SEM_LINK_EXTERNO = new Set([
  "E-CREDITO",
  "E-FATURADO",
  "FATURADO",
  "E-RETRABALHO",
  "E-PERMUTA",
  "E-AMOSTRA",
  "E-AMOSTRAS"
]);

/**
 * A cobrança tem link de pagamento externo (checkout, página pública) que faça
 * sentido abrir ou copiar?
 *
 * Ponto único da regra: ela estava escrita três vezes com três conteúdos
 * diferentes — no formulário (que já cobria a família faturado inteira), na
 * lista e no detalhe (que cobriam só E-FATURADO). E-CREDITO não estava em
 * nenhuma das duas últimas e por isso oferecia "Abrir checkout" para um
 * abatimento de saldo.
 */
export function cobrancaTemLinkExterno(cobranca: Pick<Cobranca, "tipo_cobranca">): boolean {
  const tipo = (cobranca.tipo_cobranca || "").trim().toUpperCase().replace(/_/g, "-");
  return !TIPOS_SEM_LINK_EXTERNO.has(tipo);
}

/** Edge Function que serve a página pública de pagamento, por `token_publico`. */
const BASE_PAGAMENTO_PUBLICO = "https://pay.ai-ideal.com.br/functions/v1/pagamento-publico";

/**
 * URL pública da cobrança — a que vai para `pagamentos_v2.url_cobranca` e chega
 * ao cliente.
 *
 * Devolve `null` quando não há página a abrir, e nesses casos a coluna fica
 * NULA. São dois motivos distintos:
 *
 *   - tipo sem checkout (E-CREDITO e a família faturado, por
 *     `cobrancaTemLinkExterno`): não existe página de pagamento para abatimento
 *     de saldo nem para cobrança faturada. Gravar um identificador aqui foi
 *     justamente o que fez a tela oferecer "abrir checkout" para E-Crédito;
 *   - sem `token_publico`: sem ele a Edge Function não tem por onde achar a
 *     cobrança, e a URL abriria em erro.
 *
 * O formato ANTERIOR era `https://pay.ai-ideal.com.br/i/{token}`, que nunca
 * existiu: `/i/` é a abreviação VISUAL de `renderShortUrl` (CobrancaDetail), que
 * em algum momento foi copiada para dentro dos writers. O cliente recebia um
 * link que não abria. As 2.207 linhas gravadas assim não são corrigidas aqui.
 *
 * O domínio é o mesmo de antes, então `PREFIXO_URL_INTERNA` — a sentinela que
 * separa cobrança interna de checkout de provedor no Cartão Asaas — continua
 * valendo sem alteração.
 */
export function montarUrlPublicaCobranca(params: {
  tipoCobranca: string | null | undefined;
  tokenPublico: string | null | undefined;
}): string | null {
  const token = String(params.tokenPublico ?? "").trim();
  if (!token) return null;

  const temLink = cobrancaTemLinkExterno({
    tipo_cobranca: String(params.tipoCobranca ?? "").trim() as Cobranca["tipo_cobranca"]
  });
  if (!temLink) return null;

  return `${BASE_PAGAMENTO_PUBLICO}?token=${encodeURIComponent(token)}`;
}

/**
 * Empresa recebedora correspondente a um texto de empresa, ou null quando não dá
 * para afirmar.
 *
 * Reaproveita `resolveEmpresaIdFromTexto`, que já é a normalização canônica do
 * módulo e reconhece as DUAS formas em uso no banco: a curta ("Ideal Biro") e a
 * razão social ("IDEAL BIRÔ SERV. GRAFICOS"). O casamento exato contra a lista
 * fixa, que existia antes, só acertava a forma curta — e a razão social é a
 * maioria absoluta dos registros.
 */
export function empresaRecebedoraPorTexto(
  texto: string | null | undefined
): EmpresaRecebedoraOption | null {
  const bruto = (texto ?? "").trim();
  if (!bruto) return null;
  // Placeholder do cadastro, não uma empresa: não é falha de reconhecimento.
  if (normalize(bruto) === "nao informado") return null;

  const id = resolveEmpresaIdFromTexto(bruto);
  if (id === null) return null;
  return EMPRESAS_RECEBEDORAS_FIXAS.find((item) => item.id === id) ?? null;
}

/**
 * Empresa recebedora sugerida para uma cobrança nova.
 *
 * PRECEDÊNCIA, e o motivo dela:
 *   1. `propostas.empresa` — a empresa ESCOLHIDA na aba Geral da proposta. É a
 *      decisão comercial já tomada para esta venda, e é ela que manda.
 *   2. `clientes.empresa_padrao` — só quando a proposta não diz nada. É a
 *      preferência histórica do cliente, não a decisão desta venda.
 *   3. Ideal Gráfica, o default de sempre.
 *
 * A ordem estava invertida: o padrão do cliente resolvia e retornava antes de a
 * proposta ser consultada, então uma proposta da Birô abria o modal na Gráfica
 * sempre que o cliente tivesse padrão gravado. Sugestão apenas — quem cria a
 * cobrança continua livre para trocar no modal.
 */
export function resolverEmpresaRecebedora(
  empresaProposta: string | null | undefined,
  empresaPadraoCliente?: string | null
): EmpresaRecebedoraOption {
  const daProposta = empresaRecebedoraPorTexto(empresaProposta);
  if (daProposta) return daProposta;

  const doCliente = empresaRecebedoraPorTexto(empresaPadraoCliente);
  if (doCliente) return doCliente;

  // Cair no default é aceitável; cair nele em SILÊNCIO não era. Um texto que
  // existe e não foi reconhecido é vocabulário novo no banco, e precisa
  // aparecer em diagnóstico em vez de virar empresa 1 sem deixar rastro.
  const naoReconhecidos = [empresaProposta, empresaPadraoCliente]
    .map((texto) => (texto ?? "").trim())
    .filter((texto) => texto !== "" && normalize(texto) !== "nao informado");

  if (naoReconhecidos.length > 0) {
    console.error(
      "[cobrancas] Empresa recebedora não reconhecida; usando o default (id 1). Texto(s):",
      naoReconhecidos
    );
  }

  return EMPRESAS_RECEBEDORAS_FIXAS[0];
}

/**
 * Calcula o valor efetivamente pago e confirmado em uma lista de cobranças.
 * Utiliza o critério oficial de isPagamentoAprovado.
 * Ignora cobranças canceladas.
 */
export function calcularValorPagoConfirmado(cobrancas: Cobranca[]): number {
  return cobrancas
    .filter((c) => c.status !== "CANCELADO" && isPagamentoAprovado(c))
    .reduce((sum, c) => sum + (Number(c.valor) || 0), 0);
}

/**
 * Calcula a diferença financeira entre o novo total e o valor já pago.
 * Retorna:
 *   < 0  → crédito para o cliente (proposta ficou mais barata)
 *   > 0  → débito (proposta ficou mais cara)
 *   = 0  → sem diferença financeira
 */
export function calcularDiferencaFinanceira(
  novoTotal: number,
  valorPagoConfirmado: number
): number {
  return Math.round((novoTotal - valorPagoConfirmado) * 100) / 100;
}

export function isCreditoPendente(cobranca: Cobranca) {
  const tipoUpper = (cobranca.tipo_cobranca || "").trim().toUpperCase();
  return (
    tipoUpper.startsWith("E-") &&
    Boolean(cobranca.creditoPendente || cobranca.creditoAnalise?.statusAnalise === "AGUARDANDO_FINANCEIRO")
  );
}

export function isPropostaLiberadaParaPedido(cobrancas: Cobranca[]) {
  const validas = cobrancas.filter((item) => item.status !== "CANCELADO");

  if (!validas.length) {
    return false;
  }

  return validas.every(isPagamentoAprovado) && validas.every((item) => item.pedidoLiberadoMock);
}

export function getLiberacaoPedidoStatus(cobrancas: Cobranca[]): LiberacaoPedidoStatus {
  const validas = cobrancas.filter((item) => item.status !== "CANCELADO");

  if (!validas.length) {
    return "AGUARDANDO_PAGAMENTO";
  }

  const hasCreditoPendente = validas.some(isCreditoPendente);
  const aprovadas = validas.filter(isPagamentoAprovado);

  if (hasCreditoPendente) {
    return "AGUARDANDO_CREDITO";
  }

  if (isPropostaLiberadaParaPedido(validas)) {
    return "LIBERADA_PARA_PEDIDO";
  }

  if (validas.every(isPagamentoAprovado)) {
    return "PRONTA_PARA_LIBERACAO";
  }

  if (aprovadas.length === 0) {
    return "AGUARDANDO_PAGAMENTO";
  }

  if (aprovadas.length < validas.length) {
    return "PARCIALMENTE_APROVADA";
  }

  return "AGUARDANDO_PAGAMENTO";
}

export function canLiberarParaPedido(cobrancas: Cobranca[]) {
  const validas = cobrancas.filter((item) => item.status !== "CANCELADO");

  if (!validas.length) {
    return false;
  }

  return validas.every(isPagamentoAprovado) && !validas.some(isCreditoPendente);
}

export function getLiberacaoPedidoLabel(status: LiberacaoPedidoStatus) {
  if (status === "LIBERADA_PARA_PEDIDO") return "Liberada para pedido";
  if (status === "PRONTA_PARA_LIBERACAO") return "Pronta para liberar";
  if (status === "AGUARDANDO_CREDITO") return "Aguardando análise de crédito";
  if (status === "PARCIALMENTE_APROVADA") return "Parcialmente paga";
  return "Aguardando pagamento";
}

export function getSituacaoFinanceiraPropostaLabel(cobrancas: Cobranca[]) {
  const validas = cobrancas.filter((item) => item.status !== "CANCELADO");

  if (validas.some(isCreditoPendente)) {
    return "Aguardando análise de crédito";
  }

  if (isPropostaLiberadaParaPedido(validas) || (validas.length > 0 && validas.every(isPagamentoAprovado))) {
    return "Liberada para pedido";
  }

  if (validas.some(isPagamentoAprovado)) {
    return "Parcialmente paga";
  }

  return "Aguardando pagamento";
}

export function getLiberacaoPedidoTone(status: LiberacaoPedidoStatus): StatusTone {
  if (status === "LIBERADA_PARA_PEDIDO") return "success";
  if (status === "PRONTA_PARA_LIBERACAO") return "info";
  if (status === "AGUARDANDO_CREDITO") return "warning";
  if (status === "PARCIALMENTE_APROVADA") return "special";
  return "info";
}

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
