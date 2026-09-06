-- Religa a auditoria de pagamentos_v2, com colunas restritas, e adota a
-- expedicao_recotacao_liberacoes, que audita no vazio desde 20/08
--
-- O QUE E
--   Tres escritas, todas de CONFIGURACAO DE AUDITORIA. Nenhuma linha de negocio
--   e tocada:
--
--     1. audit.config_v2 de `pagamentos_v2` passa a ignorar 10 colunas;
--     2. `trg_audit_pagamentos_v2` volta a `tgenabled = 'O'`;
--     3. `expedicao_recotacao_liberacoes` entra em audit.config_v2.
--
--   NAO religa `tg_atualiza_status_proposta_pagamento`. Ver secao propria.
--   NAO faz backfill: o passado nao volta, e nao ha de onde tira-lo.
--
-- POR QUE — O QUE SE SABE, E O QUE NAO SE SABE
--   `trg_audit_pagamentos_v2` esta com `tgenabled = 'D'`. Como
--   `audit.config_v2` diz `enabled = true` para a tabela, qualquer painel que
--   leia a config parece saudavel: so `pg_trigger.tgenabled` denuncia.
--
--   O efeito, medido em 06/09/2026: a auditoria de `pagamentos_v2` viveu DOIS
--   DIAS. Primeiro evento 28/03/2026, ultimo 30/03/2026, 84 eventos no total.
--   Desde entao, 6.743 cobrancas foram criadas sem nenhum registro de quem
--   gerou, quem confirmou e quem cancelou.
--
--   `pagamentos_v2` e a UNICA que parou. As outras cinco tabelas auditadas
--   comecaram junto e seguem gravando ate hoje:
--
--     propostas   28/03 -> 06/09   62.751 eventos
--     boletos     28/03 -> 06/09    5.938
--     clientes    30/03 -> 04/09  264.222
--     produtos    14/04 -> 04/09      350
--     usuarios    16/04 -> 05/09      118
--
--   Isso descarta restore geral, `session_replication_role` e defeito do audit
--   v2: foi especifico daquela tabela.
--
--   JANELA DA DESABILITACAO: entre 30/03/2026 e 05/06/2026. O limite inferior e
--   o ultimo evento gravado; o superior e o dump `scratch/schema.sql`, datado de
--   05/06/2026, que ja traz as duas linhas de `DISABLE TRIGGER`.
--
--   O MOTIVO NAO CONSTA EM LUGAR NENHUM. Procurado em migrations, docs, codigo,
--   `propostas_chat` e no proprio log: nada. E NAO HA COMO PROCURAR NO GIT — o
--   repositorio comeca em 25/05/2026, quase dois meses depois do evento.
--
--   NAO FOI BACKFILL. Os 83 eventos de 30/03 sao expediente normal, das 10h as
--   13h, com cinco autores distintos; o ultimo e um UPDATE de
--   `confirmado, confirmado_por` as 13:01:05. Parou no meio do dia, depois de
--   uma operacao corriqueira, sem lote antes nem depois.
--
--   LEITURA MAIS PROVAVEL, e e INFERENCIA, nao prova: alguem desabilitou os
--   DOIS triggers da tabela de uma vez, mirando o outro —
--   `tg_atualiza_status_proposta_pagamento`, que reescreve
--   `propostas.status_interno` e e o candidato natural a atrapalhar quem esta
--   mexendo em cobranca. O de auditoria foi junto, por estar na mesma tabela, e
--   ninguem religou. As duas mencoes posteriores que existem no repositorio
--   (spec de 25/08 e migration 20260828_pagamentos_v2_id_modelo_cobranca)
--   DESCREVEM o estado como descoberta — "ja estavam antes desta migration",
--   "so registra o fato" —, nunca como decisao.
--
-- ATENCAO — `tg_atualiza_status_proposta_pagamento` FICA DESABILITADO
--   DE PROPOSITO. NAO RELIGUE POR SIMETRIA.
--
--   Ele grava `NOVO` / `A_RECEBER` / `QUITADO` em `propostas.status_interno`.
--   `FLUXO-OFICIAL-STATUS-PROPOSTAS.md` (secao 8) registra que ele esta
--   desabilitado e que "valores como A_RECEBER e QUITADO nao fazem parte do
--   fluxo oficial desta documentacao". Alem disso, ja existem TRES triggers
--   ativos escrevendo status de proposta a partir de pagamento
--   (`trg_sync_finiro_to_proposta`, `trg_sync_status_proposta` e o guarda de
--   status protegido). Religa-lo reintroduziria vocabulario aposentado e um
--   quarto escritor no mesmo campo.
--
--   Os dois triggers estao no mesmo estado por acidente de historico, mas tem
--   MERITO OPOSTO. Por isso existe uma assercao de saida, obrigatoria, que
--   FALHA se ele sair de 'D'.
--
-- POR QUE RESTRINGIR COLUNAS
--   `audit.log_row_changes_v2` grava `to_jsonb(new)` e `to_jsonb(old)` INTEIROS.
--   `pagamentos_v2` tem 63 colunas, e entre elas:
--
--     token_publico, public_token   8.132 de 8.132 linhas (100%) — sao os
--                                   tokens que abrem a pagina publica de
--                                   pagamento sem login
--     cartao_checkout_url/_id       415 linhas — checkout do cartao
--     url_cobranca, url_pdf         links do provedor
--     pix_copia_cola                payload PIX
--     linha_digitavel               boleto
--     documento                     7.945 de 8.132 (97,7%) — CPF/CNPJ, LGPD
--
--   ATENUANTE MEDIDO, e ele importa para calibrar o risco: `audit.logs_v2` NAO
--   TEM GRANT NENHUM (`relacl` vazio) e RLS desligada; `public.vw_audit_logs_v2`
--   so tem grant para `postgres` e `service_role`. NEM `anon` NEM
--   `authenticated` leem a auditoria. O log nao chega ao usuario.
--
--   Ou seja: a restricao NAO e para tapar exposicao — e porque nao ha razao
--   para guardar token de acesso e CPF em texto, para sempre, num log que
--   ninguem vai consultar por esses campos. As perguntas que a direcao faz —
--   quem gerou, quem confirmou, quem cancelou, quando e de quanto — sao
--   respondidas por `status`, `confirmado`, `confirmado_por`,
--   `data_confirmacao`, `valor`, `motivo_cancela`, `aprovado_por` e o
--   `actor_uid` do proprio log, todos PRESERVADOS.
--
--   Mecanismo ja existe: `audit.config_v2.ignored_columns`, consumido por
--   `get_ignored_columns_v2` + `remove_ignored_columns_v2`. Nada novo e criado.
--
-- ORDEM — POR QUE ELA ESTA GARANTIDA
--   A restricao PRECISA valer antes de o trigger gravar. Ela vale, por duas
--   razoes independentes:
--
--     1. `audit.log_row_changes_v2` le `audit.config_v2` EM TEMPO DE EXECUCAO,
--        a cada disparo — nao em tempo de definicao. Nao ha plano cacheado da
--        config;
--     2. DDL em PostgreSQL e TRANSACIONAL. O `update` da config e o
--        `alter table ... enable trigger` fazem parte da MESMA transacao, entao
--        para qualquer outra sessao os dois passam a valer no MESMO instante, o
--        do COMMIT. Nao existe janela em que o trigger esteja ligado com a
--        config antiga.
--
--   Dentro da propria transacao da migration o trigger nao chega a disparar:
--   ela nao escreve em `pagamentos_v2`. Ainda assim o `update` vem ANTES do
--   `alter table`, por ordem defensiva.
--
-- SOBRE O LOCK — LEIA ANTES DE APLICAR
--   `alter table ... enable trigger` pega ACCESS EXCLUSIVE em `pagamentos_v2`.
--   Esse nivel TRAVA LEITURA E ESCRITA na tabela enquanto durar. E so catalogo,
--   sem varredura: milissegundos. Mas ele ESPERA as transacoes abertas
--   terminarem, e enquanto espera ENFILEIRA todo mundo atras dele.
--
--   Por isso a migration abre com `set local lock_timeout = '5s'`: se o lock
--   nao vier em 5 segundos, ela FALHA e nao aplica nada, em vez de segurar a
--   tabela de cobrancas. Rode fora do horario comercial e, se falhar por
--   timeout, tente de novo — nao insista aumentando o timeout.
--
-- POR QUE `expedicao_recotacao_liberacoes` ENTRA AQUI
--   Ela tem `trg_audit_expedicao_recotacao_liberacoes` HABILITADO desde
--   20260820_expedicao_recotacao_liberacoes.sql, mas NUNCA foi inserida em
--   `audit.config_v2`. `log_row_changes_v2` le a config, nao encontra a linha,
--   e retorna sem gravar. Resultado medido: 0 eventos no log. A tabela paga o
--   custo do trigger a cada INSERT/UPDATE/DELETE e nao recebe nada em troca.
--   E a UNICA nessa situacao entre as sete tabelas com trigger de auditoria.
--
--   `ignored_columns` fica `{updated_at}`, o mesmo padrao das outras seis.
--   Registro que a tabela NAO TEM coluna `updated_at` — o valor e inocuo, e a
--   funcao so remove chave que exista. Mantido por coerencia, nao por efeito.
--
-- ESCOPO / O QUE ESTA MIGRATION NAO FAZ
--   Nao escreve em `pagamentos_v2`, `propostas`, `expedicoes` nem em qualquer
--   tabela de negocio. Nao faz backfill. Nao cria nem remove trigger, tabela,
--   coluna, indice, RLS ou grant. Nao toca nas particoes de `audit.logs_v2` nem
--   no job `audit-criar-particoes-futuras`. Nao altera codigo de aplicacao.
--
-- CUSTO ESTIMADO DEPOIS DE APLICAR
--   ~50 INSERTs/dia em `pagamentos_v2`; fator de 9,5 eventos por linha ao longo
--   da vida, medido em `boletos` (1.315 eventos para 139 inserts em 30 dias)
--   => ~470 eventos/dia, ~14.100/mes. Linha como JSON: 1.911 bytes; evento com
--   `old` + `new` + diff: ~4 kB => ~56 MB/mes. Contra os ~830 MB acumulados
--   hoje, e ~15% do ritmo atual, ja coberto pelas particoes ate 2027-12.
--
--   Menos que isso, na verdade: as 10 colunas ignoradas saem dos tres campos.

-- ─────────────────────────────────────────────────────────────────────────────
-- Guarda de lock: falha rapido em vez de segurar a tabela de cobrancas.
-- ─────────────────────────────────────────────────────────────────────────────
set local lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- ASSERCOES DE ENTRADA — abortam antes de qualquer escrita
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_audit_estado    "char";
  v_status_estado   "char";
  v_ignored         text[];
  v_recot_config    int;
  v_recot_trigger   "char";
  v_eventos         bigint;
  v_faltando        text;
begin
  -- 1. o trigger de auditoria esta MESMO desabilitado?
  select t.tgenabled into v_audit_estado
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'pagamentos_v2'
     and t.tgname = 'trg_audit_pagamentos_v2' and not t.tgisinternal;

  if v_audit_estado is null then
    raise exception 'ABORTADO: trigger trg_audit_pagamentos_v2 nao existe.';
  end if;
  if v_audit_estado <> 'D' then
    raise exception 'ABORTADO: trg_audit_pagamentos_v2 esperado em D, encontrado em %. Alguem ja mexeu; reveja antes.', v_audit_estado;
  end if;

  -- 2. o trigger de status continua desabilitado? (esta migration nao o toca)
  select t.tgenabled into v_status_estado
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'pagamentos_v2'
     and t.tgname = 'tg_atualiza_status_proposta_pagamento' and not t.tgisinternal;

  if v_status_estado is null then
    raise exception 'ABORTADO: trigger tg_atualiza_status_proposta_pagamento nao existe. Estado inesperado.';
  end if;
  if v_status_estado <> 'D' then
    raise exception 'ABORTADO: tg_atualiza_status_proposta_pagamento esperado em D, encontrado em %. Ele deve continuar DESABILITADO.', v_status_estado;
  end if;

  -- 3. a config de pagamentos_v2 esta no estado de partida?
  select ignored_columns into v_ignored
    from audit.config_v2 where schema_name = 'public' and table_name = 'pagamentos_v2';

  if v_ignored is null then
    raise exception 'ABORTADO: audit.config_v2 nao tem linha para public.pagamentos_v2.';
  end if;
  if v_ignored <> array['updated_at']::text[] then
    raise exception 'ABORTADO: ignored_columns de pagamentos_v2 esperado {updated_at}, encontrado %. Alguem ja restringiu; reveja antes de sobrescrever.', v_ignored;
  end if;

  -- 4. as nove colunas a ignorar existem MESMO, com o nome exato?
  --    (`updated_at` fica de fora: pagamentos_v2 nao a tem, e o valor e inocuo)
  select string_agg(col, ', ') into v_faltando
    from unnest(array['token_publico','public_token','cartao_checkout_url','cartao_checkout_id',
                      'url_cobranca','url_pdf','pix_copia_cola','linha_digitavel','documento']) col
   where not exists (
     select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'pagamentos_v2' and column_name = col
   );
  if v_faltando is not null then
    raise exception 'ABORTADO: coluna(s) inexistente(s) em pagamentos_v2: %. Corrija a lista antes de aplicar.', v_faltando;
  end if;

  -- 5. expedicao_recotacao_liberacoes: trigger ligado e FORA da config
  select count(*) into v_recot_config
    from audit.config_v2 where schema_name = 'public' and table_name = 'expedicao_recotacao_liberacoes';
  if v_recot_config <> 0 then
    raise exception 'ABORTADO: expedicao_recotacao_liberacoes ja esta em audit.config_v2. Nada a inserir.';
  end if;

  select t.tgenabled into v_recot_trigger
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'expedicao_recotacao_liberacoes'
     and t.tgname = 'trg_audit_expedicao_recotacao_liberacoes' and not t.tgisinternal;
  if v_recot_trigger is distinct from 'O' then
    raise exception 'ABORTADO: trg_audit_expedicao_recotacao_liberacoes nao esta habilitado (estado: %).', coalesce(v_recot_trigger::text,'ausente');
  end if;

  -- 6. quantos eventos de pagamentos_v2 existem hoje (linha de base)
  select count(*) into v_eventos from audit.logs_v2 where table_name = 'pagamentos_v2';
  if v_eventos <> 84 then
    raise notice 'ATENCAO: eventos de pagamentos_v2 no log = % (esperado 84 em 06/09/2026). Nao e erro, mas confira se alguem religou antes.', v_eventos;
  end if;

  raise notice 'Assercoes de entrada OK. Auditoria em D, status em D, ignored_columns {updated_at}, recotacao fora da config, % eventos de base.', v_eventos;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- PASSO 1 — restringir as colunas ANTES de ligar o trigger
--
-- Ordem defensiva. Como DDL e transacional, para as outras sessoes os dois
-- passos valem juntos no COMMIT — mas dentro da transacao a config ja esta
-- posta quando o trigger e habilitado.
-- ─────────────────────────────────────────────────────────────────────────────
update audit.config_v2
   set ignored_columns = array[
         'updated_at',
         'token_publico',
         'public_token',
         'cartao_checkout_url',
         'cartao_checkout_id',
         'url_cobranca',
         'url_pdf',
         'pix_copia_cola',
         'linha_digitavel',
         'documento'
       ]::text[]
 where schema_name = 'public' and table_name = 'pagamentos_v2';

-- ─────────────────────────────────────────────────────────────────────────────
-- PASSO 2 — religar a auditoria de pagamentos_v2
--
-- ACCESS EXCLUSIVE na tabela, protegido pelo lock_timeout do topo.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.pagamentos_v2 enable trigger trg_audit_pagamentos_v2;

-- ─────────────────────────────────────────────────────────────────────────────
-- PASSO 3 — adotar expedicao_recotacao_liberacoes na config
--
-- O trigger dela ja existe e ja dispara desde 20/08. Faltava a config para
-- log_row_changes_v2 parar de retornar sem gravar.
-- ─────────────────────────────────────────────────────────────────────────────
insert into audit.config_v2 (schema_name, table_name, enabled, ignored_columns)
values ('public', 'expedicao_recotacao_liberacoes', true, array['updated_at']::text[]);

-- ─────────────────────────────────────────────────────────────────────────────
-- ASSERCOES DE SAIDA
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_audit_estado  "char";
  v_status_estado "char";
  v_ignored       text[];
  v_recot         record;
begin
  select t.tgenabled into v_audit_estado
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'pagamentos_v2'
     and t.tgname = 'trg_audit_pagamentos_v2' and not t.tgisinternal;
  if v_audit_estado <> 'O' then
    raise exception 'FALHOU: trg_audit_pagamentos_v2 deveria estar em O, esta em %.', v_audit_estado;
  end if;

  -- OBRIGATORIA: o outro trigger NAO pode ter sido religado por tabela.
  select t.tgenabled into v_status_estado
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'pagamentos_v2'
     and t.tgname = 'tg_atualiza_status_proposta_pagamento' and not t.tgisinternal;
  if v_status_estado <> 'D' then
    raise exception 'FALHOU: tg_atualiza_status_proposta_pagamento saiu de D (esta em %). Ele DEVE permanecer desabilitado.', v_status_estado;
  end if;

  select ignored_columns into v_ignored
    from audit.config_v2 where schema_name = 'public' and table_name = 'pagamentos_v2';
  if array_length(v_ignored, 1) <> 10 then
    raise exception 'FALHOU: ignored_columns de pagamentos_v2 tem % nome(s), esperado 10.', array_length(v_ignored, 1);
  end if;
  if not (v_ignored @> array['updated_at','token_publico','public_token','cartao_checkout_url',
                             'cartao_checkout_id','url_cobranca','url_pdf','pix_copia_cola',
                             'linha_digitavel','documento']::text[]) then
    raise exception 'FALHOU: ignored_columns de pagamentos_v2 nao contem os dez nomes: %', v_ignored;
  end if;

  select * into v_recot from audit.config_v2
   where schema_name = 'public' and table_name = 'expedicao_recotacao_liberacoes';
  if v_recot is null then
    raise exception 'FALHOU: expedicao_recotacao_liberacoes nao entrou em audit.config_v2.';
  end if;
  if not v_recot.enabled then
    raise exception 'FALHOU: expedicao_recotacao_liberacoes entrou na config mas com enabled = false.';
  end if;

  raise notice 'Assercoes de saida OK. Auditoria em O, status ainda em D, 10 colunas ignoradas, recotacao adotada.';
end $$;

-- VERIFICACAO (somente leitura, depois de aplicar)
--
--   -- a) IMPRESSAO DIGITAL DE pagamentos_v2 — a prova de que nada de negocio mudou.
--   --
--   --    RESSALVA: a impressao pedida sobre (id, updated_at) NAO E POSSIVEL.
--   --    `pagamentos_v2` NAO TEM coluna `updated_at` — conferido em 06/09/2026.
--   --    Esta abaixo e ESTRITAMENTE MAIS FORTE: cobre TODAS as 63 colunas de
--   --    TODAS as linhas, nao so duas.
--   select count(*) as linhas,
--          md5(string_agg(to_jsonb(p.*)::text, '|' order by p.id)) as impressao_linha_inteira,
--          md5(string_agg(p.id::text || '|' || coalesce(p.status,'') || '|' ||
--                         coalesce(p.valor::text,'') || '|' || coalesce(p.confirmado::text,'') || '|' ||
--                         coalesce(p.paid_at::text,'') || '|' || coalesce(p.data_confirmacao::text,''),
--                         ';' order by p.id)) as impressao_campos_criticos
--     from pagamentos_v2 p;
--   -- MEDIDO ANTES, em 06/09/2026:
--   --   linhas                    = 8132
--   --   impressao_linha_inteira   = f98c164aa32aafe2b8d47eb98548e023
--   --   impressao_campos_criticos = 8ef016926d7b45b9e5dea2b325415396
--   --
--   -- ESPERADO DEPOIS: os TRES identicos, se ninguem usou o sistema entre as
--   -- duas medidas. Banco de producao vivo: se o `linhas` subir e as impressoes
--   -- mudarem, isso e operacao normal, NAO efeito desta migration — que nao tem
--   -- um unico comando de escrita em tabela de negocio. Para eliminar a duvida,
--   -- rode as duas medidas em sequencia imediata, fora do expediente.
--
--   -- b) propostas tambem intocada
--   select count(*) as linhas,
--          md5(string_agg(p.id_int::text || '|' || coalesce(p.status_interno,'') || '|' ||
--                         coalesce(p.updated_at::text,''), ';' order by p.id_int)) as impressao
--     from propostas p;
--   -- Mesma leitura da (a): esta migration nao escreve em propostas.
--
--   -- c) os dois triggers, lado a lado — o que mais importa nesta migration
--   select t.tgname,
--          case t.tgenabled when 'O' then 'habilitado' when 'D' then 'DESABILITADO' else t.tgenabled::text end as estado
--     from pg_trigger t join pg_class c on c.oid = t.tgrelid
--     join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public' and c.relname = 'pagamentos_v2' and not t.tgisinternal
--      and t.tgname in ('trg_audit_pagamentos_v2','tg_atualiza_status_proposta_pagamento')
--    order by t.tgname;
--   -- esperado:
--   --   tg_atualiza_status_proposta_pagamento -> DESABILITADO   <- TEM de continuar
--   --   trg_audit_pagamentos_v2               -> habilitado
--
--   -- d) a config das sete tabelas
--   select table_name, enabled, ignored_columns, array_length(ignored_columns,1) as qtd
--     from audit.config_v2 order by table_name;
--   -- esperado: 7 linhas (as 6 de antes + expedicao_recotacao_liberacoes), todas
--   -- enabled = true; pagamentos_v2 com qtd = 10; as outras seis com qtd = 1.
--
--   -- e) NENHUM outro trigger foi mexido
--   select n.nspname||'.'||c.relname as tabela, t.tgname, t.tgenabled
--     from pg_trigger t join pg_class c on c.oid = t.tgrelid
--     join pg_namespace n on n.oid = c.relnamespace
--    where not t.tgisinternal and t.tgenabled <> 'O'
--    order by 1, 2;
--   -- esperado: UMA linha — tg_atualiza_status_proposta_pagamento em 'D'.
--   -- Antes desta migration eram DUAS. Se voltar zero, alguem religou o de
--   -- status; se voltar tres ou mais, algo desabilitou outro trigger.
--
--   -- f) a auditoria voltou a gravar, e SEM as colunas restritas.
--   --    Rodar depois da PRIMEIRA cobranca criada ou alterada apos aplicar.
--   select occurred_at, action,
--          (new_data ? 'token_publico')       as vazou_token_publico,
--          (new_data ? 'public_token')        as vazou_public_token,
--          (new_data ? 'documento')           as vazou_documento,
--          (new_data ? 'pix_copia_cola')      as vazou_pix,
--          (new_data ? 'linha_digitavel')     as vazou_linha_digitavel,
--          (new_data ? 'cartao_checkout_url') as vazou_checkout,
--          (new_data ? 'status')              as tem_status,
--          (new_data ? 'confirmado_por')      as tem_confirmado_por
--     from audit.logs_v2
--    where table_name = 'pagamentos_v2' and occurred_at > now() - interval '1 day'
--    order by occurred_at desc limit 5;
--   -- esperado: TODOS os `vazou_*` = false e os `tem_*` = true.
--   -- Qualquer `vazou_*` verdadeiro significa que a restricao nao pegou — nesse
--   -- caso, DESLIGUE o trigger de novo antes de investigar.
--
--   -- g) expedicao_recotacao_liberacoes saiu do vazio.
--   --    So aparece depois da proxima liberacao ou revogacao de recotacao.
--   select count(*) as eventos from audit.logs_v2
--    where table_name = 'expedicao_recotacao_liberacoes';
--   -- antes: 0. Depois de aplicar continua 0 ate a proxima escrita na tabela —
--   -- isso e esperado, nao falha. NAO ha backfill.
--
-- ROLLBACK
--   Reversivel por inteiro. Nada de negocio foi tocado, entao voltar atras nao
--   perde dado nenhum — so volta a nao auditar.
--
--   -- 1) desligar de novo a auditoria de pagamentos_v2
--   --    (ACCESS EXCLUSIVE outra vez; use lock_timeout)
--   -- set local lock_timeout = '5s';
--   -- alter table public.pagamentos_v2 disable trigger trg_audit_pagamentos_v2;
--
--   -- 2) devolver ignored_columns ao valor de partida
--   -- update audit.config_v2 set ignored_columns = array['updated_at']::text[]
--   --  where schema_name = 'public' and table_name = 'pagamentos_v2';
--
--   -- 3) tirar expedicao_recotacao_liberacoes da config
--   -- delete from audit.config_v2
--   --  where schema_name = 'public' and table_name = 'expedicao_recotacao_liberacoes';
--
--   OS EVENTOS JA GRAVADOS FICAM. O rollback interrompe a coleta daqui para a
--   frente; ele NAO apaga o que foi auditado no intervalo, e nao deve.
--
--   NAO FAZ PARTE DO ROLLBACK religar `tg_atualiza_status_proposta_pagamento`.
--   Ele nunca foi tocado por esta migration, e continua desabilitado por
--   decisao — nao por acidente.
