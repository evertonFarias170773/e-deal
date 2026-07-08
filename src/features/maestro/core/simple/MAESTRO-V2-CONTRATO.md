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

---

## 8. Fase 3.5 — Sandbox com Catálogo Real (OBRIGATÓRIO antes da Fase 4)

> **Status:** Concluído ✅  
> **Data:** 2026-07-07  
> **Arquivo:** `test_orcamento_catalogo_real.ts`  
> **Banco:** public.produtos — READ-ONLY — ANON KEY

### Resultados do Catálogo Real (2026-07-07)

| Termo | Produto Real | ID | valorUnt | valorFixo | Status |
|-------|-------------|-----|----------|-----------|--------|
| `mobi` | O ingresso MOBI é a solução... | #401 | 0.23 | 40 | ✅ sucesso |
| `triband` | Pulseira sintetica de lacre adesivo... | #101 | 0.16 | 40 | ✅ sucesso |
| ID `101` | Pulseira sintetica de lacre adesivo... | #101 | 0.16 | - | ✅ sucesso |
| `tri` | — | — | — | — | ⚠️ ambíguo (2 candidatos: #9001 e #101) |
| `xyznaocadastrado99999` | — | — | — | — | ✅ nao_encontrado (correto) |

### Diálogos Testados com Dados Reais

| Diálogo | Action | Total Real |
|---------|--------|------------|
| `"15600 mobi + 1500 triband qual valor?"` | ADD | R$ 3.908,00 |
| `"muda a qtd do mobi pra 10k"` | UPDATE_QTD | R$ 2.620,00 |
| `"muda a quantidade do mobi para 10.000"` | UPDATE_QTD | R$ 2.620,00 |
| `"10600 mobi + 1500 triband qual valor?"` | REPLACE | R$ 2.758,00 |
| `"1500 tri"` | ADD | BLOQUEADO (ambíguo: #9001 e #101) |
| `"101"` com pendência | ADD | ID 101 resolvido corretamente |
| `"assim não dá"` | CLEAR | — |

### Aviso de Catálogo

> ⚠️ **"tri" é ambíguo** no catálogo real — retorna 2 produtos:  
> - #9001 — Teste de cadastro de pulseira (apelido: `tri`)  
> - #101 — Pulseira sintetica triband (apelido: `tri`)  
> 
> **Recomendação antes da Fase 4:** ajustar apelidos para que `triband` seja único
> e `tri` mostre pedido de escolha corretamente no chat.

### Checklist de Segurança Fase 3.5

- [x] Apenas `public.produtos` acessada — ZERO tabelas proibidas
- [x] ZERO escrita no banco
- [x] ANON KEY usada — ZERO service_role
- [x] MAESTRO_AVULSO_ENABLED = false confirmado
- [x] Baseline 20/20 preservado
- [x] Tsc sem erros no código de negócio (error de `.next` pré-existente, sem relação)

### Requisito: Fase 3.5 é OBRIGATÓRIA antes da Fase 4

A Fase 4 (religamento no chat principal) **só pode ser iniciada** após:

1. Fase 3.5 aprovada com dados reais ✅
2. Ambiguidade de `"tri"` resolvida (apelido ajustado no banco) ou aceita como comportamento documentado
3. Todos os 8 critérios de guarda da Seção 6 verificados
4. Aprovação explícita do usuário

---

## 9. Catálogo Oficial de Aliases de Produtos

> **Status:** Implementado ✅ — 2026-07-07  
> **Arquivo:** `maestro-orcamento-catalogo-oficial.ts`

### Responsabilidade

O catálogo oficial **mapeia termos digitados pelo usuário para `id_produto`**. Ele **nunca** é fonte de preço, valorUnt, valorFixo ou status.

### Princípio fundamental

| Fonte | Resolve |
|-------|---------|
| Catálogo oficial (`maestro-orcamento-catalogo-oficial.ts`) | alias → id_produto |
| Banco real (`public.produtos`) | id_produto → preço, status, ativo |
| Brain/LLM | **NADA** — não decide produto |

### Prioridade de resolução

1. **ID numérico explícito** informado pelo usuário (ex: `"101"`, `"id do produto 101"`)
2. **Alias exato no catálogo oficial** (ex: `"tri"` → ID 101, `"mobi"` → ID 401)
3. **Alias parcial seguro no catálogo oficial**
4. **`public.produtos.apelidos`** (banco) — fallback textual
5. **`public.produtos.descricao`** (banco) — fallback final

### Produtos Operacionais Registrados (base 2026-07-07)

| ID | Nome Comercial | Aliases Canônicos |
|----|---------------|-------------------|
| 101 | Pulseira Triband Sintética | `triband`, `tri`, `tri band`, `tyvek` |
| 102 | Pulseira de Tecido (Velcro) | `tecido`, `velcro`, `fabric` |
| 103 | Pulseira de Silicone | `silicone`, `borracha` |
| 401 | Ingresso MOBI | `mobi`, `moby` |
| 402 | Ingresso UP | `up`, `cali` |
| 501 | Ticket | `ticket`, `tike`, `tiket` |
| 601 | Cordão Jacaré | `cordao jacare`, `jacare`, `cordao` |
| 602 | Cordão com Argola Giratória | `cordao argola`, `argola` |
| 701 | Crachá PVC | `cracha pvc`, `pvc` |
| 702 | Crachá Papel | `cracha papel`, `credencial` |

### Regra Anti-Ambiguidade

- **`"tri"` → ID 101** (catálogo oficial vence produto de teste #9001 do banco)
- Se um alias constar em dois produtos no catálogo → `verificarConflitosAlias()` detecta e deve retornar `[]`
- Produto de teste no banco **nunca** vence alias oficial no catálogo

### Testes

- `test_orcamento_catalogo_oficial.ts` — **45/45** (zero acesso ao banco)
- `test_orcamento_resolver.ts` — **31/31** (com catálogo integrado)
- `test_orcamento_integracao.ts` — **46/46**

---

## 10. Correção — Regressão "ok" com Fatos Falsos (2026-07-07)

### Problema corrigido

Mensagem curta `"ok"` após bloqueio de orçamento gerava resumo do cliente com falso negativo:  
- `"Endereços cadastrados: Nenhum"`  
- `"Contatos secundários: Nenhum cadastrado"`

Mesmo após o Maestro ter listado endereços e contatos reais no turno anterior.

### Causa

1. `"ok"` não estava em `CLOSURE_TRIGGERS` → caia em `fallback` → passava pelo Brain/LLM
2. `legacyContextToSimple()` sempre preenche `enderecos:[]`, `contatos:[]` (não serializado entre turnos)
3. `factsToText()` tratava array vazio como ausência real → enviava `"nenhum"` ao LLM

### Correção aplicada

| Arquivo | Mudança |
|---------|---------|
| `maestro-simple-intents.ts` | `CLOSURE_TRIGGERS` expandido: `ok`, `blz`, `certo`, `combinado`, `entendido`, `ta bom`, `ta`, `fechou`, `otimo`, `ate mais`, `ate logo`, `tcau` |
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

---

## 8. Fase 3.5 — Sandbox com Catálogo Real (OBRIGATÓRIO antes da Fase 4)

> **Status:** Concluído ✅  
> **Data:** 2026-07-07  
> **Arquivo:** `test_orcamento_catalogo_real.ts`  
> **Banco:** public.produtos — READ-ONLY — ANON KEY

### Resultados do Catálogo Real (2026-07-07)

| Termo | Produto Real | ID | valorUnt | valorFixo | Status |
|-------|-------------|-----|----------|-----------|--------|
| `mobi` | O ingresso MOBI é a solução... | #401 | 0.23 | 40 | ✅ sucesso |
| `triband` | Pulseira sintetica de lacre adesivo... | #101 | 0.16 | 40 | ✅ sucesso |
| ID `101` | Pulseira sintetica de lacre adesivo... | #101 | 0.16 | - | ✅ sucesso |
| `tri` | — | — | — | — | ⚠️ ambíguo (2 candidatos: #9001 e #101) |
| `xyznaocadastrado99999` | — | — | — | — | ✅ nao_encontrado (correto) |

### Diálogos Testados com Dados Reais

| Diálogo | Action | Total Real |
|---------|--------|------------|
| `"15600 mobi + 1500 triband qual valor?"` | ADD | R$ 3.908,00 |
| `"muda a qtd do mobi pra 10k"` | UPDATE_QTD | R$ 2.620,00 |
| `"muda a quantidade do mobi para 10.000"` | UPDATE_QTD | R$ 2.620,00 |
| `"10600 mobi + 1500 triband qual valor?"` | REPLACE | R$ 2.758,00 |
| `"1500 tri"` | ADD | BLOQUEADO (ambíguo: #9001 e #101) |
| `"101"` com pendência | ADD | ID 101 resolvido corretamente |
| `"assim não dá"` | CLEAR | — |

### Aviso de Catálogo

> ⚠️ **"tri" é ambíguo** no catálogo real — retorna 2 produtos:  
> - #9001 — Teste de cadastro de pulseira (apelido: `tri`)  
> - #101 — Pulseira sintetica triband (apelido: `tri`)  
> 
> **Recomendação antes da Fase 4:** ajustar apelidos para que `triband` seja único
> e `tri` mostre pedido de escolha corretamente no chat.

### Checklist de Segurança Fase 3.5

- [x] Apenas `public.produtos` acessada — ZERO tabelas proibidas
- [x] ZERO escrita no banco
- [x] ANON KEY usada — ZERO service_role
- [x] MAESTRO_AVULSO_ENABLED = false confirmado
- [x] Baseline 20/20 preservado
- [x] Tsc sem erros no código de negócio (error de `.next` pré-existente, sem relação)

### Requisito: Fase 3.5 é OBRIGATÓRIA antes da Fase 4

A Fase 4 (religamento no chat principal) **só pode ser iniciada** após:

1. Fase 3.5 aprovada com dados reais ✅
2. Ambiguidade de `"tri"` resolvida (apelido ajustado no banco) ou aceita como comportamento documentado
3. Todos os 8 critérios de guarda da Seção 6 verificados
4. Aprovação explícita do usuário

---

## 9. Catálogo Oficial de Aliases de Produtos

> **Status:** Implementado ✅ — 2026-07-07  
> **Arquivo:** `maestro-orcamento-catalogo-oficial.ts`

### Responsabilidade

O catálogo oficial **mapeia termos digitados pelo usuário para `id_produto`**. Ele **nunca** é fonte de preço, valorUnt, valorFixo ou status.

### Princípio fundamental

| Fonte | Resolve |
|-------|---------|
| Catálogo oficial (`maestro-orcamento-catalogo-oficial.ts`) | alias → id_produto |
| Banco real (`public.produtos`) | id_produto → preço, status, ativo |
| Brain/LLM | **NADA** — não decide produto |

### Prioridade de resolução

1. **ID numérico explícito** informado pelo usuário (ex: `"101"`, `"id do produto 101"`)
2. **Alias exato no catálogo oficial** (ex: `"tri"` → ID 101, `"mobi"` → ID 401)
3. **Alias parcial seguro no catálogo oficial**
4. **`public.produtos.apelidos`** (banco) — fallback textual
5. **`public.produtos.descricao`** (banco) — fallback final

### Produtos Operacionais Registrados (base 2026-07-07)

| ID | Nome Comercial | Aliases Canônicos |
|----|---------------|-------------------|
| 101 | Pulseira Triband Sintética | `triband`, `tri`, `tri band`, `tyvek` |
| 102 | Pulseira de Tecido (Velcro) | `tecido`, `velcro`, `fabric` |
| 103 | Pulseira de Silicone | `silicone`, `borracha` |
| 401 | Ingresso MOBI | `mobi`, `moby` |
| 402 | Ingresso UP | `up`, `cali` |
| 501 | Ticket | `ticket`, `tike`, `tiket` |
| 601 | Cordão Jacaré | `cordao jacare`, `jacare`, `cordao` |
| 602 | Cordão com Argola Giratória | `cordao argola`, `argola` |
| 701 | Crachá PVC | `cracha pvc`, `pvc` |
| 702 | Crachá Papel | `cracha papel`, `credencial` |

### Regra Anti-Ambiguidade

- **`"tri"` → ID 101** (catálogo oficial vence produto de teste #9001 do banco)
- Se um alias constar em dois produtos no catálogo → `verificarConflitosAlias()` detecta e deve retornar `[]`
- Produto de teste no banco **nunca** vence alias oficial no catálogo

### Testes

- `test_orcamento_catalogo_oficial.ts` — **45/45** (zero acesso ao banco)
- `test_orcamento_resolver.ts` — **31/31** (com catálogo integrado)
- `test_orcamento_integracao.ts` — **46/46**

---

## 10. Correção — Regressão "ok" com Fatos Falsos (2026-07-07)

### Problema corrigido

Mensagem curta `"ok"` após bloqueio de orçamento gerava resumo do cliente com falso negativo:  
- `"Endereços cadastrados: Nenhum"`  
- `"Contatos secundários: Nenhum cadastrado"`

Mesmo após o Maestro ter listado endereços e contatos reais no turno anterior.

### Causa

1. `"ok"` não estava em `CLOSURE_TRIGGERS` → caia em `fallback` → passava pelo Brain/LLM
2. `legacyContextToSimple()` sempre preenche `enderecos:[]`, `contatos:[]` (não serializado entre turnos)
3. `factsToText()` tratava array vazio como ausência real → enviava `"nenhum"` ao LLM

### Correção aplicada

| Arquivo | Mudança |
|---------|---------|
| `maestro-simple-intents.ts` | `CLOSURE_TRIGGERS` expandido: `ok`, `blz`, `certo`, `combinado`, `entendido`, `ta bom`, `ta`, `fechou`, `otimo`, `ate mais`, `ate logo`, `tcau` |
| `maestro-simple-brain.ts` | `factsToText()` — removido `else { "Endereços: nenhum" }` e `else { "Contatos: nenhum" }`. Array vazio = omitir. |
| `test_baseline_regressao.ts` | Turno 5 adicionado: `"ok"` após bloqueio → 5 verificações |

### Regra permanente

> **Array vazio ≠ ausência real.**  
> `factsToText()` só afirma ausência se o dado foi consultado e retornou vazio.  
> Quando não carregado entre turnos, omitir — nunca inventar `"nenhum"`.

### Testes pós-correção

- `test_baseline_regressao.ts` — **25/25** (incluindo Turno 5 "ok")
- `CLOSURE_TRIGGERS` cobre: `ok`, `blz`, `show`, `beleza`, `certo`, `valeu`, `obrigado` e mais 14 variantes

---

## 11. Retomada Explícita de Orçamento (2026-07-07)

### Regra Permanente

> **Menção explícita a orçamento com itens salvos retoma o domínio `orcamento_avulso`, mesmo que o domínio atual seja financeiro ou cliente.**

### Comportamento esperado

Se o usuário estiver simulando um orçamento (ex: `"qual o valor de 1000 mobi"`), em seguida realizar uma consulta financeira (`"ele tem boletos em atraso?"`) e depois pedir para remover ou recalcular o orçamento (`"remove as triband do orçamento"` ou `"refazer sem o mobi"`):
1. O Context Manager detectará a **retomada explícita** por palavras-chave (`do orçamento`, `sem as`, `remove`, `tira`, `refazer o orçamento`).
2. Se houver itens de orçamento salvos no histórico (`orcamentoItens` ou `lastSuccessfulBudgetItems`), o **domínio será forçado de volta para `orcamento_avulso`**.
3. O LLM e o Brain **não** serão acionados.
4. O `maestro-orcamento-engine.ts` processará a remoção ou restauração e retornará o cálculo atualizado imediatamente.

### Ação `REMOVE`
A ação `REMOVE` foi incluída no motor e permite:
- Filtrar itens existentes pelo termo normalizado.
- Remover os itens citados preservando os demais (ex: `"remove as triband"` em um carrinho com Triband e Tex resulta apenas em Tex).
- Salvar o estado anterior (`previousItens`) para suportar a ação `RESTORE` (ex: `"volta as triband"`).

---

## 12. Ambiguidade de Produtos e Formato Visual (2026-07-07)

### Tratamento de Ambiguidade

> **Sempre que o alias informado retornar mais de um produto compatível no banco (`status === 'ambiguo'`), o motor interrompe o cálculo do total e solicita a decisão do usuário.**

1. O Context Manager salva os candidatos em `pendingOptions` e o estado atual vira `temPendencia = true`.
2. O LLM não intervém, a resposta estruturada exibe as opções enumeradas (ex: `1. Pulseira A`, `2. Pulseira B`).
3. O usuário pode responder com o **número da opção**, **ID do produto** ou **nome comercial**.
4. O motor lê a escolha, resolve a ambiguidade mantendo a quantidade solicitada original, e prossegue.

### Formato Comercial (Mock)

O formato visual do orçamento avulso inclui as seguintes características estritas (Mock/Fase 3):
- **Cabeçalho:** `📄 Orçamento conforme solicitação`
- **Dimensões e Prazos:** Os produtos extraem suas dimensões (ex: `25x2cm`) e prazo de produção (ex: `1 dia útil`) do `maestro-orcamento-catalogo-oficial.ts`.
- **Frete Mockado:** São incluídos 3 blocos informativos inalteráveis de transportadoras:
  - Sedex (R$ 29,42)
  - Expresso São Miguel (R$ 50,00)
  - Unesul (R$ 39,00)
- **Localização:** Se o cliente possuir CEP/Cidade na ficha, ela é exibida. Caso contrário, assume-se `Centro | Santa Cruz do Sul / RS`.
- **Total:** O subtotal soma os produtos; o **Total Final** sempre considera o valor fixo do Sedex Mock (R$ 29,42).
