import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { rateLimitCheck } from "@/lib/security/rate-limit-memory";
import { criarClientServiceRole } from "@/features/cadastros/services/cadastro-online.server";
import { areaClienteFlagAtiva, derivarTokenAreaCliente } from "@/features/area-cliente/services/area-cliente.server";

/**
 * Link de pagamento externo para o PARCEIRO — o mesmo link do "Link pgto.
 * externo" da tela, para o sistema do parceiro pôr um botão de pagamento na
 * mensagem de aprovação de arte que ele já manda ao cliente (29/09/2026).
 *
 *   GET /api/v1/parceiro/link-pagamento/{id_int}
 *   cabeçalho x-api-key: <PARCEIRO_LINK_PGTO_KEY>
 *
 * Documentação para quem integra: docs/api/link-pagamento.md.
 *
 * DEVOLVE SÓ O LINK. `{ id_int, url }` e nada mais: nenhum dado do pedido nem do
 * cliente. O status do pedido (pago, em revisão, disponível para pagar) quem
 * mostra é a própria página /p, que não muda aqui.
 *
 * O TOKEN É O DO BOTÃO. `derivarTokenAreaCliente` — a mesma função que
 * `/api/area-cliente/link` usa. O segredo (AREA_CLIENTE_TOKEN_SECRET) nunca sai
 * do servidor; só o token derivado dele.
 *
 * Pedido inexistente e pedido avulso recebem a MESMA resposta 404: a API não
 * serve para descobrir se um número existe. Avulso fica de fora porque é
 * tratado direto com o atendente (a página /p já diz isso a quem abrir).
 *
 * NADA SENSÍVEL NO LOG. Nem a chave, nem o token, nem a URL, nem o IP. Só o que
 * falhou no servidor.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Tentativas por IP: 30 por minuto. Cobre uso normal e trava força bruta na chave. */
const LIMITE_POR_IP = 30;
const JANELA_MS = 60_000;

/** Onde a página /p é servida. Configurável para homologação; em produção, o domínio do Vibe. */
const URL_BASE = (process.env.AREA_CLIENTE_URL_BASE || "https://vibe.ai-ideal.com.br").replace(/\/+$/, "");

const CABECALHOS = { "Cache-Control": "no-store" } as const;

const resposta = (status: number, corpo: Record<string, unknown>, extras: Record<string, string> = {}) =>
  NextResponse.json(corpo, { status, headers: { ...CABECALHOS, ...extras } });

const naoAutorizado = () => resposta(401, { erro: "nao_autorizado", mensagem: "Chave de API ausente ou inválida." });

/** A MESMA resposta para pedido inexistente e para pedido avulso. */
const naoEncontrado = () => resposta(404, { erro: "nao_encontrado", mensagem: "Pedido não encontrado." });

const indisponivel = () =>
  resposta(503, { erro: "indisponivel", mensagem: "O link de pagamento está indisponível no momento. Tente de novo mais tarde." });

const erroInterno = () => resposta(500, { erro: "erro_interno", mensagem: "Não foi possível gerar o link agora." });

/**
 * Compara a chave em tempo constante. As duas passam por SHA-256 antes: o
 * `timingSafeEqual` exige tamanhos iguais, e comparar tamanhos direto revelaria
 * o comprimento da chave certa. Mesmo desenho da API da Lisiton.
 */
function chaveConfere(recebida: string, esperada: string): boolean {
  const a = createHash("sha256").update(recebida, "utf8").digest();
  const b = createHash("sha256").update(esperada, "utf8").digest();
  return timingSafeEqual(a, b);
}

export async function GET(request: Request, contexto: { params: Promise<{ id_int: string }> }) {
  // 1. Limite por IP — antes de tudo, inclusive da chave.
  const ip = (request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "desconhecido")
    .split(",")[0]
    .trim();
  if (!rateLimitCheck(`parceiro:link-pgto:${ip}`, LIMITE_POR_IP, JANELA_MS)) {
    return resposta(
      429,
      { erro: "muitas_tentativas", mensagem: "Limite de consultas atingido. Tente de novo em 1 minuto." },
      { "Retry-After": "60" }
    );
  }

  // 2. Chave. Sem chave configurada no servidor, ninguém entra.
  const esperada = process.env.PARCEIRO_LINK_PGTO_KEY ?? "";
  const recebida = request.headers.get("x-api-key") ?? "";
  if (!esperada) {
    console.error("[API][Parceiro][link-pagamento] PARCEIRO_LINK_PGTO_KEY nao configurada no servidor.");
    return naoAutorizado();
  }
  if (!recebida || !chaveConfere(recebida, esperada)) return naoAutorizado();

  // 3. O número do pedido. Número inválido é "não encontrado", como qualquer outro.
  const { id_int: bruto } = await contexto.params;
  if (!/^\d{1,9}$/.test(String(bruto ?? ""))) return naoEncontrado();
  const idInt = Number(bruto);
  if (!Number.isInteger(idInt) || idInt <= 0) return naoEncontrado();

  // 4. A área do cliente precisa estar ligada — sem ela a página /p é neutra.
  if (!areaClienteFlagAtiva()) return indisponivel();

  const banco = criarClientServiceRole();
  if (!banco) {
    console.error("[API][Parceiro][link-pagamento] Servidor sem acesso ao banco configurado.");
    return erroInterno();
  }

  // 5. O pedido: existe e não é avulso. Só essas duas colunas são lidas.
  const { data: proposta, error } = await banco
    .from("propostas")
    .select("id_int, is_avulso")
    .eq("id_int", idInt)
    .maybeSingle<{ id_int: number; is_avulso: boolean | null }>();
  if (error) {
    console.error(`[API][Parceiro][link-pagamento] Falha ao ler o pedido ${idInt}: ${error.message}`);
    return erroInterno();
  }
  if (!proposta || proposta.is_avulso === true) return naoEncontrado();

  // 6. O token: a mesma função do botão da tela.
  const token = derivarTokenAreaCliente(idInt);
  if (!token) {
    console.error("[API][Parceiro][link-pagamento] Segredo da area do cliente ausente ou curto no servidor.");
    return indisponivel();
  }

  return resposta(200, { id_int: idInt, url: `${URL_BASE}/p/${token}` });
}
