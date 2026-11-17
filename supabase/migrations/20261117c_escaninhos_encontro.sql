-- ============================================================================
-- 20261117c_escaninhos_encontro — escaninho de encontro dos pedidos compostos
-- 17/11/2026 — pedido do Everton (boletim de producao).
--
-- A producao montou 28 escaninhos fisicos para juntar as partes de um pedido
-- composto (itens em 2 ou mais setores). O Vibe escolhe o escaninho na primeira
-- geracao do boletim e o imprime na tarja vermelha de todos os boletins do pedido.
--
-- CATALOGO  public.escaninhos: os 28, com a ORDEM explicita (nao depende de
--   collation) e o nome exatamente como na etiqueta fisica.
--
-- OCUPACAO  public.escaninhos_ocupacao: uma linha por atribuicao. Ocupada =
--   liberado_em nulo. Dois indices unicos parciais garantem no banco que, enquanto
--   ocupado, um escaninho tem UM pedido e um pedido tem UM escaninho: dois
--   boletins gerados ao mesmo tempo nao pegam o mesmo.
--
-- ATRIBUICAO  escaninho_do_boletim(id_int), chamada pela rota imprimir-os:
--   - pedido liberado para producao e com 2+ setores em propostas_os_setores;
--   - ja ocupando: devolve o mesmo (reimpressao);
--   - despachado, cancelado ou entregue: nao atribui (LIBERADO);
--   - senao, o PRIMEIRO livre pela ordem; os 28 ocupados: SEM_LIVRE (nada trava).
--   Serializada por advisory lock; antes de escolher, solta a ocupacao de pedido
--   que ja saiu (despachado, cancelado ou entregue) e cujo gatilho nao pegou.
--
-- LIBERACAO
--   - despacho: expedicoes.data_despacho passa de nulo a preenchido (mesmo evento
--     do trg_exp_fechar_grupo);
--   - cancelamento: propostas.status_interno vira CANCELADO/CANCELADA.
--   Liberado, o escaninho volta a ser candidato pela ordem. Os gatilhos nunca
--   atrapalham o despacho nem o cancelamento (excecao registrada e segue).
--
-- SEGURANCA: tabelas com RLS e so SELECT para authenticated; escrita so pelas
--   funcoes SECURITY DEFINER. escaninho_do_boletim exige pedidos.print_os.
--
-- ROLLBACK: no rodape.
-- ============================================================================

CREATE TABLE public.escaninhos (
  ordem smallint PRIMARY KEY CHECK (ordem > 0),
  nome  text NOT NULL UNIQUE CHECK (btrim(nome) <> ''),
  ativo boolean NOT NULL DEFAULT true
);

COMMENT ON TABLE public.escaninhos IS
  'Escaninhos fisicos de encontro dos pedidos compostos (17/11/2026). ordem = ordem de atribuicao; nome = etiqueta fisica.';

INSERT INTO public.escaninhos (ordem, nome) VALUES
  (1,  'ÁGUIA AMERICANA'),
  (2,  'ALCE'),
  (3,  'ANTA'),
  (4,  'ARRAIA'),
  (5,  'BALEIA AZUL'),
  (6,  'BISÃO'),
  (7,  'CAMELO'),
  (8,  'CROCODILO DO NILO'),
  (9,  'DRAGÃO DE KOMODO'),
  (10, 'ELEFANTE AFRICANO'),
  (11, 'GIRAFA'),
  (12, 'GORILA'),
  (13, 'HARPIA'),
  (14, 'HIPOPÓTAMO'),
  (15, 'LEÃO'),
  (16, 'LOBO'),
  (17, 'LONTRA'),
  (18, 'LULA COLOSSAL'),
  (19, 'MORSA'),
  (20, 'ONÇA PINTADA'),
  (21, 'ORCA'),
  (22, 'PANDA'),
  (23, 'RINOCERONTE BRANCO'),
  (24, 'SUCURI'),
  (25, 'TARTARUGA'),
  (26, 'TIGRE'),
  (27, 'URSO PARDO'),
  (28, 'URSO POLAR');

CREATE TABLE public.escaninhos_ocupacao (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ordem           smallint NOT NULL REFERENCES public.escaninhos (ordem),
  id_int          bigint NOT NULL,
  atribuido_em    timestamptz NOT NULL DEFAULT now(),
  atribuido_por   uuid,
  liberado_em     timestamptz,
  liberado_motivo text CHECK (liberado_motivo IN ('DESPACHO', 'CANCELADO', 'ENTREGUE')),
  CHECK ((liberado_em IS NULL) = (liberado_motivo IS NULL))
);

-- Enquanto ocupado: um pedido por escaninho e um escaninho por pedido.
CREATE UNIQUE INDEX escaninhos_ocupacao_escaninho_ocupado ON public.escaninhos_ocupacao (ordem) WHERE liberado_em IS NULL;
CREATE UNIQUE INDEX escaninhos_ocupacao_pedido_ocupado    ON public.escaninhos_ocupacao (id_int) WHERE liberado_em IS NULL;
CREATE INDEX escaninhos_ocupacao_id_int ON public.escaninhos_ocupacao (id_int);

COMMENT ON TABLE public.escaninhos_ocupacao IS
  'Quem ocupa cada escaninho (17/11/2026). Ocupado = liberado_em nulo. Escrita so por escaninho_do_boletim e pelos gatilhos de despacho e cancelamento.';

ALTER TABLE public.escaninhos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.escaninhos_ocupacao ENABLE ROW LEVEL SECURITY;
CREATE POLICY escaninhos_leitura ON public.escaninhos FOR SELECT TO authenticated USING (true);
CREATE POLICY escaninhos_ocupacao_leitura ON public.escaninhos_ocupacao FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.escaninhos, public.escaninhos_ocupacao FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.escaninhos, public.escaninhos_ocupacao TO authenticated;
GRANT ALL ON public.escaninhos, public.escaninhos_ocupacao TO service_role;

-- ----------------------------------------------------------------------------
-- Liberacao (uso interno dos gatilhos e da atribuicao)
-- ----------------------------------------------------------------------------
CREATE FUNCTION public.escaninho__liberar(p_id_int bigint, p_motivo text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_n integer;
BEGIN
  UPDATE public.escaninhos_ocupacao
     SET liberado_em = now(), liberado_motivo = p_motivo
   WHERE id_int = p_id_int AND liberado_em IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;

REVOKE ALL ON FUNCTION public.escaninho__liberar(bigint, text) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Atribuicao (rota imprimir-os)
-- situacao: OCUPADO (nome = o escaninho do pedido), SEM_LIVRE, LIBERADO,
--           UM_SETOR, NAO_LIBERADO.
-- ----------------------------------------------------------------------------
CREATE FUNCTION public.escaninho_do_boletim(p_id_int bigint)
 RETURNS TABLE (situacao text, nome text)
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

  -- Pedido que ja saiu nao pega escaninho.
  IF v_status IN ('CANCELADO', 'CANCELADA', 'ENTREGUE')
     OR EXISTS (SELECT 1 FROM public.expedicoes x WHERE x.id_int = p_id_int AND x.data_despacho IS NOT NULL) THEN
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

  -- Solta quem ja saiu e o gatilho nao pegou (ex.: entregue sem despacho).
  UPDATE public.escaninhos_ocupacao o
     SET liberado_em = now(),
         liberado_motivo = CASE
           WHEN upper(btrim(coalesce(p.status_interno, ''))) IN ('CANCELADO', 'CANCELADA') THEN 'CANCELADO'
           WHEN EXISTS (SELECT 1 FROM public.expedicoes x WHERE x.id_int = o.id_int AND x.data_despacho IS NOT NULL) THEN 'DESPACHO'
           ELSE 'ENTREGUE' END
    FROM public.propostas p
   WHERE p.id_int = o.id_int
     AND o.liberado_em IS NULL
     AND (upper(btrim(coalesce(p.status_interno, ''))) IN ('CANCELADO', 'CANCELADA', 'ENTREGUE')
          OR EXISTS (SELECT 1 FROM public.expedicoes x WHERE x.id_int = o.id_int AND x.data_despacho IS NOT NULL));

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

COMMENT ON FUNCTION public.escaninho_do_boletim(bigint) IS
  'Escaninho de encontro do pedido composto (17/11/2026): devolve o que ele ocupa ou atribui o primeiro livre pela ordem. Exige pedidos.print_os.';

-- ----------------------------------------------------------------------------
-- Gatilho: despacho na Expedicao
-- ----------------------------------------------------------------------------
CREATE FUNCTION public.escaninho__trg_despacho()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.data_despacho IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.data_despacho IS NOT NULL THEN RETURN NEW; END IF;
  BEGIN
    PERFORM public.escaninho__liberar(NEW.id_int, 'DESPACHO');
  EXCEPTION WHEN others THEN
    -- Nunca atrapalha o despacho.
    RAISE WARNING 'escaninho__liberar(%) no despacho falhou: % %', NEW.id_int, SQLSTATE, SQLERRM;
  END;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.escaninho__trg_despacho() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_exp_libera_escaninho
  AFTER INSERT OR UPDATE OF data_despacho ON public.expedicoes
  FOR EACH ROW EXECUTE FUNCTION public.escaninho__trg_despacho();

-- ----------------------------------------------------------------------------
-- Gatilho: cancelamento do pedido
-- ----------------------------------------------------------------------------
CREATE FUNCTION public.escaninho__trg_cancelamento()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF upper(btrim(coalesce(NEW.status_interno, ''))) NOT IN ('CANCELADO', 'CANCELADA') THEN RETURN NEW; END IF;
  IF upper(btrim(coalesce(OLD.status_interno, ''))) IN ('CANCELADO', 'CANCELADA') THEN RETURN NEW; END IF;
  BEGIN
    PERFORM public.escaninho__liberar(NEW.id_int, 'CANCELADO');
  EXCEPTION WHEN others THEN
    -- Nunca atrapalha o cancelamento.
    RAISE WARNING 'escaninho__liberar(%) no cancelamento falhou: % %', NEW.id_int, SQLSTATE, SQLERRM;
  END;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.escaninho__trg_cancelamento() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_propostas_libera_escaninho
  AFTER UPDATE OF status_interno ON public.propostas
  FOR EACH ROW EXECUTE FUNCTION public.escaninho__trg_cancelamento();

-- ============================================================================
-- ROLLBACK — tire o comentario de bloco e rode.
-- ============================================================================
/*
DROP TRIGGER IF EXISTS trg_propostas_libera_escaninho ON public.propostas;
DROP TRIGGER IF EXISTS trg_exp_libera_escaninho ON public.expedicoes;
DROP FUNCTION IF EXISTS public.escaninho__trg_cancelamento();
DROP FUNCTION IF EXISTS public.escaninho__trg_despacho();
DROP FUNCTION IF EXISTS public.escaninho_do_boletim(bigint);
DROP FUNCTION IF EXISTS public.escaninho__liberar(bigint, text);
DROP TABLE IF EXISTS public.escaninhos_ocupacao;
DROP TABLE IF EXISTS public.escaninhos;
*/
