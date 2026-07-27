-- ============================================================================
-- 20260724_os_qr_motivo_opcional.sql
--
-- PATCH do fluxo QR multi-status (20260723_os_qr_multi_status.sql, já aplicada).
--
-- Regra nova (23/07/2026): o motivo deixa de ser OBRIGATÓRIO em salto, retorno,
-- pausa (/ PENDENTE) e troca lateral de entrega. O campo permanece disponível e
-- OPCIONAL — quando informado, continua registrado em os_status_log.motivo e na
-- timeline. Nada mais muda: matriz de status, naturais sugeridos, token,
-- concorrência, destino permitido, rate limit e auditoria seguem idênticos.
--
-- Mudanças:
--   1. osqr__classificar_transicao: todo exige_motivo passa a false
--      (o campo é mantido no retorno para compatibilidade do payload da UI);
--   2. os_qr_transicionar: removido o bloqueio MOTIVO_OBRIGATORIO.
--
-- CREATE OR REPLACE preserva os grants aplicados em 20260723_os_qr_multi_status.
-- ============================================================================

create or replace function public.osqr__classificar_transicao(p_de text, p_para text, p_forma text)
returns jsonb
language plpgsql immutable
as $$
declare
  v_ord_de int := public.osqr__ordinal(p_de);
  v_ord_para int := public.osqr__ordinal(p_para);
begin
  if v_ord_de is null or v_ord_para is null or p_para = p_de then
    return jsonb_build_object('permitida', false, 'tipo', null, 'exige_motivo', null);
  end if;

  -- Pausa: etapa base → seu / PENDENTE (motivo opcional).
  if (p_de = 'EM IMPRESSAO'  and p_para = 'EM IMPRESSAO / PENDENTE')
     or (p_de = 'EM ACABAMENTO' and p_para = 'EM ACABAMENTO / PENDENTE') then
    return jsonb_build_object('permitida', true, 'tipo', 'pausa', 'exige_motivo', false);
  end if;

  -- Retomada: / PENDENTE → etapa base (transição natural da pausa).
  if (p_de = 'EM IMPRESSAO / PENDENTE'  and p_para = 'EM IMPRESSAO')
     or (p_de = 'EM ACABAMENTO / PENDENTE' and p_para = 'EM ACABAMENTO') then
    return jsonb_build_object('permitida', true, 'tipo', 'retomada', 'exige_motivo', false);
  end if;

  -- Naturais lineares da produção.
  if (p_de = 'EM PRODUCAO'   and p_para = 'EM IMPRESSAO')
     or (p_de = 'EM IMPRESSAO'  and p_para = 'EM ACABAMENTO')
     or (p_de = 'EM ACABAMENTO' and p_para = 'EXPEDICAO') then
    return jsonb_build_object('permitida', true, 'tipo', 'natural', 'exige_motivo', false);
  end if;

  -- EXPEDICAO → entrega: natural conforme a forma registrada;
  -- destino divergente ou forma indefinida seguem permitidos (motivo opcional).
  if p_de = 'EXPEDICAO' and p_para in ('A RETIRAR', 'EM TRANSITO') then
    if (p_forma = 'retirada' and p_para = 'A RETIRAR')
       or (p_forma = 'transporte' and p_para = 'EM TRANSITO') then
      return jsonb_build_object('permitida', true, 'tipo', 'natural', 'exige_motivo', false);
    else
      return jsonb_build_object('permitida', true, 'tipo', 'avanco_entrega', 'exige_motivo', false);
    end if;
  end if;

  -- Entrega → ENTREGUE: natural (a UI sempre aplica confirmação reforçada).
  if p_para = 'ENTREGUE' and p_de in ('A RETIRAR', 'EM TRANSITO') then
    return jsonb_build_object('permitida', true, 'tipo', 'natural', 'exige_motivo', false);
  end if;

  -- Lateral: troca do método de entrega já iniciado (motivo opcional).
  if (p_de = 'A RETIRAR' and p_para = 'EM TRANSITO')
     or (p_de = 'EM TRANSITO' and p_para = 'A RETIRAR') then
    return jsonb_build_object('permitida', true, 'tipo', 'lateral', 'exige_motivo', false);
  end if;

  -- Retorno: qualquer regressão na cadeia (motivo opcional).
  if v_ord_para < v_ord_de then
    return jsonb_build_object('permitida', true, 'tipo', 'retorno', 'exige_motivo', false);
  end if;

  -- Resto: salto (motivo opcional).
  return jsonb_build_object('permitida', true, 'tipo', 'salto', 'exige_motivo', false);
end;
$$;

create or replace function public.os_qr_transicionar(
  p_token text,
  p_status_atual_esperado text,
  p_status_destino text,
  p_motivo text default null,
  p_ip_hash text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_hash text;
  v_tok record;
  v_status text;
  v_destino text;
  v_forma text;
  v_cls jsonb;
  v_motivo text;
begin
  if p_token is null or length(p_token) < 32 or length(p_token) > 128 then
    return jsonb_build_object('ok', false, 'motivo', 'TOKEN_INVALIDO');
  end if;

  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  -- Passo 1: resolve o token SEM lock (apenas para descobrir a OS).
  select id, id_int, revoked_at
    into v_tok
    from public.os_qr_tokens
   where token_hash = v_hash
   limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'TOKEN_INVALIDO');
  end if;

  if v_tok.revoked_at is not null then
    return jsonb_build_object('ok', false, 'motivo', 'TOKEN_REVOGADO');
  end if;

  -- Passo 2: ORDEM ÚNICA DE BLOQUEIO — 1º proposta (âncora da OS)…
  select trim(coalesce(status_interno, '')) into v_status
    from public.propostas
   where id_int = v_tok.id_int
     for update;

  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'TOKEN_INVALIDO');
  end if;

  -- …2º linha do token (re-verifica revogação pós-lock e serializa rate limit).
  select id, id_int, revoked_at, rl_janela_inicio, rl_tentativas
    into v_tok
    from public.os_qr_tokens
   where token_hash = v_hash
     for update;

  if v_tok.revoked_at is not null then
    return jsonb_build_object('ok', false, 'motivo', 'TOKEN_REVOGADO');
  end if;

  -- Rate limit persistente por token: janela fixa 60s, máx. 10 tentativas.
  if v_tok.rl_janela_inicio is null or now() - v_tok.rl_janela_inicio > interval '60 seconds' then
    update public.os_qr_tokens
       set rl_janela_inicio = now(), rl_tentativas = 1
     where id = v_tok.id;
  else
    update public.os_qr_tokens
       set rl_tentativas = rl_tentativas + 1
     where id = v_tok.id;
    if v_tok.rl_tentativas + 1 > 10 then
      return jsonb_build_object('ok', false, 'motivo', 'RATE_LIMITED');
    end if;
  end if;

  -- Classificação do estado atual.
  if v_status = 'CANCELADO' then
    insert into public.os_status_log (id_int, status_anterior, status_novo, resultado, motivo, token_id, ip_hash, user_agent)
    values (v_tok.id_int, v_status, null, 'cancelada', 'OS cancelada', v_tok.id, p_ip_hash, left(p_user_agent, 200));
    return jsonb_build_object('ok', false, 'motivo', 'CANCELADA', 'id_int', v_tok.id_int, 'status_atual', v_status);
  end if;

  -- ENTREGUE é terminal — nenhuma transição posterior via QR.
  if v_status = 'ENTREGUE' then
    insert into public.os_status_log (id_int, status_anterior, status_novo, resultado, motivo, token_id, ip_hash, user_agent)
    values (v_tok.id_int, v_status, null, 'finalizado', 'Entrega concluída — fluxo encerrado', v_tok.id, p_ip_hash, left(p_user_agent, 200));
    return jsonb_build_object('ok', false, 'motivo', 'FINALIZADO', 'id_int', v_tok.id_int, 'status_atual', v_status);
  end if;

  if v_status <> all (public.osqr__status_qr()) then
    insert into public.os_status_log (id_int, status_anterior, status_novo, resultado, motivo, token_id, ip_hash, user_agent)
    values (v_tok.id_int, v_status, null, 'fora_do_fluxo', 'Status fora da matriz do QR', v_tok.id, p_ip_hash, left(p_user_agent, 200));
    return jsonb_build_object('ok', false, 'motivo', 'FORA_DO_FLUXO', 'id_int', v_tok.id_int, 'status_atual', v_status);
  end if;

  -- Destino: nunca confiar na lista do frontend.
  v_destino := trim(coalesce(p_status_destino, ''));
  if v_destino = '' or v_destino = v_status or v_destino <> all (public.osqr__status_qr()) then
    return jsonb_build_object('ok', false, 'motivo', 'DESTINO_INVALIDO', 'id_int', v_tok.id_int, 'status_atual', v_status);
  end if;

  -- Checagem otimista: cobre duplo clique, duas abas e mudança interna concorrente.
  if v_status <> trim(coalesce(p_status_atual_esperado, '')) then
    insert into public.os_status_log (id_int, status_anterior, status_novo, resultado, motivo, token_id, ip_hash, user_agent)
    values (v_tok.id_int, v_status, null, 'conflito',
            'Esperado [' || coalesce(p_status_atual_esperado, '') || '], atual [' || v_status || ']',
            v_tok.id, p_ip_hash, left(p_user_agent, 200));
    return jsonb_build_object('ok', false, 'motivo', 'CONFLITO', 'id_int', v_tok.id_int, 'status_atual', v_status);
  end if;

  v_forma := public.osqr__forma_entrega(v_tok.id_int);
  v_cls := public.osqr__classificar_transicao(v_status, v_destino, v_forma);

  if not (v_cls->>'permitida')::boolean then
    return jsonb_build_object('ok', false, 'motivo', 'DESTINO_INVALIDO', 'id_int', v_tok.id_int, 'status_atual', v_status);
  end if;

  -- Motivo OPCIONAL (patch 20260724): registrado quando informado, nunca exigido.
  v_motivo := nullif(left(trim(coalesce(p_motivo, '')), 300), '');

  -- Transição atômica (linha já lockada).
  update public.propostas
     set status_interno = v_destino
   where id_int = v_tok.id_int;

  insert into public.os_status_log (id_int, status_anterior, status_novo, resultado, motivo, tipo_transicao, origem, ator_tipo, token_id, ip_hash, user_agent)
  values (v_tok.id_int, v_status, v_destino, 'sucesso', v_motivo, v_cls->>'tipo', 'qr_producao', 'qr_producao', v_tok.id, p_ip_hash, left(p_user_agent, 200));

  perform public.osqr__timeline(
    v_tok.id_int,
    'Status alterado de [' || v_status || '] para [' || v_destino || '] via QR Code de produção'
      || ' (' || (v_cls->>'tipo') || case when v_motivo is null then '' else '; motivo: ' || v_motivo end || ').'
  );

  update public.os_qr_tokens
     set last_used_at = now(), uso_count = uso_count + 1
   where id = v_tok.id;

  return jsonb_build_object('ok', true, 'id_int', v_tok.id_int,
                            'status_anterior', v_status, 'status_novo', v_destino,
                            'tipo_transicao', v_cls->>'tipo',
                            'finalizado', v_destino = 'ENTREGUE');
end;
$$;
