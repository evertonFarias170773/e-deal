import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { verificarPermissaoServerSide } from "@/lib/auth/verificar-permissao";
import { cabecalhosWebhookN8n } from "@/lib/n8n/webhook-segredo";
import {
  MAXIMO_CORRECAO,
  MINIMO_CORRECAO,
  montarEventoCartaCorrecao,
  parseFocusResponse
} from "@/lib/fiscal/carta-correcao";

/**
 * POST /api/fiscal/carta-correcao — envia a Carta de Correção (CC-e) de uma NF-e.
 *
 * POR QUE UMA ROTA
 *   Até 02/10/2026 a tela chamava o webhook do n8n direto do navegador, sem
 *   sessão e sem permissão, e gravava o evento ela mesma: quem via a tela de
 *   Notas fiscais (inclusive perfil só de visualização) enviava carta de
 *   correção. Aqui a sessão e a chave `fiscal.carta_correcao` são conferidas no
 *   servidor, a empresa é relida do banco (nada do corpo além de `ref` e
 *   `correcao` é usado) e o evento é gravado com a autoria de quem pediu.
 *
 * O QUE NÃO MUDA
 *   O corpo enviado ao webhook é o de sempre: `id_empresa`, `referencia`,
 *   `correcao`. A leitura da resposta e os campos do evento são os que a tela
 *   usava (`@/lib/fiscal/carta-correcao`).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PERMISSAO = "fiscal.carta_correcao";
const WEBHOOK_CARTA_CORRECAO = "https://10074.hostoo.net.br/webhook/carta-correcao";
/** Carta de correção só existe para nota autorizada. */
const STATUS_CORRIGIVEL = "AUTORIZADA";

function recusa(message: string, status: number, code?: string) {
  return NextResponse.json({ success: false, ...(code ? { code } : {}), message }, { status });
}

export async function POST(request: Request) {
  try {
    // 1. Do corpo vêm só a referência e o texto. Todo o resto é relido.
    let ref = "";
    let correcao = "";
    try {
      const body = (await request.json()) as { ref?: unknown; correcao?: unknown };
      ref = String(body?.ref ?? "").trim();
      correcao = String(body?.correcao ?? "").trim();
    } catch {
      return recusa("Corpo da requisição inválido.", 400);
    }
    if (!ref) return recusa("Referência da nota ausente.", 400);
    if (correcao.length < MINIMO_CORRECAO) {
      return recusa(`O texto da correção deve conter pelo menos ${MINIMO_CORRECAO} caracteres.`, 400, "CORRECAO_CURTA");
    }
    if (correcao.length > MAXIMO_CORRECAO) {
      return recusa(`O texto da correção aceita no máximo ${MAXIMO_CORRECAO} caracteres.`, 400, "CORRECAO_LONGA");
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      console.error("[API][CartaCorrecao] ENV AUSENTE");
      return recusa("Erro interno no servidor de banco de dados.", 500);
    }

    // 2. Sessão. JWT do usuário, sem service role — a RLS continua valendo.
    const authHeader = request.headers.get("authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) return recusa("Sessão não encontrada.", 401);

    const supabase = createSupabaseClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) return recusa("Sessão inválida.", 401);

    // 3. Permissão, conferida aqui. A tela apenas esconde o item.
    const temPermissao = await verificarPermissaoServerSide(supabase, authData.user.id, PERMISSAO);
    if (!temPermissao) {
      return recusa(`Sem permissão para emitir carta de correção (${PERMISSAO}).`, 403, "SEM_PERMISSAO");
    }

    // 4. Releitura da nota: a empresa e o status saem do banco.
    const { data: nota, error: notaError } = await supabase
      .from("notas_fiscais")
      .select("id, ref, status, id_empresa")
      .eq("ref", ref)
      .maybeSingle<{ id: string; ref: string; status: string | null; id_empresa: number | null }>();
    if (notaError) {
      console.error("[API][CartaCorrecao] Falha ao reler a NF-e:", notaError.message);
      return recusa("Não foi possível ler a nota no banco.", 500);
    }
    if (!nota) return recusa("Nota fiscal não encontrada.", 404, "NOTA_NAO_ENCONTRADA");

    const status = String(nota.status ?? "").toUpperCase();
    if (status !== STATUS_CORRIGIVEL) {
      return recusa(
        `Carta de correção não permitida: a nota está em "${status || "SEM STATUS"}" e só pode ser corrigida quando está "${STATUS_CORRIGIVEL}".`,
        409,
        "NOTA_NAO_CORRIGIVEL"
      );
    }
    const idEmpresa = Number(nota.id_empresa);
    if (!Number.isFinite(idEmpresa) || idEmpresa <= 0) {
      return recusa("A empresa emitente não foi identificada.", 409, "EMPRESA_NAO_IDENTIFICADA");
    }

    // 5. O webhook do n8n, com o mesmo corpo de sempre, agora do servidor.
    let response: Response;
    try {
      response = await fetch(WEBHOOK_CARTA_CORRECAO, {
        method: "POST",
        headers: cabecalhosWebhookN8n(),
        body: JSON.stringify({ id_empresa: idEmpresa, referencia: nota.ref, correcao })
      });
    } catch (erro) {
      console.error("[API][CartaCorrecao] Webhook inalcançável:", erro);
      return recusa("Não foi possível contatar a integração fiscal. Nenhuma carta foi enviada.", 502, "INTEGRACAO_INDISPONIVEL");
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      return recusa("A resposta da API de Carta de Correção não é um JSON válido.", 502, "RESPOSTA_INVALIDA");
    }
    if (!response.ok) {
      const d = data as { erro?: { mensagem?: string }; error?: string; message?: string } | null;
      return recusa(d?.erro?.mensagem || d?.error || d?.message || `Erro HTTP ${response.status}`, 502, "INTEGRACAO_RECUSOU");
    }

    const interpretado = parseFocusResponse(data);
    if (!interpretado.success) {
      return recusa(interpretado.message, 422, "CARTA_RECUSADA");
    }

    // 6. O evento, com a autoria de quem pediu. A carta já foi aceita: falha
    //    aqui não desfaz nada na SEFAZ, então a rota responde sucesso e avisa.
    const { data: usuarioRow } = await supabase
      .from("usuarios")
      .select("nome_usuario")
      .eq("user_id", authData.user.id)
      .maybeSingle<{ nome_usuario: string | null }>();

    const evento = montarEventoCartaCorrecao({
      ref: nota.ref,
      idEmpresa,
      correcao,
      respostaDaIntegracao: data,
      criadoPor: authData.user.id,
      criadoPorNome: usuarioRow?.nome_usuario || authData.user.email || null
    });
    const { error: eventoError } = await supabase.from("notas_eventos").insert(evento);
    if (eventoError) {
      console.error("[API][CartaCorrecao] Carta enviada, mas o evento não foi gravado:", eventoError.message, JSON.stringify({ ref: nota.ref, uid: authData.user.id }));
    }

    return NextResponse.json({
      success: true,
      message: interpretado.message,
      eventoGravado: !eventoError
    });
  } catch (error: unknown) {
    console.error("[API][CartaCorrecao] Exceção:", error);
    return recusa("Falha inesperada ao enviar a carta de correção.", 500);
  }
}
