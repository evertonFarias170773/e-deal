-- LIMPEZA DE DADOS DE TESTE NA CONTA CORRENTE — executada em 06/08/2026
--
-- ESTE ARQUIVO NAO E UMA MIGRATION. Nao rode no deploy. E o REGISTRO da
-- operacao e o script de ROLLBACK.
--
-- POR QUE EXISTE: public.movimento_credito e public.conta_corrente_pendencias
-- NAO tem trigger de auditoria (diferente de pagamentos_v2, que tem
-- trg_audit_pagamentos_v2). Uma alteracao nessas tabelas nao deixa rastro em
-- lugar nenhum. Sem este arquivo, a operacao seria irreversivel e invisivel.
--
-- METODO: nada foi apagado. Movimentos foram marcados `cancelado = true` —
-- o mecanismo do proprio sistema, ja respeitado por TODOS os caminhos de
-- leitura (getSaldoGlobalContaCorrente, listAjustesManuais,
-- listUsosDeCredito filtram `cancelado = false`). Efeito na tela identico ao
-- de um DELETE, com a linha preservada para conferencia.
--
-- ESCOPO APROVADO PELO USUARIO (06/08/2026): 37 movimentos.
--   Bloco 1 — clientes de teste (36 movimentos): id_cliente 6, 11 e 14
--     (Eduardo, Everton e Edison Santos De Farias). Evidencia: CPFs da mesma
--     familia e TODAS as propostas emitidas pelos usuarios de desenvolvimento
--     "Everton Dev" e "Edison Jr" — nenhum vendedor real.
--   Bloco 2 — teste em cliente real (1 movimento): id 46, Vladimir Silva
--     Pereira (#65687), debito de R$ 34,28, observacao literal "Teste de
--     debito em carteira". Era o valor inteiro do card "Debito a favor da
--     empresa".
--
-- DELIBERADAMENTE FORA:
--   - LISITON DOCUMENTOS SEGUROS (#8469). Tem teste misturado com real, mas
--     os creditos de teste ja foram consumidos por debitos em propostas
--     REAIS: cancelar so os creditos criaria divida fantasma de R$ 270 num
--     cliente real. E o saldo dela ja e R$ 0,00 — nao aparece em card nenhum.
--   - REFINATTA (#47271), UNIVERSO ALEGRIA (#52626), PIRAHY (#66011),
--     Amanda Borba (#9394), GDA PRODUTORA (#18874) — clientes reais.
--
-- ALEM DOS MOVIMENTOS:
--   a) 5 cobrancas E-CREDITO em pagamentos_v2 canceladas EM PAR com os usos.
--      movimento_credito.id_pagamento_destino NAO tem foreign key para
--      pagamentos_v2 — nada impediria de deixar a cobranca viva, PAID,
--      quitando a proposta com um credito que sumiu da razao.
--   b) Pendencia #10 (Eduardo, R$ 12,45, ABERTA) encerrada.
--      Encerrada por UPDATE direto, NAO por cc_encerrar_pendencia: a RPC
--      exige auth.uid() (indisponivel via MCP) e, pior, INSERE um movimento
--      de CANCELAMENTO — criaria dado de teste novo no exato momento em que
--      se remove dado de teste.

-- ─────────────────────────────────────────────────────────────────────────
-- O QUE FOI EXECUTADO
-- ─────────────────────────────────────────────────────────────────────────

-- 1. Os 37 movimentos.
--    IDs: 46, 67, 68, 69, 70, 71, 72, 81, 91, 97, 98, 99, 100, 101, 102,
--         103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115,
--         116, 117, 118, 119, 120, 121, 122, 123, 124
--    cancelado_por fica NULL: a operacao rodou como postgres via MCP, sem
--    auth.uid(). A autoria esta neste arquivo e no commit que o acompanha.
--
-- UPDATE public.movimento_credito
--    SET cancelado = true, cancelado_em = now()
--  WHERE cancelado = false AND (id_cliente IN (6, 11, 14) OR id = 46);

-- 2. As 5 cobrancas E-CREDITO pareadas.
--    Todas estavam status='PAID', confirmado=true, motivo_cancela=NULL.
--      0e8cb9eb-d97a-4a73-a811-ce7b3efc9fc8  R$    15,00  proposta #19511
--      33255f75-66d4-4803-b449-85433cb5525c  R$    20,00  proposta #19514
--      2c946061-d0a4-4871-abfc-69d8a0322695  R$    42,08  proposta #19514
--      5f17ee52-fabc-4868-800c-be40cfb9aa9b  R$    28,00  proposta #19503
--      2bed012e-7719-4c71-a228-006863b4717d  R$    31,00  proposta #19660
--    A ultima era financiada por DOIS movimentos (121, de R$ 21,00 vindo da
--    pendencia #9, e 122, de R$ 10,00 avulso) — ambos no lote dos 37.
--    `confirmado` fica como estava (true), igual as outras 14 cobrancas
--    E-CREDITO ja canceladas na base.

-- 3. Pendencia #10 — estava ABERTA, valor_saldo 12,45, valor_original 12,45,
--    valor_reservado 0, encerrado_em/por/motivo NULL.

-- ─────────────────────────────────────────────────────────────────────────
-- ROLLBACK COMPLETO — restaura o estado de antes, exatamente
-- ─────────────────────────────────────────────────────────────────────────
/*
BEGIN;

UPDATE public.movimento_credito
   SET cancelado = false, cancelado_em = NULL, cancelado_por = NULL
 WHERE id IN (46,67,68,69,70,71,72,81,91,97,98,99,100,101,102,103,104,105,
              106,107,108,109,110,111,112,113,114,115,116,117,118,119,120,
              121,122,123,124);

UPDATE public.pagamentos_v2
   SET status = 'PAID', motivo_cancela = NULL
 WHERE id IN ('0e8cb9eb-d97a-4a73-a811-ce7b3efc9fc8',
              '33255f75-66d4-4803-b449-85433cb5525c',
              '2c946061-d0a4-4871-abfc-69d8a0322695',
              '5f17ee52-fabc-4868-800c-be40cfb9aa9b',
              '2bed012e-7719-4c71-a228-006863b4717d');

UPDATE public.conta_corrente_pendencias
   SET status = 'ABERTA', valor_saldo = 12.45, encerrado_em = NULL,
       encerrado_por = NULL, motivo_encerramento = NULL
 WHERE id = 10;

COMMIT;
*/
