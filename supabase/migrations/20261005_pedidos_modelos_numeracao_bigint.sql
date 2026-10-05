-- ============================================================================
-- pedidos_modelos — Nº Inicial e Nº Final passam de integer para bigint
-- 05/10/2026 — decisão do dono.
--
-- PROBLEMA
--   Ao salvar o modelo #1001671 (proposta 22917) com a numeração do cliente, de
--   12 dígitos, o banco recusou: "value 100020267020 is out of range for type
--   integer". `numeracao_inicio` e `numeracao_fim` eram integer (int4), que vai
--   até 2.147.483.647 — 10 dígitos.
--
-- O QUE MUDA
--   Só o tipo das duas colunas: integer -> bigint (até 19 dígitos). É uma
--   ampliação: todo valor gravado cabe no tipo novo e continua o mesmo. O
--   bloco confere isso — a soma de verificação das duas colunas, por id, tem de
--   ser igual antes e depois, senão a migration inteira é desfeita.
--
-- QUEM DEPENDE DAS COLUNAS (conferido em 05/10/2026)
--   Nenhuma visão, índice ou restrição. Duas funções leem as colunas, sem
--   variável nem parâmetro integer: `copiar_proposta_v2` (INSERT ... SELECT de
--   coluna para coluna) e `producao_acesso_fonte_preparacao` (monta jsonb).
--   Nenhum gatilho da tabela toca nelas. Nada precisa ser recriado.
--
-- O QUE NÃO MUDA
--   `quantidade`, `ordem`, `cutstack_folhas` e as demais colunas; RLS,
--   permissões e gatilhos. Nenhum valor é recalculado ou regravado.
--
-- LIMITE QUE CONTINUA EXISTINDO, FORA DO BANCO
--   A tela trata o número como `number` do JavaScript, exato até
--   9.007.199.254.740.991 (15 dígitos completos). Acima disso o navegador
--   arredonda antes de gravar.
--
-- ROLLBACK: no rodapé.
-- ============================================================================

DO $migracao$
DECLARE
  v_tipo_inicio text;
  v_tipo_fim text;
  v_antes text;
  v_depois text;
BEGIN
  -- A troca de tipo regrava a tabela (pequena) com trava exclusiva: se alguém
  -- estiver com ela presa, desiste em vez de enfileirar o sistema atrás.
  SET LOCAL lock_timeout = '5s';

  SELECT format_type(a.atttypid, a.atttypmod) INTO v_tipo_inicio
  FROM pg_attribute a
  WHERE a.attrelid = 'public.pedidos_modelos'::regclass AND a.attname = 'numeracao_inicio';

  SELECT format_type(a.atttypid, a.atttypmod) INTO v_tipo_fim
  FROM pg_attribute a
  WHERE a.attrelid = 'public.pedidos_modelos'::regclass AND a.attname = 'numeracao_fim';

  IF v_tipo_inicio IS DISTINCT FROM 'integer' OR v_tipo_fim IS DISTINCT FROM 'integer' THEN
    RAISE EXCEPTION 'pedidos_modelos: esperava numeracao_inicio e numeracao_fim integer, achei % e %; reconfira antes de aplicar',
      v_tipo_inicio, v_tipo_fim;
  END IF;

  LOCK TABLE public.pedidos_modelos IN ACCESS EXCLUSIVE MODE;

  SELECT md5(COALESCE(string_agg(
           id::text || ':' || COALESCE(numeracao_inicio::text, '') || ':' || COALESCE(numeracao_fim::text, ''),
           ',' ORDER BY id), ''))
    INTO v_antes
  FROM public.pedidos_modelos;

  ALTER TABLE public.pedidos_modelos
    ALTER COLUMN numeracao_inicio TYPE bigint,
    ALTER COLUMN numeracao_fim TYPE bigint;

  SELECT md5(COALESCE(string_agg(
           id::text || ':' || COALESCE(numeracao_inicio::text, '') || ':' || COALESCE(numeracao_fim::text, ''),
           ',' ORDER BY id), ''))
    INTO v_depois
  FROM public.pedidos_modelos;

  IF v_antes IS DISTINCT FROM v_depois THEN
    RAISE EXCEPTION 'pedidos_modelos: os valores mudaram na troca de tipo (% -> %); nada foi aplicado', v_antes, v_depois;
  END IF;
END
$migracao$;

COMMENT ON COLUMN public.pedidos_modelos.numeracao_inicio IS
  'Nº Inicial do modelo. bigint desde 05/10/2026: a numeração do cliente pode ter 12 dígitos ou mais.';
COMMENT ON COLUMN public.pedidos_modelos.numeracao_fim IS
  'Nº Final do modelo. bigint desde 05/10/2026: a numeração do cliente pode ter 12 dígitos ou mais.';

-- ============================================================================
-- ROLLBACK — devolve as duas colunas a integer.
-- SÓ FUNCIONA SE NENHUM VALOR PASSAR DE 2147483647. Se algum modelo já tiver
-- numeração maior, o ALTER falha com "integer out of range" e nada muda: o
-- rollback, nesse caso, exigiria apagar ou reduzir esses números, e isso é
-- decisão do dono. Confira antes:
--
--   SELECT id, id_int, numeracao_inicio, numeracao_fim
--   FROM public.pedidos_modelos
--   WHERE numeracao_inicio > 2147483647 OR numeracao_fim > 2147483647;
--
-- ============================================================================
/*
ALTER TABLE public.pedidos_modelos
  ALTER COLUMN numeracao_inicio TYPE integer,
  ALTER COLUMN numeracao_fim TYPE integer;
COMMENT ON COLUMN public.pedidos_modelos.numeracao_inicio IS NULL;
COMMENT ON COLUMN public.pedidos_modelos.numeracao_fim IS NULL;
*/
