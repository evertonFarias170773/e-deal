-- =====================================================================
-- recalcular_proposta_v3 deixa de zerar o valor da proposta AVULSA
-- =====================================================================
--
-- O QUE
-- -----
-- A funcao grava `propostas.valor` com a SOMA DOS ITENS. Proposta avulsa nao
-- tem item — o valor dela e digitado a mao —, entao a soma e sempre zero e a
-- gravacao apaga o valor.
--
-- MEDIDO EM 04/09/2026: das 7.749 propostas avulsas do banco, ZERO tem item em
-- `produtos_proposta`. Gravar a soma dos itens numa avulsa nunca produziu outro
-- resultado que nao zero. Nao e uma borda: e o unico resultado possivel.
--
-- POR QUE O TRIGGER DE REPOSICAO NAO SALVA
-- ----------------------------------------
-- `tg_propostas_valor_total_avulsa` (BEFORE UPDATE em `propostas`) existe para
-- repor o total da avulsa, mas a condicao dele e:
--
--     elsif new.valor_total = 0 and coalesce(new.valor, 0) > 0 then
--
-- Quando ele roda, `new.valor` JA foi zerado pelo mesmo UPDATE — e `v_calculado`
-- tambem, porque sai do mesmo `new.valor`. A condicao e falsa e ele desiste. Ele
-- teria `old.valor` disponivel, mas nao o le.
--
-- A ORDEM QUE PRODUZ O ESTRAGO
-- ----------------------------
--     UPDATE cotacao_frete
--       -> AFTER trg_recalc_after_frete -> recalcular_proposta_v3
--            -> UPDATE propostas SET valor = <soma dos itens = 0>, valor_total = ...
--                 -> BEFORE tg_propostas_valor_total_avulsa  (tarde demais)
--
-- POR QUE ISSO AINDA NAO CAUSOU PREJUIZO — E POR QUE VAI CAUSAR
-- -------------------------------------------------------------
-- Acontece 298 vezes por semana (auditoria dos ultimos 7 dias: 298 avulsas com
-- `valor` caindo de >0 para 0, TODAS com cotacao de frete). Nenhuma sobreviveu
-- zerada: o `saveProposta` regrava o valor logo depois, no mesmo fluxo. E o
-- mesmo mascaramento em duas etapas que produz o `valor_total: null` seguido do
-- valor certo na auditoria.
--
-- A Etapa 4 da correcao de frete pos-liberacao sera o PRIMEIRO caminho que grava
-- frete FORA desse par. Na faixa dela (EXPEDICAO / A RETIRAR) ha duas avulsas,
-- as duas com cotacao:
--     21347 — EXPEDICAO, CIF,    R$    782,00, com PAGAMENTO CONFIRMADO
--     21085 — EXPEDICAO, RETIRA, R$ 85.000,00
-- Zerar a 21347 faria o modal financeiro calcular 0 - 782 e oferecer DEVOLVER
-- R$ 782,00 ao cliente — dinheiro que ele deve. Por isso esta correcao e
-- pre-requisito daquela etapa, e nao um "seria bom".
--
-- O QUE MUDA, EXATAMENTE
-- ----------------------
-- Em proposta AVULSA a funcao passa a NAO escrever `propostas.valor`. Continua
-- escrevendo `volume` e `valor_total`.
--
-- `valor_total` da avulsa e RECALCULADO a partir do valor que ja esta gravado,
-- e nao a partir dos itens:
--
--     valor_total = valor_gravado - desconto + frete_escolhido
--
-- Decisao deliberada, e nao "nao tocar em nada": a Etapa 4 muda a MODALIDADE, e
-- e a modalidade que decide se o frete e cobrado. Se o total nao acompanhasse, a
-- avulsa ficaria com total velho justamente na operacao que existe para
-- corrigi-lo. A conta e consistente porque `propostas.valor_frete` das avulsas
-- bate com a cotacao escolhida em 100% dos casos (0 divergencias medidas).
--
-- Proposta NAO avulsa: nada muda. Mesmo caminho, mesmas tres colunas.
--
-- O QUE ESTA MIGRATION NAO FAZ
-- ----------------------------
-- NAO faz backfill nas 208 avulsas com valor e total zerados hoje. Elas sao caso
-- DIFERENTE: nenhuma tem cotacao de frete, ou seja, nunca passaram por este
-- trigger. Sao avulsas legitimamente em branco — orcamento aberto e abandonado.
-- Nenhuma tem pagamento confirmado ou NF. Mexer nelas seria inventar valor.
-- =====================================================================

do $guarda$
declare
  v_corpo text;
  v_zeradas integer;
begin
  select p.prosrc into v_corpo
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'recalcular_proposta_v3';

  if v_corpo is null then
    raise exception 'ABORTADO: public.recalcular_proposta_v3 nao existe.';
  end if;

  -- 1. O corpo vivo tem de ser o de 20260903225707 — a correcao de linha
  --    ausente, que JA esta aplicada. Se nao tiver, alguem mexeu fora do
  --    repositorio e substituir cegamente apagaria a alteracao.
  if position('v_frete := COALESCE((' in v_corpo) = 0
     or position('v_desconto := COALESCE((' in v_corpo) = 0
     or position('v_percentual := COALESCE((' in v_corpo) = 0 then
    raise exception
      'ABORTADO: o corpo vivo NAO contem a correcao de linha ausente (20260903225707). Comparar antes de substituir.';
  end if;

  if position('INTO v_frete' in v_corpo) > 0
     or position('INTO v_desconto, v_percentual' in v_corpo) > 0 then
    raise exception 'ABORTADO: o corpo vivo ainda tem os SELECT INTO antigos. Estado inesperado.';
  end if;

  -- 2. Ainda escreve `valor` incondicionalmente? Se nao, ja foi corrigida.
  if position('valor        = v_valor_produtos' in v_corpo) = 0 then
    raise exception 'ABORTADO: a funcao ja parece corrigida ou o UPDATE final mudou. Nada a fazer.';
  end if;

  -- 3. Retrato de entrada.
  select count(*) into v_zeradas
    from public.propostas
   where is_avulso is true and coalesce(valor,0) = 0 and coalesce(valor_total,0) = 0;
  raise notice 'Entrada OK. Avulsas com valor e total zerados: % (esta migration NAO as toca).', v_zeradas;
end
$guarda$;


-- ---------------------------------------------------------------------
-- A CORRECAO
--
-- Dois UPDATEs em vez de um, escolhidos pelo `is_avulso` da propria proposta.
-- Os blocos 1, 2 e 3 — soma dos itens, frete e desconto — ficam identicos ao
-- que 20260903225707 deixou.
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
    v_is_avulso        boolean := false;
    v_valor_gravado    numeric := 0;
BEGIN
    --------------------------------------------------------------------
    -- 0) A PROPOSTA E AVULSA?
    --    Avulsa nao tem item: o valor dela e digitado a mao e mora em
    --    `propostas.valor`. Medido em 04/09/2026: ZERO das 7.749 avulsas
    --    tem linha em `produtos_proposta`.
    --------------------------------------------------------------------
    SELECT COALESCE(is_avulso, false), COALESCE(valor, 0)
      INTO v_is_avulso, v_valor_gravado
    FROM propostas
    WHERE id_int = p_id_int;

    -- Proposta inexistente: nada a recalcular.
    IF NOT FOUND THEN
        RETURN;
    END IF;

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
    -- 2) FRETE ESCOLHIDO  (20260903225707 — sem linha devolve 0)
    --------------------------------------------------------------------
    v_frete := COALESCE((
        SELECT valor
        FROM cotacao_frete
        WHERE id_int = p_id_int
          AND escolhido = true
        LIMIT 1
    ), 0);

    --------------------------------------------------------------------
    -- 3) DESCONTO (nominal ou percentual)  (20260903225707)
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

    --------------------------------------------------------------------
    -- 4) ATUALIZA A TABELA PROPOSTAS
    --------------------------------------------------------------------
    IF v_is_avulso THEN
        -- AVULSA: `valor` NAO e escrito. A base do total e o valor que ja esta
        -- gravado, nao a soma dos itens (que e sempre zero aqui). O percentual,
        -- se houver, incide sobre esse valor — mesma regra, outra base.
        IF v_percentual > 0 THEN
            v_desconto := (v_valor_gravado * v_percentual) / 100;
        END IF;

        UPDATE propostas
        SET
            volume       = GREATEST(volume, 1),
            valor_total  = (v_valor_gravado - v_desconto + v_frete)
        WHERE id_int = p_id_int;
    ELSE
        -- NAO AVULSA: byte a byte o comportamento de sempre.
        IF v_percentual > 0 THEN
            v_desconto := (v_valor_produtos * v_percentual) / 100;
        END IF;

        UPDATE propostas
        SET
            valor        = v_valor_produtos,
            volume       = GREATEST(volume, 1),
            valor_total  = (v_valor_produtos - v_desconto + v_frete)
        WHERE id_int = p_id_int;
    END IF;

END;$function$;


do $saida$
declare
  v_corpo text;
  v_zeradas integer;
begin
  select p.prosrc into v_corpo
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'recalcular_proposta_v3';

  -- 1. O ramo da avulsa existe e NAO escreve `valor`.
  if position('IF v_is_avulso THEN' in v_corpo) = 0 then
    raise exception 'ABORTADO: o ramo da avulsa nao esta na funcao.';
  end if;
  if position('valor_total  = (v_valor_gravado - v_desconto + v_frete)' in v_corpo) = 0 then
    raise exception 'ABORTADO: o UPDATE da avulsa nao esta como deveria.';
  end if;

  -- 2. O ramo NAO avulso continua escrevendo as MESMAS tres colunas.
  if position('valor        = v_valor_produtos' in v_corpo) = 0
     or position('volume       = GREATEST(volume, 1)' in v_corpo) = 0
     or position('valor_total  = (v_valor_produtos - v_desconto + v_frete)' in v_corpo) = 0 then
    raise exception 'ABORTADO: o UPDATE da proposta NAO avulsa foi alterado.';
  end if;

  -- 3. A correcao de linha ausente de 20260903225707 sobreviveu.
  if position('v_frete := COALESCE((' in v_corpo) = 0
     or position('v_desconto := COALESCE((' in v_corpo) = 0 then
    raise exception 'ABORTADO: a correcao de linha ausente foi perdida na substituicao.';
  end if;

  -- 4. O trigger continua armado e apontando para a funcao.
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

  -- 5. NENHUMA proposta pode ter mudado: a funcao so roda por trigger.
  select count(*) into v_zeradas
    from public.propostas
   where is_avulso is true and coalesce(valor,0) = 0 and coalesce(valor_total,0) = 0;
  raise notice 'Saida OK. Avulsas zeradas: % (o mesmo numero da entrada — sem backfill).', v_zeradas;
end
$saida$;


-- =====================================================================
-- VERIFICACOES APOS APLICAR
-- =====================================================================
--
-- (a) o ramo da avulsa existe e o da nao avulsa esta intacto:
--     select position('IF v_is_avulso THEN' in prosrc) as ramo_avulsa,
--            position('valor        = v_valor_produtos' in prosrc) as ramo_normal
--       from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--      where n.nspname='public' and p.proname='recalcular_proposta_v3';
--     -- esperado: os dois > 0
--
-- (b) avulsas zeradas seguem 208 (sem backfill):
--     select count(*) from public.propostas
--      where is_avulso is true and coalesce(valor,0)=0 and coalesce(valor_total,0)=0;
--
-- (c) TESTE em transacao abortada — AVULSA com cotacao. O valor tem de SOBREVIVER:
--
--     do $t$
--     declare v_id int; v_v_antes numeric; v_t_antes numeric; v_v numeric; v_t numeric;
--     begin
--       select p.id_int, p.valor, p.valor_total into v_id, v_v_antes, v_t_antes
--         from public.propostas p
--        where p.is_avulso is true and coalesce(p.valor,0) > 0
--          and exists (select 1 from public.cotacao_frete c where c.id_int=p.id_int and c.escolhido)
--        order by p.id_int desc limit 1;
--       update public.cotacao_frete set valor = valor where id_int = v_id and escolhido;
--       select valor, valor_total into v_v, v_t from public.propostas where id_int = v_id;
--       raise exception E'ROLLBACK — AVULSA %\n  valor  % -> %\n  total  % -> %\n  %',
--         v_id, v_v_antes, v_v, v_t_antes, v_t,
--         case when v_v = v_v_antes then 'OK — o valor sobreviveu' else 'FALHOU — o valor foi alterado' end;
--     end $t$;
--
-- (d) TESTE em transacao abortada — NAO AVULSA. Comportamento identico ao de hoje:
--
--     do $t$
--     declare v_id int; v_v numeric; v_t numeric; v_soma numeric; v_cot numeric;
--     begin
--       select p.id_int into v_id from public.propostas p
--        where p.is_avulso is not true
--          and exists (select 1 from public.produtos_proposta i where i.id_int=p.id_int and i.valor_sub_total>0)
--          and exists (select 1 from public.cotacao_frete c where c.id_int=p.id_int and c.escolhido)
--        order by p.id_int desc limit 1;
--       select coalesce(sum(valor_sub_total),0) into v_soma from public.produtos_proposta where id_int=v_id;
--       select valor into v_cot from public.cotacao_frete where id_int=v_id and escolhido limit 1;
--       update public.cotacao_frete set valor = valor where id_int = v_id and escolhido;
--       select valor, valor_total into v_v, v_t from public.propostas where id_int = v_id;
--       raise exception E'ROLLBACK — NAO AVULSA %\n  valor % (esperado %)\n  total % (esperado %)\n  %',
--         v_id, v_v, v_soma, v_t, (v_soma + v_cot),
--         case when v_v = v_soma then 'OK — identico ao de hoje' else 'DIVERGIU' end;
--     end $t$;
--
--
-- =====================================================================
-- ROLLBACK — o corpo ATUAL (o de 20260903225707), integro
-- =====================================================================
--
-- CREATE OR REPLACE FUNCTION public.recalcular_proposta_v3(p_id_int integer)
--  RETURNS void
--  LANGUAGE plpgsql
-- AS $function$
-- DECLARE
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
--     v_frete := COALESCE((
--         SELECT valor
--         FROM cotacao_frete
--         WHERE id_int = p_id_int
--           AND escolhido = true
--         LIMIT 1
--     ), 0);
--
--     v_desconto := COALESCE((
--         SELECT valor_nominal
--         FROM desconto_proposta
--         WHERE id_int = p_id_int
--         LIMIT 1
--     ), 0);
--
--     v_percentual := COALESCE((
--         SELECT valor_percentual
--         FROM desconto_proposta
--         WHERE id_int = p_id_int
--         LIMIT 1
--     ), 0);
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
