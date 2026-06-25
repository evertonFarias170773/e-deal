# Padrão Unificado de Cancelamento de Cobranças

Este documento mapeia as regras de negócio e fluxos sistêmicos para o cancelamento de cobranças (boletos, PIX, cartões) dentro do ERP, garantindo que o banco de dados interno e os parceiros externos fiquem perfeitamente sincronizados.

## Tipos de Ação Local
Existem duas ações diferentes que o usuário pode tomar no sistema em relação à interrupção de um pagamento:

1. **DELETE (Exclusão Física)**
   - **Gatilho:** Botão "Excluir" na aba "Pagamentos" do painel de Orçamentos / Propostas.
   - **Comportamento:** A cobrança desaparece completamente do banco de dados (linha apagada).

2. **CANCEL (Cancelamento Lógico)**
   - **Gatilho:** Botões "Cancelar" no módulo Financeiro (Contas a Receber, tela de detalhe da cobrança) e modais globais.
   - **Comportamento:** A linha permanece no banco, mas o campo `status` é alterado para `CANCELADO`, preservando o histórico e exigindo um motivo justificado (`motivo_cancela`).

> [!WARNING]
> **A Regra de Ouro**: O Frontend nunca deve alterar o banco de dados local diretamente se a cobrança possuir uma **Integração Externa**. Nesses casos, tanto o `DELETE` quanto o `CANCEL` devem obrigatoriamente fluir pela rota unificada `/api/cobrancas/cancelar-externo`.

---

## Payload de Comunicação Unificada (`/api/cobrancas/cancelar-externo`)
Quando o Provider identifica a necessidade de integração (ex: boleto gerado no parceiro), ele envia a requisição POST com o seguinte formato:

```json
{
  "id": "uuid-da-cobranca",
  "tipo_cobranca": "BOLETO", // ou PIX, CARTAO, etc.
  "acao_local": "DELETE | CANCEL",
  "cod_c6": "codigo-gerado-pelo-banco",
  "id_empresa": 1,
  "motivo": "Cancelado via solicitação do cliente" // Opcional, usado quando acao_local = CANCEL
}
```

---

## 1. Cancelamento de BOLETOS

### Regras de Bloqueio (Backend)
Antes de processar qualquer cancelamento de boleto, a API **valida diretamente no banco** (`pagamentos_v2`) para não depender exclusivamente do payload enviado pelo Frontend:
- O sistema considera como fonte de verdade o campo `tipo_cobranca` registrado no banco.
- `status` não pode ser `PAID`.
- `confirmado` não pode ser `true`.
- O `cod_c6` processado no backend prioriza o payload frontend, mas falha graciosamente usando o `cod_solicitacao_inter` do banco (fallback seguro).
- O backend valida se as propriedades do payload batem exatamente com as salvas.

### Webhook Acionado (n8n)
- **URL**: `POST https://10074.hostoo.net.br/webhook/del-boleto-av-vibe`
- **Validação de Sucesso**: O sistema aguarda um status de sucesso da requisição HTTP (HTTP Status na faixa de `2xx`). Se a comunicação com o webhook falhar (status HTTP de erro 4xx ou 5xx), a operação local será imediatamente abortada, prevenindo exclusões ou cancelamentos "falsos" no sistema. O parceiro n8n atualmente retorna `[{}]` quando o webhook é bem sucedido.

### Consequências no Banco Local (Após sucesso do Banco Externo)

**Se `acao_local` == `DELETE`**:
- **Tabela `public.boletos` (Secundária)**:
  Deleção da linha usando a sintaxe estrita AND:
  `.eq("id_boleto_c6", cod_C6Final).eq("id_int", pagamento.id_int)`
  *(Nota: A exclusão deve ser rigorosa para garantir que nunca deletaremos outros boletos da mesma proposta)*
- **Tabela `public.pagamentos_v2` (Primária)**:
  `.eq("id", id_do_pagamento)`

**Se `acao_local` == `CANCEL`**:
- **Tabela `public.pagamentos_v2`**:
  `UPDATE pagamentos_v2 SET status = 'CANCELADO', motivo_cancela = '...' WHERE id = '...';`

### UX Esperada
- O Frontend trata o erro e devolve para o usuário de forma amigável através de um Toast.
- Caso a API externa não dê sucesso (ex: requisição recusada no parceiro financeiro ou webhook configurado incorretamente para lançar HTTP 400), a exclusão local é 100% bloqueada, e o Toast relata que o cancelamento externo falhou, evitando cobrar o usuário em sistemas terceiros se no ERP estivesse cancelado/deletado.

---

## 2. Cancelamento de PIX e CARTÃO

**Para PIX e Cartões não-integrados externamente nesta fase:**
- A exclusão pela aba Pagamentos da proposta realiza **apenas o DELETE físico na tabela primária `public.pagamentos_v2`**.
- **Não** existe exclusão em tabelas auxiliares (como `public.boletos`) para PIX.
- O fluxo utiliza exclusivamente o método local `deleteCobranca` presente no `CobrancasProvider.tsx`, sem passar pelo endpoint `/api/cobrancas/cancelar-externo`. Se houver tentativa de cancelar um PIX ou Cartão pela rota externa, o sistema devolverá HTTP 501 (Não Implementado).

---

## 3. Regra Global de Segurança (Bloqueio de Cobranças Liquidadas)

Para **todos** os tipos de cobrança (Boleto, PIX, Cartão, Mock, etc.):

- Nenhuma cobrança pode ser excluída fisicamente ou logicamente quando o `status = 'PAID'` (Pago) ou `status = 'A_VENCER'` (Faturamento Aprovado).
- Esse bloqueio arquitetural ocorre em múltiplas camadas protetoras:
  1. **UI:** O botão "Excluir" fica desabilitado nativamente na interface, exibindo um tooltip informativo ("Não é possível excluir cobrança paga").
  2. **Estado Local (Provider):** O método `deleteCobranca` e `cancelCobranca` travam a execução ao constatar o status no array local de objetos.
  3. **Revalidação em Tempo Real (Banco de Dados):** O sistema re-consulta o status da cobrança diretamente na tabela `public.pagamentos_v2` milissegundos antes da operação final (`DELETE` ou `UPDATE`). Isso garante que uma cobrança recém-paga via webhook (ainda não refletida visualmente no frontend) jamais seja apagada.

---

## 4. Regra de Reversão Automática do Status da Proposta

Sempre que houver o sucesso numa exclusão (`deleteCobranca`) ou cancelamento (`cancelCobranca` e `cancelarExterno`) de qualquer modalidade:

O sistema automaticamente verificará o saldo de cobranças ativas na tabela `public.pagamentos_v2` atreladas ao mesmo identificador numérico da proposta (`id_int`).

- **Condição:**
  Se **não existir mais nenhuma cobrança ativa** atrelada (isto é, o `COUNT` for zero), ignorando sumariamente cobranças onde `status = 'CANCELADO'`.
- **Ação Executada:**
  A tabela `public.propostas` sofrerá um `UPDATE` imediato retornando seu estado operacional:
  `status_interno = 'NOVO'`
  *(Ressalva de segurança: Se a proposta já estiver como `APROVADO`, ela ignorará essa reversão).*

Essa inteligência sistêmica foi desenhada para livrar o usuário da dependência de "clicar em Salvar" para desengavetar propostas onde as condições de pagamento foram totalmente removidas ou canceladas.
