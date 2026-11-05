import { NextResponse } from "next/server";
import { autenticarEmissorDeNfse, clienteDeServico, respostaDeErro } from "@/features/nfse/services/nfse-pedido.server";
import { competenciaDoTexto, conferirPercentual } from "@/features/nfse/lib/percentual-simples";

/**
 * Percentual do Simples (Lei 12.741) por empresa e mês — Configurações → Empresas
 * (05/11/2026). Tabela `empresas_percentual_simples`.
 *
 *   GET  → as empresas e todos os meses cadastrados (mais novo primeiro).
 *   POST { id_empresa, competencia: "MM/AAAA", percentual: "15,20", observacao? }
 *        → grava o mês; se o mês já existe, CORRIGE (o valor anterior fica na
 *          auditoria, audit.logs_v2). Não há excluir: o histórico fica.
 *
 * PERMISSÃO: a de emitir NFS-e (`fiscal.emit_nfse`; administrador e super
 * administrador pelo padrão). Quem emite a nota é quem mantém o número dela.
 *
 * A escrita é com a chave de serviço (a tabela é só leitura para o usuário
 * logado); o autor sai do cadastro do usuário, nunca do navegador.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Linha = {
  id: number;
  id_empresa: number;
  competencia: string;
  percentual: number | string;
  observacao: string | null;
  criado_por_nome: string | null;
  created_at: string;
  atualizado_por_nome: string | null;
  updated_at: string;
};

const COLUNAS = "id, id_empresa, competencia, percentual, observacao, criado_por_nome, created_at, atualizado_por_nome, updated_at";

export async function GET(request: Request) {
  const sessao = await autenticarEmissorDeNfse(request);
  if (sessao instanceof NextResponse) return sessao;

  const [empresasRes, linhasRes] = await Promise.all([
    sessao.supabase.from("empresas").select("id, nome_fantasia, razao_social, habilita_nfse").order("id", { ascending: true }),
    sessao.supabase.from("empresas_percentual_simples").select(COLUNAS).order("competencia", { ascending: false })
  ]);
  if (empresasRes.error) return respostaDeErro(500, "Não foi possível ler as empresas.");
  if (linhasRes.error) return respostaDeErro(500, "Não foi possível ler os percentuais cadastrados.");

  return NextResponse.json(
    {
      success: true,
      empresas: (empresasRes.data ?? []).map((e) => ({
        id: Number(e.id),
        nome: String(e.nome_fantasia || e.razao_social || `Empresa ${e.id}`),
        habilitaNfse: e.habilita_nfse === true
      })),
      percentuais: ((linhasRes.data ?? []) as Linha[]).map((l) => ({ ...l, percentual: Number(l.percentual) }))
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(request: Request) {
  const sessao = await autenticarEmissorDeNfse(request);
  if (sessao instanceof NextResponse) return sessao;

  const corpo = (await request.json().catch(() => null)) as
    | { id_empresa?: unknown; competencia?: unknown; percentual?: unknown; observacao?: unknown }
    | null;
  const idEmpresa = Number(corpo?.id_empresa);
  if (!Number.isInteger(idEmpresa) || idEmpresa <= 0) return respostaDeErro(400, "Escolha a empresa.");
  const competencia = competenciaDoTexto(String(corpo?.competencia ?? ""));
  if (!competencia) return respostaDeErro(400, "Mês inválido. Use MM/AAAA, por exemplo 11/2026.");
  const percentual = conferirPercentual(corpo?.percentual as string | number | null | undefined);
  if (!percentual.ok) return respostaDeErro(400, percentual.mensagem);
  const observacao = String(corpo?.observacao ?? "").trim().slice(0, 500) || null;

  const servico = clienteDeServico();
  if (!servico) return respostaDeErro(500, "Chave de serviço não configurada no servidor.");

  const { data: empresa } = await sessao.supabase.from("empresas").select("id").eq("id", idEmpresa).maybeSingle();
  if (!empresa) return respostaDeErro(404, `Empresa ${idEmpresa} não encontrada.`);

  const { data: existente, error: leituraErro } = await servico
    .from("empresas_percentual_simples")
    .select("id")
    .eq("id_empresa", idEmpresa)
    .eq("competencia", competencia)
    .maybeSingle();
  if (leituraErro) return respostaDeErro(500, "Não foi possível ler o mês no banco.");

  const autor = { atualizado_por: sessao.userId, atualizado_por_nome: sessao.nomeDoUsuario, updated_at: new Date().toISOString() };
  const gravacao = existente
    ? servico
        .from("empresas_percentual_simples")
        .update({ percentual: percentual.valor, observacao, ...autor })
        .eq("id", (existente as { id: number }).id)
        .select(COLUNAS)
        .single()
    : servico
        .from("empresas_percentual_simples")
        .insert({
          id_empresa: idEmpresa,
          competencia,
          percentual: percentual.valor,
          observacao,
          criado_por: sessao.userId,
          criado_por_nome: sessao.nomeDoUsuario,
          ...autor
        })
        .select(COLUNAS)
        .single();
  const { data: gravado, error: gravacaoErro } = await gravacao;
  if (gravacaoErro || !gravado) {
    console.error("[API][PercentualSimples] Falha ao gravar:", gravacaoErro?.message);
    return respostaDeErro(500, "Não foi possível gravar o percentual.");
  }

  return NextResponse.json(
    { success: true, corrigido: Boolean(existente), percentual: { ...(gravado as Linha), percentual: Number((gravado as Linha).percentual) } },
    { headers: { "Cache-Control": "no-store" } }
  );
}
