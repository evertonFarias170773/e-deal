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
/** Linha de `usuarios` com o que a escolha da pessoa do link precisa. */
export type UsuarioDoCodigo = {
  user_id: string;
  id_vendedor: string | null;
  nome_usuario: string | null;
  meu_vendedor: string | null;
  is_vendedor: boolean | null;
  /** Perfil `pendente_aprovacao`: o resolver nao aceita essa pessoa. */
  perfil_pendente?: boolean;
};

/** Passa nos sinais que o resolver confere em `usuarios` e `perfis`. */
export function vendeEPodeTerLink(u: UsuarioDoCodigo): boolean {
  return u.is_vendedor === true && u.perfil_pendente !== true;
}

/**
 * De quem e o link, quando mais de um usuario tem o mesmo codigo de vendedor
 * (Edina e Edison; Lisiane e Everton). Mesma ordem do `cadastro_link_resolver`:
 * quem vende e nao esta pendente primeiro; entre esses, o dono do codigo
 * (user_id = id_vendedor) e depois por nome. Devolve null se o codigo nao tem
 * ninguem. Banimento e exclusao moram em `auth.users` e so o resolver confere.
 */
export function escolherPessoaDoCodigo<T extends UsuarioDoCodigo>(doCodigo: readonly T[], idVendedor: string): T | null {
  const ordenados = [...doCodigo].sort((a, b) => {
    const vende = Number(vendeEPodeTerLink(b)) - Number(vendeEPodeTerLink(a));
    if (vende !== 0) return vende;
    const dono = Number(b.user_id === idVendedor) - Number(a.user_id === idVendedor);
    if (dono !== 0) return dono;
    return String(a.nome_usuario ?? "").localeCompare(String(b.nome_usuario ?? ""), "pt-BR");
  });
  return ordenados[0] ?? null;
}

/**
 * Nome COMERCIAL do vendedor de um codigo: `meu_vendedor` (ou `nome_usuario`),
 * o mesmo texto que as propostas gravam e o ranking agrupa.
 *
 * O `cadastro_link_resolver` devolve so o PRIMEIRO nome, de proposito: e o que
 * a pagina publica mostra. Ate 04/10/2026 esse primeiro nome ("Emily") tambem
 * era gravado em `clientes.nome_vendedor` e na fila, e o cliente passava a
 * existir com um vendedor que nao e o nome de ninguem ("Emily" x "Emily
 * Boeira"). O que se GRAVA sai daqui; o primeiro nome fica so para a pagina.
 *
 * Mesma escolha de pessoa do resolver (`escolherPessoaDoCodigo`). Devolve null
 * se a leitura falhar ou o codigo nao tiver ninguem: quem chama decide o
 * fallback.
 */
export async function nomeComercialDoCodigo(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cliente: { from: (tabela: string) => any },
  idVendedor: string | null | undefined
): Promise<string | null> {
  if (!idVendedor) return null;
  try {
    const [{ data: doCodigo }, { data: pendentes }] = await Promise.all([
      cliente
        .from("usuarios")
        .select("user_id,id_vendedor,nome_usuario,meu_vendedor,is_vendedor,id_perfil")
        .eq("id_vendedor", idVendedor),
      cliente.from("perfis").select("id").eq("slug", "pendente_aprovacao")
    ]);
    const idsPendentes = new Set(((pendentes ?? []) as Array<{ id: unknown }>).map((p) => String(p.id)));
    const linhas = ((doCodigo ?? []) as Array<UsuarioDoCodigo & { id_perfil?: unknown }>).map((u) => ({
      ...u,
      perfil_pendente: u.id_perfil != null && idsPendentes.has(String(u.id_perfil))
    }));
    const pessoa = escolherPessoaDoCodigo(linhas, idVendedor);
    const nome = String(pessoa?.meu_vendedor ?? "").trim() || String(pessoa?.nome_usuario ?? "").trim();
    return nome || null;
  } catch {
    return null;
  }
}

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
