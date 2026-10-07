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
 * A QUANTIDADE DO ITEM É GRAVADA AQUI
 *   A rota grava a quantidade do item com a soma dos lotes, junto com os
 *   lotes. A validação de saldo que já existe (`validarSaldoModelo`) não é
 *   afrouxada nem removida: ela é do serviço do card, não está no caminho da
 *   grade e continua protegendo as outras portas. Não há regra de saldo no banco.
 *
 * A ORDEM DAS ESCRITAS (desde 07/10/2026 — services/gravar-lotes.server.ts)
 *   Remoções primeiro, num comando só; depois a quantidade do item; depois
 *   alterações e inclusões. Até essa data a quantidade vinha primeiro, e uma
 *   remoção recusada deixava a quantidade (e o valor da proposta) alterados
 *   com o lote ainda lá — foi o pedido 23063, em que o modelo tinha reserva de
 *   QR de controle de acesso. Agora remoção recusada não grava nada, e falha
 *   posterior devolve a quantidade.
 *
 * CONSOLIDA `propostas.valor` E `valor_total` (desde 28/09/2026)
 *   Ate essa data a rota nao recalculava a proposta, de proposito: o preco
 *   embute o bonus do cliente e o desconto geral, montados so no
 *   `saveProposta`, e uma segunda montagem aqui poderia divergir da primeira.
 *   O que aconteceu foi o oposto: quem mudava a quantidade pela grade e nao
 *   clicava em "Salvar alteracoes" deixava `valor_total` velho — e Conferencia,
 *   motor de status e area do cliente leem a coluna, nao a tela. A 22759 ficou
 *   com R$ 694,63 gravados num pedido de R$ 304,63 e a area do cliente emitiu
 *   um PIX com o valor errado.
 *
 *   Agora, quando a quantidade do item muda, a rota grava `valor` e
 *   `valor_total` com a MESMA regra do save, por uma copia so
 *   (`totais-proposta.server.ts`): itens ativos x bonus - desconto geral +
 *   frete gravado. O frete continua o gravado (a rota nao cota; isso e da aba
 *   Fretes, e o save tambem nao regrava frete depois de LIBERADO) e o desconto
 *   continua em `desconto_proposta`, intocado. A gravacao e guardada por
 *   `valor_frete`, como no save: se o frete mudou entre a leitura e a escrita,
 *   nada e gravado e a resposta avisa (`totalConsolidado: false`).
 *
 *   A rota continua sem cotar frete: apenas LE a cotacao e devolve se o peso
 *   passou a divergir, para a tela avisar.
 *
 * O CHECKLIST DO BOLETIM MANDA AQUI TAMBÉM (Etapa 6b)
 *   Campo opcional que o produto NÃO tem marcado em `produto_boletim_campos`:
 *     - lote NOVO: gravado null, mesmo que a requisição mande valor. Não confia
 *       na tela — a grade já esconde e anula, mas esta é a porta do banco;
 *     - lote EXISTENTE: a coluna sai do UPDATE, e o valor gravado fica como está.
 *   Produto sem nenhum registro de checklist segue exatamente como antes,
 *   defaults incluídos. O checklist é lido ANTES de qualquer escrita; se a
 *   leitura falhar, nada é gravado. A regra mora em lib/checklist-lote, a mesma
 *   do formulário do PCP.
 *
 * MAPA DE TEATRO (03/10/2026)
 *   Lote NOVO pode chegar com `mapa_teatro_id` + `mapa_teatro_setor_id`: é o
 *   modelo de um setor de `producao_mapas_teatro`. Para esses, quem manda é o
 *   mapa, não a requisição:
 *     - o mapa é lido AQUI, e o setor tem de existir dentro dele — conferir só
 *       que o mapa existe deixaria gravar o setor de outro mapa;
 *     - nome do modelo = nome do setor; quantidade = cadeiras do setor fora as
 *       apagadas. O que a tela mandou nesses dois campos é descartado;
 *     - a revisão (`revisaoDoMapaTeatro`) e o retrato do setor são calculados
 *       aqui e gravados no lote. Numeração não é gerada.
 *   Um produto fica com UM mapa, e cada setor entra uma vez. Tudo é conferido
 *   antes de qualquer escrita: mapa em formato não suportado, setor sem id ou
 *   setor de outro mapa recusam a gravação inteira.
 *   Lote que JÁ existe nunca tem o vínculo reescrito por esta rota, e lote sem
 *   os dois campos segue exatamente como antes.
 */
import { NextResponse } from "next/server";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { avaliarFreteParaCobranca, mensagemFreteDesatualizado } from "@/features/orcamentos/services/frete-desatualizado";
import { checklistVisivel } from "@/features/orcamentos/lib/checklist-lote";
import { gravarLotesDoItem } from "@/features/orcamentos/services/gravar-lotes.server";
import { calcularTotaisPelaRegraDaTela } from "@/features/orcamentos/services/totais-proposta.server";
import {
  lerSetoresDoMapaTeatro,
  montarRetratoDoSetor,
  revisaoDoMapaTeatro,
  type RetratoDoSetor
} from "@/features/orcamentos/lib/mapa-teatro";

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
  /** Camarote (numerador tipo CAMAROTE): os mesmos campos que o card grava. */
  Q_CAM?: number | null;
  L_CAM?: number | null;
  C_INI?: number | null;
  /** Mapa de Teatro: só em lote novo, e sempre os dois juntos. */
  mapa_teatro_id?: string | null;
  mapa_teatro_setor_id?: string | null;
};

/** O que o servidor resolveu para um lote novo de setor de mapa. */
type VinculoDeMapa = {
  mapa_teatro_id: string;
  mapa_teatro_setor_id: string;
  mapa_teatro_revisao: string;
  mapa_teatro_snapshot: RetratoDoSetor;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Corpo = {
  idInt?: number;
  idProdutoProposta?: number;
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
    .select("id, id_int, qtd, nome_produto, id_produto")
    .eq("id", idProdutoProposta)
    .maybeSingle<{
      id: number;
      id_int: number;
      qtd: number | null;
      nome_produto: string | null;
      id_produto: number | null;
    }>();

  if (erroItem) return erro("INTERNO", "Nao foi possivel ler o item da proposta.", 500);
  if (!item) return erro("ITEM_NAO_ENCONTRADO", "Este item nao existe mais nesta proposta. Recarregue a pagina.", 409);
  if (Number(item.id_int) !== idInt) {
    return erro("ITEM_DE_OUTRA_PROPOSTA", "Este item pertence a outra proposta.", 409);
  }

  // 2b. Checklist do boletim do produto — o CADASTRO de hoje. Lido antes de
  //     qualquer escrita: se falhar, nada e gravado, porque gravar sem saber o
  //     que o produto esconde deixaria passar valor que ele nao imprime.
  let camposDoProduto: string[] = [];
  const idProdutoCatalogo = Number(item.id_produto);
  if (Number.isInteger(idProdutoCatalogo) && idProdutoCatalogo > 0) {
    const { data: checklistRows, error: erroChecklist } = await supabase
      .from("produto_boletim_campos")
      .select("campo")
      .eq("id_produto", idProdutoCatalogo)
      .returns<{ campo: string }[]>();

    if (erroChecklist) {
      return erro("INTERNO", "Nao foi possivel ler o checklist do boletim do produto. Nada foi gravado.", 500);
    }
    camposDoProduto = (checklistRows || []).map((linha) => String(linha.campo));
  }
  // Sem registro de checklist (ou item sem produto de catalogo) = sem regra.
  const visivel = checklistVisivel(camposDoProduto);

  // 2c. Mapa de Teatro: resolve o vinculo de cada lote NOVO que veio com mapa e
  //     setor, ANTES de qualquer escrita. Nome e quantidade desses lotes passam
  //     a ser os do setor — e entram assim na soma que vira a quantidade do item.
  const ehNovo = (l: LoteEmMassa) => !Number.isFinite(Number(l.id)) || Number(l.id) <= 0;
  const vinculos = new Map<LoteEmMassa, VinculoDeMapa>();
  const lotesDeMapa = lotes.filter(
    (l) => ehNovo(l) && (String(l.mapa_teatro_id ?? "").trim() || String(l.mapa_teatro_setor_id ?? "").trim())
  );
  if (lotesDeMapa.length > 0) {
    for (const lote of lotesDeMapa) {
      if (!UUID.test(String(lote.mapa_teatro_id ?? "").trim()) || !String(lote.mapa_teatro_setor_id ?? "").trim()) {
        return erro("MAPA_DADOS", "Modelo de Mapa de Teatro sem o mapa ou sem o setor. Nada foi gravado.", 400);
      }
    }
    const idsMapa = Array.from(new Set(lotesDeMapa.map((l) => String(l.mapa_teatro_id).trim().toLowerCase())));
    if (idsMapa.length > 1) {
      return erro("MAPA_UNICO", "Um produto usa um Mapa de Teatro só. Nada foi gravado.", 409);
    }

    const { data: mapas, error: erroMapas } = await supabase
      .from("producao_mapas_teatro")
      .select("id, name, config")
      .in("id", idsMapa)
      .returns<{ id: string; name: string | null; config: unknown }[]>();
    if (erroMapas) return erro("INTERNO", "Nao foi possivel ler o Mapa de Teatro. Nada foi gravado.", 500);
    const mapa = (mapas || [])[0];
    if (!mapa) return erro("MAPA_NAO_ENCONTRADO", "O Mapa de Teatro escolhido nao existe mais. Nada foi gravado.", 409);

    const leitura = lerSetoresDoMapaTeatro(mapa.config);
    if (!leitura.ok) {
      return erro("MAPA_NAO_SUPORTADO", `Mapa "${mapa.name ?? mapa.id}": ${leitura.motivo} Nada foi gravado.`, 409);
    }

    // O que o produto ja tem no banco, fora o que esta sendo removido agora.
    const { data: jaVinculados, error: erroVinculados } = await supabase
      .from("pedidos_modelos")
      .select("id, mapa_teatro_id, mapa_teatro_setor_id")
      .eq("id_produto_proposta_origem", idProdutoProposta)
      .not("mapa_teatro_id", "is", null)
      .returns<{ id: number; mapa_teatro_id: string | null; mapa_teatro_setor_id: string | null }[]>();
    if (erroVinculados) return erro("INTERNO", "Nao foi possivel conferir os modelos do produto. Nada foi gravado.", 500);
    const vivos = (jaVinculados || []).filter((m) => !removerIds.includes(Number(m.id)));
    if (vivos.some((m) => String(m.mapa_teatro_id).toLowerCase() !== String(mapa.id).toLowerCase())) {
      return erro("MAPA_UNICO", "Este produto ja usa outro Mapa de Teatro. Para outro mapa, use outro produto. Nada foi gravado.", 409);
    }

    const revisao = await revisaoDoMapaTeatro(mapa.config);
    const setoresNoProduto = new Set(vivos.map((m) => String(m.mapa_teatro_setor_id)));
    for (const lote of lotesDeMapa) {
      const idSetor = String(lote.mapa_teatro_setor_id).trim();
      // O SETOR TEM DE SER DESTE MAPA: e a conferencia que so validar o mapa nao faz.
      const setor = leitura.setores.find((s) => s.id === idSetor);
      const retrato = setor ? montarRetratoDoSetor(mapa, idSetor) : null;
      if (!setor || !retrato) {
        return erro("SETOR_FORA_DO_MAPA", `O setor informado nao pertence ao mapa "${mapa.name ?? mapa.id}". Nada foi gravado.`, 409);
      }
      if (setor.lugares <= 0) {
        return erro("SETOR_SEM_CADEIRAS", `O setor "${setor.nome || setor.id}" nao tem cadeiras. Nada foi gravado.`, 409);
      }
      if (setoresNoProduto.has(idSetor)) {
        return erro("SETOR_REPETIDO", `O setor "${setor.nome || setor.id}" ja esta neste produto. Nada foi gravado.`, 409);
      }
      setoresNoProduto.add(idSetor);
      lote.nome_modelo = setor.nome || setor.id;
      lote.quantidade = setor.lugares;
      vinculos.set(lote, {
        mapa_teatro_id: mapa.id,
        mapa_teatro_setor_id: idSetor,
        mapa_teatro_revisao: revisao,
        mapa_teatro_snapshot: retrato
      });
    }
  }

  const qtdAtual = Number(item.qtd) || 0;

  // 3. Sem trava de concorrência, por decisão do dono: a última gravação
  //    vence. A trava que comparava a quantidade "vista" pela tela com a do
  //    banco recusava a troca de quantidade do próprio usuário (22528) e o
  //    mandava recarregar a página; quem muda a quantidade quer que ela grave.
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

  // 5 a 8. As escritas, em services/gravar-lotes.server.ts: REMOÇÕES primeiro
  //    (um comando só: todos ou nenhum), depois a quantidade do item, depois
  //    alterações e inclusões. Remoção recusada = nada gravado. Falha depois da
  //    quantidade = a quantidade volta e a resposta diz o que ficou.
  const gravacao = await gravarLotesDoItem(supabase, {
    idInt,
    idProdutoProposta,
    lotes,
    removerIds,
    vinculos,
    visivel,
    qtdAtual,
    soma,
    agora: new Date().toISOString(),
    reconsolidar: () => consolidarTotaisDaProposta(supabase, idInt)
  });
  if (!gravacao.ok) return erro(gravacao.code, gravacao.message, gravacao.status, gravacao.extra);

  // 9. Consolidar a proposta — so quando a quantidade mudou, porque so ela
  //    altera o preco. Mesma regra e mesma guarda de frete do saveProposta.
  let totalConsolidado: boolean | null = null;
  let valorConsolidado: number | null = null;
  let valorTotalConsolidado: number | null = null;
  if (soma !== qtdAtual) {
    const consolidacao = await consolidarTotaisDaProposta(supabase, idInt);
    totalConsolidado = consolidacao.ok;
    valorConsolidado = consolidacao.valor;
    valorTotalConsolidado = consolidacao.valorTotal;
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
      "verso_tipo, bloco, gabarito_operacional, variacoes_texto, Q_CAM, L_CAM, C_INI, status_arte, status_producao, ordem, " +
      // Mapa de Teatro: os ids do vinculo e o nome do mapa (o retrato fica no banco).
      "mapa_teatro_id, mapa_teatro_setor_id, mapa_teatro_nome:mapa_teatro_snapshot->mapa->>nome"
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
    freteMensagem: frete.mensagem,
    /** Nulo quando a quantidade nao mudou (nada a consolidar). */
    totalConsolidado,
    valor: valorConsolidado,
    valorTotal: valorTotalConsolidado
  });
}

/**
 * Grava `propostas.valor` e `valor_total` pela regra do save. Proposta avulsa
 * nao passa por aqui (o preco dela e digitado, nao vem dos itens).
 *
 * Guarda de frete: o UPDATE so vale se `valor_frete` ainda for o que foi
 * lido para a conta. E a mesma trava do saveProposta — sem ela, um frete
 * recotado entre a leitura e a escrita entraria no total com o numero antigo.
 */
async function consolidarTotaisDaProposta(
  supabase: SupabaseClient,
  idInt: number
): Promise<{ ok: boolean; valor: number | null; valorTotal: number | null }> {
  const { data: proposta, error: erroProposta } = await supabase
    .from("propostas")
    .select("id_int, id_cliente, valor_frete, is_avulso")
    .eq("id_int", idInt)
    .maybeSingle<{ id_int: number; id_cliente: number | null; valor_frete: number | string | null; is_avulso: boolean | null }>();

  if (erroProposta || !proposta) {
    console.error(`[lotes-em-massa] proposta ${idInt} nao lida para consolidar:`, erroProposta?.message);
    return { ok: false, valor: null, valorTotal: null };
  }
  if (proposta.is_avulso) return { ok: false, valor: null, valorTotal: null };

  const totais = await calcularTotaisPelaRegraDaTela(supabase, {
    id_int: proposta.id_int,
    id_cliente: proposta.id_cliente,
    valor_frete: proposta.valor_frete === null ? null : Number(proposta.valor_frete)
  });
  if (!totais) return { ok: false, valor: null, valorTotal: null };

  const valor = totais.subtotalProdutosCents / 100;
  const valorTotal = totais.totalCents / 100;

  let atualizacao = supabase
    .from("propostas")
    .update({ valor, valor_total: valorTotal })
    .eq("id_int", idInt);
  atualizacao = proposta.valor_frete === null
    ? atualizacao.is("valor_frete", null)
    : atualizacao.eq("valor_frete", proposta.valor_frete);

  const { data: gravada, error: erroUpdate } = await atualizacao.select("valor_total").maybeSingle<{ valor_total: number | null }>();
  if (erroUpdate || !gravada) {
    console.error(`[lotes-em-massa] consolidacao da proposta ${idInt} nao gravada:`, erroUpdate?.message ?? "frete mudou durante a gravacao");
    return { ok: false, valor: null, valorTotal: null };
  }
  return { ok: true, valor, valorTotal };
}
