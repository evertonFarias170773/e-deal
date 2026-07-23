-- ============================================================================
-- 20260723_os_qr_digest_fix.sql
--
-- PATCH do fluxo QR de produção (20260722_os_qr_producao.sql).
--
-- Causa raiz: no Supabase o pgcrypto vive no schema `extensions`; com
-- `SET search_path = public, pg_temp`, `digest()` não é resolvido (42883) —
-- os_qr_consultar e os_qr_avancar falhavam SEMPRE (toda leitura pública do QR
-- retornava ERRO_INTERNO, mascarado no client antigo como "QR Code inválido").
-- os_qr_finalizar/os_qr_preparar não usam digest (hash calculado no backend) —
-- por isso emissão/rotação funcionavam.
--
-- Correção: qualificar `extensions.digest(...)` nas duas funções.
-- CREATE OR REPLACE preserva os grants aplicados em 20260723_os_qr_grants_fix.
-- (unaccent está em `public` neste banco — inalterado.)
-- ============================================================================

create or replace function public.os_qr_consultar(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_hash text;
  v_tok record;
  v_status text;
  v_proximo text;
  v_produto record;
  v_qtd_itens int;
  v_resumo text;
begin
  if p_token is null or length(p_token) < 32 or length(p_token) > 128 then
    return jsonb_build_object('ok', false, 'motivo', 'TOKEN_INVALIDO');
  end if;

  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

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

  select status_interno into v_status
    from public.propostas
   where id_int = v_tok.id_int
   limit 1;

  v_status := coalesce(trim(v_status), '');

  select nome_produto, qtd into v_produto
    from public.produtos_proposta
   where id_int = v_tok.id_int
   order by id
   limit 1;

  select count(*) into v_qtd_itens
    from public.produtos_proposta
   where id_int = v_tok.id_int;

  v_resumo := coalesce(v_produto.nome_produto, 'Produto');
  if coalesce(v_produto.qtd, 0) > 0 then
    v_resumo := v_resumo || ' — ' || v_produto.qtd::text || ' un';
  end if;
  if v_qtd_itens > 1 then
    v_resumo := v_resumo || ' (+' || (v_qtd_itens - 1)::text || ' itens)';
  end if;

  if v_status = 'CANCELADO' then
    return jsonb_build_object('ok', false, 'motivo', 'CANCELADA', 'id_int', v_tok.id_int, 'status_atual', v_status);
  end if;

  if v_status in ('EXPEDICAO', 'A RETIRAR', 'EM TRANSITO', 'ENTREGUE') then
    return jsonb_build_object('ok', false, 'motivo', 'FINALIZADO', 'id_int', v_tok.id_int,
                              'produto_resumo', v_resumo, 'status_atual', v_status);
  end if;

  v_proximo := public.osqr__proximo_status(v_status);
  if v_proximo is null then
    return jsonb_build_object('ok', false, 'motivo', 'FORA_DO_FLUXO', 'id_int', v_tok.id_int,
                              'produto_resumo', v_resumo, 'status_atual', v_status);
  end if;

  return jsonb_build_object('ok', true, 'id_int', v_tok.id_int, 'produto_resumo', v_resumo,
                            'status_atual', v_status, 'proximo_status', v_proximo);
end;
$$;

create or replace function public.os_qr_avancar(
  p_token text,
  p_status_atual_esperado text,
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
  v_proximo text;
begin
  if p_token is null or length(p_token) < 32 or length(p_token) > 128 then
    return jsonb_build_object('ok', false, 'motivo', 'TOKEN_INVALIDO');
  end if;

  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

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

  -- ORDEM ÚNICA DE BLOQUEIO — 1º proposta (âncora da OS)…
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

  if v_status = 'CANCELADO' then
    insert into public.os_status_log (id_int, status_anterior, status_novo, resultado, motivo, token_id, ip_hash, user_agent)
    values (v_tok.id_int, v_status, null, 'cancelada', 'OS cancelada', v_tok.id, p_ip_hash, left(p_user_agent, 200));
    return jsonb_build_object('ok', false, 'motivo', 'CANCELADA', 'id_int', v_tok.id_int, 'status_atual', v_status);
  end if;

  if v_status in ('EXPEDICAO', 'A RETIRAR', 'EM TRANSITO', 'ENTREGUE') then
    insert into public.os_status_log (id_int, status_anterior, status_novo, resultado, motivo, token_id, ip_hash, user_agent)
    values (v_tok.id_int, v_status, null, 'finalizado', 'Fluxo de produção concluído', v_tok.id, p_ip_hash, left(p_user_agent, 200));
    return jsonb_build_object('ok', false, 'motivo', 'FINALIZADO', 'id_int', v_tok.id_int, 'status_atual', v_status);
  end if;

  v_proximo := public.osqr__proximo_status(v_status);
  if v_proximo is null then
    insert into public.os_status_log (id_int, status_anterior, status_novo, resultado, motivo, token_id, ip_hash, user_agent)
    values (v_tok.id_int, v_status, null, 'fora_do_fluxo', 'Status fora da matriz do QR', v_tok.id, p_ip_hash, left(p_user_agent, 200));
    return jsonb_build_object('ok', false, 'motivo', 'FORA_DO_FLUXO', 'id_int', v_tok.id_int, 'status_atual', v_status);
  end if;

  if v_status <> trim(coalesce(p_status_atual_esperado, '')) then
    insert into public.os_status_log (id_int, status_anterior, status_novo, resultado, motivo, token_id, ip_hash, user_agent)
    values (v_tok.id_int, v_status, null, 'conflito',
            'Esperado [' || coalesce(p_status_atual_esperado, '') || '], atual [' || v_status || ']',
            v_tok.id, p_ip_hash, left(p_user_agent, 200));
    return jsonb_build_object('ok', false, 'motivo', 'CONFLITO', 'id_int', v_tok.id_int,
                              'status_atual', v_status, 'proximo_status', v_proximo);
  end if;

  update public.propostas
     set status_interno = v_proximo
   where id_int = v_tok.id_int;

  insert into public.os_status_log (id_int, status_anterior, status_novo, resultado, origem, ator_tipo, token_id, ip_hash, user_agent)
  values (v_tok.id_int, v_status, v_proximo, 'sucesso', 'qr_producao', 'qr_producao', v_tok.id, p_ip_hash, left(p_user_agent, 200));

  perform public.osqr__timeline(
    v_tok.id_int,
    'Status alterado de [' || v_status || '] para [' || v_proximo || '] via QR Code de producao (origem qr_producao).'
  );

  update public.os_qr_tokens
     set last_used_at = now(), uso_count = uso_count + 1
   where id = v_tok.id;

  return jsonb_build_object('ok', true, 'id_int', v_tok.id_int,
                            'status_anterior', v_status, 'status_novo', v_proximo,
                            'proximo_status', public.osqr__proximo_status(v_proximo),
                            'finalizado', public.osqr__proximo_status(v_proximo) is null);
end;
$$;
