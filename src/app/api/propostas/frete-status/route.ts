/**
 * Situação do frete de uma proposta: o peso cotado ainda vale?
 *
 * Existe como rota, e não como cálculo na tela, por um motivo concreto: o
 * painel de cobrança recebe o objeto `proposta` carregado na montagem da
 * página. Na aba Pagamentos do mesmo editor em que a quantidade acabou de
 * mudar, esse objeto ainda carrega o peso antigo — a comparação daria "em
 * dia" justamente no caso que ela existe para pegar. Aqui os dois lados são
 * lidos do banco no instante da checagem.
 *
 * Somente leitura: nenhuma escrita, em nenhuma tabela.
 *
 * Regras em features/orcamentos/services/frete-desatualizado.ts.
 */
import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { avaliarFreteParaCobranca, mensagemFreteDesatualizado } from "@/features/orcamentos/services/frete-desatualizado";

type CotacaoRow = { peso: number | null; valor: number | null; servico: string | null };
type ItemPesoRow = { peso_total: number | null };

export async function GET(request: Request) {
  const idInt = Number(new URL(request.url).searchParams.get("idInt"));

  if (!Number.isFinite(idInt) || idInt <= 0) {
    return NextResponse.json({ success: false, error: "Proposta nao informada." }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    console.error("[frete-status] ENV AUSENTE");
    return NextResponse.json({ success: false, error: "Erro interno no servidor." }, { status: 500 });
  }

  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) {
    return NextResponse.json({ success: false, error: "Sessao nao encontrada." }, { status: 401 });
  }

  const supabase = createSupabaseClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ success: false, error: "Sessao invalida." }, { status: 401 });
  }

  const { data: cotacao, error: erroCotacao } = await supabase
    .from("cotacao_frete")
    .select("peso, valor, servico")
    .eq("id_int", idInt)
    .eq("escolhido", true)
    .maybeSingle<CotacaoRow>();

  if (erroCotacao) {
    return NextResponse.json(
      { success: false, error: `Nao foi possivel ler a cotacao de frete: ${erroCotacao.message}` },
      { status: 500 }
    );
  }

  // Item cancelado continua com peso_total > 0 no banco (é coluna gerada), e
  // por isso precisa sair da soma — é o mesmo recorte que a tela faz para
  // calcular o peso da proposta.
  const { data: itens, error: erroItens } = await supabase
    .from("produtos_proposta")
    .select("peso_total")
    .eq("id_int", idInt)
    .or("status_item.is.null,status_item.neq.CANCELADO")
    .returns<ItemPesoRow[]>();

  if (erroItens) {
    return NextResponse.json(
      { success: false, error: `Nao foi possivel ler o peso da proposta: ${erroItens.message}` },
      { status: 500 }
    );
  }

  const itensAtivos = itens || [];
  const pesoAtualGramas = itensAtivos.reduce((soma, item) => soma + (Number(item.peso_total) || 0), 0);

  const situacao = avaliarFreteParaCobranca({
    pesoCotadoGramas: cotacao?.peso ?? null,
    pesoAtualGramas,
    valorFrete: cotacao?.valor ?? null,
    servico: cotacao?.servico ?? null,
    temCotacao: Boolean(cotacao),
    temItens: itensAtivos.length > 0
  });

  return NextResponse.json({
    success: true,
    situacao,
    mensagem: mensagemFreteDesatualizado(situacao)
  });
}
