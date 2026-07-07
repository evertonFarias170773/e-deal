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

