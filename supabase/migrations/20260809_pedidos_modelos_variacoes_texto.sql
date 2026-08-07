-- pedidos_modelos.variacoes_texto — texto consolidado das variacoes do item
--
-- O QUE E
--   Coluna `text` que guarda, no proprio modelo, as variacoes do item da
--   proposta que deu origem a ele, ja formatadas para leitura humana:
--
--     TAMANHO: 120 cm • ACABAMENTO: Mosquete Metal Ponta Dupla
--
--   Sem IDs internos, separado por ' • ', preservando a ordem das variacoes.
--   O card da aba Pedidos passa a ler daqui, e o valor fica disponivel para
--   outros modulos sem refazer o join de variacoes.
--
-- POR QUE NAO E DERIVADO EM TEMPO DE LEITURA
--   Reconstruir exige juntar produtos_proposta_variacao + variacoes a cada
--   consulta, em todo modulo que precisar do texto. Persistir resolve uma vez
--   na escrita. O custo e manter sincronizado — ver "QUEM ESCREVE".
--
-- A ORIGEM E O ITEM, NUNCA O PRODUTO
--   Desde 07/08/2026 a proposta aceita o mesmo id_produto em varias linhas com
--   variacoes diferentes. Por isso a origem e sempre
--   pedidos_modelos.id_produto_proposta_origem -> produtos_proposta.id
--   (a linha especifica), e jamais id_produto. Derivar por id_produto
--   misturaria as variacoes de itens distintos do mesmo produto.
--
-- QUEM ESCREVE (aplicacao)
--   1. src/features/orcamentos/components/PedidoModelosTab.tsx  -> startCreate
--      (modelo novo nasce com o texto do item) e startCopy (copia herda).
--   2. src/features/orcamentos/services/pedidos-modelos.service.ts
--      -> criarModelo / atualizarModelo / atualizarModeloParcial.
--   3. src/features/orcamentos/services/orcamentos.service.ts -> saveProposta,
--      que insere os modelos novos JA com o texto e, logo apos, roda um UPDATE
--      por item ressincronizando TODOS os modelos daquele item. Esse passo e o
--      que cobre "as variacoes mudaram numa proposta que ja tinha modelos".
--   O formato vem de formatVariacoesItem() em
--   src/features/orcamentos/orcamento-utils.ts — fonte unica, usada tambem na
--   exibicao. Se o formato mudar la, o backfill abaixo tem de mudar junto.
--
-- SEM VARIACOES
--   Grava NULL (a aplicacao envia `formatVariacoesItem(item) || null`).
--   O backfill deixa NULL pelo mesmo motivo: ausencia de variacao nao e texto
--   vazio, e nao ha o que consolidar.
--
-- ANTES DE APLICAR — verificacao (somente leitura)
--   a) Quantos modelos tem vinculo suficiente para backfill seguro:
--
--        select
--          count(*) filter (where id_produto_proposta_origem is not null) as com_vinculo,
--          count(*) filter (where id_produto_proposta_origem is null)     as sem_vinculo,
--          count(*)                                                       as total
--        from public.pedidos_modelos;
--
--   b) Conferir o texto gerado em alguns modelos antes de gravar (troque o
--      limit/where a vontade — nao escreve nada):
--
--        select pm.id, pm.nome_modelo, pp.id_produto, sub.texto
--        from public.pedidos_modelos pm
--        join public.produtos_proposta pp on pp.id = pm.id_produto_proposta_origem
--        join (
--          select ppv.id_produto_proposta,
--                 string_agg(
--                   coalesce(
--                     nullif(trim(regexp_replace(coalesce(v.nome, ''), '^[[:space:]]*[0-9]+[[:space:].)-]+', '')), ''),
--                     nullif(trim(coalesce(v.nome, '')), ''),
--                     'Variacao'
--                   ) || ': ' ||
--                   coalesce(nullif(trim(coalesce(ppv.nome_variacao, '')), ''), '-'),
--                   ' • ' order by ppv.id
--                 ) as texto
--          from public.produtos_proposta_variacao ppv
--          left join public.variacoes v on v.id_variacao = ppv.id_variacao
--          group by ppv.id_produto_proposta
--        ) sub on sub.id_produto_proposta = pm.id_produto_proposta_origem
--        limit 30;
--
--   c) Caso (a) mostre modelos com id_produto_proposta_origem NULL: eles ficam
--      sem backfill de proposito. Sem a linha de origem nao da para saber de
--      qual item vieram, e preencher por id_produto seria suposicao. Esses
--      modelos continuam exibindo o texto calculado do item em tela (fallback
--      da aba Pedidos) ate serem salvos de novo pela aplicacao.

-- 1. Coluna -----------------------------------------------------------------

alter table public.pedidos_modelos
  add column if not exists variacoes_texto text;

comment on column public.pedidos_modelos.variacoes_texto is
  'Texto consolidado das variacoes do item de origem (produtos_proposta), no formato "NOME: VALOR • NOME: VALOR", sem IDs. Escrito pela aplicacao ao criar/duplicar modelo e ao salvar a proposta. NULL quando o item nao tem variacoes.';

-- 2. Backfill ---------------------------------------------------------------
--    Somente modelos com vinculo inequivoco (id_produto_proposta_origem
--    apontando para uma linha existente de produtos_proposta) e que ainda nao
--    tenham valor. Idempotente: reexecutar nao sobrescreve o que a aplicacao
--    ja gravou.

update public.pedidos_modelos pm
set variacoes_texto = sub.texto
from (
  select
    ppv.id_produto_proposta,
    string_agg(
      coalesce(
        nullif(trim(regexp_replace(coalesce(v.nome, ''), '^[[:space:]]*[0-9]+[[:space:].)-]+', '')), ''),
        nullif(trim(coalesce(v.nome, '')), ''),
        'Variacao'
      ) || ': ' ||
      coalesce(nullif(trim(coalesce(ppv.nome_variacao, '')), ''), '-'),
      ' • ' order by ppv.id
    ) as texto
  from public.produtos_proposta_variacao ppv
  left join public.variacoes v on v.id_variacao = ppv.id_variacao
  group by ppv.id_produto_proposta
) sub
where pm.id_produto_proposta_origem = sub.id_produto_proposta
  and pm.variacoes_texto is null;

-- 3. Conferencia pos-aplicacao (somente leitura) -----------------------------
--
--      select
--        count(*) filter (where variacoes_texto is not null) as preenchidos,
--        count(*) filter (where variacoes_texto is null)     as vazios,
--        count(*)                                            as total
--      from public.pedidos_modelos;
--
--    "vazios" esperado = modelos de itens sem variacao + modelos sem
--    id_produto_proposta_origem. Os dois casos sao legitimos.
