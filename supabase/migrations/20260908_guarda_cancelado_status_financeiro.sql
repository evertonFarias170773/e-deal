-- =====================================================================
-- CANCELADO deixa de voltar ao fluxo sozinho
-- =====================================================================
--
-- !! ESTA MIGRATION AINDA NAO FOI APLICADA. Escrita em 08/09/2026 para
-- !! leitura e aprovacao antes de rodar.
--
-- O QUE
-- -----
-- Acrescenta 'CANCELADO' a lista de status protegidos da guarda inicial de
-- `atualizar_status_financeiro_proposta`, nas DUAS sobrecargas (integer e
-- bigint). Uma linha em cada.
--
-- Nao muda mais nada: nao uniformiza as duas sobrecargas, nao mexe em outro
-- trigger, nao corrige dado antigo.
--
-- POR QUE
-- -------
-- A funcao tem uma guarda de status protegido logo no inicio, com doze status
-- que a impedem de escrever. `CANCELADO` NAO estava nela, e isso era
-- DELIBERADO — o comentario do corpo dizia, textualmente, que CANCELADO ficava
-- de fora "que precisa seguir reativavel por nova cobranca".
--
-- Depois da guarda, a funcao tem cinco UPDATE. Dois protegem CANCELADO por
-- conta propria:
--
--   sem pagamento algum           -> NOVO,  so se o status atual <> CANCELADO
--   todas as cobrancas canceladas -> NOVO,  so se o status atual <> CANCELADO
--
-- Os outros TRES eram incondicionais:
--
--   existe cobranca pendente   -> AGUARDANDO
--   existe cobranca aprovada   -> APROVADO
--   qualquer outro cenario     -> AGUARDANDO
--
-- Ou seja: uma proposta CANCELADA que tivesse ao menos uma cobranca nao
-- cancelada voltava sozinha para AGUARDANDO ou APROVADO.
--
-- O ALCANCE ERA MAIOR DO QUE "NOVA COBRANCA"
-- ------------------------------------------
-- A justificativa do comentario falava em cobranca. Mas TRES triggers ativos
-- chamam esta funcao:
--
--   pagamentos_v2      AFTER INSERT/DELETE/UPDATE  -> tg_sync_status_financeiro_proposta
--   produtos_proposta  AFTER INSERT/DELETE/UPDATE  -> tg_recalc_financeiro_por_produto
--   cotacao_frete      AFTER INSERT/DELETE/UPDATE  -> tg_recalc_financeiro_por_frete
--
-- Editar um item do orcamento ou recotar o frete de uma proposta cancelada
-- tambem a ressuscitava. Isso nao estava no desenho registrado.
--
-- O QUE JA ACONTECEU (auditoria de `propostas`, que comeca em 28/03/2026)
-- ----------------------------------------------------------------------
-- Transicoes saindo de CANCELADO em que SO `status_interno` mudou — a
-- assinatura desta funcao, ja que ela nao escreve mais nada:
--
--   -> AGUARDANDO   96 transicoes, 78 propostas, de 31/03/2026 a 26/08/2026
--   -> APROVADO     10 transicoes,  4 propostas, de 21/07/2026 a 06/08/2026
--
-- 106 transicoes sobre 82 propostas distintas. Outras 5 mudaram status_interno
-- junto com valor, frete ou texto — essas sao edicao humana deliberada, nao o
-- defeito.
--
-- Ressalva honesta: "so status_interno mudou" e assinatura forte, nao prova —
-- um UPDATE de aplicacao que mexesse so nesse campo seria indistinguivel. E a
-- primeira ocorrencia esta a tres dias do inicio da auditoria, entao o defeito
-- provavelmente e mais antigo que a janela observavel.
--
-- A DECISAO DO DONO, 08/09/2026
-- -----------------------------
-- Proposta em CANCELADO nao sai desse status por trigger nenhum. Nem por
-- cobranca nova, nem por edicao de item, nem por recotacao de frete. Quem
-- quiser reativar um pedido cancelado faz na tela, deliberadamente.
--
-- Isso REVOGA o desenho anterior. O comentario que o registrava e substituido
-- no corpo das duas funcoes.
--
-- POR QUE NA LISTA INICIAL, E NAO NOS TRES UPDATE
-- -----------------------------------------------
-- As duas formas dao o mesmo resultado observavel: a funcao nao escreve nada
-- para uma proposta cancelada. A diferenca esta no que acontece DEPOIS.
--
-- Com a guarda em cada UPDATE, quem acrescentar um sexto UPDATE no futuro
-- precisa lembrar de guardar tambem. Foi exatamente assim que este defeito
-- nasceu: dois UPDATE ganharam a checagem, tres nao.
--
-- Com CANCELADO na lista inicial, a funcao retorna antes de qualquer escrita, e
-- UPDATE novo nasce protegido sem ninguem fazer nada.
--
-- As duas checagens que ja existiam nos retornos antecipados FICAM como estao.
-- Elas passam a ser redundantes, e tudo bem: remove-las seria mexer no que a
-- decisao nao pediu, e elas documentam a intencao no ponto de uso.
--
-- NAO HA FLUXO LEGITIMO QUE DEPENDA DA REATIVACAO — VERIFICADO
-- ------------------------------------------------------------
-- O unico candidato era `cobranca_reprovar_condicao`, cujo comentario no app
-- diz que a trigger "grava CANCELADO na proposta durante o cancelamento da
-- cobranca". Lido o corpo da RPC, ela:
--
--   1. le `status_interno` ANTES de cancelar, com FOR UPDATE, justamente para
--      "avaliar o estado real de origem";
--   2. RECUSA se a proposta estiver em status protegido ou fora da lista de
--      permitidos — ou seja, no momento em que a trigger dispara a proposta
--      NAO esta em CANCELADO;
--   3. cancela a cobranca, e so entao grava `status_interno = 'NOVO'` ela
--      mesma, explicitamente;
--   4. confere o desfecho e levanta excecao se nao ficou NOVO.
--
-- A guarda nunca engata nesse caminho, porque no passo 2 a proposta ja foi
-- barrada se estivesse cancelada. O fluxo continua funcionando igual.
--
-- `check_and_promote_proposta`, que tambem escreve `status_interno`, JA tem
-- CANCELADO na sua lista de protegidos. Nao muda nada.
--
-- E A LISTA INICIAL NAO MUDA MAIS NADA ALEM DISSO: entre a guarda e o primeiro
-- UPDATE a funcao so faz SELECT para variaveis locais. Nao ha RAISE, PERFORM,
-- escrita nem valor de retorno — ela e `returns void`. Sair antes ou sair
-- depois de contar e indistinguivel de fora.
--
-- DOIS PONTOS QUE ESTA MIGRATION NAO RESOLVE, e ficam registrados
-- ---------------------------------------------------------------
-- 1. A funcao tem EXECUTE para PUBLIC, anon, authenticated e service_role.
--    Alem dos tres triggers, ela e chamavel direto por RPC com a chave anon. A
--    guarda protege esse caminho tambem (ela e interna a funcao), mas o grant
--    em si e outro assunto.
--
-- 2. `atualizar_status_proposta_por_pagamento` e um trigger em `pagamentos_v2`
--    que escreve `status_interno` SEM guarda nenhuma e sem mencionar CANCELADO.
--    Hoje ele esta DESABILITADO (`tgenabled = 'D'`), entao nao e caminho vivo.
--    Religa-lo devolveria o defeito por outra porta, com vocabulario que nem e
--    o de proposta ('A_RECEBER', 'QUITADO'). Nao mexemos nele.
--
-- RISCO
-- -----
-- Baixo. A mudanca so IMPEDE escrita; nao passa a escrever nada que nao
-- escrevesse antes. O pior caso e uma proposta cancelada deixar de ser
-- promovida automaticamente — que e exatamente o objetivo.
--
-- Nenhum backfill. As 82 propostas ja afetadas ficam como estao, por decisao do
-- dono: importa como vai funcionar daqui pra frente.
-- =====================================================================


-- ------------------------------------------------------------------
-- 1. ASSERCOES DE ENTRADA
-- ------------------------------------------------------------------
do $entrada$
declare
  v_ddl_int  text;
  v_ddl_big  text;
  v_guarda   text;
begin
  select pg_get_functiondef(p.oid) into v_ddl_int
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'atualizar_status_financeiro_proposta'
     and pg_get_function_identity_arguments(p.oid) = 'p_id_int integer';

  select pg_get_functiondef(p.oid) into v_ddl_big
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'atualizar_status_financeiro_proposta'
     and pg_get_function_identity_arguments(p.oid) = 'p_id_int bigint';

  if v_ddl_int is null or v_ddl_big is null then
    raise exception 'ABORTADO: esperava as DUAS sobrecargas (integer e bigint). integer=%, bigint=%',
      (v_ddl_int is not null), (v_ddl_big is not null);
  end if;

  -- CANCELADO NAO pode estar na guarda inicial hoje. Se ja estiver, alguem
  -- mexeu antes desta migration e o diagnostico precisa ser refeito.
  --
  -- O recorte pega o bloco entre "in (" e o ") then" que o fecha — e so ali
  -- que a lista de status protegidos vive.
  v_guarda := substring(v_ddl_int from 'in \(\s*''REVISAO ATENDENTE''(.|\n)*?\) then');
  if v_guarda is null then
    raise exception 'ABORTADO: nao localizei a guarda inicial na sobrecarga integer.';
  end if;
  if v_guarda ~ 'CANCELADO' then
    raise exception 'ABORTADO: CANCELADO JA esta na guarda inicial da sobrecarga integer. Estado inesperado.';
  end if;

  v_guarda := substring(v_ddl_big from 'in \(\s*''REVISAO ATENDENTE''(.|\n)*?\) then');
  if v_guarda is null then
    raise exception 'ABORTADO: nao localizei a guarda inicial na sobrecarga bigint.';
  end if;
  if v_guarda ~ 'CANCELADO' then
    raise exception 'ABORTADO: CANCELADO JA esta na guarda inicial da sobrecarga bigint. Estado inesperado.';
  end if;

  -- Cinco UPDATE em propostas em cada sobrecarga: 2 ja protegidos, 3 nao.
  if (select count(*) from regexp_matches(v_ddl_int, 'update public\.propostas', 'g')) <> 5 then
    raise exception 'ABORTADO: sobrecarga integer nao tem os 5 UPDATE esperados.';
  end if;
  if (select count(*) from regexp_matches(v_ddl_big, 'update public\.propostas', 'g')) <> 5 then
    raise exception 'ABORTADO: sobrecarga bigint nao tem os 5 UPDATE esperados.';
  end if;

  raise notice 'Entrada OK: 2 sobrecargas presentes, CANCELADO ausente das duas guardas, 5 UPDATE em cada.';
end
$entrada$;


-- ------------------------------------------------------------------
-- 2. SOBRECARGA integer
--    Corpo identico ao instalado, com DUAS mudancas:
--      a) 'CANCELADO' acrescentado a lista da guarda inicial;
--      b) o comentario que registrava a reativacao deliberada.
--    Os tres UPDATE finais seguem incondicionais de proposito: quem os protege
--    agora e a guarda la de cima.
-- ------------------------------------------------------------------
create or replace function public.atualizar_status_financeiro_proposta(p_id_int integer)
returns void
language plpgsql
as $function$
declare
  v_total_pagamentos int := 0;
  v_total_cancelados int := 0;
  v_tem_pendente int := 0;
  v_tem_aprovado int := 0;
  v_status_atual text;
begin
  -- GUARDA DE STATUS PROTEGIDO
  -- Evidencia financeira nao move etapa produtiva. Da liberacao em diante o
  -- status so muda pelas transicoes oficiais do fluxo — salvar o orcamento
  -- (que escreve em produtos_proposta e em cotacao_frete, disparando esta
  -- funcao) nao e uma delas.
  --
  -- 'CANCELADO' ENTROU NESTA LISTA em 08/09/2026, por decisao do dono.
  -- Ate essa data ele ficava de fora de proposito: o desenho previa que
  -- proposta cancelada seguisse "reativavel por nova cobranca". ESSE DESENHO
  -- FOI REVOGADO — proposta em CANCELADO nao sai desse status por trigger
  -- nenhum, e a reativacao passa a ser ato deliberado na tela. O motivo: o
  -- alcance real nao era so cobranca — editar um item do orcamento ou recotar
  -- o frete tambem a ressuscitava.
  --
  -- Estando na lista, a funcao retorna aqui e nenhum UPDATE abaixo e alcancado
  -- por proposta cancelada. As duas checagens de CANCELADO que existem mais
  -- abaixo ficaram redundantes; foram mantidas de proposito, para documentar a
  -- intencao no ponto de uso.
  select upper(coalesce(status_interno, ''))
    into v_status_atual
  from public.propostas
  where id_int = p_id_int;

  if coalesce(v_status_atual, '') in (
       'CANCELADO',
       'REVISAO ATENDENTE',
       'REVISAO PRODUCAO',
       'EM PRODUCAO',
       'EM IMPRESSAO',
       'EM IMPRESSAO / PENDENTE',
       'EM ACABAMENTO',
       'EM ACABAMENTO / PENDENTE',
       'EXPEDICAO',
       'A RETIRAR',
       'EM TRANSITO',
       'ENTREGUE',
       'RECEBIDO'
     ) then
    return;
  end if;

  select count(*)
    into v_total_pagamentos
  from public.pagamentos_v2
  where id_int = p_id_int;

  -- Sem pagamento nenhum: proposta volta ao inicio do funil. Nunca reabre
  -- proposta cancelada — cancelamento e ato proprio e so a rota desfaz.
  if v_total_pagamentos = 0 then
    if coalesce(v_status_atual, '') <> 'CANCELADO' then
      update public.propostas
         set status_interno = 'NOVO'
       where id_int = p_id_int;
    end if;
    return;
  end if;

  select count(*)
    into v_total_cancelados
  from public.pagamentos_v2
  where id_int = p_id_int
    and upper(coalesce(status,'')) = 'CANCELADO';

  -- Todas as cobrancas canceladas: proposta A REFATURAR, nao proposta morta.
  -- Mesmo tratamento de "sem pagamentos". Esta funcao nao cancela proposta.
  if v_total_cancelados = v_total_pagamentos then
    if coalesce(v_status_atual, '') <> 'CANCELADO' then
      update public.propostas
         set status_interno = 'NOVO'
       where id_int = p_id_int;
    end if;
    return;
  end if;

  select count(*)
    into v_tem_pendente
  from public.pagamentos_v2
  where id_int = p_id_int
    and upper(coalesce(status,'')) <> 'CANCELADO'
    and (
      upper(coalesce(status,'')) = 'A_RECEBER'
      or (upper(coalesce(status,'')) in ('A_VENCER','PAID') and coalesce(confirmado,false) = false)
    );

  if v_tem_pendente > 0 then
    update public.propostas
       set status_interno = 'AGUARDANDO'
     where id_int = p_id_int;
    return;
  end if;

  select count(*)
    into v_tem_aprovado
  from public.pagamentos_v2
  where id_int = p_id_int
    and upper(coalesce(status,'')) in ('A_VENCER','PAID')
    and coalesce(confirmado,false) = true;

  if v_tem_aprovado > 0 then
    update public.propostas
       set status_interno = 'APROVADO'
     where id_int = p_id_int;
    return;
  end if;

  update public.propostas
     set status_interno = 'AGUARDANDO'
   where id_int = p_id_int;
end;
$function$;


-- ------------------------------------------------------------------
-- 3. SOBRECARGA bigint
--    MESMA mudanca. As duas DIVERGEM na contagem de pendentes (a integer conta
--    A_VENCER/PAID nao confirmados, a bigint so A_RECEBER) e essa divergencia
--    NAO e tocada aqui — e outro assunto e outra decisao.
-- ------------------------------------------------------------------
create or replace function public.atualizar_status_financeiro_proposta(p_id_int bigint)
returns void
language plpgsql
as $function$
declare
  v_total_pagamentos int := 0;
  v_total_cancelados int := 0;
  v_tem_pendente int := 0;
  v_tem_aprovado int := 0;
  v_status_atual text;
begin
  -- GUARDA DE STATUS PROTEGIDO — ver comentario na sobrecarga integer.
  -- 'CANCELADO' entrou nesta lista em 08/09/2026, por decisao do dono.
  select upper(coalesce(status_interno, ''))
    into v_status_atual
  from public.propostas
  where id_int = p_id_int;

  if coalesce(v_status_atual, '') in (
       'CANCELADO',
       'REVISAO ATENDENTE',
       'REVISAO PRODUCAO',
       'EM PRODUCAO',
       'EM IMPRESSAO',
       'EM IMPRESSAO / PENDENTE',
       'EM ACABAMENTO',
       'EM ACABAMENTO / PENDENTE',
       'EXPEDICAO',
       'A RETIRAR',
       'EM TRANSITO',
       'ENTREGUE',
       'RECEBIDO'
     ) then
    return;
  end if;

  -- total de pagamentos da proposta
  select count(*)
    into v_total_pagamentos
  from public.pagamentos_v2
  where id_int = p_id_int;

  -- sem pagamentos = NOVO, mas nunca reabrindo proposta cancelada
  if v_total_pagamentos = 0 then
    if coalesce(v_status_atual, '') <> 'CANCELADO' then
      update public.propostas
         set status_interno = 'NOVO'
       where id_int = p_id_int;
    end if;
    return;
  end if;

  -- total cancelados
  select count(*)
    into v_total_cancelados
  from public.pagamentos_v2
  where id_int = p_id_int
    and upper(coalesce(status, '')) = 'CANCELADO';

  -- todas canceladas = proposta a refaturar (NOVO), nao proposta morta.
  -- Esta funcao nao cancela proposta e nao reabre proposta cancelada.
  if v_total_cancelados = v_total_pagamentos then
    if coalesce(v_status_atual, '') <> 'CANCELADO' then
      update public.propostas
         set status_interno = 'NOVO'
       where id_int = p_id_int;
    end if;
    return;
  end if;

  -- existe algum A_RECEBER? então fica AGUARDANDO
  select count(*)
    into v_tem_pendente
  from public.pagamentos_v2
  where id_int = p_id_int
    and upper(coalesce(status, '')) = 'A_RECEBER';

  if v_tem_pendente > 0 then
    update public.propostas
       set status_interno = 'AGUARDANDO'
     where id_int = p_id_int;
    return;
  end if;

  -- existe algum A_VENCER ou PAID confirmado? então APROVADO
  select count(*)
    into v_tem_aprovado
  from public.pagamentos_v2
  where id_int = p_id_int
    and upper(coalesce(status, '')) in ('A_VENCER', 'PAID')
    and confirmado = true;

  if v_tem_aprovado > 0 then
    update public.propostas
       set status_interno = 'APROVADO'
     where id_int = p_id_int;
    return;
  end if;

  -- qualquer outro cenário com pagamento existente = AGUARDANDO
  update public.propostas
     set status_interno = 'AGUARDANDO'
   where id_int = p_id_int;

end;
$function$;


-- ------------------------------------------------------------------
-- 4. ASSERCOES DE SAIDA
-- ------------------------------------------------------------------
do $saida$
declare
  v_ddl_int text;
  v_ddl_big text;
  v_guarda  text;
  v_id_int  bigint;
  v_depois  text;
  v_falhou  text := null;
begin
  select pg_get_functiondef(p.oid) into v_ddl_int
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'atualizar_status_financeiro_proposta'
     and pg_get_function_identity_arguments(p.oid) = 'p_id_int integer';

  select pg_get_functiondef(p.oid) into v_ddl_big
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'atualizar_status_financeiro_proposta'
     and pg_get_function_identity_arguments(p.oid) = 'p_id_int bigint';

  -- 4.1 As duas continuam existindo
  if v_ddl_int is null or v_ddl_big is null then
    raise exception 'ABORTADO: perdemos uma das sobrecargas.';
  end if;

  -- 4.2 CANCELADO ENTROU na guarda inicial das duas.
  --     O recorte e o mesmo da assercao de entrada: o bloco entre "in (" e o
  --     ") then". Procurar CANCELADO no DDL inteiro nao serviria — ele ja
  --     aparece nas duas checagens antigas mais abaixo.
  v_guarda := substring(v_ddl_int from 'in \(\s*''CANCELADO''(.|\n)*?\) then');
  if v_guarda is null or v_guarda !~ 'REVISAO ATENDENTE' or v_guarda !~ 'RECEBIDO' then
    raise exception 'ABORTADO: CANCELADO nao ficou na guarda inicial da sobrecarga integer.';
  end if;

  v_guarda := substring(v_ddl_big from 'in \(\s*''CANCELADO''(.|\n)*?\) then');
  if v_guarda is null or v_guarda !~ 'REVISAO ATENDENTE' or v_guarda !~ 'RECEBIDO' then
    raise exception 'ABORTADO: CANCELADO nao ficou na guarda inicial da sobrecarga bigint.';
  end if;

  -- 4.3 Nada mais mudou de estrutura: 5 UPDATE e as 2 checagens antigas.
  if (select count(*) from regexp_matches(v_ddl_int, 'update public\.propostas', 'g')) <> 5 then
    raise exception 'ABORTADO: sobrecarga integer nao tem mais 5 UPDATE.';
  end if;
  if (select count(*) from regexp_matches(v_ddl_big, 'update public\.propostas', 'g')) <> 5 then
    raise exception 'ABORTADO: sobrecarga bigint nao tem mais 5 UPDATE.';
  end if;
  if (select count(*) from regexp_matches(v_ddl_int, 'coalesce\(v_status_atual, ''''\) <> ''CANCELADO''', 'g')) <> 2 then
    raise exception 'ABORTADO: sobrecarga integer deveria manter as 2 checagens antigas.';
  end if;
  if (select count(*) from regexp_matches(v_ddl_big, 'coalesce\(v_status_atual, ''''\) <> ''CANCELADO''', 'g')) <> 2 then
    raise exception 'ABORTADO: sobrecarga bigint deveria manter as 2 checagens antigas.';
  end if;

  -- 4.4 A divergencia entre as duas foi PRESERVADA, como pedido:
  --     a integer conta A_VENCER/PAID nao confirmados como pendente; a bigint nao.
  if v_ddl_int !~ 'A_VENCER'',''PAID''\) and coalesce\(confirmado,false\) = false' then
    raise exception 'ABORTADO: a sobrecarga integer perdeu a contagem propria de pendentes.';
  end if;
  if v_ddl_big ~ 'coalesce\(confirmado,false\) = false' then
    raise exception 'ABORTADO: a sobrecarga bigint ganhou logica da integer. Nao era para uniformizar.';
  end if;

  -- 4.5 PROVA POR COMPORTAMENTO, em subtransacao abortada.
  --
  --     Pega uma proposta que tenha ao menos uma cobranca NAO cancelada — a
  --     condicao que fazia o defeito disparar —, forca o status para CANCELADO,
  --     chama as duas sobrecargas e confere que nenhuma mexeu. O RAISE no fim
  --     desfaz tudo: nenhuma linha e alterada em definitivo.
  select p.id_int into v_id_int
    from public.propostas p
   where exists (select 1 from public.pagamentos_v2 g
                  where g.id_int = p.id_int
                    and upper(coalesce(g.status,'')) <> 'CANCELADO')
   limit 1;

  if v_id_int is null then
    raise notice 'ATENCAO: nenhuma proposta com cobranca nao cancelada; a prova por comportamento foi PULADA.';
  else
    begin
      update public.propostas set status_interno = 'CANCELADO' where id_int = v_id_int;

      perform public.atualizar_status_financeiro_proposta(v_id_int::integer);
      select upper(coalesce(status_interno,'')) into v_depois
        from public.propostas where id_int = v_id_int;
      if v_depois <> 'CANCELADO' then
        v_falhou := format('sobrecarga integer mudou CANCELADO para %s', v_depois);
      end if;

      perform public.atualizar_status_financeiro_proposta(v_id_int::bigint);
      select upper(coalesce(status_interno,'')) into v_depois
        from public.propostas where id_int = v_id_int;
      if v_falhou is null and v_depois <> 'CANCELADO' then
        v_falhou := format('sobrecarga bigint mudou CANCELADO para %s', v_depois);
      end if;

      -- desfaz TUDO o que este bloco escreveu
      raise exception using errcode = 'ZZ001', message = 'rollback proposital do teste';
    exception
      when sqlstate 'ZZ001' then null;   -- esperado: a subtransacao foi desfeita
    end;

    if v_falhou is not null then
      raise exception 'ABORTADO: a guarda NAO segurou — %.', v_falhou;
    end if;

    raise notice 'Comportamento OK: proposta CANCELADA com cobranca ativa permaneceu CANCELADA nas duas sobrecargas (teste desfeito por rollback).';
  end if;

  raise notice 'Saida OK: CANCELADO na guarda inicial das 2 sobrecargas, 5 UPDATE e as 2 checagens antigas mantidas, divergencia preservada.';
end
$saida$;


-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- Reverter e recriar as duas funcoes SEM 'CANCELADO' na lista da guarda
-- inicial — ou seja, voltar a permitir que proposta cancelada seja promovida
-- por trigger.
--
-- Nao ha rollback de dado: esta migration nao escreve em linha alguma. O bloco
-- de teste da assercao de saida e desfeito por rollback dentro da propria
-- transacao.
--
-- Para reverter, remova a linha
--
--        'CANCELADO',
--
-- da lista `if coalesce(v_status_atual, '') in ( ... ) then` das DUAS
-- sobrecargas, e restaure o comentario original do cabecalho da guarda na
-- sobrecarga integer, que dizia que CANCELADO ficava de fora "que precisa
-- seguir reativavel por nova cobranca".
--
-- As duas checagens `<> 'CANCELADO'` nos retornos antecipados nao foram
-- tocadas por esta migration e nao precisam de reversao.
-- =====================================================================
