-- `pagamentos_v2` passa a registrar a condicao de pagamento escolhida, por id
--
-- POR QUE
--   A condicao de pagamento e escolhida no modal de criacao de cobranca do
--   orcamento, que tem o `selectedModel.id` em maos
--   (PropostaCobrancaPanel.tsx:1253) e NAO o grava. A linha que gravaria esta
--   comentada desde sempre em CobrancasProvider.tsx:1858:
--
--     // id_modelo_cobranca: novoModelo.id, // TODO: Descomentar apos migration
--
--   Esta e a migration que o TODO espera.
--
--   O que sobra hoje e `pagamentos_v2.forma_fatu`, texto. Medido em 28/08/2026:
--   das 437 linhas preenchidas, apenas 128 casam com `modelos_cobranca.resultado`.
--   As outras 309 guardam FORMA de pagamento, nao condicao — 168 "BOLETO",
--   130 "Á vista", 10 "DEPOSITO", 1 "Pix à vista 3 dias". O campo e ambiguo por
--   construcao, e nada a jusante (aba Pagamentos da NF, conferencia, relatorio)
--   consegue afirmar qual condicao foi pedida.
--
-- O QUE ESTA MIGRATION FAZ
--   Acrescenta UMA coluna anulavel. Nada mais.
--
-- POR QUE ANULAVEL, E NAO NOT NULL
--   Porque condicao de pagamento so existe para cobranca FATURADA. PIX, cartao,
--   credito e boleto a vista nao tem condicao — e das 7.681 linhas de
--   `pagamentos_v2`, apenas 290 sao faturadas. A obrigatoriedade e do
--   formulario, que ja recusa faturado sem condicao
--   (PropostaCobrancaPanel.tsx:1222), e nao do banco.
--
--   Toda linha existente fica NULA. Sem backfill: um backfill por texto
--   alcancaria 128 linhas e erraria o resto em silencio.
--
-- SOBRE A FOREIGN KEY
--   A FK entra com ON DELETE RESTRICT, e a escolha e deliberada.
--
--   `modelos_cobranca` tem 12 linhas e so `modelos_cobranca_pkey` como
--   constraint — nenhuma FK aponta para ela hoje. Com RESTRICT, apagar um modelo
--   ja usado por alguma cobranca passa a falhar. E o comportamento correto: a
--   condicao registrada na cobranca e historico financeiro, e apagar o modelo
--   nao pode reescrever o que foi combinado com o cliente.
--
--   O risco e operacional, nao tecnico: quem hoje apaga um modelo direto na
--   tabela vai passar a receber erro depois que houver cobranca referenciando.
--   A saida e desativar o modelo, nao apagar. Se o time preferir manter a
--   liberdade de apagar, trocar por ON DELETE SET NULL — mas ai a cobranca perde
--   a condicao, que e justamente o que esta migration existe para impedir.
--
-- IMPACTO OPERACIONAL DO ALTER
--   `ADD COLUMN ... uuid NULL` sem DEFAULT e alteracao apenas de catalogo no
--   PostgreSQL 11+: nao reescreve a tabela e nao varre as 7.681 linhas. O lock
--   e ACCESS EXCLUSIVE, mas de duracao desprezivel.
--
--   A FK exige uma validacao contra `modelos_cobranca`, que tem 12 linhas e onde
--   TODA linha existente de pagamentos_v2 tera a coluna nula — logo, nada a
--   validar. Ainda assim entra como NOT VALID + VALIDATE em passo separado, para
--   que a validacao nao segure o ACCESS EXCLUSIVE do ADD COLUMN.
--
-- TRIGGERS
--   `pagamentos_v2` tem 9 triggers, nenhuma delas de statement: sao todas FOR
--   EACH ROW. `ALTER TABLE` nao dispara trigger de linha, entao nenhuma roda
--   aqui. A tabela NAO tem coluna `updated_at`, entao nao ha carimbo de data a
--   ser reescrito.
--
--   ATENCAO — NAO HA AUDITORIA DE LINHA EM `pagamentos_v2`. Duas das 9 triggers
--   estao DESABILITADAS (`tgenabled = 'D'`), e ja estavam antes desta migration:
--
--     trg_audit_pagamentos_v2            -> log_row_changes_v2
--     tg_atualiza_status_proposta_pagamento -> atualizar_status_proposta_por_pagamento
--
--   Logo, `id_modelo_cobranca` NAO sera auditada: nenhuma alteracao de linha
--   desta tabela e registrada hoje. Quem quiser rastrear quem mudou a condicao
--   de uma cobranca depende do que o codigo grava em `propostas_chat`
--   (`alterarCondicaoCobrancaReal` registra a troca la), e nao de auditoria de
--   banco. Esta migration nao reativa trigger nenhuma -- so registra o fato.
--
-- RLS E GRANTS
--   Nenhuma alteracao necessaria, verificado em 28/08/2026:
--     - a policy de `pagamentos_v2` e `GERAL`, ALL, roles {public}, USING true —
--       nao enumera colunas;
--     - `information_schema.column_privileges` nao tem NENHUMA linha para
--       `pagamentos_v2`: os grants sao de TABELA, nao de coluna. Coluna nova
--       entra coberta automaticamente.
--   Esta migration nao emite GRANT nem toca em policy.
--
-- NAO FAZ
--   Nao altera `forma_fatu` nem nenhum campo existente. Nao faz backfill. Nao
--   torna a coluna obrigatoria. Nao cria indice — com 290 linhas faturadas, nao
--   ha consulta que o justifique hoje. Nao toca em codigo do aplicativo: sem a
--   etapa seguinte, a coluna simplesmente nasce e fica nula.
--
-- ROLLBACK: ver rodape.

begin;

-- 1. A coluna. Anulavel, sem default: metadata-only.
alter table public.pagamentos_v2
  add column if not exists id_modelo_cobranca uuid;

comment on column public.pagamentos_v2.id_modelo_cobranca is
  'Condicao de pagamento escolhida na criacao da cobranca (modelos_cobranca.id). Preenchida SOMENTE em cobranca faturada -- PIX, cartao, credito e boleto a vista nao tem condicao. Nula em toda linha anterior a 28/08/2026: nao houve backfill, porque forma_fatu nao distingue condicao de forma de pagamento.';

-- 2. A FK, em duas etapas, para nao segurar o lock durante a validacao.
alter table public.pagamentos_v2
  add constraint pagamentos_v2_id_modelo_cobranca_fkey
  foreign key (id_modelo_cobranca)
  references public.modelos_cobranca (id)
  on delete restrict
  not valid;

alter table public.pagamentos_v2
  validate constraint pagamentos_v2_id_modelo_cobranca_fkey;

commit;

-- ============================================================================
-- VERIFICACOES (rodar depois de aplicar; nenhuma escreve)
--
--   -- a coluna existe, e uuid e anulavel
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--    where table_schema='public' and table_name='pagamentos_v2'
--      and column_name='id_modelo_cobranca';
--   -- esperado: uuid | YES | (null)
--
--   -- a FK existe e esta VALIDADA
--   select conname, convalidated, confdeltype
--     from pg_constraint
--    where conname = 'pagamentos_v2_id_modelo_cobranca_fkey';
--   -- esperado: convalidated = true, confdeltype = 'r' (RESTRICT)
--
--   -- nenhuma linha foi tocada: todas nulas
--   select count(*) as total,
--          count(id_modelo_cobranca) as preenchidas
--     from public.pagamentos_v2;
--   -- esperado: preenchidas = 0
--
--   -- forma_fatu intacto
--   select count(*) filter (where forma_fatu is not null and forma_fatu <> '')
--     from public.pagamentos_v2;
--   -- esperado: 437, o mesmo de antes
--
--   -- RLS inalterada
--   select policyname, cmd, roles::text, qual
--     from pg_policies
--    where schemaname='public' and tablename='pagamentos_v2';
--   -- esperado: GERAL | ALL | {public} | true
-- ============================================================================

-- ============================================================================
-- ROLLBACK (executar em transacao)
--
-- Seguro enquanto o codigo do aplicativo ainda nao grava a coluna. Depois que
-- gravar, o rollback DESCARTA a condicao registrada nas cobrancas criadas no
-- intervalo -- e essa informacao nao tem de onde ser recuperada, porque
-- forma_fatu nao a distingue. Reverter o codigo ANTES.
--
-- begin;
--
-- alter table public.pagamentos_v2
--   drop constraint if exists pagamentos_v2_id_modelo_cobranca_fkey;
--
-- alter table public.pagamentos_v2
--   drop column if exists id_modelo_cobranca;
--
-- commit;
-- ============================================================================
