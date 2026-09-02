-- expedicoes.obs_etiqueta e expedicoes.nf_numero_manual — o que a ETIQUETA imprime
--
-- O QUE MUDA
--   Duas colunas em `public.expedicoes`, ambas `text NULL` sem default:
--     obs_etiqueta      texto livre impresso no volume;
--     nf_numero_manual  numero de NF digitado a mao, FALLBACK.
--   Nada mais. Nenhum status novo, nenhum trigger, nenhuma RLS, nenhum backfill,
--   e NENHUMA linha de `obs` tocada.
--
-- POR QUE UMA COLUNA NOVA, E NAO REUSAR `expedicoes.obs`
--   `obs` ja existe e ja tem dono: e a "Observacao logistica" do modal Despachar
--   — recado interno de quem despacha para quem opera ("fragil", "entregar no
--   turno da manha"). Ela viaja ate `EtiquetaViewModel.obs`
--   (etiqueta-viewmodel.service.ts:362), mas NAO E IMPRESSA em documento nenhum:
--   nem na etiqueta 10x15, nem na Declaracao de Conteudo, nem na prepostagem.
--   Conferido por leitura nos quatro consumidores em 02/09/2026.
--
--   As duas semanticas sao diferentes o bastante para nao dividirem coluna:
--
--     obs           interna, gated por `expConfirmado` (rascunho nao vale),
--                   escrita para o time. Ninguem de fora le.
--     obs_etiqueta  EXTERNA: vai colada no volume, e lida pela transportadora e
--                   pelo destinatario. "RETIRA NO AEROPORTO DE CONGONHAS ATE
--                   MEIO DIA DE SEXTA" e este campo.
--
--   Reusar `obs` faria o recado interno virar publico de uma vez so, em toda a
--   base — inclusive na linha que hoje ja tem `obs` preenchida. E o caminho de
--   volta seria pior: separar depois exigiria adivinhar, texto a texto, qual
--   recado era para dentro e qual era para fora.
--
-- POR QUE `nf_numero_manual` E SO FALLBACK
--   `notas_fiscais.numero_nf` SEMPRE VENCE (decisao do dono, 02/09/2026). A
--   etiqueta ja resolve a nota por `escolherNotaAutorizadaDoPedido`, o mesmo
--   criterio da lista e do lancamento de boletos, e esse continua sendo o dado
--   verdadeiro. Este campo so responde quando NAO ha nota autorizada — remessa
--   sem NF, devolucao, brinde — em que hoje a etiqueta sai com o rodape vazio e
--   alguem escreve o numero a caneta.
--
--   A precedencia mora no codigo (proxima etapa), nao aqui: a coluna guarda o
--   que foi digitado, e nada mais. Sem `check`, sem trigger, sem sincronizacao —
--   qualquer uma das tres criaria uma segunda verdade sobre o numero da nota,
--   que e exatamente o que a decisao evitou.
--
-- O QUE NAO MUDA
--   - `expedicoes.obs` continua identica em todas as linhas. Esta migration nao
--     a le, nao a escreve e nao a copia;
--   - nenhum trigger e disparado: `public.expedicoes` NAO TEM TRIGGER NENHUM,
--     conferido na assercao de entrada, e `ADD COLUMN` de coluna nulavel sem
--     default nao reescreve a tabela;
--   - nenhuma outra tabela e tocada: `empresas`, `notas_fiscais` e `propostas`
--     ficam de fora.
--
-- MEDIDO ANTES DE APLICAR (02/09/2026)
--   49 linhas em `expedicoes`, 1 delas com `obs` preenchida, 0 triggers, e
--   nenhuma das duas colunas ja existindo.

begin;

-- 1. ASSERCOES DE ENTRADA -----------------------------------------------------
do $$
declare
  v_col int;
  v_trg int;
begin
  select count(*) into v_col
  from information_schema.columns
  where table_schema = 'public' and table_name = 'expedicoes'
    and column_name in ('obs_etiqueta', 'nf_numero_manual');

  if v_col > 0 then
    raise exception 'ABORTADO: % das colunas novas ja existe(m) em public.expedicoes. Migration ja aplicada?', v_col;
  end if;

  -- A coluna que NAO pode ser confundida com as novas precisa estar la.
  perform 1
  from information_schema.columns
  where table_schema = 'public' and table_name = 'expedicoes' and column_name = 'obs';
  if not found then
    raise exception 'ABORTADO: public.expedicoes.obs nao existe. A premissa de que ha uma observacao interna separada deixou de valer.';
  end if;

  select count(*) into v_trg
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where not t.tgisinternal and n.nspname = 'public' and c.relname = 'expedicoes';

  if v_trg <> 0 then
    raise exception 'ABORTADO: public.expedicoes passou a ter % trigger(s). A premissa de que o ADD COLUMN nao dispara nada deixou de valer — reconferir antes de aplicar.', v_trg;
  end if;

  raise notice 'Entrada OK: colunas ausentes, obs presente, zero triggers em expedicoes.';
end $$;

-- 2. AS COLUNAS ---------------------------------------------------------------
--    Nulaveis e sem default de proposito: NULL e "nao ha observacao" e "nao ha
--    numero digitado". Um default faria toda linha existente nascer com texto.
alter table public.expedicoes
  add column obs_etiqueta text,
  add column nf_numero_manual text;

comment on column public.expedicoes.obs_etiqueta is
  'Observacao IMPRESSA na etiqueta 10x15, lida pela transportadora e pelo destinatario. Distinta de expedicoes.obs, que e recado interno da bancada e nao sai em documento nenhum. NULL = etiqueta sem linha de observacao.';

comment on column public.expedicoes.nf_numero_manual is
  'Numero de NF digitado a mao, FALLBACK. notas_fiscais.numero_nf SEMPRE VENCE: este campo so e usado quando nao ha nota autorizada para o pedido (remessa sem NF, devolucao, brinde). A precedencia vive no codigo; esta coluna nao sincroniza com notas_fiscais e nao deve ser tratada como fonte do numero da nota.';

-- 3. ASSERCOES DE SAIDA -------------------------------------------------------
do $$
declare
  r record;
  v_nao_nulas int;
  v_obs_mudou int;
begin
  for r in
    select column_name, data_type, is_nullable, column_default
    from information_schema.columns
    where table_schema = 'public' and table_name = 'expedicoes'
      and column_name in ('obs_etiqueta', 'nf_numero_manual')
  loop
    if r.data_type <> 'text' then
      raise exception 'ABORTADO: % nasceu como %, esperado text.', r.column_name, r.data_type;
    end if;
    if r.is_nullable <> 'YES' then
      raise exception 'ABORTADO: % nasceu NOT NULL.', r.column_name;
    end if;
    if r.column_default is not null then
      raise exception 'ABORTADO: % nasceu com default (%).', r.column_name, r.column_default;
    end if;
  end loop;

  select count(*) into v_nao_nulas
  from information_schema.columns
  where table_schema = 'public' and table_name = 'expedicoes'
    and column_name in ('obs_etiqueta', 'nf_numero_manual');
  if v_nao_nulas <> 2 then
    raise exception 'ABORTADO: esperado 2 colunas novas, encontrado %.', v_nao_nulas;
  end if;

  select count(*) into v_nao_nulas
  from public.expedicoes
  where obs_etiqueta is not null or nf_numero_manual is not null;
  if v_nao_nulas <> 0 then
    raise exception 'ABORTADO: % linha(s) ja nasceram com conteudo nas colunas novas.', v_nao_nulas;
  end if;

  -- `obs` intocada: exatamente uma linha preenchida, como medido antes.
  select count(*) into v_obs_mudou from public.expedicoes where obs is not null;
  if v_obs_mudou <> 1 then
    raise exception 'ABORTADO: expedicoes.obs tem % linha(s) preenchida(s), esperado 1. Alguma coisa escreveu em obs.', v_obs_mudou;
  end if;

  raise notice 'Saida OK: duas colunas text nulaveis sem default, todas as linhas nulas, obs intocada.';
end $$;

commit;

-- 4. CONFERENCIA POS-APLICACAO (somente leitura) ------------------------------
--
--    4.1 As colunas (esperado: text / YES / default nulo, nas duas)
--
--      select column_name, data_type, is_nullable, column_default
--      from information_schema.columns
--      where table_schema='public' and table_name='expedicoes'
--        and column_name in ('obs_etiqueta','nf_numero_manual');
--
--    4.2 Nenhum trigger apareceu (esperado: 0)
--
--      select count(*) from pg_trigger t
--      join pg_class c on c.oid=t.tgrelid
--      join pg_namespace n on n.oid=c.relnamespace
--      where not t.tgisinternal and n.nspname='public' and c.relname='expedicoes';
--
--    4.3 Todas nulas e obs intocada (esperado: 49 / 0 / 0 / 1)
--
--      select count(*) as linhas,
--             count(obs_etiqueta) as com_obs_etiqueta,
--             count(nf_numero_manual) as com_nf_manual,
--             count(obs) as com_obs
--      from public.expedicoes;
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK
--
--   As duas colunas sao aditivas e nascem nulas em toda a base: derruba-las
--   devolve o estado anterior byte a byte, desde que o app ainda nao esteja
--   gravando nelas. Se ja estiver, DROP apaga a observacao impressa e o numero
--   digitado a mao — e ai o caminho e parar o app primeiro.
--
--   `expedicoes.obs` nao e afetada pelo rollback: ela nunca foi tocada.
--
--   Nenhum outro objeto foi criado. Nenhum dado foi alterado.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- alter table public.expedicoes drop column obs_etiqueta;
-- alter table public.expedicoes drop column nf_numero_manual;
