# Maestro — Fase 2: Pedidos e Financeiro por Cliente

> **Status:** Implementado  
> **Data de implementação:** 2026-07-04  
> **Arquivos criados nesta fase:**  
> - `src/features/maestro/core/simple/maestro-simple-propostas.server.ts`  
> - `src/features/maestro/core/simple/maestro-simple-boletos.server.ts`  
> **Arquivos alterados:**  
> - `src/features/maestro/core/simple/maestro-simple-intents.ts`  
> - `src/features/maestro/core/simple/maestro-simple-engine.ts`  
> - `src/features/maestro/core/simple/maestro-simple-presenter.ts`  
> - `docs/MAESTRO-PROMPT-BASE.md`

---

## 1. Objetivo

Permitir que o Maestro responda perguntas comerciais e financeiras básicas sobre o **cliente ativo** na sessão, usando consultas `SELECT` server-side autenticadas via RLS.

Toda consulta usa `id_cliente` (inteiro interno do banco) como chave.

---

## 2. Regra Fundamental de Pedido Real

> No ERP Ideal, **pedido** = proposta confirmada/aprovada para produção.

```sql
-- Filtro obrigatório para "pedido real"
WHERE is_prd_aprovado (regra provisória de liberação de pedido) = true
  AND is_reproved    = false
```

> ⚠️ `status_interno = 'APROVADO'` **NÃO** equivale a pedido real.  
> Existem registros com `status_interno = 'APROVADO'` e `is_prd_aprovado (regra provisória de liberação de pedido) = false`.

---

## 3. Fontes de Dados

| Dado | Tabela | Chave |
|------|--------|-------|
| Pedidos / Propostas | `public.propostas` | `id_cliente` |
| Boletos / Cobrança | `public.boletos` | `id_cliente` |
| Faturamento Financeiro / Recebido | `public.pagamentos_v2` | `id_cliente` |

> ❌ **Não usar** `pagamentos_v2` para boletos — são sistemas distintos.
> ❌ **Não usar** `propostas` para faturamento financeiro/recebimento real — são sistemas distintos (Comercial vs Financeiro).

---

## 4. Intenções Implementadas

### 4.1 `client_recent_orders` — Últimos Pedidos

**Gatilhos:** "últimos pedidos", "últimas compras", "quais pedidos ele fez?", "pedidos recentes", "quantos pedidos", "já comprou"

**Filtro:**
```sql
WHERE id_cliente = :id_cliente
  AND is_prd_aprovado (regra provisória de liberação de pedido) = true
  AND is_reproved = false
ORDER BY created_at DESC
LIMIT 5
```

**Campos retornados:** `id_int`, `status_interno`, `valor_total ?? valor`, `created_at`, `vendedor`

**Resposta esperada:**
```
Encontrei 5 pedidos confirmados para MB SOLUÇÕES:
• #18560 — R$ 1.250,00 — 10/06/2026 — LIBERADO
• #18540 — R$ 980,00 — 05/06/2026 — EM IMPRESSAO
```

---

### 4.2 `client_revenue_period` — Faturamento Financeiro por Período

**Gatilhos:** "faturamento", "quanto faturou", "quanto recebeu", "total recebido", "valor recebido"

**Períodos:**
| Frase do usuário | Período |
|-----------------|---------|
| "este mês" / "esse mês" / "mês atual" | `mes_atual` — do 1º dia do mês até hoje |
| "mês passado" / "mês anterior" | `mes_passado` — mês calendário anterior completo |
| "último mês" *(ambíguo)* | `ultimos_30_dias` — 30 dias corridos (explicar ao usuário) |

**Filtro:**
```sql
WHERE id_cliente = :id_cliente
  AND confirmado = true
  AND status = 'PAID'
  AND paid_at >= :inicio_periodo
  [AND paid_at < :fim_periodo]
```

**Soma:** `valor` em JavaScript (após fetch)

---

### 4.3 `client_biggest_order` — Maior Pedido

**Gatilhos:** "maior pedido", "maior compra", "pedido de maior valor", "pedido mais alto"

**Busca:** Fetch top 50 por `valor_total desc nulls last, valor desc nulls last`, ordena coalesced em JS para precisão.

**Resposta esperada:**
```
O maior pedido confirmado foi o #18555, no valor de R$ 8.900,00, criado em 10/06/2026 — status: EM IMPRESSAO.
```

---

### 4.4 `client_open_proposals` — Propostas Não Aprovadas

**Gatilhos:** "propostas não aprovadas", "orçamentos abertos", "propostas pendentes", "ainda não aprovadas"

**Filtro:**
```sql
WHERE id_cliente = :id_cliente
  AND is_prd_aprovado (regra provisória de liberação de pedido) = false
  AND is_reproved = false
  AND created_at >= primeiro_dia_mes_atual
ORDER BY created_at DESC
```

> Mostra apenas propostas **deste mês** para evitar poluição de histórico.

---

### 4.5 `client_boletos_status` — Boletos do Cliente

**Gatilhos:** "boleto", "cobrança", "em atraso", "vencido", "não liquidado", "inadimplência", "devendo"

**Sub-filtros detectados automaticamente:**

| Keyword detectada | Filtro | Query |
|-------------------|--------|-------|
| "em atraso" / "atrasado" / "vencido" | `atraso` | `paid_at IS NULL AND dias_atraso > 0` |
| "não liquidado" / "inadimplência" / "devendo" | `nao_liquidado` | `paid_at IS NULL` |
| "em aberto" / "aberto" | `aberto` | `paid_at IS NULL AND status = 'A_VENCER'` |
| genérico ("tem boleto?") | `todos` | `paid_at IS NULL` |

**Campos retornados:** `id_int`, `vencimento`, `valor`, `valor_atualizado`, `status`, `dias_atraso`, `n_nf`, `paid_at`

**Campos NUNCA retornados:** `linha_digitavel`, `codigo_barras`, `url_pdf`, `id_boleto_c6`, `nosso_numero`, `ext_reference`, `msg_whats`

---

## 5. Regras de Valor

```typescript
// Coalesce de valor (em TypeScript — não no banco)
const valor = row.valor_total ?? row.valor ?? null;
// Se null → exibir "valor não disponível"
// Nunca somar proposta sem valor (contribui 0 ao total)
```

---

## 6. Regras de Período para Faturamento

```typescript
// mes_atual
const desde = new Date(Date.UTC(year, month, 1)).toISOString();

// mes_passado
const desde = new Date(Date.UTC(year, month - 1, 1)).toISOString();
const ate   = new Date(Date.UTC(year, month, 1)).toISOString();

// ultimos_30_dias (default)
const d = new Date(); d.setUTCDate(d.getUTCDate() - 30);
const desde = d.toISOString();
```

---

## 7. Regras de Liquidação de Boletos

```
paid_at IS NULL     → não liquidado
paid_at IS NOT NULL → liquidado/pago
dias_atraso > 0     → em atraso
status = 'A_VENCER' → em aberto (dentro do prazo)
```

---

## 8. Arquitetura

```
query → detectIntent (intents.ts)
      → se client_recent_orders / revenue_period / biggest_order / open_proposals / boletos_status
        → verificar simpleCtx.activeClient.clientInternalId
        → se null: presenterSemClienteComercial()
        → se ok: buscar adapter server-side → presenter → toResult()
      → humanizeWithBrain (se MAESTRO_SIMPLE_LLM_ENABLED=true)
```

**Adapters server-side:**
- `maestro-simple-propostas.server.ts` → `buscarUltimosPedidos`, `calcularFaturamentoPeriodo`, `buscarMaiorPedido`, `buscarPropostasNaoAprovadas`
- `maestro-simple-boletos.server.ts` → `buscarBoletosCliente` (facade) → `buscarBoletosEmAberto`, `buscarBoletosEmAtraso`, `buscarBoletosNaoLiquidados`

---

## 9. Segurança

- ✅ Somente `SELECT` — sem `INSERT`, `UPDATE`, `DELETE`, `UPSERT`
- ✅ RLS preservado — usa Supabase client autenticado via cookies
- ✅ Sem service_role
- ✅ Sem token no body
- ✅ Sem linha digitável / código de barras / PIX
- ✅ Usa `public.pagamentos_v2` apenas para faturamento/recebimento financeiro real em consultas de período ou comparação.
- ✅ Sem escrita ou alteração de banco

---

## 10. Follow-ups suportados

Com cliente ativo, o Maestro responde corretamente:
- "e o maior?" → `client_biggest_order`
- "e esse mês?" → `client_revenue_period` (periodo=mes_atual)
- "tem vencido?" → `client_boletos_status` (filtro=atraso)
- "quais não foram aprovados?" → `client_open_proposals`
- "e nos últimos 30 dias?" → `client_revenue_period` (periodo=ultimos_30_dias)

---

## 11. Validação

```
1. Buscar cliente 8469
2. "quais os últimos pedidos dele?"
   → Espera: lista de pedidos com is_prd_aprovado (regra provisória de liberação de pedido)=true

3. "qual faturamento desse cliente no último mês?"
   → Espera: soma de pedidos reais nos últimos 30 dias

4. "qual foi o pedido de maior valor? e quando foi?"
   → Espera: id_int + valor + data do maior pedido

5. "quais propostas ainda não foram aprovadas esse mês?"
   → Espera: lista com is_prd_aprovado (regra provisória de liberação de pedido)=false do mês atual

6. "ele tem boletos em aberto?"
   → Espera: boletos com paid_at IS NULL AND status='A_VENCER'

7. "tem boleto atrasado?"
   → Espera: boletos com paid_at IS NULL AND dias_atraso > 0

8. "tem alguma cobrança não liquidada?"
   → Espera: todos os boletos com paid_at IS NULL

9. "quais os endereços desse cliente?"
   → Espera: continua usando Fase 1 (public.enderecos)

10. "quem são os contatos?"
    → Espera: continua usando Fase 1 (public.contatos)
```
