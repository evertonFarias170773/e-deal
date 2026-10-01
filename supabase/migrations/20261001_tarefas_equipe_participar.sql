-- =============================================================================
-- tarefas_equipe_participar — quem participa das Tarefas passa a ser definido
-- por perfil, pela permissao `tarefas.participar` (Perfis e Permissoes).
-- Spec: docs/superpowers/specs/2026-09-30-tarefas-equipe-design.md
-- Autorizada pelo dono em 01/10/2026 (migration da regra de "todos").
--
-- Muda SO o corpo de `tarefas_equipe__eh_da_equipe`. Essa funcao ja e a regra
-- unica usada por:
--   - RLS de tarefas_equipe (quem enxerga tarefa "para todos");
--   - tarefas_equipe__pode_ver (destinatarios, anexos e vistos);
--   - tarefas_equipe_criar (cada destinatario escolhido);
--   - trigger tarefas_equipe__guarda (quem cria; quem assume tarefa de todos);
--   - tarefas_equipe_resumo (contador e sinal de nova).
--
-- ANTES: perfil ativo com qualquer permissao.
-- AGORA: perfil ativo com `*` ou `tarefas.participar`, e e-mail que nao termina
--        em @teste.com.br (contas de teste nunca recebem nem entram em "todos").
--
-- A permissao foi marcada em todos os perfis, menos Acesso Pendente, ANTES
-- desta migration (UPDATE em public.perfis, autorizado junto). O Super
-- Administrador passa pelo `*`.
-- =============================================================================

create or replace function public.tarefas_equipe__eh_da_equipe(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.usuarios u
      join public.perfis p on p.id = u.id_perfil and p.ativo
     where u.user_id = p_user_id
       and jsonb_typeof(p.permissoes) = 'array'
       and (p.permissoes ? '*' or p.permissoes ? 'tarefas.participar')
       and lower(btrim(coalesce(u.email, ''))) not like '%@teste.com.br'
  );
$$;
