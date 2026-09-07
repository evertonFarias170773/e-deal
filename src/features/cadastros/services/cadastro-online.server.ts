import crypto from "crypto";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Fronteira server-only do cadastro online.
 *
 * Espelha `os-qr-token.server.ts`, que e o padrao de token do projeto: HMAC
 * deterministico, so o hash no banco, revogacao por versao. A diferenca e o
 * TAMANHO: o os_qr usa 64 chars hex, que dariam uma URL de ~100 caracteres —
 * ruim para mandar no WhatsApp. Aqui o HMAC e truncado em 16 bytes e codificado
 * em base64url: 22 caracteres, 128 bits de entropia.
 *
 *   https://vibe.ai-ideal.com.br/c/Vt7kQ2mXpL9nR4sB8dF1gA
 *
 * 128 bits nao se quebra por forca bruta, e ainda ha rate limit por token no
 * banco. O token continua DERIVAVEL do segredo, entao o link e fixo e
 * permanente sem precisar de escrita nem de tabela de mapeamento.
 */

export const CADASTRO_LINK_VERSAO_ATUAL = 1;

/**
 * Piso de tempo da resposta publica.
 *
 * O caminho "ja cadastrado" so faz uma consulta indexada e responde em poucos
 * milissegundos. O caminho "cadastro novo" chama a Receita e escreve em tres
 * tabelas. Sem piso, o relogio separaria os dois casos, e o endpoint viraria um
 * oraculo de "esse CNPJ e cliente da Ideal?" — exatamente o que a resposta
 * mascarada existe para evitar.
 */
export const PISO_RESPOSTA_MS = 2500;

/**
 * Teto da consulta a Receita. Acima disso o cadastro e criado com o que o
 * cliente digitou, sem os dados publicos.
 */
export const RECEITA_TIMEOUT_MS = 4000;

export function cadastroOnlineFlagAtiva(): boolean {
  return process.env.CADASTRO_ONLINE_ENABLED === "true";
}

function segredo(): string | null {
  const valor = process.env.CADASTRO_LINK_TOKEN_SECRET;
  if (!valor || valor.trim().length < 16) return null;
  return valor;
}

/**
 * Token do link do vendedor. Deterministico: mesmo vendedor e mesma versao
 * sempre produzem o mesmo token, entao o link nunca precisa ser reemitido.
 * Trocar a versao mata o link antigo e cria o novo.
 */
export function derivarTokenCadastroLink(idVendedor: string, versao: number): string | null {
  const secret = segredo();
  if (!secret) return null;
  return crypto
    .createHmac("sha256", secret)
    .update(`cadastro-link:v${versao}:${idVendedor}`)
    .digest()
    .subarray(0, 16)
    .toString("base64url");
}

export function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/** HMAC do IP, truncado. O endereco em claro nunca e persistido. */
export function hashIpCadastro(ip: string): string | null {
  const secret = segredo();
  if (!secret) return null;
  return crypto.createHmac("sha256", secret).update(`ip:${ip}`).digest("hex").slice(0, 32);
}

export function criarClientServiceRole() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createSupabaseClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

/**
 * Mascara o nome de um cliente que JA EXISTE.
 *
 * Serve para a pessoa reconhecer o proprio cadastro ("sim, e a minha empresa")
 * sem que a resposta entregue a razao social a quem so tem o CNPJ.
 *
 * Duas escolhas deliberadas:
 *   - o numero de pontos e FIXO em tres, nao proporcional a palavra: mascara de
 *     tamanho variavel revelaria o comprimento de cada palavra;
 *   - no maximo 4 palavras, para que razao social longa nao vire um mapa da
 *     estrutura do nome.
 */
export function mascararNome(nome: string): string {
  const palavras = String(nome ?? "")
    .trim()
    .split(/\s+/)
    // Descarta separadores soltos ("-", "&", "/"), comuns em razao social:
    // mascarar um hifen produziria "-•••", que so polui e nao esconde nada.
    .filter((palavra) => /[\p{L}\p{N}]/u.test(palavra))
    .slice(0, 4);

  if (palavras.length === 0) return "•••";

  return palavras
    .map((palavra, indice) => {
      const visiveis = indice === 0 ? Math.min(2, palavra.length) : 1;
      return `${palavra.slice(0, visiveis)}•••`;
    })
    .join(" ");
}

/** Segura a resposta ate o piso. Se o trabalho ja demorou mais, devolve na hora. */
export async function esperarPiso(inicioMs: number, pisoMs: number = PISO_RESPOSTA_MS): Promise<void> {
  const restante = pisoMs - (Date.now() - inicioMs);
  if (restante <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, restante));
}

/**
 * Devolve a tentativa de rate limit que a ABERTURA DA PAGINA consumiu.
 *
 * O PROBLEMA
 * ----------
 * `cadastro_link_resolver` incrementa `rl_tentativas` em toda chamada bem
 * sucedida. Como a pagina resolve o token para mostrar o nome do vendedor, abrir
 * o formulario gastava 1 das 20 do teto por hora, e enviar gastava outra —
 * sobravam ~10 cadastros por hora por link. Pior: o robo de previa do WhatsApp e
 * do Telegram busca a URL ao montar o cartao da mensagem, e consumia tambem, sem
 * ninguem ter aberto nada.
 *
 * POR QUE ISSO E DESPERDICIO, E NAO PROTECAO
 * ------------------------------------------
 * O teto NAO defende contra adivinhacao de token. Quem chuta um token cai no
 * `if not found` do resolver, que retorna ANTES de tocar no contador — token
 * inexistente nao incrementa nada. O contador so limita o uso de um link que
 * EXISTE. Ou seja: contar a exibicao nao barra ataque nenhum, so estreita o uso
 * legitimo.
 *
 * A COMPENSACAO
 * -------------
 * O certo seria a RPC receber um parametro ("resolva, mas nao conte"), e isso e
 * `CREATE OR REPLACE FUNCTION` — migration. Sem tocar no banco, o efeito
 * identico se obtem devolvendo a tentativa logo depois: o estado final de
 * `rl_tentativas` fica exatamente o que seria se a chamada nao contasse.
 *
 * So e chamada quando a resolucao DEU CERTO, e so no caminho de exibicao. O
 * envio continua consumindo normalmente — e ele que precisa de teto.
 *
 * Leitura seguida de escrita, como os outros contadores: o PostgREST nao faz
 * `col = col - 1`. Duas aberturas simultaneas podem devolver so uma tentativa —
 * erra para o lado seguro, que e contar a mais.
 */
export async function devolverTentativaDeExibicao(
  service: NonNullable<ReturnType<typeof criarClientServiceRole>>,
  token: string
): Promise<void> {
  if (!token) return;
  try {
    const { data } = await service
      .from("cadastro_links")
      .select("id,rl_tentativas")
      .eq("token_hash", sha256Hex(token))
      .maybeSingle();
    if (!data) return;
    const atual = Number(data.rl_tentativas ?? 0);
    if (atual <= 0) return;
    await service
      .from("cadastro_links")
      .update({ rl_tentativas: atual - 1 })
      .eq("id", data.id);
  } catch (erro) {
    // Falhar aqui so deixa a tentativa contada — nao quebra a pagina.
    console.error("[cadastro-online] falha ao devolver tentativa de exibicao:", erro);
  }
}

/**
 * IP de origem. Best-effort: `x-forwarded-for` e controlado pelo cliente, e por
 * isso serve para rate limit de primeira linha e para correlacionar abuso, nunca
 * como identidade.
 */
export function ipDaRequisicao(request: Request): string {
  const encaminhado = request.headers.get("x-forwarded-for") ?? "";
  const primeiro = encaminhado.split(",")[0]?.trim();
  return primeiro || request.headers.get("x-real-ip")?.trim() || "desconhecido";
}
