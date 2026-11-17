-- ============================================================================
-- 20261117_troca_chave_pix.sql
--
-- "Chave Pix" na troca de forma de pagamento (17/11/2026).
--
-- O cliente pagou por PIX direto na chave da empresa, fora do Vibe. Na janela
-- "Trocar forma de pagamento" do PIX do Vibe (não pago), o financeiro escolhe
-- Chave Pix e registra o recebimento: nasce uma cobrança do mesmo valor e
-- pagador, JÁ PAGA, e o PIX do Vibe é cancelado no banco pela rota de sempre
-- (/api/cobrancas/trocar-forma-pagamento). Se o banco não confirmar o
-- cancelamento, a rota cancela a cobrança nova e o PIX continua.
--
-- TIPO: a cobrança nova é tipo_cobranca = 'PIX', com forma_pgto = 'CHAVE PIX'.
-- Não há tipo novo de propósito: tudo que lê o tipo já trata PIX pago como
-- dinheiro recebido — faturamento (view_pagamentos_pagos_v2), Vendas pagas,
-- comissão, Curva ABC, ranking, Dashboard, filtro Cobrança da lista de Pedidos,
-- forma de pagamento da NF-e (tPag 17) e a conferência automática. Ela nasce
-- PAID e não conferida, como um PIX pago: entra na Conferência e, conferida,
-- libera o pedido e conta no faturamento.
--
-- Uma tabela nova (recebimentos_chave_pix) guarda o que o PIX do Vibe teria do
-- banco: data do pagamento, e2eId e/ou identificação do comprovante, quem
-- registrou e quando, e de qual PIX ela veio. Escrita só por
-- fin_troca_criar_chave_pix, que grava a cobrança e o registro numa
-- transação só.
--
-- fin_troca_criar_chave_pix confere:
--   - permissão de confirmar pagamento na Conferência
--     (cc__assert_permissao 'conferencia.confirm': super admin, perfil com a
--     permissão ou com '*', ou administrador — a mesma regra da rota confirmar);
--   - motivo, data do pagamento (hoje ou antes), e2eId (32 letras e números)
--     ou comprovante — um dos dois é obrigatório;
--   - a cobrança de origem: PIX, A_RECEBER, sem pagamento, ligada a pedido e
--     com a marca "TROCA EM ANDAMENTO" (a rota grava a marca antes; sem ela a
--     função recusa — só a troca chama a função);
--   - sem gravar em dobro: a mesma origem não ganha duas cobranças Chave Pix
--     ativas, e o mesmo e2eId ou comprovante não vale para duas cobranças
--     ativas (trava por advisory lock na transação). Cobrança desfeita pela
--     rota (CANCELADO) libera o e2eId para uma nova tentativa.
--
-- Recusas com código CHAVE_* (nada gravado). Retorno: jsonb { id, id_pagamento }.
--
-- ACL previsto:
--   tabela:  RLS ligada; SELECT para authenticated (política de leitura);
--            nenhuma escrita direta para anon/authenticated; service_role ALL.
--   função:  EXECUTE para authenticated e service_role; nada para PUBLIC/anon.
-- ============================================================================

create table if not exists public.recebimentos_chave_pix (
  id                   bigint generated always as identity primary key,
  id_pagamento         uuid not null references public.pagamentos_v2(id),
  id_pagamento_origem  uuid not null references public.pagamentos_v2(id),
  id_int               bigint not null,
  id_cliente           bigint,
  valor                numeric(12,2) not null check (valor > 0),
  data_pagamento       date not null,
  e2e_id               text,
  comprovante          text,
  motivo               text not null check (btrim(motivo) <> ''),
  registrado_por       uuid not null,
  registrado_por_nome  text not null,
  registrado_em        timestamptz not null default now(),
  constraint recebimentos_chave_pix_e2e_formato
    check (e2e_id is null or e2e_id ~ '^[A-Z0-9]{32}$'),
  constraint recebimentos_chave_pix_identificacao
    check (e2e_id is not null or nullif(btrim(comprovante), '') is not null)
);

create unique index if not exists recebimentos_chave_pix_um_por_cobranca
  on public.recebimentos_chave_pix (id_pagamento);
create index if not exists recebimentos_chave_pix_origem
  on public.recebimentos_chave_pix (id_pagamento_origem);
create index if not exists recebimentos_chave_pix_e2e
  on public.recebimentos_chave_pix (e2e_id) where e2e_id is not null;
create index if not exists recebimentos_chave_pix_id_int
  on public.recebimentos_chave_pix (id_int);

comment on table public.recebimentos_chave_pix is
  'PIX recebido na chave da empresa, fora do Vibe, registrado na troca de forma de pagamento (Chave Pix). Escrita só por fin_troca_criar_chave_pix. 17/11/2026.';

alter table public.recebimentos_chave_pix enable row level security;

revoke all on table public.recebimentos_chave_pix from public;
revoke all on table public.recebimentos_chave_pix from anon;
revoke all on table public.recebimentos_chave_pix from authenticated;
grant select on table public.recebimentos_chave_pix to authenticated;
grant all on table public.recebimentos_chave_pix to service_role;

drop policy if exists recebimentos_chave_pix_leitura on public.recebimentos_chave_pix;
create policy recebimentos_chave_pix_leitura on public.recebimentos_chave_pix
  for select to authenticated using (true);


create or replace function public.fin_troca_criar_chave_pix(
  p_id_origem uuid,
  p_data_pagamento date,
  p_e2e_id text,
  p_comprovante text,
  p_motivo text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_e2e text := nullif(upper(regexp_replace(coalesce(p_e2e_id, ''), '\s', '', 'g')), '');
  v_comprovante text := nullif(btrim(coalesce(p_comprovante, '')), '');
  v_nome text;
  v_autor text;
  v_origem public.pagamentos_v2%rowtype;
  v_ref_origem text;
  v_dup text;
  v_paid_at timestamptz;
  v_nova_id uuid;
  v_nova_ref text;
begin
  -- 1. Quem: quem confirma pagamento na Conferência.
  perform public.cc__assert_permissao(v_uid, 'conferencia.confirm');
  select nome_usuario into v_nome from public.usuarios where user_id = v_uid;
  v_autor := coalesce(nullif(btrim(v_nome), ''), 'Usuário');

  -- 2. Forma dos dados.
  if p_id_origem is null then
    raise exception 'CHAVE_PARAMS: cobrança não informada';
  end if;
  if v_motivo = '' then
    raise exception 'CHAVE_PARAMS: informe o motivo da troca';
  end if;
  if p_data_pagamento is null then
    raise exception 'CHAVE_PARAMS: informe a data do pagamento';
  end if;
  if p_data_pagamento > v_hoje then
    raise exception 'CHAVE_DATA: a data do pagamento não pode ser futura';
  end if;
  if v_e2e is null and v_comprovante is null then
    raise exception 'CHAVE_IDENTIFICACAO: informe o e2eId do PIX recebido ou a identificação do comprovante';
  end if;
  if v_e2e is not null and v_e2e !~ '^[A-Z0-9]{32}$' then
    raise exception 'CHAVE_E2E: o e2eId tem 32 letras e números, sem espaços';
  end if;

  -- 3. A cobrança de origem, travada até o fim.
  select * into v_origem from public.pagamentos_v2 where id = p_id_origem for update;
  if not found then
    raise exception 'CHAVE_NAO_ENCONTRADA: cobrança não encontrada';
  end if;
  v_ref_origem := coalesce(v_origem.id_pagamento, v_origem.id::text);
  if upper(btrim(coalesce(v_origem.tipo_cobranca, ''))) <> 'PIX' then
    raise exception 'CHAVE_ORIGEM: a cobrança % não é PIX', v_ref_origem;
  end if;
  if upper(coalesce(v_origem.status, '')) <> 'A_RECEBER' or v_origem.paid_at is not null then
    raise exception 'CHAVE_ORIGEM: o PIX % não está emitido e em aberto (status %)', v_ref_origem, coalesce(v_origem.status, 'vazio');
  end if;
  if v_origem.id_int is null then
    raise exception 'CHAVE_ORIGEM: o PIX % não está ligado a um pedido', v_ref_origem;
  end if;
  if coalesce(v_origem.motivo_troca, '') not like 'TROCA EM ANDAMENTO%' then
    raise exception 'CHAVE_SEM_TROCA: a Chave Pix só é registrada pela troca de forma de pagamento';
  end if;

  -- 4. Sem gravar em dobro.
  if exists (
    select 1 from public.recebimentos_chave_pix r
      join public.pagamentos_v2 p on p.id = r.id_pagamento
     where r.id_pagamento_origem = v_origem.id
       and upper(coalesce(p.status, '')) <> 'CANCELADO'
  ) then
    raise exception 'CHAVE_JA_REGISTRADA: o PIX % já tem uma cobrança Chave Pix ativa', v_ref_origem;
  end if;

  if v_e2e is not null then
    perform pg_advisory_xact_lock(hashtext('chave_pix:e2e:' || v_e2e));
    select coalesce(p.id_pagamento, p.id::text) into v_dup
      from public.recebimentos_chave_pix r
      join public.pagamentos_v2 p on p.id = r.id_pagamento
     where r.e2e_id = v_e2e and upper(coalesce(p.status, '')) <> 'CANCELADO'
     limit 1;
    if v_dup is not null then
      raise exception 'CHAVE_DUPLICADA: este e2eId já foi registrado na cobrança %', v_dup;
    end if;
  end if;
  if v_comprovante is not null then
    perform pg_advisory_xact_lock(hashtext('chave_pix:comp:' || upper(v_comprovante)));
    select coalesce(p.id_pagamento, p.id::text) into v_dup
      from public.recebimentos_chave_pix r
      join public.pagamentos_v2 p on p.id = r.id_pagamento
     where upper(btrim(coalesce(r.comprovante, ''))) = upper(v_comprovante)
       and upper(coalesce(p.status, '')) <> 'CANCELADO'
     limit 1;
    if v_dup is not null then
      raise exception 'CHAVE_DUPLICADA: este comprovante já foi registrado na cobrança %', v_dup;
    end if;
  end if;

  -- 5. A cobrança nova: mesmo pedido, valor e pagador; PIX pago na chave.
  --    Hora do pagamento: agora, se foi hoje; senão meio-dia do dia informado.
  v_paid_at := case
    when p_data_pagamento = v_hoje then now()
    else (p_data_pagamento::timestamp + interval '12 hours') at time zone 'America/Sao_Paulo'
  end;

  insert into public.pagamentos_v2 (
    id_int, id_cliente, cliente, documento, valor, status, tipo_cobranca,
    empresa, id_empresa, os_ideal, atendente, descricao, vencimento, obs_v2,
    confirmado, forma_fatu, forma_pgto, id_modelo_cobranca,
    p_valor_entrada, p_qtd_parcelas, p_dias_pra_inicio, p_intervalo, paid_at
  ) values (
    v_origem.id_int, v_origem.id_cliente, v_origem.cliente, v_origem.documento,
    round(v_origem.valor::numeric, 2), 'PAID', 'PIX',
    v_origem.empresa, v_origem.id_empresa, v_origem.os_ideal, v_origem.atendente,
    format('Cobrança PIX (chave Pix) da proposta #%s (troca da %s)', v_origem.id_int, v_ref_origem),
    v_hoje, v_origem.obs_v2,
    false, null, 'CHAVE PIX', null,
    null, null, null, null, v_paid_at
  ) returning id, id_pagamento into v_nova_id, v_nova_ref;

  insert into public.recebimentos_chave_pix (
    id_pagamento, id_pagamento_origem, id_int, id_cliente, valor, data_pagamento,
    e2e_id, comprovante, motivo, registrado_por, registrado_por_nome
  ) values (
    v_nova_id, v_origem.id, v_origem.id_int, v_origem.id_cliente, round(v_origem.valor::numeric, 2),
    p_data_pagamento, v_e2e, v_comprovante, v_motivo, v_uid, v_autor
  );

  return jsonb_build_object('id', v_nova_id, 'id_pagamento', v_nova_ref);
end;
$function$;

revoke all on function public.fin_troca_criar_chave_pix(uuid, date, text, text, text) from public;
revoke all on function public.fin_troca_criar_chave_pix(uuid, date, text, text, text) from anon;
grant execute on function public.fin_troca_criar_chave_pix(uuid, date, text, text, text) to authenticated;
grant execute on function public.fin_troca_criar_chave_pix(uuid, date, text, text, text) to service_role;

comment on function public.fin_troca_criar_chave_pix(uuid, date, text, text, text) is
  'Troca de forma de pagamento para Chave Pix: cria a cobrança PIX já paga (forma_pgto CHAVE PIX) e o registro em recebimentos_chave_pix, numa transação. Só quem confirma pagamento (conferencia.confirm); exige a troca em andamento; sem e2eId/comprovante repetido em cobrança ativa. 17/11/2026.';

-- Conferência do ACL depois de aplicar (esperado: authenticated, postgres, service_role; sem anon):
--   select array_agg(a.grantee::regrole::text order by 1) from pg_proc p, aclexplode(p.proacl) a
--    where p.oid = 'public.fin_troca_criar_chave_pix(uuid,date,text,text,text)'::regprocedure
--      and a.privilege_type = 'EXECUTE';
--   select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, array_agg(a.privilege_type order by 1)
--     from pg_class c, aclexplode(c.relacl) a where c.oid = 'public.recebimentos_chave_pix'::regclass group by 1;

-- ============================================================================
-- ROLLBACK (rodar só com autorização; apaga também os registros de Chave Pix —
-- confira antes: select count(*) from public.recebimentos_chave_pix;).
-- Não desfaz as cobranças PIX já criadas pela função.
--
-- drop function if exists public.fin_troca_criar_chave_pix(uuid, date, text, text, text);
-- drop table if exists public.recebimentos_chave_pix;
-- ============================================================================
