-- cc__assert_permissao: le perfis.permissoes como JSONB, nao como text[]
--
-- PROBLEMA
--   `public.perfis.permissoes` e JSONB (um array JSON de strings). A funcao
--   declarava `v_perms text[]` e fazia `SELECT permissoes INTO v_perms`.
--   O Postgres nao converte jsonb -> text[] direto: serializa o jsonb para
--   texto (`["cadastros.view", "cadastros.create", ...]`) e tenta ler esse
--   texto como literal de array, o que estoura em
--
--     22P02 malformed array literal
--     DETAIL: "[" must introduce explicitly-specified array dimensions.
--
--   Ou seja: a funcao NUNCA conseguiu consultar as permissoes do perfil. Ela
--   so retornava sem erro para quem nem chegava nessa linha —
--   `is_super_adm = true` (sai antes) ou usuario sem `id_perfil`. Todo o
--   resto — inclusive o perfil Vendedor, que TEM `credito.usar` — recebia
--   excecao de banco no lugar da checagem.
--
-- IMPACTO OBSERVADO (06/08/2026)
--   Vendedor Andre Toniazzo, proposta #20255, E-Credito de R$ 190,00:
--   "Falha ao registrar chave de idempotencia: malformed array literal".
--   A chamada morria em `pgv2_registrar_chave_idempotencia`, que abre com
--   `PERFORM cc__assert_permissao(v_uid, 'credito.usar')`. O texto do erro
--   exibido na tela era, literalmente, o array de permissoes do perfil 4.
--
--   Nao houve dano financeiro: o E-CREDITO recem-inserido e cancelado pela
--   rota antes de qualquer consumo de saldo (o consumo FIFO so acontece
--   depois deste ponto). O prejuizo foi funcional — E-Credito inutilizavel
--   para todo perfil nao superadmin — e afetava as 8 funcoes que dependem
--   desta checagem: cc_abrir_pendencia, cc_encerrar_pendencia,
--   cc_usar_pendencia, mc_ajuste_avulso_criar, mc_ajuste_avulso_estornar,
--   mc_confirmar_abatimento_legado, mc_usar_credito_avulso e
--   pgv2_registrar_chave_idempotencia.
--
-- CORRECAO
--   Trocar `text[]` por `jsonb` e usar o operador de existencia de chave
--   (`?`), exatamente como ja fazem `osqr__has_permissao` e
--   `osqr__assert_escopo` — que sempre leram esta coluna do jeito certo e
--   servem de referencia do padrao correto no schema.
--
--   NADA MAIS MUDA. A ordem das checagens, os codigos de erro (28000 /
--   42501), o atalho de `is_super_adm`, o ramo `__ADMIN__`, o coringa `*` e
--   o fallback final por `is_admin` ficam identicos. Esta migration NAO
--   afrouxa nem endurece permissao: faz a funcao passar a de fato ler o que
--   sempre pretendeu ler.

CREATE OR REPLACE FUNCTION public.cc__assert_permissao(p_uid uuid, p_perm text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_super boolean; v_admin boolean; v_perfil bigint; v_perms jsonb;
BEGIN
  IF p_uid IS NULL THEN RAISE EXCEPTION 'AUTH: usuário não autenticado' USING ERRCODE = '28000'; END IF;
  SELECT is_super_adm, is_admin, id_perfil INTO v_super, v_admin, v_perfil
  FROM public.usuarios WHERE user_id = p_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'AUTH: usuário sem cadastro em public.usuarios' USING ERRCODE = '42501'; END IF;
  IF v_super THEN RETURN; END IF;
  IF p_perm = '__ADMIN__' THEN
    IF v_admin THEN RETURN; END IF;
    RAISE EXCEPTION 'PERM: operação restrita a administrador/superadministrador' USING ERRCODE = '42501';
  END IF;
  IF v_perfil IS NOT NULL THEN
    -- `?` = "esta chave/elemento existe neste jsonb". Em array JSON de
    -- strings, testa pertinencia do elemento. Mesmo operador usado em
    -- osqr__has_permissao.
    SELECT permissoes INTO v_perms FROM public.perfis WHERE id = v_perfil AND ativo = true;
    IF v_perms IS NOT NULL AND (v_perms ? '*' OR v_perms ? p_perm) THEN RETURN; END IF;
  END IF;
  IF v_admin THEN RETURN; END IF;
  RAISE EXCEPTION 'PERM: sem permissão %', p_perm USING ERRCODE = '42501';
END; $function$;
