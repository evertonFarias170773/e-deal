-- ============================================================================
-- enderecos passa a gravar em audit.logs_v2
-- ============================================================================
-- APLICADA EM 08/10/2026, com autorizacao nominal do dono. 66.818 linhas intactas
-- (md5 6658690390c294b91f7b346374fc427e antes e depois); ACL, RLS e policy iguais.
--
-- POR QUE
--   Em 08/10/2026 a NFE-23320-001 foi autorizada com o endereco de ENTREGA do
--   pedido como destinatario: a linha PRINCIPAL do cliente 54503 tinha sido
--   regravada com o endereco de entrega pelo modal de endereco do orcamento, e
--   horas depois voltou ao endereco fiscal. A prova saiu por via indireta
--   (`propostas.cep` na auditoria de propostas): `enderecos` nao tem trigger de
--   auditoria, nao tem data de alteracao, e a unica policy da tabela (`geral`)
--   deixa qualquer usuario logado criar, alterar e apagar qualquer endereco.
--
--   O principal e o endereco que vai como destinatario na NF-e. Sem historico,
--   uma troca dessas so aparece quando a nota ja saiu errada.
--
-- O QUE MUDA
--   1. Trigger `trg_audit_enderecos`, AFTER INSERT OR DELETE OR UPDATE, FOR EACH
--      ROW, chamando `audit.log_row_changes_v2()` — identico ao de `clientes`,
--      `propostas`, `notas_servico` e das demais tabelas auditadas.
--   2. Linha em `audit.config_v2` (public, enderecos, enabled = true, sem coluna
--      ignorada: a tabela nao tem `updated_at`). Sem essa linha a funcao devolve
--      a linha sem registrar nada.
--
-- O QUE NAO MUDA
--   Nenhum dado, nenhuma policy, nenhum grant, nenhuma funcao. O trigger
--   existente `trg_preencher_dados_recebedor_endereco` e BEFORE INSERT e continua
--   rodando antes, igual; o de auditoria e AFTER e nao altera a linha gravada.
--   Nao ha backfill: o que aconteceu antes desta migration continua sem registro.
--   Quem escreve em `enderecos` (telas, portal do cliente, cadastro online) nao
--   percebe diferenca: a auditoria so acrescenta uma linha em `audit.logs_v2`.
--
-- COMO A FUNCAO REGISTRA (padrao ja existente, nao alterado aqui)
--   - grava o antes e o depois da linha e quem escreveu (usuario do token);
--   - UPDATE que nao muda nada NAO gera linha;
--   - escrita por funcao SECURITY DEFINER chamada pelo portal chega como `anon`,
--     sem usuario — limite conhecido, igual ao das outras tabelas.
--
-- VOLUME (medido em 08/10/2026)
--   66.817 enderecos; 438 criados em 30 dias (cerca de 15 por dia). A auditoria
--   inteira grava hoje cerca de 920 linhas por dia: o acrescimo e pequeno.
--   ATENCAO A PRIVACIDADE: o antes/depois guarda rua, CEP, recebedor e CPF do
--   recebedor em `audit.logs_v2`, como ja acontece com os dados de `clientes`.
--
-- TRAVAS
--   a) trigger e linha de config ainda nao existem;
--   b) depois: a contagem e o md5 das linhas de `enderecos` sao identicos (a
--      migration nao toca dados), o trigger BEFORE existente tem a mesma
--      definicao, e nenhuma linha de auditoria da tabela foi gerada.
--
-- ROLLBACK
--   drop trigger if exists trg_audit_enderecos on public.enderecos;
--   delete from audit.config_v2 where schema_name = 'public' and table_name = 'enderecos';
--   (as linhas ja gravadas em audit.logs_v2 ficam: sao historico)
-- ============================================================================

do $migracao$
declare
  v_md5_antes      text;
  v_md5_depois     text;
  v_qtd_antes      bigint;
  v_qtd_depois     bigint;
  v_trg_antes      text;
  v_trg_depois     text;
  v_audit_antes    bigint;
  v_audit_depois   bigint;
begin
  -- a) nada disto existe ainda
  if exists (select 1 from pg_trigger
              where tgrelid = 'public.enderecos'::regclass and tgname = 'trg_audit_enderecos') then
    raise exception 'trg_audit_enderecos ja existe';
  end if;
  if exists (select 1 from audit.config_v2 where schema_name = 'public' and table_name = 'enderecos') then
    raise exception 'audit.config_v2 ja tem linha para public.enderecos';
  end if;

  -- A tabela e viva (cerca de 15 inserts por dia): trava escritas so durante esta
  -- transacao, para a conferencia de antes e depois comparar a mesma coisa.
  lock table public.enderecos in share row exclusive mode;

  select count(*), md5(string_agg(md5(to_jsonb(e)::text), ',' order by e.id)) into v_qtd_antes, v_md5_antes from public.enderecos e;
  select pg_get_triggerdef(oid) into v_trg_antes
    from pg_trigger where tgrelid = 'public.enderecos'::regclass and tgname = 'trg_preencher_dados_recebedor_endereco';
  select count(*) into v_audit_antes from audit.logs_v2 where schema_name = 'public' and table_name = 'enderecos';

  -- 1. a configuracao (sem coluna ignorada: nao ha updated_at)
  insert into audit.config_v2 (schema_name, table_name, enabled, ignored_columns)
  values ('public', 'enderecos', true, array[]::text[]);

  -- 2. o trigger (o mesmo das outras tabelas auditadas)
  create trigger trg_audit_enderecos
    after insert or delete or update on public.enderecos
    for each row execute function audit.log_row_changes_v2();

  -- b) conferencias
  select count(*), md5(string_agg(md5(to_jsonb(e)::text), ',' order by e.id)) into v_qtd_depois, v_md5_depois from public.enderecos e;
  if v_qtd_depois is distinct from v_qtd_antes or v_md5_depois is distinct from v_md5_antes then
    raise exception 'as linhas de enderecos mudaram (% / % -> % / %)', v_qtd_antes, v_md5_antes, v_qtd_depois, v_md5_depois;
  end if;

  select pg_get_triggerdef(oid) into v_trg_depois
    from pg_trigger where tgrelid = 'public.enderecos'::regclass and tgname = 'trg_preencher_dados_recebedor_endereco';
  if v_trg_depois is distinct from v_trg_antes then
    raise exception 'o trigger trg_preencher_dados_recebedor_endereco mudou';
  end if;

  select count(*) into v_audit_depois from audit.logs_v2 where schema_name = 'public' and table_name = 'enderecos';
  if v_audit_depois is distinct from v_audit_antes then
    raise exception 'a migration gerou linha de auditoria (% -> %)', v_audit_antes, v_audit_depois;
  end if;

  if not exists (
    select 1 from pg_trigger t
     where t.tgrelid = 'public.enderecos'::regclass and t.tgname = 'trg_audit_enderecos'
       and t.tgfoid = 'audit.log_row_changes_v2()'::regprocedure
       and (t.tgtype & 2) = 0          -- AFTER
       and (t.tgtype & 1) = 1          -- FOR EACH ROW
       and (t.tgtype & 28) = 28        -- INSERT + DELETE + UPDATE
       and t.tgenabled = 'O'
  ) then
    raise exception 'trg_audit_enderecos nao ficou como esperado';
  end if;

  raise notice 'ok: auditoria ligada em enderecos; % linhas intactas (md5 %)', v_qtd_depois, v_md5_depois;
end
$migracao$;
