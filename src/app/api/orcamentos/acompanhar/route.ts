import { NextResponse } from "next/server";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { createClient as createServerSupabaseClient } from "@/lib/supabase/server";
import { verificarPermissaoServerSide } from "@/lib/auth/verificar-permissao";
import {
  TETO_GRUPO,
  lerIds,
  mensagemDeErroAcompanhar,
  montarCandidatos,
  motivoSomenteLeitura,
  podeSerCandidato,
  type PedidoParaAcompanhar
} from "@/features/orcamentos/lib/acompanhar-pedido";

/**
 * ACOMPANHAR PEDIDO (Fase 7): le e grava o grupo na hora, SEM passar pelo
 * Salvar do orcamento.
 *
 * O QUE GRAVA: so `pedidos_vinculos`, e so pelas funcoes `vincular_pedidos` e
 * `soltar_pedido_vinculo`, chamadas com a SESSAO de quem clicou (o id do usuario
 * vem do token, nunca do corpo). Nao toca em `propostas` (nem updated_at, valor,
 * frete ou status): por isso funciona com a edicao bloqueada por cobranca.
 * NAO existe vinculo financeiro nem divisao de frete.
 *
 * GET  ?id_int=X[&q=numero]   estado do pedido: grupo, membros, candidatos
 * POST { acao: "vincular", id_int, outros: number[] }
 * POST { acao: "soltar",   id_int, motivo, solta?: number }   (solta = o pedido a tirar; padrao o proprio)
 *
 * Permissao: `propostas.edit` para vincular. Para soltar vale `propostas.edit`
 * ou `expedicao.admin`; a regra fina (quem criou a ligacao ou admin) e do banco.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Sessao = { supabase: SupabaseClient; uid: string };

async function abrirSessao(request: Request): Promise<Sessao | NextResponse> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  if (!url || !anonKey) return NextResponse.json({ success: false, message: "Supabase nao configurado no servidor." }, { status: 500 });
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const supabase = token
    ? createSupabaseClient(url, anonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false }
      })
    : await createServerSupabaseClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return NextResponse.json({ success: false, message: mensagemDeErroAcompanhar(401, null, null) }, { status: 401 });
  }
  return { supabase: supabase as SupabaseClient, uid: data.user.id };
}

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

type PropostaLinha = {
  id_int: number;
  cliente: string | null;
  id_cliente: number | null;
  id_faturado: number | null;
  status_interno: string | null;
  created_at: string | null;
  is_avulso: boolean | null;
  encerrado_teste_em: string | null;
};
const COLUNAS = "id_int, cliente, id_cliente, id_faturado, status_interno, created_at, is_avulso, encerrado_teste_em";

/** Despachados entre os ids (marcador oficial: expedicoes.data_despacho). */
async function despachadosEntre(supabase: SupabaseClient, ids: number[]): Promise<Set<number>> {
  if (ids.length === 0) return new Set();
  const { data } = await supabase.from("expedicoes").select("id_int").in("id_int", ids).not("data_despacho", "is", null);
  return new Set(((data ?? []) as { id_int: number }[]).map((r) => Number(r.id_int)));
}

/** Para cada id, o grupo ACOMPANHAR ativo e os membros dele. */
async function gruposAcompanhar(supabase: SupabaseClient, ids: number[]) {
  const porPedido = new Map<number, { grupoId: string; membros: number[] }>();
  if (ids.length === 0) return porPedido;
  const { data: minhas } = await supabase
    .from("pedidos_vinculos")
    .select("grupo_id, id_int")
    .eq("tipo", "ACOMPANHAR")
    .is("saiu_em", null)
    .in("id_int", ids);
  const grupos = Array.from(new Set(((minhas ?? []) as { grupo_id: string }[]).map((r) => r.grupo_id)));
  if (grupos.length === 0) return porPedido;
  const { data: todas } = await supabase
    .from("pedidos_vinculos")
    .select("grupo_id, id_int, ordem")
    .eq("tipo", "ACOMPANHAR")
    .is("saiu_em", null)
    .in("grupo_id", grupos)
    .order("ordem", { ascending: true });
  const membrosDe = new Map<string, number[]>();
  for (const r of (todas ?? []) as { grupo_id: string; id_int: number }[]) {
    membrosDe.set(r.grupo_id, [...(membrosDe.get(r.grupo_id) ?? []), Number(r.id_int)]);
  }
  for (const r of (minhas ?? []) as { grupo_id: string; id_int: number }[]) {
    porPedido.set(Number(r.id_int), { grupoId: r.grupo_id, membros: membrosDe.get(r.grupo_id) ?? [] });
  }
  return porPedido;
}

function paraPedido(p: PropostaLinha, despachados: Set<number>, grupos: Map<number, { grupoId: string; membros: number[] }>): PedidoParaAcompanhar {
  return {
    idInt: Number(p.id_int),
    idCliente: num(p.id_cliente),
    idFaturado: num(p.id_faturado),
    cliente: p.cliente ?? "",
    statusInterno: p.status_interno ?? "",
    criadoEm: p.created_at,
    avulso: p.is_avulso === true,
    encerradoTeste: Boolean(p.encerrado_teste_em),
    despachado: despachados.has(Number(p.id_int)),
    grupoAcompanhar: grupos.get(Number(p.id_int)) ?? null
  };
}

/** Estado completo do pedido para a aba Fretes. Leitura pura. */
async function montarEstado(sessao: Sessao, idInt: number, busca: string) {
  const { supabase, uid } = sessao;
  const [podeEditar, ehAdminExpedicao] = await Promise.all([
    verificarPermissaoServerSide(supabase, uid, "propostas.edit"),
    verificarPermissaoServerSide(supabase, uid, "expedicao.admin")
  ]);
  const { data: proprio } = await supabase.from("propostas").select(COLUNAS).eq("id_int", idInt).maybeSingle();
  if (!proprio) return null;
  const p = proprio as PropostaLinha;

  const grupos = await gruposAcompanhar(supabase, [idInt]);
  const meu = grupos.get(idInt) ?? null;

  // Membros do grupo (inclui o proprio), com o que a tela mostra.
  let membros: {
    idInt: number;
    cliente: string;
    statusInterno: string;
    criadoEm: string | null;
    criadoPorNome: string | null;
    proprio: boolean;
  }[] = [];
  if (meu) {
    const { data: linhas } = await supabase
      .from("pedidos_vinculos")
      .select("id_int, ordem, criado_por_nome")
      .eq("grupo_id", meu.grupoId)
      .is("saiu_em", null)
      .order("ordem", { ascending: true });
    const ids = ((linhas ?? []) as { id_int: number }[]).map((l) => Number(l.id_int));
    const { data: props } = ids.length ? await supabase.from("propostas").select(COLUNAS).in("id_int", ids) : { data: [] };
    const porId = new Map(((props ?? []) as PropostaLinha[]).map((x) => [Number(x.id_int), x]));
    membros = ((linhas ?? []) as { id_int: number; criado_por_nome: string | null }[]).map((l) => {
      const x = porId.get(Number(l.id_int));
      return {
        idInt: Number(l.id_int),
        cliente: x?.cliente ?? "",
        statusInterno: x?.status_interno ?? "",
        criadoEm: x?.created_at ?? null,
        criadoPorNome: l.criado_por_nome ?? null,
        proprio: Number(l.id_int) === idInt
      };
    });
  }

  const despachadosProprio = await despachadosEntre(supabase, [idInt]);
  const somenteLeitura = motivoSomenteLeitura({
    statusInterno: p.status_interno ?? "",
    despachado: despachadosProprio.has(idInt),
    avulso: p.is_avulso === true,
    encerradoTeste: Boolean(p.encerrado_teste_em)
  });

  let candidatos: ReturnType<typeof montarCandidatos> = [];
  if (podeEditar && !somenteLeitura) {
    const ref = { idInt, idCliente: num(p.id_cliente), idFaturado: num(p.id_faturado) };
    const filtros = [ref.idCliente !== null ? `id_cliente.eq.${ref.idCliente}` : null, ref.idFaturado !== null ? `id_faturado.eq.${ref.idFaturado}` : null].filter(Boolean);
    if (filtros.length > 0) {
      const termo = busca.replace(/\D/g, "");
      let consulta = supabase.from("propostas").select(COLUNAS).or(filtros.join(",")).neq("id_int", idInt).order("id_int", { ascending: false }).limit(300);
      if (termo && termo.length >= 1 && termo.length <= 9) {
        // Busca por numero: acha qualquer elegivel, nao so os 300 mais novos.
        consulta = supabase.from("propostas").select(COLUNAS).or(filtros.join(",")).neq("id_int", idInt).eq("id_int", Number(termo)).limit(1);
      }
      const { data } = await consulta;
      const linhas = (data ?? []) as PropostaLinha[];
      const ids = linhas.map((l) => Number(l.id_int));
      const [desp, gr] = await Promise.all([despachadosEntre(supabase, ids), gruposAcompanhar(supabase, ids)]);
      candidatos = montarCandidatos(linhas.map((l) => paraPedido(l, desp, gr)), ref, meu?.grupoId ?? null, undefined);
      // Membros do proprio grupo nao sao "candidatos": ja estao marcados.
      const doGrupo = new Set(membros.map((m) => m.idInt));
      candidatos = candidatos.filter((c) => !doGrupo.has(c.idInt));
    }
  }

  return {
    idInt,
    podeEditar,
    podeSoltarDeTerceiro: ehAdminExpedicao,
    somenteLeitura,
    grupoId: meu?.grupoId ?? null,
    membros,
    candidatos,
    tetoGrupo: TETO_GRUPO
  };
}

export async function GET(request: Request) {
  const sessao = await abrirSessao(request);
  if (sessao instanceof NextResponse) return sessao;
  const { searchParams } = new URL(request.url);
  const idInt = Number(searchParams.get("id_int"));
  if (!Number.isInteger(idInt) || idInt <= 0) {
    return NextResponse.json({ success: false, message: "id_int invalido." }, { status: 400 });
  }
  const estado = await montarEstado(sessao, idInt, searchParams.get("q") ?? "");
  if (!estado) return NextResponse.json({ success: false, message: `Pedido #${idInt} nao encontrado.` }, { status: 404 });
  return NextResponse.json({ success: true, estado });
}

export async function POST(request: Request) {
  const sessao = await abrirSessao(request);
  if (sessao instanceof NextResponse) return sessao;
  const { supabase, uid } = sessao;
  const body = (await request.json().catch(() => null)) as {
    acao?: string;
    id_int?: number;
    outros?: unknown;
    motivo?: string;
    solta?: number;
  } | null;
  const idInt = Number(body?.id_int);
  if (!Number.isInteger(idInt) || idInt <= 0) {
    return NextResponse.json({ success: false, message: "id_int invalido." }, { status: 400 });
  }

  if (body?.acao === "vincular") {
    if (!(await verificarPermissaoServerSide(supabase, uid, "propostas.edit"))) {
      return NextResponse.json({ success: false, code: "SEM_PERMISSAO", message: mensagemDeErroAcompanhar(403, "SEM_PERMISSAO", null) }, { status: 403 });
    }
    const outros = lerIds(body?.outros).filter((i) => i !== idInt);
    if (outros.length === 0) {
      return NextResponse.json({ success: false, message: "Escolha ao menos um pedido para acompanhar." }, { status: 400 });
    }
    // Teto do grupo, contando quem ja esta nele.
    const atuais = (await gruposAcompanhar(supabase, [idInt])).get(idInt)?.membros ?? [idInt];
    const novos = outros.filter((i) => !atuais.includes(i));
    if (atuais.length + novos.length > TETO_GRUPO) {
      return NextResponse.json({ success: false, code: "TETO", message: `O grupo aceita no maximo ${TETO_GRUPO} pedidos.` }, { status: 422 });
    }
    // Funil, despacho, avulso e teste: conferidos aqui. Cliente/pagador, o banco confere.
    const { data: dados } = await supabase.from("propostas").select(COLUNAS).in("id_int", [idInt, ...outros]);
    const linhas = (dados ?? []) as PropostaLinha[];
    const ref = linhas.find((l) => Number(l.id_int) === idInt);
    if (!ref) return NextResponse.json({ success: false, message: `Pedido #${idInt} nao encontrado.` }, { status: 404 });
    const ids = linhas.map((l) => Number(l.id_int));
    const [desp, gr] = await Promise.all([despachadosEntre(supabase, ids), gruposAcompanhar(supabase, ids)]);
    for (const id of novos) {
      const l = linhas.find((x) => Number(x.id_int) === id);
      const ped = l ? paraPedido(l, desp, gr) : null;
      if (!ped || !podeSerCandidato(ped, { idInt, idCliente: num(ref.id_cliente), idFaturado: num(ref.id_faturado) })) {
        return NextResponse.json(
          { success: false, code: "NAO_ELEGIVEL", message: `O pedido #${id} nao pode entrar no grupo (precisa ser do mesmo cliente ou pagador, estar entre APROVADO e EXPEDICAO e nao ter sido despachado).` },
          { status: 422 }
        );
      }
    }
    const { error } = await supabase.rpc("vincular_pedidos", { p_tipo: "ACOMPANHAR", p_ids: [idInt, ...outros] });
    if (error) {
      const status = error.code === "42501" ? 403 : 422;
      return NextResponse.json({ success: false, code: error.code, message: mensagemDeErroAcompanhar(status, error.code, error.message) }, { status });
    }
  } else if (body?.acao === "soltar") {
    const [editar, admin] = await Promise.all([
      verificarPermissaoServerSide(supabase, uid, "propostas.edit"),
      verificarPermissaoServerSide(supabase, uid, "expedicao.admin")
    ]);
    if (!editar && !admin) {
      return NextResponse.json({ success: false, code: "SEM_PERMISSAO", message: mensagemDeErroAcompanhar(403, "SEM_PERMISSAO", null) }, { status: 403 });
    }
    const motivo = (body?.motivo ?? "").trim();
    if (!motivo) return NextResponse.json({ success: false, message: "Informe o motivo para soltar o pedido do grupo." }, { status: 400 });
    const solta = Number.isInteger(Number(body?.solta)) && Number(body?.solta) > 0 ? Number(body?.solta) : idInt;
    const { error } = await supabase.rpc("soltar_pedido_vinculo", { p_id_int: solta, p_tipo: "ACOMPANHAR", p_motivo: motivo });
    if (error) {
      const status = error.code === "42501" ? 403 : 422;
      return NextResponse.json(
        { success: false, code: status === 403 ? "SOLTAR_DE_TERCEIRO" : error.code, message: mensagemDeErroAcompanhar(status, status === 403 ? "SOLTAR_DE_TERCEIRO" : error.code, error.message) },
        { status }
      );
    }
  } else {
    return NextResponse.json({ success: false, message: "acao invalida." }, { status: 400 });
  }

  const estado = await montarEstado(sessao, idInt, "");
  return NextResponse.json({ success: true, estado });
}
