-- Produto de prateleira — o flag propostas.em_arte tambem dispensa a arte
--
-- O QUE ESTAVA ERRADO
--   A migration 20260810_produto_prateleira_is_estoque ensinou a promocao
--   LIBERADO -> REVISAO ATENDENTE a pular a arte quando todos os itens ativos
--   sao de prateleira (check_and_promote_proposta). Isso funciona.
--
--   Mas existe um SEGUNDO portao de arte que ficou de fora: o flag
--   public.propostas.em_arte, calculado exclusivamente pelo trigger
--   trg_sync_arte_pendente -> atualiza_flag_arte_proposta(). Esse trigger nao
--   conhece prateleira: ele so pergunta se existe algum pedidos_modelos com
--   status_arte fora da lista de aprovados.
--
--   Pedido de prateleira TEM modelos — os lotes de cor/quantidade da aba
--   Pedido — e eles nascem status_arte = 'PENDENTE'. Como nao ha arte para
--   aprovar, ninguem nunca muda esse status: em_arte fica true para sempre e a
--   proposta trava numa etapa que nao tem como ser concluida:
--
--     - a lista de orcamentos exibe "LIBERADO / EM ARTE" (composeStatusEmArte)
--       e joga a proposta no card EM ARTE (filtro em_arte.eq.true);
--     - a lista de producao cria a pendencia permanente
--       "Aguardando liberacao de arte (ou arquivo pendente)".
--
--   O doc FLUXO-OFICIAL-STATUS-PROPOSTAS.md §8.1 afirmava que "sem modelos,
--   propostas.em_arte permanece false pelo proprio trigger existente". A
--   premissa nao se sustenta: pedido de prateleira tem modelos.
--
--   Evidencia em 18/08/2026 (propostas 100% prateleira com em_arte = true):
--     20369 NOVO (3 modelos pendentes), 20370 APROVADO (1),
--     20382 EM TRANSITO (6), 20413 EM ACABAMENTO (13),
--     20440 EM PRODUCAO (4), 20464 EM TRANSITO (1).
--   A 20792 so escapou porque alguem aprovou as artes na mao para destravar.
--
-- O QUE MUDA
--   Somente o corpo de atualiza_flag_arte_proposta(). Um ramo de dispensa
--   entra ANTES do EXISTS atual: quando a arte esta dispensada, em_arte = false
--   sem sequer olhar os modelos. Nenhuma coluna nova, nenhum status novo,
--   nenhum trigger novo, nenhuma politica de RLS tocada, nenhuma linha do app.
--
--   A definicao de "arte dispensada" e LITERALMENTE a mesma ja usada em
--   check_and_promote_proposta (10/08/2026):
--
--     ao menos um item ativo (status_item <> 'CANCELADO')
--     E todos os itens ativos com produtos_proposta.is_estoque = true
--
--   Consequencias diretas da igualdade: proposta com QUALQUER item nao-prateleira
--   segue exatamente o comportamento de hoje, e proposta SEM itens tambem — zero
--   itens nunca dispensa, entao o EXISTS de sempre continua decidindo.
--
-- O QUE NAO MUDA
--   - fluxo completo das propostas com arte;
--   - status_arte dos modelos existentes (o backfill abaixo nao escreve nele);
--   - produtos.is_estoque / produtos_proposta.is_estoque;
--   - trg_audit_propostas / audit.log_row_changes_v2, que continua gravando
--     cada UPDATE em propostas, inclusive os do backfill;
--   - a ordem e o comportamento dos triggers de status_interno em pagamentos_v2.
--
-- KILL-SWITCH NATURAL
--   Enquanto nenhum produto estiver marcado como prateleira, v_arte_dispensada
--   e sempre falso e a funcao e bit a bit a de hoje.

-- 1. Trigger de em_arte ------------------------------------------------------

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
          AND COALESCE(upper(status_arte), '') NOT IN ('APROVADA', 'APROVADA_CLIENTE', 'LIBERADA', 'IMPRESSA', 'NAO_NECESSARIA')
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
          AND COALESCE(upper(status_arte), '') NOT IN ('APROVADA', 'APROVADA_CLIENTE', 'LIBERADA', 'IMPRESSA', 'NAO_NECESSARIA')
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

-- 2. Backfill ----------------------------------------------------------------
--    Re-dispara o CALCULO nas propostas ja marcadas, em vez de escrever
--    em_arte na mao: o UPDATE toca id_int (coluna que o trigger observa, junto
--    com status_arte) gravando o mesmo valor, o trigger roda e recalcula.
--    status_arte fica intocado de proposito.
--
--    Nenhuma dessas propostas tem linha em pedidos_artes (conferido em
--    18/08/2026), entao o trg_sync_modelos_to_artes que dispara junto nao tem
--    briefing para atualizar — recalcular_status_arte_briefing sai sem escrever.
--
--    A 20792 fica de fora: ja esta com em_arte = false (artes aprovadas na mao)
--    e nao ha o que recalcular.

update public.pedidos_modelos
set id_int = id_int
where id_int in (20464, 20440, 20413, 20382, 20370, 20369);

-- 3. Residuo anterior a 10/08 -------------------------------------------------
--    A 20370 foi paga em 08/08/2026, ANTES da migration que ensinou
--    check_and_promote_proposta a dispensar arte. O trigger de pagamentos nao
--    voltou a disparar desde entao, e por isso ela ficou em APROVADO em vez de
--    REVISAO ATENDENTE. Uma chamada da propria funcao oficial reavalia — sem
--    UPDATE manual de status_interno, sem pular nenhuma regra: se a cobertura
--    financeira nao estiver integral, a funcao simplesmente nao promove.

select public.check_and_promote_proposta(20370);

-- 4. Conferencia pos-aplicacao (somente leitura) ------------------------------
--
--      select id_int, status_interno, em_arte
--      from public.propostas
--      where id_int in (20464,20440,20413,20382,20370,20369,20792)
--      order by id_int;
--
--      Esperado: em_arte = false nas seis do backfill, 20792 inalterada
--      (EM TRANSITO / false) e 20370 em REVISAO ATENDENTE.
--
--      select pg_get_functiondef(p.oid) from pg_proc p
--      join pg_namespace n on n.oid = p.pronamespace
--      where n.nspname='public' and p.proname='atualiza_flag_arte_proposta';
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK — definicao anterior de atualiza_flag_arte_proposta (18/08/2026)
--
--   Restaurar a funcao abaixo faz em_arte voltar a ignorar prateleira. As
--   propostas do backfill voltam a em_arte = true no proximo evento de modelo.
--   Nenhum objeto novo foi criado, entao nao ha nada a remover.
--   A promocao da 20370 nao se desfaz por aqui — se for preciso, o caminho e a
--   devolucao para REVISAO ATENDENTE pela propria tela, preservando auditoria.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- CREATE OR REPLACE FUNCTION public.atualiza_flag_arte_proposta()
--  RETURNS trigger
--  LANGUAGE plpgsql
-- AS $function$
-- DECLARE
--   v_id_int integer;
--   v_has_arte_pendente boolean;
-- BEGIN
--   -- Processar para o registro antigo (em caso de DELETE ou UPDATE que mude o id_int)
--   IF (TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.id_int IS DISTINCT FROM NEW.id_int)) THEN
--     IF OLD.id_int IS NOT NULL THEN
--       SELECT EXISTS (
--         SELECT 1 FROM public.pedidos_modelos
--         WHERE id_int = OLD.id_int
--         AND COALESCE(upper(status_arte), '') NOT IN ('APROVADA', 'APROVADA_CLIENTE', 'LIBERADA', 'IMPRESSA', 'NAO_NECESSARIA')
--       ) INTO v_has_arte_pendente;
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
--       SELECT EXISTS (
--         SELECT 1 FROM public.pedidos_modelos
--         WHERE id_int = NEW.id_int
--         AND COALESCE(upper(status_arte), '') NOT IN ('APROVADA', 'APROVADA_CLIENTE', 'LIBERADA', 'IMPRESSA', 'NAO_NECESSARIA')
--       ) INTO v_has_arte_pendente;
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
