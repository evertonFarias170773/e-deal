-- Alinha `cc_abrir_pendencia` do repositório ao corpo que roda em PRODUÇÃO
--
-- O QUE E
--   Redefine `public.cc_abrir_pendencia` com o corpo EXATO que esta em producao
--   hoje (19/08/2026). Nao muda comportamento, assinatura, permissao nem regra
--   nenhuma. E uma migration de CONVERGENCIA: existe para o repositorio parar de
--   descrever uma funcao diferente da que roda.
--
-- POR QUE
--   `20260721_conta_corrente_fase1a_aditiva.sql` (linhas 549-557) define esta
--   funcao com um bloco a mais, que a funcao viva NAO tem:
--
--     -- REGRA (2026-07-22): diferenca DEVEDORA (novo total > pago) [...]
--     IF v_diff > 0 THEN
--       v_dir := NULL;
--       v_new := 0;
--     END IF;
--
--   Verificado no banco vivo em 19/08/2026, antes de escrever:
--
--     position('REGRA (2026-07-22)' in prosrc) = 0
--     position('v_dir := NULL;'     in prosrc) = 0
--     length(prosrc)                          = 7793
--
--   Nenhuma outra migration redefine a funcao. Ou seja: a producao nunca teve
--   esse bloco, e a regra de 22/07 e aplicada SOMENTE pelo chamador, em
--   `src/app/api/orcamentos/editar-paga/route.ts` (linhas 601-614), que so chama
--   a RPC no caso devedor quando existe pendencia ABERTA a reconciliar.
--
--   Consequencia pratica: em producao `cc_abrir_pendencia` ja aceita diferenca
--   devedora e ja cria pendencia FAVOR_EMPRESA. Existem 7 linhas assim em
--   `conta_corrente_pendencias` (2 CANCELADA + 5 RESOLVIDA, todas motivo OUTRO).
--
--   O RISCO QUE ESTA MIGRATION FECHA
--     O arquivo de 21/07 usa `CREATE OR REPLACE` sem guarda. Qualquer replay das
--     migrations (`supabase db push`, `db reset`, ambiente novo) sobrescreve a
--     funcao viva com a versao do arquivo e REINTRODUZ o bloco — em silencio.
--     Nada quebraria de imediato, porque `editar-paga` ja filtra o caso devedor
--     antes de chamar; o que quebraria e o que vier depois e depender de a RPC
--     aceitar debito. Ficando esta migration por ultimo na ordem cronologica, o
--     replay termina no corpo correto.
--
-- ESCOPO / O QUE ESTA MIGRATION NAO FAZ
--   Estritamente uma redefinicao identica ao vivo. NAO introduz a excecao de
--   FRETE, NAO reintroduz a regra de 22/07 no banco, NAO altera permissao,
--   assinatura, CHECK, indice, RLS, trigger ou dado. Nenhum chamador muda.
--
--   Diferenca de FORMA em relacao ao que `pg_get_functiondef` imprime: a lista de
--   parametros usa a formatacao das migrations vizinhas, e a clausula de
--   search_path usa `= public, pg_temp` em vez de `TO 'public', 'pg_temp'`. As
--   duas formas produzem o mesmo `proconfig`. O CORPO (entre $$ e $$) e verbatim.
--
-- APLICADA EM PRODUCAO — 19/08/2026
--   O `md5(prosrc)` MUDOU na aplicacao:
--
--     antes:  52c84dccd9d7a6bff2d842cea1ad1859   (length 7793)
--     depois: f84a6ab657a1bd5cb0a7c162f89cc736   (length 7655)
--
--   A causa e EXCLUSIVAMENTE o terminador de linha: o corpo antigo estava gravado
--   com CRLF; este arquivo usa LF. Medido depois de aplicar:
--
--     carriage_returns = 0        (nenhum CR restante)
--     line_feeds       = 138      (138 quebras de linha)
--     bytes a menos    = 138      (exatamente 1 byte por quebra)
--     md5(replace(prosrc, LF, CRLF)) = 52c84dccd9d7a6bff2d842cea1ad1859
--
--   A ultima linha e a prova: reconvertendo o corpo atual para CRLF, o digest
--   volta a ser o anterior, byte a byte. O texto do codigo e IDENTICO caractere a
--   caractere; para o PL/pgSQL o terminador de linha nao significa nada e o
--   COMPORTAMENTO ESTA INALTERADO. LF e o formato correto para o repositorio (o
--   `.gitattributes` normaliza), entao o CRLF nao foi restaurado — decisao do
--   dono em 19/08/2026.
--
--   Tudo o mais permaneceu igual na aplicacao: as sete guardas presentes, as duas
--   `position()` do bloco de 22/07 em 0, assinatura, `prosecdef` e `proconfig`
--   inalterados, e a contagem de `conta_corrente_pendencias` intocada.

CREATE OR REPLACE FUNCTION public.cc_abrir_pendencia(
  p_id_int bigint, p_id_cliente bigint, p_chave_evento uuid,
  p_motivo text, p_total_soberano numeric, p_observacao text DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_exist bigint; v_prop_cliente bigint;
  v_pago numeric; v_diff numeric; v_dir text; v_new numeric;
  v_open public.conta_corrente_pendencias%ROWTYPE;
  v_committed numeric; v_delta numeric; v_tipo text; v_new_id bigint;
  v_total_recalculado numeric;
BEGIN
  PERFORM public.cc__assert_permissao(v_uid, 'propostas.editar_paga');
  IF p_id_int IS NULL OR p_id_cliente IS NULL OR p_chave_evento IS NULL OR p_motivo IS NULL THEN
    RAISE EXCEPTION 'CC_PARAMS: id_int, id_cliente, chave_evento e motivo são obrigatórios';
  END IF;

  SELECT id INTO v_exist FROM public.conta_corrente_pendencias WHERE chave_evento = p_chave_evento;
  IF FOUND THEN RETURN v_exist; END IF;

  SELECT id_cliente INTO v_prop_cliente FROM public.propostas WHERE id_int = p_id_int;
  IF NOT FOUND THEN RAISE EXCEPTION 'CC_PROPOSTA: proposta #% não encontrada', p_id_int; END IF;

  -- p_id_cliente deve corresponder ao cliente real da proposta, nunca só o
  -- valor que o chamador informou.
  IF v_prop_cliente IS DISTINCT FROM p_id_cliente THEN
    RAISE EXCEPTION 'CC_CLIENTE: id_cliente informado (%) não corresponde ao cliente real da proposta #% (%)', p_id_cliente, p_id_int, v_prop_cliente;
  END IF;

  -- Escopo de empresa do usuário (mesma regra oficial já usada no projeto).
  PERFORM public.cc__assert_escopo_empresa(v_uid, p_id_int);

  v_pago := public.cc__valor_pago(p_id_int);

  -- A pendência só existe para diferença surgida DEPOIS que a proposta já
  -- está paga — sem pagamento confirmado não há "diferença" a registrar.
  IF v_pago <= 0 THEN
    RAISE EXCEPTION 'CC_NAO_PAGA: proposta #% não possui pagamento confirmado — Conta Corrente só se aplica a diferença após proposta paga', p_id_int;
  END IF;

  -- Não confia isoladamente em p_total_soberano: recalcula no banco (itens
  -- não CANCELADOS + frete escolhido + desconto geral) e rejeita divergência
  -- além de tolerância de arredondamento (R$ 0,02 — mesma tolerância já
  -- usada em resolver-diferenca/route.ts).
  v_total_recalculado := public.cc__total_soberano_proposta(p_id_int);
  IF v_total_recalculado IS NULL THEN
    RAISE EXCEPTION 'CC_TOTAL_INDISPONIVEL: não foi possível recalcular o total da proposta #%', p_id_int;
  END IF;
  IF abs(v_total_recalculado - p_total_soberano) > 0.02 THEN
    RAISE EXCEPTION 'CC_TOTAL_DIVERGENTE: total informado (R$ %) diverge do recalculado no banco (R$ %) para a proposta #%', p_total_soberano, v_total_recalculado, p_id_int;
  END IF;

  v_diff := round(p_total_soberano - v_pago, 2);
  v_dir  := CASE WHEN v_diff < 0 THEN 'FAVOR_CLIENTE' WHEN v_diff > 0 THEN 'FAVOR_EMPRESA' ELSE NULL END;
  v_new  := abs(v_diff);

  SELECT * INTO v_open FROM public.conta_corrente_pendencias
   WHERE id_int = p_id_int AND status IN ('ABERTA','PARCIALMENTE_RESOLVIDA')
   FOR UPDATE;

  IF FOUND THEN
    v_committed := v_open.valor_reservado + (v_open.valor_original - v_open.valor_saldo - v_open.valor_reservado);
    IF v_dir IS NULL OR v_dir = v_open.direcao THEN
      IF v_new < 0.01 THEN
        IF v_committed > 0 THEN
          RAISE EXCEPTION 'CC_AJUSTE_ABAIXO_COMPROMETIDO: diferença zerada mas há valor já usado/reservado (R$ %) — revisão do financeiro necessária', v_committed;
        END IF;
        IF v_open.valor_saldo > 0 THEN
          INSERT INTO public.movimento_credito (id_cliente, id_int, valor, tipo, origem, observacao, created_by,
                 id_pendencia, tipo_evento, id_int_origem, motivo_evento)
          VALUES (p_id_cliente, p_id_int, v_open.valor_saldo,
                 CASE WHEN v_open.direcao = 'FAVOR_CLIENTE' THEN 'DEBITO' ELSE 'CREDITO' END,
                 'SISTEMA', 'Diferença zerada após nova alteração da proposta.', v_uid,
                 v_open.id, 'CANCELAMENTO', p_id_int, 'DIFERENCA_ZERADA');
        END IF;
        UPDATE public.conta_corrente_pendencias
           SET valor_saldo = 0, status = 'CANCELADA', encerrado_em = now(), encerrado_por = v_uid,
               motivo_encerramento = 'DIFERENCA_ZERADA', atualizado_em = now()
         WHERE id = v_open.id;
        PERFORM public.cc__timeline(p_id_int, p_id_cliente,
          '✔️ Pendência encerrada: diferença financeira zerada após nova alteração.', v_uid);
        RETURN v_open.id;
      END IF;
      IF v_new < v_committed - 0.001 THEN
        RAISE EXCEPTION 'CC_AJUSTE_ABAIXO_COMPROMETIDO: nova diferença (R$ %) menor que o já comprometido (R$ %) — revisão do financeiro necessária', v_new, v_committed;
      END IF;
      v_delta := round(v_new - v_open.valor_original, 2);
      IF v_delta <> 0 THEN
        v_tipo := CASE
          WHEN (v_open.direcao = 'FAVOR_CLIENTE' AND v_delta > 0) OR (v_open.direcao = 'FAVOR_EMPRESA' AND v_delta < 0) THEN 'CREDITO'
          ELSE 'DEBITO' END;
        INSERT INTO public.movimento_credito (id_cliente, id_int, valor, tipo, origem, observacao, created_by,
               id_pendencia, tipo_evento, id_int_origem, motivo_evento)
        VALUES (p_id_cliente, p_id_int, abs(v_delta), v_tipo, 'SISTEMA',
               'Ajuste de diferença da pendência (reconciliação).', v_uid,
               v_open.id, 'ABERTURA', p_id_int, p_motivo);
        UPDATE public.conta_corrente_pendencias
           SET valor_original = v_new, valor_saldo = valor_saldo + v_delta,
               status = public.cc__status(v_new, valor_saldo + v_delta, valor_reservado),
               atualizado_em = now()
         WHERE id = v_open.id;
        PERFORM public.cc__timeline(p_id_int, p_id_cliente,
          format('🔁 Pendência ajustada para R$ %s (%s).', to_char(v_new,'FM999999990.00'), v_open.direcao), v_uid);
      END IF;
      RETURN v_open.id;
    ELSE
      IF v_committed > 0 THEN
        RAISE EXCEPTION 'CC_FLIP_COM_COMPROMETIDO: inversão de direção com valor já usado/reservado — revisão do financeiro necessária';
      END IF;
      INSERT INTO public.movimento_credito (id_cliente, id_int, valor, tipo, origem, observacao, created_by,
             id_pendencia, tipo_evento, id_int_origem, motivo_evento)
      VALUES (p_id_cliente, p_id_int, v_open.valor_saldo,
             CASE WHEN v_open.direcao = 'FAVOR_CLIENTE' THEN 'DEBITO' ELSE 'CREDITO' END,
             'SISTEMA', 'Encerramento por inversão de direção.', v_uid,
             v_open.id, 'CANCELAMENTO', p_id_int, 'INVERSAO_DIRECAO');
      UPDATE public.conta_corrente_pendencias
         SET valor_saldo = 0, status = 'CANCELADA', encerrado_em = now(), encerrado_por = v_uid,
             motivo_encerramento = 'INVERSAO_DIRECAO', atualizado_em = now()
       WHERE id = v_open.id;
    END IF;
  END IF;

  IF v_new < 0.01 THEN RETURN NULL; END IF;
  INSERT INTO public.conta_corrente_pendencias
    (id_int, id_cliente, direcao, motivo, valor_original, valor_saldo, valor_reservado, status, chave_evento, observacao, created_by)
  VALUES (p_id_int, p_id_cliente, v_dir, p_motivo, v_new, v_new, 0, 'ABERTA', p_chave_evento, p_observacao, v_uid)
  RETURNING id INTO v_new_id;

  INSERT INTO public.movimento_credito (id_cliente, id_int, valor, tipo, origem, observacao, created_by,
         id_pendencia, tipo_evento, id_int_origem, motivo_evento)
  VALUES (p_id_cliente, p_id_int, v_new,
         CASE WHEN v_dir = 'FAVOR_CLIENTE' THEN 'CREDITO' ELSE 'DEBITO' END,
         'SISTEMA', 'Abertura de pendência por alteração de proposta paga.', v_uid,
         v_new_id, 'ABERTURA', p_id_int, p_motivo);

  PERFORM public.cc__timeline(p_id_int, p_id_cliente,
    format('🧾 Pendência aberta: R$ %s a favor de %s (motivo: %s).',
           to_char(v_new,'FM999999990.00'),
           CASE WHEN v_dir='FAVOR_CLIENTE' THEN 'cliente' ELSE 'empresa' END, p_motivo), v_uid);

  RETURN v_new_id;
END; $$;

COMMENT ON FUNCTION public.cc_abrir_pendencia(bigint, bigint, uuid, text, numeric, text) IS
  'Abre/reconcilia a pendência de Conta Corrente de uma proposta paga. ATENÇÃO: '
  '20260721_conta_corrente_fase1a_aditiva.sql contém uma versão DIVERGENTE e HISTÓRICA '
  'desta função — ela inclui o bloco da regra de 22/07 (IF v_diff > 0 THEN v_dir := NULL) '
  'que a produção nunca teve, e não deve ser reaplicada isoladamente. A definição válida '
  'é a de 20260819_cc_abrir_pendencia_alinha_producao.sql, que é a última na ordem '
  'cronológica e reproduz o corpo vivo. A regra de 22/07 é aplicada pelo CHAMADOR, em '
  'src/app/api/orcamentos/editar-paga/route.ts (601-614).';

-- VERIFICACAO (somente leitura, depois de aplicar)
--
--   -- a) o bloco de 22/07 continua AUSENTE (as duas posicoes devem ser 0)
--   select position('REGRA (2026-07-22)' in prosrc) as pos_regra_2207,
--          position('v_dir := NULL;'     in prosrc) as pos_bloco_anula,
--          length(prosrc)                           as tamanho
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'cc_abrir_pendencia';
--   -- Esperado: 0 | 0 | 7793 (mesmo tamanho medido antes de aplicar).
--
--   -- b) o corpo continua equivalente: todas as guardas presentes, nenhuma a mais.
--   --    REFERENCIA ATUAL (pos-aplicacao, com LF):
--   --      md5(prosrc)    = f84a6ab657a1bd5cb0a7c162f89cc736
--   --      length(prosrc) = 7655
--   --    O digest anterior (52c84dcc..., length 7793) e o mesmo corpo em CRLF —
--   --    ver o bloco "APLICADA EM PRODUCAO" no cabecalho. Se um dia der esse
--   --    valor de novo, NAO e regressao de logica: e terminador de linha.
--   select md5(prosrc) as digest_do_corpo,
--          position('cc__assert_permissao(v_uid, ''propostas.editar_paga'')' in prosrc) > 0 as g_permissao,
--          position('CC_NAO_PAGA'                   in prosrc) > 0 as g_nao_paga,
--          position('CC_TOTAL_DIVERGENTE'           in prosrc) > 0 as g_total_divergente,
--          position('CC_AJUSTE_ABAIXO_COMPROMETIDO' in prosrc) > 0 as g_ajuste_abaixo,
--          position('CC_FLIP_COM_COMPROMETIDO'      in prosrc) > 0 as g_flip,
--          position('INVERSAO_DIRECAO'              in prosrc) > 0 as g_inversao,
--          position('DIFERENCA_ZERADA'              in prosrc) > 0 as g_zerada
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'cc_abrir_pendencia';
--   -- Esperado: as 7 guardas TRUE, e o digest igual a f84a6ab657a1bd5cb0a7c162f89cc736.
--   -- (O digest so muda se o corpo mudar; a formatacao da assinatura nao entra
--   --  no prosrc, entao a comparacao e valida. A unica excecao conhecida e o
--   --  terminador de linha — ver o cabecalho.)
--
--   -- c) assinatura, seguranca e search_path preservados
--   select pg_get_function_identity_arguments(p.oid) as args, p.prosecdef, p.proconfig
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'cc_abrir_pendencia';
--   -- Esperado: args inalterados, prosecdef = true, proconfig com search_path.
--
--   -- d) nenhum dado tocado: a distribuicao de pendencias segue igual
--   select direcao, motivo, status, count(*) as qtd, sum(valor_original) as total
--     from public.conta_corrente_pendencias
--    group by 1, 2, 3 order by 1, 2, 3;
--   -- Esperado (medido em 19/08/2026, antes de aplicar):
--   --   FAVOR_CLIENTE | OUTRO | ABERTA     | 1 |  14.40
--   --   FAVOR_CLIENTE | OUTRO | CANCELADA  | 2 |  65.66
--   --   FAVOR_CLIENTE | OUTRO | RESOLVIDA  | 1 |  21.00
--   --   FAVOR_EMPRESA | OUTRO | CANCELADA  | 2 | 107.07
--   --   FAVOR_EMPRESA | OUTRO | RESOLVIDA  | 5 |  82.69
--
--   -- e) o unico chamador vivo continua funcionando (teste manual)
--   --    Editar uma proposta PAGA removendo um item -> deve abrir pendencia
--   --    FAVOR_CLIENTE normalmente, via /api/orcamentos/editar-paga.
--
-- ROLLBACK
--   Nao existe "desfazer" de migration neste projeto: `git revert` do arquivo NAO
--   toca o banco. O unico rollback real e uma migration NOVA que redefina a
--   funcao com o corpo desejado.
--
--   Dito isso, e preciso separar dois ambientes, porque a leitura muda:
--
--   1. CONTRA PRODUCAO — aplicar e no-op, e reverter tambem seria. O corpo aqui
--      e byte a byte o que ja roda; aplicar duas vezes, ou nunca, da no mesmo.
--      Neste ambiente a migration e idempotente.
--
--   2. CONTRA AMBIENTE RECONSTRUIDO DO REPO (`supabase db reset`, staging novo)
--      — NAO e no-op, e e aqui que ela ganha sentido. Ali o arquivo de 21/07 cria
--      a funcao COM o bloco de 22/07; esta migration o REMOVE. Isso e mudanca de
--      comportamento real nesse ambiente: a RPC passa a aceitar diferenca
--      devedora, como producao sempre aceitou. E o objetivo declarado.
--
--   Ou seja: "idempotente por desenho" so vale para a producao. Reverter esta
--   migration num ambiente reconstruido devolveria o bloco de 22/07 — e qualquer
--   etapa futura que dependa de a RPC aceitar debito de FRETE passaria a falhar
--   nesse ambiente, sem falhar em producao. Divergencia silenciosa de novo, com
--   o sinal trocado.
--
--   Se um dia a decisao for o contrario — a regra de 22/07 DEVE existir no banco —
--   o caminho nao e reverter isto, e escrever a migration que adiciona o bloco
--   explicitamente, em producao e no repo ao mesmo tempo.
