# Contrato de Comportamento Maestro V2

Este documento estabelece as regras formais e invariantes para a resolução de intenções, prioridades de domínio e gerenciamento de contexto no **Maestro V2** do ERP Ideal.

---

## 1. Regras de Namespace e Interpretação Numérica

Dígitos isolados ou padrões contendo números na query devem ser interpretados sob as seguintes regras estritas de precedência:

1.  **Prefixos Explícitos (Cliente ou Produto)**:
    *   Se a frase contiver gatilhos claros de cliente como `"cliente 101"`, `"cli 101"`, `"cadastro 101"` ou `"c101"`, o número **sempre** representará um ID de Cliente.
    *   Se a frase contiver gatilhos claros de produto como `"id do produto 101"`, `"produto 101"`, `"prod 101"`, o número **sempre** representará um ID de Produto.
2.  **Estado Conversacional (Pendência Ativa)**:
    *   Se existir uma pendência de produto (`pendingAmbiguousItem` ou `pendingProductResolution`) no turno imediatamente anterior:
        *   Um número puro (ex: `"101"`) deve ser resolvido **sempre** como **ID do Produto** correspondente para sanar a pendência.
        *   A busca por cliente para esse número puro deve ser completamente bloqueada.
    *   Se **não** houver pendência de produto ativa:
        *   Um número puro isolado (ex: `"101"`) sem qualquer prefixo explícito **não** deve buscar cliente automaticamente. Ele deve cair no fluxo de fallback informando as intenções possíveis ou aguardando esclarecimento.
3.  **Quantidade vs. ID**:
    *   Um número puro em uma resposta a uma pendência de produto (ex: `"101"`) **nunca** deve ser interpretado como quantidade, mas sim como ID de Produto.
    *   Quantidade só deve ser extraída quando o parser de itens detectar o par estruturado (ex: `"101 pulseiras"`) ou no fluxo específico de `perguntar_quantidade_orcamento`.

---

## 2. Ordem de Prioridade de Domínios no Context Manager

O `handleContextContinuation` deve avaliar as queries do usuário na seguinte ordem de prioridade absoluta:

1.  **Comandos de Cancelamento/Redirecionamento Críticos**:
    *   Mensagens como `"não quero orçar"`, `"esquece orçamento"`, etc. limpam o estado do orçamento e redirecionam o domínio para `cliente` (se houver cliente ativo) ou `desconhecido`.
2.  **Referências Explícitas a Clientes**:
    *   Gatilhos contendo prefixo explícito de cliente + código (ex: `"cliente 8469"`).
3.  **Resolução de Pendências de Produtos (Namespace e ID)**:
    *   Correções e seleções numéricas ou textuais de produto quando há pendência ativa (ex: `"101"`, `"quis dizer triband"`, `"id do produto 101"`).
4.  **Perguntas Cadastrais do Cliente Ativo**:
    *   Mensagens contextuais contendo termos cadastrais (ex: *"e os endereços dele?"*, *"quem são os contatos?"*) quando há cliente ativo na sessão. Redireciona imediatamente para o domínio `cliente`.
5.  **Ações Especiais de Orçamento**:
    *   Ações de controle: `"refaça"`, `"refaça do início"`, `"repete"`, `"o que tinha no pedido?"` (Show).
6.  **Heurísticas de Mutação Parcial de Orçamento (Change, Remove, Add)**:
    *   Alterações acumulativas (`ADD`), mutações parciais de linha (`CHANGE`), remoção de itens (`REMOVE`) ou restauração de itens (`RESTORE`).

---

## 3. Arquitetura do Orçamento Avulso

*   **Isolamento de Responsabilidade**: O Router principal (`maestro-v2-router.ts`) e o Context Manager (`maestro-v2-context-manager.ts`) **não devem realizar nenhum parsing de intenções, quantidades ou itens de orçamento**.
*   **Motor Isolado**: Toda a lógica de interpretação de orçamento (criação, adição, remoção, alteração de quantidade, resolução de ambiguidades e limpeza) pertence única e exclusivamente ao motor isolado determinístico (`maestro-orcamento-engine.ts`).
*   **Delegação Simples**: O Router e o Context Manager atuam apenas como despachantes. Eles enviam a query do usuário e o estado do orçamento ativo para o motor isolado, e reagem à ação retornada (`ADD`, `REMOVE`, `UPDATE_QTD`, etc.).
*   **Tratamento de Erros Parciais**: Se uma lista explícita com múltiplos produtos contiver itens válidos e itens inválidos, o orçamento ativo deve manter todas as linhas válidas, isolando apenas a pendência do item problemático dentro do próprio motor.

---

## 4. Fallback Seguro

Qualquer query que falhe em todas as regras determinísticas e não consiga ser resolvida semanticamente deve cair no presenter de esclarecimento de intenção (`presenterEsclarecerOrcamento`), orientando o usuário a especificar o comando de forma inequívoca.

---

## 5. Baseline de Regressão — Fluxo Aprovado em Produção

> **Data de aprovação:** 2026-07-07  
> **Ambiente:** Vercel Production — `MAESTRO_AVULSO_ENABLED=false`

Este fluxo é o **comportamento obrigatório** que deve ser preservado em qualquer atualização do Maestro V2. Qualquer mudança que o quebre **deve ser bloqueada antes do merge**.

### Turno 1 — Busca de Cliente por Nome

| Item | Valor |
|------|-------|
| Input | `"cliente Lisiton"` |
| Ferramenta esperada | `buscarCliente` |
| Esperado | Encontrar **LISITON DOCUMENTOS SEGUROS LTDA** |
| Domínio pós-resposta | `cliente` |
| Cliente ativo | `true` |
| Deve contaminar orçamento? | `false` |

### Turno 2 — Consulta Contextual (sem repetir o cliente)

| Item | Valor |
|------|-------|
| Input | `"me traga os contatos dele"` |
| Ferramenta esperada | `consultarCampoCadastro` com `campo: "contatos"` |
| Cliente a consultar | ID interno do cliente ativo (sem nova busca) |
| Deve pedir cliente novamente? | `false` |
| Deve responder genericamente? | `false` |

### Turno 3 — Tentativa de Orçamento (desativado)

| Item | Valor |
|------|-------|
| Input | `"show e vc pode ver pra mim o valor de 5200 triband?"` |
| Ferramenta esperada | `orcamento_avulso_desativado` |
| Deve calcular? | `false` |
| Deve inventar preço? | `false` |
| Deve apagar o cliente ativo? | **`false` — CRÍTICO** |
| Deve contaminar o contexto? | `false` |
| Resposta esperada | Mensagem informando que a simulação de orçamento avulso está em ajuste |

### Turno 4 — Financeiro após bloqueio de orçamento

| Item | Valor |
|------|-------|
| Input | `"e sabe me dizer se a Lisiton tem boletos em atraso?"` |
| Ferramenta esperada | `consultarBoletos` |
| Deve usar cliente ativo? | `true` |
| Deve citar fonte | `public.boletos` |
| Deve responder com dados reais? | `true` (ou informar que não encontrou, sem inventar) |

---

## 6. Critérios de Guarda para Regressão

Antes de qualquer religamento de `MAESTRO_AVULSO_ENABLED=true`, os seguintes critérios **obrigatoriamente devem passar**:

1. **Cliente ativo preservado após tentativa de orçamento** — o `activeEntities.clientId` não pode ser apagado pela interceptação de orçamento avulso.
2. **Financeiro funciona após tentativa de orçamento** — o domínio `financeiro` deve ser atingível mesmo que o turno anterior tenha sido capturado pelo bloqueio de orçamento.
3. **Isolamento de namespace numérico** — números isolados não disparam busca de cliente quando há pendência de produto ativa.
4. **Motor de orçamento puro** — nenhum parsing de produto deve existir fora de `maestro-orcamento-engine.ts`.
5. **Testes isolados verdes** — `test_orcamento_isolado.ts` deve passar 7/7.
6. **Teste de regressão verde** — `test_baseline_regressao.ts` deve passar todos os turnos.
7. **Teste do resolver verde** — `test_orcamento_resolver.ts` deve passar 31/31.
8. **Teste de integração verde** — `test_orcamento_integracao.ts` deve passar 46/46.

---

## 7. Fase 3 — Integração Motor + Resolver + Cálculo (Serviço Isolado)

> **Status:** Implementado — não conectado ao chat principal.  
> **Data:** 2026-07-07  
> **MAESTRO_AVULSO_ENABLED:** `false`

### Arquitetura da Fase 3

A Fase 3 integra os três módulos isolados em uma camada de serviço orquestradora:

```
query do usuário
     │
     ▼
maestro-orcamento-engine.ts    ← parsing puro (sem DB)
     │ OrcamentoResult (action, items, nextState)
     ▼
maestro-orcamento-service.server.ts   ← orquestrador
     │ mapeia items → ResolverItemReq[]
     ▼
maestro-orcamento-resolver.server.ts  ← consulta read-only public.produtos
     │ ResolverResult (itens com status, subtotais, totalGeral)
     ▼
OrcamentoServiceResult  ← retornado ao chamador
```

### Responsabilidades por módulo

| Módulo | Responsabilidade |
|--------|-----------------|
| `maestro-orcamento-engine.ts` | Parsing textual puro, sem DB, sem IO |
| `maestro-orcamento-resolver.server.ts` | Consulta read-only em `public.produtos` |
| `maestro-orcamento-service.server.ts` | Orquestração: recebe query + state, devolve resultado completo |
| `maestro-v2-router.ts` | Decisão de routing; verifica `MAESTRO_AVULSO_ENABLED` |
| `maestro-v2-context-manager.ts` | Continuação de contexto; delega ao service quando habilitado |

### Regras de Cálculo (Fase 3)

- `subtotal = quantidade × valorUnt + (valorFixo ?? 0)`
- `valorUnt == null` → `preco_incompleto` (cálculo bloqueado)
- `valorFixo == null` → tratado como `0` (documentado)
- `ativo = false` → `inativo` (não entra no total)
- `totalGeral = null` se qualquer item não for `sucesso`
- Em ambiguidade, `temPendencia = true` e o usuário deve informar ID

### Estado da Fase 3

- [x] Serviço orquestrador criado e testado
- [x] Testes de integração: 46/46 passando com fixtures locais
- [ ] Religamento no chat principal (aguardando aprovação — Fase 4)


