# MAESTRO-FASE-2-PEDIDOS-FINANCEIRO.md

Versão: 2.0  
Status: Implementado  
Data da implementação: 04/07/2026  
Última revisão documental: 18/07/2026  
Projeto: ERP Ideal

---

# Maestro — Fase 2: Pedidos e Financeiro por Cliente

Este documento registra a implementação da Fase 2 do Maestro para consultas comerciais e financeiras vinculadas ao cliente ativo.

A fase opera somente com leitura server-side autenticada, preservando RLS e utilizando `id_cliente` como chave de resolução.

---

# 1. Objetivo

Permitir que o Maestro responda perguntas sobre:

- pedidos liberados para Produção;
- propostas ainda não liberadas;
- maior pedido;
- recebimentos por período;
- boletos em aberto;
- boletos vencidos;
- títulos não liquidados.

Este documento descreve o comportamento implementado nesta fase. Ele não autoriza escrita, alteração de status ou novas políticas de banco.

---

# 2. Arquivos da Implementação

## Arquivos criados

```text
src/features/maestro/core/simple/maestro-simple-propostas.server.ts
src/features/maestro/core/simple/maestro-simple-boletos.server.ts
```

## Arquivos alterados

```text
src/features/maestro/core/simple/maestro-simple-intents.ts
src/features/maestro/core/simple/maestro-simple-engine.ts
src/features/maestro/core/simple/maestro-simple-presenter.ts
docs/maestro/MAESTRO-PROMPT-BASE.md
```

Os caminhos devem ser confirmados no repositório antes de futuras alterações estruturais.

---

# 3. Contexto Obrigatório

Toda consulta desta fase depende de:

```text
simpleCtx.activeClient.clientInternalId
```

O valor representa o `id_cliente` interno usado nos filtros das tabelas operacionais.

Quando não houver cliente ativo resolvido, o Maestro deve interromper a consulta e solicitar a seleção ou confirmação do cliente.

Nunca consultar por nome livre quando o contexto já possuir `id_cliente`.

---

# 4. Separação Oficial das Fontes

| Domínio | Fonte | Chave |
|---|---|---|
| Propostas e pedidos liberados para Produção | `public.propostas` | `id_cliente` |
| Boletos e títulos bancários | `public.boletos` | `id_cliente` |
| Cobranças e recebimentos financeiros | `public.pagamentos_v2` | `id_cliente` |

Regras obrigatórias:

- não usar `public.pagamentos_v2` como substituto de `public.boletos`;
- não usar `public.boletos` como fonte geral de todos os pagamentos;
- não usar `public.propostas` como fonte de recebimento financeiro real;
- não somar propostas para responder quanto foi efetivamente recebido;
- não tratar proposta comercial como cobrança.

---

# 5. Regra de Pedido Liberado para Produção

Nesta fase, a consulta chamada historicamente de “pedido real” representa uma proposta liberada manualmente para a fila de Produção.

Filtro:

```sql
WHERE id_cliente = :id_cliente
  AND is_prd_aprovado = true
  AND is_reproved = false
```

Regra crítica:

```text
status_interno = 'APROVADO'
```

não substitui:

```text
is_prd_aprovado = true
```

Uma proposta comercial aprovada pode ainda não estar liberada para Produção.

---

# 6. Intenções Implementadas

## 6.1 `client_recent_orders`

Consulta os últimos pedidos liberados para Produção do cliente ativo.

### Gatilhos

- “últimos pedidos”;
- “últimas compras”;
- “quais pedidos ele fez?”;
- “pedidos recentes”;
- “quantos pedidos?”;
- “ele já comprou?”.

### Filtro

```sql
WHERE id_cliente = :id_cliente
  AND is_prd_aprovado = true
  AND is_reproved = false
ORDER BY created_at DESC
LIMIT 5
```

### Campos retornados

```text
id_int
status_interno
valor_total
valor
created_at
vendedor
```

### Regra de valor

```typescript
const valor = row.valor_total ?? row.valor ?? null;
```

Quando o valor estiver ausente, apresentar:

```text
valor não disponível
```

Não inventar nem estimar o valor.

---

## 6.2 `client_revenue_period`

Consulta o valor efetivamente recebido no período.

### Fonte

```text
public.pagamentos_v2
```

### Gatilhos

- “faturamento”;
- “quanto faturou?”;
- “quanto recebeu?”;
- “total recebido”;
- “valor recebido”.

### Regra atual de consulta

```sql
WHERE id_cliente = :id_cliente
  AND confirmado = true
  AND status = 'PAID'
  AND paid_at >= :inicio_periodo
  [AND paid_at < :fim_periodo]
```

A soma é realizada sobre `valor` após o fetch.

### Interpretação

Essa intenção responde sobre recebimento financeiro.

Ela não deve somar valores de `public.propostas`.

Registros `A_VENCER` confirmados representam recebimento futuro autorizado e não entram como dinheiro já recebido nesta intenção.

---

## 6.3 `client_biggest_order`

Consulta o pedido liberado para Produção de maior valor.

### Gatilhos

- “maior pedido”;
- “maior compra”;
- “pedido de maior valor”;
- “pedido mais alto”.

### Fonte

```text
public.propostas
```

### Regras

- filtrar pelo cliente ativo;
- considerar apenas `is_prd_aprovado = true`;
- excluir registros reprovados;
- comparar `valor_total ?? valor`;
- não incluir propostas ainda não liberadas para Produção;
- informar quando nenhum valor estiver disponível.

A implementação atual busca um conjunto limitado de registros e conclui a ordenação pelo valor consolidado no código.

---

## 6.4 `client_open_proposals`

Consulta propostas que ainda não foram liberadas para Produção.

### Gatilhos

- “propostas não aprovadas”;
- “orçamentos abertos”;
- “propostas pendentes”;
- “ainda não aprovadas”.

### Filtro atual

```sql
WHERE id_cliente = :id_cliente
  AND is_prd_aprovado = false
  AND is_reproved = false
  AND created_at >= :primeiro_dia_mes_atual
ORDER BY created_at DESC
```

### Limite funcional

A intenção mostra somente propostas do mês atual para reduzir poluição do histórico.

A resposta deve deixar esse recorte explícito.

Exemplo:

> Encontrei as propostas ainda não liberadas para Produção neste mês.

Não chamar todas essas propostas de “não aprovadas” quando o dado consultado representa especificamente ausência de liberação produtiva.

---

## 6.5 `client_boletos_status`

Consulta títulos bancários do cliente.

### Fonte

```text
public.boletos
```

### Gatilhos seguros

- “boleto”;
- “boleto em atraso”;
- “boleto vencido”;
- “título não liquidado”;
- “inadimplência de boleto”;
- “está devendo boleto?”.

A palavra “cobrança” isolada é ambígua e não deve ser tratada automaticamente como boleto sem contexto suficiente.

### Subfiltros

| Intenção detectada | Regra |
|---|---|
| Atrasado ou vencido | `paid_at IS NULL AND dias_atraso > 0` |
| Não liquidado | `paid_at IS NULL` |
| Em aberto | `paid_at IS NULL AND status = 'A_VENCER'` |
| Boleto genérico | `paid_at IS NULL` |

### Campos permitidos

```text
id_int
vencimento
valor
valor_atualizado
status
dias_atraso
n_nf
paid_at
```

### Campos proibidos

```text
linha_digitavel
codigo_barras
url_pdf
id_boleto_c6
nosso_numero
ext_reference
msg_whats
```

Esses campos não devem ser enviados ao modelo nem exibidos na resposta desta intenção.

---

# 7. Regras de Período

## Mês atual

Do primeiro dia do mês corrente até o momento da consulta.

```typescript
const desde = new Date(Date.UTC(year, month, 1)).toISOString();
```

## Mês passado

Mês calendário anterior completo.

```typescript
const desde = new Date(Date.UTC(year, month - 1, 1)).toISOString();
const ate = new Date(Date.UTC(year, month, 1)).toISOString();
```

## Últimos 30 dias

Período móvel de 30 dias corridos.

```typescript
const d = new Date();
d.setUTCDate(d.getUTCDate() - 30);
const desde = d.toISOString();
```

## Expressão ambígua

A expressão “último mês” pode significar mês calendário anterior ou últimos 30 dias.

A implementação atual interpreta como últimos 30 dias e deve informar esse critério na resposta.

---

# 8. Regras de Liquidação de Boletos

```text
paid_at IS NULL
→ título não liquidado
```

```text
paid_at IS NOT NULL
→ título liquidado
```

```text
paid_at IS NULL
AND dias_atraso > 0
→ título em atraso
```

```text
paid_at IS NULL
AND status = 'A_VENCER'
→ título em aberto dentro do fluxo atual
```

A classificação deve permanecer alinhada aos campos reais da tabela e às regras do módulo de Contas a Receber.

---

# 9. Arquitetura do Fluxo

```text
query
↓
detectIntent()
↓
validar activeClient.clientInternalId
↓
selecionar adapter server-side
↓
executar SELECT autenticado
↓
presenter
↓
toResult()
↓
humanizeWithBrain(), quando habilitado
```

Quando:

```text
MAESTRO_SIMPLE_LLM_ENABLED = true
```

a camada de linguagem pode humanizar a resposta.

Ela não pode alterar os dados, filtros, totais ou regras retornadas pelo código determinístico.

---

# 10. Adapters Server-side

## Propostas

Arquivo:

```text
maestro-simple-propostas.server.ts
```

Responsabilidades documentadas:

- `buscarUltimosPedidos`;
- `calcularFaturamentoPeriodo`;
- `buscarMaiorPedido`;
- `buscarPropostasNaoAprovadas`.

A função de faturamento deve continuar consultando `public.pagamentos_v2`, mesmo estando agrupada no fluxo desta fase.

## Boletos

Arquivo:

```text
maestro-simple-boletos.server.ts
```

Responsabilidades documentadas:

- `buscarBoletosCliente`;
- `buscarBoletosEmAberto`;
- `buscarBoletosEmAtraso`;
- `buscarBoletosNaoLiquidados`.

---

# 11. Segurança

Esta fase deve permanecer:

- somente `SELECT`;
- autenticada pela sessão real;
- protegida por RLS;
- sem `service_role`;
- sem token enviado no body;
- sem client anônimo para dados protegidos;
- sem `INSERT`;
- sem `UPDATE`;
- sem `DELETE`;
- sem `UPSERT`;
- sem alteração de schema;
- sem retorno de campos financeiros sensíveis.

O modelo de linguagem não recebe credenciais nem executa consultas diretamente.

---

# 12. Follow-ups Suportados

Com cliente ativo:

| Pergunta | Intenção esperada |
|---|---|
| “E o maior?” | `client_biggest_order` |
| “E este mês?” | `client_revenue_period`, período `mes_atual` |
| “Tem vencido?” | `client_boletos_status`, filtro `atraso` |
| “Quais ainda não foram liberadas?” | `client_open_proposals` |
| “E nos últimos 30 dias?” | `client_revenue_period`, período `ultimos_30_dias` |

O follow-up deve continuar usando o mesmo cliente ativo.

Quando o contexto estiver ausente ou ambíguo, o Maestro deve pedir confirmação.

---

# 13. Roteiro de Validação

## Cliente ativo

1. Buscar ou selecionar o cliente `8469`.
2. Confirmar que o contexto possui `clientInternalId`.

## Últimos pedidos

Pergunta:

```text
Quais são os últimos pedidos dele?
```

Esperado:

- consulta em `public.propostas`;
- `is_prd_aprovado = true`;
- `is_reproved = false`;
- até 5 registros;
- sem propostas de outro cliente.

## Recebimento no período

Pergunta:

```text
Qual foi o valor recebido desse cliente nos últimos 30 dias?
```

Esperado:

- consulta em `public.pagamentos_v2`;
- `status = 'PAID'`;
- `confirmado = true`, conforme a implementação atual;
- filtro por `paid_at`;
- soma de `valor`;
- nenhuma soma de propostas.

## Maior pedido

Pergunta:

```text
Qual foi o pedido de maior valor e quando foi criado?
```

Esperado:

- apenas pedidos liberados para Produção;
- `id_int`;
- valor consolidado;
- data;
- status;
- nenhuma proposta ainda não liberada.

## Propostas do mês

Pergunta:

```text
Quais propostas ainda não foram liberadas para Produção neste mês?
```

Esperado:

- `is_prd_aprovado = false`;
- `is_reproved = false`;
- somente mês atual;
- recorte temporal informado na resposta.

## Boletos em aberto

Pergunta:

```text
Ele possui boletos em aberto?
```

Esperado:

```text
paid_at IS NULL
AND status = 'A_VENCER'
```

## Boletos atrasados

Pergunta:

```text
Tem boleto atrasado?
```

Esperado:

```text
paid_at IS NULL
AND dias_atraso > 0
```

## Boletos não liquidados

Pergunta:

```text
Tem algum título não liquidado?
```

Esperado:

```text
paid_at IS NULL
```

## Continuidade da Fase 1

Perguntas:

```text
Quais são os endereços desse cliente?
Quem são os contatos?
```

Esperado:

- manter os adapters já homologados da Fase 1;
- não regredir as consultas cadastrais;
- manter o mesmo cliente ativo.

---

# 14. Riscos e Limites

- “Pedido” nesta fase significa proposta liberada para Produção.
- “Faturamento” na intenção financeira significa valor recebido, não soma de propostas.
- “Último mês” é interpretado como últimos 30 dias na implementação atual.
- A consulta de propostas abertas considera somente o mês atual.
- A palavra “cobrança” pode ser ambígua entre `pagamentos_v2` e `boletos`.
- Nenhuma intenção desta fase autoriza alteração de dados.
- Mudanças nos filtros devem ser validadas contra o código real e as regras oficiais.

---

# 15. Documentação Relacionada

- `./MAESTRO-KNOWLEDGE-BASE.md`
- `./MAESTRO-CATALOGO-CONSULTAS-CLIENTES.md`
- `./STATUS-MAESTRO-V2.md`
- `../BUSINESS_RULES.md`
- `../SECURITY.md`
- `../business/FLUXO-OFICIAL-STATUS-PROPOSTAS.md`
- `../business/CHECKOUT-PAGAMENTOS.md`
- `../technical/MATRIZ-SEGURANCA-ESCRITA-SUPABASE.md`

---

# Fonte da Verdade

Este documento registra o comportamento implementado na Fase 2 do Maestro para consultas comerciais e financeiras por cliente.

O código atual define os adapters e filtros efetivamente executados.

A base de conhecimento e as regras de negócio definem a interpretação correta das entidades.

Nenhuma alteração futura deve misturar propostas, boletos e recebimentos ou transformar consultas desta fase em escrita sem autorização específica.
