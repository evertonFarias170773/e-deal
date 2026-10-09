import "server-only";

/**
 * Cliente SERVER-ONLY da API EDI da Azul Logistica (toolkit de integracao).
 *
 * Tudo vem de variavel de ambiente, lida so aqui:
 *   AZUL_EDI_EMAIL, AZUL_EDI_SENHA        credenciais do usuario EDI
 *   AZUL_EDI_AMBIENTE                     "sandbox" (padrao) | "producao"
 *   AZUL_EDI_BASE_URL                     opcional; sem ela, a do ambiente
 *   AZUL_EDI_CONTA_CNPJ                   CNPJ da conta corrente da Ideal (PX)
 *   AZUL_EDI_UNIDADE_ORIGEM               sigla da base de origem
 *   AZUL_EDI_SEGURO_PROPRIO               "1" (seguro cadastrado na Azul) | "0"
 *   AZUL_EDI_SEGURO_APOLICE               apolice, obrigatoria quando "1"
 *   AZUL_PRODUTO_NATUREZA                 texto inicial da natureza do produto
 *
 * SANDBOX POR PADRAO. Producao so com AZUL_EDI_AMBIENTE=producao; e com ambiente
 * diferente de producao, uma base de URL que aponte para o host de producao e
 * recusada — nenhum erro de digitacao manda emissao real para a Azul.
 *
 * Nada aqui loga senha, token ou corpo de requisicao.
 */

const BASE_SANDBOX = "https://hmg.onlineapp.com.br/EDIv2_API_INTEGRACAO_Toolkit";
const BASE_PRODUCAO = "https://ediapi.onlineapp.com.br/toolkit";
const HOST_PRODUCAO = "ediapi.onlineapp.com.br";

/** O token vale 8h; renova 30 min antes para nao usar um que expira no meio da chamada. */
const VALIDADE_TOKEN_MS = (8 * 60 - 30) * 60 * 1000;
/**
 * Timeouts. Só o Enviar cria algo na Azul e pode demorar: 30 s. Autenticação e
 * consulta de base são leituras: 10 s. A função da Vercel tem 60 s (maxDuration);
 * o pior caso com renovação de token — 10 (auth) + 30 (Enviar recusado com 401)
 * + 10 (auth) + 30 (Enviar) — só passa de 60 s se o primeiro Enviar demorar quase
 * o timeout inteiro para responder 401, o que não é o comportamento esperado.
 * Timeout do Enviar não repete: vira "incerto".
 */
const TIMEOUT_LEITURA_MS = 10_000;
const TIMEOUT_ENVIO_MS = 30_000;

export type ConfigAzul = {
  email: string;
  senha: string;
  ambiente: "sandbox" | "producao";
  baseUrl: string;
  contaCnpj: string;
  unidadeOrigem: string;
  seguroProprio: "0" | "1";
  seguroApolice: string | null;
};

export type ResultadoConfigAzul =
  | { ok: true; config: ConfigAzul }
  | { ok: false; faltando: string[]; mensagem: string };

const env = (nome: string): string => String(process.env[nome] ?? "").trim();

export function lerConfigAzul(): ResultadoConfigAzul {
  const ambiente = env("AZUL_EDI_AMBIENTE").toLowerCase() === "producao" ? "producao" : "sandbox";
  const baseUrl = (env("AZUL_EDI_BASE_URL") || (ambiente === "producao" ? BASE_PRODUCAO : BASE_SANDBOX)).replace(/\/+$/, "");
  const seguro = env("AZUL_EDI_SEGURO_PROPRIO");
  const apolice = env("AZUL_EDI_SEGURO_APOLICE");

  const faltando: string[] = [];
  if (!env("AZUL_EDI_EMAIL")) faltando.push("AZUL_EDI_EMAIL");
  if (!env("AZUL_EDI_SENHA")) faltando.push("AZUL_EDI_SENHA");
  if (!env("AZUL_EDI_CONTA_CNPJ")) faltando.push("AZUL_EDI_CONTA_CNPJ");
  if (!env("AZUL_EDI_UNIDADE_ORIGEM")) faltando.push("AZUL_EDI_UNIDADE_ORIGEM");
  if (seguro !== "0" && seguro !== "1") faltando.push("AZUL_EDI_SEGURO_PROPRIO (0 ou 1)");
  if (seguro === "1" && !apolice) faltando.push("AZUL_EDI_SEGURO_APOLICE");
  if (faltando.length > 0) {
    return {
      ok: false,
      faltando,
      mensagem: `Integração com a Azul não configurada no servidor. Falta: ${faltando.join(", ")}.`
    };
  }

  let host = "";
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return { ok: false, faltando: ["AZUL_EDI_BASE_URL"], mensagem: "AZUL_EDI_BASE_URL inválida." };
  }
  if (ambiente !== "producao" && host === HOST_PRODUCAO) {
    return {
      ok: false,
      faltando: ["AZUL_EDI_AMBIENTE"],
      mensagem: "A URL base aponta para a produção da Azul, mas AZUL_EDI_AMBIENTE não é \"producao\". Nada foi enviado."
    };
  }

  return {
    ok: true,
    config: {
      email: env("AZUL_EDI_EMAIL"),
      senha: env("AZUL_EDI_SENHA"),
      ambiente,
      baseUrl,
      contaCnpj: env("AZUL_EDI_CONTA_CNPJ").replace(/\D/g, ""),
      unidadeOrigem: env("AZUL_EDI_UNIDADE_ORIGEM"),
      seguroProprio: seguro as "0" | "1",
      seguroApolice: seguro === "1" ? apolice : null
    }
  };
}

/** Texto inicial da natureza do produto no modal (editavel pelo operador). */
export function naturezaProdutoPadrao(): string {
  return env("AZUL_PRODUTO_NATUREZA");
}

/**
 * Desfecho de uma chamada. `incerto` e o unico que NAO permite concluir se a
 * Azul processou: timeout, queda de conexao ou 5xx depois do envio.
 */
export type RespostaAzul =
  | { desfecho: "ok"; value: unknown }
  | { desfecho: "erro"; texto: string; http: number }
  | { desfecho: "incerto"; texto: string };

type CorpoPadrao = { HasErrors?: boolean; ErrorText?: string | null; Value?: unknown };

async function chamar(config: ConfigAzul, caminho: string, corpo: unknown, timeoutMs: number): Promise<RespostaAzul> {
  let res: Response;
  try {
    res = await fetch(`${config.baseUrl}${caminho}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(corpo),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (e) {
    const nome = e instanceof Error ? e.name : "";
    return {
      desfecho: "incerto",
      texto: nome === "TimeoutError" || nome === "AbortError" ? "A Azul não respondeu a tempo." : "Falha de conexão com a Azul."
    };
  }

  const bruto = await res.text().catch(() => "");
  let json: CorpoPadrao | null = null;
  try {
    json = bruto ? (JSON.parse(bruto) as CorpoPadrao) : null;
  } catch {
    json = null;
  }

  if (res.status >= 500) return { desfecho: "incerto", texto: `A Azul respondeu com erro interno (HTTP ${res.status}).` };
  if (json && json.HasErrors === false) return { desfecho: "ok", value: json.Value };
  if (json && json.HasErrors === true) {
    return { desfecho: "erro", texto: String(json.ErrorText ?? "").trim() || "A Azul recusou a requisição.", http: res.status };
  }
  if (res.ok) {
    // 2xx sem o envelope padrao: nao da para afirmar nem sucesso nem recusa.
    return { desfecho: "incerto", texto: "Resposta da Azul fora do formato esperado." };
  }
  return { desfecho: "erro", texto: `A Azul recusou a requisição (HTTP ${res.status}).`, http: res.status };
}

// Cache do token por instancia do servidor (chave: base + usuario).
const cacheToken = new Map<string, { token: string; expiraEm: number }>();

function chaveCache(config: ConfigAzul): string {
  return `${config.baseUrl}|${config.email}`;
}

async function obterToken(config: ConfigAzul, forcar: boolean): Promise<{ token: string } | { erro: string }> {
  const chave = chaveCache(config);
  const guardado = cacheToken.get(chave);
  if (!forcar && guardado && guardado.expiraEm > Date.now()) return { token: guardado.token };

  const r = await chamar(config, "/api/Autenticacao/AutenticarUsuario", { Email: config.email, Senha: config.senha }, TIMEOUT_LEITURA_MS);
  if (r.desfecho !== "ok" || typeof r.value !== "string" || !r.value) {
    return { erro: r.desfecho === "ok" ? "A Azul não devolveu o token de acesso." : `Autenticação na Azul falhou: ${r.texto}` };
  }
  cacheToken.set(chave, { token: r.value, expiraEm: Date.now() + VALIDADE_TOKEN_MS });
  return { token: r.value };
}

function tokenRecusado(r: RespostaAzul): boolean {
  if (r.desfecho !== "erro") return false;
  return r.http === 401 || /token.*(inv[aá]lid|expir)|(inv[aá]lid|expir).*token/i.test(r.texto);
}

/**
 * Chamada autenticada: o token vai NO CORPO. Em 401 (ou "token expirado") renova
 * uma vez e repete — seguro porque recusa por token nao processa nada na Azul.
 */
export async function chamarAzul(
  config: ConfigAzul,
  caminho: string,
  corpo: Record<string, unknown>,
  timeoutMs: number = TIMEOUT_ENVIO_MS
): Promise<RespostaAzul> {
  for (const forcar of [false, true]) {
    const t = await obterToken(config, forcar);
    if ("erro" in t) return { desfecho: "erro", texto: t.erro, http: 0 };
    const r = await chamar(config, caminho, { ...corpo, Token: t.token }, timeoutMs);
    if (!forcar && tokenRecusado(r)) {
      cacheToken.delete(chaveCache(config));
      continue;
    }
    return r;
  }
  return { desfecho: "erro", texto: "A Azul recusou o token de acesso.", http: 401 };
}

/** Base de destino por CEP (`Unidades/LocalizarUnidades`, Pais vazio como na doc); nulo se nao localizar. */
export async function localizarBaseDestino(config: ConfigAzul, cep: string): Promise<string | null> {
  const r = await chamarAzul(config, "/api/Unidades/LocalizarUnidades", { Pais: "", Cep: cep.replace(/\D/g, "") }, TIMEOUT_LEITURA_MS);
  if (r.desfecho !== "ok" || !Array.isArray(r.value)) return null;
  const primeira = r.value.find((u): u is { Base?: unknown } => typeof u === "object" && u !== null);
  const base = String(primeira?.Base ?? "").trim();
  return base || null;
}
