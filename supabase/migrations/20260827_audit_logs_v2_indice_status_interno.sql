-- Indice de expressao no log de auditoria: o predicado do dashboard executivo
--
-- ATENCAO OPERACIONAL — LEIA ANTES DE RODAR
--   Esta migration NAO pode ser executada dentro de um bloco de transacao.
--   `CREATE INDEX CONCURRENTLY` e proibido em transacao, e e justamente ele que
--   evita travar a escrita do sistema inteiro. Rode statement a statement, na
--   ordem, conferindo cada um. Se a sua ferramenta envolve o arquivo em BEGIN /
--   COMMIT automaticamente, rode os comandos a mao.
--
-- O QUE E
--   Um indice de expressao em `audit.logs_v2` cobrindo, nesta ordem:
--
--     (table_name, action, ((changed_fields -> 'status_interno') ->> 'new'), occurred_at DESC)
--
--   Ele e criado no PAI (particionado) e anexado particao a particao, de forma
--   que cada particao ganhe o seu indice sem bloquear escrita.
--
-- POR QUE
--   `rpc_dashboard_executivo` estoura o statement_timeout de 8s do papel
--   `authenticated` na PRIMEIRA carga do /dashboard. Recarregando, funciona: o
--   custo nao e de CPU, e de I/O de disco com cache frio.
--
--   Dois blocos da funcao filtram o log de auditoria pelo MESMO predicado, e
--   sao eles que enchem o cache. Medido em 27/08/2026, com cache ja quente:
--
--     bloco                    | tempo   | paginas lidas
--     -------------------------|---------|--------------
--     v_tempo                  |  51,6ms |     27.966
--     v_ultimas_aprovacoes     |  66,1ms |     16.304
--     -------------------------|---------|--------------
--     soma                     | 117,7ms |     44.270   (~346 MB)
--
--   117 ms nao estouram 8 s. 44.270 paginas lidas do disco, sim: no
--   armazenamento de rede do Supabase, a 0,1-0,5 ms por pagina, sao segundos.
--
--   O PREDICADO NAO TEM INDICE EM NENHUMA PARTICAO. Hoje o plano faz:
--     - Seq Scan em `logs_v2_2026_06` e `logs_v2_2026_07` (2.399 e 2.376 pag.);
--     - Index Scan em `logs_v2_2026_08` pelo indice de
--       (schema_name, table_name, occurred_at), que le 8.505 paginas e descarta
--       14.195 linhas no filtro — o indice nao cobre nem `action` nem o JSONB;
--     - no bloco `v_tempo`, um Nested Loop com `propostas` que roda 5.663 vezes
--       e sozinho consome 16.971 das 27.966 paginas.
--
--   Os GIN de `changed_fields` que existem em 2026_03/04/05 nao ajudam: o
--   operador aqui e `->>` com igualdade, e GIN so serve a `@>` e amigos. E de
--   2026_06 em diante esses GIN nem existem.
--
-- POR QUE ESTE FORMATO DE INDICE, E NAO OUTRO
--   A ordem das colunas segue o predicado real, medido no fonte da funcao:
--
--     table_name = 'propostas'                                    igualdade
--     action     = 'UPDATE'                                       igualdade
--     (changed_fields->'status_interno'->>'new') in (...)         IN
--     occurred_at >= / <  ...                                     faixa
--
--   Igualdades primeiro, IN depois, faixa por ultimo — a unica ordem que deixa
--   o btree resolver os quatro de uma vez.
--
--   `schema_name` FICA DE FORA de proposito: nenhum dos dois blocos filtra por
--   ele. E por isso que os indices existentes, que lideram com `schema_name`,
--   acabam varridos por inteiro em vez de posicionados.
--
--   NAO E PARCIAL, tambem de proposito. Um indice parcial com
--   `where ... in ('APROVADO','LIBERADO')` teria so 15.165 entradas e menos de
--   1 MB, contra os ~8-12 MB deste. Mas ele para de ser usado, em silencio, no
--   dia em que alguem acrescentar um status a lista da funcao (por exemplo
--   'APROVADO / EM ARTE', que ja existe no dominio). O ganho de 10 MB nao paga
--   uma regressao silenciosa num dashboard que ja falhou por silencio.
--   Se voce preferir o parcial, a troca e trocar a lista de colunas por
--   `(occurred_at DESC)` mais a clausula `where`, mantendo o resto do roteiro.
--
-- ESCOPO / O QUE ESTA MIGRATION NAO FAZ
--   Nao altera `rpc_dashboard_executivo`. Nao reescreve os filtros de data que
--   usam `at time zone` sobre a coluna (esses continuam anulando o indice de
--   `propostas.created_at` e de `pagamentos_v2.data_confirmacao` — outra etapa).
--   Nao materializa `view_pagamentos_pagos_v2`. Nao quebra a RPC. Nao mexe em
--   statement_timeout. NAO REMOVE NENHUM INDICE.
--
--   Levantado no banco em 27/08/2026, ANTES de escrever:
--
--   1. PostgreSQL 17.4. `CREATE INDEX CONCURRENTLY` continua PROIBIDO em tabela
--      particionada: no pai, o comando falha. `CREATE INDEX` simples no pai
--      recursa nas particoes e pega ShareLock em cada uma — ShareLock conflita
--      com o RowExclusiveLock de INSERT, e `audit.logs_v2` recebe uma linha a
--      cada alteracao auditada do sistema. Como o trigger de auditoria roda
--      DENTRO da transacao de quem escreveu, travar o log trava salvar
--      proposta, confirmar pagamento, gerar boleto. Por isso o roteiro abaixo
--      nao usa o caminho simples.
--
--   2. As particoes e o que sera indexado:
--
--        particao            | tamanho | linhas  | indices hoje
--        --------------------|---------|---------|-------------
--        logs_v2_2026_03     | 4,2 MB  |   1.216 | 9
--        logs_v2_2026_04     | 352 MB  | 133.230 | 9
--        logs_v2_2026_05     |  27 MB  |   9.127 | 9
--        logs_v2_2026_06     |  35 MB  |  12.506 | 4
--        logs_v2_2026_07     |  35 MB  |  11.074 | 4
--        logs_v2_2026_08     | 376 MB  | 148.475 | 4
--        logs_v2_2026_09..12 |  40 kB  |   vazia | 4
--
--      10 particoes, 329.150 linhas, ~830 MB. As duas grandes (04 e 08) sao
--      85% do trabalho.
--
--   3. Tamanho estimado do indice: ~8 a 12 MB somando todas as particoes.
--      Calibrado no indice existente de mesma natureza:
--      `(schema_name, table_name, occurred_at DESC)` ocupa 1.848 kB para
--      133.230 linhas e 1.904 kB para 148.475 — cerca de 14 bytes por linha.
--      Este tem uma coluna de texto a mais, quase sempre nula (so 25.736 das
--      329.150 linhas tem `status_interno` em `changed_fields`), entao a conta
--      fica em ~20-24 bytes por linha. Menos de 1,5% dos 830 MB da tabela.
--
--   4. NENHUM INDICE EXISTENTE FICA REDUNDANTE. Os que existem lideram com
--      outras colunas — `(schema_name, ...)`, `(action, ...)`, `(actor_uid,
--      ...)`, `(occurred_at)` — e continuam servindo aos seus proprios acessos.
--      Este acrescenta um caminho que nao existia: por `table_name` sem
--      `schema_name`.
--
--      FICA REGISTRADO, SEM ACAO NESTA MIGRATION: as particoes 2026_03, _04 e
--      _05 tem DOIS PARES DE INDICES DUPLICADOS, com definicao identica —
--      `idx_logs_v2_2026_0X_table` = `logs_v2_2026_0X_schema_name_table_name_occurred_at_idx`
--      e `idx_logs_v2_2026_0X_action` = `logs_v2_2026_0X_action_occurred_at_idx`.
--      Sao ~3,4 MB por particao e o dobro de escrita, sem leitura a mais.
--      Derrubar um de cada par e ganho puro, mas e decisao a parte.
--
--   5. O predicado dos DOIS blocos e o mesmo, palavra por palavra, sobre o log:
--
--        table_name = 'propostas'
--        action     = 'UPDATE'
--        changed_fields->'status_interno'->>'new' in ('APROVADO','LIBERADO')
--
--      Só a janela de `occurred_at` difere: `v_ultimas_aprovacoes` usa
--      `>= now() - interval '120 days'`, e `v_tempo` usa a faixa do periodo
--      pedido. Como `occurred_at` e a ULTIMA coluna do indice, os dois casos
--      viram faixa sobre o mesmo prefixo. Um indice serve aos dois.
--
--      Seletividade medida: das 329.150 linhas, 51.372 sao
--      (propostas + UPDATE) e apenas 15.165 casam o predicado inteiro — 4,6%.

-- ─────────────────────────────────────────────────────────────────────────────
-- PASSO 1 — indice INVALIDO no pai, sem recursar nas particoes.
--
-- `ON ONLY` nao toca nas particoes: cria so a entrada de catalogo no pai, que
-- nao tem dados. O ShareLock e no pai e dura milissegundos. O indice nasce
-- INVALIDO de proposito e so vira valido quando a ultima particao for anexada.
-- ─────────────────────────────────────────────────────────────────────────────

create index if not exists idx_logs_v2_tabela_acao_status_novo
  on only audit.logs_v2
  (table_name, action, ((changed_fields -> 'status_interno') ->> 'new'), occurred_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- PASSO 2 — um indice por particao, CONCURRENTLY, SEM bloquear escrita.
--
-- Rode um de cada vez e confira o resultado antes do proximo. CONCURRENTLY faz
-- duas passadas pela tabela, entao demora mais que o build normal — e o preco
-- de nao travar ninguem.
--
-- Se algum destes falhar no meio, ele deixa um indice INVALIDO para tras. Isso
-- NAO quebra nada (o planner ignora indice invalido), mas precisa ser limpo com
-- `drop index concurrently` antes de tentar de novo. A verificacao (b) abaixo
-- encontra qualquer um nessa situacao.
-- ─────────────────────────────────────────────────────────────────────────────

create index concurrently if not exists idx_logs_v2_2026_03_tabela_acao_status_novo
  on audit.logs_v2_2026_03 (table_name, action, ((changed_fields -> 'status_interno') ->> 'new'), occurred_at desc);

create index concurrently if not exists idx_logs_v2_2026_04_tabela_acao_status_novo
  on audit.logs_v2_2026_04 (table_name, action, ((changed_fields -> 'status_interno') ->> 'new'), occurred_at desc);

create index concurrently if not exists idx_logs_v2_2026_05_tabela_acao_status_novo
  on audit.logs_v2_2026_05 (table_name, action, ((changed_fields -> 'status_interno') ->> 'new'), occurred_at desc);

create index concurrently if not exists idx_logs_v2_2026_06_tabela_acao_status_novo
  on audit.logs_v2_2026_06 (table_name, action, ((changed_fields -> 'status_interno') ->> 'new'), occurred_at desc);

create index concurrently if not exists idx_logs_v2_2026_07_tabela_acao_status_novo
  on audit.logs_v2_2026_07 (table_name, action, ((changed_fields -> 'status_interno') ->> 'new'), occurred_at desc);

create index concurrently if not exists idx_logs_v2_2026_08_tabela_acao_status_novo
  on audit.logs_v2_2026_08 (table_name, action, ((changed_fields -> 'status_interno') ->> 'new'), occurred_at desc);

create index concurrently if not exists idx_logs_v2_2026_09_tabela_acao_status_novo
  on audit.logs_v2_2026_09 (table_name, action, ((changed_fields -> 'status_interno') ->> 'new'), occurred_at desc);

create index concurrently if not exists idx_logs_v2_2026_10_tabela_acao_status_novo
  on audit.logs_v2_2026_10 (table_name, action, ((changed_fields -> 'status_interno') ->> 'new'), occurred_at desc);

create index concurrently if not exists idx_logs_v2_2026_11_tabela_acao_status_novo
  on audit.logs_v2_2026_11 (table_name, action, ((changed_fields -> 'status_interno') ->> 'new'), occurred_at desc);

create index concurrently if not exists idx_logs_v2_2026_12_tabela_acao_status_novo
  on audit.logs_v2_2026_12 (table_name, action, ((changed_fields -> 'status_interno') ->> 'new'), occurred_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- PASSO 3 — anexar cada indice de particao ao indice do pai.
--
-- Cada ATTACH e uma operacao de catalogo, instantanea. Quando a ULTIMA particao
-- for anexada, o indice do pai deixa de ser invalido sozinho — nao ha comando
-- para valida-lo a mao. Se a definicao de algum filho divergir da do pai (uma
-- virgula, uma opclass), o ATTACH recusa; foi por isso que a definicao acima
-- foi repetida identica em todos.
-- ─────────────────────────────────────────────────────────────────────────────

alter index audit.idx_logs_v2_tabela_acao_status_novo attach partition audit.idx_logs_v2_2026_03_tabela_acao_status_novo;
alter index audit.idx_logs_v2_tabela_acao_status_novo attach partition audit.idx_logs_v2_2026_04_tabela_acao_status_novo;
alter index audit.idx_logs_v2_tabela_acao_status_novo attach partition audit.idx_logs_v2_2026_05_tabela_acao_status_novo;
alter index audit.idx_logs_v2_tabela_acao_status_novo attach partition audit.idx_logs_v2_2026_06_tabela_acao_status_novo;
alter index audit.idx_logs_v2_tabela_acao_status_novo attach partition audit.idx_logs_v2_2026_07_tabela_acao_status_novo;
alter index audit.idx_logs_v2_tabela_acao_status_novo attach partition audit.idx_logs_v2_2026_08_tabela_acao_status_novo;
alter index audit.idx_logs_v2_tabela_acao_status_novo attach partition audit.idx_logs_v2_2026_09_tabela_acao_status_novo;
alter index audit.idx_logs_v2_tabela_acao_status_novo attach partition audit.idx_logs_v2_2026_10_tabela_acao_status_novo;
alter index audit.idx_logs_v2_tabela_acao_status_novo attach partition audit.idx_logs_v2_2026_11_tabela_acao_status_novo;
alter index audit.idx_logs_v2_tabela_acao_status_novo attach partition audit.idx_logs_v2_2026_12_tabela_acao_status_novo;

-- ─────────────────────────────────────────────────────────────────────────────
-- PASSO 4 — estatisticas da coluna de expressao.
--
-- ANALYZE e o que ensina o planner a estimar a seletividade da expressao. Sem
-- ele, o indice existe mas o planner pode continuar preferindo o Seq Scan,
-- porque nao sabe que o predicado corta 95,4% das linhas.
-- ─────────────────────────────────────────────────────────────────────────────

analyze audit.logs_v2;

-- VERIFICACAO (somente leitura, depois de aplicar)
--
--   -- a) o indice do pai existe e esta VALIDO
--   select i.relname, x.indisvalid, x.indisready
--     from pg_index x
--     join pg_class i on i.oid = x.indexrelid
--     join pg_class c on c.oid = x.indrelid
--     join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'audit' and i.relname = 'idx_logs_v2_tabela_acao_status_novo';
--   -- esperado: 1 linha com indisvalid = true. FALSE aqui significa que alguma
--   -- particao nao foi anexada — confira o passo 3 antes de seguir.
--
--   -- b) NENHUM indice invalido ficou para tras (CONCURRENTLY que falhou)
--   select c.relname as particao, i.relname as indice
--     from pg_index x
--     join pg_class i on i.oid = x.indexrelid
--     join pg_class c on c.oid = x.indrelid
--     join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'audit' and not x.indisvalid;
--   -- esperado: 0 linhas. Qualquer linha aqui e um build interrompido; limpe
--   -- com `drop index concurrently audit.<nome>` antes de repetir o passo.
--
--   -- c) as 10 particoes ganharam o indice
--   select count(*) as particoes_com_indice
--     from pg_index x
--     join pg_class i on i.oid = x.indexrelid
--     join pg_class c on c.oid = x.indrelid
--     join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'audit' and i.relname like 'idx_logs_v2_2026%_tabela_acao_status_novo';
--   -- esperado: 10
--
--   -- d) tamanho real, para conferir contra a estimativa de 8-12 MB
--   select pg_size_pretty(sum(pg_relation_size(i.oid))) as tamanho_total
--     from pg_index x
--     join pg_class i on i.oid = x.indexrelid
--     join pg_class c on c.oid = x.indrelid
--     join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'audit' and i.relname like 'idx_logs_v2%tabela_acao_status_novo';
--
--   -- e) NENHUM indice antigo foi removido — criterio ABSOLUTO
--   select count(*) as indices_em_audit
--     from pg_index x
--     join pg_class c on c.oid = x.indrelid
--     join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'audit';
--   -- esperado: 69 antes (medido em 27/08/2026) e 80 depois — os 69 antigos
--   -- INTACTOS mais os 10 das particoes mais o do pai. Numero menor que 69
--   -- significa que algo removeu indice; parar e investigar.
--
--   -- f) O PLANO MUDOU? E a verificacao que importa.
--   --    Rodar os dois blocos e comparar com o ANTES registrado abaixo.
--   explain (analyze, buffers)
--   select (v.record_pk->>'id')::uuid as pid, max(v.occurred_at) as aprovado_em
--     from public.vw_audit_logs_v2 v
--    where v.table_name = 'propostas'
--      and v.action = 'UPDATE'
--      and v.changed_fields->'status_interno'->>'new' in ('APROVADO','LIBERADO')
--      and v.occurred_at >= now() - interval '120 days'
--    group by 1;
--   -- ANTES (27/08/2026): 66,1 ms, 16.304 paginas, Seq Scan em 2026_06 e _07.
--   -- ESPERADO: Index Scan em TODAS as particoes e queda de uma ordem de
--   -- grandeza nas paginas. Se continuar em Seq Scan, o ANALYZE do passo 4 nao
--   -- rodou ou o planner nao aceitou a expressao — nao adianta repetir, releia.
--
--   explain (analyze, buffers)
--   select count(*) from (
--     select p.id, max(v.occurred_at) as aprovado_em, p.created_at
--       from public.vw_audit_logs_v2 v
--       join propostas p on p.id = (v.record_pk->>'id')::uuid
--      where v.table_name = 'propostas'
--        and v.action = 'UPDATE'
--        and v.changed_fields->'status_interno'->>'new' in ('APROVADO','LIBERADO')
--        and v.occurred_at >= (('2026-07-01'::date - 1)::timestamp at time zone 'America/Sao_Paulo')
--        and v.occurred_at <  (('2026-08-31'::date + 2)::timestamp at time zone 'America/Sao_Paulo')
--      group by p.id, p.created_at) aprov;
--   -- ANTES (27/08/2026): 51,6 ms, 27.966 paginas, das quais 16.971 no Nested
--   -- Loop com propostas. ESPERADO: queda nas 10.992 paginas do lado do log. As
--   -- ~17.000 do Nested Loop NAO caem com este indice — sao 5.663 buscas na
--   -- pkey de `propostas`, e resolve-las e outra etapa.
--
--   -- g) o teste que fecha: /dashboard abre na PRIMEIRA tentativa, sem
--   --    "canceling statement due to statement timeout". Feito na tela, com o
--   --    filtro padrao (mes atual, empresa Todas), em aba anonima para nao
--   --    aproveitar cache do navegador.
--
-- ROLLBACK
--   Seguro a qualquer momento: indice nao guarda dado, e derrubar volta o
--   planner ao que ele fazia hoje — o dashboard volta a estourar na primeira
--   carga, e nada alem disso.
--
--   Derrubar o indice do PAI leva junto os das particoes, em uma operacao de
--   catalogo. O `concurrently` NAO se aplica a indice particionado:
--
--     drop index if exists audit.idx_logs_v2_tabela_acao_status_novo;
--
--   Se quiser derrubar sem o bloqueio do DROP no pai, faca o caminho inverso —
--   um a um, cada um sem travar escrita:
--
--     drop index concurrently if exists audit.idx_logs_v2_2026_03_tabela_acao_status_novo;
--     ... (as 10 particoes) ...
--     drop index if exists audit.idx_logs_v2_tabela_acao_status_novo;
--
--   Nenhum indice preexistente e tocado no rollback: esta migration nunca
--   removeu nenhum.
