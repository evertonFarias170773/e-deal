-- =====================================================================================
-- ANALISE DE CREDITO: qtd_pagamentos_atrasados PASSA A CONTAR TITULOS VENCIDOS EM ABERTO
--
-- APLICADA em 14/10/2026 pelo Everton no SQL Editor (producao), com autorizacao nominal.
--   md5 do corpo novo: 5c365dc781cafbce2bc782a9f13fb20b (gravado com CRLF; com LF seria
--   68a588b8197e03d91fa14233aa3083c7). Conferido por leitura as 18:41 UTC: ACL sem anon,
--   17610 devolve 1, cliente 14 igual ao de antes, nenhum boleto de teste restou.
--   Depois de aplicada: 5 clientes com qtd_pagamentos_atrasados > 0 (7 titulos).
--
-- O QUE E
--   CREATE OR REPLACE de public.fn_analise_credito_cliente(p_id_cliente bigint). Muda SO o
--   campo qtd_pagamentos_atrasados. Tipo de retorno, assinatura, SECURITY DEFINER,
--   search_path, dono e ACL ficam como estao (CREATE OR REPLACE conserva o ACL).
--
-- POR QUE
--   Hoje o campo conta so cobranca PAGA com atraso em pagamentos_v2 (status PAID e
--   paid_at::date > vencimento). Titulo vencido e em aberto em boletos nunca entra.
--   Caso real: cliente 17610, boleto do pedido 921826, R$ 300,00, 52 dias em 14/10, e o
--   card "Faturamentos Vencidos" mostra "Nenhum atraso". Quem le o campo como "vencido em
--   aberto": a aprovacao automatica do faturado (/api/cobrancas/aprovar-faturado-automatico,
--   > 0 deixa pendente) e a aba Pagamentos da proposta (> 0 barra o faturado).
--
-- A REGRA NOVA (a mesma da Carteira)
--   qtd_pagamentos_atrasados = quantidade de linhas de public.boletos com
--     id_cliente = p_id_cliente, status = 'VENCIDO' e paid_at nulo.
--   Quem grava VENCIDO e atualizar_atrasos_boletos() (pg_cron, 03h): faturado, nao pago,
--   vencimento antes de hoje, status A_VENCER. A tela da Carteira usa status = 'VENCIDO'.
--
-- MANTIDO IGUAL
--   media_atraso_dias e maior_atraso_dias continuam vindo do historico de pagamentos_v2
--   (PAID, paid_at e vencimento preenchidos), com a mesma conta. limite, utilizado,
--   saldo_carteira, limite_disponivel, status_credito, risco, padrao, pedidos aprovados,
--   ticket medio e mensagem: sem nenhuma alteracao.
--
-- O QUE NAO FAZ
--   Nao escreve em boletos, pagamentos_v2 ou clientes (a verificacao do passo 3 insere um
--   boleto de teste numa sub-transacao que e desfeita). Sem GRANT/REVOKE, sem RLS, sem
--   mexer no limite de credito.
--
-- GUARDA
--   Aborta se o corpo vivo nao tiver o md5 039e2b4e23aadd02a292f85b80d5fd7c ou se o ACL nao
--   for {authenticated, postgres, service_role} (anon nao executa). No fim, confere o ACL de
--   novo.
-- =====================================================================================

-- 1. GUARDA: corpo e ACL vivos sao os que a migration conhece. Guarda tambem, em tabela
--    temporaria, o resultado ANTIGO de dois clientes para comparar no passo 3.
do $guarda$
declare
  v_md5 text;
  v_acl text[];
begin
  select md5(p.prosrc),
         (select array_agg(s.g order by s.g)
            from (select case when a.grantee = 0 then 'PUBLIC' else (select rolname from pg_roles where oid = a.grantee) end as g
                    from aclexplode(p.proacl) a) s)
    into v_md5, v_acl
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname = 'fn_analise_credito_cliente'
     and pg_get_function_identity_arguments(p.oid) = 'p_id_cliente bigint';
  if v_md5 is null then
    raise exception 'GUARDA: fn_analise_credito_cliente(bigint) nao existe';
  end if;
  if v_md5 <> '039e2b4e23aadd02a292f85b80d5fd7c' then
    raise exception 'GUARDA: o corpo vivo mudou (md5 %). Releia a funcao antes de aplicar.', v_md5;
  end if;
  if v_acl is distinct from array['authenticated', 'postgres', 'service_role']::text[] then
    raise exception 'GUARDA: o ACL vivo mudou (%).', v_acl;
  end if;
  if has_function_privilege('anon', 'public.fn_analise_credito_cliente(bigint)', 'execute') then
    raise exception 'GUARDA: anon executa a funcao';
  end if;
end;
$guarda$;

-- Clientes da comparacao: 17610 (o caso real) e um cliente SEM titulo vencido em aberto
-- (o 14, de teste, se ainda estiver assim; senao o primeiro que estiver).
create temp table _analise_antes as
select a.*
  from (select 17610::bigint as id
        union
        select coalesce(
                 (select 14::bigint
                   where exists (select 1 from public.clientes c where c.id_cliente::bigint = 14)
                     and not exists (select 1 from public.boletos b
                                      where b.id_cliente = 14 and b.status = 'VENCIDO' and b.paid_at is null)),
                 (select c.id_cliente::bigint from public.clientes c
                   where not exists (select 1 from public.boletos b
                                      where b.id_cliente = c.id_cliente::bigint and b.status = 'VENCIDO' and b.paid_at is null)
                   order by c.id_cliente limit 1))) ids
  cross join lateral public.fn_analise_credito_cliente(ids.id) a
 where exists (select 1 from public.clientes c where c.id_cliente::bigint = ids.id);

-- 2. A FUNCAO (igual a viva, exceto o CTE vencidos_em_aberto e a coluna qtd_pagamentos_atrasados)
create or replace function public.fn_analise_credito_cliente(p_id_cliente bigint)
returns table(id_cliente bigint, limite_credito numeric, utilizado numeric, saldo_carteira numeric, limite_disponivel numeric, status_credito text, risco_credito text, padrao_pagamento text, media_atraso_dias integer, maior_atraso_dias integer, qtd_pagamentos_atrasados integer, qtd_pedidos_aprovados integer, ticket_medio_aprovado numeric, mensagem text)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if p_id_cliente is null then
    return query
    select
      null::bigint,
      0::numeric,
      0::numeric,
      0::numeric,
      0::numeric,
      'ERRO'::text,
      null::text,
      null::text,
      0::integer,
      0::integer,
      0::integer,
      0::integer,
      0::numeric,
      'id_cliente não informado'::text;
    return;
  end if;

  if not exists (
    select 1
    from public.clientes c
    where c.id_cliente::bigint = p_id_cliente
  ) then
    return query
    select
      p_id_cliente,
      0::numeric,
      0::numeric,
      0::numeric,
      0::numeric,
      'ERRO'::text,
      null::text,
      null::text,
      0::integer,
      0::integer,
      0::integer,
      0::integer,
      0::numeric,
      'cliente não encontrado'::text;
    return;
  end if;

  return query
  with base_cliente as (
    select
      c.id_cliente::bigint as id_cliente,
      coalesce(c.limite_credito, 0::numeric) as limite_credito,
      coalesce(c.risco_credito, '') as risco_credito,
      coalesce(c.padrao_pagamento, '') as padrao_pagamento,
      coalesce(c.restricao, false) as restricao
    from public.clientes c
    where c.id_cliente::bigint = p_id_cliente
  ),
  carteira as (
    select
      vc.id_cliente::bigint as id_cliente,
      coalesce(vc.saldo_carteira, 0::numeric) as saldo_carteira
    from public.vw_clientes_limite_credito vc
    where vc.id_cliente::bigint = p_id_cliente
  ),
  utilizado as (
    select
      p.id_cliente::bigint as id_cliente,
      coalesce(sum(v2.valor), 0::numeric) as utilizado
    from public.pagamentos_v2 v2
    join public.propostas p
      on p.id_int = v2.id_int
    where p.id_cliente::bigint = p_id_cliente
      and upper(coalesce(v2.status, '')) = 'A_VENCER'
      and coalesce(v2.confirmado, false) = true
    group by p.id_cliente
  ),
  -- Historico de pagamento com atraso (pagamentos_v2): so media e maior atraso.
  atrasos as (
    select
      p.id_cliente::bigint as id_cliente,
      coalesce(
        round(avg(greatest((v2.paid_at::date - v2.vencimento), 0))),
        0
      )::integer as media_atraso_dias,
      coalesce(
        max(greatest((v2.paid_at::date - v2.vencimento), 0)),
        0
      )::integer as maior_atraso_dias
    from public.pagamentos_v2 v2
    join public.propostas p
      on p.id_int = v2.id_int
    where p.id_cliente::bigint = p_id_cliente
      and upper(coalesce(v2.status, '')) = 'PAID'
      and v2.vencimento is not null
      and v2.paid_at is not null
    group by p.id_cliente
  ),
  -- Titulos vencidos e em aberto (14/10/2026): a mesma condicao da Carteira.
  vencidos_em_aberto as (
    select
      count(*)::integer as qtd_pagamentos_atrasados
    from public.boletos b
    where b.id_cliente = p_id_cliente
      and b.status = 'VENCIDO'
      and b.paid_at is null
  ),
  pedidos_aprovados as (
    select
      p.id_cliente::bigint as id_cliente,
      count(*)::integer as qtd_pedidos_aprovados,
      coalesce(
        round(avg(coalesce(p.valor_total::numeric, p.valor, 0::numeric)), 2),
        0::numeric
      ) as ticket_medio_aprovado
    from public.propostas p
    where p.id_cliente::bigint = p_id_cliente
      and upper(coalesce(p.status_interno, '')) in ('APROVADO', 'APROVADA')
    group by p.id_cliente
  )
  select
    bc.id_cliente,
    bc.limite_credito,
    coalesce(u.utilizado, 0::numeric) as utilizado,
    coalesce(ca.saldo_carteira, 0::numeric) as saldo_carteira,
    (
      greatest(bc.limite_credito, 0::numeric)
      - coalesce(u.utilizado, 0::numeric)
      + least(coalesce(ca.saldo_carteira, 0::numeric), 0::numeric)
    ) as limite_disponivel,
    case
      when bc.restricao = true then 'BLOQUEADO'
      when (
        greatest(bc.limite_credito, 0::numeric)
        - coalesce(u.utilizado, 0::numeric)
        + least(coalesce(ca.saldo_carteira, 0::numeric), 0::numeric)
      ) <= 0 then 'SEM_LIMITE'
      when (
        greatest(bc.limite_credito, 0::numeric)
        - coalesce(u.utilizado, 0::numeric)
        + least(coalesce(ca.saldo_carteira, 0::numeric), 0::numeric)
      ) < greatest(bc.limite_credito, 0::numeric) then 'LIMITE_REDUZIDO'
      else 'LIBERADO'
    end as status_credito,
    nullif(bc.risco_credito, '') as risco_credito,
    nullif(bc.padrao_pagamento, '') as padrao_pagamento,
    coalesce(a.media_atraso_dias, 0) as media_atraso_dias,
    coalesce(a.maior_atraso_dias, 0) as maior_atraso_dias,
    coalesce(va.qtd_pagamentos_atrasados, 0) as qtd_pagamentos_atrasados,
    coalesce(pa.qtd_pedidos_aprovados, 0) as qtd_pedidos_aprovados,
    coalesce(pa.ticket_medio_aprovado, 0::numeric) as ticket_medio_aprovado,
    case
      when bc.restricao = true then 'Cliente com restrição financeira'
      when (
        greatest(bc.limite_credito, 0::numeric)
        - coalesce(u.utilizado, 0::numeric)
        + least(coalesce(ca.saldo_carteira, 0::numeric), 0::numeric)
      ) <= 0 then 'Cliente sem limite disponível'
      else 'Cliente apto para análise de faturamento'
    end as mensagem
  from base_cliente bc
  cross join vencidos_em_aberto va
  left join carteira ca
    on ca.id_cliente = bc.id_cliente
  left join utilizado u
    on u.id_cliente = bc.id_cliente
  left join atrasos a
    on a.id_cliente = bc.id_cliente
  left join pedidos_aprovados pa
    on pa.id_cliente = bc.id_cliente;
end;
$function$;

-- 3. VERIFICACAO POR CONDICAO (nada fica gravado: o bloco interno termina em excecao de
--    proposito e a sub-transacao descarta o INSERT). Sem contagem absoluta de tabela viva:
--    tudo e comparado com o resultado antigo ou com o antes/depois do proprio teste.
do $verifica$
declare
  r          record;
  v_antes    record;
  v_qtd      integer;
  v_cliente  bigint;
  v_base     integer;
begin
  -- 3a. Para os clientes guardados no passo 1, so qtd_pagamentos_atrasados pode mudar,
  --     e ela tem de ser a contagem de vencidos em aberto em boletos.
  for v_antes in select * from _analise_antes loop
    select * into r from public.fn_analise_credito_cliente(v_antes.id_cliente);
    select count(*)::integer into v_qtd
      from public.boletos b
     where b.id_cliente = v_antes.id_cliente and b.status = 'VENCIDO' and b.paid_at is null;
    if (r.id_cliente, r.limite_credito, r.utilizado, r.saldo_carteira, r.limite_disponivel,
        r.status_credito, r.risco_credito, r.padrao_pagamento, r.media_atraso_dias,
        r.maior_atraso_dias, r.qtd_pedidos_aprovados, r.ticket_medio_aprovado, r.mensagem)
       is distinct from
       (v_antes.id_cliente, v_antes.limite_credito, v_antes.utilizado, v_antes.saldo_carteira, v_antes.limite_disponivel,
        v_antes.status_credito, v_antes.risco_credito, v_antes.padrao_pagamento, v_antes.media_atraso_dias,
        v_antes.maior_atraso_dias, v_antes.qtd_pedidos_aprovados, v_antes.ticket_medio_aprovado, v_antes.mensagem) then
      raise exception 'VERIFICA cliente %: outro campo alem da contagem mudou', v_antes.id_cliente;
    end if;
    if r.qtd_pagamentos_atrasados <> v_qtd then
      raise exception 'VERIFICA cliente %: qtd % <> vencidos em aberto %', v_antes.id_cliente, r.qtd_pagamentos_atrasados, v_qtd;
    end if;
  end loop;

  -- 3b. Cliente sem titulo vencido em aberto conta 0; com um boleto VENCIDO em aberto conta 1.
  select a.id_cliente into v_cliente
    from _analise_antes a
   where a.id_cliente <> 17610
   limit 1;
  if v_cliente is null then
    raise exception 'VERIFICA: nenhum cliente sem titulo vencido em aberto para o teste';
  end if;

  begin
    select qtd_pagamentos_atrasados into v_base from public.fn_analise_credito_cliente(v_cliente);
    if v_base <> 0 then
      raise exception 'VERIFICA sem vencido: qtd % (esperado 0)', v_base;
    end if;

    -- titulo que NAO conta: a vencer e pago
    -- (id_empresa 1: o gatilho trg_boletos_preencher_empresa recusa empresa vazia)
    insert into public.boletos (id_cliente, id_empresa, parcela, valor, vencimento, status, paid_at, descricao)
    values (v_cliente, 1, 1, 1.00, current_date + 10, 'A_VENCER', null, 'VERIFICA MIGRATION - desfeito'),
           (v_cliente, 1, 1, 1.00, current_date - 10, 'PAID', now(), 'VERIFICA MIGRATION - desfeito');
    select qtd_pagamentos_atrasados into v_qtd from public.fn_analise_credito_cliente(v_cliente);
    if v_qtd <> 0 then
      raise exception 'VERIFICA a vencer/pago: qtd % (esperado 0)', v_qtd;
    end if;

    -- um titulo VENCIDO em aberto: conta 1
    insert into public.boletos (id_cliente, id_empresa, parcela, valor, vencimento, status, descricao)
    values (v_cliente, 1, 1, 1.00, current_date - 10, 'VENCIDO', 'VERIFICA MIGRATION - desfeito');
    select qtd_pagamentos_atrasados into v_qtd from public.fn_analise_credito_cliente(v_cliente);
    if v_qtd <> 1 then
      raise exception 'VERIFICA um vencido em aberto: qtd % (esperado 1)', v_qtd;
    end if;

    raise exception 'VERIFICA_OK';
  exception when others then
    if sqlerrm <> 'VERIFICA_OK' then
      raise;
    end if;
  end;
end;
$verifica$;

-- 4. GUARDA FINAL: o ACL continua o mesmo, sem anon
do $guarda_final$
declare
  v_acl text[];
begin
  select (select array_agg(s.g order by s.g)
            from (select case when a.grantee = 0 then 'PUBLIC' else (select rolname from pg_roles where oid = a.grantee) end as g
                    from aclexplode(p.proacl) a) s)
    into v_acl
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname = 'fn_analise_credito_cliente'
     and pg_get_function_identity_arguments(p.oid) = 'p_id_cliente bigint';
  if v_acl is distinct from array['authenticated', 'postgres', 'service_role']::text[] then
    raise exception 'GUARDA FINAL: o ACL mudou (%).', v_acl;
  end if;
  if has_function_privilege('anon', 'public.fn_analise_credito_cliente(bigint)', 'execute') then
    raise exception 'GUARDA FINAL: anon executa a funcao';
  end if;
end;
$guarda_final$;

drop table if exists pg_temp._analise_antes;

-- =====================================================================================
-- ROLLBACK (corpo antigo). O original foi gravado com quebras de linha CRLF: o corpo abaixo,
-- sem o "-- " e com CRLF, da exatamente o md5 039e2b4e23aadd02a292f85b80d5fd7c (conferido em
-- 14/10). Colado com LF, o comportamento e o mesmo e so o md5 muda. O ACL nao muda no rollback.
--
-- Diferenca em relacao ao corpo novo: no CTE atrasos volta a coluna
--
--      coalesce(
--        count(*) filter (
--          where greatest((v2.paid_at::date - v2.vencimento), 0) > 0
--        ),
--        0
--      )::integer as qtd_pagamentos_atrasados
--
-- sai o CTE vencidos_em_aberto e o "cross join vencidos_em_aberto va", e o select final volta a
-- "coalesce(a.qtd_pagamentos_atrasados, 0) as qtd_pagamentos_atrasados". O corpo completo:
--
-- create or replace function public.fn_analise_credito_cliente(p_id_cliente bigint)
-- returns table(id_cliente bigint, limite_credito numeric, utilizado numeric, saldo_carteira numeric, limite_disponivel numeric, status_credito text, risco_credito text, padrao_pagamento text, media_atraso_dias integer, maior_atraso_dias integer, qtd_pagamentos_atrasados integer, qtd_pedidos_aprovados integer, ticket_medio_aprovado numeric, mensagem text)
-- language plpgsql
-- security definer
-- set search_path to 'public'
-- as $function$
-- begin
--   if p_id_cliente is null then
--     return query
--     select
--       null::bigint,
--       0::numeric,
--       0::numeric,
--       0::numeric,
--       0::numeric,
--       'ERRO'::text,
--       null::text,
--       null::text,
--       0::integer,
--       0::integer,
--       0::integer,
--       0::integer,
--       0::numeric,
--       'id_cliente não informado'::text;
--     return;
--   end if;
--
--   if not exists (
--     select 1
--     from public.clientes c
--     where c.id_cliente::bigint = p_id_cliente
--   ) then
--     return query
--     select
--       p_id_cliente,
--       0::numeric,
--       0::numeric,
--       0::numeric,
--       0::numeric,
--       'ERRO'::text,
--       null::text,
--       null::text,
--       0::integer,
--       0::integer,
--       0::integer,
--       0::integer,
--       0::numeric,
--       'cliente não encontrado'::text;
--     return;
--   end if;
--
--   return query
--   with base_cliente as (
--     select
--       c.id_cliente::bigint as id_cliente,
--       coalesce(c.limite_credito, 0::numeric) as limite_credito,
--       coalesce(c.risco_credito, '') as risco_credito,
--       coalesce(c.padrao_pagamento, '') as padrao_pagamento,
--       coalesce(c.restricao, false) as restricao
--     from public.clientes c
--     where c.id_cliente::bigint = p_id_cliente
--   ),
--   carteira as (
--     select
--       vc.id_cliente::bigint as id_cliente,
--       coalesce(vc.saldo_carteira, 0::numeric) as saldo_carteira
--     from public.vw_clientes_limite_credito vc
--     where vc.id_cliente::bigint = p_id_cliente
--   ),
--   utilizado as (
--     select
--       p.id_cliente::bigint as id_cliente,
--       coalesce(sum(v2.valor), 0::numeric) as utilizado
--     from public.pagamentos_v2 v2
--     join public.propostas p
--       on p.id_int = v2.id_int
--     where p.id_cliente::bigint = p_id_cliente
--       and upper(coalesce(v2.status, '')) = 'A_VENCER'
--       and coalesce(v2.confirmado, false) = true
--     group by p.id_cliente
--   ),
--   atrasos as (
--     select
--       p.id_cliente::bigint as id_cliente,
--       coalesce(
--         round(avg(greatest((v2.paid_at::date - v2.vencimento), 0))),
--         0
--       )::integer as media_atraso_dias,
--       coalesce(
--         max(greatest((v2.paid_at::date - v2.vencimento), 0)),
--         0
--       )::integer as maior_atraso_dias,
--       coalesce(
--         count(*) filter (
--           where greatest((v2.paid_at::date - v2.vencimento), 0) > 0
--         ),
--         0
--       )::integer as qtd_pagamentos_atrasados
--     from public.pagamentos_v2 v2
--     join public.propostas p
--       on p.id_int = v2.id_int
--     where p.id_cliente::bigint = p_id_cliente
--       and upper(coalesce(v2.status, '')) = 'PAID'
--       and v2.vencimento is not null
--       and v2.paid_at is not null
--     group by p.id_cliente
--   ),
--   pedidos_aprovados as (
--     select
--       p.id_cliente::bigint as id_cliente,
--       count(*)::integer as qtd_pedidos_aprovados,
--       coalesce(
--         round(avg(coalesce(p.valor_total::numeric, p.valor, 0::numeric)), 2),
--         0::numeric
--       ) as ticket_medio_aprovado
--     from public.propostas p
--     where p.id_cliente::bigint = p_id_cliente
--       and upper(coalesce(p.status_interno, '')) in ('APROVADO', 'APROVADA')
--     group by p.id_cliente
--   )
--   select
--     bc.id_cliente,
--     bc.limite_credito,
--     coalesce(u.utilizado, 0::numeric) as utilizado,
--     coalesce(ca.saldo_carteira, 0::numeric) as saldo_carteira,
--     (
--       greatest(bc.limite_credito, 0::numeric)
--       - coalesce(u.utilizado, 0::numeric)
--       + least(coalesce(ca.saldo_carteira, 0::numeric), 0::numeric)
--     ) as limite_disponivel,
--     case
--       when bc.restricao = true then 'BLOQUEADO'
--       when (
--         greatest(bc.limite_credito, 0::numeric)
--         - coalesce(u.utilizado, 0::numeric)
--         + least(coalesce(ca.saldo_carteira, 0::numeric), 0::numeric)
--       ) <= 0 then 'SEM_LIMITE'
--       when (
--         greatest(bc.limite_credito, 0::numeric)
--         - coalesce(u.utilizado, 0::numeric)
--         + least(coalesce(ca.saldo_carteira, 0::numeric), 0::numeric)
--       ) < greatest(bc.limite_credito, 0::numeric) then 'LIMITE_REDUZIDO'
--       else 'LIBERADO'
--     end as status_credito,
--     nullif(bc.risco_credito, '') as risco_credito,
--     nullif(bc.padrao_pagamento, '') as padrao_pagamento,
--     coalesce(a.media_atraso_dias, 0) as media_atraso_dias,
--     coalesce(a.maior_atraso_dias, 0) as maior_atraso_dias,
--     coalesce(a.qtd_pagamentos_atrasados, 0) as qtd_pagamentos_atrasados,
--     coalesce(pa.qtd_pedidos_aprovados, 0) as qtd_pedidos_aprovados,
--     coalesce(pa.ticket_medio_aprovado, 0::numeric) as ticket_medio_aprovado,
--     case
--       when bc.restricao = true then 'Cliente com restrição financeira'
--       when (
--         greatest(bc.limite_credito, 0::numeric)
--         - coalesce(u.utilizado, 0::numeric)
--         + least(coalesce(ca.saldo_carteira, 0::numeric), 0::numeric)
--       ) <= 0 then 'Cliente sem limite disponível'
--       else 'Cliente apto para análise de faturamento'
--     end as mensagem
--   from base_cliente bc
--   left join carteira ca
--     on ca.id_cliente = bc.id_cliente
--   left join utilizado u
--     on u.id_cliente = bc.id_cliente
--   left join atrasos a
--     on a.id_cliente = bc.id_cliente
--   left join pedidos_aprovados pa
--     on pa.id_cliente = bc.id_cliente;
-- end;
-- $function$;
-- =====================================================================================
