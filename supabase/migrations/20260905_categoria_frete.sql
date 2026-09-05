-- Categoria do frete: propostas.categoria_frete e expedicoes.categoria_frete
--
-- O QUE E
--   Duas colunas aditivas, iguais:
--
--     public.propostas.categoria_frete   text  NULA, SEM default
--     public.expedicoes.categoria_frete  text  NULA, SEM default
--
--   Guardam UMA das sete categorias do painel da Expedicao — CORREIOS, MOTOBOY,
--   RETIRA, RODOVIARIO, AEREO, VEPPO, EXTRAS — ou NULA, que significa "ainda nao
--   classificada". O vocabulario e a derivacao vivem em
--   src/features/orcamentos/lib/categoria-frete.ts.
--
-- POR QUE
--   O kanban da Expedicao cria hoje UMA COLUNA POR NOME de transportadora
--   (KanbanTransportadoras.tsx, colunaDoPedido: a chave e `T:${nome}`), e cresce
--   sem limite conforme aparecem nomes novos. A direcao quer colunas FIXAS por
--   categoria, com o nome da transportadora dentro do card.
--
--   `propostas.transporte_categoria`, que ja existe, NAO responde isso: ela tem
--   quatro valores (RETIRA/MOTOBOY/CORREIOS/TRANSPORTADORA) e funde numa so
--   coisa o que o painel precisa separar — rodoviario, aereo e Veppo virariam
--   todos "TRANSPORTADORA". Ela continua existindo, intocada, respondendo a
--   pergunta dela.
--
-- POR QUE DUAS TABELAS, E NAO SO `propostas`
--   Mesmo padrao snapshot do resto do modulo: `propostas` guarda o que foi
--   DECLARADO no orcamento; `expedicoes` guarda o que o expedidor declarou no
--   DESPACHO, e depois do despacho e ela que vale. E a mesma precedencia que
--   `modalidadeInicialDoDespacho` ja aplica para a modalidade.
--
--   Sem a coluna em `expedicoes`, um pedido recotado ou despachado por outro
--   meio ficaria para sempre na coluna que o orcamento escolheu. A recotacao e o
--   caso concreto: `exp_aplicar_recotacao` grava so `valor_frete` e
--   `valor_total`, e a transportadora recotada nunca chega a `propostas`.
--
-- POR QUE NAO EM `cotacao_frete`
--   Ela tem TRES triggers vivos — trg_recalc_after_frete, trg_frete_sync_financeiro
--   e tg_recalc_frete_v4 — que reescrevem valor_total e status_interno. Escrever
--   ali fora do orcamento tira o pedido do funil logistico. Fora de questao.
--
-- ============================================================================
-- ESCOPO / O QUE ESTA MIGRATION NAO FAZ
-- ============================================================================
--   Nao faz BACKFILL, em nenhuma das duas tabelas. Todas as linhas ficam NULAS.
--   Nao cria default, CHECK, FK, indice, trigger, funcao, view, RPC nem politica.
--   Nao concede nem revoga permissao, nao toca em RLS.
--   Nao altera nenhuma coluna existente, em tabela nenhuma.
--   Nao toca em cotacao_frete, pagamentos_v2, boletos, notas_fiscais.
--   Nao altera codigo do aplicativo: a gravacao vem em rodada separada, e ate la
--   as duas colunas ficam nulas e ninguem as le.
--
-- POR QUE SEM CHECK
--   O vocabulario e do aplicativo e vai crescer por decisao de negocio (VEPPO ja
--   e a prova de que a lista nao e derivavel de primeiros principios). Um CHECK
--   aqui exigiria migration a cada categoria nova, e a validacao real acontece em
--   `ehCategoriaFrete`, na fronteira de escrita. NULA e valor legitimo e o mais
--   comum hoje: 9.032 linhas nascem assim.
--
-- ============================================================================
-- updated_at: POR QUE ESTA MIGRATION NAO O MOVE
-- ============================================================================
--   `public.propostas` tem DOIS triggers BEFORE UPDATE que carimbam o relogio
--   incondicionalmente, sem lista `UPDATE OF` (verificados no banco em
--   05/09/2026):
--
--     propostas_set_timestamp  BEFORE UPDATE -> set_timestamp_updated_at()
--       begin new.updated_at = now(); return new; end
--
--     trg_set_updated_at       BEFORE UPDATE -> set_updated_at()
--       BEGIN NEW.updated_at := now(); RETURN NEW; END
--
--   Qualquer UPDATE em qualquer coluna de `propostas` — inclusive um que grave
--   SO `categoria_frete` — reescreve `updated_at`. Nao adianta passar
--   `updated_at = updated_at` no proprio comando: os dois rodam BEFORE e
--   sobrescrevem o NEW depois. E nao adianta corrigir com um segundo UPDATE,
--   porque ele dispara os mesmos dois.
--
--   ESTA MIGRATION NAO EMITE NENHUM UPDATE. `ALTER TABLE ... ADD COLUMN <tipo>
--   NULL` SEM DEFAULT nao reescreve a tabela e nao dispara trigger de linha: o
--   Postgres so anota a coluna no catalogo e devolve NULL na leitura. Por isso o
--   `updated_at` de todas as 9.032 propostas e das 65 expedicoes fica exatamente
--   onde esta — e as assercoes de saida PROVAM isso comparando um md5 de
--   (id, updated_at) de todas as linhas, antes e depois, nao apenas o max().
--
--   O BACKFILL, quando e se for autorizado, e outra conversa e outra migration.
--   Ele NAO cabe aqui justamente por causa destes dois triggers.
--
-- ============================================================================
-- MEDIDO NO BANCO EM 05/09/2026, ANTES DE ESCREVER
-- ============================================================================
--   public.propostas .... 9.032 linhas, 59 colunas
--                         categoria_frete NAO existe (0 em information_schema)
--                         max(updated_at) = 2026-09-05 16:21:44.194024+00
--
--   public.expedicoes ...    65 linhas, 36 colunas
--                         categoria_frete NAO existe (0 em information_schema)
--                         max(updated_at) = 2026-09-04 22:04:29.913+00
--
--   Classificacao que a derivacao ALCANCARIA hoje, so para dimensionar (nenhuma
--   linha e escrita aqui): 948 das 9.032 — CORREIOS 623, RETIRA 138, MOTOBOY 83,
--   AEREO 42, RODOVIARIO 33, VEPPO 29. Outras 2.076 cairiam em EXTRAS e 6.008
--   ficariam NULAS.
-- ============================================================================

do $migration$
declare
  v_prop_linhas    bigint;
  v_exp_linhas     bigint;
  v_prop_hash      text;
  v_exp_hash       text;
  v_prop_linhas_d  bigint;
  v_exp_linhas_d   bigint;
  v_prop_hash_d    text;
  v_exp_hash_d     text;
  v_tipo           text;
  v_nulavel        text;
  v_default        text;
  v_nao_nulas      bigint;
begin
  -- ==========================================================================
  -- ASSERCOES DE ENTRADA
  -- ==========================================================================

  -- 1. As duas tabelas existem.
  if to_regclass('public.propostas') is null then
    raise exception 'ENTRADA: public.propostas nao existe';
  end if;
  if to_regclass('public.expedicoes') is null then
    raise exception 'ENTRADA: public.expedicoes nao existe';
  end if;

  -- 2. Nenhuma das duas ja tem a coluna. Abortar e melhor que "if not exists":
  --    coluna homonima criada por outro caminho teria outro tipo ou default, e
  --    seguir em silencio deixaria o banco diferente do que este arquivo diz.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'propostas'
       and column_name = 'categoria_frete'
  ) then
    raise exception 'ENTRADA: propostas.categoria_frete JA existe — nada a fazer, confira antes';
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'expedicoes'
       and column_name = 'categoria_frete'
  ) then
    raise exception 'ENTRADA: expedicoes.categoria_frete JA existe — nada a fazer, confira antes';
  end if;

  -- 3. Contagem e retrato do updated_at de TODAS as linhas, para provar na
  --    saida que nenhuma foi tocada. O hash cobre linha a linha; o max() sozinho
  --    nao pegaria uma linha antiga carimbada para o passado.
  select count(*) into v_prop_linhas from public.propostas;
  select count(*) into v_exp_linhas  from public.expedicoes;

  select md5(coalesce(string_agg(id::text || '|' || coalesce(updated_at::text, '(null)'), ',' order by id), ''))
    into v_prop_hash from public.propostas;
  select md5(coalesce(string_agg(id::text || '|' || coalesce(updated_at::text, '(null)'), ',' order by id), ''))
    into v_exp_hash  from public.expedicoes;

  raise notice 'ENTRADA propostas:  % linhas, hash updated_at %', v_prop_linhas, v_prop_hash;
  raise notice 'ENTRADA expedicoes: % linhas, hash updated_at %', v_exp_linhas, v_exp_hash;

  -- 4. As contagens medidas em 05/09/2026. Divergencia nao aborta: a base e
  --    viva e pedidos entram o tempo todo. O aviso existe para quem le o log
  --    saber contra o que este arquivo foi escrito.
  if v_prop_linhas <> 9032 then
    raise notice 'AVISO: propostas tinha 9032 linhas quando esta migration foi escrita, tem % agora', v_prop_linhas;
  end if;
  if v_exp_linhas <> 65 then
    raise notice 'AVISO: expedicoes tinha 65 linhas quando esta migration foi escrita, tem % agora', v_exp_linhas;
  end if;

  -- ==========================================================================
  -- A MUDANCA — duas linhas de DDL, e mais nada
  -- ==========================================================================
  -- ADD COLUMN text NULL SEM DEFAULT: so catalogo. Nao reescreve a tabela, nao
  -- dispara trigger de linha, nao move updated_at.
  alter table public.propostas  add column categoria_frete text;
  alter table public.expedicoes add column categoria_frete text;

  comment on column public.propostas.categoria_frete is
    'Categoria do frete declarada no orcamento: CORREIOS, MOTOBOY, RETIRA, RODOVIARIO, AEREO, VEPPO ou EXTRAS. Nula = nao classificada, exibida em EXTRAS. Vocabulario e derivacao em src/features/orcamentos/lib/categoria-frete.ts. NAO confundir com transporte_categoria, que responde outra pergunta e tem quatro valores.';

  comment on column public.expedicoes.categoria_frete is
    'Categoria do frete declarada no DESPACHO. Vale sobre a da proposta depois que data_despacho e preenchida, mesma precedencia que modalidadeInicialDoDespacho ja aplica a modalidade.';

  -- ==========================================================================
  -- ASSERCOES DE SAIDA
  -- ==========================================================================

  -- 5. As colunas existem, com o tipo e a nulabilidade prometidos, e SEM default.
  select data_type, is_nullable, column_default
    into v_tipo, v_nulavel, v_default
    from information_schema.columns
   where table_schema = 'public' and table_name = 'propostas' and column_name = 'categoria_frete';

  if v_tipo is null then
    raise exception 'SAIDA: propostas.categoria_frete nao foi criada';
  end if;
  if v_tipo <> 'text' then
    raise exception 'SAIDA: propostas.categoria_frete deveria ser text, e %', v_tipo;
  end if;
  if v_nulavel <> 'YES' then
    raise exception 'SAIDA: propostas.categoria_frete deveria ser nulavel';
  end if;
  if v_default is not null then
    raise exception 'SAIDA: propostas.categoria_frete nao deveria ter default, tem %', v_default;
  end if;

  select data_type, is_nullable, column_default
    into v_tipo, v_nulavel, v_default
    from information_schema.columns
   where table_schema = 'public' and table_name = 'expedicoes' and column_name = 'categoria_frete';

  if v_tipo is null then
    raise exception 'SAIDA: expedicoes.categoria_frete nao foi criada';
  end if;
  if v_tipo <> 'text' then
    raise exception 'SAIDA: expedicoes.categoria_frete deveria ser text, e %', v_tipo;
  end if;
  if v_nulavel <> 'YES' then
    raise exception 'SAIDA: expedicoes.categoria_frete deveria ser nulavel';
  end if;
  if v_default is not null then
    raise exception 'SAIDA: expedicoes.categoria_frete nao deveria ter default, tem %', v_default;
  end if;

  -- 6. SEM BACKFILL: toda linha nula nas duas tabelas.
  select count(*) into v_nao_nulas from public.propostas where categoria_frete is not null;
  if v_nao_nulas <> 0 then
    raise exception 'SAIDA: esta migration nao faz backfill, mas % propostas tem categoria_frete preenchida', v_nao_nulas;
  end if;

  select count(*) into v_nao_nulas from public.expedicoes where categoria_frete is not null;
  if v_nao_nulas <> 0 then
    raise exception 'SAIDA: esta migration nao faz backfill, mas % expedicoes tem categoria_frete preenchida', v_nao_nulas;
  end if;

  -- 7. NENHUMA LINHA FOI TOCADA. Contagem igual E hash de (id, updated_at)
  --    identico ao da entrada, linha a linha, nas duas tabelas. Esta e a
  --    assercao que importa: e ela que prova que o `updated_at` de ninguem
  --    andou, apesar dos dois triggers BEFORE UPDATE incondicionais.
  select count(*) into v_prop_linhas_d from public.propostas;
  select count(*) into v_exp_linhas_d  from public.expedicoes;

  select md5(coalesce(string_agg(id::text || '|' || coalesce(updated_at::text, '(null)'), ',' order by id), ''))
    into v_prop_hash_d from public.propostas;
  select md5(coalesce(string_agg(id::text || '|' || coalesce(updated_at::text, '(null)'), ',' order by id), ''))
    into v_exp_hash_d  from public.expedicoes;

  if v_prop_linhas_d <> v_prop_linhas then
    raise exception 'SAIDA: propostas mudou de % para % linhas', v_prop_linhas, v_prop_linhas_d;
  end if;
  if v_exp_linhas_d <> v_exp_linhas then
    raise exception 'SAIDA: expedicoes mudou de % para % linhas', v_exp_linhas, v_exp_linhas_d;
  end if;

  if v_prop_hash_d <> v_prop_hash then
    raise exception 'SAIDA: updated_at de propostas MUDOU (antes % / depois %)', v_prop_hash, v_prop_hash_d;
  end if;
  if v_exp_hash_d <> v_exp_hash then
    raise exception 'SAIDA: updated_at de expedicoes MUDOU (antes % / depois %)', v_exp_hash, v_exp_hash_d;
  end if;

  raise notice 'SAIDA OK: duas colunas criadas, 0 linhas escritas, updated_at intacto nas duas tabelas';
end
$migration$;

-- ============================================================================
-- ROLLBACK (comentado, nao executar sem decisao explicita)
-- ============================================================================
--   Enquanto nao houver backfill nem gravacao pelo aplicativo, o rollback e
--   simetrico e nao perde dado nenhum: as colunas estao 100% nulas.
--
--   Depois que a Etapa 4 comecar a gravar, DROP COLUMN apaga a classificacao
--   feita ate ali — e ela nao volta, porque parte dela e escolha humana
--   (rodoviario ou aereo no drop de FOB e no frete manual), nao derivacao. A
--   partir dali, exportar antes de derrubar.
--
--   do $rollback$
--   declare
--     v_preenchidas bigint;
--   begin
--     select
--       (select count(*) from public.propostas  where categoria_frete is not null) +
--       (select count(*) from public.expedicoes where categoria_frete is not null)
--       into v_preenchidas;
--
--     if v_preenchidas > 0 then
--       raise exception 'ROLLBACK ABORTADO: % linhas ja tem categoria_frete. Exporte antes de derrubar.', v_preenchidas;
--     end if;
--
--     alter table public.propostas  drop column categoria_frete;
--     alter table public.expedicoes drop column categoria_frete;
--
--     raise notice 'ROLLBACK OK: duas colunas removidas, nenhuma linha tinha valor';
--   end
--   $rollback$;
--
--   DROP COLUMN tambem e so catalogo: nao reescreve a tabela e nao move
--   updated_at, pelo mesmo motivo do ADD COLUMN.
-- ============================================================================
