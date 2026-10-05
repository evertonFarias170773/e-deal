-- ============================================================================
-- NFS-e: a reserva da emissao vira funcao do banco (passo 2a do plano de 05/10)
-- ============================================================================
--
-- POR QUE
--   A rota `/api/fiscal/emitir-nfse` reservava a emissao com um UPDATE direto em
--   `notas_servico`, com o token do usuario. Para isso existir, a policy
--   `notas_servico_update_authenticated` (using true) deixa QUALQUER usuario
--   logado alterar qualquer nota de servico. Com a reserva nesta funcao, a rota
--   deixa de precisar do UPDATE direto e a policy pode sair (proxima migration).
--
-- O QUE A FUNCAO FAZ — a MESMA reserva da rota, sem mudar a semantica
--   1. confere `fiscal.emit_nfse` de quem chama, com `cc__assert_permissao`
--      (a mesma funcao da Conta Corrente), ANTES de qualquer escrita;
--   2. le o ambiente de `empresas.ambiente_nfse` da empresa da nota — nunca de
--      parametro. Ambiente fora de producao/homologacao e erro, nao palpite;
--   3. grava `tentativas_envio + 1`, `ambiente` e `updated_at`, e SO casa se o
--      `status` e o `tentativas_envio` ainda forem os que o chamador leu, e
--      `numero_nfse` e `codigo_verificacao` estiverem nulos (compare-and-swap);
--   4. devolve `reservada: true|false`. Repetir a chamada com os mesmos valores
--      lidos nao casa de novo: nao ha segunda reserva. A rota segue respondendo
--      "emissao em andamento" quando `reservada` e false.
--
--   So reserva nota em estado emitivel — a mesma lista fechada da rota
--   (PENDENTE, PRONTA_PARA_ENVIO, ERRO_VALIDACAO, ERRO_ENVIO, REJEITADA).
--   A recusa de PRODUCAO continua na rota (`AMBIENTE_SEM_CAMINHO`), antes de
--   chamar aqui.
--
-- AUTORIA
--   Decisao do dono (05/10/2026): sem coluna nova. O autor da reserva fica em
--   `audit.logs_v2`, pelo trigger `trg_audit_notas_servico`: a auditoria le o
--   usuario do token da sessao, e isso vale dentro de funcao SECURITY DEFINER
--   (provado em transacao desfeita antes desta migration).
--
-- QUEM EXECUTA
--   `authenticated` e `service_role`. Sem `anon` e sem PUBLIC. Chamada sem
--   usuario (service_role puro) e recusada pelo `cc__assert_permissao`.
--   ACL antes: a funcao nao existia.
--   ACL depois: postgres, authenticated, service_role (conferido abaixo).
--
-- ROLLBACK
--   drop function if exists public.fn_reservar_emissao_nfse(uuid, text, integer);
--   (so depois de a rota voltar ao UPDATE direto e de a policy
--    notas_servico_update_authenticated existir de novo)
-- ============================================================================

create function public.fn_reservar_emissao_nfse(
  p_id uuid,
  p_status_lido text,
  p_tentativas_lidas integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $funcao$
declare
  v_uid        uuid := auth.uid();
  v_empresa    bigint;
  v_ambiente   text;
  v_tentativas integer;
begin
  -- 1. Permissao, antes de qualquer escrita.
  perform public.cc__assert_permissao(v_uid, 'fiscal.emit_nfse');

  if p_id is null or p_status_lido is null or p_tentativas_lidas is null then
    raise exception 'NFSE_RESERVA_PARAMS: id, status lido e tentativas lidas sao obrigatorios';
  end if;

  -- So estado emitivel: a mesma lista fechada da rota.
  if p_status_lido not in ('PENDENTE', 'PRONTA_PARA_ENVIO', 'ERRO_VALIDACAO', 'ERRO_ENVIO', 'REJEITADA') then
    return jsonb_build_object('reservada', false, 'motivo', 'STATUS_NAO_ENVIAVEL');
  end if;

  select n.id_empresa into v_empresa from public.notas_servico n where n.id = p_id;
  if not found then
    return jsonb_build_object('reservada', false, 'motivo', 'NOTA_NAO_ENCONTRADA');
  end if;

  -- 2. O ambiente sai da empresa, lido aqui — nunca do chamador.
  select lower(btrim(e.ambiente_nfse)) into v_ambiente from public.empresas e where e.id = v_empresa;
  if v_ambiente is null or v_ambiente not in ('producao', 'homologacao') then
    raise exception 'NFSE_AMBIENTE_INDEFINIDO: a empresa da nota nao tem ambiente de NFS-e definido (producao ou homologacao)';
  end if;

  -- 3. A reserva: compare-and-swap, igual ao UPDATE que a rota fazia.
  update public.notas_servico n
     set tentativas_envio = p_tentativas_lidas + 1,
         ambiente = v_ambiente,
         updated_at = now()
   where n.id = p_id
     and n.status = p_status_lido
     and n.tentativas_envio = p_tentativas_lidas
     and n.numero_nfse is null
     and n.codigo_verificacao is null
  returning n.tentativas_envio into v_tentativas;

  -- 4. Nao casou: outra chamada ja reservou, ou a nota mudou. Nada foi escrito.
  if not found then
    return jsonb_build_object('reservada', false, 'motivo', 'NAO_CASOU');
  end if;

  return jsonb_build_object(
    'reservada', true,
    'id', p_id,
    'tentativas_envio', v_tentativas,
    'ambiente', v_ambiente
  );
end;
$funcao$;

comment on function public.fn_reservar_emissao_nfse(uuid, text, integer) is
  'Reserva a emissao de uma NFS-e (compare-and-swap em tentativas_envio e status). Confere fiscal.emit_nfse de quem chama; le o ambiente de empresas.ambiente_nfse. Chamada so por /api/fiscal/emitir-nfse. Criada em 05/10/2026.';

revoke all on function public.fn_reservar_emissao_nfse(uuid, text, integer) from public, anon;
grant execute on function public.fn_reservar_emissao_nfse(uuid, text, integer) to authenticated, service_role;

do $conferencia$
declare
  v_acl text[];
begin
  select array_agg(coalesce(nullif(a.grantee::regrole::text, '-'), 'PUBLIC') || ':' || a.privilege_type
                   order by coalesce(nullif(a.grantee::regrole::text, '-'), 'PUBLIC'))
    into v_acl
    from pg_proc p, aclexplode(p.proacl) a
   where p.oid = 'public.fn_reservar_emissao_nfse(uuid, text, integer)'::regprocedure;

  if v_acl is distinct from array['authenticated:EXECUTE', 'postgres:EXECUTE', 'service_role:EXECUTE'] then
    raise exception 'ACL inesperado em fn_reservar_emissao_nfse: %', v_acl;
  end if;
  if has_function_privilege('anon', 'public.fn_reservar_emissao_nfse(uuid, text, integer)', 'EXECUTE') then
    raise exception 'anon ainda executa fn_reservar_emissao_nfse';
  end if;
  if not (select p.prosecdef and p.proconfig::text = '{search_path=public}'
            from pg_proc p where p.oid = 'public.fn_reservar_emissao_nfse(uuid, text, integer)'::regprocedure) then
    raise exception 'fn_reservar_emissao_nfse nao ficou SECURITY DEFINER com search_path=public';
  end if;
  raise notice 'ok: fn_reservar_emissao_nfse criada; ACL %', v_acl;
end
$conferencia$;
