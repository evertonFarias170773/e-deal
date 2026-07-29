# ARQUITETURA-MODULAR-ERP-IDEAL.md

Versão: 3.0
Status: Oficial
Última atualização: 18/07/2026
Projeto: ERP Ideal

---

# Arquitetura Modular do ERP Ideal

Este documento define a arquitetura oficial do ERP Ideal.

Toda nova funcionalidade deve respeitar esta organização.

---

# Objetivo

Organizar o ERP por módulos independentes, facilitando:

- manutenção;
- evolução;
- reutilização;
- escalabilidade;
- rastreabilidade.

Cada módulo possui responsabilidades bem definidas e deve evoluir de forma consistente com o restante do sistema.

---

# Princípios Arquiteturais

A arquitetura do ERP segue os seguintes princípios:

- uma única responsabilidade para cada módulo;
- uma única implementação oficial para cada fluxo;
- reutilização antes de criação;
- baixo acoplamento;
- alta coesão;
- evolução incremental.

Nunca criar arquitetura paralela.

---

# Organização Geral

```
src/

app/
features/
components/
hooks/
services/
lib/
types/
constants/
styles/
```

Cada diretório possui uma responsabilidade específica.

---

# src/app

Responsável apenas por:

- rotas;
- layouts;
- páginas.

Não concentrar regras de negócio.

---

# src/features

É o núcleo funcional do ERP.

Cada módulo deve concentrar:

- componentes;
- hooks;
- services;
- tipos;
- lógica específica.

Sempre priorize alterações dentro do próprio módulo.

---

# components

Componentes reutilizáveis.

Não implementar regras de negócio.

---

# hooks

Hooks reutilizáveis.

Evite duplicações.

Hooks compartilhados em uso, obrigatórios em telas novas com lista ou filtro:

| Arquivo | Papel |
|---|---|
| `src/hooks/useUrlFilters.ts` | Estado funcional da tela na URL: filtros, busca, ordenação, paginação, período e aba |
| `src/hooks/useDebouncedValue.ts` | `useDebouncedInput`, para o campo de busca responder por tecla e gravar na URL depois da pausa |
| `src/hooks/useSessionState.ts` | Preferência visual na sessão (modo compacto, tela cheia, grupos recolhidos), fora da URL |

A camada de codecs que sustenta o primeiro fica em `src/lib/url-state.ts`, sem React. Padrão completo em `../technical/PADRAO-FILTROS-URL-NAVEGACAO.md`.

---

# services

Responsáveis pela comunicação com:

- Supabase;
- APIs;
- Edge Functions;
- integrações externas.

---

# lib

Funções utilitárias compartilhadas.

Não armazenar regras específicas do ERP.

---

# constants

Centraliza constantes compartilhadas.

A navegação oficial permanece em:

```
src/constants/navigation.ts
```

---

# Organização dos Módulos

Cada módulo deve permanecer independente.

Compartilhe código apenas quando houver reutilização real.

Nunca copie implementação entre módulos.

---

# Fontes Oficiais

## Clientes

public.clientes

---

## Propostas

public.propostas

---

## Contas a Receber

public.boletos

---

## Conferência de Pagamentos

public.pagamentos_v2

Nunca confundir:

- boletos;
- pagamentos.

Cada tabela possui responsabilidades próprias.

---

# Inteligência

O Maestro utiliza arquitetura V2.

Seu núcleo é baseado em:

- Router Semântico;
- ferramentas seguras;
- documentação oficial;
- permissões do ERP.

A arquitetura legada permanece apenas para compatibilidade quando necessário.

---

# Evolução da Arquitetura

Toda nova implementação deve:

- reutilizar módulos existentes;
- preservar padrões;
- evitar duplicações;
- minimizar impacto.

Arquitetura é evolução contínua.

Nunca reconstrução.

---

# Escopo

Este documento define apenas a arquitetura do ERP.

Não define:

- regras de negócio;
- segurança;
- desenvolvimento;
- permissões.

Esses assuntos possuem documentação específica.

---

# Documentação Relacionada

- PROJECT_CONTEXT.md
- AI_AGENTS.md
- SECURITY.md
- BUSINESS_RULES.md
- DEVELOPMENT.md

---

# Fonte da Verdade

Toda decisão estrutural deve seguir esta arquitetura.

Quando houver dúvida entre duas implementações, considere sempre o fluxo oficial já existente antes de criar uma nova solução.
