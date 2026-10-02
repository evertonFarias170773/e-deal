-- =============================================================================
-- cadastro_link_resolver — codigo de vendedor compartilhado
-- Autorizada pelo dono em 02/10/2026 (migration de cadastro_link_resolver).
--
-- PROBLEMA
--   Mais de um usuario pode ter o mesmo `usuarios.id_vendedor` (Edina Farias e
--   Edison Jr; Lisiane, Everton Farias e Everton Dev). A funcao buscava o
--   usuario do link com `where id_vendedor = ... limit 1`, sem ordem: pegava
--   uma linha qualquer e conferia os sinais so nela. Se a linha sorteada fosse
--   a de quem nao vende, o link respondia VENDEDOR_INDISPONIVEL mesmo havendo
--   outra pessoa do mesmo codigo que vende.
--
-- REGRA NOVA
--   O link vale quando ALGUM usuario daquele codigo passa nos mesmos sinais de
--   antes (is_vendedor = true, perfil diferente de pendente_aprovacao, nao
--   banido, nao excluido). O primeiro nome que sai e o desse usuario. Havendo
--   mais de um, a ordem e fixa: o dono do codigo (user_id = id_vendedor)
--   primeiro, depois por nome.
--
--   Token, revogacao, rate limit, formato da resposta e ACL nao mudam.
--
-- CONFERENCIA DO CORPO (quebras de linha LF)
--   vivo antes: 1c3a4b8a28bfb058f33f01303c18c78f — e o corpo de
--     20260907_cadastro_online_fila_e_token.sql SEM os comentarios (com eles o
--     arquivo da 0034e8c69dacbc770b6feb342e9adf90; a logica e a mesma, linha a
--     linha).
--   select md5(replace(prosrc, chr(13), '')) from pg_proc
--    where oid = 'public.cadastro_link_resolver(text)'::regprocedure;
-- =============================================================================

create or replace function public.cadastro_link_resolver(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_hash      text;
  v_link      record;
  v_usuario   record;
  v_janela    constant interval := interval '1 hour';
  v_teto      constant integer  := 20;
begin
  -- forma antes de tocar no banco
  if p_token is null or length(p_token) < 16 or length(p_token) > 128 then
    return jsonb_build_object('ok', false, 'motivo', 'TOKEN_INVALIDO');
  end if;

  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  select * into v_link from public.cadastro_links where token_hash = v_hash limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'TOKEN_INVALIDO');
  end if;

  -- trava a linha: serializa o rate limit e re-checa a revogacao pos-lock
  select * into v_link from public.cadastro_links where id = v_link.id for update;
  if v_link.revoked_at is not null then
    return jsonb_build_object('ok', false, 'motivo', 'TOKEN_INVALIDO');
  end if;

  -- rate limit por token, janela fixa
  if v_link.rl_janela_inicio is null or now() - v_link.rl_janela_inicio > v_janela then
    update public.cadastro_links
       set rl_janela_inicio = now(), rl_tentativas = 1
     where id = v_link.id;
  else
    if v_link.rl_tentativas >= v_teto then
      -- mesma mensagem do token invalido: nao se informa que ha limite
      return jsonb_build_object('ok', false, 'motivo', 'TOKEN_INVALIDO');
    end if;
    update public.cadastro_links
       set rl_tentativas = v_link.rl_tentativas + 1
     where id = v_link.id;
  end if;

  -- OS SINAIS de que o vendedor saiu, conferidos AGORA — em QUALQUER usuario do
  -- codigo, nao numa linha sorteada. Passa quem vende, nao esta pendente, nao
  -- esta banido e nao foi excluido. Ordem fixa: o dono do codigo primeiro.
  select u.user_id, u.nome_usuario, u.meu_vendedor
    into v_usuario
    from public.usuarios u
    left join public.perfis p on p.id = u.id_perfil
    left join auth.users  a on a.id = u.user_id
   where u.id_vendedor = v_link.id_vendedor
     and u.is_vendedor is true
     and p.slug is distinct from 'pendente_aprovacao'
     and (a.banned_until is null or a.banned_until <= now())
     and a.deleted_at is null
   order by (u.user_id = v_link.id_vendedor) desc, u.nome_usuario, u.user_id
   limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'VENDEDOR_INDISPONIVEL');
  end if;

  -- so o PRIMEIRO NOME sai daqui. Nunca id, e-mail ou documento do vendedor.
  return jsonb_build_object(
    'ok', true,
    'id_link', v_link.id,
    'id_vendedor', v_link.id_vendedor,
    'primeiro_nome', split_part(btrim(coalesce(v_usuario.meu_vendedor, v_usuario.nome_usuario, '')), ' ', 1)
  );
end;
$$;

-- A ACL nao muda com `create or replace`; confere mesmo assim.
do $$
declare
  v_grantees text;
begin
  select string_agg(a.grantee::regrole::text, ',' order by a.grantee::regrole::text)
    into v_grantees
    from pg_proc p, aclexplode(p.proacl) a
   where p.oid = 'public.cadastro_link_resolver(text)'::regprocedure;
  if v_grantees is distinct from 'postgres,service_role' then
    raise exception 'ABORTADO: ACL de cadastro_link_resolver e %, esperado postgres,service_role.', v_grantees;
  end if;
end $$;
