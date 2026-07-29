# DEVELOPMENT.md

Versão: 3.0
Status: Oficial
Última atualização: 18/07/2026
Projeto: ERP Ideal

---

# Processo Oficial de Desenvolvimento

Este documento define o processo oficial para análise, implementação, validação e entrega de alterações no ERP Ideal.

Toda implementação deve seguir este fluxo.

---

# Objetivo

Garantir que toda alteração seja:

- segura;
- previsível;
- rastreável;
- compatível com a arquitetura existente;
- consistente com as regras de negócio.

---

# Princípios

Todo desenvolvimento deve seguir estes princípios:

- investigar antes de alterar;
- reutilizar antes de criar;
- preservar antes de substituir;
- implementar apenas o necessário;
- minimizar riscos de regressão.

---

# Fluxo Oficial

Toda tarefa deve seguir esta sequência:

1. Compreender o problema.
2. Localizar o fluxo oficial.
3. Identificar a causa.
4. Avaliar impactos.
5. Implementar.
6. Validar.
7. Documentar.

Nunca implemente antes de concluir a investigação.

---

# Investigação

Antes de modificar qualquer código:

- identifique os arquivos envolvidos;
- compreenda o fluxo existente;
- confirme a regra de negócio;
- localize a implementação oficial;
- identifique possíveis impactos.

Nunca implemente baseado em suposições.

---

# Implementação

Durante a implementação:

- altere apenas o necessário;
- preserve os padrões existentes;
- reutilize implementações oficiais;
- mantenha compatibilidade com os módulos existentes.

Evite alterações fora do escopo.

## Tela nova com lista ou filtro

Filtros, busca, ordenação, paginação, período e aba ficam na URL, pelo hook compartilhado `useUrlFilters` — nunca só em `useState`. Estado apenas visual (modo compacto, tela cheia, grupos recolhidos) vai para `useSessionState`. Não crie mecanismo próprio de persistência.

O padrão completo, os nomes canônicos de parâmetro e o checklist de aceite estão em [`technical/PADRAO-FILTROS-URL-NAVEGACAO.md`](./technical/PADRAO-FILTROS-URL-NAVEGACAO.md). Todas as listagens existentes já seguem esse padrão.

---

# Escopo

Cada tarefa deve resolver apenas o problema solicitado.

Não utilize uma implementação para:

- reorganizar arquitetura;
- substituir bibliotecas;
- modificar regras de negócio;
- realizar grandes refatorações;
- alterar módulos não relacionados.

---

# Validação

Antes da entrega valide:

- cenário principal;
- cenários alternativos;
- permissões;
- tratamento de erros;
- ausência de regressões;
- compatibilidade com outros módulos.

---

# Qualidade

Toda alteração deve:

- manter legibilidade;
- preservar consistência;
- respeitar os padrões do projeto;
- evitar duplicações;
- manter compatibilidade com TypeScript.

---

# Documentação

Sempre que uma alteração modificar comportamento permanente do ERP:

- atualize a documentação correspondente;
- registre decisões importantes;
- mantenha consistência entre os documentos.

---

# Entrega

Toda entrega deve informar:

## Problema

Resumo objetivo da causa identificada.

---

## Solução

Resumo da implementação realizada.

---

## Arquivos

Arquivos modificados.

---

## Validação

Testes executados.

---

## Pendências

Riscos, limitações ou pontos futuros.

---

# Quando Investigar

Realize diagnóstico separado somente quando faltar informação técnica indispensável para executar com segurança.

A necessidade costuma existir quando:

- a causa ainda não foi identificada;
- o fluxo atual está desconhecido;
- os arquivos ou serviços envolvidos não estão confirmados;
- múltiplos módulos podem possuir responsabilidades concorrentes;
- uma mudança sensível depende de evidência ainda ausente;
- o risco de regressão não pode ser delimitado.

A simples menção a banco, Supabase, Edge Function, n8n ou integração externa não exige uma etapa separada quando o comportamento, o ponto oficial e os limites já estiverem confirmados.

---

# Quando Implementar Diretamente

A implementação pode ser realizada diretamente quando:

- a causa estiver claramente identificada;
- o fluxo oficial estiver confirmado;
- o impacto for conhecido;
- não houver risco relevante para outros módulos.

---

# O que Evitar

Nunca:

- alterar código por tentativa e erro;
- criar implementações paralelas;
- inventar regras de negócio;
- esconder riscos conhecidos;
- modificar áreas fora do escopo;
- remover comportamentos existentes sem justificativa.

---

# Checklist

Antes de concluir confirme:

- problema resolvido;
- arquitetura preservada;
- regras de negócio preservadas;
- segurança preservada;
- testes executados;
- documentação atualizada.

---

# Documentação Relacionada

- PROJECT_CONTEXT.md
- AI_AGENTS.md
- SECURITY.md
- architecture/ARQUITETURA-MODULAR-ERP-IDEAL.md
- BUSINESS_RULES.md

---

# Fonte da Verdade

O processo de desenvolvimento deve sempre preservar a arquitetura oficial, as regras de negócio e a segurança do ERP.

Quando houver dúvida sobre a implementação correta, investigue antes de modificar o sistema.
