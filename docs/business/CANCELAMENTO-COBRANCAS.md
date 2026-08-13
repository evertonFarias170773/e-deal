# CANCELAMENTO-COBRANCAS.md

Versão: 2.1  
Status: Oficial  
Última atualização: 11/08/2026  
Projeto: Vibe

---

# Padrão Unificado de Cancelamento de Cobranças

Este documento define as regras funcionais e técnicas para interromper cobranças no Vibe sem romper a sincronização entre o banco local e integrações externas.

Aplica-se a cobranças relacionadas a PIX, boleto, cartão e demais meios registrados em `public.pagamentos_v2`.

---

# Objetivo

Garantir que qualquer exclusão ou cancelamento:

- preserve a integridade financeira;
- respeite o estado real da cobrança;
- mantenha o ERP sincronizado com o provedor externo;
- preserve o histórico quando necessário;
- não altere propostas ou títulos indevidos;
- respeite a Matriz de Segurança de Escrita.

---

# Fontes Oficiais

## `public.pagamentos_v2`

Fonte principal para geração, conferência e acompanhamento das cobranças e pagamentos.

## `public.boletos`

Fonte específica para títulos bancários e para o módulo de Contas a Receber.

`public.boletos` não substitui `public.pagamentos_v2`, e `public.pagamentos_v2` não deve ser tratado como simples tabela de boletos.

---

# Regra de Autorização

Este documento define o comportamento esperado das ações `DELETE` e `CANCEL`.

A autorização real de escrita é definida por:

- `technical/MATRIZ-SEGURANCA-ESCRITA-SUPABASE.md`;
- políticas de RLS;
- permissões do usuário;
- implementação oficial do backend.

Enquanto a Matriz de Segurança mantiver `DELETE` bloqueado em determinada tabela, a exclusão física permanece desautorizada, mesmo que exista botão, método legado ou fluxo conceitual descrito neste documento.

Nenhuma nova exclusão física deve ser implementada ou ampliada sem decisão explícita e atualização da matriz.

---

# Tipos de Ação

## DELETE — Exclusão Física

Remove definitivamente o registro local.

Uso conceitual:

- ação de exclusão disponível na área de pagamentos da proposta;
- aplicável apenas quando a operação estiver autorizada;
- restrita a cobranças ainda não liquidadas;
- proibida quando houver obrigação de preservação histórica;
- proibida quando a Matriz de Segurança bloquear `DELETE`.

Quando houver integração externa, o frontend nunca pode apagar primeiro o registro local.

---

## CANCEL — Cancelamento Lógico

Preserva o registro e altera seu estado para:

```text
CANCELADO
```

Deve registrar um motivo em campo oficial, como:

```text
motivo_cancela
```

É a ação preferencial nos módulos Financeiro e Contas a Receber, pois mantém histórico e rastreabilidade.

---

# Regra de Ouro para Integrações Externas

Quando a cobrança possuir vínculo com banco, gateway, n8n ou outro provedor externo:

1. o frontend solicita o cancelamento ao backend oficial;
2. o backend consulta novamente o registro no banco;
3. o backend valida se a cobrança ainda pode ser cancelada;
4. o backend solicita o cancelamento ao provedor externo;
5. somente após confirmação externa o estado local pode ser alterado;
6. qualquer falha externa impede a alteração local.

A rota unificada documentada para esse fluxo é:

```text
POST /api/cobrancas/cancelar-externo
```

O frontend não deve atualizar diretamente `public.pagamentos_v2` ou `public.boletos` quando existir integração externa.

---

# Payload da Rota Unificada

Formato atualmente documentado:

```json
{
  "id": "uuid-da-cobranca",
  "tipo_cobranca": "BOLETO",
  "acao_local": "DELETE",
  "cod_c6": "codigo-externo",
  "id_empresa": 1,
  "motivo": "Cancelado por solicitação do cliente"
}
```

Valores aceitos para `acao_local`:

```text
DELETE
CANCEL
```

## Regra de confiança

O backend deve usar o `id` para buscar o registro real em `public.pagamentos_v2`.

Os campos enviados pelo frontend são auxiliares e devem ser comparados com os dados persistidos.

O backend nunca deve confiar exclusivamente em:

- `tipo_cobranca`;
- `cod_c6`;
- `id_empresa`;
- `status`;
- `confirmado`.

Quando houver divergência, a operação deve ser bloqueada e registrada como erro.

---

# Validações Obrigatórias no Backend

Antes de acionar qualquer integração ou escrita local, reconsultar a cobrança e validar:

- registro existente;
- `id_int` correspondente;
- `id_cliente` correspondente, quando aplicável;
- tipo de cobrança real;
- empresa recebedora;
- identificador externo;
- status atual;
- campo `confirmado`;
- existência de liquidação;
- permissão para a ação solicitada.

A cobrança não pode ser excluída nem cancelada quando:

```text
status = PAID
```

ou quando:

```text
status = A_VENCER
AND confirmado = true
```

Também deve ser bloqueada quando:

- `paid_at` estiver preenchido;
- `confirmado = true` representar confirmação financeira;
- o provedor informar liquidação;
- houver inconsistência entre o banco e o payload.

## Exceção autorizada: cancelamento de cobrança já paga

> **Exceção autorizada (11/08/2026): cancelamento de cobrança paga.**
> Restrito a super admin, pela rota `POST /api/cobrancas/cancelar-pago`, com motivo de catálogo e destino definido para o valor. Não passa por provedor externo, porque cobrança paga não tem título em aberto. Bloqueado quando a proposta já passou pela revisão do gerente (`REVISAO PRODUCAO` em diante) ou consta liberada para a produção (`is_prd_aprovado = true`) — nesse caso o gerente devolve a proposta para `REVISAO ATENDENTE` (ou a retira da produção) e só então o financeiro cancela. Exige confirmação explícita quando a confirmação for de mês anterior. As rotas `cancelar-externo` e `cancelar-boleto` continuam recusando cobrança paga.

Esta rota é o **único ponto oficial** para esse caso excepcional. Ela não enfraquece a regra geral desta seção — cobrança paga continua bloqueada em todos os demais fluxos, sem exceção — e não deve ser lida como o "cancelamento paralelo" que a seção Fonte da Verdade deste documento proíbe. Qualquer alteração de `status` ou `motivo_cancela` de uma cobrança paga fora desta rota permanece não autorizada.

---

# Cancelamento de Boleto

## Validação

Para boleto, o backend deve confirmar no banco:

- que o tipo real é boleto;
- que a cobrança não está liquidada;
- que não existe confirmação financeira impeditiva;
- que o identificador externo pertence à cobrança;
- que o `id_int` pertence à mesma proposta.

O identificador externo deve ser obtido prioritariamente do registro persistido.

Um valor enviado pelo frontend pode ser usado apenas como conferência, nunca como fonte única da decisão.

---

## Integração externa

O backend aciona o fluxo n8n ou provedor configurado no servidor.

A URL externa não deve ficar hardcoded no frontend nem ser tratada como contrato público da documentação.

Considera-se sucesso somente uma resposta HTTP válida na faixa `2xx` e compatível com o contrato atual da integração.

Respostas `4xx`, `5xx`, timeout ou retorno inválido devem interromper o fluxo local.

---

## Consequência local após sucesso externo

### Ação `CANCEL`

Atualizar somente a cobrança correta:

```sql
UPDATE public.pagamentos_v2
SET
  status = 'CANCELADO',
  motivo_cancela = :motivo
WHERE id = :id;
```

A implementação deve respeitar a camada oficial de acesso e não executar SQL direto no frontend.

### Ação `DELETE`

Somente quando houver autorização explícita na Matriz de Segurança.

A remoção de registros relacionados deve usar filtros compostos e identificar exatamente o título e a proposta:

```text
public.boletos:
id_boleto_c6 = identificador_externo
AND id_int = pagamento.id_int

public.pagamentos_v2:
id = pagamento.id
```

Nunca remover registros apenas por `id_int`, pois uma proposta pode possuir várias cobranças.

---

# PIX e Cartão

PIX e cartão podem possuir fluxos diferentes conforme empresa e integração ativa.

Antes de decidir entre fluxo local e externo, a implementação deve verificar:

- empresa recebedora;
- tipo de cobrança;
- identificador externo;
- integração realmente utilizada;
- regras atuais da Matriz de Segurança.

## Sem integração externa

A ausência de integração externa não autoriza automaticamente `DELETE`.

Enquanto a Matriz de Segurança bloquear exclusão física em `public.pagamentos_v2`, a operação deve permanecer bloqueada ou seguir cancelamento lógico, conforme o fluxo oficial.

## Com integração externa

Deve seguir o mesmo princípio:

```text
cancelar externamente
↓
confirmar sucesso
↓
alterar localmente
```

Uma rota que não suporte determinado provedor deve retornar erro explícito, sem alteração local.

---

# Cobranças Liquidadas ou Aprovadas

Para qualquer modalidade, o sistema deve proteger cobranças liquidadas em múltiplas camadas.

## Interface

- desabilitar a ação;
- informar o motivo;
- não ocultar silenciosamente o bloqueio.

## Provider ou serviço do frontend

- validar o objeto atual;
- interromper a chamada quando o estado já for impeditivo;
- não considerar essa validação suficiente para segurança.

## Backend

- reconsultar o registro imediatamente antes da operação;
- tratar o banco e o provedor como fontes reais;
- bloquear mudanças quando houver pagamento ou confirmação.

Essa revalidação evita excluir uma cobrança paga por webhook após a tela ter sido carregada.

---

# Reversão do Status da Proposta

Depois de um cancelamento ou exclusão autorizado, o sistema deve verificar as cobranças restantes da mesma proposta.

Devem ser desconsideradas cobranças em estados inativos, como:

```text
CANCELADO
EXTORNADO
RECUSADO
```

A lista definitiva deve seguir as regras financeiras oficiais.

## Reversão permitida

Quando não existir mais cobrança ativa e a proposta estiver no estado financeiro de espera:

```text
status_interno = AGUARDANDO
```

o sistema pode retornar para:

```text
status_interno = NOVO
```

## Proteções

Não reverter automaticamente quando:

- a proposta já estiver em estado comercial ou operacional avançado;
- `is_prd_aprovado = true`;
- existir pedido ou produção em andamento;
- a proposta estiver aprovada por outra regra oficial;
- houver cobrança ativa;
- a transição não estiver prevista no Fluxo Oficial de Status.

A reversão deve ocorrer no ponto oficial da arquitetura e nunca por atualização genérica baseada apenas na ausência de registros.

---

# Tratamento de Erros e UX

Em caso de falha:

- não alterar o banco local;
- manter o modal ou contexto da ação disponível;
- mostrar mensagem objetiva;
- diferenciar erro externo, bloqueio financeiro e falha interna;
- não informar sucesso parcial como sucesso completo;
- registrar detalhes técnicos somente em log seguro.

Mensagem funcional esperada:

```text
Não foi possível cancelar a cobrança no provedor financeiro.
Nenhuma alteração foi realizada no ERP.
```

Nunca exibir ao usuário:

- credenciais;
- tokens privados;
- payloads completos;
- stack traces;
- respostas sensíveis do provedor.

---

# Idempotência

O cancelamento externo deve ser seguro contra repetição de chamadas.

Antes de repetir uma operação, o backend deve verificar:

- se a cobrança já está cancelada;
- se o provedor já confirmou cancelamento;
- se a alteração local já foi aplicada;
- se a mesma solicitação está em processamento.

Uma repetição não pode cancelar outro título nem aplicar a reversão da proposta mais de uma vez.

---

# Auditoria

Sempre que o fluxo disponível permitir, registrar:

- cobrança;
- proposta;
- usuário responsável;
- ação solicitada;
- motivo;
- data e hora;
- resultado externo;
- resultado local;
- erro encontrado.

O motivo é obrigatório para cancelamento lógico.

---

# Validação Obrigatória

Antes de homologar uma alteração, validar:

- boleto pendente com cancelamento externo bem-sucedido;
- falha externa sem alteração local;
- cobrança paga com ação bloqueada;
- faturado aprovado com ação bloqueada;
- divergência entre payload e banco;
- proposta com várias cobranças;
- filtro composto no boleto;
- ausência de exclusão por `id_int` isolado;
- reversão de `AGUARDANDO` para `NOVO` sem cobrança ativa;
- ausência de reversão em proposta já liberada ou em produção;
- repetição da mesma solicitação;
- mensagens de erro para o usuário;
- ausência de regressão em `public.boletos`;
- ausência de regressão em `public.pagamentos_v2`.

---

# Documentação Relacionada

- `../SECURITY.md`
- `../BUSINESS_RULES.md`
- `../technical/MATRIZ-SEGURANCA-ESCRITA-SUPABASE.md`
- `./CHECKOUT-PAGAMENTOS.md`
- `./FLUXO-OFICIAL-STATUS-PROPOSTAS.md`

---

# Fonte da Verdade

Este documento define o comportamento oficial de cancelamento de cobranças.

A Matriz de Segurança define se cada operação de escrita está autorizada.

O backend e o provedor externo definem o estado real da operação.

Nenhum módulo deve criar cancelamento paralelo, atualizar o banco antes da confirmação externa ou excluir cobranças fora das regras homologadas.
