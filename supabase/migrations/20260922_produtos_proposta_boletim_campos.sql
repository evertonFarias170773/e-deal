-- Snapshot do checklist do boletim no item da proposta:
-- public.produtos_proposta_boletim_campos + produtos_proposta.boletim_campos_congelado_em
--
-- O QUE E
--   A Etapa 3 da reforma do boletim (docs/superpowers/plans/2026-09-22-boletim-checklist-por-produto.md).
--   Duas coisas, nada mais:
--
--     public.produtos_proposta_boletim_campos
--       id                   bigint  generated always as identity, PK
--       id_produto_proposta  bigint  NOT NULL, FK -> produtos_proposta(id) ON DELETE CASCADE
--       campo                text    NOT NULL, CHECK no MESMO dominio fechado de
--                                    7 valores de produto_boletim_campos
--     + UNIQUE (id_produto_proposta, campo) e indice por id_produto_proposta
--
--     public.produtos_proposta.boletim_campos_congelado_em  timestamptz NULL, sem default
--
--   Molde: `produtos_proposta_variacao`, a irma que ja pendura dado do item na
--   mesma chave `id_produto_proposta` (bigint -> produtos_proposta.id).
--
--   A PRESENCA DA LINHA E O "MARCADO", igual ao catalogo do produto.
--
-- POR QUE A COLUNA NO ITEM
--   Sem ela, "item anterior a virada" e "item cujo produto nao tem nenhum campo
--   opcional marcado" seriam o mesmo estado: zero linhas filhas. A coluna separa
--   os dois e e o unico teste que a Etapa 5 vai fazer:
--
--     boletim_campos_congelado_em IS NULL  -> SEM snapshot, imprime como hoje
--     boletim_campos_congelado_em PREENCHIDA -> snapshot valido, mesmo com zero
--                                               linhas filhas (nenhum opcional)
--
--   Nao existe linha sentinela `__nenhum__` (decisao 2 do dono).
--
-- POR QUE O SNAPSHOT
--   O boletim passa a imprimir o que o produto mandava NO DIA DA VENDA, nunca o
--   cadastro vivo. Mexer no checklist de um produto hoje nao pode mudar o que
--   sai impresso num pedido fechado ontem. O congelamento e gravado UMA VEZ, na
--   criacao do item, e nunca reescrito — e por isso que esta tabela nao tem
--   politica de UPDATE nem de DELETE.
--
-- O QUE ESTA MIGRATION NAO FAZ
--   NENHUMA CARGA. Os 1.554 itens existentes ficam sem snapshot, de proposito:
--   todos com `boletim_campos_congelado_em` nula, todos imprimindo como hoje.
--   Nao grava o snapshot em item novo — isso e a Etapa 4, em codigo de
--   aplicacao (`saveProposta`). Enquanto a Etapa 4 nao sai, a tabela fica vazia
--   e a coluna fica nula em 100% das linhas.
--   Nao toca em `produto_boletim_campos`, no boletim, no formulario do PCP nem
--   em uma linha de aplicacao.
--   Nao faz UPDATE em `produtos_proposta`: `ADD COLUMN` sem default nao reescreve
--   a tabela no PG 17 e nao carimba `updated_at` de nenhum item.
--
-- SOBRE AS POLITICAS — SO SELECT E INSERT
--   `produtos_proposta` esta hoje com SETE politicas, todas `TO PUBLIC` com
--   `using (true)` / `with check (true)`, cobrindo SELECT, INSERT, UPDATE e
--   DELETE (inclusive duas de nome `debug_*` e `allow_*_all`). Copiar isso
--   seria abrir a tabela nova para qualquer papel com grant, `anon` incluso.
--   Aqui ficam DUAS politicas, restritas a `authenticated` com
--   `auth.uid() is not null` — o mesmo formato da Etapa 1 e estritamente MENOS
--   permissivo que o molde, nunca mais.
--
--   Sem politica de UPDATE: o snapshot e imutavel.
--   Sem politica de DELETE: ele so sai junto com o item, pelo CASCADE — e a
--   acao referencial do CASCADE nao passa pela RLS da tabela filha nem exige
--   privilegio de DELETE de quem apaga o pai, entao apagar o item continua
--   funcionando normalmente.
--
--   Quem grava o item e a sessao do usuario (`getSupabaseClient` em
--   orcamentos.service.ts), isto e, o papel `authenticated`: a politica de
--   INSERT cobre a Etapa 4 sem precisar de service_role.
--
-- SOBRE OS GRANTS — E POR QUE HA UM REVOKE DE `authenticated`
--   `authenticated` fica com SELECT e INSERT apenas — sem UPDATE e sem DELETE,
--   em linha com a imutabilidade. Para isso nao basta conceder os dois: toda
--   tabela nova em `public` NASCE com ALL para `authenticated` pelos default
--   privileges do schema, entao um `grant select, insert` apenas somaria a um
--   ALL que ja esta la. A primeira tentativa desta migration foi abortada pela
--   propria assercao 2 por causa disso ({DELETE,INSERT,...,UPDATE}) — o REVOKE
--   explicito abaixo e o que faz o privilegio virar o que o cabecalho promete.
--   `service_role` recebe ALL (e tem BYPASSRLS de qualquer forma; e o caminho de
--   manutencao). `anon` e PUBLIC sao revogados explicitamente, para nao depender
--   do default privilege alterado em 01/09/2026
--   (20260901161119_default_privileges_public_sem_anon).
--   Como sempre neste schema: GRANT nao tranca nada, quem tranca e a RLS.
--
-- MAPEAMENTO FEITO ANTES DE APLICAR (22/09/2026)
--   Nenhuma funcao com `returns setof produtos_proposta`, nenhum `%ROWTYPE`
--   dessa tabela e nenhum `select *` dela em funcao: das 21 funcoes que a citam,
--   as duas que inserem (`copiar_proposta_v2`, `duplicar_proposta`) usam lista
--   fixa de colunas, entao a coluna nova simplesmente nasce nula ali — item
--   copiado fica sem snapshot e imprime como hoje, que e o fallback correto.
--   As tres views que a leem (`vw_produtos_proposta_com_descricao`,
--   `vw_proposta_completa`, `vw_notas_fiscais_validacao_itens`) guardam a lista
--   de colunas expandida na criacao: coluna nova nao aparece nelas e nao as
--   quebra. Os tres triggers da tabela (`trg_calcular_valor_sub_total`,
--   `trg_produto_sync_financeiro`, `trg_recalc_proposta_v4`) sao FOR EACH ROW em
--   INSERT/UPDATE/DELETE — nenhum reage a DDL. Os unicos event triggers do banco
--   sao os padrao do Supabase (pgrst_ddl_watch, grant_pg_*), que so recarregam o
--   cache do PostgREST.
--
-- ============================================================================

-- ============================================================================
-- 1. TABELA
-- ============================================================================

create table if not exists public.produtos_proposta_boletim_campos (
  id                  bigint generated always as identity primary key,
  id_produto_proposta bigint not null references public.produtos_proposta (id) on delete cascade,
  campo               text not null,
  constraint produtos_proposta_boletim_campos_campo_valido check (
    campo in (
      'variacoes',
      'cor',
      'num_gabarito',
      'numeracao_faixa',
      'impressao_fv',
      'tipo_numeracao',
      'imagem'
    )
  ),
  constraint produtos_proposta_boletim_campos_unico unique (id_produto_proposta, campo)
);

create index if not exists produtos_proposta_boletim_campos_item_idx
  on public.produtos_proposta_boletim_campos (id_produto_proposta);

comment on table public.produtos_proposta_boletim_campos is
  'Snapshot do checklist do boletim no momento da venda: quais campos OPCIONAIS o card do item imprime. Copia de produto_boletim_campos gravada UMA VEZ na criacao do item e nunca reescrita. Zero linhas com produtos_proposta.boletim_campos_congelado_em preenchida = nenhum opcional; com a coluna nula = item anterior a virada, imprime como hoje.';

comment on column public.produtos_proposta_boletim_campos.campo is
  'Um dos sete: variacoes, cor, num_gabarito (rotulo NUM), numeracao_faixa, impressao_fv, tipo_numeracao, imagem. Mesmo dominio de produto_boletim_campos.';

-- ============================================================================
-- 2. COLUNA NO ITEM — o marcador de "tem snapshot"
--    Nula e sem default: item existente continua sem snapshot.
-- ============================================================================

alter table public.produtos_proposta
  add column if not exists boletim_campos_congelado_em timestamptz;

comment on column public.produtos_proposta.boletim_campos_congelado_em is
  'Quando o checklist do boletim foi congelado neste item. NULA = item sem snapshot, o boletim imprime como sempre imprimiu. PREENCHIDA = produtos_proposta_boletim_campos manda, mesmo que nao haja nenhuma linha la. Gravada uma vez na criacao do item e nunca reescrita.';

-- ============================================================================
-- 3. RLS — duas politicas, so SELECT e INSERT, so para authenticated
--    Sem UPDATE e sem DELETE: o snapshot e imutavel e so sai pelo CASCADE.
-- ============================================================================

alter table public.produtos_proposta_boletim_campos enable row level security;

create policy produtos_proposta_boletim_campos_select
  on public.produtos_proposta_boletim_campos
  for select
  to authenticated
  using (auth.uid() is not null);

create policy produtos_proposta_boletim_campos_insert
  on public.produtos_proposta_boletim_campos
  for insert
  to authenticated
  with check (auth.uid() is not null);

-- ============================================================================
-- 4. GRANTS — authenticated so le e insere; anon e PUBLIC fora.
--    O revoke de authenticated vem ANTES do grant de proposito: a tabela nasce
--    com ALL para esse papel pelo default privilege do schema public. Ver
--    cabecalho.
-- ============================================================================

revoke all on public.produtos_proposta_boletim_campos from public;
revoke all on public.produtos_proposta_boletim_campos from anon;
revoke all on public.produtos_proposta_boletim_campos from authenticated;

grant select, insert on public.produtos_proposta_boletim_campos to authenticated;
grant all on public.produtos_proposta_boletim_campos to service_role;

-- ============================================================================
-- 5. ASSERCOES — a migration prova o que prometeu, ou aborta a transacao
-- ============================================================================

do $$
declare
  v_linhas          bigint;
  v_congelados      bigint;
  v_grantees        text[];
  v_authenticated   text[];
  v_rls             boolean;
  v_cmds            text[];
  v_dominio_novo    text[];
  v_dominio_produto text[];
  v_fk              text;
begin
  -- 5.1 A tabela nova esta vazia e nenhum item ganhou snapshot.
  select count(*) into v_linhas from public.produtos_proposta_boletim_campos;
  if v_linhas <> 0 then
    raise exception 'ASSERCAO 1 FALHOU: a tabela nova deveria nascer vazia, tem % linha(s)', v_linhas;
  end if;

  select count(*) into v_congelados
    from public.produtos_proposta
   where boletim_campos_congelado_em is not null;
  if v_congelados <> 0 then
    raise exception 'ASSERCAO 1 FALHOU: % item(ns) com boletim_campos_congelado_em preenchida; esta migration nao carrega nada', v_congelados;
  end if;

  -- 5.2 ACL: sem anon, sem PUBLIC; authenticated so com SELECT e INSERT.
  select array_agg(distinct case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end
                   order by case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end)
    into v_grantees
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace,
         aclexplode(c.relacl) a
   where n.nspname = 'public' and c.relname = 'produtos_proposta_boletim_campos';

  if v_grantees && array['anon', 'PUBLIC'] then
    raise exception 'ASSERCAO 2 FALHOU: anon ou PUBLIC com grant na tabela nova (%)', v_grantees;
  end if;

  if not (v_grantees @> array['authenticated', 'service_role']) then
    raise exception 'ASSERCAO 2 FALHOU: faltou grant para authenticated/service_role (%)', v_grantees;
  end if;

  select array_agg(distinct a.privilege_type order by a.privilege_type)
    into v_authenticated
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace,
         aclexplode(c.relacl) a
   where n.nspname = 'public' and c.relname = 'produtos_proposta_boletim_campos'
     and pg_get_userbyid(a.grantee) = 'authenticated';

  if v_authenticated && array['UPDATE', 'DELETE', 'TRUNCATE'] then
    raise exception 'ASSERCAO 2 FALHOU: authenticated nao pode ter UPDATE/DELETE aqui (%)', v_authenticated;
  end if;

  -- 5.3 RLS ligada e NENHUMA politica de UPDATE ou DELETE.
  select c.relrowsecurity into v_rls
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'produtos_proposta_boletim_campos';

  if v_rls is not true then
    raise exception 'ASSERCAO 3 FALHOU: RLS desligada em produtos_proposta_boletim_campos';
  end if;

  select array_agg(distinct p.polcmd::text order by p.polcmd::text)
    into v_cmds
    from pg_policy p
   where p.polrelid = 'public.produtos_proposta_boletim_campos'::regclass;

  -- r = SELECT, a = INSERT, w = UPDATE, d = DELETE, * = ALL
  if v_cmds is distinct from array['a', 'r'] then
    raise exception 'ASSERCAO 3 FALHOU: politicas fora do previsto (esperado SELECT+INSERT, veio %)', v_cmds;
  end if;

  if exists (
    select 1 from pg_policy p
     where p.polrelid = 'public.produtos_proposta_boletim_campos'::regclass
       and (p.polroles is null or 0 = any(p.polroles))
  ) then
    raise exception 'ASSERCAO 3 FALHOU: politica TO PUBLIC na tabela nova';
  end if;

  -- 5.4 O dominio e EXATAMENTE o mesmo do catalogo do produto — comparado,
  --     nao confiado na digitacao.
  select array_agg(m[1] order by m[1]) into v_dominio_novo
    from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''::text', 'g') m
   where c.conname = 'produtos_proposta_boletim_campos_campo_valido';

  select array_agg(m[1] order by m[1]) into v_dominio_produto
    from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''::text', 'g') m
   where c.conname = 'produto_boletim_campos_campo_valido';

  if v_dominio_novo is distinct from v_dominio_produto then
    raise exception 'ASSERCAO 4 FALHOU: dominio diferente do catalogo (novo=%, produto=%)',
      v_dominio_novo, v_dominio_produto;
  end if;

  -- 5.5 A FK aponta para o ITEM e cascateia.
  select pg_get_constraintdef(c.oid) into v_fk
    from pg_constraint c
   where c.conrelid = 'public.produtos_proposta_boletim_campos'::regclass
     and c.contype = 'f';

  if v_fk is null or v_fk not like '%produtos_proposta(id)%' or v_fk not like '%ON DELETE CASCADE%' then
    raise exception 'ASSERCAO 5 FALHOU: FK do item ausente ou sem CASCADE (%)', v_fk;
  end if;

  raise notice 'OK: tabela vazia (% linhas), % item(ns) congelado(s), grants = %, authenticated = %, politicas = %, dominio = %',
    v_linhas, v_congelados, v_grantees, v_authenticated, v_cmds, v_dominio_novo;
end $$;

-- ============================================================================
-- ROLLBACK (nao executar junto; copiar e rodar se precisar desfazer)
--
--   Recusa se algum item ja tiver snapshot: nesse caso a tabela guarda o que o
--   pedido vendeu, e derrubar apagaria a prova do que foi impresso. Exporte
--   antes.
--
--   do $rollback$
--   declare
--     v_linhas     bigint;
--     v_congelados bigint;
--   begin
--     select count(*) into v_linhas from public.produtos_proposta_boletim_campos;
--
--     select count(*) into v_congelados
--       from public.produtos_proposta
--      where boletim_campos_congelado_em is not null;
--
--     if v_linhas > 0 or v_congelados > 0 then
--       raise exception 'ROLLBACK ABORTADO: % linha(s) de snapshot em % item(ns). Exporte antes de derrubar.',
--         v_linhas, v_congelados;
--     end if;
--
--     drop table public.produtos_proposta_boletim_campos;
--     alter table public.produtos_proposta drop column boletim_campos_congelado_em;
--
--     raise notice 'ROLLBACK OK: tabela e coluna removidas; nenhum snapshot existia';
--   end
--   $rollback$;
-- ============================================================================
