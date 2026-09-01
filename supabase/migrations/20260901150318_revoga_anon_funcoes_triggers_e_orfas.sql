-- =====================================================================
-- Tira o EXECUTE anonimo de 38 funcoes SECURITY DEFINER
-- (24 trigger functions + 14 sem chamador algum)
-- =====================================================================
--
-- O QUE
-- -----
-- `REVOKE EXECUTE ... FROM public, anon` em 38 das 70 funcoes SECURITY DEFINER
-- do schema `public` que hoje sao chamaveis por `anon`.
--
-- **FROM public, anon**, nao so `FROM anon`. As 38 tem EXECUTE por DOIS
-- caminhos ao mesmo tempo: grant nominal a `anon` E heranca de PUBLIC (`-` no
-- aclexplode). Revogar so do `anon` deixaria o PUBLIC concedendo — a funcao
-- continuaria aberta e o REVOKE pareceria ter funcionado.
--
-- POR QUE — a exposicao esta PROVADA, nao suposta
-- -----------------------------------------------
-- `SECURITY DEFINER` roda com os privilegios do DONO, entao atravessa qualquer
-- GRANT de tabela. O REVOKE de `anon` em `clientes` e `enderecos` (93e0a9b)
-- fechou a porta da frente e deixou estas janelas abertas.
--
-- Medido em 01/09/2026 com a anon key do `.env.local`, DEPOIS daquele revoke:
--
--   POST /rest/v1/rpc/gerar_texto_whatsapp {"p_id_int": 21330}
--     -> HTTP 200, texto com o NOME DO CLIENTE e os valores do pedido
--
--   POST /rest/v1/rpc/get_resumo_pagamento_por_proposta {"p_id_int": 21330}
--     -> HTTP 200
--        {"total_lancado":779.00,"total_pago":779.00,"total_em_aberto":34.80,
--         "credito":0,"status_financeiro":"A_RECEBER","id_cliente":27401}
--
--   No mesmo instante: GET /rest/v1/clientes -> 401 permission denied.
--
-- As duas recebem `id_int`, um INTEIRO SEQUENCIAL. Um laco de 1 a 21400 varre a
-- base inteira de propostas, com nome de cliente e situacao financeira, sem
-- sessao. E o que esta migration fecha.
--
-- POR QUE AS 24 TRIGGER FUNCTIONS SAO GRANT INUTIL
-- ------------------------------------------------
-- O PostgreSQL NAO verifica EXECUTE do usuario que dispara um trigger: a funcao
-- e chamada pelo executor como parte do comando, nao pelo chamador. Conceder
-- EXECUTE de trigger function a `anon` e `PUBLIC` nao habilita nada — so amplia
-- a superficie de quem pode invoca-la DIRETAMENTE por RPC, que e exatamente o
-- que nao se quer. Revogar nao muda o disparo de nenhum trigger.
--
-- AS 14 SEM CHAMADOR
-- ------------------
-- Zero referencias em `src/` e nos 89 workflows do n8n. Conferido tambem contra
-- o proprio banco: nenhuma e usada como trigger (`pg_trigger`) nem por view
-- (`pg_views`).
--
-- TRES delas SAO chamadas por outra funcao, e isso NAO as quebra:
--
--   fn_alertas_nfse        <- fn_preparar_envio_nfse   (SECURITY DEFINER, dono postgres)
--   fn_montar_payload_nfse <- fn_preparar_envio_nfse   (SECURITY DEFINER, dono postgres)
--   gerar_texto_whatsapp   <- trigger_texto_whatsapp_proposta           (SECURITY INVOKER)
--                          <- trigger_atualizar_texto_whatsapp_por_produto (SECURITY INVOKER)
--
-- Nas duas primeiras o chamador e SECURITY DEFINER de `postgres`: roda como
-- `postgres`, que tem EXECUTE, entao a cadeia segue. `fn_preparar_envio_nfse` e
-- uma das 3 do Focus e NAO e tocada aqui.
--
-- As duas ultimas sao SECURITY INVOKER — rodam como QUEM escreve. Por isso a
-- checagem abaixo importa: TODAS as 38 tem grant NOMINAL para `authenticated` e
-- `service_role`, alem do PUBLIC. Revogar PUBLIC e anon nao encosta neles, e a
-- gravacao de proposta pelo app (authenticated) e pelo n8n (service_role)
-- continua disparando `gerar_texto_whatsapp` normalmente.
--
-- EFEITO COLATERAL ACEITO
-- -----------------------
-- Escrita ANONIMA em `public.propostas` que dispare esses dois triggers passa a
-- falhar por falta de EXECUTE. `propostas` ainda tem grants para `anon` — nao e
-- escopo deste bloco —, mas escrita anonima em proposta nunca foi fluxo
-- legitimo. O efeito e desejado, e fica registrado para nao ser lido como bug.
--
-- O QUE ESTA MIGRATION NAO TOCA
-- -----------------------------
-- * `os_qr_consultar`, `os_qr_avancar`, `os_qr_transicionar` — o fluxo publico
--   do QR de producao PRECISA de EXECUTE para anon;
-- * `fn_preparar_envio_nfe`, `fn_preparar_envio_nfse`, `fn_salvar_retorno_focus_nfe`
--   — os 6 nos ativos do Focus NFe/NFSe hoje chamam com a chave `anon` LITERAL.
--   Revogar antes de trocar a credencial desses nos para service_role quebraria
--   a emissao de nota;
-- * as 9 chamadas por tela autenticada (fn_analise_credito_cliente,
--   rpc_dashboard_executivo, fn_montar_payload_nfe, fn_alertas_nfe,
--   fn_trocar_empresa_nfe, fn_gerar_pagamentos_nfe, copiar_proposta_v2,
--   fn_recalcular_totais_nfe, update_permissoes_perfil) — bloco seguinte;
-- * o default privilege do schema `public`, que e o que reconcede a cada
--   CREATE FUNCTION — enquanto ele nao mudar, funcao nova nasce aberta;
-- * grants de `authenticated`, `service_role` e `postgres`;
-- * nenhuma tabela, policy, RLS, trigger ou linha.
-- =====================================================================

-- ------------------------------------------------------------------
-- 1. ASSERCOES DE ENTRADA
-- ------------------------------------------------------------------
do $entrada$
declare
  v_total integer;
  v_auth  integer;
begin
  select count(*), count(*) filter (where has_function_privilege('authenticated', p.oid,'EXECUTE'))
    into v_total, v_auth
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f' and p.prosecdef
    and has_function_privilege('anon', p.oid,'EXECUTE')
    and (pg_get_function_result(p.oid)='trigger'
         or p.proname in ('gerar_texto_whatsapp','gerar_texto_whatsapp_e_salvar','get_resumo_pagamento_por_proposta',
                          'purge_propostas_aguardando','salvar_pagamento_v2_por_view','aplicar_credito_da_view',
                          'duplicar_proposta','publicar_fundo_do_pwa','fn_montar_payload_nfse','fn_alertas_nfse',
                          'link_cliente_abrir','link_cliente_pedido','link_cliente_status','link_cliente_visto'));

  if v_total <> 38 then
    raise exception 'ABORTADO: esperava 38 funcoes alcancaveis por anon, encontrei %. O estado divergiu do levantamento de 01/09/2026.', v_total;
  end if;

  if v_auth <> 38 then
    raise exception 'ABORTADO: apenas % das 38 tem EXECUTE para authenticated. Revogar PUBLIC derrubaria o app junto — parar.', v_auth;
  end if;

  raise notice 'Entrada OK: 38 funcoes alcancaveis por anon, todas com EXECUTE nominal para authenticated.';
end
$entrada$;

-- ------------------------------------------------------------------
-- 2. AS 24 TRIGGER FUNCTIONS
-- ------------------------------------------------------------------
revoke execute on function public.calcular_valor_sub_total() from public, anon;
revoke execute on function public.delete_usuario_from_auth() from public, anon;
revoke execute on function public.fn_autopreencher_fiscal_nfe_item() from public, anon;
revoke execute on function public.fn_defaults_rascunho_nfe() from public, anon;
revoke execute on function public.fn_nfe_normalizar_destinatario_cpf() from public, anon;
revoke execute on function public.fn_preencher_peso_unitario_nfe_item() from public, anon;
revoke execute on function public.fn_recalcular_peso_nfe_por_itens() from public, anon;
revoke execute on function public.fn_recalcular_totais_nfe_por_itens() from public, anon;
revoke execute on function public.fn_resetar_status_nfe_ao_editar() from public, anon;
revoke execute on function public.fn_resetar_status_nfe_por_tabela_filha() from public, anon;
revoke execute on function public.fn_sync_natureza_operacao_nfe() from public, anon;
revoke execute on function public.fn_trigger_renumerar_itens_nfe() from public, anon;
revoke execute on function public.handle_new_auth_user() from public, anon;
revoke execute on function public.handle_new_user() from public, anon;
revoke execute on function public.propostas_preencher_valor_total_avulsa() from public, anon;
revoke execute on function public.recalcular_proposta_v4_trigger() from public, anon;
revoke execute on function public.sync_status_arte_to_briefing() from public, anon;
revoke execute on function public.sync_usuario_from_auth() from public, anon;
revoke execute on function public.tg_nfse_normalizar_recalcular_biu() from public, anon;
revoke execute on function public.tg_recalc_financeiro_por_produto() from public, anon;
revoke execute on function public.trg_recalcular_totais_nfe_cabecalho() from public, anon;
revoke execute on function public.trg_recalcular_totais_nfe_itens() from public, anon;
revoke execute on function public.trg_sync_artes_to_proposta_func() from public, anon;
revoke execute on function public.trg_sync_financeiro_to_proposta_func() from public, anon;

-- ------------------------------------------------------------------
-- 3. AS 14 SEM CHAMADOR
--    As duas primeiras da lista de exposicao provada sao
--    `gerar_texto_whatsapp` e `get_resumo_pagamento_por_proposta`.
-- ------------------------------------------------------------------
revoke execute on function public.aplicar_credito_da_view(p_id_int bigint) from public, anon;
revoke execute on function public.duplicar_proposta(p_id_int_origem bigint) from public, anon;
revoke execute on function public.fn_alertas_nfse(p_ref text) from public, anon;
revoke execute on function public.fn_montar_payload_nfse(p_ref text) from public, anon;
revoke execute on function public.gerar_texto_whatsapp(p_id_int bigint) from public, anon;
revoke execute on function public.gerar_texto_whatsapp_e_salvar(p_id_int bigint) from public, anon;
revoke execute on function public.get_resumo_pagamento_por_proposta(p_id_int bigint) from public, anon;
revoke execute on function public.link_cliente_abrir(p_numero text, p_token text) from public, anon;
revoke execute on function public.link_cliente_pedido(p_numero text, p_token text) from public, anon;
revoke execute on function public.link_cliente_status(p_numero text, p_token text, p_status text) from public, anon;
revoke execute on function public.link_cliente_visto(p_numero text, p_token text) from public, anon;
revoke execute on function public.publicar_fundo_do_pwa(p_arquivo text, p_veu numeric, p_enquadramento text, p_versao text, p_por text) from public, anon;
revoke execute on function public.purge_propostas_aguardando() from public, anon;
revoke execute on function public.salvar_pagamento_v2_por_view(p_id_int integer) from public, anon;

-- ------------------------------------------------------------------
-- 4. ASSERCOES DE SAIDA
-- ------------------------------------------------------------------
do $saida$
declare
  v_nomes text[] := array[
    'calcular_valor_sub_total','delete_usuario_from_auth','fn_autopreencher_fiscal_nfe_item',
    'fn_defaults_rascunho_nfe','fn_nfe_normalizar_destinatario_cpf','fn_preencher_peso_unitario_nfe_item',
    'fn_recalcular_peso_nfe_por_itens','fn_recalcular_totais_nfe_por_itens','fn_resetar_status_nfe_ao_editar',
    'fn_resetar_status_nfe_por_tabela_filha','fn_sync_natureza_operacao_nfe','fn_trigger_renumerar_itens_nfe',
    'handle_new_auth_user','handle_new_user','propostas_preencher_valor_total_avulsa',
    'recalcular_proposta_v4_trigger','sync_status_arte_to_briefing','sync_usuario_from_auth',
    'tg_nfse_normalizar_recalcular_biu','tg_recalc_financeiro_por_produto','trg_recalcular_totais_nfe_cabecalho',
    'trg_recalcular_totais_nfe_itens','trg_sync_artes_to_proposta_func','trg_sync_financeiro_to_proposta_func',
    'aplicar_credito_da_view','duplicar_proposta','fn_alertas_nfse','fn_montar_payload_nfse',
    'gerar_texto_whatsapp','gerar_texto_whatsapp_e_salvar','get_resumo_pagamento_por_proposta',
    'link_cliente_abrir','link_cliente_pedido','link_cliente_status','link_cliente_visto',
    'publicar_fundo_do_pwa','purge_propostas_aguardando','salvar_pagamento_v2_por_view'];
  v_n integer;
begin
  -- 4.1 nenhuma das 38 alcancavel por anon
  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f' and p.proname = any(v_nomes)
    and has_function_privilege('anon', p.oid,'EXECUTE');
  if v_n <> 0 then
    raise exception 'ABORTADO: % funcao(s) ainda alcancavel(is) por anon.', v_n;
  end if;

  -- 4.2 authenticated, service_role e postgres intactos nas 38
  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f' and p.proname = any(v_nomes)
    and not (has_function_privilege('authenticated', p.oid,'EXECUTE')
         and has_function_privilege('service_role', p.oid,'EXECUTE')
         and has_function_privilege('postgres', p.oid,'EXECUTE'));
  if v_n <> 0 then
    raise exception 'ABORTADO: % funcao(s) perderam EXECUTE de authenticated/service_role/postgres.', v_n;
  end if;

  -- 4.3 o QR publico segue aberto ao anon
  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f'
    and p.proname in ('os_qr_consultar','os_qr_avancar','os_qr_transicionar')
    and has_function_privilege('anon', p.oid,'EXECUTE');
  if v_n <> 3 then
    raise exception 'ABORTADO: o fluxo publico do QR perdeu EXECUTE para anon (% de 3 restantes).', v_n;
  end if;

  -- 4.4 as 3 do Focus seguem abertas ao anon (dependem da troca de credencial no n8n)
  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f'
    and p.proname in ('fn_preparar_envio_nfe','fn_preparar_envio_nfse','fn_salvar_retorno_focus_nfe')
    and has_function_privilege('anon', p.oid,'EXECUTE');
  if v_n <> 3 then
    raise exception 'ABORTADO: alguma das 3 do Focus perdeu EXECUTE para anon — emissao de nota quebraria.';
  end if;

  raise notice 'Saida OK: 38 fechadas para anon; authenticated/service_role/postgres intactos; QR publico e Focus preservados.';
end
$saida$;


-- =====================================================================
-- VERIFICACOES APOS APLICAR (rodar como SELECT)
-- =====================================================================
--
-- (a) ACL das 38, com aclexplode em LATERAL (aclexplode e set-returning: dentro
--     de array_agg da erro 0A000):
--     select p.proname,
--            array_agg(acl.grantee::regrole::text order by acl.grantee::regrole::text) as grantees
--       from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--       cross join lateral aclexplode(p.proacl) acl
--      where n.nspname='public' and acl.privilege_type='EXECUTE'
--        and p.proname in ('gerar_texto_whatsapp','get_resumo_pagamento_por_proposta')
--      group by p.proname;
--     -- esperado: {authenticated, postgres, service_role} — sem "-" e sem anon
--
-- (b) as duas exposicoes provadas, por chamada anonima:
--     POST /rest/v1/rpc/gerar_texto_whatsapp              -> negado (era 200)
--     POST /rest/v1/rpc/get_resumo_pagamento_por_proposta -> negado (era 200)
--
-- (c) o QR publico segue funcionando:
--     POST /rest/v1/rpc/os_qr_consultar {"p_token":"<32 zeros>"}
--     -> 200 {"ok": false, "motivo": "TOKEN_INVALIDO"}   (chegou na funcao)
--
-- (d) triggers seguem disparando: gravar pela tela autenticada e conferir que
--     `audit.logs_v2` registrou o UPDATE.
--
--
-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- Reabre as 38 ao anon e ao PUBLIC, voltando ao estado que respondia 200 com
-- nome de cliente e situacao financeira a qualquer requisicao anonima. So rodar
-- se algo de fato quebrar.
--
-- begin;
--   -- exemplo; repetir para as 38 com a assinatura exata
--   -- grant execute on function public.gerar_texto_whatsapp(p_id_int bigint) to public, anon;
--   -- grant execute on function public.get_resumo_pagamento_por_proposta(p_id_int bigint) to public, anon;
--   -- ...
-- commit;
--
-- Para gerar os 38 GRANTs a partir do proprio catalogo:
--   select 'grant execute on function public.' || quote_ident(proname) || '(' ||
--          pg_get_function_identity_arguments(oid) || ') to public, anon;'
--     from pg_proc where proname = any(array[ ...as 38... ]);
-- =====================================================================
