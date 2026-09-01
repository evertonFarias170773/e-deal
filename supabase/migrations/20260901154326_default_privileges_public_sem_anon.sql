-- =====================================================================
-- Objeto novo no schema `public` deixa de nascer aberto ao `anon`
-- =====================================================================
--
-- APLICADA em 01/09/2026.
--
-- !! RESULTADO MEDIDO: FUNCIONOU PARA TABELAS E SEQUENCES, NAO PARA FUNCOES.
-- !!
-- !! Teste em transacao abortada, logo apos aplicar, criando uma tabela e uma
-- !! funcao novas como `postgres` no schema public:
-- !!
-- !!   relacl da tabela  = {postgres=arwdDxtm/postgres,
-- !!                        authenticated=arwdDxtm/postgres,
-- !!                        service_role=arwdDxtm/postgres}      <- anon FORA, correto
-- !!
-- !!   proacl da funcao  = {=X/postgres,                          <- PUBLIC AINDA PRESENTE
-- !!                        postgres=X/postgres,
-- !!                        authenticated=X/postgres,
-- !!                        service_role=X/postgres}
-- !!
-- !! O `anon` nominal saiu dos tres conjuntos do pg_default_acl, como as
-- !! assercoes verificaram. Mas o `=X/postgres` no proacl e o PUBLIC, e ele
-- !! sobreviveu: o `alter default privileges ... revoke execute on functions
-- !! from public` foi um NO-OP neste banco. Como `anon` herda de PUBLIC,
-- !! has_function_privilege(anon, <funcao nova>, EXECUTE) continua TRUE.
-- !!
-- !! Ou seja: FUNCAO NOVA AINDA NASCE EXECUTAVEL POR QUALQUER PAPEL. E a mesma
-- !! armadilha descrita na secao "NENHUM DEFAULT PRIVILEGE CONCEDE A PUBLIC"
-- !! abaixo — o PUBLIC do CREATE FUNCTION nao passa por pg_default_acl, e
-- !! aparentemente tambem nao e suprimido por ele.
-- !!
-- !! AS ASSERCOES PASSARAM MESMO ASSIM, e isso e um defeito delas: verificam o
-- !! catalogo (`defaclacl not like %anon=%`) e nao o COMPORTAMENTO. Uma
-- !! assercao honesta teria criado um objeto de teste e conferido o ACL dele.
-- !!
-- !! CONSEQUENCIA PRATICA: enquanto isso nao for resolvido, toda migration que
-- !! criar funcao em `public` PRECISA fechar na mao:
-- !!
-- !!   revoke all on function public.nova_funcao(...) from public, anon;
-- !!   grant execute on function public.nova_funcao(...) to authenticated, service_role;
-- !!
-- !! O ganho desta migration nao e nulo: tabela, view e sequence novas passaram
-- !! a nascer sem `anon`, e o `anon` nominal saiu do default de funcoes. O que
-- !! falta e so o PUBLIC das funcoes.
--
-- O QUE
-- -----
-- `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public`:
--   * REVOKE ALL ON TABLES     FROM anon        (cobre tabelas e views)
--   * REVOKE ALL ON SEQUENCES  FROM anon
--   * REVOKE ALL ON FUNCTIONS  FROM anon
--   * REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC
--
-- `authenticated` e `service_role` ficam INTACTOS.
--
-- NAO ALTERA NENHUM OBJETO EXISTENTE. Default privilege so decide o ACL de
-- objeto criado DEPOIS dele. Toda tabela, view, sequence e funcao que ja existe
-- mantem exatamente os grants que tem hoje — inclusive as que ainda estao
-- abertas ao anon. Esta migration nao fecha nada; ela impede que o buraco volte.
--
-- POR QUE — esta e a RAIZ das quatro migrations anteriores
-- --------------------------------------------------------
-- Em 01/09/2026 foram fechados, um a um:
--
--   f87a9b0  token_inter          anon lia o token bancario do Inter, em texto puro
--   93e0a9b  clientes, enderecos  anon lia e escrevia 65.966 cadastros com CPF/CNPJ
--   5cd1cea  38 funcoes           anon varria a base de propostas por id_int sequencial
--
-- Nenhuma dessas aberturas foi criada de proposito. Todas nasceram do mesmo
-- lugar: o objeto foi criado e o banco concedeu acesso ao `anon` sozinho. Sem
-- mexer aqui, a proxima tabela e a proxima funcao nascem abertas do mesmo jeito,
-- e o trabalho recomeca.
--
-- LEVANTAMENTO — o que existe hoje (pg_default_acl, 01/09/2026)
-- -------------------------------------------------------------
-- Onze conjuntos de default privileges. Os que concedem ao `anon`:
--
--   dono            schema           objeto        concede a
--   postgres        public           tabela/view   anon, authenticated, service_role  <- ESTA MIGRATION
--   postgres        public           sequence      anon, authenticated, service_role  <- ESTA MIGRATION
--   postgres        public           funcao        anon, authenticated, service_role  <- ESTA MIGRATION
--   supabase_admin  public           tabela/view   anon, authenticated, service_role  <- NAO ALCANCAVEL (ver abaixo)
--   supabase_admin  public           sequence      idem                                <- NAO ALCANCAVEL
--   supabase_admin  public           funcao        idem                                <- NAO ALCANCAVEL
--   postgres        storage          os tres       idem                                <- NAO TOCAR
--   supabase_admin  graphql          os tres       idem                                <- NAO TOCAR
--   supabase_admin  graphql_public   os tres       idem                                <- NAO TOCAR
--
-- Os de `realtime` (supabase_admin) e `auth` (supabase_auth_admin) concedem so a
-- postgres e dashboard_user — nao citam anon.
--
-- Todos sao configuracao PADRAO do Supabase, criada no bootstrap do banco: os
-- oids sao 16486 a 16491 e 16541 a 16543, na faixa dos objetos de sistema.
-- Nenhum foi criado por migration deste projeto — `grep -ri "alter default
-- privileges" supabase/migrations/` nao devolve nada.
--
-- NENHUM DEFAULT PRIVILEGE CONCEDE A PUBLIC
-- -----------------------------------------
-- Conferido: nenhum aclitem de `pg_default_acl` tem grantee vazio.
--
--   select ... from pg_default_acl d cross join lateral unnest(d.defaclacl) a
--    where a::text like '=%';   -- ZERO linhas
--
-- Entao de onde vem o `-` (PUBLIC) que aparecia nas 70 funcoes? Do PROPRIO
-- PostgreSQL: `CREATE FUNCTION` concede EXECUTE a PUBLIC por padrao, por regra
-- da linguagem, sem passar por default ACL nenhum. Para tabelas nao ha esse
-- comportamento — o padrao do Postgres e nao conceder nada a PUBLIC.
--
-- E por isso que a linha `REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` abaixo e
-- necessaria e nao redundante: sem ela, funcao nova continua nascendo executavel
-- por qualquer papel, mesmo com o `anon` removido do default ACL.
--
-- O QUE QUEBRA, E O QUE NAO QUEBRA
-- --------------------------------
-- NAO quebra nada hoje. Objeto existente nao e tocado.
--
-- A partir daqui, quem criar objeto novo no schema `public` como `postgres`:
--   * tabela/view nova  -> sem grant para anon. `authenticated` e `service_role`
--                          continuam recebendo, entao o app segue funcionando;
--   * funcao nova       -> sem EXECUTE para anon NEM para PUBLIC;
--   * sequence nova     -> sem grant para anon.
--
-- Objetos criados como `supabase_admin` seguem recebendo grant para anon: aquele
-- conjunto de defaults nao e alcancavel por `postgres` (nao somos membros de
-- supabase_admin — conferido com pg_has_role). Na pratica isso nao cobre as
-- migrations deste projeto, que rodam como `postgres`.
--
-- MIGRATIONS DO PROJETO QUE HOJE DEPENDEM DO GRANT AUTOMATICO
-- -----------------------------------------------------------
-- Nao dependem para continuar funcionando — o grant ja foi dado na criacao e
-- permanece. Dependeram para nascer com acesso, e a lista importa porque mostra
-- o habito que precisa mudar:
--
--   4 migrations criam TABELA sem GRANT explicito:
--     20260722_maestro_auditoria.sql       (maestro_acoes)
--     20260722_maestro_conversas.sql       (maestro_mensagens)
--     20260813_propostas_os_setores.sql    (propostas_os_setores)
--     20260815_expedicoes.sql              (expedicoes)
--
--   10 migrations criam FUNCAO sem GRANT EXECUTE explicito:
--     20260723_os_qr_digest_fix.sql, 20260724_os_qr_motivo_opcional.sql,
--     20260730_rpc_cobranca_reprovar_condicao.sql, 20260804_recalc_valor_total_propostas.sql,
--     20260810_produto_prateleira_is_estoque.sql, 20260818_em_arte_dispensada_produto_prateleira.sql,
--     20260820_arte_guardas_promocao_e_lista_aprovados.sql, 20260820_rpc_dashboard_executivo_ignora_teste.sql,
--     20260828_fn_defaults_rascunho_nfe_natureza_so_se_vazia.sql,
--     20260829_fn_autopreencher_fiscal_nfe_item_tributacao_do_catalogo.sql
--
-- A unica que ja faz o certo e 20260722_os_qr_producao.sql, que concede papel a
-- papel e ainda revoga o que nao quer.
--
-- Confirmado que as 6 tabelas criadas por essas migrations tem hoje
-- `anon SELECT = true` — foi o default que deu, nao a migration.
--
-- SUPABASE CONTINUA FUNCIONANDO
-- -----------------------------
-- * Storage, GraphQL e graphql_public tem defaults PROPRIOS, em schemas
--   proprios, e nao sao tocados;
-- * Realtime nao depende de grant do schema public — a publicacao e por
--   replicacao, e o default de `realtime` nem cita anon;
-- * Auth vive no schema `auth`, com defaults de `supabase_auth_admin`;
-- * PostgREST expoe o que tem GRANT. Tabela nova deixa de aparecer para o
--   anonimo e continua aparecendo para o usuario logado. E o efeito desejado;
-- * Extensoes ficam em `extensions`, com defaults proprios.
--
-- REMOVER SO PARA `anon`, MANTENDO `authenticated`? SIM
-- -----------------------------------------------------
-- `ALTER DEFAULT PRIVILEGES` opera por papel nomeado. Remover o `anon` nao
-- encosta no `authenticated` nem no `service_role`. E exatamente o que esta
-- migration faz: o app logado continua recebendo acesso automatico a objeto
-- novo, e so o anonimo para de receber.
-- =====================================================================

-- ------------------------------------------------------------------
-- 1. ASSERCOES DE ENTRADA
-- ------------------------------------------------------------------
do $entrada$
declare
  v_n integer;
begin
  if not pg_has_role(current_user, 'postgres', 'MEMBER') then
    raise exception 'ABORTADO: esta migration precisa rodar como membro de postgres (atual: %).', current_user;
  end if;

  -- os 3 conjuntos de postgres/public que serao alterados existem e citam anon
  select count(*) into v_n
    from pg_default_acl d
    left join pg_namespace n on n.oid = d.defaclnamespace
   where pg_get_userbyid(d.defaclrole) = 'postgres'
     and n.nspname = 'public'
     and d.defaclobjtype in ('r','S','f')
     and d.defaclacl::text like '%anon=%';
  if v_n <> 3 then
    raise exception 'ABORTADO: esperava 3 conjuntos de default privileges de postgres em public citando anon (tabela, sequence, funcao), encontrei %.', v_n;
  end if;

  raise notice 'Entrada OK: rodando como membro de postgres; 3 conjuntos de default privileges a ajustar.';
end
$entrada$;

-- ------------------------------------------------------------------
-- 2. O AJUSTE
--    `authenticated` e `service_role` NAO sao citados: ficam como estao.
-- ------------------------------------------------------------------
alter default privileges for role postgres in schema public
  revoke all on tables from anon;

alter default privileges for role postgres in schema public
  revoke all on sequences from anon;

alter default privileges for role postgres in schema public
  revoke all on functions from anon;

-- O PostgreSQL concede EXECUTE a PUBLIC em toda funcao nova, por regra da
-- linguagem e nao por default ACL. Sem esta linha, funcao nova continua
-- executavel por qualquer papel mesmo sem o anon no default.
alter default privileges for role postgres in schema public
  revoke execute on functions from public;

-- ------------------------------------------------------------------
-- 3. ASSERCOES DE SAIDA
-- ------------------------------------------------------------------
do $saida$
declare
  v_com_anon integer;
  v_com_auth integer;
begin
  select count(*) into v_com_anon
    from pg_default_acl d
    left join pg_namespace n on n.oid = d.defaclnamespace
   where pg_get_userbyid(d.defaclrole) = 'postgres'
     and n.nspname = 'public'
     and d.defaclobjtype in ('r','S','f')
     and d.defaclacl::text like '%anon=%';
  if v_com_anon <> 0 then
    raise exception 'ABORTADO: % conjunto(s) de default privileges de postgres em public ainda citam anon.', v_com_anon;
  end if;

  select count(*) into v_com_auth
    from pg_default_acl d
    left join pg_namespace n on n.oid = d.defaclnamespace
   where pg_get_userbyid(d.defaclrole) = 'postgres'
     and n.nspname = 'public'
     and d.defaclobjtype in ('r','S','f')
     and d.defaclacl::text like '%authenticated=%'
     and d.defaclacl::text like '%service_role=%';
  if v_com_auth <> 3 then
    raise exception 'ABORTADO: esperava 3 conjuntos ainda concedendo a authenticated e service_role, encontrei %. O app perderia acesso a objeto novo.', v_com_auth;
  end if;

  raise notice 'Saida OK: anon fora dos 3 conjuntos; authenticated e service_role preservados nos 3.';
end
$saida$;


-- =====================================================================
-- VERIFICACOES APOS APLICAR (rodar como SELECT)
-- =====================================================================
--
-- (a) os default privileges de postgres em public:
--     select coalesce(n.nspname,'(todos)') as schema,
--            case d.defaclobjtype when 'r' then 'tabela/view' when 'S' then 'sequence'
--                                 when 'f' then 'funcao' end as tipo,
--            d.defaclacl::text
--       from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace
--      where pg_get_userbyid(d.defaclrole)='postgres' and n.nspname='public';
--     -- esperado: sem `anon=`; com `authenticated=` e `service_role=`
--
-- (b) prova pratica, em transacao ABORTADA (nao deixa objeto para tras):
--     do $teste$
--     begin
--       create table public.zz_teste_default_priv (id int);
--       create function public.zz_teste_default_priv_fn() returns int
--         language sql as $q$ select 1 $q$;
--       raise exception 'TESTE: tabela anon=% | funcao anon=% | funcao public=% | tabela auth=%',
--         has_table_privilege('anon','public.zz_teste_default_priv','SELECT'),
--         has_function_privilege('anon','public.zz_teste_default_priv_fn()','EXECUTE'),
--         (select count(*) from pg_proc p cross join lateral aclexplode(p.proacl) a
--           where p.proname='zz_teste_default_priv_fn' and a.grantee=0),
--         has_table_privilege('authenticated','public.zz_teste_default_priv','SELECT');
--     end
--     $teste$;
--     -- esperado depois desta migration: false | false | 0 | true
--     -- (antes dela seria:               true  | true  | 1 | true)
--
--
-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- Devolve o comportamento de antes: objeto novo volta a nascer com grant para
-- anon, e funcao nova volta a nascer executavel por PUBLIC.
--
-- begin;
--   alter default privileges for role postgres in schema public
--     grant all on tables to anon;
--   alter default privileges for role postgres in schema public
--     grant all on sequences to anon;
--   alter default privileges for role postgres in schema public
--     grant all on functions to anon;
--   alter default privileges for role postgres in schema public
--     grant execute on functions to public;
-- commit;
--
--
-- =====================================================================
-- O QUE PASSA A SER RESPONSABILIDADE DE QUEM CRIA OBJETO NOVO
-- =====================================================================
-- A partir daqui o acesso deixa de ser automatico e passa a ser DECLARADO. Quem
-- escrever migration que cria tabela, view, sequence ou funcao em `public`
-- precisa conceder explicitamente o que aquele objeto realmente precisa:
--
--   -- tabela que a tela usa:
--   grant select, insert, update on table public.nova_tabela to authenticated;
--   grant all on table public.nova_tabela to service_role;
--   alter table public.nova_tabela enable row level security;
--   create policy "..." on public.nova_tabela for all to authenticated using (true);
--
--   -- funcao chamada pela tela:
--   revoke all on function public.nova_funcao(...) from public, anon;
--   grant execute on function public.nova_funcao(...) to authenticated, service_role;
--
--   -- funcao de fluxo publico (raro, e a excecao — hoje so o QR de producao):
--   grant execute on function public.nova_funcao_publica(...) to anon;
--   -- e nesse caso a autorizacao inteira tem de viver DENTRO da funcao:
--   -- token, rate limit e validacao, como em os_qr_consultar.
--
-- Trigger function NAO precisa de grant: o PostgreSQL nao verifica EXECUTE de
-- quem dispara trigger. Conceder a `anon` so abre a chamada direta por RPC.
--
-- O modelo a copiar e 20260722_os_qr_producao.sql: concede papel a papel, revoga
-- o que nao quer, e deixa `os_qr_finalizar` so para service_role.
-- =====================================================================
