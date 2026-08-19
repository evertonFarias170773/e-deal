/**
 * Rastreio de objeto dos Correios pelo próprio ERP.
 *
 * POR QUE ESTA ROTA EXISTE
 *   A API do SRO só devolve um objeto para a chave do contrato que o postou.
 *   O fluxo externo usado antes tinha uma credencial só, então rastreava a
 *   Ideal Gráfica e devolvia CORPO VAZIO para Birô e E3 — que a tela mostrava
 *   como "Resposta inesperada do rastreador", sem dizer nada de útil.
 *
 *   Aqui a consulta varre os contratos: começa pela empresa da proposta, que
 *   acerta de primeira no caso normal, e só então tenta as demais. Erro para o
 *   usuário só depois que TODAS falharem — e com o motivo real de cada desfecho.
 *
 * Somente leitura: nenhuma escrita em banco, nenhuma mudança de status.
 */
import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient as createServerSupabaseClient } from "@/lib/supabase/server";
import { verificarPermissaoServerSide } from "@/lib/auth/verificar-permissao";
import { empresasComRastro, rastrearObjetoCorreios } from "@/lib/correios/cws";
import type { CwsRastroObjeto } from "@/lib/correios/cws";
import { resolverEmpresaRemetente } from "@/lib/correios/empresa-remetente";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Formato dos códigos dos Correios (SEDEX/PAC e similares): AA123456789BR. */
const REGEX_CODIGO_CORREIOS = /^[A-Z]{2}\d{9}[A-Z]{2}$/;

export type RastroRotaResposta =
  | { success: true; objeto: CwsRastroObjeto; empresaId: number | null; empresaNome: string | null }
  | { success: false; motivo: string; message: string };

function erro(motivo: string, message: string, status: number) {
  return NextResponse.json({ success: false, motivo, message } satisfies RastroRotaResposta, { status });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const codigo = (searchParams.get("codigo") ?? "").trim().toUpperCase();
  const idIntBruto = Number(searchParams.get("id_int"));
  const idInt = Number.isInteger(idIntBruto) && idIntBruto > 0 ? idIntBruto : null;

  if (!codigo) return erro("SEM_CODIGO", "Informe o código de rastreio.", 400);
  if (!REGEX_CODIGO_CORREIOS.test(codigo)) {
    return erro(
      "NAO_E_CORREIOS",
      `"${codigo}" não tem o formato de um objeto dos Correios (ex.: AD123456789BR). Se for código de transportadora, consulte no site dela.`,
      422
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const supabase = token
    ? createSupabaseClient(url, anonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false }
      })
    : await createServerSupabaseClient();

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return erro("SESSAO", "Sessão expirada. Faça login novamente.", 401);
  const temPermissao = await verificarPermissaoServerSide(supabase, authData.user.id, "expedicao.view");
  if (!temPermissao) return erro("PERMISSAO", "Sem permissão para consultar rastreio (expedicao.view).", 403);

  const configuradas = empresasComRastro();
  if (configuradas.length === 0) {
    return erro("SEM_CREDENCIAL", "Nenhuma empresa tem credencial dos Correios configurada no servidor.", 503);
  }

  // Empresa da proposta primeiro: no caso normal acerta na primeira tentativa e
  // as outras nem são chamadas.
  let empresaPreferida: number | null = null;
  let nomePreferida: string | null = null;
  if (idInt !== null) {
    const { data: proposta } = await supabase.from("propostas").select("empresa").eq("id_int", idInt).maybeSingle();
    const empresaRow = await resolverEmpresaRemetente(supabase, proposta?.empresa);
    if (empresaRow?.id) {
      empresaPreferida = empresaRow.id;
      nomePreferida = empresaRow.nome_fantasia || empresaRow.razao_social || null;
    }
  }
  const ordem =
    empresaPreferida !== null
      ? [empresaPreferida, ...configuradas.filter((id) => id !== empresaPreferida)]
      : configuradas;

  // Guarda o primeiro erro REAL: se nenhum contrato tiver o objeto, mas alguma
  // consulta tiver falhado de verdade (chave sem permissão, Correios fora do
  // ar), essa é a notícia útil — não "não encontrado".
  let primeiroErro: { status: number; mensagem: string } | null = null;
  const tentadas: number[] = [];

  for (const id of ordem) {
    const r = await rastrearObjetoCorreios(codigo, id);
    if (r.situacao === "encontrado") {
      // Nome só para exibir "rastreado no contrato da <empresa>". Busca por id
      // direto: `resolverEmpresaRemetente` resolve por NOME e, sem match, cai na
      // primeira empresa — o que aqui daria o nome errado.
      let nome = id === empresaPreferida ? nomePreferida : null;
      if (nome === null) {
        const { data } = await supabase
          .from("empresas")
          .select("nome_fantasia, razao_social")
          .eq("id", id)
          .maybeSingle();
        nome = data?.nome_fantasia || data?.razao_social || null;
      }
      return NextResponse.json({
        success: true,
        objeto: r.objeto,
        empresaId: id,
        empresaNome: nome
      } satisfies RastroRotaResposta);
    }
    if (r.situacao === "erro" && !primeiroErro) primeiroErro = { status: r.status, mensagem: r.mensagem };
    if (r.situacao !== "sem_credencial") tentadas.push(id);
  }

  if (primeiroErro) {
    return erro(
      "FALHA_CORREIOS",
      `Os Correios não responderam à consulta: ${primeiroErro.mensagem}`,
      primeiroErro.status >= 400 && primeiroErro.status < 600 ? primeiroErro.status : 502
    );
  }

  return erro(
    "NAO_ENCONTRADO",
    tentadas.length > 1
      ? `Objeto ${codigo} não foi encontrado em nenhum dos ${tentadas.length} contratos configurados. Se a etiqueta acabou de ser gerada, os Correios podem levar alguns minutos para registrá-la.`
      : `Objeto ${codigo} não pertence ao contrato consultado. Se a etiqueta acabou de ser gerada, os Correios podem levar alguns minutos para registrá-la.`,
    404
  );
}
