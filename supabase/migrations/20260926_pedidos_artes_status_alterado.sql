-- ============================================================================
-- Data da ultima mudanca de status da ARTE — 26/09/2026, decisao do dono.
--
-- POR QUE UMA TABELA LATERAL
--   `pedidos_artes` nao guarda quando o status mudou: `updated_at` muda com
--   qualquer gravacao (briefing, anexo, designer), `data_aprovacao` nunca foi
--   preenchida e `audit.logs_v2` nunca registrou a tabela. Nao ha de onde tirar
--   o passado.
--
-- O QUE MUDA
--   - `public.pedidos_artes_status_alterado` guarda, por registro de arte, o
--     momento da ultima mudanca de `status`.
--   - trigger AFTER INSERT OR UPDATE OF status em `pedidos_artes` grava now():
--     ao criar a arte com status, e em UPDATE so quando o valor muda de verdade
--     (salvar sem mudar o status nao registra). Nunca escreve em `pedidos_artes`
--     — nao mexe no fluxo da designer, do n8n nem em `updated_at`.
--   - SEM CARGA INICIAL, por decisao do dono: a data aparece a partir da
--     primeira mudanca de status depois de ligar.
--   - A lista de Pedidos mostra a data abaixo do Status Arte; sem registro, nada.
-- ============================================================================

CREATE TABLE public.pedidos_artes_status_alterado (
  id_arte            uuid        PRIMARY KEY REFERENCES public.pedidos_artes(id) ON DELETE CASCADE,
  status_alterado_em timestamptz NOT NULL
);

COMMENT ON TABLE public.pedidos_artes_status_alterado IS
  'Momento da ultima mudanca de pedidos_artes.status, por registro de arte. Mantida pelo trigger trg_pedidos_artes_status_alterado; so leitura para authenticated. Sem historico anterior a 26/09/2026 (carga inicial vazia).';

ALTER TABLE public.pedidos_artes_status_alterado ENABLE ROW LEVEL SECURITY;
CREATE POLICY pedidos_artes_status_alterado_select_authenticated
  ON public.pedidos_artes_status_alterado FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.pedidos_artes_status_alterado FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.pedidos_artes_status_alterado TO authenticated;

CREATE OR REPLACE FUNCTION public.pedidos_artes__registrar_status_alterado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF nullif(btrim(coalesce(NEW.status, '')), '') IS NULL THEN
      RETURN NULL;
    END IF;
  ELSIF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    -- UPDATE OF status dispara mesmo quando o valor nao muda (o salvamento do
    -- briefing reenvia o status): nao e mudanca.
    RETURN NULL;
  END IF;

  INSERT INTO public.pedidos_artes_status_alterado (id_arte, status_alterado_em)
  VALUES (NEW.id, now())
  ON CONFLICT (id_arte) DO UPDATE SET status_alterado_em = EXCLUDED.status_alterado_em;
  RETURN NULL;
END;
$$;

-- O Postgres nao confere EXECUTE ao disparar trigger; a funcao nao precisa ser
-- chamavel por ninguem.
REVOKE ALL ON FUNCTION public.pedidos_artes__registrar_status_alterado() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_pedidos_artes_status_alterado
  AFTER INSERT OR UPDATE OF status ON public.pedidos_artes
  FOR EACH ROW EXECUTE FUNCTION public.pedidos_artes__registrar_status_alterado();
