-- ============================================================================
-- 20261117b_chave_pix_identificacao_opcional.sql
--
-- Chave Pix na troca de forma de pagamento: e2eId e comprovante passam a ser
-- opcionais (pedido do Everton, 17/11/2026). O financeiro nem sempre tem um
-- dos dois. Se informados, valem as mesmas validações: formato do e2eId
-- (32 letras e números) e recusa de e2eId ou comprovante já usado em cobrança
-- ativa. Data do pagamento e motivo continuam obrigatórios.
--
-- MUDANÇAS (só estas):
--   1. tabela recebimentos_chave_pix: sai a restrição
--      recebimentos_chave_pix_identificacao (e2e_id ou comprovante). A de
--      formato (recebimentos_chave_pix_e2e_formato) fica.
--   2. função fin_troca_criar_chave_pix: sai o bloco CHAVE_IDENTIFICACAO. O
--      resto do corpo é o de 20261117_troca_chave_pix.sql, igual.
--
-- ACL: CREATE OR REPLACE mantém o da função (postgres, authenticated,
-- service_role; sem anon/PUBLIC). Os revoke/grant abaixo só repetem o de 17/11.
-- ============================================================================

alter table public.recebimentos_chave_pix
  drop constraint if exists recebimentos_chave_pix_identificacao;

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
  'Troca de forma de pagamento para Chave Pix: cria a cobrança PIX já paga (forma_pgto CHAVE PIX) e o registro em recebimentos_chave_pix, numa transação. Só quem confirma pagamento (conferencia.confirm); exige a troca em andamento; e2eId e comprovante opcionais, sem repetir em cobrança ativa quando informados. 17/11/2026.';

-- ============================================================================
-- ROLLBACK (só com autorização; falha se já houver registro sem e2eId e sem
-- comprovante — confira antes:
--   select count(*) from public.recebimentos_chave_pix where e2e_id is null and nullif(btrim(comprovante), '') is null;)
--   1. rodar de novo o CREATE OR REPLACE da função de 20261117_troca_chave_pix.sql;
--   2. alter table public.recebimentos_chave_pix add constraint recebimentos_chave_pix_identificacao
--        check (e2e_id is not null or nullif(btrim(comprovante), '') is not null);
-- ============================================================================
