-- Checklist do boletim por produto: public.produto_boletim_campos
--
-- O QUE E
--   Uma tabela filha nova, no molde de `public.produto_variacoes`:
--
--     public.produto_boletim_campos
--       id          bigint    generated always as identity, PK
--       id_produto  smallint  NOT NULL, FK -> produtos(id_produto) ON DELETE CASCADE
--       campo       text      NOT NULL, CHECK no dominio fechado de 7 valores
--
--   Mais UNIQUE (id_produto, campo), indice por id_produto, RLS ligada com
--   quatro politicas para `authenticated`, e um trigger AFTER INSERT em
--   `produtos` que semeia o checklist de todo produto novo.
--
--   A PRESENCA DA LINHA E O "MARCADO". Nao ha coluna de valor nem de ordem: a
--   ordem dos campos e do layout do card, nao do cadastro.
--
--   Dominio (os SETE campos opcionais do card do boletim):
--     variacoes        uma linha por variacao, "GRUPO: opcao"
--     cor              pedidos_modelos.padrao
--     num_gabarito     pedidos_modelos.gabarito_operacional (rotulo "NUM")
--     numeracao_faixa  pedidos_modelos.numeracao_inicio / numeracao_fim
--     impressao_fv     pedidos_modelos.frente_verso
--     tipo_numeracao   pedidos_modelos.tipo_numeracao
--     imagem           arte do lote (arte_url / amostra / previa da cor)
--
--   Nome do produto, quantidade e nome do modelo NAO entram: sao obrigatorios e
--   saem sempre, fora do checklist.
--
-- POR QUE
--   Hoje o card do boletim imprime o mesmo conjunto para todo produto que nao e
--   de prateleira. A unica condicao que existe e `isEstoque`
--   (src/features/pedidos/pdf/OsPdfDocument.tsx:596), e por isso um cordao sai
--   com faixa numerica 1-14 e com o nome do gabarito no campo "NUM" — campos
--   que nao dizem nada para quem produz cordao. A decisao de quais campos
--   valem e do produto, e e ela que esta tabela guarda.
--
-- O QUE ESTA MIGRATION NAO FAZ
--   Nao cria o snapshot no item da proposta — e a Etapa 3, em migration
--   propria, com a coluna `produtos_proposta.boletim_campos_congelado_em`.
--   Nao altera o boletim, o formulario do PCP nem uma linha de aplicacao:
--   enquanto ninguem le esta tabela, o sistema imprime exatamente como hoje.
--   Nao faz UPDATE em `produtos` — de proposito, para nao recarimbar
--   `updated_at` de 95 produtos e sujar a auditoria de cadastro.
--
-- SOBRE AS POLITICAS — POR QUE NAO COPIEI O MOLDE AO PE DA LETRA
--   `produto_variacoes` tem UMA politica, `geral`, FOR ALL TO PUBLIC, com
--   `using (true)` e `with check (true)`. Copiar isso seria abrir a tabela nova
--   para qualquer papel que venha a ganhar grant, inclusive `anon`. Aqui ficam
--   quatro politicas restritas a `authenticated`, no formato que a irma
--   `tipos_variacoes` ja usa (`auth.uid() is not null`). E o mesmo alcance
--   pratico para o app e nunca mais permissivo que o molde.
--
-- SOBRE OS GRANTS
--   `produto_variacoes` concede ALL a anon, authenticated e service_role — o
--   `anon` ali e heranca dos default privileges antigos, revogados em
--   01/09/2026 (20260901161119_default_privileges_public_sem_anon). A tabela
--   nova recebe ALL para authenticated e service_role, igual ao molde, e o
--   REVOKE de `anon` e de PUBLIC e explicito, para nao depender do default.
--   Como sempre neste schema: GRANT nao tranca nada, quem tranca e a RLS.
--
-- SOBRE O PRODUTO NOVO (decisao 5 do dono)
--   A regra fica NO BANCO, nesta migration: trigger AFTER INSERT em `produtos`
--   semeia o conjunto curto quando `is_estoque` e verdadeiro e o completo nos
--   demais. E AFTER INSERT so, de proposito: produto que vira prateleira depois
--   mantem o checklist como estava (decisao 6).
--
--   A funcao e SECURITY INVOKER: quem insere produto e `authenticated`, e a
--   politica de INSERT da tabela nova ja cobre esse papel. Nao ha motivo para
--   rodar como dono. O EXECUTE e revogado de PUBLIC, anon e authenticated —
--   funcao de trigger nao exige EXECUTE de quem dispara o INSERT, entao o
--   revoke nao quebra o seed e fecha a funcao para chamada direta.
--
--   LIMITE CONHECIDO, E ELE NAO TEM SOLUCAO NESTA MIGRATION: o campo
--   `variacoes` NAO entra no seed do produto novo. O vinculo em
--   `produto_variacoes` e gravado DEPOIS do insert do produto, em outra
--   requisicao (produto-variacoes.service.ts:702), entao no instante do trigger
--   o produto ainda nao tem variacao nenhuma. Marcar `variacoes` para produto
--   novo depende de uma decisao do dono — trigger em `produto_variacoes` ou a
--   propria tela do cadastro — e esta registrada como decisao aberta no plano
--   docs/superpowers/plans/2026-09-22-boletim-checklist-por-produto.md.
--
--   Produto DUPLICADO cai na mesma regra: nasce com o seed padrao, nao com uma
--   copia do checklist da origem.
--
-- CARGA INICIAL (decisao 1 do dono)
--   Todos os 95 produtos existentes, ativos ou nao — a assercao 1 exige que
--   nenhum fique sem checklist:
--     is_estoque = true  -> {cor, imagem}                       (19 produtos)
--     demais             -> os seis campos, menos variacoes     (76 produtos)
--     com vinculo em produto_variacoes -> mais {variacoes}      (27 produtos)
--   Medido em 22/09/2026: nenhum produto de prateleira tem variacao cadastrada.
--   Idempotente: `on conflict do nothing`.

-- ============================================================================
-- 1. TABELA
-- ============================================================================

create table if not exists public.produto_boletim_campos (
  id         bigint generated always as identity primary key,
  id_produto smallint not null references public.produtos (id_produto) on delete cascade,
  campo      text not null,
  constraint produto_boletim_campos_campo_valido check (
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
  constraint produto_boletim_campos_unico unique (id_produto, campo)
);

create index if not exists produto_boletim_campos_id_produto_idx
  on public.produto_boletim_campos (id_produto);

comment on table public.produto_boletim_campos is
  'Checklist do boletim por produto: quais campos OPCIONAIS o card do PDF imprime. A presenca da linha e o "marcado". Nome do produto, quantidade e nome do modelo sao obrigatorios e nao entram aqui. Congelado no item da venda por produtos_proposta_boletim_campos (Etapa 3).';

comment on column public.produto_boletim_campos.campo is
  'Um dos sete: variacoes, cor, num_gabarito (rotulo NUM, le gabarito_operacional), numeracao_faixa, impressao_fv, tipo_numeracao, imagem.';

-- ============================================================================
-- 2. RLS — quatro politicas, so para authenticated
--    Molde: tipos_variacoes. NAO copia o `geral` FOR ALL TO PUBLIC de
--    produto_variacoes, que seria mais permissivo. Ver cabecalho.
-- ============================================================================

alter table public.produto_boletim_campos enable row level security;

create policy produto_boletim_campos_select
  on public.produto_boletim_campos
  for select
  to authenticated
  using (auth.uid() is not null);

create policy produto_boletim_campos_insert
  on public.produto_boletim_campos
  for insert
  to authenticated
  with check (auth.uid() is not null);

create policy produto_boletim_campos_update
  on public.produto_boletim_campos
  for update
  to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

create policy produto_boletim_campos_delete
  on public.produto_boletim_campos
  for delete
  to authenticated
  using (auth.uid() is not null);

-- ============================================================================
-- 3. GRANTS — iguais ao molde para authenticated/service_role; anon e PUBLIC
--    revogados explicitamente.
-- ============================================================================

revoke all on public.produto_boletim_campos from public;
revoke all on public.produto_boletim_campos from anon;

grant all on public.produto_boletim_campos to authenticated;
grant all on public.produto_boletim_campos to service_role;

-- ============================================================================
-- 4. CARGA INICIAL — so INSERT na tabela nova. Nenhum UPDATE em produtos.
-- ============================================================================

-- 4a. Prateleira: conjunto curto.
insert into public.produto_boletim_campos (id_produto, campo)
select p.id_produto, c.campo
  from public.produtos p
 cross join (values ('cor'), ('imagem')) as c(campo)
 where p.is_estoque is true
on conflict (id_produto, campo) do nothing;

-- 4b. Demais: conjunto completo, sem variacoes.
insert into public.produto_boletim_campos (id_produto, campo)
select p.id_produto, c.campo
  from public.produtos p
 cross join (values
   ('cor'), ('num_gabarito'), ('numeracao_faixa'),
   ('impressao_fv'), ('tipo_numeracao'), ('imagem')
 ) as c(campo)
 where p.is_estoque is distinct from true
on conflict (id_produto, campo) do nothing;

-- 4c. Variacoes: todo produto que ja tem vinculo em produto_variacoes,
--     seja ele de prateleira ou nao (decisao 1).
insert into public.produto_boletim_campos (id_produto, campo)
select distinct pv.id_produto, 'variacoes'
  from public.produto_variacoes pv
  join public.produtos p on p.id_produto = pv.id_produto
on conflict (id_produto, campo) do nothing;

-- ============================================================================
-- 5. PRODUTO NOVO — seed automatico (decisao 5)
--    AFTER INSERT apenas: produto que vira prateleira depois mantem o
--    checklist como estava (decisao 6). `variacoes` fica de fora: ver o limite
--    conhecido no cabecalho.
-- ============================================================================

create or replace function public.tg_produto_boletim_campos_padrao()
returns trigger
language plpgsql
security invoker
set search_path to 'public'
as $function$
begin
  insert into public.produto_boletim_campos (id_produto, campo)
  select new.id_produto, c.campo
    from (values ('cor'), ('imagem')) as c(campo)
   where new.is_estoque is true
  union all
  select new.id_produto, c.campo
    from (values
      ('cor'), ('num_gabarito'), ('numeracao_faixa'),
      ('impressao_fv'), ('tipo_numeracao'), ('imagem')
    ) as c(campo)
   where new.is_estoque is distinct from true
  on conflict (id_produto, campo) do nothing;

  return new;
end;
$function$;

comment on function public.tg_produto_boletim_campos_padrao() is
  'Semeia o checklist do boletim de um produto recem-criado: curto se is_estoque, completo nos demais. Nao marca variacoes — o vinculo em produto_variacoes so existe depois do insert do produto.';

-- Ninguem precisa de EXECUTE nesta funcao: o Postgres NAO cobre privilegio de
-- execucao de funcao de trigger de quem dispara o INSERT — a checagem acontece
-- no CREATE TRIGGER. Como ela e SECURITY INVOKER, tirar EXECUTE de todos evita
-- que vire porta de escrita chamavel via PostgREST.
revoke all on function public.tg_produto_boletim_campos_padrao() from public;
revoke all on function public.tg_produto_boletim_campos_padrao() from anon;
revoke all on function public.tg_produto_boletim_campos_padrao() from authenticated;

drop trigger if exists trg_produto_boletim_campos_padrao on public.produtos;

create trigger trg_produto_boletim_campos_padrao
  after insert on public.produtos
  for each row
  execute function public.tg_produto_boletim_campos_padrao();

-- ============================================================================
-- 6. ASSERCOES — se qualquer uma falhar, a migration inteira volta atras
-- ============================================================================

do $$
declare
  v_sem_checklist  int;
  v_prateleira_fora int;
  v_grantees       text[];
  v_grantees_funcao text[];
  v_rls            boolean;
  v_total          int;
begin
  -- 6.1 (exigida) Todo produto existente tem checklist.
  select count(*)
    into v_sem_checklist
    from public.produtos p
   where not exists (
     select 1 from public.produto_boletim_campos b where b.id_produto = p.id_produto
   );

  if v_sem_checklist > 0 then
    raise exception 'ASSERCAO 1 FALHOU: % produto(s) ficaram sem checklist', v_sem_checklist;
  end if;

  -- 6.2 (exigida) O conjunto dos produtos de prateleira e o curto — mais
  --     `variacoes` quando o produto tem vinculo, pela decisao 1.
  select count(*)
    into v_prateleira_fora
    from public.produtos p
   where p.is_estoque is true
     and (
       select array_agg(b.campo order by b.campo)
         from public.produto_boletim_campos b
        where b.id_produto = p.id_produto
     ) is distinct from (
       select array_agg(x order by x)
         from unnest(
           case
             when exists (select 1 from public.produto_variacoes pv where pv.id_produto = p.id_produto)
               then array['cor', 'imagem', 'variacoes']
             else array['cor', 'imagem']
           end
         ) as x
     );

  if v_prateleira_fora > 0 then
    raise exception 'ASSERCAO 2 FALHOU: % produto(s) de prateleira com conjunto diferente do curto', v_prateleira_fora;
  end if;

  -- 6.3 (extra) ACL: anon sem grant, authenticated e service_role com grant.
  select array_agg(distinct pg_get_userbyid(a.grantee) order by pg_get_userbyid(a.grantee))
    into v_grantees
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace,
         aclexplode(c.relacl) a
   where n.nspname = 'public' and c.relname = 'produto_boletim_campos';

  if 'anon' = any(v_grantees) then
    raise exception 'ASSERCAO 3 FALHOU: anon com grant em produto_boletim_campos (%)', v_grantees;
  end if;

  if not (v_grantees @> array['authenticated', 'service_role']) then
    raise exception 'ASSERCAO 3 FALHOU: faltou grant para authenticated/service_role (%)', v_grantees;
  end if;

  -- 6.4 (extra) ACL da funcao: sem anon, sem authenticated, sem PUBLIC.
  select array_agg(distinct case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end
                   order by case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end)
    into v_grantees_funcao
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace,
         aclexplode(p.proacl) a
   where n.nspname = 'public' and p.proname = 'tg_produto_boletim_campos_padrao';

  if v_grantees_funcao && array['anon', 'authenticated', 'PUBLIC'] then
    raise exception 'ASSERCAO 4 FALHOU: funcao com EXECUTE indevido (%)', v_grantees_funcao;
  end if;

  -- 6.5 (extra) RLS ligada.
  select c.relrowsecurity
    into v_rls
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'produto_boletim_campos';

  if v_rls is not true then
    raise exception 'ASSERCAO 5 FALHOU: RLS desligada em produto_boletim_campos';
  end if;

  select count(*) into v_total from public.produto_boletim_campos;
  raise notice 'OK: % linha(s) de checklist para % produto(s); grants tabela = %; grants funcao = %',
    v_total, (select count(*) from public.produtos), v_grantees, coalesce(v_grantees_funcao, '{}');
end
$$;

-- ============================================================================
-- ROLLBACK (nao executar junto; copiar e rodar se precisar desfazer)
--
--   Recusa se alguem ja tiver ajustado o checklist a mao: nesse caso a tabela
--   guarda decisao humana, e derrubar apagaria trabalho. Exporte antes.
--
--   do $rollback$
--   declare
--     v_editadas int;
--   begin
--     select count(*)
--       into v_editadas
--       from public.produtos p
--      where (
--        select array_agg(b.campo order by b.campo)
--          from public.produto_boletim_campos b
--         where b.id_produto = p.id_produto
--      ) is distinct from (
--        select array_agg(x order by x)
--          from unnest(
--            case when p.is_estoque is true
--              then array['cor','imagem']
--              else array['cor','num_gabarito','numeracao_faixa','impressao_fv','tipo_numeracao','imagem']
--            end
--            ||
--            case when exists (select 1 from public.produto_variacoes pv where pv.id_produto = p.id_produto)
--              then array['variacoes'] else array[]::text[]
--            end
--          ) as x
--      );
--
--     if v_editadas > 0 then
--       raise exception 'ROLLBACK ABORTADO: % produto(s) com checklist ajustado a mao. Exporte antes de derrubar.', v_editadas;
--     end if;
--
--     drop trigger if exists trg_produto_boletim_campos_padrao on public.produtos;
--     drop function if exists public.tg_produto_boletim_campos_padrao();
--     drop table public.produto_boletim_campos;
--
--     raise notice 'ROLLBACK OK: tabela, trigger e funcao removidos; nada fora do seed foi perdido';
--   end
--   $rollback$;
-- ============================================================================
