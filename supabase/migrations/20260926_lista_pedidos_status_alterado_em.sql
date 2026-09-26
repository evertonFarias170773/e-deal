-- ============================================================================
-- Lista de Pedidos: data da ULTIMA MUDANCA DE STATUS — 26/09/2026, decisao do dono.
--
-- O QUE ACONTECIA
--   A coluna "Data / Hora" e a ordenacao dentro dos grupos usavam
--   `propostas.updated_at`, que dois triggers carimbam em QUALQUER UPDATE — ate
--   na migracao automatica APROVADO -> LIBERADO que o formulario faz so de abrir
--   a proposta (15073 e 19383 subiram para o topo assim em 25/09).
--
-- O QUE MUDA
--   - `public.propostas_status_alterado` guarda, por `id_int`, o momento da
--     ultima mudanca REAL de `status_interno`. Tabela propria: nada e escrito em
--     `propostas`, e o `updated_at` de ninguem e recarimbado.
--   - trigger AFTER INSERT OR UPDATE OF status_interno em `propostas` mantem a
--     tabela. Ignora APROVADO -> LIBERADO (com ou sem " / EM ARTE") e UPDATE que
--     nao muda o valor. Nunca escreve em `propostas`.
--   - carga inicial por um unico INSERT ... SELECT a partir de `audit.logs_v2`
--     (cobre `propostas` desde 28/03/2026; nenhuma proposta fora de NOVO ou
--     CANCELADO esta sem historico). Sem historico, vale `created_at`.
--   - `public.vw_propostas_lista` = propostas LEFT JOIN a tabela, com
--     security_invoker: vale a RLS de `propostas` para quem consulta. A lista
--     mostra e ordena por `status_alterado_em`.
--
-- O QUE NAO MUDA
--   Triggers de updated_at, motor de status, RLS de `propostas`, `audit.logs_v2`
--   (so lida, uma vez, na carga).
-- ============================================================================

-- 1. Tabela -------------------------------------------------------------------
CREATE TABLE public.propostas_status_alterado (
  id_int             bigint      PRIMARY KEY REFERENCES public.propostas(id_int) ON DELETE CASCADE ON UPDATE CASCADE,
  status_alterado_em timestamptz NOT NULL
);

COMMENT ON TABLE public.propostas_status_alterado IS
  'Momento da ultima mudanca real de propostas.status_interno (sem a migracao APROVADO -> LIBERADO). Mantida pelo trigger trg_propostas_status_alterado; so leitura para authenticated. Fonte da coluna Data / Hora da lista de Pedidos (vw_propostas_lista).';

ALTER TABLE public.propostas_status_alterado ENABLE ROW LEVEL SECURITY;
-- Leitura igual a de `propostas` para authenticated (a RLS dela tambem e aberta
-- para leitura): a tabela so tem id_int e um horario.
CREATE POLICY propostas_status_alterado_select_authenticated
  ON public.propostas_status_alterado FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.propostas_status_alterado FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.propostas_status_alterado TO authenticated;

-- 2. Trigger --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.propostas__registrar_status_alterado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_velho text;
  v_novo  text;
BEGIN
  IF NEW.id_int IS NULL THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.propostas_status_alterado (id_int, status_alterado_em)
    VALUES (NEW.id_int, coalesce(NEW.created_at, now()))
    ON CONFLICT (id_int) DO NOTHING;
    RETURN NULL;
  END IF;

  -- UPDATE OF status_interno dispara mesmo sem mudar o valor.
  IF NEW.status_interno IS NOT DISTINCT FROM OLD.status_interno THEN
    RETURN NULL;
  END IF;

  -- Migracao do legado APROVADO -> LIBERADO (com ou sem " / EM ARTE") nao conta.
  v_velho := upper(btrim(coalesce(OLD.status_interno, '')));
  v_novo  := upper(btrim(coalesce(NEW.status_interno, '')));
  IF v_velho LIKE 'APROVADO%' AND v_novo = replace(v_velho, 'APROVADO', 'LIBERADO') THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.propostas_status_alterado (id_int, status_alterado_em)
  VALUES (NEW.id_int, now())
  ON CONFLICT (id_int) DO UPDATE SET status_alterado_em = EXCLUDED.status_alterado_em;
  RETURN NULL;
END;
$$;

-- O Postgres nao confere EXECUTE ao disparar trigger (so ao cria-lo); a funcao
-- nao precisa ser chamavel por ninguem.
REVOKE ALL ON FUNCTION public.propostas__registrar_status_alterado() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_propostas_status_alterado
  AFTER INSERT OR UPDATE OF status_interno ON public.propostas
  FOR EACH ROW EXECUTE FUNCTION public.propostas__registrar_status_alterado();

-- 3. Carga inicial (um INSERT ... SELECT; so le audit.logs_v2) ----------------------
INSERT INTO public.propostas_status_alterado (id_int, status_alterado_em)
SELECT p.id_int, coalesce(u.ultima, p.created_at, now())
  FROM public.propostas p
  LEFT JOIN (
    SELECT (l.record_pk->>'id') AS pid, max(l.occurred_at) AS ultima
      FROM audit.logs_v2 l
     WHERE l.schema_name = 'public'
       AND l.table_name = 'propostas'
       AND l.changed_fields ? 'status_interno'
       AND coalesce(l.changed_fields->'status_interno'->>'old', '') IS DISTINCT FROM coalesce(l.changed_fields->'status_interno'->>'new', '')
       AND NOT (
         upper(btrim(coalesce(l.changed_fields->'status_interno'->>'old', ''))) LIKE 'APROVADO%'
         AND upper(btrim(coalesce(l.changed_fields->'status_interno'->>'new', '')))
             = replace(upper(btrim(coalesce(l.changed_fields->'status_interno'->>'old', ''))), 'APROVADO', 'LIBERADO')
       )
     GROUP BY 1
  ) u ON u.pid = p.id::text
 WHERE p.id_int IS NOT NULL
ON CONFLICT (id_int) DO NOTHING;

-- 4. View da lista -----------------------------------------------------------------
CREATE VIEW public.vw_propostas_lista
WITH (security_invoker = true) AS
SELECT p.*,
       coalesce(s.status_alterado_em, p.created_at) AS status_alterado_em
  FROM public.propostas p
  LEFT JOIN public.propostas_status_alterado s ON s.id_int = p.id_int;

COMMENT ON VIEW public.vw_propostas_lista IS
  'Lista de Pedidos: propostas + status_alterado_em (ultima mudanca real de status_interno; sem historico, created_at). security_invoker: vale a RLS de propostas. Colunas de propostas congeladas na criacao da view (p.*).';

REVOKE ALL ON public.vw_propostas_lista FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vw_propostas_lista TO authenticated;
