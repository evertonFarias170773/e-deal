/**
 * Grava DE UMA VEZ os lotes de um item da proposta, e a quantidade do item
 * junto.
 *
 * POR QUE EXISTE
 *   Montar um pedido de 20 lotes hoje custa 4 idas ao servidor por lote e a
 *   reabertura do formulário a cada um — medido: 3min42s para 13 lotes. Além
 *   disso cada lote é validado contra a quantidade do item que está no banco,
 *   então distribuir uma lista nova exigia ir antes à aba Orçamento aumentar a
 *   quantidade, voltar, e repetir a cada ajuste.
 *
 * A INVERSÃO QUE FAZ ISSO FUNCIONAR
 *   A ordem das escritas: a quantidade do item é gravada PRIMEIRO, com a soma
 *   dos lotes, e só então os lotes. Assim a validação de saldo que já existe
 *   (`validarSaldoModelo`) não precisa ser afrouxada nem removida — quando os
 *   lotes chegam, o saldo já foi aberto. Nada é desligado; ela apenas deixa de
 *   estar no caminho da grade e continua protegendo as outras portas.
 *
 * O QUE ELA NÃO FAZ, DE PROPÓSITO
 *   Não recalcula `propostas.valor` nem `valor_total`. O preço da proposta
 *   embute o bônus do cliente e o desconto geral, que hoje só são montados no
 *   `saveProposta`; refazer esse cálculo aqui criaria uma segunda montagem do
 *   preço, e as duas divergirem faria o valor da proposta oscilar conforme
 *   quem salvou por último — justamente sobre o cliente de tabela especial. O
 *   total da tela acompanha na hora (é calculado no cliente) e o cabeçalho
 *   sincroniza no "Salvar alterações", como sempre.
 *
 *   Também não cota frete: isso é da aba Fretes. A rota apenas LÊ a cotação e
 *   devolve se o peso passou a divergir, para a tela avisar.
 */
import { NextResponse } from "next/server";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { avaliarFreteParaCobranca, mensagemFreteDesatualizado } from "@/features/orcamentos/services/frete-desatualizado";

/** Espelha STATUS_INICIAL_MODELO de orcamento-utils: lote novo nasce pendente. */
const STATUS_INICIAL_MODELO = "PENDENTE";

const STATUS_COBRANCA_INATIVA = ["CANCELADO", "CANCELADA", "EXTORNADO", "RECUSADO"];

/**
 * Local de propósito: arquivo de rota do App Router só pode exportar os
 * handlers e a configuração reconhecida (`maxDuration` e afins). Qualquer
 * outro export — inclusive de tipo — entra na validação de rota do Next e
 * derruba o worker de compilação. Nenhuma outra rota deste projeto exporta
 * tipo, e esta era a exceção.
 */
type LoteEmMassa = {
  /** `pedidos_modelos.id` quando a linha já existe; ausente = lote novo. */
  id?: number | null;
  nome_modelo: string;
  quantidade: number;
  padrao?: string | null;
  tipo_numeracao?: string | null;
  numeracao_inicio?: number | null;
  numeracao_fim?: number | null;
  verso_tipo?: string | null;
  bloco?: string | null;
  gabarito_operacional?: string | null;
  variacoes_texto?: string | null;
};

type Corpo = {
  idInt?: number;
  idProdutoProposta?: number;
  /** Quantidade do item que a tela viu ao abrir a grade — trava de concorrência. */
  qtdItemVista?: number;
  lotes?: LoteEmMassa[];
  removerIds?: number[];
  /** Autoriza reduzir a quantidade do item; exigido quando a soma diminui. */
  confirmarReducao?: boolean;
};

function erro(code: string, message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ success: false, code, message, ...(extra || {}) }, { status });
}

async function situacaoDoFrete(supabase: SupabaseClient, idInt: number) {
  const { data: cotacao } = await supabase
    .from("cotacao_frete")
    .select("peso, valor, servico")
    .eq("id_int", idInt)
    .eq("escolhido", true)
    .maybeSingle<{ peso: number | null; valor: number | null; servico: string | null }>();

  const { data: itens } = await supabase
    .from("produtos_proposta")
    .select("peso_total")
    .eq("id_int", idInt)
    .or("status_item.is.null,status_item.neq.CANCELADO")
    .returns<{ peso_total: number | null }[]>();

  const ativos = itens || [];
  const situacao = avaliarFreteParaCobranca({
    pesoCotadoGramas: cotacao?.peso ?? null,
    pesoAtualGramas: ativos.reduce((soma, i) => soma + (Number(i.peso_total) || 0), 0),
    valorFrete: cotacao?.valor ?? null,
    servico: cotacao?.servico ?? null,
    temCotacao: Boolean(cotacao),
    temItens: ativos.length > 0
  });

  return { situacao, mensagem: mensagemFreteDesatualizado(situacao) };
}

export async function POST(request: Request) {
  const corpo = (await request.json().catch(() => null)) as Corpo | null;

  const idInt = Number(corpo?.idInt);
  const idProdutoProposta = Number(corpo?.idProdutoProposta);
  const lotes = Array.isArray(corpo?.lotes) ? corpo!.lotes : [];
  const removerIds = Array.isArray(corpo?.removerIds) ? corpo!.removerIds.map(Number).filter(Number.isFinite) : [];

  if (!Number.isFinite(idInt) || idInt <= 0) return erro("DADOS", "Proposta nao informada.", 400);
  if (!Number.isFinite(idProdutoProposta) || idProdutoProposta <= 0) {
    return erro("DADOS", "Item da proposta nao informado.", 400);
  }

  for (const lote of lotes) {
    if (!String(lote?.nome_modelo || "").trim()) {
      return erro("DADOS", "Todo lote precisa de um nome de modelo.", 400);
    }
    if (!Number.isFinite(Number(lote?.quantidade)) || Number(lote.quantidade) <= 0) {
      return erro("DADOS", `Quantidade invalida no lote "${lote.nome_modelo}".`, 400);
    }
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    console.error("[lotes-em-massa] ENV AUSENTE");
    return erro("INTERNO", "Erro interno no servidor.", 500);
  }

  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return erro("SESSAO", "Sessao nao encontrada.", 401);

  const supabase = createSupabaseClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return erro("SESSAO", "Sessao invalida.", 401);

  // 1. Cobrança ativa fecha a porta. A aba Pedido já desliga o auto-save nesse
  //    estado; a grade segue a mesma regra em vez de criar uma exceção nova.
  //    Alterar pedido já cobrado passa pelo fluxo que sabe reconciliar a
  //    diferença (proposta paga / faturado), que não é este.
  const { data: cobrancas, error: erroCobrancas } = await supabase
    .from("pagamentos_v2")
    .select("status")
    .eq("id_int", idInt)
    .returns<{ status: string | null }[]>();

  if (erroCobrancas) return erro("INTERNO", "Nao foi possivel verificar as cobrancas da proposta.", 500);

  const temCobrancaAtiva = (cobrancas || []).some(
    (c) => !STATUS_COBRANCA_INATIVA.includes(String(c.status || "").trim().toUpperCase())
  );
  if (temCobrancaAtiva) {
    return erro(
      "COBRANCA_ATIVA",
      "Esta proposta já tem cobrança gerada. Alterar as quantidades aqui está bloqueado — use a edição da proposta, que sabe acertar a diferença do que já foi cobrado.",
      409
    );
  }

  // 2. O item precisa existir E pertencer a esta proposta. Sem esta conferência
  //    um id de outra proposta seria movido para esta (não há chave estrangeira
  //    protegendo, e as policies são permissivas).
  const { data: item, error: erroItem } = await supabase
    .from("produtos_proposta")
    .select("id, id_int, qtd, nome_produto")
    .eq("id", idProdutoProposta)
    .maybeSingle<{ id: number; id_int: number; qtd: number | null; nome_produto: string | null }>();

  if (erroItem) return erro("INTERNO", "Nao foi possivel ler o item da proposta.", 500);
  if (!item) return erro("ITEM_NAO_ENCONTRADO", "Este item nao existe mais nesta proposta. Recarregue a pagina.", 409);
  if (Number(item.id_int) !== idInt) {
    return erro("ITEM_DE_OUTRA_PROPOSTA", "Este item pertence a outra proposta.", 409);
  }

  const qtdAtual = Number(item.qtd) || 0;

  // 3. Trava de concorrência: a tela informa a quantidade que viu ao abrir a
  //    grade. Divergiu, alguém mexeu no meio do caminho e o último a salvar
  //    apagaria o trabalho do outro em silêncio.
  const qtdVista = Number(corpo?.qtdItemVista);
  if (Number.isFinite(qtdVista) && qtdVista !== qtdAtual) {
    return erro(
      "ITEM_MUDOU",
      `A quantidade deste item mudou enquanto você editava (era ${qtdVista}, agora é ${qtdAtual}). Recarregue a página para não sobrescrever a alteração de outra pessoa.`,
      409,
      { qtdNoBanco: qtdAtual }
    );
  }

  const soma = lotes.reduce((total, lote) => total + Number(lote.quantidade), 0);

  // 4. Reduzir a quantidade do item derruba subtotal e peso. Nunca em silêncio.
  if (soma < qtdAtual && !corpo?.confirmarReducao) {
    return erro(
      "CONFIRMAR_REDUCAO",
      `A soma dos lotes (${soma}) é menor que a quantidade atual do item (${qtdAtual}). Confirme para reduzir.`,
      409,
      { qtdAtual, novaQtd: soma }
    );
  }

  // 5. Quantidade do item PRIMEIRO — é o que abre o saldo para os lotes.
  const { error: erroQtd } = await supabase
    .from("produtos_proposta")
    .update({ qtd: soma })
    .eq("id", idProdutoProposta)
    .eq("id_int", idInt);

  if (erroQtd) {
    return erro("INTERNO", `Nao foi possivel gravar a quantidade do item: ${erroQtd.message}`, 500);
  }

  // 6. Lotes removidos.
  if (removerIds.length > 0) {
    const { error: erroRemover } = await supabase
      .from("pedidos_modelos")
      .delete()
      .in("id", removerIds)
      .eq("id_produto_proposta_origem", idProdutoProposta);

    if (erroRemover) {
      return erro("PARCIAL", `Quantidade gravada, mas os lotes removidos falharam: ${erroRemover.message}`, 500);
    }
  }

  // 7. Lotes existentes: UPDATE campo a campo, nunca apagar e recriar — os
  //    status de arte e produção e as amostras vivem nessas linhas.
  const agora = new Date().toISOString();
  for (const lote of lotes.filter((l) => Number.isFinite(Number(l.id)) && Number(l.id) > 0)) {
    const { error: erroUpdate } = await supabase
      .from("pedidos_modelos")
      .update({
        nome_modelo: String(lote.nome_modelo).trim(),
        quantidade: Number(lote.quantidade),
        padrao: lote.padrao?.trim() || null,
        tipo_numeracao: lote.tipo_numeracao || "SEM_NUMERACAO",
        numeracao_inicio: lote.numeracao_inicio ?? null,
        numeracao_fim: lote.numeracao_fim ?? null,
        verso_tipo: lote.verso_tipo?.trim() || null,
        bloco: lote.bloco?.trim() || null,
        gabarito_operacional: lote.gabarito_operacional?.trim() || null,
        variacoes_texto: lote.variacoes_texto?.trim() || null,
        updated_at: agora
      })
      .eq("id", Number(lote.id))
      .eq("id_produto_proposta_origem", idProdutoProposta);

    if (erroUpdate) {
      return erro("PARCIAL", `Quantidade gravada, mas o lote "${lote.nome_modelo}" falhou: ${erroUpdate.message}`, 500);
    }
  }

  // 8. Lotes novos, em um insert só.
  const novos = lotes.filter((l) => !Number.isFinite(Number(l.id)) || Number(l.id) <= 0);
  if (novos.length > 0) {
    const { data: maiorOrdem } = await supabase
      .from("pedidos_modelos")
      .select("ordem")
      .eq("id_int", idInt)
      .order("ordem", { ascending: false })
      .limit(1)
      .returns<{ ordem: number | null }[]>();

    let proximaOrdem = (maiorOrdem && maiorOrdem[0] ? Number(maiorOrdem[0].ordem) || 0 : 0) + 1;

    const { error: erroInsert } = await supabase.from("pedidos_modelos").insert(
      novos.map((lote) => ({
        id_int: idInt,
        id_produto_proposta_origem: idProdutoProposta,
        nome_modelo: String(lote.nome_modelo).trim(),
        padrao: lote.padrao?.trim() || null,
        quantidade: Number(lote.quantidade),
        tipo_numeracao: lote.tipo_numeracao || "SEM_NUMERACAO",
        numeracao_inicio: lote.numeracao_inicio ?? null,
        numeracao_fim: lote.numeracao_fim ?? null,
        verso_tipo: lote.verso_tipo?.trim() || null,
        bloco: lote.bloco?.trim() || null,
        gabarito_operacional: lote.gabarito_operacional?.trim() || null,
        variacoes_texto: lote.variacoes_texto?.trim() || null,
        status_arte: STATUS_INICIAL_MODELO,
        status_producao: STATUS_INICIAL_MODELO,
        ordem: proximaOrdem++,
        created_at: agora,
        updated_at: agora
      }))
    );

    if (erroInsert) {
      return erro("PARCIAL", `Quantidade gravada, mas os lotes novos falharam: ${erroInsert.message}`, 500);
    }
  }

  const frete = await situacaoDoFrete(supabase, idInt);

  // Devolve os lotes COMO FICARAM, com os ids do banco. Sem isto a tela
  // continuava com a versão anterior, sem identificador nas linhas recém
  // criadas — e o "Fechar lote" seguinte inseria tudo de novo em vez de
  // atualizar, duplicando os lotes. Foi o que aconteceu na proposta 20262.
  const { data: lotesFinais } = await supabase
    .from("pedidos_modelos")
    .select(
      "id, nome_modelo, padrao, quantidade, tipo_numeracao, numeracao_inicio, numeracao_fim, " +
      "verso_tipo, bloco, gabarito_operacional, variacoes_texto, status_arte, status_producao, ordem"
    )
    .eq("id_produto_proposta_origem", idProdutoProposta)
    .order("ordem", { ascending: true });

  return NextResponse.json({
    success: true,
    qtdItem: soma,
    qtdAnterior: qtdAtual,
    lotesGravados: lotes.length,
    lotesRemovidos: removerIds.length,
    lotes: lotesFinais || [],
    frete: frete.situacao,
    freteMensagem: frete.mensagem
  });
}
