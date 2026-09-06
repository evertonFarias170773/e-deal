-- Auditoria: particoes ate 2027-12, particao DEFAULT e agendamento SEM expurgo
--
-- O QUE E
--   Tres coisas, nesta ordem, todas sobre `audit.logs_v2`:
--
--     1. cria as particoes mensais faltantes, de 2027-01 ate 2027-12;
--     2. cria uma particao DEFAULT, como rede de seguranca;
--     3. agenda um job mensal no pg_cron que SO CRIA particao — nunca apaga.
--
--   Nao toca em dado nenhum. Nao apaga nada. Nao altera aplicacao.
--
-- POR QUE
--   `audit.logs_v2` e particionada por mes e as particoes vao de 2026_03 a
--   2026_12. NAO EXISTE particao DEFAULT. Em 01/01/2027 o INSERT no log nao
--   encontra particao e falha.
--
--   Isso nao derruba so a auditoria. `audit.log_row_changes_v2` roda por trigger
--   DENTRO da transacao de quem escreveu, entao a falha do INSERT no log aborta
--   a transacao do autor: salvar proposta, gerar boleto, cadastrar cliente,
--   editar produto e mexer em usuario passam a falhar. Seis tabelas auditadas,
--   o ERP inteiro parado, com data marcada.
--
--   Existe `audit.run_maintenance_v2(p_months_ahead, p_keep_months)`, que criaria
--   as particoes — mas ela TAMBEM chama `audit.delete_old_logs_v2`, que faz
--   DROP TABLE nas particoes mais velhas que `p_keep_months` (default 12).
--   A direcao usa a auditoria como ferramenta de controle: apagar historico por
--   default e inaceitavel. Por isso esta migration NAO usa `run_maintenance_v2`.
--
--   AS DUAS COISAS PODEM SER SEPARADAS. `audit.create_month_partition_v2(date)`
--   e uma funcao independente, idempotente (`create table if not exists` mais
--   cinco `create index if not exists`) e que NAO chama expurgo nenhum. E ela
--   que o job agendado abaixo usa, direto, num laco inline — quem ler
--   `cron.job.command` ve exatamente o que roda, e nao ha caminho para o DROP.
--
-- Verificado no banco em 06/09/2026, ANTES de escrever:
--
--   1. PostgreSQL 17.4. `audit.logs_v2` tem 10 particoes mensais (2026_03 a
--      2026_12), 333.463 linhas, ~830 MB, e ZERO particoes DEFAULT.
--
--   2. `cron.job` tem UM job: `atualizar-atraso-boletos`, `0 3 * * *`, rodando
--      como `postgres`. NENHUM job chama manutencao da auditoria. A extensao
--      pg_cron esta instalada e funcionando.
--
--   3. O QUE `run_maintenance_v2()` COM DEFAULTS APAGARIA HOJE: NADA.
--      O corte seria 2025-09-01 e o evento mais antigo e de 2026-03-28.
--      0 particoes dropadas, 0 eventos deletados.
--
--      Mas o relogio corre. Se alguem agendar a funcao com o default de 12
--      meses, o expurgo comeca assim:
--
--        a partir de   dropa           eventos   tamanho
--        01/04/2027    logs_v2_2026_03   1.234   4,2 MB
--        01/05/2027    logs_v2_2026_04 143.598   352 MB   <- o maior volume
--        01/06/2027    logs_v2_2026_05     ...   27 MB
--        ... e assim por diante, um mes por mes.
--
--   4. `audit.create_month_partition_v2` cria a particao E CINCO INDICES:
--      occurred_at, (schema_name, table_name, occurred_at), (action,
--      occurred_at), GIN em record_pk e GIN em changed_fields. As particoes
--      2026_06 a 2026_12 tem so QUATRO — nasceram por outro caminho, sem os
--      dois GIN. As novas vao nascer com cinco. Fica registrado que isso
--      acrescenta custo de escrita por linha auditada; nao mexo nisso aqui.
--
--   5. OUTRA TABELA PARTICIONADA NO BANCO: `realtime.messages`, 7 particoes
--      DIARIAS, tambem sem DEFAULT — mas com janela rolante que o proprio
--      Supabase mantem (hoje: 03/09 a 09/09, tres dias a frente). E
--      infraestrutura gerenciada, com rotacao propria funcionando. NAO tem o
--      mesmo problema e NAO entra nesta migration.
--
-- POR QUE ATE 2027-12, E NAO OS 2 MESES DO DEFAULT DA FUNCAO
--   `run_maintenance_v2` usa `p_months_ahead = 2`. Dois meses de folga so
--   funciona quando alguem confere o agendamento toda semana. Aqui ha UM
--   responsavel: a folga precisa sobreviver a ferias, doenca, projeto pausado
--   no Supabase e a extensao pg_cron sendo desabilitada sem ninguem notar.
--
--   16 meses de folga imediata, e o job mantendo 12 meses rolando, significa que
--   o agendamento pode falhar por UM ANO INTEIRO antes de a escrita parar — e
--   nesse meio tempo a particao DEFAULT ainda segura. O custo de uma particao
--   vazia e ~40 kB mais cinco indices vazios; 12 delas nao chegam a 1 MB.
--
-- PARECER SOBRE A PARTICAO DEFAULT — o custo, que e real
--   O custo de uma DEFAULT NAO e o espaco. E que, com LINHAS dentro dela, criar
--   uma particao nova obriga o Postgres a varrer a DEFAULT inteira para provar
--   que nenhuma linha pertence a faixa nova, sob ACCESS EXCLUSIVE. E se alguma
--   linha pertencer, o `create table ... partition of` FALHA — e ai a
--   manutencao trava justamente quando ela e mais necessaria.
--
--   Mesmo assim: VALE CRIAR. Sem ela, o modo de falha e o ERP inteiro parando.
--   Com ela, o modo de falha e uma manutencao chata depois. Trocar "o sistema
--   para" por "a manutencao fica cara" e um bom negocio.
--
--   E o custo fica teorico enquanto as particoes explicitas existirem: a
--   DEFAULT so recebe linha se TUDO falhar por 16 meses. Enquanto ela estiver
--   vazia, a varredura na criacao da proxima particao e sobre tabela vazia —
--   custo zero. Por isso a verificacao (d) abaixo conta linhas na DEFAULT: ela
--   e ALARME, nao destino. Linha ali significa que o agendamento morreu e
--   ninguem viu.
--
-- SOBRE O LOCK EM PRODUCAO
--   `create table ... partition of` pega lock no PAI. A particao nasce VAZIA,
--   entao nao ha varredura nem copia de dado: o custo e de espera por
--   transacoes abertas, nao de trabalho. Na pratica sao milissegundos.
--
--   NAO MEDI o nivel exato do lock, e nao da para medir sem executar DDL. Se
--   voce quiser margem extra, rode os passos 1 e 2 fora do horario comercial —
--   `audit.logs_v2` recebe escrita a cada alteracao auditada do sistema, entao
--   qualquer espera no pai enfileira transacao de usuario.
--
-- ESCOPO / O QUE ESTA MIGRATION NAO FAZ
--   Nao chama `run_maintenance_v2` nem `delete_old_logs_v2`. Nao apaga particao,
--   linha ou indice. Nao altera `audit.config_v2`, trigger, RLS ou permissao.
--   Nao mexe em propostas, expedicoes, cobranca, NF-e nem producao. Nao toca em
--   `realtime.messages`. Nao altera codigo de aplicacao.

-- ─────────────────────────────────────────────────────────────────────────────
-- ASSERCOES DE ENTRADA — abortam antes de qualquer escrita
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_particoes int;
  v_default   int;
  v_cron      int;
  v_job       int;
begin
  -- a tabela e mesmo particionada?
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'audit' and c.relname = 'logs_v2' and c.relkind = 'p'
  ) then
    raise exception 'ABORTADO: audit.logs_v2 nao e uma tabela particionada. Reveja o levantamento antes de seguir.';
  end if;

  -- a funcao de criacao existe, com a assinatura esperada?
  if to_regprocedure('audit.create_month_partition_v2(date)') is null then
    raise exception 'ABORTADO: audit.create_month_partition_v2(date) nao existe. Esta migration depende dela.';
  end if;

  select count(*) into v_particoes
    from pg_inherits i join pg_class p on p.oid = i.inhparent
    join pg_namespace n on n.oid = p.relnamespace
   where n.nspname = 'audit' and p.relname = 'logs_v2';

  if v_particoes < 1 then
    raise exception 'ABORTADO: audit.logs_v2 sem particao nenhuma (%). Estado inesperado.', v_particoes;
  end if;

  -- ja existe DEFAULT? se sim, o passo 2 nao deve rodar de novo.
  select count(*) into v_default
    from pg_inherits i join pg_class c on c.oid = i.inhrelid
    join pg_class p on p.oid = i.inhparent join pg_namespace n on n.oid = p.relnamespace
   where n.nspname = 'audit' and p.relname = 'logs_v2'
     and pg_get_expr(c.relpartbound, c.oid) ilike '%DEFAULT%';

  if v_default > 0 then
    raise exception 'ABORTADO: ja existe particao DEFAULT em audit.logs_v2. Rode so os passos 1 e 3, a mao.';
  end if;

  select count(*) into v_cron from pg_extension where extname = 'pg_cron';
  if v_cron = 0 then
    raise exception 'ABORTADO: extensao pg_cron ausente. O passo 3 nao tem como rodar.';
  end if;

  select count(*) into v_job from cron.job where jobname = 'audit-criar-particoes-futuras';
  if v_job > 0 then
    raise exception 'ABORTADO: job audit-criar-particoes-futuras ja existe. Confira o comando dele antes de recriar.';
  end if;

  raise notice 'Assercoes de entrada OK: % particoes, sem DEFAULT, pg_cron presente, job livre.', v_particoes;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- PASSO 1 — particoes mensais faltantes, ate 2027-12
--
-- Idempotente: `create_month_partition_v2` usa `create table if not exists`.
-- Rodar de novo nao duplica nem recria indice.
-- ─────────────────────────────────────────────────────────────────────────────
select audit.create_month_partition_v2(d::date)
from generate_series(
       date_trunc('month', current_date)::date,
       date '2027-12-01',
       interval '1 month'
     ) d;

-- ─────────────────────────────────────────────────────────────────────────────
-- PASSO 2 — particao DEFAULT (rede de seguranca; deve ficar SEMPRE vazia)
--
-- Ela nao substitui o agendamento: existe para que uma falha do job vire alarme
-- em vez de parada do sistema. A verificacao (d) checa que continua vazia.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists audit.logs_v2_default
  partition of audit.logs_v2 default;

comment on table audit.logs_v2_default is
  'REDE DE SEGURANCA, NAO DESTINO. Deve ficar SEMPRE VAZIA. Linha aqui significa que o job audit-criar-particoes-futuras parou e a particao do mes nao foi criada. Antes de criar a particao que faltou, esta tabela precisa ser drenada: com linhas dentro, o create table ... partition of varre a DEFAULT sob ACCESS EXCLUSIVE e FALHA se alguma linha pertencer a faixa nova.';

-- ─────────────────────────────────────────────────────────────────────────────
-- PASSO 3 — agendamento MENSAL que SO CRIA
--
-- O comando e inline e autoexplicativo de proposito: quem abrir `cron.job` ve
-- que ele chama `create_month_partition_v2` e mais nada. NAO ha `run_maintenance_v2`
-- e NAO ha `delete_old_logs_v2` — nao existe caminho daqui para um DROP.
--
-- Dia 1, 04:00 UTC: depois do job de boletos (03:00), sem sobreposicao.
-- Mensal, e nao diario, porque a folga de 12 meses torna a frequencia alta
-- desnecessaria — e cada execucao pega lock no pai, ainda que breve.
-- ─────────────────────────────────────────────────────────────────────────────
select cron.schedule(
  'audit-criar-particoes-futuras',
  '0 4 1 * *',
  $cron$
  select audit.create_month_partition_v2((date_trunc('month', current_date) + make_interval(months => g))::date)
    from generate_series(0, 12) g;
  $cron$
);

-- ─────────────────────────────────────────────────────────────────────────────
-- ASSERCOES DE SAIDA — rodar depois de aplicar
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_cobre_2027_12 int;
  v_default       int;
  v_linhas_def    bigint;
  v_cmd           text;
begin
  select count(*) into v_cobre_2027_12
    from pg_inherits i join pg_class c on c.oid = i.inhrelid
    join pg_class p on p.oid = i.inhparent join pg_namespace n on n.oid = p.relnamespace
   where n.nspname = 'audit' and p.relname = 'logs_v2' and c.relname = 'logs_v2_2027_12';
  if v_cobre_2027_12 <> 1 then
    raise exception 'FALHOU: particao logs_v2_2027_12 nao existe. O passo 1 nao completou.';
  end if;

  select count(*) into v_default
    from pg_inherits i join pg_class c on c.oid = i.inhrelid
    join pg_class p on p.oid = i.inhparent join pg_namespace n on n.oid = p.relnamespace
   where n.nspname = 'audit' and p.relname = 'logs_v2'
     and pg_get_expr(c.relpartbound, c.oid) ilike '%DEFAULT%';
  if v_default <> 1 then
    raise exception 'FALHOU: particao DEFAULT ausente ou duplicada (%).', v_default;
  end if;

  execute 'select count(*) from audit.logs_v2_default' into v_linhas_def;
  if v_linhas_def <> 0 then
    raise exception 'FALHOU: DEFAULT nasceu com % linha(s). Nao deveria receber nada agora.', v_linhas_def;
  end if;

  select command into v_cmd from cron.job where jobname = 'audit-criar-particoes-futuras';
  if v_cmd is null then
    raise exception 'FALHOU: job audit-criar-particoes-futuras nao foi criado.';
  end if;

  -- A assercao que mais importa: o job agendado NAO PODE ter caminho para apagar.
  if v_cmd ilike '%delete_old_logs%' or v_cmd ilike '%run_maintenance%' or v_cmd ilike '%drop %' then
    raise exception 'FALHOU: o comando agendado tem caminho para EXPURGO. Conteudo: %', v_cmd;
  end if;

  if not exists (select 1 from cron.job where jobname = 'audit-criar-particoes-futuras' and active) then
    raise exception 'FALHOU: job criado mas inativo.';
  end if;

  raise notice 'Assercoes de saida OK: cobertura ate 2027-12, DEFAULT vazia, job ativo e sem expurgo.';
end $$;

-- VERIFICACAO (somente leitura, depois de aplicar)
--
--   -- a) cobertura mes a mes, dos proximos 18 meses: nenhuma lacuna
--   select to_char(m, 'YYYY-MM') as mes,
--          exists (
--            select 1 from pg_inherits i
--            join pg_class c on c.oid = i.inhrelid
--            join pg_class p on p.oid = i.inhparent
--            join pg_namespace n on n.oid = p.relnamespace
--            where n.nspname='audit' and p.relname='logs_v2'
--              and pg_get_expr(c.relpartbound, c.oid) not ilike '%DEFAULT%'
--              and c.relname = 'logs_v2_' || to_char(m, 'YYYY_MM')
--          ) as tem_particao
--     from generate_series(date_trunc('month', current_date),
--                          date_trunc('month', current_date) + interval '17 months',
--                          interval '1 month') m
--    order by m;
--   -- esperado: tem_particao = true em TODAS as linhas ate 2027-12, e false
--   -- so a partir de 2028-01 — que e onde a DEFAULT e o job entram.
--
--   -- b) o teste que responde "e em 2027 mesmo?", sem esperar 2027:
--   --    para o primeiro instante de 2027, qual particao aceitaria a linha?
--   select c.relname as particao_que_receberia
--     from pg_inherits i
--     join pg_class c on c.oid = i.inhrelid
--     join pg_class p on p.oid = i.inhparent
--     join pg_namespace n on n.oid = p.relnamespace
--    where n.nspname='audit' and p.relname='logs_v2'
--      and c.relname = 'logs_v2_' || to_char(timestamptz '2027-01-01 00:00:00+00', 'YYYY_MM');
--   -- esperado: logs_v2_2027_01. ANTES desta migration esta consulta devolvia
--   -- ZERO LINHAS — e era exatamente essa a falha de 01/01/2027.
--
--   -- c) contagem de particoes
--   select count(*) filter (where pg_get_expr(c.relpartbound, c.oid) not ilike '%DEFAULT%') as mensais,
--          count(*) filter (where pg_get_expr(c.relpartbound, c.oid) ilike '%DEFAULT%') as default_
--     from pg_inherits i join pg_class c on c.oid = i.inhrelid
--     join pg_class p on p.oid = i.inhparent join pg_namespace n on n.oid = p.relnamespace
--    where n.nspname='audit' and p.relname='logs_v2';
--   -- esperado: 22 mensais (as 10 de hoje + 12 novas, de 2026_09 a 2027_12,
--   -- descontadas as que ja existiam) e 1 DEFAULT. O numero exato de mensais
--   -- depende do mes em que voce aplicar; o que importa e `default_ = 1` e a
--   -- verificacao (a) sem lacuna.
--
--   -- d) ALARME: a DEFAULT tem de ficar VAZIA. Vale monitorar, nao so conferir.
--   select count(*) as linhas_na_default from audit.logs_v2_default;
--   -- esperado: 0, hoje e sempre. Qualquer numero acima de zero significa que o
--   -- job parou e o mes corrente nao tem particao. Nesse caso: drenar a DEFAULT
--   -- ANTES de criar a particao que faltou, senao o create falha.
--
--   -- e) o historico continua inteiro — criterio ABSOLUTO
--   select count(*) as eventos, min(occurred_at) as mais_antigo
--     from audit.logs_v2;
--   -- esperado em 06/09/2026: 333.463 eventos (ou mais, o banco esta vivo) e
--   -- mais_antigo = 2026-03-28 13:55:43+00. Se `mais_antigo` avancar, algo
--   -- APAGOU historico — esta migration nunca apaga; parar e investigar.
--
--   -- f) nenhum job de expurgo entrou junto
--   select jobname, schedule, active, command from cron.job order by jobid;
--   -- esperado: 2 jobs — `atualizar-atraso-boletos` (inalterado) e
--   -- `audit-criar-particoes-futuras`. Nenhum comando pode citar
--   -- delete_old_logs_v2 nem run_maintenance_v2.
--
--   -- g) a primeira execucao do job, depois do dia 1
--   select jobid, status, return_message, start_time, end_time
--     from cron.job_run_details
--    where jobid = (select jobid from cron.job where jobname='audit-criar-particoes-futuras')
--    order by start_time desc limit 5;
--   -- esperado: status = 'succeeded'. Ate o dia 1 nao ha linha nenhuma, e isso
--   -- e normal — a cobertura ate 2027-12 ja foi criada pelo passo 1.
--
-- ROLLBACK
--   Reversivel por inteiro, e sem perder dado: nada aqui escreve linha.
--
--   -- 1) tirar o agendamento
--   -- select cron.unschedule('audit-criar-particoes-futuras');
--
--   -- 2) derrubar a DEFAULT — CONFIRA QUE ESTA VAZIA ANTES.
--   --    Se tiver linha, ela e o unico lugar onde aquele evento existe:
--   --    o DROP APAGA AUDITORIA. Nesse caso, mova as linhas para a particao
--   --    correta antes, em vez de derrubar.
--   -- select count(*) from audit.logs_v2_default;   -- tem de ser 0
--   -- drop table if exists audit.logs_v2_default;
--
--   -- 3) as particoes mensais vazias podem ficar: nao custam nada e voltar a
--   --    derruba-las so reabre o risco de 01/01/2027. Se ainda assim quiser,
--   --    derrube UMA A UMA e SOMENTE as vazias:
--   -- select count(*) from audit.logs_v2_2027_01;   -- tem de ser 0
--   -- drop table if exists audit.logs_v2_2027_01;
--
--   NUNCA derrube uma particao com linhas para "desfazer" esta migration: o
--   objetivo dela e o oposto — preservar o historico inteiro.
