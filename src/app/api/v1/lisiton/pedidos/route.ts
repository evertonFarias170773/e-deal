import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { rateLimitCheck } from "@/lib/security/rate-limit-memory";
import { criarClientServiceRole } from "@/features/cadastros/services/cadastro-online.server";
import {
  areaClienteFlagAtiva,
  derivarTokenAreaCliente,
  hashIpAreaCliente,
  iniciarPagamentoAreaCliente
} from "@/features/area-cliente/services/area-cliente.server";
import { montarPedidoLisiton, type CorpoPedidoLisiton } from "@/features/integracoes/lisiton/montar-pedido.server";

/**
 * API da Lisiton — CRIAR UM PEDIDO (27/11/2026).
 *
 *   POST /api/v1/lisiton/pedidos
 *   cabeçalho x-api-key: <LISITON_PEDIDOS_KEY>
 *
 * Contrato para quem integra: docs/api/lisiton-criar-pedido.md.
 *
 * O QUE FAZ, NESTA ORDEM
 *   1. Monta o pedido com as funções do Salvar da tela (montar-pedido.server.ts),
 *      só lendo do banco.
 *   2. Grava tudo numa transação, pela função do banco `lisiton_criar_pedido`:
 *      cliente final (acha pelo documento ou cria) com o vínculo à Lisiton,
 *      endereço, proposta, itens, um lote por cor, cotação FOB, as conversas do
 *      ChatGuru (Lisiane principal) e a origem "Integração Lisiton".
 *   3. Gera a cobrança PIX pela MESMA função da página /p
 *      (`iniciarPagamentoAreaCliente`) e devolve id_int e a url do /p.
 *
 * IDEMPOTÊNCIA: `chave_idempotencia` vem da Lisiton. Repetir a chave devolve o
 * mesmo pedido e reaproveita a mesma cobrança aberta (a função da /p reaproveita
 * a PIX aberta do mesmo valor). A mesma chave com outro conteúdo é recusada (409).
 *
 * DEPOIS DO PAGAMENTO: o caminho de sempre. O PIX pago é conferido pela
 * conferência automática, e o pedido 100% de prateleira, com o contato do
 * ChatGuru gravado, vai sozinho para REVISAO PRODUCAO (liberarPrateleiraAutomaticamente).
 *
 * AUDITORIA: grava com o service role; a origem fica no pedido (obs_proposta),
 * no chat e na tabela integracao_lisiton_pedidos.
 *
 * NADA SENSÍVEL NO LOG: nem a chave da API, nem o IP, nem dados do cliente.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIMITE_POR_IP = 20;
const JANELA_MS = 60_000;
const URL_BASE = (process.env.AREA_CLIENTE_URL_BASE || "https://vibe.ai-ideal.com.br").replace(/\/+$/, "");
const CABECALHOS = { "Cache-Control": "no-store" } as const;

const resposta = (status: number, corpo: Record<string, unknown>, extras: Record<string, string> = {}) =>
  NextResponse.json(corpo, { status, headers: { ...CABECALHOS, ...extras } });

function chaveConfere(recebida: string, esperada: string): boolean {
  const a = createHash("sha256").update(recebida, "utf8").digest();
  const b = createHash("sha256").update(esperada, "utf8").digest();
  return timingSafeEqual(a, b);
}

/** "LISITON_CHAVE_REUSADA: texto" -> { codigo, texto } (mensagens do banco são para gente ler). */
function erroDoBanco(mensagem: string): { codigo: string; texto: string } {
  const m = /(LISITON_[A-Z_]+):\s*([\s\S]*)$/.exec(mensagem);
  return m ? { codigo: m[1], texto: m[2].trim() } : { codigo: "", texto: "" };
}

export async function POST(request: Request) {
  const ip = (request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "desconhecido").split(",")[0].trim();
  if (!rateLimitCheck(`lisiton:criar-pedido:${ip}`, LIMITE_POR_IP, JANELA_MS)) {
    return resposta(429, { erro: "muitas_tentativas", mensagem: "Limite de chamadas atingido. Tente de novo em 1 minuto." }, { "Retry-After": "60" });
  }

  const esperada = process.env.LISITON_PEDIDOS_KEY ?? "";
  const recebida = request.headers.get("x-api-key") ?? "";
  if (!esperada) {
    console.error("[API][Lisiton][criar-pedido] LISITON_PEDIDOS_KEY nao configurada no servidor.");
    return resposta(401, { erro: "nao_autorizado", mensagem: "Chave de API ausente ou inválida." });
  }
  if (!recebida || !chaveConfere(recebida, esperada)) {
    return resposta(401, { erro: "nao_autorizado", mensagem: "Chave de API ausente ou inválida." });
  }

  // Sem a área do cliente ligada não há /p para devolver: nada é criado.
  if (!areaClienteFlagAtiva() || !derivarTokenAreaCliente(1)) {
    return resposta(503, { erro: "indisponivel", mensagem: "O pagamento online está indisponível no momento. Tente de novo mais tarde." });
  }

  const corpo = (await request.json().catch(() => null)) as CorpoPedidoLisiton | null;
  if (!corpo || typeof corpo !== "object") return resposta(400, { erro: "json_invalido", mensagem: "Corpo da requisição não é um JSON válido." });

  const banco = criarClientServiceRole();
  if (!banco) {
    console.error("[API][Lisiton][criar-pedido] Servidor sem acesso ao banco configurado.");
    return resposta(500, { erro: "erro_interno", mensagem: "Não foi possível criar o pedido agora." });
  }

  // 1. Montagem (só leitura).
  const montado = await montarPedidoLisiton(banco, corpo);
  if (!montado.ok) {
    if (montado.status >= 500) console.error(`[API][Lisiton][criar-pedido] Falha na montagem: ${montado.mensagem}`);
    return resposta(montado.status, { erro: montado.erro, mensagem: montado.mensagem });
  }

  // 2. Gravação numa transação.
  const { data: criado, error } = await banco.rpc("lisiton_criar_pedido", { p: montado.payload });
  if (error) {
    const { codigo, texto } = erroDoBanco(error.message || "");
    if (codigo === "LISITON_CHAVE_REUSADA") return resposta(409, { erro: "chave_reusada", mensagem: texto });
    if (codigo) return resposta(422, { erro: codigo.toLowerCase(), mensagem: texto });
    console.error(`[API][Lisiton][criar-pedido] Falha ao gravar (chave ${montado.chave}): ${error.message}`);
    return resposta(500, { erro: "erro_interno", mensagem: "Não foi possível criar o pedido agora. Nada foi gravado; tente de novo com a mesma chave." });
  }
  const r = (criado ?? {}) as { id_int?: number | null; idempotente?: boolean };
  const idInt = Number(r.id_int);
  if (!Number.isInteger(idInt) || idInt <= 0) {
    return resposta(409, { erro: "em_processamento", mensagem: "Este pedido ainda está sendo criado. Repita em instantes com a mesma chave." });
  }

  const token = derivarTokenAreaCliente(idInt);
  const url = `${URL_BASE}/p/${token}`;

  // 3. PIX pela função da página /p (reaproveita a cobrança aberta do mesmo valor).
  const pagamento = await iniciarPagamentoAreaCliente(banco, idInt, "PIX", hashIpAreaCliente(`lisiton:${ip}`));
  const pix = pagamento.ok
    ? {
        status: pagamento.cobranca.pixCopiaCola ? "gerado" : "em_preparacao",
        valor: pagamento.cobranca.valor,
        vencimento: pagamento.cobranca.vencimento,
        copia_e_cola: pagamento.cobranca.pixCopiaCola
      }
    : { status: "pendente", mensagem: `${pagamento.mensagem} O pedido foi criado; o cliente pode pagar pela url quando o PIX estiver pronto, ou repita a chamada com a mesma chave.` };
  if (!pagamento.ok) console.warn(`[API][Lisiton][criar-pedido] PIX nao gerado para ${idInt}: ${pagamento.codigo}`);

  return resposta(r.idempotente ? 200 : 201, {
    id_int: idInt,
    idempotente: r.idempotente === true,
    url_pagamento: url,
    pix
  });
}
