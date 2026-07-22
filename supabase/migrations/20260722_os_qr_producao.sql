-- ============================================================================
-- 20260722_os_qr_producao.sql
--
-- Fluxo público de avanço de status de produção via QR Code impresso na OS.
-- Página pública /os (sem login) + token opaco (somente hash no banco) +
-- RPCs SECURITY DEFINER como única via de leitura/escrita.
--
-- ⚠️ MIGRATION VERSIONADA E **NÃO APLICADA**.
--    Não executar em produção sem autorização explícita.
--    O código correspondente só ativa o fluxo quando OS_QR_PUBLICO_ENABLED=true,
--    OS_QR_TOKEN_SECRET configurado E esta migration aplicada.
--
-- Segurança (ver MATRIZ-SEGURANCA-ESCRITA-SUPABASE.md, seção "QR de Produção"):
--   - os_qr_tokens e os_status_log: RLS habilitada SEM NENHUMA policy —
--     todo acesso passa pelas funções SECURITY DEFINER;
--   - token em claro jamais persiste: apenas sha256(token) (derivação HMAC
--     acontece exclusivamente no backend Next com OS_QR_TOKEN_SECRET);
--   - os_qr_finalizar (emissão/rotação): EXECUTE somente para service_role
--     (backend confiável), com permissão+escopo revalidados para p_actor_uid;
--   - os_qr_preparar: EXECUTE para authenticated; permissão+escopo internos;
--   - os_qr_consultar/os_qr_avancar: EXECUTE para anon+authenticated (página
--     pública), validação integral dentro da função;
--   - ORDEM ÚNICA DE BLOQUEIO por OS (anti-deadlock, emissão/rotação/avanço):
--     1º public.propostas FOR UPDATE (por id_int); 2º public.os_qr_tokens;
--   - transições permitidas (matriz embutida, nunca regride/salta):
--     EM PRODUCAO → EM IMPRESSAO → EM ACABAMENTO → EXPEDICAO;
--   - trilha imutável em os_status_log + mensagem SISTEMA em propostas_chat.
-- ============================================================================

create extension if not exists pgcrypto;
create extension if not exists unaccent;

-- ── Tabelas ──────────────────────────────────────────────────────────────────

create table if not exists public.os_qr_tokens (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  id_int bigint not null,
  versao int not null default 1,
  -- sha256 hex do token derivado por HMAC no backend; o token em claro nunca chega ao banco
  token_hash text not null unique,
  created_by uuid,
  revoked_at timestamptz,
  revoked_by uuid,
  last_used_at timestamptz,
  uso_count int not null default 0,
  -- Rate limit persistente por token (janela fixa, serializada por FOR UPDATE)
  rl_janela_inicio timestamptz,
  rl_tentativas int not null default 0,
  unique (id_int, versao)
);

comment on table public.os_qr_tokens is
  'Tokens públicos (somente hash) do QR de produção da OS. 1 ativo por OS; revogação por revoked_at (nunca DELETE).';

-- 1 token ativo por OS
create unique index if not exists uidx_os_qr_tokens_ativo
  on public.os_qr_tokens (id_int)
  where revoked_at is null;

create table if not exists public.os_status_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  id_int bigint not null,
  status_anterior text not null,
  status_novo text, -- null quando a tentativa foi negada
  resultado text not null check (resultado in ('sucesso', 'conflito', 'fora_do_fluxo', 'finalizado', 'cancelada')),
  motivo text,
  origem text not null default 'qr_producao',
  ator_tipo text not null default 'qr_producao',
  ator_uid uuid,   -- null no fluxo QR anônimo (v1)
  ator_nome text,  -- extensão futura de identificação simples (v1 sempre null)
  token_id bigint references public.os_qr_tokens (id),
  ip_hash text,
  user_agent text
);

comment on table public.os_status_log is
  'Trilha imutável de tentativas e transições de status de produção via QR (FLUXO-OFICIAL §11). Escrita somente via RPC.';

create index if not exists idx_os_status_log_id_int
  on public.os_status_log (id_int, created_at desc);

-- ── RLS: habilitada SEM policies (acesso exclusivo via SECURITY DEFINER) ─────

alter table public.os_qr_tokens enable row level security;
alter table public.os_status_log enable row level security;
-- Nenhuma policy criada de propósito: nem SELECT amplo, nem escrita direta.

-- ── Helpers internos (sem GRANT a papéis da app) ─────────────────────────────

-- Espelha verificarPermissaoServerSide (src/lib/auth/verificar-permissao.ts):
-- super_adm → true; perfil ativo → '*' ou chave exata; fallback is_admin SÓ sem perfil.
create or replace function public.osqr__has_permissao(p_uid uuid, p_perm text)
returns boolean
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_usuario record;
  v_permissoes jsonb;
begin
  if p_uid is null then
    return false;
  end if;

  select id_perfil, is_super_adm, is_admin
    into v_usuario
    from public.usuarios
   where user_id = p_uid
   limit 1;

  if not found then
    return false;
  end if;

  if coalesce(v_usuario.is_super_adm, false) then
    return true;
  end if;

  if v_usuario.id_perfil is not null then
    select to_jsonb(permissoes)
      into v_permissoes
      from public.perfis
     where id = v_usuario.id_perfil
       and ativo = true
     limit 1;

    if v_permissoes is not null then
      return v_permissoes ? '*' or v_permissoes ? p_perm;
    end if;
  end if;

  return coalesce(v_usuario.is_admin, false);
end;
$$;

create or replace function public.osqr__assert_permissao_any(p_uid uuid, p_perms text[])
returns void
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_perm text;
begin
  foreach v_perm in array p_perms loop
    if public.osqr__has_permissao(p_uid, v_perm) then
      return;
    end if;
  end loop;
  raise exception 'OSQR_SEM_PERMISSAO' using errcode = '42501';
end;
$$;

-- Espelha verificarEscopoPropostaServerSide (src/lib/auth/verificar-escopo-proposta.ts):
-- super_adm → ok; '*'/propostas.view_all → ok; view_company → empresa do usuário;
-- view_team/view_own → vendedor = nome_usuario; ausência de escopo → NEGA.
create or replace function public.osqr__assert_escopo(p_uid uuid, p_id_int bigint)
returns void
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_usuario record;
  v_permissoes jsonb := '[]'::jsonb;
  v_proposta record;
  v_empresa_usuario text;
begin
  if p_uid is null then
    raise exception 'OSQR_SEM_ESCOPO' using errcode = '42501';
  end if;

  select id_perfil, is_super_adm, id_empresa, nome_usuario
    into v_usuario
    from public.usuarios
   where user_id = p_uid
   limit 1;

  if not found then
    raise exception 'OSQR_SEM_ESCOPO' using errcode = '42501';
  end if;

  if coalesce(v_usuario.is_super_adm, false) then
    return;
  end if;

  if v_usuario.id_perfil is not null then
    select coalesce(to_jsonb(permissoes), '[]'::jsonb)
      into v_permissoes
      from public.perfis
     where id = v_usuario.id_perfil
       and ativo = true
     limit 1;
  end if;

  if v_permissoes ? '*' or v_permissoes ? 'propostas.view_all' then
    return;
  end if;

  select empresa, vendedor
    into v_proposta
    from public.propostas
   where id_int = p_id_int
   limit 1;

  if not found then
    raise exception 'OSQR_PROPOSTA_INEXISTENTE' using errcode = 'P0002';
  end if;

  if v_permissoes ? 'propostas.view_company' then
    if v_proposta.empresa is null or v_usuario.id_empresa is null then
      raise exception 'OSQR_SEM_ESCOPO' using errcode = '42501';
    end if;
    select empresa into v_empresa_usuario
      from public.empresas
     where id = v_usuario.id_empresa
     limit 1;
    if v_empresa_usuario is null
       or lower(unaccent(trim(v_proposta.empresa))) <> lower(unaccent(trim(v_empresa_usuario))) then
      raise exception 'OSQR_SEM_ESCOPO' using errcode = '42501';
    end if;
    return;
  end if;

  if v_permissoes ? 'propostas.view_team' or v_permissoes ? 'propostas.view_own' then
    if v_proposta.vendedor is null or v_usuario.nome_usuario is null
       or lower(unaccent(trim(v_proposta.vendedor))) <> lower(unaccent(trim(v_usuario.nome_usuario))) then
      raise exception 'OSQR_SEM_ESCOPO' using errcode = '42501';
    end if;
    return;
  end if;

  raise exception 'OSQR_SEM_ESCOPO' using errcode = '42501';
end;
$$;

-- Mensagem SISTEMA na timeline da proposta (mesma família do Chat Interno).
create or replace function public.osqr__timeline(p_id_int bigint, p_msg text)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  insert into public.propostas_chat (id_int, mensagem, tipo, autor_uid, autor_nome, setor, visivel_externo)
  values (p_id_int, p_msg, 'SISTEMA', null, 'QR Produção', 'PRODUCAO', false);
exception when others then
  -- Timeline é best-effort DENTRO do log de erro, mas nunca deve derrubar a transição:
  -- registra aviso e segue (a trilha oficial é os_status_log, gravada pelo chamador).
  raise warning 'osqr__timeline falhou para id_int=%: %', p_id_int, sqlerrm;
end;
$$;

-- Próximo status permitido (matriz embutida do fluxo QR).
create or replace function public.osqr__proximo_status(p_status text)
returns text
language sql immutable
as $$
  select case p_status
    when 'EM PRODUCAO'   then 'EM IMPRESSAO'
    when 'EM IMPRESSAO'  then 'EM ACABAMENTO'
    when 'EM ACABAMENTO' then 'EXPEDICAO'
    else null
  end;
$$;

-- ── RPC pública de leitura (página /os) ──────────────────────────────────────

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

  v_hash := encode(digest(p_token, 'sha256'), 'hex');

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

  -- Resumo mínimo do produto (nunca dados financeiros/cliente completo)
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

-- ── RPC pública de escrita (única via de avanço) ─────────────────────────────

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

  v_hash := encode(digest(p_token, 'sha256'), 'hex');

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

  -- Checagem otimista: cobre duplo clique, duas abas e mudança interna concorrente.
  if v_status <> trim(coalesce(p_status_atual_esperado, '')) then
    insert into public.os_status_log (id_int, status_anterior, status_novo, resultado, motivo, token_id, ip_hash, user_agent)
    values (v_tok.id_int, v_status, null, 'conflito',
            'Esperado [' || coalesce(p_status_atual_esperado, '') || '], atual [' || v_status || ']',
            v_tok.id, p_ip_hash, left(p_user_agent, 200));
    return jsonb_build_object('ok', false, 'motivo', 'CONFLITO', 'id_int', v_tok.id_int,
                              'status_atual', v_status, 'proximo_status', v_proximo);
  end if;

  -- Transição atômica (linha já lockada).
  update public.propostas
     set status_interno = v_proximo
   where id_int = v_tok.id_int;

  insert into public.os_status_log (id_int, status_anterior, status_novo, resultado, origem, ator_tipo, token_id, ip_hash, user_agent)
  values (v_tok.id_int, v_status, v_proximo, 'sucesso', 'qr_producao', 'qr_producao', v_tok.id, p_ip_hash, left(p_user_agent, 200));

  perform public.osqr__timeline(
    v_tok.id_int,
    'Status alterado de [' || v_status || '] para [' || v_proximo || '] via QR Code de produção (origem qr_producao).'
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

-- ── RPC autenticada de consulta/preparação (emissão e rotação) ───────────────

create or replace function public.os_qr_preparar(p_id_int bigint)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_ativo record;
  v_max_versao int;
begin
  perform public.osqr__assert_permissao_any(auth.uid(), array['pedidos.print_os', 'pedidos.qr_rotacionar']);
  perform public.osqr__assert_escopo(auth.uid(), p_id_int);

  select versao, token_hash
    into v_ativo
    from public.os_qr_tokens
   where id_int = p_id_int
     and revoked_at is null
   limit 1;

  select coalesce(max(versao), 0) into v_max_versao
    from public.os_qr_tokens
   where id_int = p_id_int;

  return jsonb_build_object(
    'ok', true,
    'versao_ativa', case when v_ativo.versao is null then null else v_ativo.versao end,
    'token_hash_ativo', v_ativo.token_hash,
    'proxima_versao', v_max_versao + 1
  );
end;
$$;

-- ── RPC de finalização (SOMENTE backend confiável / service_role) ────────────

create or replace function public.os_qr_finalizar(
  p_actor_uid uuid,
  p_operacao text,
  p_id_int bigint,
  p_versao_esperada int,
  p_nova_versao int,
  p_novo_token_hash text
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_ativo record;
  v_max_versao int;
begin
  if p_operacao not in ('emitir', 'rotacionar') then
    raise exception 'OSQR_OPERACAO_INVALIDA';
  end if;
  if p_novo_token_hash is null or length(p_novo_token_hash) <> 64 then
    raise exception 'OSQR_HASH_INVALIDO';
  end if;

  -- Permissão + escopo revalidados para o ator informado pelo backend confiável.
  if p_operacao = 'emitir' then
    perform public.osqr__assert_permissao_any(p_actor_uid, array['pedidos.print_os']);
  else
    perform public.osqr__assert_permissao_any(p_actor_uid, array['pedidos.qr_rotacionar']);
  end if;
  perform public.osqr__assert_escopo(p_actor_uid, p_id_int);

  -- ORDEM ÚNICA DE BLOQUEIO: 1º proposta (âncora da OS)…
  perform 1 from public.propostas where id_int = p_id_int for update;
  if not found then
    raise exception 'OSQR_PROPOSTA_INEXISTENTE' using errcode = 'P0002';
  end if;

  -- …2º token ativo (se houver).
  select id, versao, token_hash
    into v_ativo
    from public.os_qr_tokens
   where id_int = p_id_int
     and revoked_at is null
     for update;

  select coalesce(max(versao), 0) into v_max_versao
    from public.os_qr_tokens
   where id_int = p_id_int;

  -- Conferência da versão esperada. Perder a corrida = CONFLITO controlado:
  -- NENHUMA versão adicional é criada e o token ativo existente é mantido.
  if p_operacao = 'emitir' then
    if v_ativo.id is not null or p_versao_esperada <> 0 or p_nova_versao <> v_max_versao + 1 then
      return jsonb_build_object('ok', false, 'motivo', 'CONFLITO',
        'versao_ativa', v_ativo.versao, 'token_hash_ativo', v_ativo.token_hash,
        'proxima_versao', v_max_versao + 1);
    end if;
    insert into public.os_qr_tokens (id_int, versao, token_hash, created_by)
    values (p_id_int, p_nova_versao, p_novo_token_hash, p_actor_uid);
    return jsonb_build_object('ok', true, 'versao', p_nova_versao);
  end if;

  -- rotacionar
  if v_ativo.id is null or v_ativo.versao <> p_versao_esperada or p_nova_versao <> v_max_versao + 1 then
    return jsonb_build_object('ok', false, 'motivo', 'CONFLITO',
      'versao_ativa', v_ativo.versao, 'token_hash_ativo', v_ativo.token_hash,
      'proxima_versao', v_max_versao + 1);
  end if;

  update public.os_qr_tokens
     set revoked_at = now(), revoked_by = p_actor_uid
   where id = v_ativo.id;

  insert into public.os_qr_tokens (id_int, versao, token_hash, created_by)
  values (p_id_int, p_nova_versao, p_novo_token_hash, p_actor_uid);

  return jsonb_build_object('ok', true, 'versao', p_nova_versao);
end;
$$;

-- ── Grants (default EXECUTE de PUBLIC é revogado explicitamente) ─────────────

revoke all on function public.osqr__has_permissao(uuid, text) from public;
revoke all on function public.osqr__assert_permissao_any(uuid, text[]) from public;
revoke all on function public.osqr__assert_escopo(uuid, bigint) from public;
revoke all on function public.osqr__timeline(bigint, text) from public;
revoke all on function public.osqr__proximo_status(text) from public;

revoke all on function public.os_qr_consultar(text) from public;
grant execute on function public.os_qr_consultar(text) to anon, authenticated;

revoke all on function public.os_qr_avancar(text, text, text, text) from public;
grant execute on function public.os_qr_avancar(text, text, text, text) to anon, authenticated;

revoke all on function public.os_qr_preparar(bigint) from public;
grant execute on function public.os_qr_preparar(bigint) to authenticated;

revoke all on function public.os_qr_finalizar(uuid, text, bigint, int, int, text) from public;
grant execute on function public.os_qr_finalizar(uuid, text, bigint, int, int, text) to service_role;
