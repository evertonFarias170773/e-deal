# SECURITY.md

Versão: 3.0  
Status: Oficial  
Última atualização: 18/07/2026  
Projeto: ERP Ideal

---

# Política de Segurança

Este documento define as diretrizes de segurança para qualquer alteração realizada no ERP Ideal.

Seu objetivo é preservar a integridade dos dados, da arquitetura, das regras de negócio e da operação da empresa.

Toda alteração deve priorizar segurança, rastreabilidade e previsibilidade.

---

# Princípio Fundamental

Nenhuma alteração crítica deve ser realizada sem compreender completamente o fluxo existente.

Na dúvida:

**investigue antes de modificar.**

---

# Áreas Críticas

As seguintes áreas exigem atenção máxima:

- Supabase
- Banco de Dados
- Autenticação
- Permissões
- Clientes
- Propostas
- Produção
- Financeiro
- Boletos
- Pagamentos
- NF-e
- NFS-e
- Edge Functions
- n8n
- Integrações externas

Toda alteração nesses módulos deve considerar seus impactos sobre os demais.

---

# Banco de Dados

Alterações envolvendo:

- Schema
- Migrations
- Triggers
- RPCs
- Views
- Policies
- RLS

devem ocorrer apenas quando forem realmente necessárias e após confirmação da necessidade técnica.

Evite alterações estruturais para resolver problemas que possam ser solucionados na aplicação.

---

# Escrita de Dados

Antes de qualquer operação de escrita confirme:

- a regra de negócio;
- o fluxo oficial;
- as permissões necessárias;
- o impacto sobre outros módulos.

Nunca grave informações apenas para testar hipóteses.

---

# Supabase

Toda alteração envolvendo Supabase deve preservar:

- autenticação;
- RLS;
- Policies;
- Triggers;
- RPCs;
- Views;
- Storage;
- Edge Functions.

Nunca altere configurações sensíveis sem compreender seus impactos.

---

# Permissões

Toda operação deve respeitar:

- autenticação;
- perfil do usuário;
- empresa ativa;
- permissões administrativas;
- regras específicas do módulo.

Nunca contorne mecanismos de autorização.

---

# Fluxos Financeiros

Os processos financeiros exigem rastreabilidade completa.

Alterações envolvendo:

- cobranças;
- boletos;
- pagamentos;
- recebimentos;
- conciliação;
- notas fiscais;

devem preservar integralmente as regras existentes.

---

# Integrações

Antes de alterar:

- APIs;
- Edge Functions;
- n8n;
- gateways;
- integrações bancárias;
- integrações fiscais;

identifique todas as dependências envolvidas.

Sempre preserve contratos públicos e compatibilidade.

---

# Exclusões

Sempre que possível prefira:

- cancelamento lógico;
- inativação;
- arquivamento.

Evite exclusões físicas.

Quando houver regra específica do módulo, ela possui prioridade.

---

# Escopo

Este documento trata apenas de segurança.

Não define:

- arquitetura;
- regras de negócio;
- desenvolvimento;
- organização do projeto.

Esses assuntos possuem documentação própria.

---

# Princípios de Segurança

Sempre:

- preservar permissões;
- preservar rastreabilidade;
- preservar integridade dos dados;
- preservar compatibilidade entre módulos;
- registrar alterações relevantes.

Nunca:

- alterar banco por tentativa e erro;
- reduzir segurança para simplificar implementação;
- remover validações existentes;
- modificar controles de acesso sem necessidade comprovada.

---

# Checklist

Antes de concluir confirme:

- segurança preservada;
- permissões preservadas;
- integridade dos dados preservada;
- regras preservadas;
- integrações preservadas;
- nenhuma regressão identificada.

---

# Documentação Relacionada

- PROJECT_CONTEXT.md
- AI_AGENTS.md
- architecture/ARQUITETURA.md
- BUSINESS_RULES.md
- DEVELOPMENT.md

---

# Fonte da Verdade

Quando houver dúvida sobre segurança, permissões ou integridade dos dados, preserve sempre o comportamento existente até que a regra oficial seja confirmada.

Nunca reduza mecanismos de proteção para facilitar uma implementação.
