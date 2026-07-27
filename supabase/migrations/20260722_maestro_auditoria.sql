-- ============================================================================
-- 20260722_maestro_auditoria.sql
--
-- Auditoria de ações do Maestro (autoria, resultado e resumo do payload).
--
-- ⚠️ MIGRATION VERSIONADA E **NÃO APLICADA**.
--    Não executar em produção sem autorização explícita.
--    O código correspondente (maestro-audit.server.ts) grava nesta tabela
--    somente quando MAESTRO_AUDIT_DB_ENABLED=true E esta migration aplicada.
--    Enquanto isso, a auditoria mínima sai como log estruturado no servidor.
--
-- Idempotente: pode ser executada mais de uma vez sem erro
-- (tabela/índices com IF NOT EXISTS; policies guardadas por pg_policies).
--
-- Segurança:
--   - RLS habilitada; INSERT apenas do próprio usuário (user_id = auth.uid());
--   - SELECT apenas das próprias ações (leitura administrativa ampla, se
--     necessária, deve ser feita por canal administrativo próprio — não aqui);
--   - sem UPDATE/DELETE: trilha imutável;
--   - payload é um RESUMO não sensível (ids, quantidades, valores unitários) —
--     nunca tokens, linha digitável, PIX ou payloads de integrações.
-- ============================================================================

create table if not exists public.maestro_acoes (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid not null default auth.uid(),
  -- Nome curto da ação (ex.: 'salvar_cotacao_como_proposta')
  acao text not null,
  resultado text not null check (resultado in ('sucesso', 'rejeitado', 'erro')),
  id_cliente bigint,
  id_int bigint,
  -- Motivo de rejeição / mensagem de erro (curto, legível)
  detalhe text,
  -- Resumo estruturado NÃO sensível
  payload jsonb
);

comment on table public.maestro_acoes is
  'Trilha de auditoria imutável das ações executadas via Maestro (quem, o quê, resultado).';

create index if not exists idx_maestro_acoes_user_created
  on public.maestro_acoes (user_id, created_at desc);

create index if not exists idx_maestro_acoes_id_int
  on public.maestro_acoes (id_int)
  where id_int is not null;

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.maestro_acoes enable row level security;

-- Policies criadas somente se ainda não existirem (CREATE POLICY não aceita
-- IF NOT EXISTS — o guard via pg_policies torna a migration re-executável).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'maestro_acoes'
      and policyname = 'maestro_acoes_insert'
  ) then
    create policy maestro_acoes_insert on public.maestro_acoes
      for insert to authenticated
      with check (user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'maestro_acoes'
      and policyname = 'maestro_acoes_select'
  ) then
    create policy maestro_acoes_select on public.maestro_acoes
      for select to authenticated
      using (user_id = auth.uid());
  end if;
end $$;

-- Sem policies de UPDATE/DELETE: a trilha é imutável para o client.
