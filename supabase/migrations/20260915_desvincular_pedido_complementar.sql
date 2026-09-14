-- Pedido complementar, Etapa E8 — RPC `desvincular_pedido_complementar`
--
-- Plano: docs/superpowers/plans/2026-09-13-pedido-complementar.md (secao 4.3)
-- Regra: docs/business/PEDIDO-COMPLEMENTAR.md (secoes 7 e 8)
-- Depende de: 20260914_pedido_complementar_vinculo_e_ledger.sql (E1),
--             20260915_complementar_aplicar_frete.sql (E6)
--
-- O QUE E
--   Desfaz (ou encerra) o vinculo de um PEDIDO COMPLEMENTAR com o principal,
--   numa transacao: carimba `desvinculado_*` em todas as linhas do ledger
--   `complementos_frete` ainda sem carimbo, opcionalmente limpa
--   `propostas.id_int_pedido_principal` do complemento e grava uma mensagem de
--   chat em cada um dos dois pedidos. Devolve um jsonb com o que fez.
--
-- QUEM CHAMA, E COMO
--   - Expedicao, no override "Desvincular e despachar separado":
--     `p_origem = 'EXPEDICAO'`, `p_limpar_vinculo = true`. O original sai sozinho
--     e o complemento vira pedido comum, que precisa de frete proprio.
--   - Cancelamento do complemento (rota `cancelar-proposta`):
--     `p_origem = 'COMERCIAL'`, `p_limpar_vinculo = false`. O vinculo fica como
--     historico; o ledger e carimbado para o frete aplicado deixar de valer.
--
-- PERMISSAO POR ORIGEM
--   EXPEDICAO -> `expedicao.processar`.
--   COMERCIAL -> `propostas.complementar` OU `propostas.cancel` (decisao 11 do
--   dono). `cc__assert_permissao` nao devolve booleano: LEVANTA excecao com
--   ERRCODE 42501 (conferido no banco em 13/09/2026). A alternativa e feita
--   testando a primeira dentro de um bloco `BEGIN ... EXCEPTION WHEN
--   insufficient_privilege` e so entao exigindo a segunda — sem reescrever a
--   regra de permissao aqui dentro.
--
-- "FRETE A RECOTAR" E ESTADO DERIVADO, NAO ESCRITA
--   A linha vigente do ledger com `desvinculado_em` preenchido e o que diz que o
--   frete complementar nao vale mais (`frete-status` responde
--   `FRETE_COMPLEMENTAR_INVALIDADO`). Nada mais precisa ser gravado para isso.
--
-- O QUE ESTA MIGRATION NAO FAZ — e o motivo do primeiro item
--   NAO apaga nem altera `cotacao_frete` do complemento. O DELETE dispararia
--   `trg_frete_sync_financeiro`, e com o complemento em LIBERADO (status nao
--   protegido) `atualizar_status_financeiro_proposta` o rebaixaria.
--   NAO toca `cotacao_frete` nem `propostas` do PRINCIPAL (so o chat dele).
--   NAO altera trigger, funcao existente, view nem RLS.
--   NAO despacha, nao cancela e nao muda status de ninguem.
--   NAO concede `propostas.complementar` a perfil nenhum (E10).
--
-- GATES
--   1. motivo obrigatorio (`COMPL_DESV_MOTIVO`)
--   2. origem EXPEDICAO ou COMERCIAL (`COMPL_DESV_ORIGEM`)
--   3. permissao pela origem (acima)
--   4. complemento existe, sob `FOR UPDATE` (`COMPL_DESV_COMPLEMENTO`)
--   5. tem vinculo (`COMPL_DESV_VINCULO`)
--
-- VERIFICACAO (rodar depois de aplicar)
--
-- a) Funcao:
--    SELECT prosecdef, proconfig, pg_get_function_result(oid)
--      FROM pg_proc WHERE proname = 'desvincular_pedido_complementar';
--    Esperado: true; {search_path=public, pg_temp}; jsonb.
--
-- b) Quem executa:
--    SELECT r.rolname, has_function_privilege(r.oid,
--      'public.desvincular_pedido_complementar(bigint,text,text,boolean)', 'EXECUTE')
--      FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role');
--    Esperado: anon false; authenticated true.
--
-- c) Depois de desvincular de verdade:
--    SELECT id, desvinculado_em, desvinculado_motivo, desvinculado_origem
--      FROM public.complementos_frete WHERE id_int_complemento = <Y>;   -- todas carimbadas
--    SELECT id_int_pedido_principal FROM public.propostas WHERE id_int = <Y>;  -- NULL (limpar = true)
--    SELECT id, valor, peso FROM public.cotacao_frete WHERE id_int = <Y>;      -- MESMA linha de antes
--
-- d) Triggers de `cotacao_frete` e `propostas` inalterados: comparar
--    md5(pg_get_triggerdef) e md5(pg_get_functiondef) com o retrato de antes.
--
-- ROLLBACK
--   DROP FUNCTION public.desvincular_pedido_complementar(bigint,text,text,boolean);
--   Nao desfaz desvinculacao ja feita: o carimbo no ledger e o vinculo limpo
--   continuam como estao.

create or replace function public.desvincular_pedido_complementar(
  p_id_int_complemento bigint,
  p_motivo             text,
  p_origem             text,
  p_limpar_vinculo     boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid           uuid := auth.uid();
  v_origem        text := upper(coalesce(btrim(p_origem), ''));
  v_motivo        text := btrim(coalesce(p_motivo, ''));
  v_compl         public.propostas%rowtype;
  v_id_principal  bigint;
  v_autor_nome    text;
  v_autor_email   text;
  v_carimbadas    integer := 0;
  v_limpou        boolean := false;
  v_setor         text;
  v_texto_compl   text;
  v_texto_princ   text;
begin
  -- 1. motivo
  if v_motivo = '' then
    raise exception 'COMPL_DESV_MOTIVO: informe o motivo para desvincular o pedido complementar';
  end if;

  -- 2. origem
  if v_origem not in ('EXPEDICAO', 'COMERCIAL') then
    raise exception 'COMPL_DESV_ORIGEM: origem "%" invalida; use EXPEDICAO ou COMERCIAL', coalesce(p_origem, '');
  end if;

  -- 3. permissao pela origem
  if v_origem = 'EXPEDICAO' then
    perform public.cc__assert_permissao(v_uid, 'expedicao.processar');
  else
    begin
      perform public.cc__assert_permissao(v_uid, 'propostas.complementar');
    exception when insufficient_privilege then
      perform public.cc__assert_permissao(v_uid, 'propostas.cancel');
    end;
  end if;

  -- 4. complemento
  select * into v_compl from public.propostas where id_int = p_id_int_complemento for update;
  if not found then
    raise exception 'COMPL_DESV_COMPLEMENTO: proposta #% nao encontrada', p_id_int_complemento;
  end if;

  -- 5. vinculo
  v_id_principal := v_compl.id_int_pedido_principal;
  if v_id_principal is null then
    raise exception 'COMPL_DESV_VINCULO: a proposta #% nao esta vinculada a um pedido principal', p_id_int_complemento;
  end if;

  select u.nome_usuario, u.email into v_autor_nome, v_autor_email
    from public.usuarios u where u.user_id = v_uid;

  -- o ledger: todas as linhas ainda sem carimbo
  update public.complementos_frete
     set desvinculado_em       = now(),
         desvinculado_por_uid  = v_uid,
         desvinculado_por_nome = v_autor_nome,
         desvinculado_motivo   = v_motivo,
         desvinculado_origem   = v_origem
   where id_int_complemento = p_id_int_complemento
     and desvinculado_em is null;
  get diagnostics v_carimbadas = row_count;

  -- o vinculo, quando pedido. `cotacao_frete` do complemento NAO e tocada.
  if coalesce(p_limpar_vinculo, true) then
    update public.propostas
       set id_int_pedido_principal = null
     where id_int = p_id_int_complemento;
    v_limpou := true;
  end if;

  -- chat nos dois pedidos
  v_setor := case when v_origem = 'EXPEDICAO' then 'EXPEDICAO' else 'Comercial' end;
  if v_limpou then
    v_texto_compl := format(
      'Pedido complementar DESVINCULADO do #%s (%s). Motivo: %s. Este pedido passou a ser independente e precisa de frete proprio: o frete complementar aplicado nao vale mais. A cotacao atual foi mantida so como referencia.',
      v_id_principal, case when v_origem = 'EXPEDICAO' then 'despacho separado na Expedicao' else 'area comercial' end, v_motivo);
    v_texto_princ := format(
      'O pedido complementar #%s foi desvinculado deste pedido (%s). Motivo: %s. Os dois nao saem mais juntos.',
      p_id_int_complemento, case when v_origem = 'EXPEDICAO' then 'despacho separado na Expedicao' else 'area comercial' end, v_motivo);
  else
    v_texto_compl := format(
      'Frete complementar deste pedido invalidado (%s). Motivo: %s. O registro de vinculo com o #%s foi mantido como historico.',
      case when v_origem = 'EXPEDICAO' then 'Expedicao' else 'area comercial' end, v_motivo, v_id_principal);
    v_texto_princ := format(
      'O pedido complementar #%s deixou de valer para este pedido (%s). Motivo: %s.',
      p_id_int_complemento, case when v_origem = 'EXPEDICAO' then 'Expedicao' else 'area comercial' end, v_motivo);
  end if;

  insert into public.propostas_chat (id_int, id_cliente, mensagem, tipo, setor, autor_uid, autor_nome, autor_email, visivel_externo)
  values
    (p_id_int_complemento, v_compl.id_cliente, v_texto_compl, 'SISTEMA', v_setor, v_uid, coalesce(v_autor_nome, 'Sistema'), v_autor_email, false),
    (v_id_principal,       v_compl.id_cliente, v_texto_princ, 'SISTEMA', v_setor, v_uid, coalesce(v_autor_nome, 'Sistema'), v_autor_email, false);

  return jsonb_build_object(
    'id_int_complemento', p_id_int_complemento,
    'id_int_principal', v_id_principal,
    'origem', v_origem,
    'linhas_ledger_carimbadas', v_carimbadas,
    'vinculo_limpo', v_limpou
  );
end;
$$;

comment on function public.desvincular_pedido_complementar(bigint,text,text,boolean) is
  'Pedido complementar, E8. Desvincula o complemento do principal: carimba desvinculado_* no ledger complementos_frete, limpa id_int_pedido_principal quando pedido e grava chat nos dois. Permissao por origem (EXPEDICAO: expedicao.processar; COMERCIAL: propostas.complementar ou propostas.cancel). NAO toca cotacao_frete de ninguem.';

revoke execute on function public.desvincular_pedido_complementar(bigint,text,text,boolean) from public;
grant execute on function public.desvincular_pedido_complementar(bigint,text,text,boolean) to authenticated;
