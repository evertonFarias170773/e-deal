# Padrão Unificado de Cancelamento de Cobranças

Este documento mapeia as regras de negócio e fluxos sistêmicos para o cancelamento de cobranças (boletos, PIX, cartões) dentro do ERP, garantindo que o banco de dados interno e os parceiros externos fiquem perfeitamente sincronizados.

## Tipos de Ação Local
Existem duas ações diferentes que o usuário pode tomar no sistema em relação à interrupção de um pagamento:

1. **DELETE (Exclusão Física)**
   - **Gatilho:** Botão "Excluir" na aba "Pagamentos" do painel de Orçamentos / Propostas.
   - **Comportamento:** A cobrança desaparece completamente do banco de dados (linha apagada).

2. **CANCEL (Cancelamento Lógico)**
   - **Gatilho:** Botões "Cancelar" no módulo Financeiro (Contas a Receber, tela de detalhe da cobrança).
   - **Comportamento:** A linha permanece no banco, mas o campo `status` é alterado para `CANCELADO`, preservando o histórico e exigindo um motivo justificado (`motivo_cancela`).

> [!WARNING]
> **A Regra de Ouro**: O Frontend nunca deve alterar o banco de dados local diretamente se a cobrança possuir uma **Integração Externa**. Nesses casos, o processo deve obrigatoriamente fluir pela rota unificada `/api/cobrancas/cancelar-externo`.

---

## Payload de Comunicação Unificada (`/api/cobrancas/cancelar-externo`)
Quando o Provider identifica a necessidade de integração, ele envia a requisição POST com o seguinte formato:

```json
{
  "id": "uuid-da-cobranca",
  "tipo_cobranca": "BOLETO", // ou PIX, CARTAO, etc
  "acao_local": "DELETE | CANCEL",
  "cod_c6": "codigo-gerado-pelo-banco",
  "id_empresa": 1,
  "motivo": "Cancelado via solicitação do cliente" // Opcional, usado quando acao_local = CANCEL
}
```

---

## 1. Cancelamento de BOLETOS

### Regras de Bloqueio (Backend)
Antes de processar qualquer cancelamento de boleto, a API verifica:
- `status` não pode ser `PAID`.
- `confirmado` não pode ser `true`.
- O payload `cod_c6` deve ser exatamente igual ao `cod_solicitacao_inter` gravado na tabela `pagamentos_v2`.
- O payload `id_empresa` deve bater com o banco de dados.

### Webhook Acionado (n8n)
- **URL**: `POST https://10074.hostoo.net.br/webhook/del-boleto-av-vibe`
- **Validação de Sucesso**: O sistema aguarda HTTP 200 **E** que o body (JSON) retornado contenha `{"success": true}`. Sem isso, a operação local é abortada.

### Consequências no Banco Local (Após sucesso do Banco Externo)

**Se `acao_local` == `DELETE`**:
- Tabela `public.boletos`:
  Deleção da linha usando a sintaxe OR:
  `DELETE FROM boletos WHERE id_boleto_c6 = cod_C6 OR id_int = pagamento.id_int;`
  *(Nota: a adição do `id_int` serve como dupla validação e limpeza de lixos gerados na mesma proposta)*
- Tabela `public.pagamentos_v2`:
  `DELETE FROM pagamentos_v2 WHERE cod_solicitacao_inter = cod_C6;`

**Se `acao_local` == `CANCEL`**:
- Tabela `public.pagamentos_v2`:
  `UPDATE pagamentos_v2 SET status = 'CANCELADO', motivo_cancela = '...' WHERE id = '...';`

### UX Esperada
- Botão travado exibindo `Cancelando boleto...` ou `Excluindo...` para prevenir duplo clique.
- Caso o parceiro externo (n8n/C6) recuse a ação, um `toast` vermelho indicará: "A API bancária recusou o cancelamento" ou "O webhook não confirmou sucesso".
- Caso a ação no banco falhe após confirmação externa (ex: falha de internet), o frontend orientará a atualizar a tela, e o banco passará pela rotina de limpeza manual da TI, garantindo não gerar faturamento falso.

---

## 2. Cancelamento de PIX e CARTÃO
*(Cancelamento externo ainda não implementado. Ao tentar cancelar PIX ou Cartão usando o endpoint externo, o sistema deve devolver HTTP 501 Não Implementado para bloquear operações cegas que abandonem links vivos no banco emissor).*
