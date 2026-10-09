-- ============================================================================
-- propostas — coluna nova `obs_entrega` ("Instruções de entrega")
-- 09/10/2026 — pedido da diretoria.
--
-- SITUAÇÃO: escrita em 09/10/2026 para aplicar com o "pode aplicar" nominal do
-- dono (migration propostas_obs_entrega). Ver o rodapé para o que foi medido.
--
-- O QUE É
--   Uma coluna aditiva em public.propostas, nulável e sem default:
--
--     obs_entrega  text
--
--   Guarda as INSTRUÇÕES DE ENTREGA do pedido ("entregar na quinta pela
--   manhã"): texto livre, um por pedido, separado da orientação técnica de
--   produção (`obs_tecnica`, de 25/08/2026). Mesmo desenho dela: o vendedor
--   escreve na aba Produção / Expedição da proposta, o gerente revisa no
--   boletim, e os dois gravam na MESMA linha. Sai no boletim, nos dois PDFs da
--   OS e nos cards da Expedição.
--
--   Nula = ninguém escreveu. NÃO HÁ BACKFILL: toda proposta existente nasce
--   nula, e nada é tirado de `obs_tecnica` nem de `obs_proposta`.
--
-- POR QUE EM public.propostas
--   É onde vive `obs_tecnica`, com a mesma regra de edição. Gravar nela dispara
--   o que qualquer UPDATE em propostas já dispara, medido em 09/10/2026:
--     - propostas_set_timestamp / trg_set_updated_at: recarimbam updated_at;
--     - trg_audit_propostas: registra na auditoria;
--     - etapa_arte_por_proposta: sai sem agir (só id_int ou status_interno);
--     - tg_registrar_paid_at: nada (só na virada para RECEBIDO);
--     - tg_propostas_valor_total_avulsa: nada, salvo avulsa com valor_total
--       nulo ou zero, que ele preenche — como em qualquer gravação de hoje.
--   Não há gatilho de frete em propostas.
--
-- O QUE NÃO MUDA
--   Nenhuma linha, nenhuma outra coluna, nenhum gatilho, função, visão, índice,
--   política, grant ou default. `vw_propostas_lista` (p.* congelado) não passa a
--   enxergar a coluna, e não precisa. `copiar_proposta_v2` e
--   `criar_pedido_complementar` inserem por lista de colunas: a coluna nova NÃO
--   é copiada, de propósito (decisão do dono).
--
-- TRAVA
--   lock_timeout de 5 s: se a tabela estiver ocupada, a migration desiste em
--   vez de enfileirar o sistema atrás dela. A tabela fica travada só enquanto o
--   bloco roda, e o bloco confere, com ela travada, que NADA mudou além da
--   coluna nova (resumo md5 de todas as linhas, antes e depois).
-- ============================================================================

DO $migracao$
DECLARE
  v_linhas_antes bigint;
  v_linhas_depois bigint;
  v_hash_antes text;
  v_hash_depois text;
  v_com_valor bigint;
  v_tipo text;
  v_nula text;
  v_default text;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  LOCK TABLE public.propostas IN ACCESS EXCLUSIVE MODE;

  SELECT count(*), md5(coalesce(string_agg(md5((to_jsonb(p) - 'obs_entrega')::text), '' ORDER BY md5((to_jsonb(p) - 'obs_entrega')::text)), ''))
    INTO v_linhas_antes, v_hash_antes
    FROM public.propostas p;

  ALTER TABLE public.propostas ADD COLUMN IF NOT EXISTS obs_entrega text;

  COMMENT ON COLUMN public.propostas.obs_entrega IS
    'Instrucoes de entrega do pedido (texto livre). Sai no boletim, nos PDFs da OS e nos cards da Expedicao. Nula = ninguem escreveu.';

  SELECT data_type, is_nullable, column_default
    INTO v_tipo, v_nula, v_default
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'propostas' AND column_name = 'obs_entrega';

  IF v_tipo IS DISTINCT FROM 'text' OR v_nula IS DISTINCT FROM 'YES' OR v_default IS NOT NULL THEN
    RAISE EXCEPTION 'obs_entrega fora do combinado: tipo %, nula %, default %', v_tipo, v_nula, v_default;
  END IF;

  EXECUTE $sql$
    SELECT count(*), count(obs_entrega),
           md5(coalesce(string_agg(md5((to_jsonb(p) - 'obs_entrega')::text), '' ORDER BY md5((to_jsonb(p) - 'obs_entrega')::text)), ''))
      FROM public.propostas p
  $sql$ INTO v_linhas_depois, v_com_valor, v_hash_depois;

  IF v_linhas_depois <> v_linhas_antes THEN
    RAISE EXCEPTION 'contagem de propostas mudou: % -> %', v_linhas_antes, v_linhas_depois;
  END IF;
  IF v_com_valor <> 0 THEN
    RAISE EXCEPTION 'esperado nenhuma proposta com obs_entrega (sem backfill), achei %', v_com_valor;
  END IF;
  IF v_hash_depois IS DISTINCT FROM v_hash_antes THEN
    RAISE EXCEPTION 'o resumo de propostas mudou alem da coluna nova: % -> %', v_hash_antes, v_hash_depois;
  END IF;

  RAISE NOTICE 'propostas.obs_entrega criada: text, nula, sem default; % propostas, nenhuma com valor; resumo % (igual antes e depois)', v_linhas_depois, v_hash_depois;
END
$migracao$;

-- ============================================================================
-- ROLLBACK (não roda sozinho)
--
-- Antes de reverter, publique o app SEM a coluna: a proposta, o boletim, a OS e
-- a Expedição passam a ler `obs_entrega`. O rollback apaga os textos gravados.
-- Guarde-os antes:
--
--   select id_int, obs_entrega from public.propostas where obs_entrega is not null;
-- ============================================================================
/*
DO $rollback$
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  ALTER TABLE public.propostas DROP COLUMN IF EXISTS obs_entrega;
END
$rollback$;
*/
