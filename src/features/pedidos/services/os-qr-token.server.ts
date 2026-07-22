import crypto from "crypto";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Fronteira server-only do token do QR de produção.
 * - Deriva o token por HMAC-SHA256(OS_QR_TOKEN_SECRET, "os-qr:v{versao}:{id_int}").
 * - O banco guarda somente sha256(token) — via RPCs os_qr_preparar/os_qr_finalizar.
 * - os_qr_finalizar só é executável pelo backend confiável (service_role).
 * - Emissão/rotação idempotentes: perder a corrida NUNCA cria versão adicional —
 *   a rota re-prepara e rederiva do estado vencedor.
 */

export function osQrFlagAtiva(): boolean {
  return process.env.OS_QR_PUBLICO_ENABLED === "true";
}

export function derivarTokenOsQr(idInt: number, versao: number): string | null {
  const secret = process.env.OS_QR_TOKEN_SECRET;
  if (!secret || secret.trim().length < 16) return null;
  return crypto.createHmac("sha256", secret).update(`os-qr:v${versao}:${idInt}`).digest("hex");
}

export function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/** Hash de IP com o segredo como sal — nunca persistimos IP em claro. */
export function hashIpOsQr(ip: string): string | null {
  const secret = process.env.OS_QR_TOKEN_SECRET;
  if (!secret) return null;
  return crypto.createHmac("sha256", secret).update(`ip:${ip}`).digest("hex").slice(0, 32);
}

type PrepararResult = {
  ok: boolean;
  versao_ativa: number | null;
  token_hash_ativo: string | null;
  proxima_versao: number;
};

type FinalizarResult = {
  ok: boolean;
  motivo?: string;
  versao?: number;
  versao_ativa?: number | null;
  token_hash_ativo?: string | null;
  proxima_versao?: number;
};

type TokenResult = { success: true; token: string } | { success: false; error: string };

function criarClientServiceRole() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createSupabaseClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

function criarClientBearer(bearerToken: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return createSupabaseClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${bearerToken}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

async function preparar(bearerToken: string, idInt: number): Promise<PrepararResult | null> {
  const client = criarClientBearer(bearerToken);
  if (!client) return null;
  const { data, error } = await client.rpc("os_qr_preparar", { p_id_int: idInt });
  if (error || !data) {
    console.error("[os-qr-token] os_qr_preparar falhou:", error?.message);
    return null;
  }
  return data as PrepararResult;
}

/**
 * Obtém o token ativo da OS, emitindo a v1 quando não existir.
 * Reimpressão com ativo: zero escrita (só derivação + conferência de hash).
 */
export async function obterOuEmitirTokenOsQr(
  bearerToken: string,
  actorUid: string,
  idInt: number
): Promise<TokenResult> {
  const prep = await preparar(bearerToken, idInt);
  if (!prep?.ok) {
    return { success: false, error: "Falha ao preparar token do QR (permissão/escopo/migration)." };
  }

  // Reimpressão: ativo existente → deriva e confere o hash (sanity do segredo).
  if (prep.versao_ativa !== null && prep.token_hash_ativo) {
    const token = derivarTokenOsQr(idInt, prep.versao_ativa);
    if (!token) return { success: false, error: "OS_QR_TOKEN_SECRET ausente/inválido." };
    if (sha256Hex(token) !== prep.token_hash_ativo) {
      console.error(`[os-qr-token] Hash do token ativo não confere (id_int=${idInt}, v=${prep.versao_ativa}) — segredo trocado?`);
      return { success: false, error: "Token ativo não confere com o segredo atual — rotacione o QR desta OS." };
    }
    return { success: true, token };
  }

  // Emissão inicial via backend confiável.
  const service = criarClientServiceRole();
  if (!service) return { success: false, error: "SUPABASE_SERVICE_ROLE_KEY ausente — emissão de QR indisponível." };

  const versao = prep.proxima_versao;
  const token = derivarTokenOsQr(idInt, versao);
  if (!token) return { success: false, error: "OS_QR_TOKEN_SECRET ausente/inválido." };

  const { data, error } = await service.rpc("os_qr_finalizar", {
    p_actor_uid: actorUid,
    p_operacao: "emitir",
    p_id_int: idInt,
    p_versao_esperada: 0,
    p_nova_versao: versao,
    p_novo_token_hash: sha256Hex(token)
  });

  if (error) {
    console.error("[os-qr-token] os_qr_finalizar(emitir) falhou:", error.message);
    return { success: false, error: "Falha ao emitir token do QR." };
  }

  const fin = data as FinalizarResult;
  if (fin.ok) return { success: true, token };

  // Corrida perdida: outra emissão venceu — idempotente, usa o ativo vencedor.
  if (fin.motivo === "CONFLITO" && fin.versao_ativa != null && fin.token_hash_ativo) {
    const vencedor = derivarTokenOsQr(idInt, fin.versao_ativa);
    if (vencedor && sha256Hex(vencedor) === fin.token_hash_ativo) {
      return { success: true, token: vencedor };
    }
  }
  return { success: false, error: "Conflito na emissão do token do QR." };
}

/**
 * Rotaciona o token da OS (revoga o ativo + emite versão nova).
 * Em corrida perdida: 1 nova tentativa a partir do estado vencedor; persistindo
 * o conflito, retorna erro controlado mantendo o token ativo existente.
 */
export async function rotacionarTokenOsQr(
  bearerToken: string,
  actorUid: string,
  idInt: number
): Promise<{ success: true; versao: number } | { success: false; error: string }> {
  const service = criarClientServiceRole();
  if (!service) return { success: false, error: "SUPABASE_SERVICE_ROLE_KEY ausente — rotação indisponível." };

  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const prep = await preparar(bearerToken, idInt);
    if (!prep?.ok) {
      return { success: false, error: "Falha ao preparar rotação (permissão/escopo/migration)." };
    }
    if (prep.versao_ativa === null) {
      return { success: false, error: "Nenhum QR ativo para esta OS — imprima a OS primeiro." };
    }

    const novaVersao = prep.proxima_versao;
    const novoToken = derivarTokenOsQr(idInt, novaVersao);
    if (!novoToken) return { success: false, error: "OS_QR_TOKEN_SECRET ausente/inválido." };

    const { data, error } = await service.rpc("os_qr_finalizar", {
      p_actor_uid: actorUid,
      p_operacao: "rotacionar",
      p_id_int: idInt,
      p_versao_esperada: prep.versao_ativa,
      p_nova_versao: novaVersao,
      p_novo_token_hash: sha256Hex(novoToken)
    });

    if (error) {
      console.error("[os-qr-token] os_qr_finalizar(rotacionar) falhou:", error.message);
      return { success: false, error: "Falha ao rotacionar o token do QR." };
    }

    const fin = data as FinalizarResult;
    if (fin.ok && fin.versao != null) {
      return { success: true, versao: fin.versao };
    }
    // CONFLITO → repete preparar/derivação (sem criar versão adicional).
  }

  return { success: false, error: "Outra rotação/emissão concluiu antes — o QR ativo atual foi mantido." };
}
