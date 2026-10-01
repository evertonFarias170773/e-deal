-- =============================================================================
-- tarefas_equipe_prioridade — Normal, Alta e Urgente, escolhida ao criar.
-- Spec: docs/superpowers/specs/2026-09-30-tarefas-equipe-design.md (etapa 1)
-- Autorizada pelo dono em 01/10/2026 (migrations da etapa 1).
--
-- `prioridade_ordem` existe so para ordenar no PostgREST (texto nao ordena
-- certo). A imutabilidade da prioridade fica na trigger, refeita na migration
-- tarefas_equipe_destinatarios.
-- =============================================================================

alter table public.tarefas_equipe
  add column prioridade text not null default 'NORMAL'
    constraint tarefas_equipe_prioridade_chk check (prioridade in ('NORMAL', 'ALTA', 'URGENTE'));

alter table public.tarefas_equipe
  add column prioridade_ordem smallint generated always as (
    case prioridade when 'URGENTE' then 3 when 'ALTA' then 2 else 1 end
  ) stored;

create index tarefas_equipe_fila_idx on public.tarefas_equipe (prioridade_ordem desc, created_at);
