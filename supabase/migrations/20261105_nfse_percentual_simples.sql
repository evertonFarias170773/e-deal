-- NFS-e, Lei 12.741 (05/11/2026): percentual aproximado dos tributos do Simples
-- Nacional, por empresa e por mes de vigencia.
--
-- POR QUE
--   O no "Preparar Body Focus NFS-e" do n8n mandava 15.00 fixo em
--   `percentual_total_tributos_simples_nacional` (tag pTotTribSN) para as tres
--   empresas. O contador: as tres sao EPP do Simples, ISS dentro do DAS, e o
--   percentual muda por empresa e por mes (Biro: 15,2% em outubro/2026).
--
-- O QUE FAZ
--   1. Tabela `empresas_percentual_simples`: uma linha por empresa e mes
--      (`competencia` = dia 1 do mes), percentual de 0,01 a 99,99.
--   2. Leitura para `authenticated` (a janela da NFS-e e a rota de emissao leem
--      com o JWT do usuario); escrita SO por service_role, pela rota
--      /api/configuracoes/percentual-simples, que confere a permissao.
--   3. Auditoria igual a de `notas_servico` (audit.log_row_changes_v2): a
--      correcao de um mes fica registrada com o valor anterior.
--   4. Cadastro inicial autorizado pelo dono: Biro (empresa 2) outubro e
--      novembro/2026 com 15,20. Novembro e PROVISORIO: o financeiro corrige na
--      tela quando o contador mandar o numero.
--
-- QUEM USA
--   A rota /api/fiscal/emitir-nfse le o percentual da empresa emissora no mes da
--   emissao (horario de Brasilia), recusa a emissao sem ele e o manda ao n8n no
--   corpo do webhook. A janela "NFS-e · Pedido" mostra e avisa.
--
-- NAO MEXE em regime, ISSQN, retencao nem IBS/CBS.

create table public.empresas_percentual_simples (
  id bigint generated always as identity primary key,
  id_empresa bigint not null references public.empresas(id),
  competencia date not null,
  percentual numeric(5,2) not null,
  observacao text,
  criado_por uuid,
  criado_por_nome text,
  created_at timestamptz not null default now(),
  atualizado_por uuid,
  atualizado_por_nome text,
  updated_at timestamptz not null default now(),
  constraint empresas_percentual_simples_competencia_dia_1
    check (competencia = date_trunc('month', competencia)::date),
  constraint empresas_percentual_simples_percentual_faixa
    check (percentual > 0 and percentual < 100),
  constraint empresas_percentual_simples_empresa_mes_unico
    unique (id_empresa, competencia)
);

comment on table public.empresas_percentual_simples is
  'Percentual aproximado dos tributos do Simples Nacional (Lei 12.741, tag pTotTribSN da NFS-e) por empresa e mes de vigencia. Escrita so pela rota /api/configuracoes/percentual-simples (service_role).';
comment on column public.empresas_percentual_simples.competencia is 'Mes de vigencia: sempre o dia 1 do mes.';
comment on column public.empresas_percentual_simples.percentual is 'Percentual, ex.: 15.20 para 15,2%.';

alter table public.empresas_percentual_simples enable row level security;

-- Tabela nova em public nasce com ALL para anon/authenticated (default
-- privileges): fecha tudo e devolve so a leitura.
revoke all on table public.empresas_percentual_simples from anon, authenticated;
grant select on table public.empresas_percentual_simples to authenticated;
grant select on table public.empresas_percentual_simples to supabase_read_only_user;
grant all on table public.empresas_percentual_simples to service_role;

create policy empresas_percentual_simples_leitura
  on public.empresas_percentual_simples
  for select to authenticated
  using (true);

create trigger trg_audit_empresas_percentual_simples
  after insert or delete or update on public.empresas_percentual_simples
  for each row execute function audit.log_row_changes_v2();

insert into public.empresas_percentual_simples (id_empresa, competencia, percentual, observacao, criado_por_nome, atualizado_por_nome)
values
  (2, date '2026-10-01', 15.20, 'Contador: 15,2% em outubro/2026.', 'Cadastro inicial (migration)', 'Cadastro inicial (migration)'),
  (2, date '2026-11-01', 15.20, 'PROVISORIO: repete outubro ate o contador mandar o numero de novembro.', 'Cadastro inicial (migration)', 'Cadastro inicial (migration)');

-- ROLLBACK (codigo primeiro: a rota de emissao recusa sem a tabela)
--   drop table public.empresas_percentual_simples;
