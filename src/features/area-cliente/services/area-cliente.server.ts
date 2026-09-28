import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { gerarPixBancoInter } from "@/features/cobrancas/services/banco-inter.service";
import { calcularSituacaoQuitacaoProposta } from "@/features/cobrancas/services/conferencia-financeira.service";
import {
  gerarCartaoAsasParaCobranca,
  urlDoProvedor
} from "@/features/cobrancas/services/cartao-asas.server";
import {
  EMPRESAS_RECEBEDORAS_FIXAS,
  montarUrlPublicaCobranca,
  resolveEmpresaIdFromTexto
} from "@/features/cobrancas/cobrancas-utils";

/**
 * Fronteira server-only da área do cliente (/p/<token>).
 *
 * O QUE ISTO É
 * ------------
 * O cliente abre o link do pedido, vê quanto falta pagar e paga por PIX ou
 * cartão. Sem login, sem tabela nova, sem chave anon no navegador: tudo que a
 * página sabe vem daqui, lido com service role, e o token é DERIVADO — não
 * existe em lugar nenhum além da URL.
 *
 * TOKEN
 * -----
 * `<id_int>-<hmac>`: o número do pedido em claro, seguido de 16 bytes do
 * HMAC-SHA256(AREA_CLIENTE_TOKEN_SECRET, "area-cliente:v1:<id_int>") em
 * base64url (22 caracteres, 128 bits). Mesmo molde de
 * `cadastro-online.server.ts`, sem a versão persistida: aqui não há tabela,
 * então "rotacionar" é trocar o segredo — e isso mata todos os links de uma
 * vez. Foi a escolha do dono em 27/09/2026 para a primeira versão.
 *
 * O pedido vai em claro de propósito: ele é sequencial e aparece em todo
 * documento que o cliente recebe; escondê-lo não somaria nada. O que protege é
 * o HMAC, que ninguém deriva sem o segredo.
 *
 * O MESMO CAMINHO DO VENDEDOR
 * ---------------------------
 * A cobrança que a página cria é a mesma que o painel da proposta cria
 * (CobrancasProvider → criarCobrancaReal): mesma tabela, mesmas colunas, mesmo
 * pagador (`propostas.id_faturado`, com o mesmo fallback para o cliente), mesma
 * empresa recebedora, mesma URL pública. O PIX sai por `gerarPixBancoInter` e o
 * cartão por `gerarCartaoAsasParaCobranca` — as funções que as rotas do
 * vendedor chamam. Só o `atendente` muda: "Area do cliente". A Conferência e a
 * confirmação humana seguem exatamente como hoje.
 */

const VERSAO_TOKEN = 1;
const ATENDENTE_AREA_CLIENTE = "Area do cliente";
const DIAS_VENCIMENTO = 3;

/** Empresas com PIX no painel do vendedor (PropostaCobrancaPanel, opção PIX). */
const EMPRESAS_COM_PIX = new Set([1, 2, 3]);
/** Cartão Asas só existe para a IDEAL GRÁFICA (PropostaCobrancaPanel, EMPRESA_CARTAO_ASAAS). */
const EMPRESA_CARTAO_ASAAS = 1;

/** Marcador do Cartão Asas na descrição (CobrancasProvider.MARCADOR_CARTAO_ASAS). */
const MARCADOR_CARTAO_ASAS = "Cartão Asas";

/**
 * Família financeira do status-engine (`FAMILIA_FINANCEIRA`): só nela a
 * proposta ainda está esperando dinheiro. Fora dela a página mostra a situação
 * e nada mais.
 */
const FAMILIA_FINANCEIRA = new Set(["NOVO", "AGUARDANDO", "APROVADO", "LIBERADO"]);

const STATUS_IGNORADOS = new Set(["CANCELADO", "CANCELADA", "EXTORNADO", "RECUSADO"]);

export type MetodoAreaCliente = "PIX" | "CARTAO";

export type CobrancaAbertaPublica = {
  id: string;
  metodo: MetodoAreaCliente;
  valor: number;
  vencimento: string | null;
  pixCopiaCola: string | null;
  urlCheckout: string | null;
};

export type SituacaoAreaCliente = {
  idInt: number;
  /** O que a página diz do pedido, em 5 estados que o cliente entende. */
  situacao: "AGUARDANDO_PAGAMENTO" | "PAGO" | "EM_ANDAMENTO" | "CANCELADO" | "INDISPONIVEL";
  total: number;
  pago: number;
  aPagar: number;
  podePagar: boolean;
  motivoBloqueio: string | null;
  metodos: { pix: boolean; cartao: boolean };
  pagador: { nome: string; documento: string };
  empresa: string;
  cobrancaAberta: CobrancaAbertaPublica | null;
  /** Só informativo: crédito do cliente na Conta Corrente. Nulo quando não há. */
  credito: number | null;
  pagamentos: Array<{ metodo: string; valor: number; emConferencia: boolean }>;
  itens: Array<{ descricao: string; quantidade: number }>;
};

export function areaClienteFlagAtiva(): boolean {
  return process.env.AREA_CLIENTE_ENABLED === "true";
}

function segredo(): string | null {
  const valor = process.env.AREA_CLIENTE_TOKEN_SECRET;
  if (!valor || valor.trim().length < 16) return null;
  return valor;
}

function assinatura(idInt: number, secret: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(`area-cliente:v${VERSAO_TOKEN}:${idInt}`)
    .digest()
    .subarray(0, 16)
    .toString("base64url");
}

/** Token do link do pedido. Determinístico: o mesmo pedido sempre dá o mesmo link. */
export function derivarTokenAreaCliente(idInt: number): string | null {
  const secret = segredo();
  if (!secret || !Number.isInteger(idInt) || idInt <= 0) return null;
  return `${idInt}-${assinatura(idInt, secret)}`;
}

/**
 * Devolve o pedido de um token válido, ou null. Comparação em tempo constante:
 * o HMAC recalculado nunca é comparado com `===`.
 */
export function resolverTokenAreaCliente(token: string): number | null {
  const secret = segredo();
  if (!secret) return null;

  const casou = /^(\d{1,10})-([A-Za-z0-9_-]{22})$/.exec(String(token ?? "").trim());
  if (!casou) return null;

  const idInt = Number(casou[1]);
  if (!Number.isInteger(idInt) || idInt <= 0) return null;

  const esperado = Buffer.from(assinatura(idInt, secret));
  const recebido = Buffer.from(casou[2]);
  if (esperado.length !== recebido.length) return null;
  if (!crypto.timingSafeEqual(esperado, recebido)) return null;

  return idInt;
}

export function hashIpAreaCliente(ip: string): string {
  const secret = segredo() ?? "sem-segredo";
  return crypto.createHmac("sha256", secret).update(`ip:${ip}`).digest("hex").slice(0, 32);
}

const centavos = (valor: number): number => Math.round((Number(valor) || 0) * 100);
const reais = (cents: number): number => Math.round(cents) / 100;
const soDigitos = (valor: unknown): string => String(valor ?? "").replace(/\D/g, "");

/** Data de hoje em São Paulo, AAAA-MM-DD — a mesma régua do vencimento gravado. */
function hojeSP(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

function maisDias(dataIso: string, dias: number): string {
  const [a, m, d] = dataIso.split("-").map(Number);
  const data = new Date(Date.UTC(a, m - 1, d + dias));
  return data.toISOString().slice(0, 10);
}

/**
 * Mascara o CPF/CNPJ para a tela: o cliente reconhece o próprio documento, e
 * quem só tem o link não o lê inteiro.
 */
function mascararDocumento(documento: string): string {
  const digitos = soDigitos(documento);
  if (digitos.length === 11) return `***.${digitos.slice(3, 6)}.${digitos.slice(6, 9)}-**`;
  if (digitos.length === 14) return `**.${digitos.slice(2, 5)}.${digitos.slice(5, 8)}/****-**`;
  return digitos ? "***" : "";
}

type PropostaRow = {
  id_int: number;
  id_cliente: number | null;
  id_faturado: number | null;
  cliente: string | null;
  empresa: string | null;
  status_interno: string | null;
  is_avulso: boolean | null;
  id_endereco_ent: string | null;
};

type CobrancaRow = {
  id: string;
  id_pagamento: string | null;
  tipo_cobranca: string | null;
  status: string | null;
  confirmado: boolean | null;
  valor: number | null;
  vencimento: string | null;
  pix_copia_cola: string | null;
  url_cobranca: string | null;
  cod_solicitacao_inter: string | null;
  descricao: string | null;
  atendente: string | null;
  created_at: string | null;
};

type ClienteRow = {
  id_cliente: number;
  nome: string | null;
  documento: string | null;
  whatsapp_1: string | null;
  telefone_fixo: string | null;
};

function metodoDaCobranca(row: CobrancaRow): MetodoAreaCliente | null {
  const tipo = String(row.tipo_cobranca ?? "").toUpperCase();
  if (tipo === "PIX" || tipo === "E-PIX") return "PIX";
  if (tipo === "CARD_PARCELADO" || tipo === "CREDIT_CARD") return "CARTAO";
  return null;
}

function rotuloPublico(tipo: string | null): string {
  const t = String(tipo ?? "").toUpperCase();
  if (t === "PIX" || t === "E-PIX") return "PIX";
  if (t === "CARD_PARCELADO" || t === "CREDIT_CARD") return "Cartão";
  if (t === "BOLETO") return "Boleto";
  if (t === "E-CREDITO") return "Crédito utilizado";
  if (t.startsWith("E-FATURADO")) return "Faturado";
  return t || "Pagamento";
}

/**
 * Pagador da cobrança: `propostas.id_faturado`, com fallback para o cliente da
 * proposta — a mesma resolução do painel do vendedor e de pagamento-combinado.
 */
async function resolverPagador(service: SupabaseClient, proposta: PropostaRow): Promise<ClienteRow | null> {
  const idCliente = proposta.id_cliente ? Number(proposta.id_cliente) : null;
  const idFaturado = proposta.id_faturado ? Number(proposta.id_faturado) : null;
  const idPagador = idFaturado && idFaturado !== idCliente ? idFaturado : idCliente;
  if (!idPagador) return null;

  const { data, error } = await service
    .from("clientes")
    .select("id_cliente, nome, documento, whatsapp_1, telefone_fixo")
    .eq("id_cliente", idPagador)
    .maybeSingle<ClienteRow>();

  if (error) {
    console.error(`[area-cliente] pagador ${idPagador} da proposta ${proposta.id_int} nao pode ser lido:`, error.message);
    return null;
  }
  return data ?? null;
}

async function saldoCredito(service: SupabaseClient, idCliente: number | null): Promise<number | null> {
  if (!idCliente) return null;
  // Mesma conta de mc_usar_credito_avulso: CREDITO - DEBITO, sem os cancelados.
  const { data, error } = await service
    .from("movimento_credito")
    .select("tipo, valor")
    .eq("id_cliente", idCliente)
    .eq("cancelado", false);
  if (error || !data) return null;
  let saldo = 0;
  for (const linha of data as Array<{ tipo: string | null; valor: number | null }>) {
    const v = Number(linha.valor) || 0;
    if (linha.tipo === "CREDITO") saldo += v;
    else if (linha.tipo === "DEBITO") saldo -= v;
  }
  return saldo > 0 ? reais(centavos(saldo)) : null;
}

function cobrancaAbertaReaproveitavel(
  cobrancas: CobrancaRow[],
  metodo: MetodoAreaCliente,
  aPagarCents: number
): CobrancaRow | null {
  const hoje = hojeSP();
  return (
    cobrancas.find((c) => {
      if (String(c.status ?? "").toUpperCase() !== "A_RECEBER") return false;
      if (metodoDaCobranca(c) !== metodo) return false;
      if (centavos(Number(c.valor)) !== aPagarCents) return false;
      // Vencida não serve: o PIX/checkout dela já não vale no provedor.
      if (c.vencimento && c.vencimento < hoje) return false;
      return true;
    }) ?? null
  );
}

function paraPublica(row: CobrancaRow): CobrancaAbertaPublica {
  const metodo = metodoDaCobranca(row) ?? "PIX";
  return {
    id: row.id,
    metodo,
    valor: reais(centavos(Number(row.valor))),
    vencimento: row.vencimento,
    pixCopiaCola: metodo === "PIX" ? row.pix_copia_cola : null,
    // Só a URL do provedor sai para o cliente: a "interna" é a página pública
    // antiga, que não é o que se quer abrir daqui.
    urlCheckout: metodo === "CARTAO" && urlDoProvedor(row.url_cobranca) ? row.url_cobranca : null
  };
}

/**
 * Tudo que a página mostra. Calculado aqui, com service role, a partir da
 * mesma regra da engine de status: total = `propostas.valor_total`; pago =
 * PAID, ou A_VENCER confirmado; comparação em centavos.
 */
export async function montarSituacaoAreaCliente(
  service: SupabaseClient,
  idInt: number
): Promise<SituacaoAreaCliente | null> {
  const { data: proposta, error: propostaErr } = await service
    .from("propostas")
    .select("id_int, id_cliente, id_faturado, cliente, empresa, status_interno, is_avulso, id_endereco_ent")
    .eq("id_int", idInt)
    .maybeSingle<PropostaRow>();

  if (propostaErr || !proposta) return null;

  const quitacao = await calcularSituacaoQuitacaoProposta(service, idInt);
  const totalCents = centavos(quitacao.valorTotalProposta);
  const pagoCents = centavos(quitacao.valorQuitadoAtual);
  const aPagarCents = Math.max(0, totalCents - pagoCents);

  const { data: cobrancasData } = await service
    .from("pagamentos_v2")
    .select("id, id_pagamento, tipo_cobranca, status, confirmado, valor, vencimento, pix_copia_cola, url_cobranca, cod_solicitacao_inter, descricao, atendente, created_at")
    .eq("id_int", idInt)
    .order("created_at", { ascending: false });
  const cobrancas = (cobrancasData ?? []) as CobrancaRow[];

  const { data: itensData } = await service
    .from("produtos_proposta")
    .select("nome_produto, modelo_descri, qtd, status_item, created_at")
    .eq("id_int", idInt)
    .order("created_at", { ascending: true });

  const itens = ((itensData ?? []) as Array<{ nome_produto: string | null; modelo_descri: string | null; qtd: number | null; status_item: string | null }>)
    .filter((i) => String(i.status_item ?? "").toUpperCase() !== "CANCELADO")
    .map((i) => ({
      descricao: [i.nome_produto, i.modelo_descri].map((t) => String(t ?? "").trim()).filter(Boolean).join(" — ") || "Item",
      quantidade: Number(i.qtd) || 0
    }));

  const pagador = await resolverPagador(service, proposta);
  const idEmpresa = resolveEmpresaIdFromTexto(proposta.empresa);
  const empresaNome = EMPRESAS_RECEBEDORAS_FIXAS.find((e) => e.id === idEmpresa)?.nome ?? String(proposta.empresa ?? "").trim();

  // Os dois sufixos de arte saem, como no status-engine: NOVO_ARTE_APROVADA e
  // AGUARDANDO_ARTE_APROVADA ainda esperam pagamento (28/09/2026).
  const statusBase = String(proposta.status_interno ?? "NOVO")
    .toUpperCase()
    .replace(" / EM ARTE", "")
    .trim()
    .replace(/_ARTE_APROVADA$/, "");

  let situacao: SituacaoAreaCliente["situacao"];
  if (statusBase === "CANCELADO") situacao = "CANCELADO";
  else if (totalCents > 0 && aPagarCents === 0) situacao = "PAGO";
  else if (FAMILIA_FINANCEIRA.has(statusBase)) situacao = "AGUARDANDO_PAGAMENTO";
  else situacao = "EM_ANDAMENTO";

  const metodos = {
    pix: idEmpresa != null && EMPRESAS_COM_PIX.has(idEmpresa),
    cartao: idEmpresa === EMPRESA_CARTAO_ASAAS
  };

  let motivoBloqueio: string | null = null;
  if (situacao === "CANCELADO") motivoBloqueio = "Este pedido foi cancelado.";
  else if (situacao === "PAGO") motivoBloqueio = "Este pedido já está pago.";
  else if (situacao === "EM_ANDAMENTO") motivoBloqueio = "Este pedido já está em andamento.";
  else if (proposta.is_avulso) motivoBloqueio = "Este pedido é tratado diretamente com seu atendente.";
  else if (totalCents <= 0) motivoBloqueio = "Este pedido ainda não tem valor definido. Fale com seu atendente.";
  else if (!pagador) motivoBloqueio = "Não foi possível identificar o pagador. Fale com seu atendente.";
  else if (soDigitos(pagador.documento).length !== 11 && soDigitos(pagador.documento).length !== 14)
    motivoBloqueio = "O cadastro do pagador está sem CPF/CNPJ. Fale com seu atendente.";
  else if (!idEmpresa || (!metodos.pix && !metodos.cartao))
    motivoBloqueio = "Pagamento online indisponível para esta empresa. Fale com seu atendente.";

  const podePagar = motivoBloqueio === null;

  // A cobrança que a página vai mostrar: uma aberta de PIX ou cartão, com o
  // valor exato do que falta. Preferência para a que já tem PIX/checkout.
  let cobrancaAberta: CobrancaRow | null = null;
  if (podePagar) {
    const candidatas = [
      cobrancaAbertaReaproveitavel(cobrancas, "PIX", aPagarCents),
      cobrancaAbertaReaproveitavel(cobrancas, "CARTAO", aPagarCents)
    ].filter((c): c is CobrancaRow => Boolean(c));
    cobrancaAberta =
      candidatas.find((c) => (metodoDaCobranca(c) === "PIX" ? Boolean(c.pix_copia_cola) : urlDoProvedor(c.url_cobranca))) ??
      candidatas[0] ??
      null;
  }

  const pagamentos = cobrancas
    .filter((c) => !STATUS_IGNORADOS.has(String(c.status ?? "").toUpperCase()))
    .filter((c) => {
      const st = String(c.status ?? "").toUpperCase();
      return st === "PAID" || (st === "A_VENCER" && c.confirmado === true);
    })
    .map((c) => ({
      metodo: rotuloPublico(c.tipo_cobranca),
      valor: reais(centavos(Number(c.valor))),
      emConferencia: c.confirmado !== true
    }));

  return {
    idInt,
    situacao,
    total: reais(totalCents),
    pago: reais(pagoCents),
    aPagar: reais(aPagarCents),
    podePagar,
    motivoBloqueio,
    metodos,
    pagador: {
      nome: String(pagador?.nome ?? proposta.cliente ?? "").trim(),
      documento: mascararDocumento(String(pagador?.documento ?? ""))
    },
    empresa: empresaNome,
    cobrancaAberta: cobrancaAberta ? paraPublica(cobrancaAberta) : null,
    credito: await saldoCredito(service, proposta.id_cliente ? Number(proposta.id_cliente) : null),
    pagamentos,
    itens
  };
}

/**
 * Chave de idempotência DETERMINÍSTICA da cobrança que a página cria.
 *
 * O vendedor manda um UUID aleatório por tentativa; aqui não dá — duas abas
 * abertas são duas tentativas legítimas do MESMO pagamento, e o que se quer é
 * que as duas caiam na mesma linha. A chave sai de (pedido, método, valor,
 * dia) e do número de cobranças da área do cliente já canceladas para esse
 * pedido: assim duas requisições simultâneas colidem no índice único
 * `ux_pgv2_chave_idempotencia` e a perdedora reaproveita a vencedora, e uma
 * cobrança cancelada pelo atendente não trava uma nova no mesmo dia.
 */
function chaveIdempotencia(idInt: number, metodo: MetodoAreaCliente, aPagarCents: number, dia: string, canceladas: number): string {
  const hash = crypto
    .createHash("sha256")
    .update(`area-cliente:${idInt}:${metodo}:${aPagarCents}:${dia}:${canceladas}`)
    .digest();
  // Formata os 16 primeiros bytes como UUID (versão 8 = "custom", variante RFC).
  hash[6] = (hash[6] & 0x0f) | 0x80;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

type EnderecoRow = {
  cep: string | null;
  endereco: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  tipo_endereco?: string | null;
};

/**
 * Endereço do pagador para o PIX: o vinculado à proposta primeiro, depois o do
 * cliente (entrega > principal > primeiro). Cópia da regra de
 * pagamento-combinado, que é a versão de servidor do que o painel manda.
 */
async function resolverEndereco(service: SupabaseClient, proposta: PropostaRow, idCliente: number): Promise<EnderecoRow | null> {
  if (proposta.id_endereco_ent) {
    const { data } = await service
      .from("enderecos")
      .select("cep, endereco, numero, complemento, bairro, cidade, uf")
      .eq("id", proposta.id_endereco_ent)
      .maybeSingle<EnderecoRow>();
    if (data) return data;
  }
  const { data: lista } = await service
    .from("enderecos")
    .select("cep, endereco, numero, complemento, bairro, cidade, uf, tipo_endereco")
    .eq("id_cliente", idCliente)
    .limit(20);
  const enderecos = (lista ?? []) as EnderecoRow[];
  return (
    enderecos.find((e) => (e.tipo_endereco || "").toUpperCase().includes("ENTREGA")) ??
    enderecos.find((e) => (e.tipo_endereco || "").toUpperCase().includes("PRINCIPAL")) ??
    enderecos[0] ??
    null
  );
}

export type ResultadoPagar =
  | { ok: true; cobranca: CobrancaAbertaPublica; reaproveitada: boolean }
  | { ok: false; codigo: "BLOQUEADO" | "PIX_EMITIDO_SEM_QR" | "PROVEDOR" | "DADOS" | "INTERNO"; mensagem: string };

/**
 * Cria (ou reaproveita) a cobrança do valor que falta e aciona o provedor.
 * O valor NUNCA vem de quem chama: é recalculado aqui.
 */
export async function iniciarPagamentoAreaCliente(
  service: SupabaseClient,
  idInt: number,
  metodo: MetodoAreaCliente,
  ipHash: string
): Promise<ResultadoPagar> {
  const situacao = await montarSituacaoAreaCliente(service, idInt);
  if (!situacao) return { ok: false, codigo: "INTERNO", mensagem: "Pedido não encontrado." };
  if (!situacao.podePagar) {
    return { ok: false, codigo: "BLOQUEADO", mensagem: situacao.motivoBloqueio ?? "Pagamento indisponível." };
  }
  if ((metodo === "PIX" && !situacao.metodos.pix) || (metodo === "CARTAO" && !situacao.metodos.cartao)) {
    return { ok: false, codigo: "BLOQUEADO", mensagem: "Esta forma de pagamento não está disponível para este pedido." };
  }

  const { data: propostaData } = await service
    .from("propostas")
    .select("id_int, id_cliente, id_faturado, cliente, empresa, status_interno, is_avulso, id_endereco_ent")
    .eq("id_int", idInt)
    .maybeSingle<PropostaRow>();
  const proposta = propostaData as PropostaRow | null;
  if (!proposta) return { ok: false, codigo: "INTERNO", mensagem: "Pedido não encontrado." };

  const pagador = await resolverPagador(service, proposta);
  if (!pagador) return { ok: false, codigo: "DADOS", mensagem: "Não foi possível identificar o pagador. Fale com seu atendente." };

  const idEmpresa = resolveEmpresaIdFromTexto(proposta.empresa);
  const empresaNome = EMPRESAS_RECEBEDORAS_FIXAS.find((e) => e.id === idEmpresa)?.nome ?? null;
  if (!idEmpresa || !empresaNome) {
    return { ok: false, codigo: "DADOS", mensagem: "Empresa recebedora não identificada. Fale com seu atendente." };
  }

  const aPagarCents = centavos(situacao.aPagar);
  const tipoCobranca = metodo === "PIX" ? "PIX" : "CARD_PARCELADO";
  const hoje = hojeSP();

  // 1. Reaproveitar: existe aberta, do mesmo método, com o valor exato e não vencida?
  const { data: cobrancasData } = await service
    .from("pagamentos_v2")
    .select("id, id_pagamento, tipo_cobranca, status, confirmado, valor, vencimento, pix_copia_cola, url_cobranca, cod_solicitacao_inter, descricao, atendente, created_at")
    .eq("id_int", idInt)
    .order("created_at", { ascending: false });
  const cobrancas = (cobrancasData ?? []) as CobrancaRow[];

  let linha = cobrancaAbertaReaproveitavel(cobrancas, metodo, aPagarCents);
  let reaproveitada = Boolean(linha);

  // 2. Criar — com os mesmos campos que o painel do vendedor grava.
  if (!linha) {
    const canceladas = cobrancas.filter(
      (c) => String(c.status ?? "").toUpperCase() === "CANCELADO" && c.atendente === ATENDENTE_AREA_CLIENTE && metodoDaCobranca(c) === metodo
    ).length;
    const chave = chaveIdempotencia(idInt, metodo, aPagarCents, hoje, canceladas);

    const payloadInicial = {
      id_int: idInt,
      id_cliente: pagador.id_cliente,
      cliente: String(pagador.nome ?? proposta.cliente ?? "").trim(),
      documento: String(pagador.documento ?? ""),
      valor: reais(aPagarCents),
      status: "A_RECEBER",
      tipo_cobranca: tipoCobranca,
      empresa: empresaNome,
      id_empresa: idEmpresa,
      os_ideal: null,
      atendente: ATENDENTE_AREA_CLIENTE,
      descricao: `Cobrança ${metodo === "PIX" ? "PIX" : MARCADOR_CARTAO_ASAS} da proposta #${idInt}`,
      vencimento: maisDias(hoje, DIAS_VENCIMENTO),
      obs_v2: `Criada pela área do cliente (origem ${ipHash}).`,
      confirmado: false,
      forma_fatu: null,
      forma_pgto: null,
      id_modelo_cobranca: null,
      p_valor_entrada: null,
      p_qtd_parcelas: null,
      p_dias_pra_inicio: null,
      p_intervalo: null,
      paid_at: null,
      chave_idempotencia: chave
    };

    const { data: criada, error: insertErr } = await service
      .from("pagamentos_v2")
      .insert([payloadInicial])
      .select("id, id_pagamento, tipo_cobranca, status, confirmado, valor, vencimento, pix_copia_cola, url_cobranca, cod_solicitacao_inter, descricao, atendente, created_at")
      .maybeSingle<CobrancaRow>();

    if (insertErr) {
      if (insertErr.code === "23505") {
        // Outra requisição (outra aba, clique duplo) venceu a corrida com a
        // mesma chave. Reaproveita a linha dela.
        const { data: vencedora } = await service
          .from("pagamentos_v2")
          .select("id, id_pagamento, tipo_cobranca, status, confirmado, valor, vencimento, pix_copia_cola, url_cobranca, cod_solicitacao_inter, descricao, atendente, created_at")
          .eq("chave_idempotencia", chave)
          .maybeSingle<CobrancaRow>();
        if (vencedora && String(vencedora.status ?? "").toUpperCase() === "A_RECEBER") {
          linha = vencedora;
          reaproveitada = true;
        } else {
          return { ok: false, codigo: "INTERNO", mensagem: "Estamos preparando seu pagamento. Atualize a página em instantes." };
        }
      } else {
        console.error(`[area-cliente] insert em pagamentos_v2 falhou (pedido ${idInt}):`, insertErr.message);
        return { ok: false, codigo: "INTERNO", mensagem: "Não foi possível preparar o pagamento. Tente novamente." };
      }
    } else if (!criada) {
      return { ok: false, codigo: "INTERNO", mensagem: "Não foi possível preparar o pagamento. Tente novamente." };
    } else {
      linha = criada;
      // Token público e URL pública, como o painel faz logo depois do insert.
      const tokenPublico = criada.id.split("-")[0];
      const { error: urlErr } = await service
        .from("pagamentos_v2")
        .update({ token_publico: tokenPublico, url_cobranca: montarUrlPublicaCobranca({ tipoCobranca, tokenPublico }) })
        .eq("id", criada.id);
      if (urlErr) {
        console.error(`[area-cliente] token/url publicos nao gravados em ${criada.id}:`, urlErr.message);
      }
    }
  }

  if (!linha) return { ok: false, codigo: "INTERNO", mensagem: "Não foi possível preparar o pagamento. Tente novamente." };

  // 3. Provedor — só quando a linha ainda não tem PIX/checkout.
  if (metodo === "PIX") {
    if (!linha.pix_copia_cola) {
      if (linha.cod_solicitacao_inter) {
        // Mesma regra de gerar-pix: emitida no banco sem QR — nunca reemitir.
        return {
          ok: false,
          codigo: "PIX_EMITIDO_SEM_QR",
          mensagem: "Seu PIX está sendo finalizado. Atualize a página em instantes ou fale com seu atendente."
        };
      }

      const endereco = await resolverEndereco(service, proposta, pagador.id_cliente);
      const faltando: string[] = [];
      if (!String(pagador.nome ?? "").trim()) faltando.push("nome do pagador");
      if (!endereco?.endereco?.trim()) faltando.push("endereço");
      if (!endereco?.cidade?.trim()) faltando.push("cidade");
      if (!endereco?.uf?.trim()) faltando.push("UF");
      if (!endereco?.cep?.trim()) faltando.push("CEP");
      if (faltando.length > 0) {
        return {
          ok: false,
          codigo: "DADOS",
          mensagem: `Faltam dados do cadastro para emitir o PIX (${faltando.join(", ")}). Fale com seu atendente.`
        };
      }

      const resPix = await gerarPixBancoInter(service, {
        cobrancaId: linha.id,
        idEmpresa,
        // Mesma regra do painel: a Birô usa o id_pagamento, as outras o número do pedido.
        seuNumero: idEmpresa === 2 ? linha.id_pagamento || String(idInt) : String(idInt),
        valorNominal: reais(aPagarCents),
        dataVencimento: linha.vencimento || hoje,
        telefone: pagador.whatsapp_1 || pagador.telefone_fixo || "",
        cpfCnpj: soDigitos(pagador.documento),
        nome: String(pagador.nome ?? "").trim(),
        endereco: `${endereco?.endereco || ""}, ${endereco?.numero || ""} ${endereco?.complemento || ""}`.trim(),
        cidade: endereco?.cidade || "",
        uf: endereco?.uf || "",
        cep: endereco?.cep || ""
      });

      if (!resPix.success) {
        // A cobrança fica preservada em A_RECEBER para nova tentativa, como no painel.
        console.error(`[area-cliente] PIX nao emitido para ${linha.id}:`, resPix.error);
        return {
          ok: false,
          codigo: resPix.cobrancaEmitida ? "PIX_EMITIDO_SEM_QR" : "PROVEDOR",
          mensagem: resPix.cobrancaEmitida
            ? "Seu PIX está sendo finalizado. Atualize a página em instantes ou fale com seu atendente."
            : "Não foi possível gerar o PIX agora. Tente novamente em instantes."
        };
      }

      const atualizada = resPix.data as Partial<CobrancaRow> | undefined;
      linha = { ...linha, pix_copia_cola: atualizada?.pix_copia_cola ?? linha.pix_copia_cola, cod_solicitacao_inter: atualizada?.cod_solicitacao_inter ?? linha.cod_solicitacao_inter };
    }
    return { ok: true, cobranca: paraPublica(linha), reaproveitada };
  }

  // CARTÃO
  if (!urlDoProvedor(linha.url_cobranca)) {
    if (!String(linha.descricao ?? "").includes(MARCADOR_CARTAO_ASAS)) {
      // Cartão aberto pelo vendedor no fluxo padrão (C6): não é o Asaas, e a
      // página não tem como emitir por ele.
      return { ok: false, codigo: "BLOQUEADO", mensagem: "Já existe uma cobrança de cartão em andamento para este pedido. Fale com seu atendente." };
    }
    const resultado = await gerarCartaoAsasParaCobranca(service, linha.id);
    const body = resultado.body as { success?: boolean; message?: string; data?: { url_cobranca?: string | null } };
    if (!body.success) {
      console.error(`[area-cliente] cartao nao emitido para ${linha.id}:`, body.message);
      return { ok: false, codigo: "PROVEDOR", mensagem: "Não foi possível gerar o pagamento por cartão agora. Tente novamente em instantes." };
    }
    linha = { ...linha, url_cobranca: body.data?.url_cobranca ?? linha.url_cobranca };
  }
  return { ok: true, cobranca: paraPublica(linha), reaproveitada };
}
