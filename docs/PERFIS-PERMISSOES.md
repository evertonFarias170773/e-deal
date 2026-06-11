# Módulo de Perfis e Permissões — Documentação e Transição Técnica

Esta documentação consolida o estado atual do módulo de Perfis e Permissões do ERP Ideal, detalhando as implementações das Fases 1 a 4.2, limitações atuais, riscos conhecidos e diretrizes para as próximas etapas.

---

## 1. Situação Atual e Entregas por Fase

O módulo foi estruturado e desenvolvido de forma incremental para garantir a segurança operacional e evitar regressões no ERP de produção. Abaixo está o status detalhado de cada fase:

### ✅ Fase 1 — Estrutura e Autenticação
* **O que foi concluído:**
  * Saneamento e padronização da tabela `public.perfis` no Supabase como o catálogo oficial de acessos do sistema.
  * Remoção de colunas legadas obsoletas e simplificação da tabela para conter as 8 colunas oficiais (`id`, `slug`, `nome`, `descricao`, `permissoes`, `ativo`, `created_at`, `updated_at`).
  * Adição da FK `id_perfil` na tabela `public.usuarios` vinculando cada usuário ao seu perfil correspondente.
  * Implementação de enriquecimento de sessão assíncrono pós-login no `AuthProvider.tsx`, buscando as permissões e normalizando o setor do usuário em tempo real.
  * Desenvolvimento de helpers frontend em `usuarios.service.ts` (`hasPermissao`, `hasAnyPermissao`, `hasAllPermissoes`) com suporte nativo ao wildcard `"*"` do perfil `super_admin`.
  * Criação de rota de diagnóstico `/minha-conta` para que operadores auditem seus metadados de acesso de forma visual.
* **Status de Homologação:** Homologado e ativo. O carregamento de sessão e fallbacks legados funcionam perfeitamente.

### ✅ Fase 2 — Gestão e Vínculo de Usuários
* **O que foi concluído:**
  * Criação da rota `/configuracoes/usuarios` contendo a listagem administrativa de operadores.
  * Implementação do modal `AlterarPerfilModal` para atribuição rápida de perfil.
  * Restrição de salvamento exclusiva para a coluna `id_perfil` (whitelist de campos).
  * Diálogo de confirmação com representação clara de transição ("Perfil Atual -> Perfil Futuro").
* **Status de Homologação:** Homologado e funcional. Admins conseguem alterar perfis operacionais com auditoria em console log.

### ✅ Fase 3 — UX & Bloqueios Visuais no Menu
* **O que foi concluído:**
  * Ocultação reativa do menu lateral de "Configurações" (desktop e mobile) para operadores sem privilégios (`admin.usuarios.view` ou `admin.usuarios.edit`).
  * Proteção de acesso direto via rotas no Next.js (redirecionamento automático para tela de Acesso Restrito).
  * Ocultação limpa da coluna "Ações" e dos botões de alteração de perfil de modo a manter o alinhamento perfeito de layout em desktop/mobile.
* **Status de Homologação:** Homologado e testado. Usuários não autorizados são bloqueados via URL e não visualizam o menu.

### ✅ Fase 4.1 — Permissões de Negócio (Módulo Orçamentos)
* **O que foi concluído:**
  * Bloqueio de 3 ações comerciais críticas no frontend com base em novas permissões granulares:
    1. **Cancelamento de Proposta:** Ocultado completamente em listas, detalhes, atalhos de teclado e menus de ação se o operador não tiver `propostas.cancelar` (ou isAdmin/isSuperAdmin).
    2. **Alteração de Vendedor:** O campo no formulário permanece legível, mas é renderizado como somente leitura. Exige `propostas.alterar_vendedor` (ou isAdmin/isGerente/isSuperAdmin).
    3. **Desconto Geral:** O campo exibe um aviso visual e é bloqueado caso o operador não tenha `propostas.desconto_geral` (ou isAdmin/isGerente/isSuperAdmin).
  * Manutenção do fallback legado ativo para vendedores comuns criarem e editarem itens permitidos.
* **Status de Homologação:** Homologado. Restrições visuais e operacionais aplicadas corretamente.

### ✅ Fase 4.2 — Painel Administrativo de Permissões (Editor de Perfis)
* **O que foi concluído:**
  * Rota `/configuracoes/perfis` com interface em duas colunas (Perfís ativos na esquerda, Editor de Permissões na direita).
  * Acordeões colapsáveis agrupando as permissões do catálogo por módulo (Usuários, Orçamentos, Cobranças, Financeiro, Fiscal, Cadastros).
  * Bloqueios de segurança rígidos implementados no cliente:
    * **Trava do Super Admin:** O perfil `super_admin` possui checkboxes permanentemente desabilitados com o array fixado em `["*"]`.
    * **Trava do Wildcard:** Impedido o uso do curinga `"*"` em qualquer outro perfil do catálogo.
    * **Trava de Auto-Privação:** O sistema bloqueia a desmarcação da permissão `admin.usuarios.edit` caso o perfil sendo editado corresponda ao perfil ativo do operador conectado.
    * **Edição Restrita:** Ação de salvar limitada exclusivamente ao JSONB da coluna `permissoes` em `public.perfis` (bloqueada edição de nome, slug ou descrição nesta etapa).
    * **Auditoria de Mudança (Diff-check):** Modal `ConfirmacaoDiffModal` exibindo um comparativo legível das permissões adicionadas (`+` em verde) e removidas (`-` em vermelho) antes da gravação.
* **Status de Homologação:** Interface visual homologada. O salvamento no banco de dados falha de forma controlada por limitações de RLS (veja seção 2).

---

## 2. Limitações Atuais do Painel de Permissões

### 🔒 Restrição de Escrita (RLS da tabela public.perfis)
* A tabela `public.perfis` possui segurança de linha ativada (`rowsecurity = true`) no Supabase.
* Atualmente, existe apenas a política `perfis_select_authenticated` (SELECT) para usuários autenticados.
* **Não existe política de UPDATE** na tabela `public.perfis` liberada no banco de dados.
* **Consequência:** Qualquer tentativa de salvar alterações de permissões na UI administrativa resultará em erro de RLS (PostgREST 401/403). O frontend está preparado para interceptar essa falha e exibe um Toast informando que a gravação falhou por restrição de segurança do banco de dados.

---

## 3. Próxima Fase Recomendada

### 🚀 Fase 5 — RLS Operacional de Tabelas Comerciais e Políticas de Escrita
Para avançar na maturidade de segurança, o sistema deve migrar a proteção do frontend para a camada de persistência de dados.

#### Dependências Técnicas:
1. **Criação de Política de UPDATE para `public.perfis`:**
   * Adicionar política controlada via SQL que permita apenas aos usuários administradores com perfil contendo `admin.usuarios.edit` realizar o `UPDATE` das permissões.
2. **Definição de RLS Granular em Propostas e Clientes:**
   * Associar as permissões resolvidas no frontend a políticas de escrita no banco via funções auxiliares do PostgreSQL.

#### Riscos Conhecidos:
* ⚠️ **Travamento Operacional Crítico:** Como o ERP opera em ambiente real de produção, políticas de RLS excessivamente restritivas ou mal testadas podem bloquear o salvamento de propostas de vendedores ou baixas de pagamentos do financeiro, interrompendo as vendas do grupo.
* ⚠️ **Colisão com Integrações Legadas:** Sistemas externos como n8n ou fluxos do FlutterFlow que utilizam APIs diretas sem passar pela sessão do usuário autenticado no app podem falhar se as políticas de RLS não previrem fallbacks para chaves de serviço ou conexões internas.
* ⚠️ **Auto-Privação de Acesso:** RLS incorreta na tabela de perfis pode bloquear o próprio administrador de reverter suas alterações, exigindo acesso manual via console SQL do Supabase.

---

## 4. Resumo de Correspondência do Menu Lateral (Sidebar)

Todos os cards disponíveis no painel principal (**Hub de Configurações**) possuem correspondência exata no submenu expansível/retrátil da Sidebar, mantendo o padrão visual e de responsividade:

| Card do Hub (Configurações) | Submenu Lateral (Sidebar) | Rota correspondente | Status de Integração |
| :--- | :--- | :--- | :--- |
| **Usuários e Perfis** | Usuários e Perfis | `/configuracoes/usuarios` | Ativo |
| **Perfis e Permissões** | Perfis e Permissões | `/configuracoes/perfis` | Ativo (UI de Edição) |
| **Empresas** | Empresas | `/configuracoes/empresas` | Em breve (Disabled) |
| **Integrações** | Integrações | `/configuracoes/integracoes` | Em breve (Disabled) |
| **Faturamento e Cobranças** | Faturamento e Cobranças | `/configuracoes/faturamento` | Em breve (Disabled) |
| **Parâmetros Fiscais** | Parâmetros Fiscais | `/configuracoes/fiscal` | Em breve (Disabled) |
