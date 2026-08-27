-- Data e hora da liberacao para producao: propostas.liberado_producao_em
--
-- O QUE E
--   Uma coluna aditiva em public.propostas:
--
--     liberado_producao_em  timestamptz  nulavel, SEM default
--
--   Responde "desde quando este pedido esta na producao?". Nula = nunca foi
--   liberado. Preenchida = instante em que o atendente clicou em liberar.
--
-- POR QUE
--   A lista de Ordens de Servico (src/features/pedidos/PedidosListPage.tsx,
--   alimentada por listarPedidosOperacionais) mostra hoje a data de ENTREGA e a
--   data de CRIACAO da proposta, e nenhuma das duas responde ha quanto tempo o
--   pedido esta na fila da fabrica. A liberacao acontece num unico ponto de
--   escrita — orcamentos.service.ts, liberarPropostaParaProducao — que grava
--   `is_prd_aprovado: true, status_interno: 'REVISAO PRODUCAO', libera_nf: true`
--   e NAO carimba nada.
--
--   Levantado no banco em 27/08/2026, antes de escrever: `public.propostas` tem
--   58 colunas e as unicas de data/hora sao created_at, updated_at,
--   prazo_operacional (date) e encerrado_teste_em. Nenhuma delas e a liberacao.
--   `updated_at` em particular NAO serve: dois triggers o reescrevem a cada
--   toque em qualquer campo da linha.
--
-- SEMANTICA, DECIDIDA PELO DONO EM 27/08/2026
--   1. Retirar da producao PRESERVA o carimbo. `retirarPropostaDaProducao` e
--      `devolverPropostaParaRevisaoAtendente` desligam `is_prd_aprovado` e NAO
--      apagam esta coluna. A evidencia de que o pedido chegou a ser liberado
--      sobrevive, que e justamente o que `is_prd_aprovado = false` destroi.
--   2. Re-liberacao SOBRESCREVE com a data nova. A coluna responde ha quanto
--      tempo a proposta esta na producao AGORA, nao quando entrou pela primeira
--      vez. O historico completo das idas e vindas continua em audit.logs_v2.
--
--   Consequencia aceita e explicita: com `is_prd_aprovado = false` e a coluna
--   preenchida, o valor e um carimbo HISTORICO ("esteve na producao ate ser
--   retirada"), nao um estado atual. Quem le a coluna precisa ler
--   `is_prd_aprovado` junto. A lista de OS ja parte de `is_prd_aprovado = true`,
--   entao la os dois sempre concordam.
--
-- POR QUE NAO UMA TABELA DE LOG
--   Foi avaliada e descartada nesta rodada. Guardaria toda liberacao e toda
--   retirada com ator, mas custaria tabela + RLS + politica + escrita em tres
--   pontos + UMA CONSULTA EM LOTE A MAIS na lista de OS. A coluna sai de graca:
--   `listarPedidosOperacionais` ja faz SELECT em `propostas`, entao o campo novo
--   entra na mesma linha, sem nenhuma consulta adicional. O historico de idas e
--   vindas, quando alguem precisar, esta em audit.logs_v2.
--
-- POR QUE NAO DERIVAR DE status_interno
--   `status_interno` e reescrito por varios caminhos (inclusive por trigger
--   financeiro) e a transicao para 'REVISAO PRODUCAO' nao e exclusiva da
--   liberacao. Derivar seria adivinhar.
--
-- ESCOPO / O QUE ESTA MIGRATION NAO FAZ
--   Nao cria tabela, funcao, view, RPC, trigger, indice, RLS nem politica.
--   Nao concede nem revoga permissao. Nao altera nenhuma coluna, CHECK ou FK
--   existente. Nao toca em is_prd_aprovado, status_interno, libera_nf,
--   pagamentos_v2, boletos nem notas_fiscais. Nao altera codigo do aplicativo —
--   a gravacao em `liberarPropostaParaProducao` vem em rodada separada, e ate
--   la a coluna so tem o valor do backfill.
--
-- ============================================================================
-- RLS: NAO E OBSTACULO, E NAO E TOCADA
-- ============================================================================
--   `public.propostas` tem relrowsecurity = true e 16 politicas, mas
--   relforcerowsecurity = false e o dono da tabela e `postgres`. Migration roda
--   como `postgres`, que e o dono E tem rolbypassrls = true: RLS simplesmente
--   nao se aplica ao backfill. Nenhuma politica e criada, alterada, afrouxada
--   ou desativada aqui.
--
-- ============================================================================
-- updated_at: O PROBLEMA E O CAMINHO ESCOLHIDO
-- ============================================================================
--   REQUISITO: o backfill NAO pode mover `updated_at` de nenhuma linha. A busca
--   ampla de Orcamentos ordena por `updated_at desc`; carimbar 41 linhas jogaria
--   pedidos antigos para o topo da lista de todo mundo, sem que ninguem os
--   tenha tocado.
--
--   OS DOIS CULPADOS, verificados no banco em 27/08/2026:
--
--     propostas_set_timestamp  BEFORE UPDATE -> set_timestamp_updated_at()
--       begin new.updated_at = now(); return new; end
--
--     trg_set_updated_at       BEFORE UPDATE -> set_updated_at()
--       BEGIN NEW.updated_at := now(); RETURN NEW; END
--
--   Os dois sao INCONDICIONAIS. Nao existe "passar updated_at explicito e o
--   trigger respeitar": o BEFORE sobrescreve o valor de qualquer jeito. E nao
--   existe corrigir depois, porque o UPDATE de correcao dispararia os mesmos
--   dois triggers.
--
--   CAMINHO DESCARTADO: session_replication_role = 'replica'
--     Seria o desarme mais limpo, sem DDL. Nao esta disponivel neste banco:
--     `postgres` tem rolsuper = false e pg_parameter_acl nao tem NENHUM grant
--     para o parametro session_replication_role (verificado, 0 linhas). Habilitar
--     exigiria GRANT SET ON PARAMETER, ou seja, mexer em permissao — fora do
--     escopo autorizado. Alem disso desarmaria TODOS os triggers, inclusive o de
--     auditoria, que eu quero manter armado (ver abaixo).
--
--   CAMINHO ESCOLHIDO: alter table ... disable trigger, so nos dois carimbadores
--     Motivos:
--       a) e cirurgico: desarma exatamente os dois que causam o problema e
--          deixa os outros quatro trabalhando;
--       b) e TRANSACIONAL. Se qualquer coisa falhar entre o disable e o enable,
--          o rollback rearma os dois sozinho. Nao existe estado em que a
--          migration termine mal e a tabela fique sem carimbo de updated_at;
--       c) e permitido: o dono da tabela e `postgres`, que e quem aplica;
--       d) o lock e SHARE ROW EXCLUSIVE, nao ACCESS EXCLUSIVE — leitura da
--          tabela continua livre. Escrita concorrente em `propostas` espera o
--          tempo de atualizar 41 linhas, ou seja, milissegundos.
--
--     Tudo isso vive dentro de UM UNICO bloco DO, de proposito: um bloco DO e um
--     unico statement, entao ele e atomico sem depender de `begin`/`commit`
--     escritos aqui — que colidiriam com a transacao que o aplicador de
--     migrations ja abre por fora.
--
--   OS QUATRO QUE FICAM ARMADOS, e por que sao seguros:
--
--     trg_audit_propostas             DE PROPOSITO. Quero o backfill na trilha
--                                     de auditoria. `updated_at` esta em
--                                     audit.config_v2.ignored_columns para
--                                     public.propostas, entao o diff registrado
--                                     sai limpo: so `liberado_producao_em`.
--     trg_sync_cliente_idcliente_...  AFTER UPDATE OF cliente, id_cliente. E
--                                     escopado por coluna e NEM DISPARA aqui.
--     tg_registrar_paid_at            so age quando status_interno PASSA A
--                                     'RECEBIDO'. Nao tocamos em status_interno,
--                                     entao OLD = NEW e o if e falso. Alem
--                                     disso, das linhas alvo, ZERO estao em
--                                     'RECEBIDO' hoje.
--     tg_propostas_valor_total_avulsa so age se `is_avulso` for verdadeiro E
--                                     `valor_total` for nulo ou zero. Das linhas
--                                     alvo, ZERO sao avulsas. O bloco abaixo NAO
--                                     confia nisso: mede e ABORTA se aparecer
--                                     alguma, em vez de deixar o trigger
--                                     reescrever valor_total por tabela.
--
-- ============================================================================
-- BACKFILL: FONTE E CRITERIO
-- ============================================================================
--   Fonte: audit.logs_v2. Verificado em 27/08/2026, antes de escrever:
--
--     - auditoria de public.propostas HABILITADA, ignored_columns = {updated_at};
--       `is_prd_aprovado` e auditado;
--     - primeiro log de propostas: 28/03/2026. A proposta liberada mais antiga e
--       de 26/06/2026 — a trilha e ANTERIOR a todas elas, nao ha buraco;
--     - 41 de 41 propostas com is_prd_aprovado = true tem evento de liberacao
--       (0 orfas);
--     - 41 de 41 com changed_fields->'is_prd_aprovado'->>'old' = 'false'
--       explicito. Nenhum null, nenhuma transicao ambigua;
--     - 0 eventos sem occurred_at, 0 no futuro, 0 anteriores ao created_at da
--       propria proposta;
--     - no universo completo ha 82 eventos de liberacao em 72 propostas
--       distintas: existem pedidos liberados, retirados e liberados de novo.
--
--   Criterio: `distinct on ... order by occurred_at desc` — o evento MAIS
--   RECENTE de false -> true em cada proposta. Coerente com a regra 2 da
--   semantica (re-liberacao sobrescreve).
--
--   Alvo: apenas `is_prd_aprovado is true`. Uma proposta ja retirada da producao
--   NAO recebe carimbo retroativo — a regra "retirar preserva" vale dali para
--   frente, e inventar passado para quem ja saiu seria adivinhar qual das idas e
--   vindas contava.
--
--   NAO COMPARO COM O NUMERO 41. Este e um banco de PRODUCAO vivo: entre
--   escrever e aplicar, um atendente pode liberar mais pedidos e o alvo vira 42,
--   43. A assertiva e de REGRA, nao de contagem: TODA proposta liberada precisa
--   ter evento na auditoria. Faltando uma, a migration aborta inteira e nada e
--   aplicado.
--
--   IDEMPOTENTE: o UPDATE tem `is distinct from`, entao reaplicar nao toca
--   nenhuma linha e o retrato de updated_at fecha igual.

alter table public.propostas
  add column if not exists liberado_producao_em timestamptz;

comment on column public.propostas.liberado_producao_em is
  'Instante em que a proposta foi liberada para producao pelo atendente, na acao "Liberar" da lista de Orcamentos (liberarPropostaParaProducao). Gravada no mesmo UPDATE de is_prd_aprovado = true. Retirar da producao NAO apaga este valor: o carimbo sobrevive como evidencia de que o pedido chegou a entrar na fabrica. Re-liberacao SOBRESCREVE com a data nova, entao a coluna responde ha quanto tempo a proposta esta na producao agora, e nao quando entrou pela primeira vez. Nula = nunca foi liberada. Com is_prd_aprovado = false e esta coluna preenchida, o valor e historico, nao estado atual — leia as duas juntas. Historico completo das idas e vindas em audit.logs_v2.';

-- ---------------------------------------------------------------------------
-- BACKFILL + PROVA DE QUE updated_at NAO MUDOU
--
-- Bloco unico e atomico. Qualquer RAISE aqui desfaz TUDO, inclusive o
-- `disable trigger`, porque DDL em PostgreSQL e transacional.
-- ---------------------------------------------------------------------------
do $backfill$
declare
  v_ids           uuid[];
  v_alvo          integer;
  v_com_evento    integer;
  v_risco_avulsa  integer;
  v_risco_paid    integer;
  v_hash_antes    text;
  v_hash_depois   text;
  v_gravadas      integer;
begin
  -- 1. Congela o alvo. A partir daqui o conjunto e fixo: uma liberacao feita
  --    por um atendente durante a migration nao entra e nao contamina o retrato.
  select array_agg(p.id order by p.id), count(*)
    into v_ids, v_alvo
    from public.propostas p
   where p.is_prd_aprovado is true;

  if v_alvo = 0 then
    raise exception 'ABORTADO: nenhuma proposta com is_prd_aprovado = true. Estado inesperado — investigar antes de aplicar.';
  end if;

  -- 2. Tranca as linhas alvo ate o fim da transacao. Sem isso, um vendedor
  --    salvando uma dessas propostas no mesmo instante moveria updated_at e o
  --    retrato acusaria a migration por algo que ela nao fez.
  --    `order by id` para nao criar ordem de lock divergente da do aplicativo.
  perform 1 from public.propostas
   where id = any(v_ids)
   order by id
     for update;

  -- 3. Guarda: TODA proposta liberada precisa ter evento na auditoria.
  --    Regra, nao contagem — ver a nota sobre o numero 41 no cabecalho.
  select count(*)
    into v_com_evento
    from public.propostas p
   where p.id = any(v_ids)
     and exists (
       select 1
         from audit.logs_v2 l
        where l.schema_name = 'public'
          and l.table_name  = 'propostas'
          and l.action      = 'UPDATE'
          and (l.record_pk->>'id')::uuid = p.id
          and l.changed_fields->'is_prd_aprovado'->>'new' = 'true'
          and l.occurred_at is not null
     );

  if v_com_evento <> v_alvo then
    raise exception
      'ABORTADO: % de % propostas liberadas nao tem evento de liberacao em audit.logs_v2. Nao ha de onde tirar a data delas — parar e decidir caso a caso.',
      v_alvo - v_com_evento, v_alvo;
  end if;

  -- 4. Guarda: nenhuma linha alvo pode acordar tg_propostas_valor_total_avulsa.
  --    Esse trigger fica ARMADO durante o backfill; se houvesse uma avulsa com
  --    valor_total nulo ou zero, ele reescreveria valor_total de carona.
  select count(*)
    into v_risco_avulsa
    from public.propostas p
   where p.id = any(v_ids)
     and p.is_avulso is true
     and (p.valor_total is null or p.valor_total = 0);

  if v_risco_avulsa > 0 then
    raise exception
      'ABORTADO: % proposta(s) avulsa(s) com valor_total nulo ou zero no alvo. tg_propostas_valor_total_avulsa reescreveria valor_total de carona. Parar e decidir antes.',
      v_risco_avulsa;
  end if;

  -- 5. Guarda: nenhuma linha alvo pode acordar tg_registrar_paid_at.
  --    Ele so age quando status_interno PASSA A 'RECEBIDO'; como nao tocamos no
  --    status, OLD = NEW e o if e falso. Medido mesmo assim, por seguranca.
  select count(*)
    into v_risco_paid
    from public.propostas p
   where p.id = any(v_ids)
     and p.status_interno = 'RECEBIDO';

  if v_risco_paid > 0 then
    raise exception
      'ABORTADO: % proposta(s) em status RECEBIDO no alvo. Revisar tg_registrar_paid_at antes de prosseguir.',
      v_risco_paid;
  end if;

  -- 6. RETRATO ANTES de updated_at, sobre exatamente as linhas trancadas.
  select md5(string_agg(p.id::text || '|' || coalesce(p.updated_at::text, '(null)'), ',' order by p.id))
    into v_hash_antes
    from public.propostas p
   where p.id = any(v_ids);

  raise notice 'Alvo: % propostas. Retrato ANTES de updated_at: %', v_alvo, v_hash_antes;

  -- 7. Desarma SO os dois carimbadores de updated_at.
  execute 'alter table public.propostas disable trigger propostas_set_timestamp';
  execute 'alter table public.propostas disable trigger trg_set_updated_at';

  -- 8. Backfill: evento MAIS RECENTE de false -> true por proposta.
  with lib as (
    select distinct on ((l.record_pk->>'id')::uuid)
           (l.record_pk->>'id')::uuid as pid,
           l.occurred_at
      from audit.logs_v2 l
     where l.schema_name = 'public'
       and l.table_name  = 'propostas'
       and l.action      = 'UPDATE'
       and l.changed_fields->'is_prd_aprovado'->>'new' = 'true'
       and l.occurred_at is not null
     order by (l.record_pk->>'id')::uuid, l.occurred_at desc
  )
  update public.propostas p
     set liberado_producao_em = lib.occurred_at
    from lib
   where lib.pid = p.id
     and p.id = any(v_ids)
     and p.liberado_producao_em is distinct from lib.occurred_at;

  get diagnostics v_gravadas = row_count;

  -- 9. Rearma. Se qualquer coisa acima tivesse falhado, o rollback ja teria
  --    feito isso sozinho — este enable e para o caminho de sucesso.
  execute 'alter table public.propostas enable trigger propostas_set_timestamp';
  execute 'alter table public.propostas enable trigger trg_set_updated_at';

  -- 10. RETRATO DEPOIS. Mesmas linhas, mesma expressao.
  select md5(string_agg(p.id::text || '|' || coalesce(p.updated_at::text, '(null)'), ',' order by p.id))
    into v_hash_depois
    from public.propostas p
   where p.id = any(v_ids);

  if v_hash_depois is distinct from v_hash_antes then
    raise exception
      'ABORTADO: updated_at MUDOU durante o backfill. Antes: % | Depois: %. Nada foi aplicado.',
      v_hash_antes, v_hash_depois;
  end if;

  -- 11. Prova de cobertura: nenhuma linha alvo pode ter sobrado sem carimbo.
  if exists (select 1 from public.propostas
              where id = any(v_ids) and liberado_producao_em is null) then
    raise exception 'ABORTADO: sobraram propostas liberadas sem liberado_producao_em apos o backfill.';
  end if;

  raise notice 'Backfill OK: % linha(s) gravada(s) de % alvo. Retrato DEPOIS: % (identico ao ANTES).',
    v_gravadas, v_alvo, v_hash_depois;
end
$backfill$;

-- ============================================================================
-- VERIFICACAO (somente leitura, DEPOIS de aplicar)
-- ============================================================================
--
-- CRITERIO: DELTA E REGRA, NAO NUMERO ABSOLUTO
--   Banco de producao vivo. Entre escrever e aplicar, os atendentes continuam
--   liberando pedidos — o alvo pode ter deixado de ser 41. As verificacoes
--   abaixo comparam ANTES x DEPOIS e checam REGRAS, nunca um numero fixo.
--   Absolutos que seguem valendo, porque nao dependem do movimento da operacao:
--   59 colunas (58 + 1), 6 triggers, os 6 com tgenabled = 'O', e ZERO linha
--   liberada sem carimbo.
--
--   -- a) a coluna nasceu timestamptz, nulavel e sem default
--   select column_name, data_type, is_nullable,
--          coalesce(column_default, '(sem default)') as padrao
--     from information_schema.columns
--    where table_schema = 'public'
--      and table_name   = 'propostas'
--      and column_name  = 'liberado_producao_em';
--   -- esperado: 1 linha | timestamp with time zone | YES | (sem default)
--   --           e a tabela passa a ter exatamente 59 colunas (58 + 1)
--
--   -- b) OS SEIS TRIGGERS VOLTARAM ARMADOS. Criterio ABSOLUTO.
--   --    Esta e a verificacao mais importante do arquivo: se algum ficar 'D',
--   --    a tabela esta sem carimbo de updated_at e precisa ser rearmada JA com
--   --      alter table public.propostas enable trigger <nome>;
--   select t.tgname,
--          t.tgenabled,
--          case t.tgenabled when 'O' then 'ARMADO' else 'DESARMADO -- CORRIGIR' end as situacao
--     from pg_trigger t
--     join pg_class c on c.oid = t.tgrelid
--     join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public' and c.relname = 'propostas' and not t.tgisinternal
--    order by t.tgname;
--   -- esperado: 6 linhas, TODAS com tgenabled = 'O'
--
--   -- c) RETRATO DE updated_at — rodar ANTES e DEPOIS e comparar
--   --    (a mesma expressao que o bloco DO usa como trava automatica)
--   select count(*)                                        as linhas_alvo,
--          md5(string_agg(id::text || '|' ||
--              coalesce(updated_at::text, '(null)'), ',' order by id)) as retrato,
--          min(updated_at)                                 as updated_at_min,
--          max(updated_at)                                 as updated_at_max
--     from public.propostas
--    where is_prd_aprovado is true;
--   -- esperado: `retrato`, `updated_at_min` e `updated_at_max` IDENTICOS antes e
--   -- depois. `linhas_alvo` pode crescer se alguem liberar um pedido no
--   -- intervalo — nesse caso o retrato muda POR ISSO, e a prova e a (d).
--
--   -- d) RETRATO LINHA A LINHA — a prova a olho nu, para rodar antes e depois
--   select id_int,
--          to_char(updated_at, 'DD/MM/YYYY HH24:MI:SS.MS')          as updated_at,
--          to_char(liberado_producao_em, 'DD/MM/YYYY HH24:MI:SS')   as liberado_em,
--          status_interno
--     from public.propostas
--    where is_prd_aprovado is true
--    order by id_int;
--   -- esperado: a coluna updated_at IDENTICA nas duas execucoes, ate os
--   -- milissegundos; liberado_em vazia antes e preenchida depois.
--
--   -- e) O RESTO DA TABELA NAO FOI TOCADO. Criterio ABSOLUTO de nao-regressao:
--   --    o backfill so alcanca linhas com is_prd_aprovado = true, entao o maior
--   --    updated_at das OUTRAS linhas nao pode ter saltado para agora por causa
--   --    dele. Rodar antes e depois.
--   select count(*)      as linhas_fora_do_alvo,
--          max(updated_at) as updated_at_max_fora_do_alvo
--     from public.propostas
--    where is_prd_aprovado is not true;
--   -- esperado: `updated_at_max_fora_do_alvo` inalterado pela migration
--   -- (pode avancar por trabalho normal dos vendedores — mas nunca em bloco)
--
--   -- f) COBERTURA: nenhuma proposta liberada pode ficar sem carimbo
--   select count(*) filter (where liberado_producao_em is null) as liberadas_sem_carimbo,
--          count(*) filter (where liberado_producao_em is not null) as com_carimbo,
--          min(liberado_producao_em) as mais_antiga,
--          max(liberado_producao_em) as mais_recente
--     from public.propostas
--    where is_prd_aprovado is true;
--   -- esperado: liberadas_sem_carimbo = 0
--   -- na escrita desta migration: com_carimbo = 41,
--   --   mais_antiga = 30/06/2026 21:09, mais_recente = 27/08/2026 13:56
--
--   -- g) NENHUM CARIMBO INVENTADO: a data da liberacao nunca pode ser anterior
--   --    a criacao da proposta nem estar no futuro
--   select count(*) filter (where liberado_producao_em < created_at) as antes_da_criacao,
--          count(*) filter (where liberado_producao_em > now())      as no_futuro
--     from public.propostas
--    where liberado_producao_em is not null;
--   -- esperado: 0 e 0
--
--   -- h) NAO HOUVE BACKFILL FORA DO ALVO: quem nao esta liberado hoje nao
--   --    recebeu carimbo retroativo desta migration
--   select count(*) as carimbadas_mas_nao_liberadas
--     from public.propostas
--    where is_prd_aprovado is not true
--      and liberado_producao_em is not null;
--   -- esperado: 0 LOGO APOS aplicar.
--   -- Depois que o codigo entrar, este numero CRESCE de proposito: e a regra
--   -- "retirar da producao preserva o carimbo" funcionando.
--
--   -- i) is_prd_aprovado NAO FOI TOCADO — rodar antes e depois
--   select count(*) filter (where is_prd_aprovado is true)  as liberadas,
--          count(*) filter (where is_prd_aprovado is false) as nao_liberadas,
--          count(*) filter (where is_prd_aprovado is null)  as nulas
--     from public.propostas;
--   -- esperado: os tres valores identicos antes e depois (delta = 0)
--
--   -- j) A AUDITORIA REGISTROU O BACKFILL, e SO a coluna nova
--   select count(*) as eventos_do_backfill
--     from audit.logs_v2
--    where schema_name = 'public'
--      and table_name  = 'propostas'
--      and action      = 'UPDATE'
--      and changed_fields ? 'liberado_producao_em'
--      and occurred_at >= now() - interval '10 minutes';
--   -- esperado: o mesmo numero de linhas gravadas pelo backfill (41 na escrita).
--   -- Inspecionar uma delas e confirmar que changed_fields tem SO
--   -- `liberado_producao_em` — `updated_at` esta em ignored_columns e por isso
--   -- nao aparece; se aparecesse OUTRA coluna qualquer, parar e investigar.
--
--   -- k) nenhuma restricao de propostas foi criada, alterada ou perdida
--   select conname, pg_get_constraintdef(oid)
--     from pg_constraint
--    where conrelid = 'public.propostas'::regclass
--    order by conname;
--   -- esperado: a mesma lista de antes, sem nenhum item novo
--
--   -- l) nenhum indice novo (a migration nao cria indice, de proposito:
--   --    a lista de OS ja parte de is_prd_aprovado = true, hoje 6 linhas)
--   select indexname from pg_indexes
--    where schemaname = 'public' and tablename = 'propostas'
--    order by indexname;
--   -- esperado: a mesma lista de antes
--
-- ============================================================================
-- ROLLBACK (comentado, nao executar sem decisao explicita)
-- ============================================================================
--   Derrubar a coluna e seguro e nao perde informacao: a fonte da verdade
--   continua sendo audit.logs_v2, e o backfill pode ser refeito a qualquer
--   momento reaplicando este arquivo. Antes de derrubar, conferir que nenhum
--   codigo publicado le a coluna (a leitura entra em rodada separada; se o
--   aplicativo ja estiver lendo, reverter o codigo PRIMEIRO).
--
--   alter table public.propostas drop column if exists liberado_producao_em;
--
--   Rollback PARCIAL — manter a coluna e so limpar o backfill:
--   Exige o mesmo cuidado com updated_at, entao repete o desarme dos dois
--   triggers dentro de um unico bloco atomico.
--
--   do $rollback$
--   declare
--     v_hash_antes  text;
--     v_hash_depois text;
--   begin
--     select md5(string_agg(id::text || '|' || coalesce(updated_at::text, '(null)'), ',' order by id))
--       into v_hash_antes from public.propostas where liberado_producao_em is not null;
--
--     execute 'alter table public.propostas disable trigger propostas_set_timestamp';
--     execute 'alter table public.propostas disable trigger trg_set_updated_at';
--
--     update public.propostas set liberado_producao_em = null
--      where liberado_producao_em is not null;
--
--     execute 'alter table public.propostas enable trigger propostas_set_timestamp';
--     execute 'alter table public.propostas enable trigger trg_set_updated_at';
--
--     select md5(string_agg(id::text || '|' || coalesce(updated_at::text, '(null)'), ',' order by id))
--       into v_hash_depois from public.propostas
--      where id in (select id from public.propostas where is_prd_aprovado is true);
--
--     raise notice 'updated_at antes: % | depois: %', v_hash_antes, v_hash_depois;
--   end
--   $rollback$;
--
--   SE A MIGRATION FOR INTERROMPIDA E OS TRIGGERS FICAREM DESARMADOS
--   (nao deve acontecer — DDL e transacional —, mas o comando de socorro e este):
--
--   alter table public.propostas enable trigger propostas_set_timestamp;
--   alter table public.propostas enable trigger trg_set_updated_at;
