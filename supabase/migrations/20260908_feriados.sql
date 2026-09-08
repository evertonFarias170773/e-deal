-- Calendario de feriados: public.feriados
--
-- O QUE E
--   Uma tabela nova, vazia de dependencias:
--
--     public.feriados
--       id           bigint      generated always as identity, PK
--       data         date        NOT NULL
--       descricao    text        NOT NULL
--       abrangencia  text        NOT NULL default 'NACIONAL'
--       uf           text        NULA
--       municipio    text        NULA
--       created_at   timestamptz NOT NULL default now()
--
--   Mais UNIQUE NULLS NOT DISTINCT (data, abrangencia, uf, municipio), CHECK de
--   abrangencia em ('NACIONAL','ESTADUAL','MUNICIPAL'), RLS ligado e UMA
--   politica: SELECT para `authenticated`.
--
--   Populada com os 13 feriados NACIONAIS de 2026 e os 13 de 2027 — 26 linhas.
--
-- POR QUE
--   O calculo de prazo do boletim vai contar DIAS UTEIS, e hoje o sistema nao
--   tem nenhuma fonte de feriado. `somarDiasDeProducao`
--   (src/features/pedidos/prazo-producao.ts:56) so sabe pular sabado e domingo,
--   e o comentario dela diz isso na cara: "feriados nao entram".
--
--   O resultado pratico e que um prazo de 3 dias uteis que atravessa o Carnaval
--   vence dois dias antes do que a fabrica consegue entregar. Esta tabela e o
--   pre-requisito para corrigir isso.
--
-- ============================================================================
-- ESCOPO / O QUE ESTA MIGRATION NAO FAZ
-- ============================================================================
--   Nao cria funcao de calculo de dia util. Isso e a rodada seguinte.
--   Nao altera prazo-producao.ts nem nenhum arquivo do aplicativo.
--   NADA no sistema le esta tabela ainda. Ela nasce inerte.
--   Nao inclui feriado estadual, municipal nem ponto facultativo. As colunas
--   `uf` e `municipio` existem para quando isso for decidido, e ficam nulas.
--   Nao cria indice alem dos que a PK e a UNIQUE criam sozinhas.
--   NAO emite GRANT nem REVOKE — ver "POR QUE RLS E NENHUM GRANT" abaixo.
--   Nao toca em produtos, propostas, propostas_os, propostas_os_setores nem em
--   categoria_frete.
--
-- ============================================================================
-- POR QUE `NULLS NOT DISTINCT` NA UNIQUE
-- ============================================================================
--   A variante importa porque TODA linha desta tabela hoje tem `uf` e
--   `municipio` NULOS — e feriado nacional, e nacional nao tem UF.
--
--   No padrao do Postgres (NULLS DISTINCT), dois NULL contam como valores
--   DIFERENTES. Uma UNIQUE comum sobre (data, abrangencia, uf, municipio)
--   aceitaria, sem reclamar, um segundo:
--
--     ('2026-12-25', 'Natal', 'NACIONAL', null, null)
--
--   Ou seja: a constraint existiria e nao protegeria nada justamente no caso
--   que e 100% das linhas. Com NULLS NOT DISTINCT, dois NULL contam como
--   IGUAIS, e a duplicata e recusada pelo banco.
--
--   Isso exige Postgres 15 ou mais novo. Este banco e 17.4 (medido em
--   08/09/2026), entao a variante esta disponivel.
--
--   A assercao de saida (6) continua contando duplicata por (data, abrangencia)
--   direto, sem depender da constraint. As duas coisas se somam: a assercao
--   valida o que ESTA migration inseriu, a constraint protege o futuro.
--
-- ============================================================================
-- POR QUE RLS E NENHUM GRANT
-- ============================================================================
--   Em `public`, permissao nao e o que tranca — o RLS e.
--
--   `pg_default_acl` concede automaticamente `arwdDxtm` (ALL) a toda tabela
--   nova do schema, sem ninguem escrever um GRANT (medido em 08/09/2026):
--
--     concedente postgres:       authenticated = ALL, service_role = ALL
--     concedente supabase_admin: anon = ALL, authenticated = ALL,
--                                service_role = ALL
--
--   Emitir GRANT aqui seria redundante; emitir REVOKE brigaria com o default do
--   projeto e divergiria das outras tabelas. As tres que conferi
--   (transportadoras, propostas_os_setores, expedicao_recotacoes) tem o mesmo
--   ACL amplo e se protegem por RLS. Esta segue o mesmo padrao.
--
--   A POLITICA E UMA SO, e de leitura:
--
--     feriados_select_authenticated — FOR SELECT TO authenticated USING (true)
--
--   Nao ha politica de INSERT, UPDATE ou DELETE, e a ausencia e a trava: com RLS
--   ligado, operacao sem politica que a permita e simplesmente negada. Pelo
--   PostgREST ninguem grava — nem `anon`, nem `authenticated`, apesar do ACL
--   dizer ALL.
--
--   `service_role` continua escrevendo porque tem BYPASSRLS, e e por isso que o
--   calendario segue populavel por migration. E o desenho pretendido: feriado
--   entra por migration revisada, nao por tela.
--
--   Sem politica para `anon`, a tabela tambem nao responde a chave publica.
--
-- ============================================================================
-- AS DATAS MOVEIS — conferidas, nao copiadas
-- ============================================================================
--   Domingo de Pascoa pelo algoritmo de Meeus/Jones/Butcher:
--     2026 -> 05/04/2026     2027 -> 28/03/2027
--
--   Os quatro deslocamentos, iguais nos dois anos:
--     Carnaval (segunda) = Pascoa - 48
--     Carnaval (terca)   = Pascoa - 47
--     Paixao de Cristo   = Pascoa - 2
--     Corpus Christi     = Pascoa + 60
--
--   Verificado no proprio banco em 08/09/2026, com os offsets e os dias da
--   semana batendo um a um:
--
--     2026-02-16 Monday    -48      2027-02-08 Monday    -48
--     2026-02-17 Tuesday   -47      2027-02-09 Tuesday   -47
--     2026-04-03 Friday     -2      2027-03-26 Friday     -2
--     2026-04-05 Sunday      0      2027-03-28 Sunday      0
--     2026-06-04 Thursday  +60      2027-05-27 Thursday  +60
--
--   O Domingo de Pascoa NAO entra na tabela: nao e feriado civil, e cai no
--   domingo, que o calculo ja pula.
--
--   20 de novembro (Zumbi / Consciencia Negra) entra nos dois anos: e feriado
--   NACIONAL desde a Lei 14.759/2023.
--
--   Quatro dos 26 caem em fim de semana e nao mudam contagem de dia util:
--   2026-11-15 (domingo), 2027-05-01, 2027-11-20 e 2027-12-25 (sabados). Entram
--   assim mesmo: a tabela e o calendario, nao o resultado do calculo.
--
-- ============================================================================
-- MEDIDO NO BANCO EM 08/09/2026, ANTES DE ESCREVER
-- ============================================================================
--   Tabela com nome parecido com feriado/holiday/calendario ...... 0
--   Funcao de feriado / dia util / business day / workday ........ 0
--   Coluna com feriado / dia_util / dias_uteis no nome ........... 1
--     -> public.produtos.prazo_dias_uteis, criada em 08/09/2026.
--        NAO e fonte de feriado: e o consumidor futuro deste calendario.
--
--   Ou seja: nao ha duplicata a criar. Esta e a primeira e unica fonte.
-- ============================================================================

do $migration$
declare
  v_linhas      bigint;
  v_2026        bigint;
  v_2027        bigint;
  v_dup         bigint;
  v_nao_nac     bigint;
  v_com_uf      bigint;
  v_tipo        text;
  v_rls         boolean;
  v_politicas   bigint;
  v_polname     text;
  v_polcmd      "char";
begin
  -- ==========================================================================
  -- ASSERCOES DE ENTRADA
  -- ==========================================================================

  -- 1. A tabela ainda nao existe. Abortar e melhor que "if not exists": uma
  --    homonima criada por outro caminho teria outras colunas, e seguir em
  --    silencio deixaria o banco diferente do que este arquivo diz.
  if to_regclass('public.feriados') is not null then
    raise exception 'ENTRADA: public.feriados JA existe — nada a fazer, confira antes';
  end if;

  -- 2. Nem sob outro nome, em nenhum schema. Se aparecer alguma, esta migration
  --    esta prestes a criar uma segunda fonte de verdade para a mesma pergunta.
  select count(*) into v_linhas
    from information_schema.tables
   where table_name ilike '%feriad%' or table_name ilike '%holiday%';
  if v_linhas <> 0 then
    raise exception 'ENTRADA: ja existe % tabela(s) de feriado no banco — nao crie duplicata', v_linhas;
  end if;

  -- 3. `NULLS NOT DISTINCT` exige Postgres 15+. Sem esta guarda, um banco mais
  --    antigo daria erro de sintaxe cru, sem dizer o motivo.
  if current_setting('server_version_num')::int < 150000 then
    raise exception 'ENTRADA: UNIQUE NULLS NOT DISTINCT exige Postgres 15+, este e %', current_setting('server_version');
  end if;

  -- ==========================================================================
  -- A TABELA
  -- ==========================================================================
  create table public.feriados (
    id          bigint      generated always as identity primary key,
    data        date        not null,
    descricao   text        not null,
    abrangencia text        not null default 'NACIONAL',
    uf          text        null,
    municipio   text        null,
    created_at  timestamptz not null default now(),
    constraint feriados_data_abrangencia_uf_municipio_key
      unique nulls not distinct (data, abrangencia, uf, municipio),
    constraint feriados_abrangencia_check
      check (abrangencia in ('NACIONAL','ESTADUAL','MUNICIPAL'))
  );

  comment on table public.feriados is
    'Calendario de feriados para o calculo de DIAS UTEIS do prazo de producao. Uma linha por feriado por abrangencia. Em feriado NACIONAL, uf e municipio ficam NULOS — a linha vale para o pais inteiro. ESTADUAL preenche uf; MUNICIPAL preenche uf e municipio. Nao guarda ponto facultativo: so dia em que a fabrica nao produz. Populada por migration: RLS esta ligado e NAO ha politica de escrita, entao o PostgREST nao grava aqui. Quem for contar dias uteis deve filtrar pela abrangencia que se aplica ao pedido, e nao assumir que toda linha vale para todo mundo.';

  comment on column public.feriados.data is
    'O dia do feriado. Nao ha ano-base: cada ano tem sua propria linha, inclusive para os feriados de data fixa.';
  comment on column public.feriados.abrangencia is
    'NACIONAL, ESTADUAL ou MUNICIPAL. Define quais das colunas uf/municipio sao relevantes.';
  comment on column public.feriados.uf is
    'Sigla da UF em feriado ESTADUAL ou MUNICIPAL. NULA em NACIONAL.';
  comment on column public.feriados.municipio is
    'Nome do municipio em feriado MUNICIPAL. NULA em NACIONAL e ESTADUAL.';

  -- ==========================================================================
  -- RLS — ligado, com UMA politica, de leitura
  -- ==========================================================================
  -- A trava e a AUSENCIA de politica de escrita, nao um REVOKE. Ver
  -- "POR QUE RLS E NENHUM GRANT" no cabecalho.
  alter table public.feriados enable row level security;

  create policy feriados_select_authenticated on public.feriados
    for select to authenticated using (true);

  -- ==========================================================================
  -- OS FERIADOS NACIONAIS DE 2026 — 13 linhas
  -- ==========================================================================
  insert into public.feriados (data, descricao, abrangencia, uf, municipio) values
    ('2026-01-01', 'Confraternizacao Universal',                    'NACIONAL', null, null),
    ('2026-02-16', 'Carnaval',                                      'NACIONAL', null, null),
    ('2026-02-17', 'Carnaval',                                      'NACIONAL', null, null),
    ('2026-04-03', 'Paixao de Cristo',                              'NACIONAL', null, null),
    ('2026-04-21', 'Tiradentes',                                    'NACIONAL', null, null),
    ('2026-05-01', 'Dia do Trabalho',                               'NACIONAL', null, null),
    ('2026-06-04', 'Corpus Christi',                                'NACIONAL', null, null),
    ('2026-09-07', 'Independencia do Brasil',                       'NACIONAL', null, null),
    ('2026-10-12', 'Nossa Senhora Aparecida',                       'NACIONAL', null, null),
    ('2026-11-02', 'Finados',                                       'NACIONAL', null, null),
    ('2026-11-15', 'Proclamacao da Republica',                      'NACIONAL', null, null),
    ('2026-11-20', 'Dia Nacional de Zumbi e da Consciencia Negra',  'NACIONAL', null, null),
    ('2026-12-25', 'Natal',                                         'NACIONAL', null, null);

  -- ==========================================================================
  -- OS FERIADOS NACIONAIS DE 2027 — 13 linhas
  -- ==========================================================================
  -- Moveis derivadas da Pascoa de 28/03/2027, conferidas no cabecalho.
  insert into public.feriados (data, descricao, abrangencia, uf, municipio) values
    ('2027-01-01', 'Confraternizacao Universal',                    'NACIONAL', null, null),
    ('2027-02-08', 'Carnaval',                                      'NACIONAL', null, null),
    ('2027-02-09', 'Carnaval',                                      'NACIONAL', null, null),
    ('2027-03-26', 'Paixao de Cristo',                              'NACIONAL', null, null),
    ('2027-04-21', 'Tiradentes',                                    'NACIONAL', null, null),
    ('2027-05-01', 'Dia do Trabalho',                               'NACIONAL', null, null),
    ('2027-05-27', 'Corpus Christi',                                'NACIONAL', null, null),
    ('2027-09-07', 'Independencia do Brasil',                       'NACIONAL', null, null),
    ('2027-10-12', 'Nossa Senhora Aparecida',                       'NACIONAL', null, null),
    ('2027-11-02', 'Finados',                                       'NACIONAL', null, null),
    ('2027-11-15', 'Proclamacao da Republica',                      'NACIONAL', null, null),
    ('2027-11-20', 'Dia Nacional de Zumbi e da Consciencia Negra',  'NACIONAL', null, null),
    ('2027-12-25', 'Natal',                                         'NACIONAL', null, null);

  -- ==========================================================================
  -- ASSERCOES DE SAIDA
  -- ==========================================================================

  -- 4. A tabela existe.
  if to_regclass('public.feriados') is null then
    raise exception 'SAIDA: public.feriados nao foi criada';
  end if;

  -- 5. 26 linhas, 13 em cada ano. A quebra por ano existe porque um erro de
  --    digitacao de ano fecharia o total de 26 sem fechar os dois anos.
  select count(*) into v_linhas from public.feriados;
  if v_linhas <> 26 then
    raise exception 'SAIDA: esperado 26 feriados, ha %', v_linhas;
  end if;

  select count(*) into v_2026 from public.feriados where extract(year from data) = 2026;
  select count(*) into v_2027 from public.feriados where extract(year from data) = 2027;
  if v_2026 <> 13 then
    raise exception 'SAIDA: esperado 13 feriados em 2026, ha %', v_2026;
  end if;
  if v_2027 <> 13 then
    raise exception 'SAIDA: esperado 13 feriados em 2027, ha %', v_2027;
  end if;

  -- 6. Toda linha e NACIONAL.
  select count(*) into v_nao_nac from public.feriados where abrangencia <> 'NACIONAL';
  if v_nao_nac <> 0 then
    raise exception 'SAIDA: % linha(s) com abrangencia diferente de NACIONAL', v_nao_nac;
  end if;

  -- 7. Nenhuma data duplicada dentro da mesma abrangencia. Contada aqui, e nao
  --    delegada a UNIQUE: a assercao valida o que ESTA migration inseriu, a
  --    constraint protege o futuro. Ver "POR QUE NULLS NOT DISTINCT".
  select count(*) into v_dup from (
    select data, abrangencia
      from public.feriados
     group by data, abrangencia
    having count(*) > 1
  ) d;
  if v_dup <> 0 then
    raise exception 'SAIDA: % data(s) duplicada(s) dentro da mesma abrangencia', v_dup;
  end if;

  -- 8. Toda linha com uf e municipio nulos — e o que "NACIONAL" significa.
  select count(*) into v_com_uf
    from public.feriados
   where uf is not null or municipio is not null;
  if v_com_uf <> 0 then
    raise exception 'SAIDA: % linha(s) NACIONAL com uf ou municipio preenchido', v_com_uf;
  end if;

  -- 9. As moveis de cada ano caidas onde deveriam. Esta assercao pega o erro que
  --    nenhuma contagem pega: data plausivel, mas trocada.
  if not exists (select 1 from public.feriados where data = '2026-02-17' and descricao = 'Carnaval') then
    raise exception 'SAIDA: Carnaval de 2026 (terca, 17/02) ausente';
  end if;
  if not exists (select 1 from public.feriados where data = '2026-04-03' and descricao = 'Paixao de Cristo') then
    raise exception 'SAIDA: Paixao de Cristo de 2026 (03/04) ausente';
  end if;
  if not exists (select 1 from public.feriados where data = '2026-06-04' and descricao = 'Corpus Christi') then
    raise exception 'SAIDA: Corpus Christi de 2026 (04/06) ausente';
  end if;
  if not exists (select 1 from public.feriados where data = '2027-02-09' and descricao = 'Carnaval') then
    raise exception 'SAIDA: Carnaval de 2027 (terca, 09/02) ausente';
  end if;
  if not exists (select 1 from public.feriados where data = '2027-03-26' and descricao = 'Paixao de Cristo') then
    raise exception 'SAIDA: Paixao de Cristo de 2027 (26/03) ausente';
  end if;
  if not exists (select 1 from public.feriados where data = '2027-05-27' and descricao = 'Corpus Christi') then
    raise exception 'SAIDA: Corpus Christi de 2027 (27/05) ausente';
  end if;

  -- 10. A coluna `data` e mesmo date, e nao timestamp. Um timestamp aqui faria a
  --     comparacao com o dia do calculo depender de fuso.
  select data_type into v_tipo
    from information_schema.columns
   where table_schema='public' and table_name='feriados' and column_name='data';
  if v_tipo <> 'date' then
    raise exception 'SAIDA: feriados.data deveria ser date, e %', v_tipo;
  end if;

  -- 11. A UNIQUE ficou NULLS NOT DISTINCT. Sem esta checagem, uma constraint que
  --     silenciosamente virasse a variante padrao passaria despercebida — e ela
  --     nao protege nada quando uf e municipio sao nulos.
  --
  --     A flag NAO vive em pg_constraint: nao existe `connullsnotdistinct`
  --     (conferido neste banco em 08/09/2026, o SELECT da erro 42703). Ela e
  --     propriedade do INDICE que sustenta a constraint —
  --     `pg_index.indnullsnotdistinct` — alcancada por `conindid`.
  if not exists (
    select 1
      from pg_constraint c
      join pg_index i on i.indexrelid = c.conindid
     where c.conrelid = 'public.feriados'::regclass
       and c.conname = 'feriados_data_abrangencia_uf_municipio_key'
       and c.contype = 'u'
       and i.indnullsnotdistinct
  ) then
    raise exception 'SAIDA: a UNIQUE nao ficou NULLS NOT DISTINCT';
  end if;

  -- 12. RLS LIGADO. Sem isto a tabela fica gravavel pelo PostgREST para todo
  --     usuario autenticado, porque o default privilege do schema ja concede
  --     ALL. Ver "POR QUE RLS E NENHUM GRANT".
  select relrowsecurity into v_rls
    from pg_class where oid = 'public.feriados'::regclass;
  if v_rls is not true then
    raise exception 'SAIDA: RLS nao ficou ligado em public.feriados';
  end if;

  -- 13. EXATAMENTE UMA politica, e ela e de SELECT. Politica de escrita aqui
  --     abriria a tabela para a tela, que e o oposto do desenho.
  select count(*) into v_politicas
    from pg_policy where polrelid = 'public.feriados'::regclass;
  if v_politicas <> 1 then
    raise exception 'SAIDA: esperada exatamente 1 politica em public.feriados, ha %', v_politicas;
  end if;

  select polname, polcmd into v_polname, v_polcmd
    from pg_policy where polrelid = 'public.feriados'::regclass;
  if v_polcmd <> 'r' then
    raise exception 'SAIDA: a unica politica deveria ser de SELECT, e "%" (polcmd=%)', v_polname, v_polcmd;
  end if;
  if v_polname <> 'feriados_select_authenticated' then
    raise exception 'SAIDA: politica com nome inesperado: %', v_polname;
  end if;

  raise notice 'SAIDA OK: public.feriados criada com % feriados nacionais (% em 2026, % em 2027)', v_linhas, v_2026, v_2027;
  raise notice 'SAIDA OK: RLS ligado, 1 politica (% / SELECT / authenticated), sem politica de escrita', v_polname;
end
$migration$;

-- ============================================================================
-- ROLLBACK (comentado, nao executar sem decisao explicita)
-- ============================================================================
--   Enquanto nada le a tabela, o rollback nao perde nada: as 26 linhas sao
--   calendario publico, reproduzivel a partir deste mesmo arquivo.
--
--   Isso deixa de valer no dia em que alguem ACRESCENTAR feriado estadual ou
--   municipal — esses nao estao neste arquivo e nao voltam. A assercao abaixo
--   aborta se encontrar qualquer linha que esta migration nao escreveu.
--
--   DROP TABLE leva junto a politica e o RLS; nao ha o que desfazer a parte.
--
--   do $rollback$
--   declare
--     v_estranhas bigint;
--   begin
--     select count(*) into v_estranhas
--       from public.feriados
--      where abrangencia <> 'NACIONAL'
--         or extract(year from data) not in (2026, 2027);
--
--     if v_estranhas > 0 then
--       raise exception 'ROLLBACK ABORTADO: % linha(s) que esta migration nao criou. Exporte antes de derrubar.', v_estranhas;
--     end if;
--
--     drop table public.feriados;
--
--     raise notice 'ROLLBACK OK: tabela removida, so continha os 26 nacionais de 2026-2027';
--   end
--   $rollback$;
-- ============================================================================
