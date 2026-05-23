# Checkout e Pagamentos

Documento de referência para o fluxo real futuro de checkout e pagamentos do ERP Ideal. Orienta a implementação mockada do módulo **Cobranças e Pagamentos** e a integração posterior com backend, n8n e Edge Functions.

## Escopo deste documento

- Descrever a origem operacional das cobranças.
- Definir a tabela principal `pagamentos_v2` e seus campos relevantes.
- Explicar fluxos por forma de pagamento.
- Separar responsabilidades entre frontend ERP, backend e automações.
- Orientar o que a versão mockada deve simular.

**Fora de escopo nesta fase:** conexão com Supabase, migrations, backend real e integrações bancárias.

---

## Origem de toda cobrança

Toda cobrança nasce a partir de uma **proposta**, identificada pela chave operacional:

- **`id_int`**

Regras:

- uma proposta pode gerar uma ou mais cobranças;
- todas as cobranças de uma mesma proposta compartilham o mesmo `id_int`;
- o vendedor cria a cobrança a partir da proposta após o cliente aprovar e informar a forma de pagamento;
- o frontend ERP nunca gera PIX, boleto ou checkout diretamente — apenas solicita e exibe o retorno.

---

## Tabela principal: `pagamentos_v2`

A tabela central de cobrança e pagamento do ERP será **`pagamentos_v2`**.

### Campos importantes

| Campo | Descrição |
|---|---|
| `id` | Identificador interno do registro |
| `id_int` | Número da proposta de origem |
| `id_cliente` | Cliente vinculado |
| `valor` | Valor principal da cobrança |
| `status` | Status operacional do pagamento |
| `tipo_cobranca` | Forma de pagamento (PIX, boleto, cartão, faturado etc.) |
| `created_at` | Data/hora de criação |
| `paid_at` | Data/hora de confirmação do pagamento |
| `vencimento` | Data de vencimento, quando aplicável |
| `cliente` | Nome ou referência do cliente |
| `empresa` | Empresa recebedora |
| `descricao` | Descrição exibida na cobrança |
| `documento` | CPF/CNPJ do pagador |
| `atendente` | Vendedor ou responsável |
| `confirmado` | Indica confirmação manual ou operacional |
| `confirmado_por` | Usuário que confirmou |
| `data_confirmacao` | Data da confirmação |
| `id_empresa` | ID da empresa recebedora |
| `os_ideal` | OS Ideal temporária usada enquanto o sistema antigo roda em paralelo |
| `id_pagamento` | Referência externa ou sequencial de pagamento |
| `token_publico` | Token para página pública de pagamento |
| `url_cobranca` | URL pública da cobrança |
| `pix_copia_cola` | Código PIX copia e cola |
| `linha_digitavel` | Linha digitável do boleto |
| `url_pdf` | URL do PDF do boleto ou comprovante |
| `erro_pagamento` | Mensagem de erro da integração |
| `cartao_parcelas` | Quantidade de parcelas |
| `cartao_taxa_percentual` | Percentual de taxa embutida |
| `cartao_valor_taxa` | Valor da taxa |
| `cartao_valor_final` | Valor final cobrado no cartão |
| `cartao_checkout_id` | ID do checkout gerado |
| `cartao_checkout_url` | URL do checkout de cartão |
| `cartao_status` | Status específico do fluxo de cartão |
| `is_parcial` | Indica pagamento parcial |
| `saldo_pendente` | Saldo restante a receber |
| `valor_frete` | Valor de frete incluído na cobrança, se houver |
| `p_valor_entrada` | Valor de entrada em pagamento parcelado/faturado |
| `p_qtd_parcelas` | Quantidade de parcelas programadas |
| `p_dias_pra_inicio` | Dias até início do recebimento |
| `p_intervalo` | Intervalo entre parcelas |

---

## Fluxo geral

```text
1. Proposta é criada.
2. Cliente aprova e informa forma de pagamento.
3. Vendedor volta na proposta.
4. Dentro da proposta, na área **Criar e ver cobranças**, o vendedor informa OS Ideal, valor, forma de pagamento, observações e condição/parcelas.
5. Sistema cria registro em pagamentos_v2.
6. Backend/n8n gera PIX, boleto ou checkout de cartão.
7. Sistema salva retorno da cobrança.
8. Cliente acessa link público/checkout.
9. Webhook confirma pagamento.
10. pagamentos_v2 é atualizado.
11. A proposta pode ser aprovada quando a regra financeira permitir.
```

Na experiência atual mockada, o modal de criação dentro da proposta deve ser **simples e operacional**:

- conferir proposta, cliente e empresa recebedora;
- informar `os_ideal`, valor, observação e vencimento quando aplicável;
- escolher forma de pagamento;
- gerar cobrança.

Detalhes técnicos como `pix_copia_cola`, `linha_digitavel`, `cartao_checkout_url`, cálculo de taxas/parcelas e webhooks ficam para backend e para o detalhe da cobrança após a geração.

---

## Empresas recebedoras

A empresa recebedora deve vir da **empresa já definida na proposta**:

- **Ideal**
- **Birô**
- **E3**

Cada empresa pode possuir:

- conta bancária própria;
- credencial própria;
- fluxo n8n próprio;
- configuração C6 própria.

**Regra de segurança:** o frontend ERP **nunca** deve expor credenciais, tokens bancários ou segredos de integração. Apenas exibe status, links públicos e documentos já gerados pelo backend.

Na fase mockada:

- não escolher empresa novamente no fluxo principal;
- permitir troca futura apenas para cenário administrativo/permissão especial;
- bloquear visualmente tipos não disponíveis para a empresa da proposta.

---

## Fluxos por forma de pagamento

### PIX

Disponível para **Ideal**, **Birô** e **E3**.

1. Vendedor escolhe **PIX** dentro da proposta.
2. Sistema usa a empresa já definida na proposta.
3. Sistema cria registro em `pagamentos_v2`.
4. Backend/n8n gera o PIX.
5. Sistema salva:
   - `pix_copia_cola`
   - `token_publico`
   - `url_cobranca`
6. Cliente paga.
7. Webhook atualiza o registro para **`PAID`**.

### Cartão de crédito

Disponível para **Ideal** e **E3**.

1. Vendedor escolhe **cartão de crédito** dentro da proposta.
2. Sistema cria registro em `pagamentos_v2`.
3. Backend/n8n gera checkout.
4. Sistema salva:
   - `cartao_checkout_id`
   - `cartao_checkout_url`
5. Cliente paga no checkout externo.
6. Webhook atualiza status e campos de cartão.

### Cartão parcelado

Disponível para **Ideal** e **E3**.

1. Vendedor ou cliente escolhe o parcelamento.
2. Sistema calcula taxa embutida.
3. Sistema salva:
   - `cartao_parcelas`
   - `cartao_taxa_percentual`
   - `cartao_valor_taxa`
   - `cartao_valor_final`
   - `cartao_status`
4. Cliente visualiza opções, por exemplo:
   - 1x de R$ 100,00 sem juros
   - 2x de R$ 52,25 com juros
5. Após escolha, backend gera checkout.
6. Webhook confirma ou atualiza o fluxo.

### Boleto

Disponível para **Ideal** e **E3**.

1. Vendedor escolhe **boleto** dentro da proposta.
2. Sistema cria registro em `pagamentos_v2`.
3. Backend/n8n gera boleto C6.
4. Pode criar registros complementares em **`boletos`**.
5. Sistema salva:
   - `linha_digitavel`
   - `url_pdf`
6. Cancelamento também passa pelo fluxo n8n/C6.

### Faturado

1. Cliente solicita crédito ou pagamento a prazo.
2. Sistema verifica limite de crédito.
3. Se aprovado:
   - pagamento pode ficar com `status = A_VENCER`;
   - `confirmado = true`.
   - registrar que o limite foi reservado no mock.
4. Se não aprovado:
   - gera solicitação ao financeiro;
   - registra mensagem em **`propostas_chat`**.

---

## Status principais

| Status | Significado |
|---|---|
| `A_RECEBER` | Cobrança criada e pendente de pagamento |
| `A_VENCER` | Recebimento futuro aprovado (ex.: faturado) |
| `PAID` | Pagamento confirmado |
| `CANCELADO` | Cobrança cancelada |
## Regra de liberação da proposta

A proposta só pode virar **pedido** quando **todos os pagamentos válidos** do mesmo `id_int` estiverem aprovados.

Pagamento considerado aprovado quando:

- `status = PAID`

**ou**

- `status = A_VENCER` **e** `confirmado = true`

Cobranças canceladas ou inválidas não entram na validação de liberação.

---

## Página pública de pagamento

O cliente pode acessar uma página pública usando **`token_publico`**.

Essa página pode exibir:

- dados da cobrança;
- status atual;
- PIX copia e cola;
- checkout de cartão;
- boleto (linha digitável e PDF);
- confirmação visual quando pago.

O ERP interno usa os mesmos dados retornados pelo backend, mas a experiência pública deve ser simples, segura e sem exposição de credenciais.

---

## Responsabilidades

### Frontend ERP

- criar solicitação visual de cobrança prioritariamente dentro da proposta;
- informar `os_ideal`, valor, forma de pagamento, observações e campos mínimos condicionais;
- herdar a empresa recebedora da proposta;
- manter o modal de criação enxuto e operacional, sem painel técnico de integração;
- mostrar status, links e documentos após geração;
- consultar e atualizar visualmente o estado da cobrança;
- oferecer lista de conferência financeira para o financeiro;
- **não** expor credenciais;
- **não** gerar PIX, boleto ou checkout diretamente.

### Backend / n8n / Edge Functions

- gerar PIX;
- gerar boleto;
- gerar checkout de cartão;
- calcular parcelamento real, quando aplicável;
- receber webhooks;
- atualizar `pagamentos_v2`;
- salvar PDFs e URLs;
- cancelar cobranças;
- aplicar regras de crédito e confirmação financeira.

---

## Orientação para a versão mockada

O módulo **Cobranças e Pagamentos** mockado deve simular o fluxo acima sem integração real.

### O que simular

- criação de cobrança a partir de proposta (`id_int`);
- criação principal dentro da área **Criar e ver cobranças** da proposta;
- modal simples de criação com foco operacional;
- campo obrigatório `os_ideal`;
- escolha de forma de pagamento: PIX, boleto, cartão, cartão parcelado e faturado;
- empresa recebedora herdada da proposta;
- criação visual de registro equivalente a `pagamentos_v2`;
- status visuais: `A_RECEBER`, `A_VENCER`, `PAID`, `CANCELADO`;
- `CARD_PARCELADO` tratado como tipo/fluxo e não como status financeiro principal;
- campos condicionais mínimos por tipo (ex.: vencimento para boleto/faturado e quantidade de parcelas para cartão parcelado);
- confirmação manual mockada para faturado;
- conferência financeira, análise de crédito e liberação da proposta para pedido no módulo Cobranças;
- mensagens de sucesso via toast/notificação;
- regra visual de liberação da proposta conforme pagamentos aprovados.

### O que não fazer na fase mockada

- conectar Supabase;
- criar migrations;
- criar backend real;
- chamar C6, gateways ou webhooks reais;
- expor credenciais ou tokens sensíveis.

### Referências relacionadas

- Propostas: chave operacional `id_int`
- Cadastros: cliente, limite de crédito e dados comerciais
- Documentação geral: `docs/ARQUITETURA.md`, `docs/MODULOS-IMPLEMENTADOS.md`, `docs/DECISOES-TECNICAS.md`
