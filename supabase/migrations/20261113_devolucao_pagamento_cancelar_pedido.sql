-- ============================================================================
-- 20261113_devolucao_pagamento_cancelar_pedido.sql
--
-- "Registrar devolução e cancelar pedido" (caso 25098, 13/11/2026).
--
-- O financeiro devolve o dinheiro pelo aplicativo do banco; o Vibe só registra a
-- devolução e cancela o pedido. Nenhuma API de banco é chamada.
--
-- Uma tabela nova (devolucoes_pagamento) e UMA função (fin_registrar_devolucao_e_cancelar)
-- que, numa transação só:
--   1. registra a devolução: cobrança, pedido, cliente, valor (sempre o total da
--      cobrança), data, e2eId e/ou identificação do comprovante, motivo, autor;
--   2. cancela a cobrança (status CANCELADO, motivo "Devolvido ao cliente ...");
--   3. cancela o pedido (status_interno CANCELADO) — por último, porque os
--      gatilhos de pagamentos_v2 recalculam o status da proposta quando a
--      cobrança muda;
--   4. grava a linha do Histórico (propostas_chat) com o autor.
--
-- Faturamento, Vendas pagas, comissão, Curva ABC, ranking e Dashboard contam só
-- cobrança PAID/A_VENCER: a cobrança CANCELADA sai de todos sem mais nada.
--
-- Quem pode: só super admin (usuarios.is_super_adm), a mesma regra do
-- cancelamento de cobrança paga (/api/cobrancas/cancelar-pago).
--
-- Travas (recusa com código DEV_*, nada gravado):
--   - cobrança não PAID, ou de forma sem dinheiro recebido (E-Faturado,
--     E-Crédito, E-Amostra, E-Retrabalho, E-Permuta);
--   - valor informado diferente do total da cobrança (só devolução total);
--   - data da devolução no futuro ou antes do pagamento;
--   - sem e2eId nem comprovante; e2eId fora do formato (32 letras/números);
--   - pagamento confirmado em mês já fechado sem a confirmação explícita;
--   - pedido já cancelado; pedido complementar; complemento aberto;
--   - outra cobrança ativa no pedido; boleto liquidado de outra cobrança;
--   - nota fiscal (NF-e ou NFS-e) AUTORIZADA em produção;
--   - produção (liberado para produção, status de produção/expedição, setores
--     da OS ou volumes) ou despacho (expedicoes);
--   - E-Crédito consumido no pedido e não estornado.
--
-- Sem gravar em dobro: uma devolução por cobrança (índice único). A segunda
-- chamada para a mesma cobrança devolve {ja_registrada: true} sem gravar; o
-- mesmo e2eId em outra cobrança é recusado (índice único).
--
-- ACL previsto:
--   tabela:  RLS ligada; SELECT para authenticated (política de leitura);
--            nenhuma escrita direta para anon/authenticated; service_role ALL.
--   função:  EXECUTE para authenticated e service_role; nada para PUBLIC/anon.
-- ============================================================================

create table if not exists public.devolucoes_pagamento (
  id                   bigint generated always as identity primary key,
  id_pagamento         uuid not null references public.pagamentos_v2(id),
  id_int               bigint not null,
  id_cliente           bigint,
  ref_cobranca         text,
  tipo_cobranca        text,
  valor                numeric(12,2) not null check (valor > 0),
  data_devolucao       date not null,
  e2e_id               text,
  comprovante          text,
  motivo               text not null check (btrim(motivo) <> ''),
  registrado_por       uuid not null,
  registrado_por_nome  text not null,
  registrado_em        timestamptz not null default now(),
  constraint devolucoes_pagamento_e2e_formato
    check (e2e_id is null or e2e_id ~ '^[A-Z0-9]{32}$'),
  constraint devolucoes_pagamento_identificacao
    check (e2e_id is not null or nullif(btrim(comprovante), '') is not null)
);

create unique index if not exists devolucoes_pagamento_uma_por_cobranca
  on public.devolucoes_pagamento (id_pagamento);
create unique index if not exists devolucoes_pagamento_e2e_unico
  on public.devolucoes_pagamento (e2e_id) where e2e_id is not null;
create index if not exists devolucoes_pagamento_id_int
  on public.devolucoes_pagamento (id_int);

comment on table public.devolucoes_pagamento is
  'Devoluções de cobrança paga feitas pelo aplicativo do banco e registradas no Vibe (Registrar devolução e cancelar pedido). Escrita só por fin_registrar_devolucao_e_cancelar. 13/11/2026.';

alter table public.devolucoes_pagamento enable row level security;

revoke all on table public.devolucoes_pagamento from public;
revoke all on table public.devolucoes_pagamento from anon;
revoke all on table public.devolucoes_pagamento from authenticated;
grant select on table public.devolucoes_pagamento to authenticated;
grant all on table public.devolucoes_pagamento to service_role;

drop policy if exists devolucoes_pagamento_leitura on public.devolucoes_pagamento;
create policy devolucoes_pagamento_leitura on public.devolucoes_pagamento
  for select to authenticated using (true);


create or replace function public.fin_registrar_devolucao_e_cancelar(
  p_id_pagamento uuid,
  p_valor numeric,
  p_data_devolucao date,
  p_e2e_id text,
  p_comprovante text,
  p_motivo text,
  p_confirma_mes_fechado boolean default false
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
  v_e2e text := nullif(upper(btrim(coalesce(p_e2e_id, ''))), '');
  v_comprovante text := nullif(btrim(coalesce(p_comprovante, '')), '');
  v_super boolean;
  v_nome text;
  v_autor text;
  v_cob public.pagamentos_v2%rowtype;
  v_prop record;
  v_tipo text;
  v_existente public.devolucoes_pagamento%rowtype;
  v_ref text;
  v_lista text;
  v_id_devolucao bigint;
  v_linhas integer;
begin
  -- 1. Quem: só super admin.
  if v_uid is null then
    raise exception 'DEV_AUTH: sessão não identificada';
  end if;
  select is_super_adm, nome_usuario into v_super, v_nome
    from public.usuarios where user_id = v_uid;
  if not coalesce(v_super, false) then
    raise exception 'DEV_PERMISSAO: somente um super administrador pode registrar devolução e cancelar o pedido';
  end if;
  v_autor := coalesce(nullif(btrim(v_nome), ''), 'Usuário');

  -- 2. Forma dos dados.
  if p_id_pagamento is null then
    raise exception 'DEV_PARAMS: cobrança não informada';
  end if;
  if v_motivo = '' then
    raise exception 'DEV_PARAMS: informe o motivo da devolução';
  end if;
  if p_data_devolucao is null then
    raise exception 'DEV_PARAMS: informe a data da devolução';
  end if;
  if p_data_devolucao > v_hoje then
    raise exception 'DEV_DATA: a data da devolução não pode ser futura';
  end if;
  if v_e2e is null and v_comprovante is null then
    raise exception 'DEV_IDENTIFICACAO: informe o e2eId da devolução ou a identificação do comprovante';
  end if;
  if v_e2e is not null and v_e2e !~ '^[A-Z0-9]{32}$' then
    raise exception 'DEV_E2E: o e2eId tem 32 letras e números, sem espaços';
  end if;

  -- 3. A cobrança, travada até o fim.
  select * into v_cob from public.pagamentos_v2 where id = p_id_pagamento for update;
  if not found then
    raise exception 'DEV_NAO_ENCONTRADA: cobrança não encontrada';
  end if;
  v_ref := coalesce(v_cob.id_pagamento, v_cob.id::text);

  -- 4. Sem gravar em dobro: já registrada devolve o que existe.
  select * into v_existente from public.devolucoes_pagamento where id_pagamento = p_id_pagamento;
  if found then
    return jsonb_build_object(
      'ja_registrada', true,
      'id_devolucao', v_existente.id,
      'id_int', v_existente.id_int,
      'valor', v_existente.valor,
      'ref_cobranca', v_existente.ref_cobranca
    );
  end if;
  if v_e2e is not null and exists (select 1 from public.devolucoes_pagamento where e2e_id = v_e2e) then
    raise exception 'DEV_E2E_DUPLICADO: este e2eId já foi registrado em outra devolução';
  end if;

  -- 5. Cobrança paga, com dinheiro recebido, valor total.
  if upper(coalesce(v_cob.status, '')) <> 'PAID' then
    raise exception 'DEV_NAO_PAGA: a cobrança % não está paga (status %)', v_ref, coalesce(v_cob.status, 'vazio');
  end if;
  v_tipo := upper(replace(btrim(coalesce(v_cob.tipo_cobranca, '')), '_', '-'));
  if v_tipo like 'E-%' and v_tipo <> 'E-PIX' then
    raise exception 'DEV_TIPO: cobrança % (%) não teve dinheiro recebido do cliente e não entra em devolução', v_ref, v_cob.tipo_cobranca;
  end if;
  if p_valor is null or round(p_valor, 2) <> round(v_cob.valor::numeric, 2) then
    raise exception 'DEV_VALOR: a devolução é do valor total da cobrança (R$ %)', to_char(v_cob.valor, 'FM999999990.00');
  end if;
  if v_cob.paid_at is not null
     and p_data_devolucao < (v_cob.paid_at at time zone 'America/Sao_Paulo')::date then
    raise exception 'DEV_DATA: a data da devolução é anterior ao pagamento (%)',
      to_char((v_cob.paid_at at time zone 'America/Sao_Paulo')::date, 'DD/MM/YYYY');
  end if;
  if v_cob.data_confirmacao is not null
     and date_trunc('month', (v_cob.data_confirmacao at time zone 'America/Sao_Paulo'))
       < date_trunc('month', (now() at time zone 'America/Sao_Paulo'))
     and not coalesce(p_confirma_mes_fechado, false) then
    raise exception 'DEV_MES_FECHADO: o pagamento foi confirmado em mês anterior; confirme que o faturamento fechado será alterado';
  end if;

  -- 6. O pedido, travado.
  select id_int, id_cliente, status_interno, is_prd_aprovado, id_int_pedido_principal
    into v_prop
    from public.propostas where id_int = v_cob.id_int for update;
  if not found then
    raise exception 'DEV_NAO_ENCONTRADA: pedido % não encontrado', v_cob.id_int;
  end if;
  if upper(btrim(coalesce(v_prop.status_interno, ''))) = 'CANCELADO' then
    raise exception 'DEV_JA_CANCELADO: o pedido % já está cancelado', v_prop.id_int;
  end if;
  if v_prop.id_int_pedido_principal is not null then
    raise exception 'DEV_COMPLEMENTO: o pedido % é complementar do %; cancele pelo caminho do complemento',
      v_prop.id_int, v_prop.id_int_pedido_principal;
  end if;

  select string_agg('#' || id_int, ', ' order by id_int) into v_lista
    from public.propostas
   where id_int_pedido_principal = v_prop.id_int
     and upper(btrim(coalesce(status_interno, ''))) <> 'CANCELADO';
  if v_lista is not null then
    raise exception 'DEV_COMPLEMENTOS_ABERTOS: cancele antes os pedidos complementares (%)', v_lista;
  end if;

  -- 7. Outras cobranças e títulos do pedido.
  select string_agg(coalesce(id_pagamento, id::text) || ' (' || coalesce(status, '-') || ')', ', ') into v_lista
    from public.pagamentos_v2
   where id_int = v_prop.id_int
     and id <> v_cob.id
     and upper(btrim(coalesce(status, ''))) not in ('CANCELADO', 'CANCELADA', 'EXTORNADO', 'RECUSADO');
  if v_lista is not null then
    raise exception 'DEV_OUTRAS_COBRANCAS: o pedido tem outra cobrança ativa (%); resolva-a antes', v_lista;
  end if;

  if exists (
    select 1 from public.boletos b
     where b.id_int = v_prop.id_int
       and b.paid_at is not null
       and coalesce(b.id_pagamento, '') <> coalesce(v_cob.id_pagamento, '')
  ) then
    raise exception 'DEV_TITULO_LIQUIDADO: o pedido tem título liquidado de outra cobrança';
  end if;

  -- 8. Nota fiscal viva (mesma definição de isNotaImpeditiva).
  select string_agg(rotulo, ', ') into v_lista from (
    select 'NF-e ' || coalesce(numero_nf::text, 'sem número') as rotulo
      from public.notas_fiscais
     where id_int = v_prop.id_int and upper(coalesce(status, '')) = 'AUTORIZADA'
       and lower(coalesce(ambiente, '')) = 'producao'
    union all
    select 'NFS-e ' || coalesce(numero_nfse::text, 'sem número')
      from public.notas_servico
     where id_int = v_prop.id_int and upper(coalesce(status::text, '')) = 'AUTORIZADA'
       and lower(coalesce(ambiente, '')) = 'producao'
  ) n;
  if v_lista is not null then
    raise exception 'DEV_NOTA_AUTORIZADA: cancele antes a nota fiscal (%)', v_lista;
  end if;

  -- 9. Produção e despacho.
  if coalesce(v_prop.is_prd_aprovado, false)
     or upper(btrim(coalesce(v_prop.status_interno, ''))) in (
       'REVISAO PRODUCAO', 'EM PRODUCAO', 'EM IMPRESSAO', 'EM IMPRESSAO / PENDENTE',
       'EM ACABAMENTO', 'EM ACABAMENTO / PENDENTE', 'EXPEDICAO', 'A RETIRAR', 'EM TRANSITO', 'ENTREGUE')
     or exists (select 1 from public.propostas_os_setores where id_int = v_prop.id_int)
     or exists (select 1 from public.producao_volumes where id_int = v_prop.id_int) then
    raise exception 'DEV_PRODUCAO: o pedido % já foi para a produção; retire-o da produção antes', v_prop.id_int;
  end if;
  if exists (select 1 from public.expedicoes where id_int = v_prop.id_int) then
    raise exception 'DEV_DESPACHO: o pedido % já tem despacho registrado', v_prop.id_int;
  end if;

  -- 10. E-Crédito consumido e não estornado.
  if exists (
    select 1 from public.movimento_credito
     where id_int = v_prop.id_int and tipo = 'DEBITO' and cancelado = false
  ) then
    raise exception 'DEV_CREDITO_CONSUMIDO: o pedido tem E-Crédito consumido e não estornado';
  end if;

  -- 11. Grava: devolução, cobrança, pedido, Histórico.
  insert into public.devolucoes_pagamento (
    id_pagamento, id_int, id_cliente, ref_cobranca, tipo_cobranca, valor,
    data_devolucao, e2e_id, comprovante, motivo, registrado_por, registrado_por_nome
  ) values (
    v_cob.id, v_prop.id_int, v_cob.id_cliente, v_ref, v_cob.tipo_cobranca, round(v_cob.valor::numeric, 2),
    p_data_devolucao, v_e2e, v_comprovante, v_motivo, v_uid, v_autor
  ) returning id into v_id_devolucao;

  update public.pagamentos_v2
     set status = 'CANCELADO',
         motivo_cancela = format('Devolvido ao cliente em %s por %s (devolução %s%s). Motivo: %s',
           to_char(p_data_devolucao, 'DD/MM/YYYY'), v_autor, v_id_devolucao,
           case when v_e2e is not null then ', e2eId ' || v_e2e else '' end, v_motivo)
   where id = v_cob.id and status = 'PAID';
  get diagnostics v_linhas = row_count;
  if v_linhas <> 1 then
    raise exception 'DEV_CONCORRENCIA: a cobrança % mudou durante o registro', v_ref;
  end if;

  update public.propostas
     set status_interno = 'CANCELADO'
   where id_int = v_prop.id_int;

  insert into public.propostas_chat (id_int, id_cliente, mensagem, tipo, autor_uid, autor_nome, setor, visivel_externo)
  values (
    v_prop.id_int, v_prop.id_cliente,
    format('Devolução registrada e pedido cancelado por %s. Cobrança %s (%s) de R$ %s devolvida ao cliente pelo banco em %s%s%s. Motivo: %s',
      v_autor, v_ref, v_cob.tipo_cobranca, to_char(v_cob.valor, 'FM999999990.00'),
      to_char(p_data_devolucao, 'DD/MM/YYYY'),
      case when v_e2e is not null then '. e2eId: ' || v_e2e else '' end,
      case when v_comprovante is not null then '. Comprovante: ' || v_comprovante else '' end,
      v_motivo),
    'SISTEMA', v_uid, v_autor, 'Financeiro', false
  );

  return jsonb_build_object(
    'ja_registrada', false,
    'id_devolucao', v_id_devolucao,
    'id_int', v_prop.id_int,
    'valor', round(v_cob.valor::numeric, 2),
    'ref_cobranca', v_ref
  );
end;
$function$;

revoke all on function public.fin_registrar_devolucao_e_cancelar(uuid, numeric, date, text, text, text, boolean) from public;
revoke all on function public.fin_registrar_devolucao_e_cancelar(uuid, numeric, date, text, text, text, boolean) from anon;
grant execute on function public.fin_registrar_devolucao_e_cancelar(uuid, numeric, date, text, text, text, boolean) to authenticated;
grant execute on function public.fin_registrar_devolucao_e_cancelar(uuid, numeric, date, text, text, text, boolean) to service_role;

comment on function public.fin_registrar_devolucao_e_cancelar(uuid, numeric, date, text, text, text, boolean) is
  'Registrar devolução e cancelar pedido: devolução feita pelo app do banco, só registrada aqui (valor total, e2eId ou comprovante, autor), cobrança e pedido cancelados, Histórico. Só super admin; idempotente por cobrança. 13/11/2026.';

-- Conferência do ACL depois de aplicar (esperado: authenticated, postgres, service_role; sem anon):
--   select array_agg(a.grantee::regrole::text order by 1) from pg_proc p, aclexplode(p.proacl) a
--    where p.oid = 'public.fin_registrar_devolucao_e_cancelar(uuid,numeric,date,text,text,text,boolean)'::regprocedure
--      and a.privilege_type = 'EXECUTE';
--   select grantee, array_agg(privilege_type order by 1) from information_schema.role_table_grants
--    where table_schema = 'public' and table_name = 'devolucoes_pagamento' group by 1;

-- ============================================================================
-- ROLLBACK (rodar só com autorização; apaga também as devoluções registradas —
-- confira antes: select count(*) from public.devolucoes_pagamento;).
-- Não desfaz cobranças e pedidos já cancelados por esta função.
--
-- drop function if exists public.fin_registrar_devolucao_e_cancelar(uuid, numeric, date, text, text, text, boolean);
-- drop table if exists public.devolucoes_pagamento;
-- ============================================================================
