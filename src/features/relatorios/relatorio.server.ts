import type { NextRequest } from "next/server";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { verificarPermissaoServerSide } from "@/lib/auth/verificar-permissao";
import { buscarRelatorio } from "./registro";
import { diasDoPeriodo, ehDataIso } from "./lib/periodo";
import type { ConsultaRelatorio, RelatorioDef, ResultadoRelatorio } from "./types";

/**
 * Caminho único dos relatórios no servidor (24/10/2026): sessão, permissão, validação do
 * pedido, consulta e normalização. A rota de dados (`/api/relatorios/[slug]`) e a do PDF
 * (`/api/relatorios/[slug]/pdf`) passam por aqui, então as duas conferem a mesma permissão e
 * o mesmo período, e o PDF traz exatamente os números da tela.
 *
 * Somente leitura: nada é gravado.
 */

export type RespostaPipeline =
  | {
      ok: true;
      relatorio: RelatorioDef;
      consulta: ConsultaRelatorio;
      resultado: ResultadoRelatorio;
      usuario: { id: string; nome: string };
      supabase: SupabaseClient;
    }
  | { ok: false; status: number; error: string };

const falha = (status: number, error: string): RespostaPipeline => ({ ok: false, status, error });

export async function executarRelatorio(request: NextRequest, slug: string): Promise<RespostaPipeline> {
  const relatorio = buscarRelatorio(slug);
  if (!relatorio) return falha(404, "Relatório não encontrado.");

  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return falha(401, "Sessão não encontrada.");

  const supabase = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false }
    }
  );
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return falha(401, "Sessão inválida.");

  if (!(await verificarPermissaoServerSide(supabase, authData.user.id, relatorio.permissao))) {
    return falha(403, "Sem permissão para este relatório.");
  }

  const query = request.nextUrl.searchParams;
  const inicio = query.get("ini") ?? "";
  const fim = query.get("fim") ?? "";
  if (!ehDataIso(inicio) || !ehDataIso(fim) || inicio > fim) return falha(400, "Período inválido.");
  if (diasDoPeriodo({ inicio, fim }) > relatorio.periodo.maxDias) {
    return falha(400, `Período máximo de ${relatorio.periodo.maxDias} dias.`);
  }

  const filtros: Record<string, string> = {};
  for (const filtro of relatorio.filtros) {
    const valor = (query.get(filtro.chave) ?? "").trim();
    if (valor.length > 120) return falha(400, `Filtro ${filtro.rotulo} inválido.`);
    if (valor && filtro.opcoes && !filtro.opcoes.some((o) => o.valor === valor)) {
      return falha(400, `Filtro ${filtro.rotulo} inválido.`);
    }
    filtros[filtro.chave] = valor;
  }

  const consulta: ConsultaRelatorio = { inicio, fim, filtros };
  const { data, error } = relatorio.consultar
    ? await relatorio.consultar(supabase, consulta)
    : relatorio.rpc
      ? await supabase.rpc(relatorio.rpc.nome, relatorio.rpc.argumentos(consulta))
      : { data: null, error: { message: "Relatório sem fonte de dados." } };

  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "42501" || code === "28000") return falha(403, "Sem permissão para este relatório.");
    // 54000: a função recusou por volume (ex.: pagamentos demais para o período).
    if (code === "54000" || code === "LIMITE") {
      return falha(400, "Há registros demais no período. Escolha um período menor.");
    }
    console.error(`[relatorios/${slug}]`, error.message);
    return falha(500, "Não foi possível gerar o relatório.");
  }

  const { data: u } = await supabase
    .from("usuarios")
    .select("nome_usuario,email")
    .eq("user_id", authData.user.id)
    .maybeSingle();
  const nome = String((u as { nome_usuario?: string } | null)?.nome_usuario ?? "").trim();
  const email = String((u as { email?: string } | null)?.email ?? authData.user.email ?? "").trim();

  return {
    ok: true,
    relatorio,
    consulta,
    resultado: relatorio.normalizar(data),
    usuario: { id: authData.user.id, nome: nome || email || "Usuário" },
    supabase
  };
}
