-- Cadeia de arte — guarda de promocao, guarda de disparo e lista unica de aprovados
--
-- O QUE E
--   Tres ajustes na cadeia de triggers que liga pedidos_modelos.status_arte a
--   pedidos_artes.status e dai a propostas.status_interno / propostas.em_arte.
--   Nenhuma tabela, coluna, trigger ou status novo. Somente corpo de funcao.
--
--   A cadeia hoje:
--     pedidos_modelos (trg_sync_modelos_to_artes) -> sync_status_arte_to_briefing
--       -> recalcular_status_arte_briefing -> pedidos_artes.status
--         -> (trg_sync_artes_to_proposta) -> check_and_promote_proposta
--           -> propostas.status_interno
--     pedidos_modelos (trg_sync_arte_pendente) -> atualiza_flag_arte_proposta
--       -> propostas.em_arte
--
-- CONTEXTO
--   Dois projetos escrevem no mesmo banco. O outro projeto e dono da arte e
--   grava pedidos_modelos.status_arte pelo link do cliente e pelo painel dele,
--   com os valores PENDENTE, AGUARDANDO_CLIENTE, APROVADA_CLIENTE, APROVADA,
--   REPROVADA_CLIENTE e EM_REVISAO_INTERNA. Depois da liberacao ele continua
--   escrevendo em pedidos_modelos o tempo todo (IMPRESSO, numeracao,
--   quantidade, frente/verso, troca de arte). Pediram quatro condicoes; duas ja
--   estavam atendidas e por isso nao entram aqui:
--
--     Condicao 2 (nunca INSERT em pedidos_artes) — JA ATENDIDA.
--       recalcular_status_arte_briefing so escreve dentro de
--       "IF v_arte_id IS NOT NULL THEN UPDATE". Nenhuma funcao do banco insere
--       em pedidos_artes. Quem cria linha la e a aplicacao, em
--       salvarBriefingArtes (src/features/pedidos/services/pedidos-artes.service.ts),
--       que nao e tocado por esta migration.
--
--     Condicao 3 (caminho de volta na reprovacao) — JA ATENDIDA.
--       recalcular_status_arte_briefing recalcula do zero a cada disparo. Um
--       modelo que cai para REPROVADA_CLIENTE derruba v_aprovados, o status vira
--       'APROVADO PARCIAL' e a guarda "<> v_novo_status" deixa o UPDATE passar.
--       O APROVADO e desfeito sozinho. Levantamento em 20/08/2026: 0 propostas
--       seriam corrigidas por um backfill retroativo (0 de 41 propostas com arte
--       tem pedidos_artes.status = 'APROVADO' com algum modelo em
--       REPROVADA_CLIENTE). Nao ha backfill nesta migration.
--
-- ================================ ITEM A ==================================
-- O QUE ESTAVA ERRADO
--   check_and_promote_proposta nao le o status_interno atual. A unica guarda no
--   UPDATE final e "nao reescreva se ja for REVISAO ATENDENTE". Resultado: uma
--   proposta ja em EM PRODUCAO ou posterior que tenha a arte voltando a APROVADO
--   com pagamento confirmado e REBAIXADA para REVISAO ATENDENTE. Basta o outro
--   projeto trocar uma arte de um pedido que ja esta na fabrica.
--
--   Exposicao medida em 20/08/2026: das 41 propostas com linha em pedidos_artes,
--   33 estao em EM PRODUCAO ou posterior (30 EM PRODUCAO, 1 EM ACABAMENTO,
--   1 EXPEDICAO, 1 EM TRANSITO).
--
--   O rebaixamento nao tira a proposta de tela nenhuma: REVISAO ATENDENTE esta
--   tanto na lista do painel de Producao (pedidos-producao.service.ts) quanto em
--   STATUS_FUNIL_EXPEDICAO. O dano e semantico — o status regride, o historico
--   passa a mentir e portoes que leem status (podeEditarModalidade) reabrem.
--
-- O QUE MUDA
--   Uma condicao a mais no WHERE do UPDATE final. Lista NEGATIVA, e nao lista
--   branca de tres valores, de proposito: os status realmente gravados hoje
--   incluem LIBERADO (3231), APROVADO (3363), NOVO_ARTE_APROVADA (2),
--   'AGUARDANDO / EM ARTE' (1) e 302 NULL. Uma lista branca de
--   (NOVO, AGUARDANDO, REVISAO ATENDENTE) cortaria a promocao desses tambem —
--   mudanca de comportamento que a condicao aprovada nao pede. A lista negativa
--   entrega exatamente o invariante aprovado ("nunca rebaixa de EM PRODUCAO ou
--   posterior") e nada alem disso.
--
-- ================================ ITEM B ==================================
-- O QUE ESTAVA ERRADO
--   trg_sync_modelos_to_artes e trg_sync_arte_pendente disparam em
--   "UPDATE OF status_arte, id_int". O Postgres decide pela lista de colunas do
--   SET, nao pelos valores: um write de linha inteira (ORM, upsert do PostgREST
--   mandando todas as colunas) redispara a cadeia mesmo com status_arte
--   identico. Nenhuma das duas funcoes compara OLD com NEW.
--
--   Hoje o estrago e parcialmente contido: recalcular_status_arte_briefing
--   recalcula o mesmo valor e a guarda "<> v_novo_status" suprime o UPDATE em
--   pedidos_artes, entao trg_sync_artes_to_proposta nao dispara e
--   check_and_promote_proposta nao roda. Mas atualiza_flag_arte_proposta NAO tem
--   guarda equivalente: faz "UPDATE propostas SET em_arte = ..." incondicional
--   toda vez. Custo por escrita: lock de linha em propostas e updated_at novo,
--   por modelo. Num lote de 5 modelos sao 5 writes na mesma proposta.
--
--   (Sem spam de auditoria: updated_at e a unica coluna ignorada de propostas em
--   audit.config_v2, e o "if v_old = v_new then return new" de
--   audit.log_row_changes_v2 corta o log quando so ela muda.)
--
--   UPDATE de numeracao, quantidade ou status_producao NAO redispara nada hoje e
--   continua nao redisparando: essas colunas nao estao na lista dos triggers.
--
-- O QUE MUDA
--   Early-return nas duas funcoes quando o UPDATE nao mexeu em status_arte nem
--   em id_int. Cada uma respeita o proprio retorno: sync_status_arte_to_briefing
--   retorna NEW, atualiza_flag_arte_proposta retorna NULL (e AFTER e ja termina
--   com RETURN NULL).
--
-- ================================ ITEM D ==================================
-- O QUE ESTAVA ERRADO
--   As duas funcoes usam listas de "aprovado" DIFERENTES, e a divergencia bate
--   num dos seis valores que o outro projeto grava:
--
--     recalcular_status_arte_briefing  IN     (APROVADO, APROVADA_CLIENTE, LIBERADA, IMPRESSA, NAO_NECESSARIA)
--     atualiza_flag_arte_proposta      NOT IN (APROVADA, APROVADA_CLIENTE, LIBERADA, IMPRESSA, NAO_NECESSARIA)
--
--   Uma tem APROVADO e nao tem APROVADA. A outra tem APROVADA e nao tem
--   APROVADO. Caso vivo em 20/08/2026 — proposta 20927, modelo unico com
--   status_arte = 'APROVADA': em_arte ficou false (contou como aprovado) e
--   pedidos_artes.status ficou 'EM ARTE' (nao contou). Consequencia:
--   check_and_promote_proposta nunca a promove, liberarPropostaParaProducao a
--   recusaria por arte pendente, e mesmo assim o painel a mostra com arte
--   liberada. Parada em NOVO_ARTE_APROVADA.
--
--   PENDENTE, AGUARDANDO_CLIENTE, REPROVADA_CLIENTE e EM_REVISAO_INTERNA estao
--   fora das duas listas — correto, todos contam como pendente.
--
-- O QUE MUDA
--   As duas listas passam a conter APROVADO e APROVADA. Mais nada.
--
-- ================================ ESCOPO ==================================
--   Quatro funcoes, nao tres: o item D mora em recalcular_status_arte_briefing e
--   em atualiza_flag_arte_proposta; o item B mora em sync_status_arte_to_briefing
--   e em atualiza_flag_arte_proposta. A sobreposicao entre B e D e apenas
--   atualiza_flag_arte_proposta.
--
--   NAO faz backfill. NAO altera codigo de aplicacao. NAO toca
--   liberarPropostaParaProducao nem is_prd_aprovado. NAO cria nem recria
--   trigger: CREATE OR REPLACE FUNCTION preserva o oid, entao os tres triggers
--   continuam apontando para as mesmas funcoes.
--
--   SECURITY DEFINER e restatado onde ja existia (check_and_promote_proposta,
--   sync_status_arte_to_briefing, recalcular_status_arte_briefing) e NAO e
--   adicionado em atualiza_flag_arte_proposta, que hoje e SECURITY INVOKER
--   (prosecdef = false). CREATE OR REPLACE nao herda esse atributo — errar aqui
--   mudaria o modelo de permissao. Nenhuma das quatro tem proconfig, entao nao
--   ha clausula SET a restatar.
--
--   Observacao fora de escopo, registrada e NAO corrigida aqui: as tres funcoes
--   SECURITY DEFINER nao pinam search_path. Mudar isso alteraria a resolucao de
--   nomes e nao faz parte das condicoes aprovadas.
--
-- ORIGEM DO CORPO
--   Os corpos abaixo partem do banco VIVO (pg_get_functiondef em 20/08/2026),
--   nao do repositorio. Conferencia feita antes de escrever, comparando o corpo
--   entre $function$ ... $function$ normalizado (comentarios e espacos fora):
--
--     check_and_promote_proposta    repo 20260810:99  == vivo  (md5 7cf7a7ec..., 1252 chars)
--     atualiza_flag_arte_proposta   repo 20260818:64  == vivo  (md5 538694d7..., 1517 chars)
--     sync_status_arte_to_briefing     SEM BASELINE NO REPOSITORIO
--     recalcular_status_arte_briefing  SEM BASELINE NO REPOSITORIO
--
--   As duas ultimas nunca foram versionadas em .sql neste repositorio — nao ha
--   com o que compara-las. Por isso o rodape de rollback carrega o corpo VIVO
--   literal das quatro, capturado imediatamente antes desta migration.

begin;

-- ---------------------------------------------------------------------------
-- ITEM A — check_and_promote_proposta: nao promover a partir de EM PRODUCAO+
-- ---------------------------------------------------------------------------
create or replace function public.check_and_promote_proposta(p_id_int integer)
 returns void
 language plpgsql
 security definer
as $function$
DECLARE
    v_is_avulso boolean;
    v_pagamentos_total integer;
    v_pagamentos_confirmados integer;
    v_arte_status text;
    v_itens_total integer;
    v_itens_prateleira integer;
    v_arte_dispensada boolean;
BEGIN
    IF p_id_int IS NULL THEN
        RETURN;
    END IF;

    SELECT COALESCE(is_avulso, false)
    INTO v_is_avulso
    FROM public.propostas
    WHERE id_int = p_id_int;

    IF COALESCE(v_is_avulso, false) = true THEN
        RETURN;
    END IF;

    SELECT
        COUNT(*),
        COUNT(*) FILTER (
            WHERE COALESCE(UPPER(status), '') IN ('PAID', 'A_VENCER')
              AND COALESCE(confirmado, false) = true
        )
    INTO
        v_pagamentos_total,
        v_pagamentos_confirmados
    FROM public.pagamentos_v2
    WHERE id_int = p_id_int
      AND COALESCE(UPPER(status), '') NOT IN ('CANCELADO', 'CANCELADA');

    SELECT COALESCE(UPPER(status), '')
    INTO v_arte_status
    FROM public.pedidos_artes
    WHERE id_int = p_id_int
    ORDER BY created_at DESC
    LIMIT 1;

    SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE is_estoque IS TRUE)
    INTO
        v_itens_total,
        v_itens_prateleira
    FROM public.produtos_proposta
    WHERE id_int = p_id_int
      AND COALESCE(UPPER(status_item), '') <> 'CANCELADO';

    v_arte_dispensada := v_itens_total > 0 AND v_itens_total = v_itens_prateleira;

    IF v_pagamentos_total > 0
       AND v_pagamentos_total = v_pagamentos_confirmados
       AND (v_arte_status = 'APROVADO' OR v_arte_dispensada)
    THEN
        UPDATE public.propostas
        SET status_interno = 'REVISAO ATENDENTE'
        WHERE id_int = p_id_int
          AND COALESCE(status_interno, '') <> 'REVISAO ATENDENTE'
          -- ITEM A: a promocao so vale enquanto a proposta ainda esta na fase
          -- comercial/arte. De REVISAO PRODUCAO em diante ela seria um
          -- rebaixamento, e o pedido ja esta na fabrica.
          AND COALESCE(UPPER(status_interno), '') NOT IN (
                'REVISAO PRODUCAO',
                'EM PRODUCAO',
                'EM IMPRESSAO',
                'EM IMPRESSAO / PENDENTE',
                'EM ACABAMENTO',
                'EM ACABAMENTO / PENDENTE',
                'EXPEDICAO',
                'A RETIRAR',
                'EM TRANSITO',
                'RECEBIDO',
                'CANCELADO'
              );
    END IF;
END;
$function$;

-- ---------------------------------------------------------------------------
-- ITEM B — sync_status_arte_to_briefing: nao rodar quando nada mudou
-- ---------------------------------------------------------------------------
create or replace function public.sync_status_arte_to_briefing()
 returns trigger
 language plpgsql
 security definer
as $function$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM public.recalcular_status_arte_briefing(OLD.id_int);
        RETURN OLD;
    END IF;

    -- ITEM B: "UPDATE OF status_arte, id_int" dispara quando a coluna esta no
    -- SET, mesmo com valor identico. Write de linha inteira nao refaz a cadeia.
    IF TG_OP = 'UPDATE'
       AND NEW.status_arte IS NOT DISTINCT FROM OLD.status_arte
       AND NEW.id_int      IS NOT DISTINCT FROM OLD.id_int
    THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE'
       AND OLD.id_int IS DISTINCT FROM NEW.id_int
    THEN
        PERFORM public.recalcular_status_arte_briefing(OLD.id_int);
        PERFORM public.recalcular_status_arte_briefing(NEW.id_int);
        RETURN NEW;
    END IF;

    PERFORM public.recalcular_status_arte_briefing(NEW.id_int);

    RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- ITEM B + D — atualiza_flag_arte_proposta
--   B: early-return, retornando NULL (AFTER trigger)
--   D: lista de aprovados ganha APROVADO ao lado de APROVADA
--   Segue SECURITY INVOKER, como esta hoje.
-- ---------------------------------------------------------------------------
create or replace function public.atualiza_flag_arte_proposta()
 returns trigger
 language plpgsql
as $function$
DECLARE
  v_id_int integer;
  v_has_arte_pendente boolean;
  v_itens_total integer;
  v_itens_prateleira integer;
  v_arte_dispensada boolean;
BEGIN
  -- ITEM B: mesmo motivo do sync_status_arte_to_briefing. Aqui pesa mais,
  -- porque o UPDATE em propostas mais abaixo e incondicional.
  IF TG_OP = 'UPDATE'
     AND NEW.status_arte IS NOT DISTINCT FROM OLD.status_arte
     AND NEW.id_int      IS NOT DISTINCT FROM OLD.id_int
  THEN
    RETURN NULL;
  END IF;

  -- Processar para o registro antigo (em caso de DELETE ou UPDATE que mude o id_int)
  IF (TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.id_int IS DISTINCT FROM NEW.id_int)) THEN
    IF OLD.id_int IS NOT NULL THEN
      -- Arte dispensada: ao menos um item ativo e TODOS de prateleira. Mesma
      -- conta de check_and_promote_proposta — item cancelado fora, zero itens
      -- nunca dispensa (e ai o EXISTS de sempre decide).
      SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE is_estoque IS TRUE)
      INTO
        v_itens_total,
        v_itens_prateleira
      FROM public.produtos_proposta
      WHERE id_int = OLD.id_int
        AND COALESCE(UPPER(status_item), '') <> 'CANCELADO';

      v_arte_dispensada := v_itens_total > 0 AND v_itens_total = v_itens_prateleira;

      IF v_arte_dispensada THEN
        v_has_arte_pendente := false;
      ELSE
        SELECT EXISTS (
          SELECT 1 FROM public.pedidos_modelos
          WHERE id_int = OLD.id_int
          -- ITEM D: lista unica de aprovados, com APROVADO e APROVADA.
          AND COALESCE(upper(status_arte), '') NOT IN ('APROVADO', 'APROVADA', 'APROVADA_CLIENTE', 'LIBERADA', 'IMPRESSA', 'NAO_NECESSARIA')
        ) INTO v_has_arte_pendente;
      END IF;

      UPDATE public.propostas
      SET em_arte = v_has_arte_pendente
      WHERE id_int = OLD.id_int;
    END IF;
  END IF;

  -- Processar para o registro novo (em caso de INSERT ou UPDATE)
  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') THEN
    IF NEW.id_int IS NOT NULL THEN
      SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE is_estoque IS TRUE)
      INTO
        v_itens_total,
        v_itens_prateleira
      FROM public.produtos_proposta
      WHERE id_int = NEW.id_int
        AND COALESCE(UPPER(status_item), '') <> 'CANCELADO';

      v_arte_dispensada := v_itens_total > 0 AND v_itens_total = v_itens_prateleira;

      IF v_arte_dispensada THEN
        v_has_arte_pendente := false;
      ELSE
        SELECT EXISTS (
          SELECT 1 FROM public.pedidos_modelos
          WHERE id_int = NEW.id_int
          -- ITEM D: lista unica de aprovados, com APROVADO e APROVADA.
          AND COALESCE(upper(status_arte), '') NOT IN ('APROVADO', 'APROVADA', 'APROVADA_CLIENTE', 'LIBERADA', 'IMPRESSA', 'NAO_NECESSARIA')
        ) INTO v_has_arte_pendente;
      END IF;

      UPDATE public.propostas
      SET em_arte = v_has_arte_pendente
      WHERE id_int = NEW.id_int;
    END IF;
  END IF;

  RETURN NULL; -- AFTER trigger
END;
$function$;

-- ---------------------------------------------------------------------------
-- ITEM D — recalcular_status_arte_briefing: mesma lista de aprovados
-- ---------------------------------------------------------------------------
create or replace function public.recalcular_status_arte_briefing(p_id_int integer)
 returns void
 language plpgsql
 security definer
as $function$
DECLARE
    v_total_modelos integer;
    v_aprovados integer;
    v_arte_id uuid;
    v_novo_status text;
BEGIN
    IF p_id_int IS NULL THEN
        RETURN;
    END IF;

    SELECT
        COUNT(*),
        COUNT(*) FILTER (
            -- ITEM D: lista unica de aprovados, com APROVADO e APROVADA.
            WHERE COALESCE(UPPER(status_arte), '') IN (
                'APROVADO',
                'APROVADA',
                'APROVADA_CLIENTE',
                'LIBERADA',
                'IMPRESSA',
                'NAO_NECESSARIA'
            )
        )
    INTO
        v_total_modelos,
        v_aprovados
    FROM public.pedidos_modelos
    WHERE id_int = p_id_int;

    IF v_total_modelos = 0 THEN
        RETURN;
    END IF;

    IF v_total_modelos = v_aprovados THEN
        v_novo_status := 'APROVADO';
    ELSIF v_aprovados > 0 THEN
        v_novo_status := 'APROVADO PARCIAL';
    ELSE
        v_novo_status := 'EM ARTE';
    END IF;

    SELECT id
    INTO v_arte_id
    FROM public.pedidos_artes
    WHERE id_int = p_id_int
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_arte_id IS NOT NULL THEN
        UPDATE public.pedidos_artes
        SET status = v_novo_status
        WHERE id = v_arte_id
          AND COALESCE(status, '') <> v_novo_status;
    END IF;
END;
$function$;

commit;


-- ===========================================================================
-- VERIFICACOES (somente leitura, rodar DEPOIS)
-- ===========================================================================
--
-- V1. Os tres triggers continuam apontando para as mesmas funcoes, com os
--     mesmos eventos e as mesmas listas de coluna.
--
--       select c.relname as tabela, t.tgname, p.proname as funcao,
--              pg_get_triggerdef(t.oid) as def
--       from pg_trigger t
--       join pg_class c on c.oid = t.tgrelid
--       join pg_proc  p on p.oid = t.tgfoid
--       where not t.tgisinternal
--         and c.relname in ('pedidos_modelos','pedidos_artes')
--       order by c.relname, t.tgname;
--
--     ESPERADO — identico ao capturado em 20/08/2026, exatamente tres linhas:
--       pedidos_artes   | trg_sync_artes_to_proposta | trg_sync_artes_to_proposta_func
--         CREATE TRIGGER trg_sync_artes_to_proposta AFTER UPDATE OF status
--         ON public.pedidos_artes FOR EACH ROW EXECUTE FUNCTION trg_sync_artes_to_proposta_func()
--       pedidos_modelos | trg_sync_arte_pendente     | atualiza_flag_arte_proposta
--         CREATE TRIGGER trg_sync_arte_pendente AFTER INSERT OR DELETE OR UPDATE OF status_arte, id_int
--         ON public.pedidos_modelos FOR EACH ROW EXECUTE FUNCTION atualiza_flag_arte_proposta()
--       pedidos_modelos | trg_sync_modelos_to_artes  | sync_status_arte_to_briefing
--         CREATE TRIGGER trg_sync_modelos_to_artes AFTER INSERT OR DELETE OR UPDATE OF status_arte, id_int
--         ON public.pedidos_modelos FOR EACH ROW EXECUTE FUNCTION sync_status_arte_to_briefing()
--
--     Qualquer diferenca em AFTER/BEFORE, na lista de eventos ou na lista de
--     colunas significa que algo alem do corpo foi tocado. Rollback.
--
--
-- V2. prosecdef e proconfig inalterados nas quatro funcoes.
--
--       select p.proname, p.prosecdef, coalesce(p.proconfig::text,'(null)') as proconfig,
--              p.provolatile, pg_get_userbyid(p.proowner) as owner
--       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname = 'public'
--         and p.proname in ('check_and_promote_proposta','sync_status_arte_to_briefing',
--                           'atualiza_flag_arte_proposta','recalcular_status_arte_briefing')
--       order by p.proname;
--
--     ESPERADO (igual ao de antes):
--       atualiza_flag_arte_proposta      | prosecdef f | proconfig (null) | v | postgres
--       check_and_promote_proposta       | prosecdef t | proconfig (null) | v | postgres
--       recalcular_status_arte_briefing  | prosecdef t | proconfig (null) | v | postgres
--       sync_status_arte_to_briefing     | prosecdef t | proconfig (null) | v | postgres
--
--     prosecdef = f em atualiza_flag_arte_proposta e o ponto sensivel: se vier
--     't', o CREATE OR REPLACE adicionou SECURITY DEFINER por engano. Rollback.
--
--
-- V3. ACL completo das quatro, comparado com o de antes.
--
--       select p.proname,
--              coalesce(p.proacl::text,'(null = default)') as proacl_raw,
--              (select coalesce(array_agg(a.grantee::regrole::text order by a.grantee::regrole::text),'{}')
--                 from aclexplode(p.proacl) a) as acl_grantees
--       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname = 'public'
--         and p.proname in ('check_and_promote_proposta','sync_status_arte_to_briefing',
--                           'atualiza_flag_arte_proposta','recalcular_status_arte_briefing')
--       order by p.proname;
--
--     ESPERADO — as QUATRO com exatamente:
--       proacl_raw    {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--       acl_grantees  {-,anon,authenticated,postgres,service_role}
--
--     ("-" e o PUBLIC.) CREATE OR REPLACE preserva ACL e owner; esta verificacao
--     existe para provar isso, nao para presumir.
--
--
-- V4. Propostas em REVISAO ATENDENTE antes x depois — deve ser IDENTICA.
--
--       select count(*) filter (where status_interno = 'REVISAO ATENDENTE') as revisao_atendente
--       from public.propostas;
--
--     ANTES (20/08/2026, imediatamente antes do apply):  1
--     DEPOIS:                                            1
--
--     POR QUE NAO A CONTAGEM TOTAL. A primeira versao desta verificacao comparava
--     o total de propostas e a contagem por status_interno contra um snapshot
--     fixo (8275 linhas em 14 valores). Nao serve: o sistema esta em uso, e a
--     contagem se move sozinha a cada poucos minutos. Na propria janela deste
--     apply o total foi de 8275 para 8276 antes de comecar e para 8279 logo
--     depois, com 'REVISAO PRODUCAO' zerando — tudo de gente trabalhando. O
--     audit.logs_v2 da janela mostrou 19 transicoes, todas com app_name =
--     'postgrest', actor_role = 'authenticated' e ator nomeado; nenhuma por
--     caminho de trigger. Um baseline movel nunca fecha e transforma a
--     verificacao em falso positivo garantido.
--
--     POR QUE ESTE RECORTE FUNCIONA. A cadeia inteira so sabe escrever UM valor
--     em status_interno: 'REVISAO ATENDENTE', no UPDATE final de
--     check_and_promote_proposta. Nenhum outro valor pode vir dela. Entao esse
--     contador isolado e exatamente a superficie que a migration poderia ter
--     tocado — se ele nao se moveu, a cadeia nao promoveu nada. Movimento em
--     LIBERADO, EM PRODUCAO, NOVO ou qualquer outro status e, por construcao,
--     de outra origem.
--
--     Se ele TIVER subido, ai sim investigue: cruze com audit.logs_v2 filtrando
--     changed_fields ? 'status_interno' e new_data->>'status_interno' =
--     'REVISAO ATENDENTE' na janela do apply, e olhe o actor_email. Promocao
--     legitima tem ator nomeado via postgrest; promocao da cadeia vem sem ator.
--
--
-- V5. A proposta 20927 — o caso vivo do item D.
--
--       select p.id_int, p.status_interno, p.em_arte, p.is_prd_aprovado,
--              (select a.status from public.pedidos_artes a
--                where a.id_int = p.id_int order by a.created_at desc limit 1) as arte_status,
--              (select string_agg(m.nome_modelo || '=' || m.status_arte, ', ')
--                 from public.pedidos_modelos m where m.id_int = p.id_int) as modelos
--       from public.propostas p where p.id_int = 20927;
--
--     ESPERADO LOGO DEPOIS DA MIGRATION — NADA MUDA:
--       status_interno NOVO_ARTE_APROVADA | em_arte false | arte_status 'EM ARTE'
--       modelos: Pulseiras=APROVADA
--
--     POR QUE. As funcoes so rodam quando disparadas, e esta migration nao faz
--     backfill. A 20927 fica PARADA no estado inconsistente atual: em_arte=false
--     (a lista de atualiza_flag_arte_proposta ja aceitava APROVADA, e depois do
--     item D continua aceitando — para ela nada muda ai) enquanto
--     pedidos_artes.status segue 'EM ARTE'. Com a arte fora de 'APROVADO',
--     check_and_promote_proposta nao a promove e liberarPropostaParaProducao a
--     recusaria.
--
--     O QUE A DESTRAVA. Um disparo real de trg_sync_modelos_to_artes nela:
--     INSERT ou DELETE de um pedidos_modelos seu, ou um UPDATE que MUDE de fato
--     status_arte ou id_int de um modelo seu. Nesse disparo,
--     recalcular_status_arte_briefing passa a contar APROVADA como aprovado
--     (1 de 1), grava pedidos_artes.status = 'APROVADO', o que dispara
--     trg_sync_artes_to_proposta -> check_and_promote_proposta; com o pagamento
--     confirmado e com NOVO_ARTE_APROVADA fora da lista negativa do item A, ela
--     e promovida a REVISAO ATENDENTE e passa a poder ser liberada pela tela.
--
--     ATENCAO — o item B torna esse disparo MAIS DIFICIL do que era: antes, um
--     write de linha inteira que apenas repetisse status_arte ja teria refeito a
--     conta. Depois do item B, so uma mudanca real de valor dispara. Ou seja: a
--     20927 NAO se resolve sozinha. Resolve-la e decisao separada, fora desta
--     migration, que por instrucao nao faz backfill.
--
--
-- V6. Regressao do item B — o caminho de volta (condicao 3) continua vivo.
--     Em ambiente de teste, num pedido com todos os modelos aprovados e
--     pedidos_artes.status = 'APROVADO':
--       a) UPDATE pedidos_modelos SET quantidade = quantidade  -> nada dispara;
--       b) UPDATE pedidos_modelos SET status_arte = status_arte -> early-return,
--          nenhum write em propostas (conferir propostas.updated_at inalterado);
--       c) UPDATE pedidos_modelos SET status_arte = 'REPROVADA_CLIENTE' em UM
--          modelo -> pedidos_artes.status vira 'APROVADO PARCIAL' e
--          propostas.em_arte volta a true;
--       d) com a proposta em 'EM PRODUCAO', levar todos os modelos de volta a
--          APROVADA_CLIENTE -> pedidos_artes.status volta a 'APROVADO' e
--          propostas.status_interno PERMANECE 'EM PRODUCAO' (item A).
--
--     ARMADILHA DO SETUP. Inserir a linha em pagamentos_v2 reescreve
--     status_interno: trg_sync_status_proposta -> tg_sync_status_financeiro_proposta
--     -> atualizar_status_financeiro_proposta, que grava 'APROVADO'. Na primeira
--     tentativa isso levou a proposta de 'EM PRODUCAO' para 'APROVADO' e
--     invalidou o passo d, que passou a medir promocao a partir de APROVADO —
--     comportamento correto, teste errado. Monte o pagamento ANTES e so entao
--     force status_interno para o cenario desejado, imediatamente antes de mexer
--     nos modelos.
--
--     (Nao confundir com tg_atualiza_status_proposta_pagamento /
--     atualizar_status_proposta_por_pagamento, que grava 'NOVO' / 'A_RECEBER' /
--     'QUITADO': esse trigger esta DESABILITADO, tgenabled = 'D'.)
--
--     SEGUNDA PORTA DO ITEM A. pagamentos_v2 tem trg_sync_finiro_to_proposta ->
--     trg_sync_financeiro_to_proposta_func, que chama check_and_promote_proposta
--     direto. Ou seja, o item A tambem passa a proteger o caminho financeiro:
--     lancar ou confirmar pagamento num pedido ja em producao nao o rebaixa
--     mais para REVISAO ATENDENTE. Nao era o alvo da mudanca, mas e efeito dela.
--
--     RESULTADO EM 20/08/2026 (sandbox em transacao abortada, zero residuo):
--       a) quantidade = quantidade      -> nenhuma escrita em propostas; arte intacta
--       b) status_arte = status_arte    -> nenhuma escrita em propostas; arte intacta  [item B]
--       c) 1 modelo -> REPROVADA_CLIENTE-> arte 'APROVADO PARCIAL', em_arte true      [condicao 3]
--       d) reaprovar tudo em EM PRODUCAO-> arte 'APROVADO', status SEGUE EM PRODUCAO  [item A]
--       e) AGUARDANDO + 'APROVADA'      -> arte 'APROVADO', promovida a REVISAO ATENDENTE [item D]


-- ===========================================================================
-- ROLLBACK — corpo anterior literal das quatro funcoes
-- (pg_get_functiondef em 20/08/2026, antes desta migration)
-- ===========================================================================
--
-- begin;
--
-- CREATE OR REPLACE FUNCTION public.check_and_promote_proposta(p_id_int integer)
--  RETURNS void
--  LANGUAGE plpgsql
--  SECURITY DEFINER
-- AS $function$
-- DECLARE
--     v_is_avulso boolean;
--     v_pagamentos_total integer;
--     v_pagamentos_confirmados integer;
--     v_arte_status text;
--     v_itens_total integer;
--     v_itens_prateleira integer;
--     v_arte_dispensada boolean;
-- BEGIN
--     IF p_id_int IS NULL THEN
--         RETURN;
--     END IF;
--
--     SELECT COALESCE(is_avulso, false)
--     INTO v_is_avulso
--     FROM public.propostas
--     WHERE id_int = p_id_int;
--
--     IF COALESCE(v_is_avulso, false) = true THEN
--         RETURN;
--     END IF;
--
--     SELECT
--         COUNT(*),
--         COUNT(*) FILTER (
--             WHERE COALESCE(UPPER(status), '') IN ('PAID', 'A_VENCER')
--               AND COALESCE(confirmado, false) = true
--         )
--     INTO
--         v_pagamentos_total,
--         v_pagamentos_confirmados
--     FROM public.pagamentos_v2
--     WHERE id_int = p_id_int
--       AND COALESCE(UPPER(status), '') NOT IN ('CANCELADO', 'CANCELADA');
--
--     SELECT COALESCE(UPPER(status), '')
--     INTO v_arte_status
--     FROM public.pedidos_artes
--     WHERE id_int = p_id_int
--     ORDER BY created_at DESC
--     LIMIT 1;
--
--     SELECT
--         COUNT(*),
--         COUNT(*) FILTER (WHERE is_estoque IS TRUE)
--     INTO
--         v_itens_total,
--         v_itens_prateleira
--     FROM public.produtos_proposta
--     WHERE id_int = p_id_int
--       AND COALESCE(UPPER(status_item), '') <> 'CANCELADO';
--
--     v_arte_dispensada := v_itens_total > 0 AND v_itens_total = v_itens_prateleira;
--
--     IF v_pagamentos_total > 0
--        AND v_pagamentos_total = v_pagamentos_confirmados
--        AND (v_arte_status = 'APROVADO' OR v_arte_dispensada)
--     THEN
--         UPDATE public.propostas
--         SET status_interno = 'REVISAO ATENDENTE'
--         WHERE id_int = p_id_int
--           AND COALESCE(status_interno, '') <> 'REVISAO ATENDENTE';
--     END IF;
-- END;
-- $function$;
--
-- CREATE OR REPLACE FUNCTION public.sync_status_arte_to_briefing()
--  RETURNS trigger
--  LANGUAGE plpgsql
--  SECURITY DEFINER
-- AS $function$
-- BEGIN
--     IF TG_OP = 'DELETE' THEN
--         PERFORM public.recalcular_status_arte_briefing(OLD.id_int);
--         RETURN OLD;
--     END IF;
--
--     IF TG_OP = 'UPDATE'
--        AND OLD.id_int IS DISTINCT FROM NEW.id_int
--     THEN
--         PERFORM public.recalcular_status_arte_briefing(OLD.id_int);
--         PERFORM public.recalcular_status_arte_briefing(NEW.id_int);
--         RETURN NEW;
--     END IF;
--
--     PERFORM public.recalcular_status_arte_briefing(NEW.id_int);
--
--     RETURN NEW;
-- END;
-- $function$;
--
-- CREATE OR REPLACE FUNCTION public.atualiza_flag_arte_proposta()
--  RETURNS trigger
--  LANGUAGE plpgsql
-- AS $function$
-- DECLARE
--   v_id_int integer;
--   v_has_arte_pendente boolean;
--   v_itens_total integer;
--   v_itens_prateleira integer;
--   v_arte_dispensada boolean;
-- BEGIN
--   -- Processar para o registro antigo (em caso de DELETE ou UPDATE que mude o id_int)
--   IF (TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.id_int IS DISTINCT FROM NEW.id_int)) THEN
--     IF OLD.id_int IS NOT NULL THEN
--       -- Arte dispensada: ao menos um item ativo e TODOS de prateleira. Mesma
--       -- conta de check_and_promote_proposta — item cancelado fora, zero itens
--       -- nunca dispensa (e ai o EXISTS de sempre decide).
--       SELECT
--         COUNT(*),
--         COUNT(*) FILTER (WHERE is_estoque IS TRUE)
--       INTO
--         v_itens_total,
--         v_itens_prateleira
--       FROM public.produtos_proposta
--       WHERE id_int = OLD.id_int
--         AND COALESCE(UPPER(status_item), '') <> 'CANCELADO';
--
--       v_arte_dispensada := v_itens_total > 0 AND v_itens_total = v_itens_prateleira;
--
--       IF v_arte_dispensada THEN
--         v_has_arte_pendente := false;
--       ELSE
--         SELECT EXISTS (
--           SELECT 1 FROM public.pedidos_modelos
--           WHERE id_int = OLD.id_int
--           AND COALESCE(upper(status_arte), '') NOT IN ('APROVADA', 'APROVADA_CLIENTE', 'LIBERADA', 'IMPRESSA', 'NAO_NECESSARIA')
--         ) INTO v_has_arte_pendente;
--       END IF;
--
--       UPDATE public.propostas
--       SET em_arte = v_has_arte_pendente
--       WHERE id_int = OLD.id_int;
--     END IF;
--   END IF;
--
--   -- Processar para o registro novo (em caso de INSERT ou UPDATE)
--   IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') THEN
--     IF NEW.id_int IS NOT NULL THEN
--       SELECT
--         COUNT(*),
--         COUNT(*) FILTER (WHERE is_estoque IS TRUE)
--       INTO
--         v_itens_total,
--         v_itens_prateleira
--       FROM public.produtos_proposta
--       WHERE id_int = NEW.id_int
--         AND COALESCE(UPPER(status_item), '') <> 'CANCELADO';
--
--       v_arte_dispensada := v_itens_total > 0 AND v_itens_total = v_itens_prateleira;
--
--       IF v_arte_dispensada THEN
--         v_has_arte_pendente := false;
--       ELSE
--         SELECT EXISTS (
--           SELECT 1 FROM public.pedidos_modelos
--           WHERE id_int = NEW.id_int
--           AND COALESCE(upper(status_arte), '') NOT IN ('APROVADA', 'APROVADA_CLIENTE', 'LIBERADA', 'IMPRESSA', 'NAO_NECESSARIA')
--         ) INTO v_has_arte_pendente;
--       END IF;
--
--       UPDATE public.propostas
--       SET em_arte = v_has_arte_pendente
--       WHERE id_int = NEW.id_int;
--     END IF;
--   END IF;
--
--   RETURN NULL; -- AFTER trigger
-- END;
-- $function$;
--
-- CREATE OR REPLACE FUNCTION public.recalcular_status_arte_briefing(p_id_int integer)
--  RETURNS void
--  LANGUAGE plpgsql
--  SECURITY DEFINER
-- AS $function$
-- DECLARE
--     v_total_modelos integer;
--     v_aprovados integer;
--     v_arte_id uuid;
--     v_novo_status text;
-- BEGIN
--     IF p_id_int IS NULL THEN
--         RETURN;
--     END IF;
--
--     SELECT
--         COUNT(*),
--         COUNT(*) FILTER (
--             WHERE COALESCE(UPPER(status_arte), '') IN (
--                 'APROVADO',
--                 'APROVADA_CLIENTE',
--                 'LIBERADA',
--                 'IMPRESSA',
--                 'NAO_NECESSARIA'
--             )
--         )
--     INTO
--         v_total_modelos,
--         v_aprovados
--     FROM public.pedidos_modelos
--     WHERE id_int = p_id_int;
--
--     IF v_total_modelos = 0 THEN
--         RETURN;
--     END IF;
--
--     IF v_total_modelos = v_aprovados THEN
--         v_novo_status := 'APROVADO';
--     ELSIF v_aprovados > 0 THEN
--         v_novo_status := 'APROVADO PARCIAL';
--     ELSE
--         v_novo_status := 'EM ARTE';
--     END IF;
--
--     SELECT id
--     INTO v_arte_id
--     FROM public.pedidos_artes
--     WHERE id_int = p_id_int
--     ORDER BY created_at DESC
--     LIMIT 1;
--
--     IF v_arte_id IS NOT NULL THEN
--         UPDATE public.pedidos_artes
--         SET status = v_novo_status
--         WHERE id = v_arte_id
--           AND COALESCE(status, '') <> v_novo_status;
--     END IF;
-- END;
-- $function$;
--
-- commit;
