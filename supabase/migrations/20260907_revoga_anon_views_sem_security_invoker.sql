-- =====================================================================
-- Fecha o acesso ANONIMO a 25 views que rodam com privilegio do dono
-- =====================================================================
--
-- !! ESTA MIGRATION AINDA NAO FOI APLICADA. Escrita em 07/09/2026 para leitura
-- !! e aprovacao antes de rodar.
--
-- O QUE
-- -----
-- `REVOKE ALL ... FROM anon` em 25 views do schema `public`.
--
-- NAO toca em tabela, policy, RLS, funcao, default privilege nem em
-- `authenticated`/`service_role`. Nao le, escreve ou apaga nenhuma linha.
--
-- POR QUE — este e o unico vazamento ATIVO hoje
-- ---------------------------------------------
-- Uma view sem `security_invoker` roda com os privilegios do DONO. Ela atravessa
-- o GRANT da tabela-base: fechar `clientes` ao `anon` (93e0a9b) nao fecha a view
-- que le `clientes`.
--
-- Medido em 07/09/2026 com a anon key do `.env.local`, DEPOIS daquele revoke:
--
--   GET /rest/v1/vw_notas_fiscais_validacao_destinatario  -> HTTP 200
--        cliente_nome, cliente_documento (CPF/CNPJ), ins_estadual,
--        cep, endereco, numero, complemento, bairro, cidade, uf
--
--   GET /rest/v1/vw_cadastros_abc_clientes                -> HTTP 200
--        id_cliente, cliente, qtd_pedidos, valor_total, ultimo_pedido
--
--   GET /rest/v1/vw_cadastros_abc_cidades                 -> HTTP 200
--
--   No mesmo instante: GET /rest/v1/clientes -> 401 permission denied.
--
-- Ou seja: identidade completa e endereco fisico do cliente, e o ranking de
-- clientes por faturamento, saindo pela chave que vai no bundle do navegador.
--
-- Tres outras — `vw_clientes_carteira`, `vw_clientes_credito` e
-- `vw_clientes_limite_credito` — responderam 500 com `57014 statement timeout`.
-- ISSO NAO E PROTECAO: e o teto de 3s do papel `anon` (`pg_roles.rolconfig`),
-- contra 8s do `authenticated`. Um indice novo ou um cliente mais leve faz
-- qualquer uma delas passar. Entram na lista pelo mesmo motivo que as outras.
--
-- O CRITERIO, aplicado view a view
-- --------------------------------
--   1. MANTER ABERTA  se ha consumidor anonimo legitimo E a view e uma projecao
--                     estreita sobre base fechada (o grant e a protecao);
--   2. security_invoker  se a view precisa existir para `authenticated` E o RLS
--                     da base ja resolve;
--   3. REVOKE de anon  quando nada legitimo a consome sem sessao.
--
-- Resultado: 25 REVOKE, 1 MANTER, 0 security_invoker.
--
-- POR QUE NENHUMA GANHA `security_invoker` NESTA RODADA
-- -----------------------------------------------------
-- 20 das 26 leem `propostas`, `pagamentos_v2`, `boletos`, `notas_fiscais` ou
-- `produtos` — todas AINDA abertas ao `anon`. Ligar `security_invoker` nelas
-- hoje seria no-op de seguranca: o anon trocaria o privilegio do dono pelo
-- proprio, que tambem le. Vale como higiene DEPOIS que as bases fecharem.
--
-- A UNICA QUE FICA ABERTA, E POR QUE
-- ----------------------------------
-- `imposition_operadores`. A base `imposition_acessos_locais` esta TOTALMENTE
-- fechada — sem grant para anon nem para authenticated, sem policy nenhuma — e a
-- view expoe so `id, nome, role, ativo` de 15 operadores, escondendo as colunas
-- `codigo` e `permissoes`. E o padrao correto: base trancada, view como projecao
-- estreita, e o grant na view e o mecanismo de acesso, nao a falha.
--
-- Ha consumidor anonimo: o PWA de imposicao, fora deste repositorio, evidenciado
-- pelas policies `{-}` em `imposition_avisos`, `imposition_avisos_leituras` e
-- `imposition_fundo_pwa`. Revogar quebraria o PWA.
--
-- E ligar `security_invoker` nela devolveria VAZIO para anon E para
-- authenticated, porque a base nao tem grant para nenhum dos dois. Foi o unico
-- caso de risco encontrado ao verificar as 15 tabelas-base: as outras 14 tem RLS
-- ligada com policy de SELECT alcancando `authenticated`.
--
-- O QUE NAO QUEBRA
-- ----------------
-- As 25 tem grant para `authenticated` E `service_role`, conferido antes. Doze
-- sao usadas em `src/`, todas em telas de `(erp)`, com sessao. NENHUMA das 26 e
-- lida pelo n8n: cruzado contra os 89 workflows, zero ocorrencias.
--
-- SOBRE AS ASSERCOES DE SAIDA
-- ---------------------------
-- Elas provam COMPORTAMENTO, nao catalogo. A migration
-- 20260901154326_default_privileges_public_sem_anon.sql passou verificando
-- `pg_default_acl` enquanto funcao nova continuava nascendo executavel por
-- PUBLIC — a assercao olhou o lugar errado.
--
-- Aqui a saida faz `SET LOCAL ROLE anon` e TENTA LER cada view, exigindo
-- `insufficient_privilege`. Se qualquer uma responder, aborta. E repete com
-- `authenticated`, exigindo que CONTINUE lendo — tratando `query_canceled` como
-- sucesso, porque timeout significa que a permissao passou e a consulta chegou a
-- executar.
--
-- O `SET LOCAL ROLE` vive dentro de um bloco com EXCEPTION: o rollback da
-- subtransacao devolve o papel a cada iteracao, sem `RESET ROLE` explicito —
-- que o proprio `anon` nao teria privilegio para executar.
-- =====================================================================

-- ------------------------------------------------------------------
-- 1. ASSERCOES DE ENTRADA
-- ------------------------------------------------------------------
do $entrada$
declare
  v_alvo    integer;
  v_semauth integer;
begin
  select count(*) into v_alvo
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v'
     and has_table_privilege('anon', c.oid, 'SELECT')
     and coalesce(c.reloptions::text ilike '%security_invoker=%', false) = false;

  if v_alvo <> 26 then
    raise exception 'ABORTADO: esperava 26 views sem security_invoker alcancaveis por anon, encontrei %. O estado divergiu do levantamento de 07/09/2026 — refazer o diagnostico.', v_alvo;
  end if;

  -- nenhuma pode perder o app junto: todas precisam ter authenticated
  select count(*) into v_semauth
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v'
     and has_table_privilege('anon', c.oid, 'SELECT')
     and coalesce(c.reloptions::text ilike '%security_invoker=%', false) = false
     and not has_table_privilege('authenticated', c.oid, 'SELECT');

  if v_semauth <> 0 then
    raise exception 'ABORTADO: % view(s) sem grant para authenticated. Revogar o anon deixaria a tela sem acesso — parar.', v_semauth;
  end if;

  raise notice 'Entrada OK: 26 views sem security_invoker, todas com grant para authenticated.';
end
$entrada$;

-- ------------------------------------------------------------------
-- 2. OS REVOKES — 25 views. `imposition_operadores` NAO entra.
--    `from public, anon` por precaucao: hoje o grant e nominal ao anon
--    (sem PUBLIC), mas revogar dos dois nao custa e cobre o caso de
--    alguem ter reconcedido a PUBLIC no meio do caminho.
-- ------------------------------------------------------------------

-- leem clientes / enderecos (as que vazam identidade)
revoke all on table public.vw_notas_fiscais_validacao_destinatario from public, anon;
revoke all on table public.vw_cadastros_abc_clientes               from public, anon;
revoke all on table public.vw_cadastros_abc_cidades                from public, anon;
revoke all on table public.vw_clientes_carteira                    from public, anon;
revoke all on table public.vw_clientes_credito                     from public, anon;
revoke all on table public.vw_clientes_limite_credito              from public, anon;
revoke all on table public.vw_pagamentos_resumo                    from public, anon;

-- nota fiscal
revoke all on table public.vw_notas_fiscais_validacao              from public, anon;
revoke all on table public.vw_notas_fiscais_validacao_geral        from public, anon;
revoke all on table public.vw_notas_fiscais_validacao_itens        from public, anon;
revoke all on table public.vw_notas_fiscais_rascunho               from public, anon;
revoke all on table public.vw_nfe_itens_conferencia_valores        from public, anon;

-- proposta e faturamento
revoke all on table public.vw_proposta_completa                    from public, anon;
revoke all on table public.vw_produtos_proposta_com_descricao      from public, anon;
revoke all on table public.vw_relatorio_vendas_pagas_base          from public, anon;
revoke all on table public.vw_creditos_pendentes                   from public, anon;
revoke all on table public.vw_boletos_controle                     from public, anon;
revoke all on table public.view_pagamentos_pagos                   from public, anon;
revoke all on table public.view_pagamentos_pagos_v2                from public, anon;
revoke all on table public.view_fatu_diario_por_empresa            from public, anon;
revoke all on table public.view_fatu_diario_total                  from public, anon;
revoke all on table public.view_soma_propostas_periodo_diario      from public, anon;
revoke all on table public.view_soma_propostas_periodo_vendedor    from public, anon;

-- catalogo de produto
revoke all on table public.view_base_conhecimento                  from public, anon;
revoke all on table public.view_base_conhecimento_produtos         from public, anon;

-- ------------------------------------------------------------------
-- 3. ASSERCOES DE SAIDA — comportamento, nao catalogo
-- ------------------------------------------------------------------
do $saida$
declare
  v_views text[] := array[
    'vw_notas_fiscais_validacao_destinatario','vw_cadastros_abc_clientes','vw_cadastros_abc_cidades',
    'vw_clientes_carteira','vw_clientes_credito','vw_clientes_limite_credito','vw_pagamentos_resumo',
    'vw_notas_fiscais_validacao','vw_notas_fiscais_validacao_geral','vw_notas_fiscais_validacao_itens',
    'vw_notas_fiscais_rascunho','vw_nfe_itens_conferencia_valores','vw_proposta_completa',
    'vw_produtos_proposta_com_descricao','vw_relatorio_vendas_pagas_base','vw_creditos_pendentes',
    'vw_boletos_controle','view_pagamentos_pagos','view_pagamentos_pagos_v2',
    'view_fatu_diario_por_empresa','view_fatu_diario_total','view_soma_propostas_periodo_diario',
    'view_soma_propostas_periodo_vendedor','view_base_conhecimento','view_base_conhecimento_produtos'];
  v_nome      text;
  v_abertas   text[] := '{}';
  v_quebradas text[] := '{}';
begin
  -- 3.1 COMPORTAMENTO: o anon precisa ser RECUSADO em cada uma das 25.
  foreach v_nome in array v_views loop
    begin
      set local role anon;
      execute format('select 1 from public.%I limit 1', v_nome);
      -- chegou aqui: leu. Erro proprio so para abortar a subtransacao e
      -- devolver o papel; e capturado logo abaixo.
      raise exception using errcode = 'AN001', message = 'anon ainda le';
    exception
      when insufficient_privilege then
        null;                                    -- correto: fechada
      when sqlstate 'AN001' then
        v_abertas := v_abertas || v_nome;        -- ainda aberta
      when others then
        v_abertas := v_abertas || (v_nome || ' [' || sqlstate || ']');
    end;
  end loop;

  if array_length(v_abertas, 1) > 0 then
    raise exception 'ABORTADO: anon ainda alcanca % view(s): %',
      array_length(v_abertas, 1), array_to_string(v_abertas, ', ');
  end if;

  -- 3.2 COMPORTAMENTO: o `authenticated` precisa CONTINUAR lendo as 25.
  --     `query_canceled` (timeout) conta como sucesso: a permissao passou e a
  --     consulta chegou a executar. Algumas dessas views sao pesadas.
  foreach v_nome in array v_views loop
    begin
      set local role authenticated;
      execute format('select 1 from public.%I limit 1', v_nome);
      raise exception using errcode = 'AU001', message = 'ok';
    exception
      when insufficient_privilege then
        v_quebradas := v_quebradas || v_nome;    -- o app perderia a view
      when sqlstate 'AU001' then
        null;                                    -- correto: leu
      when others then
        null;                                    -- timeout etc: permissao passou
    end;
  end loop;

  if array_length(v_quebradas, 1) > 0 then
    raise exception 'ABORTADO: authenticated PERDEU acesso a % view(s): %',
      array_length(v_quebradas, 1), array_to_string(v_quebradas, ', ');
  end if;

  -- 3.3 `imposition_operadores` precisa continuar aberta ao anon
  if not has_table_privilege('anon', 'public.imposition_operadores', 'SELECT') then
    raise exception 'ABORTADO: imposition_operadores perdeu o acesso anonimo — o PWA de imposicao quebraria.';
  end if;

  -- 3.4 nada fora do alvo mudou: as 4 views com security_invoker seguem abertas
  if (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'v'
         and c.reloptions::text ilike '%security_invoker=%'
         and has_table_privilege('anon', c.oid, 'SELECT')) <> 4 then
    raise exception 'ABORTADO: o conjunto das 4 views com security_invoker mudou.';
  end if;

  raise notice 'Saida OK: as 25 recusam leitura anonima (insufficient_privilege, medido por SET LOCAL ROLE); authenticated segue lendo as 25; imposition_operadores intacta.';
end
$saida$;


-- =====================================================================
-- VERIFICACOES APOS APLICAR (rodar como SELECT)
-- =====================================================================
--
-- (a) o alvo some da lista de views alcancaveis pelo anon:
--     select c.relname, coalesce(array_to_string(c.reloptions,','),'(sem opcoes)')
--       from pg_class c join pg_namespace n on n.oid=c.relnamespace
--      where n.nspname='public' and c.relkind='v'
--        and has_table_privilege('anon', c.oid,'SELECT')
--      order by 1;
--     -- esperado: 5 linhas — imposition_operadores mais as 4 com security_invoker
--
-- (b) pelo PostgREST, com a anon key do `.env.local`:
--     GET /rest/v1/vw_notas_fiscais_validacao_destinatario  -> 401 (era 200)
--     GET /rest/v1/vw_cadastros_abc_clientes                -> 401 (era 200)
--     GET /rest/v1/vw_cadastros_abc_cidades                 -> 401 (era 200)
--     GET /rest/v1/imposition_operadores                    -> 200 (inalterada)
--
-- (c) com JWT de usuario autenticado, as 25 seguem em 200.
--
-- (d) as telas que usam as 12 views: Cadastros (ABC de clientes e cidades),
--     Notas Fiscais (validacao), Cobrancas (pagamentos pagos), Boletos
--     (controle) e Produtos.
--
--
-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- Reabre as 25 ao anon, voltando ao estado que entregava nome, CPF/CNPJ e
-- endereco de cliente a qualquer requisicao anonima. So rodar se algo quebrar.
--
-- begin;
--   grant select on table public.vw_notas_fiscais_validacao_destinatario to anon;
--   grant select on table public.vw_cadastros_abc_clientes               to anon;
--   grant select on table public.vw_cadastros_abc_cidades                to anon;
--   grant select on table public.vw_clientes_carteira                    to anon;
--   grant select on table public.vw_clientes_credito                     to anon;
--   grant select on table public.vw_clientes_limite_credito              to anon;
--   grant select on table public.vw_pagamentos_resumo                    to anon;
--   grant select on table public.vw_notas_fiscais_validacao              to anon;
--   grant select on table public.vw_notas_fiscais_validacao_geral        to anon;
--   grant select on table public.vw_notas_fiscais_validacao_itens        to anon;
--   grant select on table public.vw_notas_fiscais_rascunho               to anon;
--   grant select on table public.vw_nfe_itens_conferencia_valores        to anon;
--   grant select on table public.vw_proposta_completa                    to anon;
--   grant select on table public.vw_produtos_proposta_com_descricao      to anon;
--   grant select on table public.vw_relatorio_vendas_pagas_base          to anon;
--   grant select on table public.vw_creditos_pendentes                   to anon;
--   grant select on table public.vw_boletos_controle                     to anon;
--   grant select on table public.view_pagamentos_pagos                   to anon;
--   grant select on table public.view_pagamentos_pagos_v2                to anon;
--   grant select on table public.view_fatu_diario_por_empresa            to anon;
--   grant select on table public.view_fatu_diario_total                  to anon;
--   grant select on table public.view_soma_propostas_periodo_diario      to anon;
--   grant select on table public.view_soma_propostas_periodo_vendedor    to anon;
--   grant select on table public.view_base_conhecimento                  to anon;
--   grant select on table public.view_base_conhecimento_produtos         to anon;
-- commit;
--
-- Nota: o rollback concede SELECT, nao ALL. O estado anterior tinha os 8
-- privilegios que o default privilege dava (INSERT, UPDATE, DELETE, TRUNCATE,
-- REFERENCES, TRIGGER, MAINTAIN), nenhum deles com uso legitimo numa view. Se a
-- volta ao estado literal for necessaria, trocar por `grant all`.
-- =====================================================================
