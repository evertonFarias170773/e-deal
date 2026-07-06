# Catálogo de Capacidades do Maestro (Consultas de Clientes)

Este catálogo define a fonte da verdade para as capacidades de resposta do **Maestro V2 (Semantic Router)** para o módulo de Clientes, Comercial e Financeiro, baseado na estrutura de tabelas do ERP Ideal.

---

## 1. Mapeamento Comercial vs Financeiro

Para garantir que o Maestro responda com precisão e sem confundir regras de negócio, a seguinte separação conceitual é aplicada:

1.  **Padrão de Pagamento Cadastrado (Regra/Acordo)**:
    *   **Fonte**: `public.clientes.padrao_pagamento`
    *   **Descrição**: Exibe a forma de pagamento registrada no cadastro do cliente (ex: FATURADO, BOLETO, etc.).
    *   **Uso**: Respondido para perguntas como *"qual o padrão de pagamento dele?"*, *"como esse cliente paga?"*, *"ele é faturado?"*.
2.  **Comportamento Real de Pagamento**:
    *   **Fonte**: `public.boletos` e `public.pagamentos_v2`
    *   **Uso**: Respondido para perguntas como *"ele costuma pagar em dia?"*, *"ele atrasa muito?"*, *"qual o histórico de pagamentos?"*.
3.  **Faturamento Financeiro / Recebido**:
    *   **Fonte**: `public.pagamentos_v2` (com filtros `confirmado = true` e `status = 'PAID'`)
    *   **Uso**: Respondido para faturamento líquido consolidado e comparações mensais.
4.  **Vendas Comerciais / Pedidos**:
    *   **Fonte**: `public.propostas` (regra provisória: `is_prd_aprovado = true` e `is_reproved = false`)
    *   **Uso**: Respondido para contagem de pedidos, maior venda e vendas brutas.

---

## 2. Catálogo de Perguntas e Respostas Cadastrais

### 2.1 Padrão de Pagamento
*   **Pergunta do usuário**: *"Qual o padrão de pagamento dele?"*, *"Como esse cliente paga?"*, *"Ele é faturado?"*, *"Qual a forma de pagamento padrão?"*
*   **Tabela/Campo**: `public.clientes.padrao_pagamento`
*   **Tipo de dado**: Cadastral (string)
*   **Regra de resposta**: Retorna o padrão do banco. Se nulo ou vazio, informa: *"Não encontrei padrão de pagamento cadastrado para este cliente."*
*   **Exemplo**: *"O padrão de pagamento cadastrado para esse cliente é FATURADO."*
*   **Riscos**: Confundir o padrão cadastrado com o comportamento real (ex: dizer que o cliente paga em dia só porque ele é cadastrado como faturado).

### 2.2 Limite de Crédito
*   **Pergunta do usuário**: *"Qual o limite de crédito dele?"*, *"Ele tem limite?"*
*   **Tabela/Campo**: `public.clientes.limite_credito` e `public.clientes.credito`
*   **Tipo de dado**: Financeiro/Crédito (numeric)
*   **Regra de resposta**: Exibe o limite de crédito total e o crédito disponível em reais.
*   **Exemplo**: *"O limite de crédito cadastrado para este cliente é R$ 50.000,00, com R$ 12.450,00 de saldo de crédito disponível."*
*   **Riscos**: Expor informações cadastrais sem ter o cliente ativo selecionado.

### 2.3 Restrição Cadastral
*   **Pergunta do usuário**: *"Ele tem alguma restrição?"*, *"O cadastro dele está bloqueado?"*
*   **Tabela/Campo**: `public.clientes.restricao`
*   **Tipo de dado**: Cadastral (boolean / string)
*   **Regra de resposta**: Informa se há restrições registradas no cadastro.
*   **Exemplo**: *"O cliente LISTON DOCUMENTOS SEGUROS LTDA não possui restrições cadastrais."*
*   **Riscos**: Mensagens descritivas em campos livres contendo termos confusos.

### 2.4 Risco de Crédito
*   **Pergunta do usuário**: *"Qual o risco de crédito dele?"*, *"Qual a classificação de risco?"*
*   **Tabela/Campo**: `public.clientes.risco_credito`
*   **Tipo de dado**: Crédito (string / classificação)
*   **Regra de resposta**: Retorna a classificação cadastrada (ex: Classe A, B, C).
*   **Exemplo**: *"O risco de crédito cadastrado para este cliente está classificado como Classe B."*
*   **Riscos**: Confundir risco cadastral com análise de faturamento acumulada.

### 2.5 Status do Cadastro
*   **Pergunta do usuário**: *"Ele está ativo?"*, *"Status do cliente?"*
*   **Tabela/Campo**: `public.clientes.ativo`
*   **Tipo de dado**: Cadastral (boolean)
*   **Regra de resposta**: Retorna se o cadastro do cliente está ativo ou inativo.
*   **Exemplo**: *"O status do cadastro de LISTON DOCUMENTOS SEGUROS LTDA é Ativo."*
*   **Riscos**: Dizer que está ativo comercialmente se a conta estiver sob restrição.

---

## 3. Segurança e Regras Provisórias
*   **Pedidos comerciais**: A regra baseada em `is_prd_aprovado = true` em `public.propostas` é provisória até a conclusão do módulo de produção do ERP.
*   **Exposição**: Nunca expor tokens, chaves PIX ou credenciais.
*   **Sem Escrita**: O Maestro opera de forma 100% de leitura neste módulo.
