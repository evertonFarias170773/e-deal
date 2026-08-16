# DOCUMENTATION_INDEX.md

Versão: 3.3  
Status: Oficial  
Última atualização: 29/07/2026  
Projeto: Vibe

---

# Índice da Documentação Oficial do Vibe

Este arquivo orienta a leitura da pasta `docs`.

A documentação deve ser usada junto com o código atual. Documentos históricos, roadmaps e scripts SQL não substituem a implementação vigente nem autorizam mudanças sensíveis.

---

# 1. Ordem de Leitura

1. [`README.md`](./README.md)
2. [`PROJECT_CONTEXT.md`](./PROJECT_CONTEXT.md)
3. [`AI_AGENTS.md`](./AI_AGENTS.md)
4. [`SECURITY.md`](./SECURITY.md)
5. [`BUSINESS_RULES.md`](./BUSINESS_RULES.md)
6. [`architecture/ARQUITETURA-MODULAR-ERP-IDEAL.md`](./architecture/ARQUITETURA-MODULAR-ERP-IDEAL.md)
7. [`DEVELOPMENT.md`](./DEVELOPMENT.md)

Depois, consulte somente os documentos do domínio da tarefa.

---

# 2. Documentação Base

## [`README.md`](./README.md)

Ponto inicial da pasta `docs`.

## [`PROJECT_CONTEXT.md`](./PROJECT_CONTEXT.md)

Contexto geral, stack, módulos e fontes principais.

## [`AI_AGENTS.md`](./AI_AGENTS.md)

Regras para Cursor, Antigravity e outros agentes.

## [`SECURITY.md`](./SECURITY.md)

Política geral de segurança.

## [`BUSINESS_RULES.md`](./BUSINESS_RULES.md)

Regras permanentes de negócio.

## [`DEVELOPMENT.md`](./DEVELOPMENT.md)

Processo de diagnóstico, implementação, validação e entrega.

---

# 3. Arquitetura

## [`architecture/ARQUITETURA-MODULAR-ERP-IDEAL.md`](./architecture/ARQUITETURA-MODULAR-ERP-IDEAL.md)

Fonte principal da arquitetura modular.

## [`architecture/ARQUITETURA.md`](./architecture/ARQUITETURA.md)

Referência histórica mantida por compatibilidade.

---

# 4. Regras de Negócio por Módulo

## [`business/FLUXO-OFICIAL-STATUS-PROPOSTAS.md`](./business/FLUXO-OFICIAL-STATUS-PROPOSTAS.md)

Status global, transições e separação de `status_interno` e `is_prd_aprovado`.

## [`business/CHECKOUT-PAGAMENTOS.md`](./business/CHECKOUT-PAGAMENTOS.md)

Criação e acompanhamento de cobranças e pagamentos.

## [`business/CONTA-CORRENTE-CREDITO.md`](./business/CONTA-CORRENTE-CREDITO.md)

Conta Corrente do cliente e pagamento por E-Crédito: regras oficiais, implementações confirmadas, pendências de homologação e falhas abertas.

## [`business/CONTA-CORRENTE-FASE-1-PREPARACAO.md`](./business/CONTA-CORRENTE-FASE-1-PREPARACAO.md)

Reformulação da Conta Corrente (Pendências Financeiras) — Fase 1 **preparada, não aplicada**: estrutura de banco, RPCs, constraints e pré-voo. Não representa capacidade disponível.

## [`business/CANCELAMENTO-COBRANCAS.md`](./business/CANCELAMENTO-COBRANCAS.md)

Cancelamento, exclusão permitida, integração externa e sincronização.

## [`business/PEDIDOS-PRODUCAO.md`](./business/PEDIDOS-PRODUCAO.md)

Boletim/OS, modelos, artes e limites da Produção.

## [`business/CHAT-INTERNO.md`](./business/CHAT-INTERNO.md)

Timeline, anexos, menções, notificações e pendências.

## [`business/EXPEDICAO.md`](./business/EXPEDICAO.md)

Painel do funil APROVADO→ENTREGUE, fontes de dados, transições, etiquetas, Correios, rastreio n8n e permissões.

---

# 5. Maestro

Um documento oficial por tema. Reorganizado em 26/07/2026; documentos
anteriores em `docs/_archive/maestro/`.

## [`maestro/STATUS-MAESTRO-AGENT-LOOP.md`](./maestro/STATUS-MAESTRO-AGENT-LOOP.md)

**Fonte única do estado atual**: arquitetura do agent loop V2, catálogo de
tools de leitura, flags, segurança operacional, infra aplicada e roadmap.

## [`maestro/MATRIZ-PERMISSOES-ESCRITA-MAESTRO.md`](./maestro/MATRIZ-PERMISSOES-ESCRITA-MAESTRO.md)

**Fonte da escrita assistida (Trilha B)** e dos princípios permanentes de
negócio (§1.0): faturamento oficial em `pagamentos_v2` por `data_confirmacao`,
propostas como pipeline, `id_empresa` em toda consulta financeira, visão
consolidada primeiro. Nenhuma operação de escrita liberada.

## [`maestro/MAESTRO-KNOWLEDGE-BASE.md`](./maestro/MAESTRO-KNOWLEDGE-BASE.md)

Entidades, relações, fontes e regras canônicas (semântica).

## [`maestro/MAESTRO-SEGURANCA-E-GOVERNANCA.md`](./maestro/MAESTRO-SEGURANCA-E-GOVERNANCA.md)

Governança, classificação de operações e proteção entre canais. Para escrita,
a Matriz de Permissões de Escrita prevalece.

## [`maestro/MAESTRO-PROMPT-BASE.md`](./maestro/MAESTRO-PROMPT-BASE.md)

Identidade e comportamento conversacional. Carregado em RUNTIME pelo motor —
não mover nem renomear.

## [`maestro/MAESTRO-VISAO-PRODUTO.md`](./maestro/MAESTRO-VISAO-PRODUTO.md)

Visão de produto e evolução do Maestro.

---

# 6. Segurança Técnica e Interface

## [`technical/MATRIZ-SEGURANCA-ESCRITA-SUPABASE.md`](./technical/MATRIZ-SEGURANCA-ESCRITA-SUPABASE.md)

Fonte específica para operações de leitura e escrita.

## [`technical/PERFIS-PERMISSOES.md`](./technical/PERFIS-PERMISSOES.md)

Perfis, permissões, escopos e estado de persistência.

## [`technical/PADROES-UX-UI.md`](./technical/PADROES-UX-UI.md)

Padrões visuais, responsividade, acessibilidade e componentes.

## [`technical/PADRAO-FILTROS-URL-NAVEGACAO.md`](./technical/PADRAO-FILTROS-URL-NAVEGACAO.md)

Persistência de filtros, busca, período, paginação e abas na URL, e estado visual na sessão. Obrigatório em listas novas. Traz o estado final da migração das telas existentes.

---

# 7. Histórico

Os arquivos abaixo registram decisões, fases e pendências antigas.

Eles não autorizam implementação por si só.

## [`history/CHANGELOG.md`](./history/CHANGELOG.md)

Alterações registradas ao longo do projeto.

## [`history/DECISOES-TECNICAS.md`](./history/DECISOES-TECNICAS.md)

Decisões e justificativas históricas.

## [`history/STATUS-INTERNO-PROPOSTAS.md`](./history/STATUS-INTERNO-PROPOSTAS.md)

Estratégia histórica de centralização dos status.

## [`history/PROXIMOS-PASSOS.md`](./history/PROXIMOS-PASSOS.md)

Backlog acumulado que precisa ser reconfirmado antes de execução.

## [`history/MODULOS-IMPLEMENTADOS.md`](./history/MODULOS-IMPLEMENTADOS.md)

Inventário acumulado de fases e módulos.

## [`history/IMPLEMENTACAO-PROPOSTAS-PAGAS.md`](./history/IMPLEMENTACAO-PROPOSTAS-PAGAS.md)

Notas de desenvolvimento da edição de proposta paga. Autodeclara homologação não confirmada por auditoria posterior; consulte `business/CONTA-CORRENTE-CREDITO.md` para o estado vigente.

---

# 8. Migrations

## [`migrations/README.md`](./migrations/README.md)

Regras para interpretar os scripts SQL armazenados na documentação.

Os arquivos em `docs/migrations` são históricos ou propostas.

A presença de um script não comprova aplicação nem constitui autorização de execução.

---

# 9. Documento Principal por Tipo de Tarefa

| Tarefa | Fonte principal |
|---|---|
| Arquitetura | `ARQUITETURA-MODULAR-ERP-IDEAL.md` |
| Processo de desenvolvimento | `DEVELOPMENT.md` |
| Regra de negócio | `BUSINESS_RULES.md` |
| Segurança geral | `SECURITY.md` |
| Escrita no Supabase | `MATRIZ-SEGURANCA-ESCRITA-SUPABASE.md` |
| Perfis e acesso | `PERFIS-PERMISSOES.md` |
| Interface | `PADROES-UX-UI.md` |
| Filtros e estado de lista na URL | `PADRAO-FILTROS-URL-NAVEGACAO.md` |
| Status de proposta | `FLUXO-OFICIAL-STATUS-PROPOSTAS.md` |
| Cobrança e pagamento | `CHECKOUT-PAGAMENTOS.md` |
| Conta Corrente e E-Crédito | `CONTA-CORRENTE-CREDITO.md` |
| Cancelamento financeiro | `CANCELAMENTO-COBRANCAS.md` |
| Produção | `PEDIDOS-PRODUCAO.md` |
| Chat e pendências | `CHAT-INTERNO.md` |
| Maestro — estado atual e leitura | `maestro/STATUS-MAESTRO-AGENT-LOOP.md` |
| Maestro — escrita e princípios de negócio | `maestro/MATRIZ-PERMISSOES-ESCRITA-MAESTRO.md` |
| Maestro — semântica canônica | `maestro/MAESTRO-KNOWLEDGE-BASE.md` |
| SQL histórico | `migrations/README.md` |

---

# 10. Hierarquia em Caso de Conflito

Use a fonte específica do domínio:

1. `SECURITY.md` e a Matriz para acesso e escrita;
2. `BUSINESS_RULES.md` para semântica;
3. Arquitetura Modular para responsabilidades do código;
4. documento oficial do módulo;
5. documento de status para disponibilidade;
6. documentos históricos somente como contexto.

Quando dois documentos oficiais divergirem:

- não escolher silenciosamente;
- verificar o código e os dados;
- identificar o documento desatualizado;
- corrigir a inconsistência;
- não ampliar permissões enquanto houver dúvida.

---

# 11. Fluxo de Consulta

```text
entender o problema
↓
consultar regras de negócio
↓
consultar segurança e Matriz
↓
consultar arquitetura
↓
consultar documento do módulo
↓
investigar código e dados atuais
↓
implementar no ponto oficial
↓
validar regressões
↓
atualizar documentação
```

---

# 12. Convenções

- arquivos base ficam em `docs`;
- arquitetura fica em `docs/architecture`;
- regras de módulos ficam em `docs/business`;
- Maestro fica em `docs/maestro`;
- segurança técnica e UX ficam em `docs/technical`;
- histórico fica em `docs/history`;
- scripts documentais ficam em `docs/migrations`;
- links internos devem ser relativos;
- arquivos devem usar UTF-8;
- documentos históricos precisam ser identificados como históricos.

---

# 13. Arquivo Histórico Desativado

A pasta:

```text
docs/_archive/
```

contém documentos legados preservados apenas para rastreabilidade.

Regras:

- não faz parte da ordem oficial de leitura;
- não deve ser usada como fonte da arquitetura atual;
- não deve declarar capacidades implementadas;
- não deve orientar novas alterações;
- só deve ser consultada quando a tarefa exigir histórico.

O legado do Maestro está documentado em:

```text
docs/_archive/maestro-legacy/README.md   (legado antigo)
docs/_archive/maestro/README.md          (arquivados na reorganização de 26/07/2026)
```

A documentação vigente do Maestro permanece exclusivamente em:

```text
docs/maestro/
```


# Fonte da Verdade

Este índice define como navegar pela documentação.

Ele não substitui os documentos listados.

A implementação, as regras oficiais, a segurança e as evidências do projeto precisam permanecer consistentes.
