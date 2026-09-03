-- =====================================================================
-- recalcular_proposta_v3: SELECT INTO deixa de produzir valor_total NULL
-- =====================================================================
--
-- O QUE
-- -----
-- Dois `SELECT ... INTO` da funcao nao tratam LINHA AUSENTE. Quando a consulta
-- nao devolve nenhuma linha, o PL/pgSQL atribui NULL as variaveis — inclusive as
-- que foram inicializadas com zero no DECLARE. O `COALESCE` que esta la protege
-- contra COLUNA nula, nao contra a ausencia da linha.
--
-- Resultado: `valor_total = v_valor_produtos - NULL + v_frete` = NULL.
--
-- OS DOIS PONTOS
-- --------------
--   2) `cotacao_frete ... WHERE escolhido = true`  -> proposta sem cotacao
--      escolhida deixa `v_frete` NULL;
--   3) `desconto_proposta ... WHERE id_int = ...`  -> proposta sem desconto
--      deixa `v_desconto` e `v_percentual` NULL.
--
-- O item 1) NAO tem o problema: `SUM()` sem GROUP BY sempre devolve uma linha,
-- entao o `COALESCE` ali basta. Ele fica exatamente como esta.
--
-- COMO APARECEU
-- -------------
-- Medido em 03/09/2026, num teste em transacao abortada no pedido 21207
-- (EXPEDICAO, sem desconto): trocar a modalidade recalculou o total para NULL.
-- O `status_interno` ficou intacto — a guarda de status protegido funciona —,
-- mas o valor sumiu.
--
-- O TAMANHO
-- ---------
-- 812 propostas com `valor_total` NULL no banco hoje:
--     801 sem desconto
--     451 sem cotacao escolhida
--     447 sem os dois
--       7 com os dois presentes  <- causa DIFERENTE, esta migration nao explica
--     188 avulsas
-- Por status: NOVO 397, sem status 263, APROVADO 118, AGUARDANDO 24,
--             CANCELADO 5, EM PRODUCAO 2, LIBERADO 1, EM TRANSITO 1,
--             AGUARDANDO / EM ARTE 1.
-- Apenas 1 esta liberada para producao. Nenhuma tem NF-e AUTORIZADA.
-- A mais recente e de 04/08/2026 — o defeito parou de produzir volume, mas a
-- causa continua viva e volta a produzir a cada gravacao de frete.
--
-- QUEM MASCARA O DEFEITO HOJE (nao e so o saveProposta)
-- -----------------------------------------------------
--   * `saveProposta` grava o `valor_total` calculado no cliente logo depois do
--     recalculo — e o padrao `valor_total: null` seguido de `valor_total: 628.05`
--     que aparece na auditoria;
--   * `mappers.ts` da lista de Orcamentos tem fallback proprio: sem
--     `valor_total` ele usa `valor + valor_frete`;
--   * `soma_propostas_filtradas` soma `valor`, nao `valor_total`, entao nao
--     enxerga o problema.
-- Sao tres camadas escondendo a mesma origem. Esta migration trata a ORIGEM;
-- nenhum dos tres mascaramentos e removido aqui.
--
-- O QUE ESTA MIGRATION NAO FAZ
-- ----------------------------
-- NAO faz backfill das 812. Corrigir a funcao NAO reprocessa nada: ela so roda
-- pelo trigger `trg_recalc_after_frete`, em INSERT/UPDATE de `cotacao_frete`.
-- Propostas ja gravadas seguem com NULL ate alguem tocar no frete delas.
-- O backfill e decisao separada — ver a recomendacao no relatorio.
--
-- POR QUE ISTO NAO ALTERA NENHUMA PROPOSTA HOJE CORRETA
-- -----------------------------------------------------
-- Onde a linha EXISTE, o `COALESCE` ja resolvia e o resultado e identico: a
-- mudanca so muda o caminho em que hoje o resultado e NULL. E, como a funcao so
-- roda por trigger, aplicar esta migration nao escreve em linha nenhuma.
-- =====================================================================

do $guarda$
declare
  v_corpo_vivo text;
  v_nulos_antes integer;
begin
  -- 1. O corpo vivo e o que este arquivo espera substituir?
  --    Sem isto, um CREATE OR REPLACE cego apagaria qualquer alteracao feita
  --    direto no banco e que nao esteja versionada aqui.
  select p.prosrc into v_corpo_vivo
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'recalcular_proposta_v3';

  if v_corpo_vivo is null then
    raise exception 'ABORTADO: public.recalcular_proposta_v3 nao existe.';
  end if;

  if position('COALESCE(valor_nominal, 0)' in v_corpo_vivo) = 0
     or position('FROM desconto_proposta' in v_corpo_vivo) = 0
     or position('FROM cotacao_frete' in v_corpo_vivo) = 0 then
    raise exception
      'ABORTADO: o corpo vivo de recalcular_proposta_v3 nao e o que esta migration espera. Alguem alterou a funcao fora do repositorio — comparar antes de substituir.';
  end if;

  if position('IS NOT NULL' in upper(v_corpo_vivo)) > 0
     and position('V_DESCONTO IS NULL' in upper(v_corpo_vivo)) > 0 then
    raise exception 'ABORTADO: a funcao ja parece corrigida. Nada a fazer.';
  end if;

  -- 2. Retrato de entrada, para o relatorio pos-aplicacao.
  select count(*) into v_nulos_antes from public.propostas where valor_total is null;
  raise notice 'Entrada OK. Propostas com valor_total NULL antes: %', v_nulos_antes;
end
$guarda$;


-- ---------------------------------------------------------------------
-- A CORRECAO
--
-- Muda SO os dois `SELECT INTO`. O resto da funcao — a soma dos produtos, a
-- regra do percentual, o UPDATE final e as colunas que ele escreve — fica
-- caractere por caractere como estava.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recalcular_proposta_v3(p_id_int integer)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_valor_produtos   numeric := 0;
    v_peso_total       numeric := 0;
    v_frete            numeric := 0;
    v_desconto         numeric := 0;
    v_percentual       numeric := 0;
BEGIN
    --------------------------------------------------------------------
    -- 1) SOMA TOTAL DOS PRODUTOS
    --    Intocado: SUM() sem GROUP BY sempre devolve uma linha.
    --------------------------------------------------------------------
    SELECT
        COALESCE(SUM(valor_sub_total), 0),
        COALESCE(SUM(peso_total), 0)
    INTO v_valor_produtos, v_peso_total
    FROM produtos_proposta
    WHERE id_int = p_id_int;

    --------------------------------------------------------------------
    -- 2) FRETE ESCOLHIDO
    --    Proposta SEM cotacao escolhida nao tem linha: o SELECT INTO deixaria
    --    v_frete NULL e o total inteiro viraria NULL. O subselect com COALESCE
    --    por fora resolve — sem linha, o resultado e 0.
    --------------------------------------------------------------------
    v_frete := COALESCE((
        SELECT valor
        FROM cotacao_frete
        WHERE id_int = p_id_int
          AND escolhido = true
        LIMIT 1
    ), 0);

    --------------------------------------------------------------------
    -- 3) DESCONTO (nominal ou percentual)
    --    Mesma correcao, e esta e a causa dos 801 casos: a maioria das
    --    propostas simplesmente nao tem desconto.
    --------------------------------------------------------------------
    v_desconto := COALESCE((
        SELECT valor_nominal
        FROM desconto_proposta
        WHERE id_int = p_id_int
        LIMIT 1
    ), 0);

    v_percentual := COALESCE((
        SELECT valor_percentual
        FROM desconto_proposta
        WHERE id_int = p_id_int
        LIMIT 1
    ), 0);

    IF v_percentual > 0 THEN
        v_desconto := (v_valor_produtos * v_percentual) / 100;
    END IF;

    --------------------------------------------------------------------
    -- 4) ATUALIZA A TABELA PROPOSTAS
    --    Intocado.
    --------------------------------------------------------------------
    UPDATE propostas
    SET
        valor        = v_valor_produtos,
        volume       = GREATEST(volume, 1),
        valor_total  = (v_valor_produtos - v_desconto + v_frete)
    WHERE id_int = p_id_int;

END;$function$;


do $saida$
declare
  v_corpo text;
  v_nulos integer;
begin
  select p.prosrc into v_corpo
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'recalcular_proposta_v3';

  -- 1. Os dois SELECT INTO problematicos sumiram?
  if position('INTO v_frete' in v_corpo) > 0
     or position('INTO v_desconto, v_percentual' in v_corpo) > 0 then
    raise exception 'ABORTADO: a funcao ainda tem SELECT INTO sem guarda de linha ausente.';
  end if;

  -- 2. O UPDATE final continua escrevendo as MESMAS tres colunas?
  if position('valor        = v_valor_produtos' in v_corpo) = 0
     or position('volume       = GREATEST(volume, 1)' in v_corpo) = 0
     or position('valor_total  = (v_valor_produtos - v_desconto + v_frete)' in v_corpo) = 0 then
    raise exception 'ABORTADO: o UPDATE final da funcao nao esta como deveria.';
  end if;

  -- 3. O trigger que a chama continua armado e apontando para ela.
  if not exists (
    select 1 from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_proc p on p.oid = t.tgfoid
     where t.tgname = 'trg_recalc_after_frete'
       and c.relname = 'cotacao_frete'
       and t.tgenabled = 'O'
       and p.proname = 'recalcular_proposta_v3_trigger'
  ) then
    raise exception 'ABORTADO: trg_recalc_after_frete nao esta armado ou mudou de funcao.';
  end if;

  -- 4. NENHUMA proposta pode ter mudado: a funcao so roda por trigger, e este
  --    arquivo nao dispara nenhum.
  select count(*) into v_nulos from public.propostas where valor_total is null;
  raise notice 'Saida OK. Propostas com valor_total NULL: % (o mesmo numero da entrada — esta migration NAO faz backfill).', v_nulos;
end
$saida$;


-- =====================================================================
-- VERIFICACOES APOS APLICAR (rodar como SELECT)
-- =====================================================================
--
-- (a) a funcao esta sem os SELECT INTO problematicos:
--     select position('INTO v_frete' in prosrc) as f, position('INTO v_desconto' in prosrc) as d
--       from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--      where n.nspname='public' and p.proname='recalcular_proposta_v3';
--     -- esperado: 0 e 0
--
-- (b) o numero de NULL nao mudou (sem backfill):
--     select count(*) from public.propostas where valor_total is null;   -- esperado: 812
--
-- (c) teste em transacao abortada, num pedido SEM desconto e SEM frete
--     escolhido — o total tem de sair numerico, nao NULL:
--
--     do $t$
--     declare v_total numeric; v_id int;
--     begin
--       select p.id_int into v_id from public.propostas p
--        where not exists (select 1 from public.desconto_proposta d where d.id_int=p.id_int)
--          and exists (select 1 from public.cotacao_frete c where c.id_int=p.id_int)
--        limit 1;
--       update public.cotacao_frete set valor = valor where id_int = v_id;
--       select valor_total into v_total from public.propostas where id_int = v_id;
--       raise exception 'ROLLBACK — pedido % | valor_total apos recalculo: %',
--         v_id, coalesce(v_total::text, 'NULL (AINDA COM DEFEITO)');
--     end $t$;
--
--
-- =====================================================================
-- ROLLBACK — o corpo ATUAL, exatamente como estava antes desta migration
-- =====================================================================
--
-- CREATE OR REPLACE FUNCTION public.recalcular_proposta_v3(p_id_int integer)
--  RETURNS void
--  LANGUAGE plpgsql
-- AS $function$DECLARE
--     v_valor_produtos   numeric := 0;
--     v_peso_total       numeric := 0;
--     v_frete            numeric := 0;
--     v_desconto         numeric := 0;
--     v_percentual       numeric := 0;
-- BEGIN
--     SELECT
--         COALESCE(SUM(valor_sub_total), 0),
--         COALESCE(SUM(peso_total), 0)
--     INTO v_valor_produtos, v_peso_total
--     FROM produtos_proposta
--     WHERE id_int = p_id_int;
--
--     SELECT COALESCE(valor, 0)
--     INTO v_frete
--     FROM cotacao_frete
--     WHERE id_int = p_id_int
--       AND escolhido = true
--     LIMIT 1;
--
--     SELECT
--         COALESCE(valor_nominal, 0),
--         COALESCE(valor_percentual, 0)
--     INTO v_desconto, v_percentual
--     FROM desconto_proposta
--     WHERE id_int = p_id_int
--     LIMIT 1;
--
--     IF v_percentual > 0 THEN
--         v_desconto := (v_valor_produtos * v_percentual) / 100;
--     END IF;
--
--     UPDATE propostas
--     SET
--         valor        = v_valor_produtos,
--         volume       = GREATEST(volume, 1),
--         valor_total  = (v_valor_produtos - v_desconto + v_frete)
--     WHERE id_int = p_id_int;
--
-- END;$function$;
-- =====================================================================
