-- Trocar forma de pagamento para E-Crédito: devolver o crédito quando a troca
-- não se conclui (10/11/2026, caso 24574).
--
-- A troca (rota /api/cobrancas/trocar-forma-pagamento) cria a cobrança
-- E-CREDITO, consome o crédito do cliente nela (cc_usar_pendencia e/ou
-- mc_usar_credito_avulso, como em /api/cobrancas/usar-credito) e só depois
-- cancela o PIX no banco. Se o banco não confirma, a troca é desfeita: esta
-- função devolve o crédito e cancela a E-CREDITO, numa transação só.
--
-- Por que não mc_estornar_uso_pedido: ela recusa pedido com nota autorizada
-- (justamente o caso da troca, nota antecipada), exige ADM e não aceita uso
-- vindo de pendência.
--
-- Regras:
-- - permissão: credito.usar, a mesma de quem consome o crédito;
-- - só a cobrança E-CREDITO criada pela troca do PIX informado: mesma
--   proposta, mesmo cliente, mesmo valor, descrição "(troca da <PIX>)", e o
--   PIX ainda com a marca "TROCA EM ANDAMENTO" e não cancelado (troca
--   concluída não se desfaz);
-- - devolve exatamente os usos ligados a essa cobrança (movimento_credito com
--   id_pagamento_destino = a cobrança, USO_PEDIDO, DEBITO), um CRÉDITO de
--   estorno por uso, com id_movimento_ref; uso de pendência devolve também o
--   saldo da pendência. Nunca toca outro uso de crédito do cliente;
-- - aceita nota autorizada (não olha nota fiscal);
-- - idempotente: uso que já tem estorno não é devolvido de novo; com tudo
--   devolvido e a cobrança cancelada, devolve ja_desfeito = true sem gravar;
-- - registra autor e o vínculo das cobranças no Histórico (propostas_chat).
--
-- Retorno: jsonb { ja_desfeito, devolvido, movimentos }.

create or replace function public.mc_desfazer_credito_da_troca(
  p_id_pagamento uuid,
  p_id_pagamento_antiga uuid,
  p_motivo text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_nova public.pagamentos_v2%rowtype;
  v_antiga public.pagamentos_v2%rowtype;
  v_pend public.conta_corrente_pendencias%rowtype;
  v_uso public.movimento_credito%rowtype;
  v_ref_antiga text;
  v_ref_nova text;
  v_consumido numeric;
  v_a_devolver integer;
  v_devolvido numeric := 0;
  v_movimentos bigint[] := '{}';
  v_mov bigint;
  v_novo_saldo numeric;
  v_autor text;
  v_linhas integer;
begin
  perform public.cc__assert_permissao(v_uid, 'credito.usar');

  if p_id_pagamento is null or p_id_pagamento_antiga is null then
    raise exception 'MC_PARAMS: informe a cobrança E-CREDITO e o PIX da troca';
  end if;
  if length(v_motivo) < 5 then
    raise exception 'MC_PARAMS: descreva o motivo (mínimo 5 caracteres)';
  end if;

  -- 1. As duas cobranças, travadas até o fim.
  select * into v_nova from public.pagamentos_v2 where id = p_id_pagamento for update;
  if not found then
    raise exception 'MC_NAOENCONTRADO: cobrança % não encontrada', p_id_pagamento;
  end if;
  perform public.cc__assert_escopo_empresa(v_uid, v_nova.id_int);

  if upper(replace(btrim(coalesce(v_nova.tipo_cobranca, '')), '_', '-')) <> 'E-CREDITO' then
    raise exception 'MC_TIPO: só cobrança E-CREDITO usa esta devolução';
  end if;

  select * into v_antiga from public.pagamentos_v2 where id = p_id_pagamento_antiga for update;
  if not found then
    raise exception 'MC_NAOENCONTRADO: cobrança % não encontrada', p_id_pagamento_antiga;
  end if;

  v_ref_antiga := coalesce(nullif(btrim(v_antiga.id_pagamento), ''), v_antiga.id::text);
  v_ref_nova := coalesce(nullif(btrim(v_nova.id_pagamento), ''), v_nova.id::text);

  -- 2. Vínculo com a troca: a E-CREDITO nasceu da troca deste PIX.
  if v_antiga.id = v_nova.id
     or v_antiga.id_int is distinct from v_nova.id_int
     or v_antiga.id_cliente is distinct from v_nova.id_cliente
     or round(coalesce(v_antiga.valor, 0), 2) <> round(coalesce(v_nova.valor, 0), 2)
     or position(format('(troca da %s)', v_ref_antiga) in coalesce(v_nova.descricao, '')) = 0 then
    raise exception 'MC_TROCA: a cobrança % não foi criada pela troca do PIX %', v_ref_nova, v_ref_antiga;
  end if;

  -- 3. Os usos desta cobrança, travados.
  perform 1 from public.movimento_credito
   where id_pagamento_destino = v_nova.id and tipo_evento = 'USO_PEDIDO'
   for update;

  select coalesce(sum(u.valor), 0) into v_consumido
    from public.movimento_credito u
   where u.id_pagamento_destino = v_nova.id
     and u.tipo_evento = 'USO_PEDIDO'
     and upper(u.tipo) = 'DEBITO'
     and u.cancelado = false;

  select count(*) into v_a_devolver
    from public.movimento_credito u
   where u.id_pagamento_destino = v_nova.id
     and u.tipo_evento = 'USO_PEDIDO'
     and upper(u.tipo) = 'DEBITO'
     and u.cancelado = false
     and not exists (
       select 1 from public.movimento_credito e
        where e.id_movimento_ref = u.id and e.tipo_evento = 'ESTORNO'
     );

  -- 4. Repetição: tudo devolvido e a cobrança já cancelada.
  if v_a_devolver = 0 and v_nova.status = 'CANCELADO' then
    return jsonb_build_object('ja_desfeito', true, 'devolvido', 0, 'movimentos', '[]'::jsonb);
  end if;

  -- 5. Travas: a troca está em andamento e a E-CREDITO ainda não foi conferida.
  if coalesce(v_antiga.motivo_troca, '') not like 'TROCA EM ANDAMENTO%' then
    raise exception 'MC_TROCA: o PIX % não tem troca de forma de pagamento em andamento', v_ref_antiga;
  end if;
  if v_antiga.status = 'CANCELADO' then
    raise exception 'MC_TROCA: o PIX % já foi cancelado; a troca foi concluída e não se desfaz', v_ref_antiga;
  end if;
  if v_nova.status not in ('PAID', 'CANCELADO') then
    raise exception 'MC_STATUS: a cobrança % está %', v_ref_nova, coalesce(v_nova.status, 'sem status');
  end if;
  if coalesce(v_nova.confirmado, false) then
    raise exception 'MC_CONFIRMADA: a cobrança % já foi conferida. Conferência manual.', v_ref_nova;
  end if;
  if round(v_consumido, 2) > round(coalesce(v_nova.valor, 0), 2) then
    raise exception 'MC_VALOR: a cobrança % consumiu R$ % de crédito, mais que o valor dela. Conferência manual.', v_ref_nova, v_consumido;
  end if;

  select coalesce(nullif(btrim(nome_usuario), ''), 'Usuário') into v_autor
    from public.usuarios where user_id = v_uid;

  -- 6. Devolve cada uso ainda sem estorno.
  for v_uso in
    select u.* from public.movimento_credito u
     where u.id_pagamento_destino = v_nova.id
       and u.tipo_evento = 'USO_PEDIDO'
       and upper(u.tipo) = 'DEBITO'
       and u.cancelado = false
       and not exists (
         select 1 from public.movimento_credito e
          where e.id_movimento_ref = u.id and e.tipo_evento = 'ESTORNO'
       )
     order by u.id
  loop
    if v_uso.id_pendencia is not null then
      select * into v_pend from public.conta_corrente_pendencias where id = v_uso.id_pendencia for update;
      if not found or v_pend.direcao <> 'FAVOR_CLIENTE' or v_pend.status = 'CANCELADA' then
        raise exception 'MC_PENDENCIA: a pendência % do uso #% não aceita a devolução. Conferência manual.', v_uso.id_pendencia, v_uso.id;
      end if;
      v_novo_saldo := round(v_pend.valor_saldo + v_uso.valor, 2);
      update public.conta_corrente_pendencias
         set valor_saldo = v_novo_saldo,
             status = public.cc__status(valor_original, v_novo_saldo, valor_reservado),
             atualizado_em = now()
       where id = v_pend.id;
    end if;

    insert into public.movimento_credito (
      id_cliente, id_int, valor, tipo, origem, observacao, created_by,
      id_pendencia, tipo_evento, id_int_origem, id_movimento_ref, motivo_evento
    ) values (
      v_uso.id_cliente, v_uso.id_int, v_uso.valor, 'CREDITO', 'SISTEMA',
      format('Devolução do uso de crédito #%s: troca de forma de pagamento não concluída (cobrança %s, PIX %s), por %s. Motivo: %s',
             v_uso.id, v_ref_nova, v_ref_antiga, v_autor, v_motivo),
      v_uid, v_uso.id_pendencia, 'ESTORNO', v_uso.id_int, v_uso.id, 'ESTORNO_USO_PEDIDO'
    )
    returning id into v_mov;

    v_movimentos := v_movimentos || v_mov;
    v_devolvido := v_devolvido + v_uso.valor;
  end loop;

  -- 7. A E-CREDITO sai.
  if v_nova.status <> 'CANCELADO' then
    update public.pagamentos_v2
       set status = 'CANCELADO',
           motivo_cancela = format('%s Crédito de R$ %s devolvido ao saldo do cliente por %s (movimentos %s).',
                                   v_motivo, to_char(v_devolvido, 'FM999999990.00'), v_autor, array_to_string(v_movimentos, ', '))
     where id = v_nova.id
       and status = v_nova.status;
    get diagnostics v_linhas = row_count;
    if v_linhas <> 1 then
      raise exception 'MC_CONCORRENCIA: a cobrança % mudou durante a devolução', v_ref_nova;
    end if;
  end if;

  -- 8. Histórico: autor e as duas cobranças.
  insert into public.propostas_chat (id_int, id_cliente, mensagem, tipo, autor_uid, autor_nome, setor, visivel_externo)
  values (
    v_nova.id_int, v_nova.id_cliente,
    format('Crédito de R$ %s devolvido ao saldo do cliente por %s: a troca de forma de pagamento do PIX %s não foi concluída e a cobrança %s (E-CREDITO) foi cancelada (movimentos %s). Motivo: %s',
           to_char(v_devolvido, 'FM999999990.00'), v_autor, v_ref_antiga, v_ref_nova,
           coalesce(nullif(array_to_string(v_movimentos, ', '), ''), 'nenhum'), v_motivo),
    'SISTEMA', v_uid, v_autor, 'Financeiro', false
  );

  return jsonb_build_object('ja_desfeito', false, 'devolvido', v_devolvido, 'movimentos', to_jsonb(v_movimentos));
end;
$function$;

revoke all on function public.mc_desfazer_credito_da_troca(uuid, uuid, text) from public;
revoke all on function public.mc_desfazer_credito_da_troca(uuid, uuid, text) from anon;
grant execute on function public.mc_desfazer_credito_da_troca(uuid, uuid, text) to authenticated;
grant execute on function public.mc_desfazer_credito_da_troca(uuid, uuid, text) to service_role;

comment on function public.mc_desfazer_credito_da_troca(uuid, uuid, text) is
  'Troca de forma de pagamento para E-Crédito não concluída: devolve exatamente o crédito consumido pela cobrança E-CREDITO da troca e a cancela. credito.usar; idempotente; aceita nota autorizada. 10/11/2026.';
