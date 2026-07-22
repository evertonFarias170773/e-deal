-- ============================================================================
-- 20260722_maestro_conversas.sql
--
-- Persistência de conversas e rascunhos do Maestro.
--
-- ⚠️ MIGRATION VERSIONADA E **NÃO APLICADA**.
--    Não executar em produção sem autorização explícita.
--    O código correspondente (maestro-persistence.server.ts) permanece
--    desativado até MAESTRO_PERSISTENCE_ENABLED=true E esta migration aplicada.
--
-- Segurança:
--   - RLS habilitada nas duas tabelas;
--   - isolamento por usuário: user_id = auth.uid();
--   - sem policies de DELETE (histórico imutável; encerrar = flag lógica);
--   - nenhum campo sensível (linha digitável, PIX, tokens) é gravado —
--     o conteúdo já passa pela redação de maestro-recent-turns.ts.
-- ============================================================================

-- ── Tabela de conversas ──────────────────────────────────────────────────────
create table if not exists public.maestro_conversas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  titulo text,
  -- Rascunho da conversa (v2ContextJson) para retomada após reload
  contexto_json jsonb,
  encerrada boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.maestro_conversas is
  'Conversas do Maestro por usuário. contexto_json guarda o rascunho (cotação em andamento) para retomada.';

create index if not exists idx_maestro_conversas_user_updated
  on public.maestro_conversas (user_id, updated_at desc);

-- ── Tabela de mensagens ──────────────────────────────────────────────────────
create table if not exists public.maestro_mensagens (
  id bigint generated always as identity primary key,
  conversa_id uuid not null references public.maestro_conversas (id) on delete cascade,
  user_id uuid not null default auth.uid(),
  role text not null check (role in ('user', 'maestro')),
  content text not null,
  created_at timestamptz not null default now()
);

comment on table public.maestro_mensagens is
  'Mensagens das conversas do Maestro (user/maestro), isoladas por usuário via RLS.';

create index if not exists idx_maestro_mensagens_conversa
  on public.maestro_mensagens (conversa_id, created_at);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.maestro_conversas enable row level security;
alter table public.maestro_mensagens enable row level security;

-- Conversas: cada usuário vê e mantém apenas as suas
create policy maestro_conversas_select on public.maestro_conversas
  for select to authenticated
  using (user_id = auth.uid());

create policy maestro_conversas_insert on public.maestro_conversas
  for insert to authenticated
  with check (user_id = auth.uid());

create policy maestro_conversas_update on public.maestro_conversas
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Mensagens: cada usuário vê e insere apenas as suas
create policy maestro_mensagens_select on public.maestro_mensagens
  for select to authenticated
  using (user_id = auth.uid());

create policy maestro_mensagens_insert on public.maestro_mensagens
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.maestro_conversas c
      where c.id = conversa_id and c.user_id = auth.uid()
    )
  );

-- Sem policy de DELETE: histórico não é apagável pelo client.
