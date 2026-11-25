-- Escaninho de encontro: libera quando o ULTIMO setor conclui a producao (25/11/2026)
--
-- Decisao do Everton (25/11/2026): o escaninho guarda as partes de um pedido de
-- varios setores ate a ultima ficar pronta. Quando a producao inteira conclui,
-- o escaninho ja pode ser esvaziado: esperar o despacho prendia escaninho vazio
-- (LOBO, pedido 25332, despachado so depois). Despacho e cancelamento continuam
-- liberando, como reserva (gatilhos de 20261117c, intocados).
--
-- Fonte do status por setor: propostas_os_setores.status_producao, gravado pelo
-- painel da producao (boletim-setores.service.ts, atualizarFaseSetor). Valor de
-- pronto: 'CONCLUIDO' (CHECK da propria coluna). Conferido em 25/11: LASER, PVC,
-- TEXTIL e FLEXO gravam CONCLUIDO; nos pedidos compostos despachados em 45 dias,
-- 380 de 382 setores tinham CONCLUIDO gravado antes do despacho.
--
-- O que muda:
--   1. liberado_motivo aceita 'PRODUCAO_CONCLUIDA'.
--   2. Gatilho em propostas_os_setores: setor passa a CONCLUIDO e todos os setores
--      do pedido estao CONCLUIDO -> escaninho__liberar(id_int, 'PRODUCAO_CONCLUIDA').
--      Falha so registra WARNING: nunca atrapalha a gravacao da fase.
--   3. escaninho_do_boletim: pedido com a producao concluida volta LIBERADO (nao
--      atribui), e a varredura antes da escolha solta tambem esses casos.
--
-- Nao reocupa: setor reaberto depois nao devolve o escaninho.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS trg_os_setores_libera_escaninho ON public.propostas_os_setores;
--   DROP FUNCTION IF EXISTS public.escaninho__trg_producao_concluida();
--   reaplicar escaninho_do_boletim de 20261117c_escaninhos_encontro.sql;
--   DROP FUNCTION IF EXISTS public.escaninho__producao_concluida(bigint);
--   (o CHECK so volta ao antigo depois de nao haver linha com PRODUCAO_CONCLUIDA)

-- 1. Motivo novo
ALTER TABLE public.escaninhos_ocupacao
  DROP CONSTRAINT IF EXISTS escaninhos_ocupacao_liberado_motivo_check;
ALTER TABLE public.escaninhos_ocupacao
  ADD CONSTRAINT escaninhos_ocupacao_liberado_motivo_check
  CHECK (liberado_motivo IN ('DESPACHO', 'CANCELADO', 'ENTREGUE', 'PRODUCAO_CONCLUIDA'));

-- Producao concluida = o pedido tem setor e nenhum setor fora de CONCLUIDO.
CREATE OR REPLACE FUNCTION public.escaninho__producao_concluida(p_id_int bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.propostas_os_setores s WHERE s.id_int = p_id_int)
     AND NOT EXISTS (SELECT 1 FROM public.propostas_os_setores s
                      WHERE s.id_int = p_id_int AND coalesce(s.status_producao, '') <> 'CONCLUIDO');
$function$;

REVOKE ALL ON FUNCTION public.escaninho__producao_concluida(bigint) FROM PUBLIC, anon, authenticated;

-- 2. Gatilho no ponto em que a fase do setor e gravada
CREATE OR REPLACE FUNCTION public.escaninho__trg_producao_concluida()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF coalesce(NEW.status_producao, '') <> 'CONCLUIDO' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND coalesce(OLD.status_producao, '') = 'CONCLUIDO' THEN RETURN NEW; END IF;
  BEGIN
    IF public.escaninho__producao_concluida(NEW.id_int) THEN
      PERFORM public.escaninho__liberar(NEW.id_int, 'PRODUCAO_CONCLUIDA');
    END IF;
  EXCEPTION WHEN others THEN
    RAISE WARNING 'escaninho__liberar(%) na producao concluida falhou: % %', NEW.id_int, SQLSTATE, SQLERRM;
  END;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.escaninho__trg_producao_concluida() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_os_setores_libera_escaninho ON public.propostas_os_setores;
CREATE TRIGGER trg_os_setores_libera_escaninho
  AFTER INSERT OR UPDATE OF status_producao ON public.propostas_os_setores
  FOR EACH ROW EXECUTE FUNCTION public.escaninho__trg_producao_concluida();

-- 3. Boletim: producao concluida nao pega escaninho, e a varredura solta esses casos
CREATE OR REPLACE FUNCTION public.escaninho_do_boletim(p_id_int bigint)
 RETURNS TABLE(situacao text, nome text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_aprovado boolean;
  v_status   text;
  v_setores  integer;
  v_ordem    smallint;
  v_nome     text;
BEGIN
  PERFORM public.cc__assert_permissao(auth.uid(), 'pedidos.print_os');

  SELECT coalesce(p.is_prd_aprovado, false), upper(btrim(coalesce(p.status_interno, '')))
    INTO v_aprovado, v_status
    FROM public.propostas p WHERE p.id_int = p_id_int;
  IF NOT FOUND OR NOT v_aprovado THEN
    RETURN QUERY SELECT 'NAO_LIBERADO'::text, NULL::text; RETURN;
  END IF;

  SELECT count(DISTINCT upper(btrim(s.setor))) INTO v_setores
    FROM public.propostas_os_setores s WHERE s.id_int = p_id_int;
  IF v_setores < 2 THEN
    RETURN QUERY SELECT 'UM_SETOR'::text, NULL::text; RETURN;
  END IF;

  -- Reimpressao: o mesmo de antes.
  SELECT e.nome INTO v_nome
    FROM public.escaninhos_ocupacao o JOIN public.escaninhos e ON e.ordem = o.ordem
   WHERE o.id_int = p_id_int AND o.liberado_em IS NULL;
  IF FOUND THEN
    RETURN QUERY SELECT 'OCUPADO'::text, v_nome; RETURN;
  END IF;

  -- Pedido que ja saiu, ou cuja producao ja concluiu, nao pega escaninho.
  IF v_status IN ('CANCELADO', 'CANCELADA', 'ENTREGUE')
     OR EXISTS (SELECT 1 FROM public.expedicoes x WHERE x.id_int = p_id_int AND x.data_despacho IS NOT NULL)
     OR public.escaninho__producao_concluida(p_id_int) THEN
    RETURN QUERY SELECT 'LIBERADO'::text, NULL::text; RETURN;
  END IF;

  -- Uma atribuicao por vez (os indices unicos seguram de qualquer jeito).
  PERFORM pg_advisory_xact_lock(hashtext('escaninhos_encontro'));

  -- Outro boletim do mesmo pedido pode ter atribuido enquanto esperavamos.
  SELECT e.nome INTO v_nome
    FROM public.escaninhos_ocupacao o JOIN public.escaninhos e ON e.ordem = o.ordem
   WHERE o.id_int = p_id_int AND o.liberado_em IS NULL;
  IF FOUND THEN
    RETURN QUERY SELECT 'OCUPADO'::text, v_nome; RETURN;
  END IF;

  -- Solta quem ja saiu ou ja concluiu e o gatilho nao pegou.
  UPDATE public.escaninhos_ocupacao o
     SET liberado_em = now(),
         liberado_motivo = CASE
           WHEN upper(btrim(coalesce(p.status_interno, ''))) IN ('CANCELADO', 'CANCELADA') THEN 'CANCELADO'
           WHEN EXISTS (SELECT 1 FROM public.expedicoes x WHERE x.id_int = o.id_int AND x.data_despacho IS NOT NULL) THEN 'DESPACHO'
           WHEN upper(btrim(coalesce(p.status_interno, ''))) = 'ENTREGUE' THEN 'ENTREGUE'
           ELSE 'PRODUCAO_CONCLUIDA' END
    FROM public.propostas p
   WHERE p.id_int = o.id_int
     AND o.liberado_em IS NULL
     AND (upper(btrim(coalesce(p.status_interno, ''))) IN ('CANCELADO', 'CANCELADA', 'ENTREGUE')
          OR EXISTS (SELECT 1 FROM public.expedicoes x WHERE x.id_int = o.id_int AND x.data_despacho IS NOT NULL)
          OR public.escaninho__producao_concluida(o.id_int));

  SELECT e.ordem, e.nome INTO v_ordem, v_nome
    FROM public.escaninhos e
   WHERE e.ativo
     AND NOT EXISTS (SELECT 1 FROM public.escaninhos_ocupacao o WHERE o.ordem = e.ordem AND o.liberado_em IS NULL)
   ORDER BY e.ordem
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'SEM_LIVRE'::text, NULL::text; RETURN;
  END IF;

  INSERT INTO public.escaninhos_ocupacao (ordem, id_int, atribuido_por)
  VALUES (v_ordem, p_id_int, auth.uid());

  RETURN QUERY SELECT 'OCUPADO'::text, v_nome;
END;
$function$;

REVOKE ALL ON FUNCTION public.escaninho_do_boletim(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.escaninho_do_boletim(bigint) TO authenticated, service_role;

-- 4. Varredura unica: solta agora as ocupacoes abertas cuja producao ja concluiu
--    (ou que ja sairam e o gatilho nao pegou). Mesmo criterio da varredura do boletim.
--    Em 25/11, antes de aplicar: 25243 (GIRAFA), 25313 (ANTA), 25484 (DRAGAO DE KOMODO)
--    e 25609 (HARPIA), todos em EXPEDICAO com todos os setores CONCLUIDO e sem despacho.
UPDATE public.escaninhos_ocupacao o
   SET liberado_em = now(),
       liberado_motivo = CASE
         WHEN upper(btrim(coalesce(p.status_interno, ''))) IN ('CANCELADO', 'CANCELADA') THEN 'CANCELADO'
         WHEN EXISTS (SELECT 1 FROM public.expedicoes x WHERE x.id_int = o.id_int AND x.data_despacho IS NOT NULL) THEN 'DESPACHO'
         WHEN upper(btrim(coalesce(p.status_interno, ''))) = 'ENTREGUE' THEN 'ENTREGUE'
         ELSE 'PRODUCAO_CONCLUIDA' END
  FROM public.propostas p
 WHERE p.id_int = o.id_int
   AND o.liberado_em IS NULL
   AND (upper(btrim(coalesce(p.status_interno, ''))) IN ('CANCELADO', 'CANCELADA', 'ENTREGUE')
        OR EXISTS (SELECT 1 FROM public.expedicoes x WHERE x.id_int = o.id_int AND x.data_despacho IS NOT NULL)
        OR public.escaninho__producao_concluida(o.id_int));

COMMENT ON TABLE public.escaninhos_ocupacao IS
  'Quem ocupa cada escaninho (17/11/2026). Ocupado = liberado_em nulo. Escrita so por escaninho_do_boletim e pelos gatilhos de producao concluida (25/11), despacho e cancelamento.';
