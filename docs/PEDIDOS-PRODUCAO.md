# Pedidos / Produção — Documentação Conceitual

> **Versão**: 0.3 — Respostas operacionais do Everton: fluxo real, numeração avançada, papéis, kanban
>
> **Status**: Descoberta e modelagem. Nenhuma tabela criada. Nenhum código implementado.
>
> **Autor**: Antigravity AI — ERP Ideal, branch `erp-ideal-preview`
>
> **Data**: 2026-06-02

---

## 1. Visão Geral do Módulo

O módulo de **Pedidos / Produção** representa a ponte operacional entre o mundo comercial e o mundo fabril da gráfica. É onde uma venda se transforma em produto físico.

> 🏭 **O coração da produção é a Impressão.** Tudo que acontece antes (arte, numeração, aprovação) serve para alimentar a impressão corretamente. Tudo que acontece depois (acabamento, pesagem, expedição) serve para entregar o que foi impresso.

> ⚠️ **A produção começa pela Arte Final — não pelo pagamento.** Na operação real, o trabalho de arte inicia assim que o cliente confirma o pedido, mesmo antes da aprovação financeira. O sistema deve suportar e não bloquear esse fluxo.

O módulo responde às perguntas operacionais do dia a dia:
- "Qual é o mais urgente agora?"
- "A arte do Modelo Azul já foi aprovada pelo cliente?"
- "Qual designer está responsável por esse pedido?"
- "Faltou material — pode mandar o que está pronto?"
- "Quem vai retirar o pedido?"
- "Como está a fila de impressão hoje?"
- "O peso real confere com o cadastrado?"

Este módulo **não** controla financeiro, pagamentos ou notas fiscais.
Ele consome o resultado financeiro (proposta liberada) e entrega o produto para expedição.

**Produtos mais frequentes**: pulseiras e cartões.

**Escala crítica**: com ~50 pedidos a operação funciona. Com ~120 vira caos sem sistema.

---

## 2. Glossário: Diferença entre as Entidades

| Entidade | O que é | Exemplo real |
|---|---|---|
| **Proposta** | O orçamento/venda comercial. Pode estar em negociação, aprovada ou cancelada. | Proposta #3412 — 3.000 Tribands para Cliente X, R$ 4.200,00 |
| **Pedido** | A proposta aprovada que entra na fila de produção. Tem status operacional. | Pedido #3412 — originado da proposta #3412 |
| **Item da Proposta** | Um produto dentro da proposta (ex: Triband 3000 un.). Pode ser vários produtos. | Item: Triband — Qtd: 3.000 — Valor: R$ 4.200,00 |
| **Item do Pedido** | Espelho/snapshot do item da proposta no momento da aprovação. | Item: Triband — Qtd: 3.000 (confirmado) |
| **Modelo/Lote** | Subdivisão do item para produção. Um item com 3.000 un. pode ter 4 modelos. | Modelo A: 750 un. — Modelo B: 750 un. — Modelo C: 1.000 un. — Modelo D: 500 un. |
| **Arte** | Arquivo gráfico vinculado a um modelo. Pode passar por revisões e aprovação. | arte_triband_modelo_a_v2.pdf — Status: Aprovada |
| **OS (Ordem de Serviço)** | Instrução técnica completa para o impressor. Gerada a partir do pedido + modelos. | OS #3412-A: Triband 750 un., numeração 001-750, arte aprovada, frente e verso |

---

## 3. Relação com `propostas.id_int`

`id_int` é a chave operacional central de todo o fluxo comercial do ERP Ideal.

```text
propostas.id_int
  └─ pagamentos_v2.id_int        (financeiro — já existe)
  └─ produtos_proposta.id_int    (itens da proposta — já existe)
  └─ cotacao_frete.id_int        (frete — já existe)
  └─ propostas_chat.id_int       (chat/timeline operacional — já existe ✅)
  └─ propostas_pendencias.id_int (pendências entre setores — já existe ✅)
  └─ pedidos.id_int              (pedido — futuro)
  └─ pedidos_modelos.id_int      (modelos/lotes — futuro)
  └─ pedidos_artes.id_int        (artes por modelo — futuro)
  └─ ordens_servico.id_int       (OS — futuro)
```

**Regra fundamental**: todo registro do módulo de Produção deve ser rastreável até um `id_int`.

> 💡 **Princípio de reaproveitamento**: As tabelas `public.propostas_chat` e `public.propostas_pendencias` já existem, estão em produção e usam `id_int` como chave. O módulo de Pedidos/Produção **não criará uma nova timeline**. Toda a comunicação operacional entre Comercial, Arte, Produção, Financeiro e Expedição será registrada nessas tabelas já existentes.

---

## 4. Ciclo de Vida do Pedido

> ⚡ **Regra real confirmada pelo Everton**: A produção começa pela **Arte Final**, não pelo pagamento. O fluxo abaixo reflete a operação real da gráfica.

```text
[CLIENTE CONFIRMA PEDIDO / PROPOSTA CRIADA]
         │
         ▼
 ┌─────────────────────────┐
 │  NOVO / ARTE PENDENTE   │  ← Pedido criado, aguardando recebimento de arte
 └─────────────────────────┘
         │  cliente envia logos, fotos, refs via WhatsApp/sistema
         ▼
 ┌─────────────────────────────────┐
 │  ARTE EM ANDAMENTO              │  ← Designer trabalhando na arte
 └─────────────────────────────────┘
         │  designer salva arte no sistema
         ▼
 ┌──────────────────────────────────────┐
 │  AGUARDANDO APROVAÇÃO DO CLIENTE     │  ← Link enviado ao cliente para aprovar
 └──────────────────────────────────────┘
         │  cliente aprova / solicita ajuste / reprova
         │  (ciclo repete por modelo até aprovação total)
         ▼
 ┌─────────────────────────────────────────────┐
 │  ARTE APROVADA / LIBERADA PELO ATENDENTE    │  ← Atendente faz aprovação final
 └─────────────────────────────────────────────┘
         │  gerente de produção analisa e imprime OS
         ▼
 ┌──────────────────────────────┐
 │  EM IMPRESSÃO  🖨️            │  ← CORAÇÃO DA PRODUÇÃO
 └──────────────────────────────┘
         │
         ▼
 ┌──────────────────────────────┐
 │  ACABAMENTO                  │  ← Guilhotina, serrilha, dobra etc.
 └──────────────────────────────┘
         │
         ▼
 ┌──────────────────────────────┐
 │  REVISÃO FINAL / PACOTES     │  ← Conferência, embalagem, pesagem
 └──────────────────────────────┘
         │  peso real ≠ peso cadastrado → alerta
         ▼
 ┌──────────────────────────────┐
 │  PRONTO PARA EXPEDIÇÃO       │
 └──────────────────────────────┘
         │
         ▼
 ┌──────────────────────────────┐
 │  EXPEDIDO / ENTREGUE         │
 └──────────────────────────────┘
```

### Status sugeridos para `pedidos.status_pedido`

| Status | Descrição operacional |
|---|---|
| `NOVO` | Pedido criado, aguardando recebimento de arte/dados |
| `ARTE_EM_ANDAMENTO` | Designer trabalhando na arte |
| `AGUARDANDO_APROVACAO_CLIENTE` | Link enviado ao cliente para aprovação |
| `AGUARDANDO_APROVACAO_ATENDENTE` | Cliente aprovou, aguardando liberação final do atendente |
| `AGUARDANDO_OS` | Arte liberada, gerente ainda não gerou a OS |
| `EM_IMPRESSAO` | ⭐ Impressão em andamento — status principal da produção |
| `EM_ACABAMENTO` | Guilhotina, serrilha, dobra, laminação etc. |
| `REVISAO_FINAL` | Conferência, embalagem e pesagem |
| `AGUARDANDO_MATERIAL` | Faltam insumos para continuar |
| `PAUSADO` | Parado por decisão interna ou comercial |
| `PRONTO_EXPEDICAO` | Produção finalizada, aguardando expedição |
| `EXPEDIDO` | Transferido para o módulo de Expedição |
| `FINALIZADO` | Entrega confirmada |
| `CANCELADO` | Pedido cancelado |

---

## 5. Ciclo de Vida da Arte

A arte de um modelo passa por **três camadas de aprovação** antes de ir para impressão:
1. Designer cria → **atendente revisa internamente**
2. Atendente envia link → **cliente aprova externamente**
3. Após aprovação do cliente → **atendente faz liberação final** modelo por modelo

```text
[MODELO CRIADO / DADOS RECEBIDOS DO CLIENTE]
         │  (logos, fotos, refs via WhatsApp/sistema)
         ▼
 ┌──────────────────────────────────┐
 │  PENDENTE                        │  ← Aguardando designer iniciar
 └──────────────────────────────────┘
         │  atendente designa designer responsável
         ▼
 ┌──────────────────────────────────┐
 │  EM CRIAÇÃO (designer)           │  ← Designer trabalhando na arte
 └──────────────────────────────────┘
         │  designer salva e notifica atendente
         ▼
 ┌──────────────────────────────────────┐
 │  EM REVISÃO INTERNA (atendente)      │  ← Atendente confere antes de enviar ao cliente
 └──────────────────────────────────────┘
         │  aprovação interna → link gerado e enviado ao cliente
         ▼
 ┌────────────────────────────────────────┐
 │  AGUARDANDO APROVAÇÃO DO CLIENTE       │  ← Cliente vê arte no link/checkout
 └────────────────────────────────────────┘
         │
         ├─── Cliente REPROVA → REPROVADA PELO CLIENTE
         │         │  cliente registra motivo no link
         │         │  designer recebe notificação
         │         │  nova versão → ciclo reinicia
         │
         └─── Cliente APROVA
                   │
                   ▼
         ┌──────────────────────────────────────┐
         │  APROVADA PELO CLIENTE               │
         │  aguardando liberação do atendente   │
         └──────────────────────────────────────┘
                   │  atendente libera modelo por modelo
                   ▼
         ┌──────────────────────────────────────┐
         │  LIBERADA PARA PRODUÇÃO ✅            │  ← Aprovação final do atendente
         └──────────────────────────────────────┘
                   │  gerente imprime OS deste modelo
                   ▼
         ┌──────────────────────────────────────┐
         │  IMPRESSA                            │
         └──────────────────────────────────────┘
```

### Status sugeridos para `pedidos_artes.status`

| Status | Descrição | Quem age |
|---|---|---|
| `PENDENTE` | Aguardando início do designer | Atendente |
| `EM_CRIACAO` | Designer trabalhando na arte | Designer |
| `EM_REVISAO_INTERNA` | Arte pronta, atendente revisando antes de enviar ao cliente | Atendente |
| `AGUARDANDO_CLIENTE` | Link enviado ao cliente, aguardando resposta | Cliente |
| `REPROVADA_CLIENTE` | Cliente reprovou, aguardando nova versão | Designer |
| `APROVADA_CLIENTE` | Cliente aprovou, aguardando liberação do atendente | Atendente |
| `LIBERADA` | Atendente liberou para produção | Gerente de Produção |
| `IMPRESSA` | Arte enviada para impressão | — |
| `NAO_NECESSARIA` | Produto sem personalização | — |

---

## 6. Estrutura Conceitual de Dados

> ⚠️ Isto é um desenho conceitual. **Nenhuma tabela existe ainda** nesta modelagem. O banco ainda não foi alterado. As tabelas precisam ser revisadas com Everton antes de qualquer migration.

### 6.1 `pedidos` — Pedido principal

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | uuid | Chave primária do banco |
| `id_int` | integer | Chave da proposta de origem (FK → `propostas.id_int`) |
| `id_cliente` | integer | ID do cliente |
| `id_empresa` | integer | Empresa responsável |
| `id_vendedor` | integer ou text | Vendedor da proposta |
| `id_endereco` | integer | Endereço de entrega (FK → `enderecos`) |
| `status_pedido` | text | Status operacional do pedido |
| `status_producao` | text | Status da produção (PENDENTE, EM_PRODUCAO, CONCLUIDA) |
| `status_expedicao` | text | Status de expedição |
| `valor_total` | numeric | Valor do pedido (espelho da proposta no momento) |
| `forma_pagamento` | text | Forma de pagamento registrada |
| `data_pedido` | timestamptz | Data de criação do pedido |
| `data_prevista_entrega` | date | Previsão de entrega |
| `data_aprovacao_arte` | timestamptz | Data de aprovação geral das artes |
| `data_termino` | timestamptz | Data de encerramento/conclusão |
| `obs` | text | Observações gerais |
| `created_at` | timestamptz | Data de criação |
| `updated_at` | timestamptz | Data de última atualização |

> **Nota**: A tabela `public.pedidos` já pode existir no banco com alguns campos. Ela precisa ser revisada e possivelmente expandida.

---

### 6.2 `pedidos_itens` — Itens do pedido (espelho de `produtos_proposta`)

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | uuid | Chave primária |
| `id_int` | integer | FK → `propostas.id_int` |
| `id_pedido` | uuid | FK → `pedidos.id` |
| `id_produto` | integer | FK → `produtos.id_produto` |
| `nome_produto` | text | Nome snapshot do produto no momento do pedido |
| `descricao` | text | Descrição do item |
| `quantidade_total` | integer | Quantidade total do item (ex: 3.000) |
| `valor_unitario` | numeric | Valor unitário no momento do pedido |
| `valor_subtotal` | numeric | Subtotal do item |
| `prazo` | text | Prazo de produção |
| `obs_producao` | text | Observações de produção específicas do item |

---

### 6.3 `pedidos_modelos` — Subdivisão em modelos/lotes ⭐ Entidade Central

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | uuid | Chave primária |
| `id_int` | integer | FK → `propostas.id_int` |
| `id_pedido` | uuid | FK → `pedidos.id` |
| `id_item` | uuid | FK → `pedidos_itens.id` |
| `nome_modelo` | text | Nome ou identificador do modelo (ex: "Modelo A", "AZUL") |
| `descricao` | text | Descrição livre do modelo |
| `quantidade` | integer | Quantidade deste modelo (ex: 750) |
| `tipo_numeracao` | text | Tipo: SEQUENCIAL, FIXO, SEM_NUMERACAO, PERSONALIZADO |
| `numeracao_inicio` | integer | Primeiro número da sequência (ex: 1) |
| `numeracao_fim` | integer | Último número da sequência (ex: 750) |
| `obs_impressao` | text | Instruções específicas para o impressor |
| `status_arte` | text | Status da arte deste modelo |
| `status_producao` | text | Status da produção deste modelo |
| `ordem` | integer | Ordem de exibição/produção |
| `created_at` | timestamptz | Data de criação |

---

### 6.4 `pedidos_artes` — Artes vinculadas a modelos

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | uuid | Chave primária |
| `id_int` | integer | FK → `propostas.id_int` |
| `id_modelo` | uuid | FK → `pedidos_modelos.id` |
| `versao` | integer | Número da versão (1, 2, 3…) |
| `nome_arquivo` | text | Nome do arquivo de arte |
| `url_arquivo` | text | URL do arquivo no Storage |
| `tipo_arquivo` | text | PDF, AI, PNG, etc. |
| `status` | text | Status desta versão de arte |
| `aprovado_por` | text | Quem aprovou |
| `data_aprovacao` | timestamptz | Data e hora da aprovação |
| `comentarios_revisao` | text | Feedback de reprovação/revisão |
| `enviado_por` | text | Quem enviou o arquivo |
| `created_at` | timestamptz | Data de upload |

---

### 6.5 `pedidos_historico` — ~~Log de eventos do pedido~~ → Substituído pelo Chat Interno

> ✅ **Decisão de design**: A tabela `pedidos_historico` conceitual **não será criada**. O log de eventos do pedido será registrado diretamente em `public.propostas_chat` usando o mesmo `id_int`, com `tipo = PRODUCAO` ou `tipo = SISTEMA`. Isso elimina uma tabela redundante e centraliza toda a comunicação operacional em um único canal já implementado e em produção.
>
> Ver **Seção 17** para o detalhamento completo da integração com o Chat Interno.

---

### 6.6 Chat Interno no Detalhe do Pedido

A integração com o Chat Interno permite que o detalhe do pedido (`PedidoDetailPage`) exiba uma aba dedicada "Chat do Pedido". Este componente consome o mesmo `id_int` da proposta de origem, garantindo que todo o histórico de comunicação (comercial, financeiro e produção) esteja unificado.

---

## 7. Exemplo Prático — Triband 3.000 unidades

### Cenário real

> Proposta #3412, aprovada pelo financeiro (pagamento confirmado).
> Item: Triband com 3.000 unidades.
> Divisão operacional: 4 modelos distintos.

### Como ficaria no sistema

**Pedido** (`pedidos`):
```
id_int: 3412
status_pedido: EM_PRODUCAO
status_producao: EM_PRODUCAO
data_pedido: 2026-06-01
obs: Entrega urgente para evento dia 15/06
```

**Item** (`pedidos_itens`):
```
id_item: item-001
nome_produto: Triband
quantidade_total: 3000
obs_producao: Material polipropileno 35mm
```

**Modelos** (`pedidos_modelos`):

| # | Nome | Qtd | Numeração | Arte |
|---|---|---|---|---|
| 1 | Modelo Azul | 750 | 00001 – 00750 | arte_triband_azul_v1.pdf — APROVADA |
| 2 | Modelo Vermelho | 750 | 00751 – 01500 | arte_triband_vermelho_v1.pdf — EM_ANALISE |
| 3 | Modelo Verde | 1.000 | 01501 – 02500 | arte_triband_verde_v2.pdf — APROVADA |
| 4 | Modelo Amarelo | 500 | 02501 – 03000 | PENDENTE — aguardando envio |

**Total verificado**: 750 + 750 + 1.000 + 500 = **3.000** ✓

### Regra de consistência de quantidade

```
SUM(pedidos_modelos.quantidade) deve ser ≤ pedidos_itens.quantidade_total
```

> Uma diferença positiva (sobra de unidades não alocadas) pode ser permitida e destacada como alerta.  
> Uma diferença negativa (alocação maior que o total) deve ser bloqueada.

---

## 8. Tratamento de Numeração por Modelo

Tipos de numeração sugeridos:

| Tipo | Uso | Exemplo |
|---|---|---|
| `SEQUENCIAL` | Numeração corrida dentro de um modelo | 001 – 750 |
| `SEQUENCIAL_GLOBAL` | Numeração corrida considerando todos os modelos do item | 001 – 3000 |
| `FIXO` | Todos os cartões com o mesmo número | 9999 |
| `SEM_NUMERACAO` | Produto sem número (ex: triband padrão sem personalização) | — |
| `PERSONALIZADO` | Upload de planilha com dados variáveis por peça | CSV com nomes/matrículas |

> **Nota importante**: A numeração sequencial deve respeitar a continuidade entre modelos do mesmo item quando `tipo_numeracao = SEQUENCIAL_GLOBAL`. O sistema deve calcular e sugerir os intervalos automaticamente.

### Lógica de cálculo de intervalos

```typescript
// Pseudo-código para distribuição automática de numeração
function calcularIntervalosModelos(modelos: Modelo[], inicio = 1) {
  let cursor = inicio;
  return modelos.map((modelo) => ({
    ...modelo,
    numeracao_inicio: cursor,
    numeracao_fim: cursor + modelo.quantidade - 1,
  }));
  // cursor avança: cursor = cursor + modelo.quantidade
}
```

---

## 9. Revisão e Aprovação de Arte

### Fluxo de revisão

```text
Cliente envia arte
    ↓
Pré-impressão analisa
    ↓
[ OK? ]
 ├── SIM → Status: APROVADA → Arte liberada para produção
 └── NÃO → Status: REPROVADA + comentário de revisão
                ↓
           Cliente recebe feedback
                ↓
           Cliente envia nova versão (versão n+1)
                ↓
           Pré-impressão analisa novamente
```

### Controle de versão

Cada upload de arquivo cria um novo registro em `pedidos_artes` com:
- `versao` incrementado (v1, v2, v3…)
- `status` iniciando em `EM_ANALISE`
- `comentarios_revisao` do round anterior registrado

O histórico de versões é preservado integralmente — nunca sobrescrito.

### Arte pode preceder pagamento

A gráfica frequentemente inicia o trabalho de arte antes do pagamento ser confirmado.

> **Decisão de design**: A criação de modelos e o upload de artes **não devem ser bloqueados** pelo status do pagamento. O sistema deve mostrar um **alerta visual** quando a arte estiver sendo trabalhada em um pedido cujo financeiro ainda não está totalmente confirmado, mas não deve impedir a operação.

---

## 10. Estrutura de Tabelas Futuras Sugeridas

> ⚠️ NENHUMA tabela será criada sem revisão e aprovação explícita.

**Tabelas novas — fase 1 (core do pedido)**:

```sql
public.pedidos                        -- Pedido originado da proposta
public.pedidos_itens                  -- Itens do pedido (snapshot de produtos_proposta)
public.pedidos_modelos                -- Subdivisão em modelos/lotes por item
public.pedidos_artes                  -- Artes por modelo com versionamento
```

**Tabelas novas — fase 2 (operação avançada)**:

```sql
public.pedidos_modelos_config_impressao  -- Configuração avançada de numeração e impressão
                                          -- campos: tipo_num, posicao_x/y, tamanho_fonte,
                                          --         inclinacao, qtd_digitos, qr_code,
                                          --         cod_barras_tipo, dados_variaveis_url

public.pedidos_artes_aprovacoes          -- Log de aprovações/reprovações do cliente via link
                                          -- campos: id_arte, id_modelo, versao, status,
                                          --         aprovado_por_nome, aprovado_em, ip_cliente,
                                          --         comentario_reprovacao, token_aprovacao

public.pedidos_kanban_status             -- Estado do pedido no quadro de produção
                                          -- campos: id_pedido, coluna_kanban, posicao_fila,
                                          --         prioridade_manual, urgente, responsavel

public.pedidos_pacotes                   -- Controle de volumes/pacotes de saída
                                          -- campos: id_pedido, numero_volume, qtd_itens,
                                          --         peso_aferido, lacrado, obs

public.pedidos_pesagem                   -- Registro de pesagem real x cadastrado
                                          -- campos: id_pedido, peso_cadastrado, peso_aferido,
                                          --         diferenca, aferido_por, aferido_em, obs
```

**Tabelas já existentes que serão REAPROVEITADAS (leitura + escrita)**:

```sql
public.propostas_chat        -- ✅ Timeline operacional — REAPROVEITADA
public.propostas_pendencias  -- ✅ Pendências entre setores — REAPROVEITADA
```

**Tabelas já existentes que serão consultadas (somente leitura)**:

```sql
public.propostas             -- Proposta origem
public.produtos_proposta     -- Itens da proposta
public.clientes              -- Dados do cliente
public.enderecos             -- Endereço de entrega
public.pagamentos_v2         -- Confirmação financeira
public.produtos              -- Dados do produto (catálogo)
public.pedidos               -- (Pode já existir — precisa revisar estrutura atual)
```

**Storage já existente que será REAPROVEITADO**:

```
Bucket: chat-ideal
Path artes:   propostas/{id_int}/artes/{id_modelo}/{timestamp}_{arquivo}
Path briefing: propostas/{id_int}/briefing/{timestamp}_{arquivo}
```

> O bucket `chat-ideal` já suporta PDFs, imagens, `.ai` e `.zip` até 10MB. Não é necessário criar novo bucket.

---

## 11. Alternativas de Modelagem Consideradas

### Alternativa 1 — Modelo simples sem subdivisão em modelos/lotes

**Como funcionaria**: Um pedido tem apenas itens. Numeração e arte ficam no item.

**Vantagem**: Mais simples de implementar.

**Problema**: Não atende o caso real da gráfica onde um item de 3.000 tribands pode ter 4 modelos diferentes com artes diferentes. Descarta a necessidade real de negócio.

**Decisão**: ❌ Descartada.

---

### Alternativa 2 — Modelo com subdivisão apenas por arte (sem quantidade por modelo)

**Como funcionaria**: Cada modelo tem arte própria, mas sem controle de quantidade por modelo.

**Vantagem**: Ligeiramente mais simples.

**Problema**: Sem quantidade por modelo, não é possível verificar consistência total, gerar OS separada por lote ou controlar numeração sequencial correta.

**Decisão**: ❌ Descartada.

---

### Alternativa 3 — Modelo com subdivisão completa (proposta neste documento) ✅

**Como funcionaria**: Cada item pode ter N modelos. Cada modelo tem quantidade, arte, numeração e instrução própria.

**Vantagem**: Atende plenamente o caso real da gráfica. Permite consistência de quantidade, numeração automática, aprovação de arte por modelo e OS separada.

**Problema**: Mais complexo de implementar. Requer cuidado na UI para não sobrecarregar o operador.

**Decisão**: ✅ Adotada como modelo conceitual. UI deve ser progressiva (simples por padrão, detalhada sob demanda).

---

### Alternativa 4 — Integrar modelos diretamente em `produtos_proposta`

**Como funcionaria**: Ao invés de criar `pedidos_modelos`, adicionar campos de modelo diretamente na tabela existente `produtos_proposta`.

**Vantagem**: Reutiliza tabela existente, menos migrações.

**Problema**: `produtos_proposta` representa o item da proposta comercial. Misturar dados de produção (modelos, numeração, arte) nessa tabela viola a separação de responsabilidades e pode complicar os cálculos de proposta.

**Decisão**: ❌ Descartada. Manter separação clara entre proposta comercial e produção operacional.

---

## 12. Possíveis Status Consolidados

### `pedidos.status_pedido` — ciclo completo do pedido
```
NOVO
| ARTE_EM_ANDAMENTO
| AGUARDANDO_APROVACAO_CLIENTE
| AGUARDANDO_APROVACAO_ATENDENTE
| AGUARDANDO_OS
| EM_IMPRESSAO
| EM_ACABAMENTO
| REVISAO_FINAL
| AGUARDANDO_MATERIAL
| PAUSADO
| PRONTO_EXPEDICAO
| EXPEDIDO
| FINALIZADO
| CANCELADO
```

### `pedidos_artes.status` — ciclo da arte por modelo
```
PENDENTE
| EM_CRIACAO
| EM_REVISAO_INTERNA
| AGUARDANDO_CLIENTE
| REPROVADA_CLIENTE
| APROVADA_CLIENTE
| LIBERADA
| IMPRESSA
| NAO_NECESSARIA
```

### `pedidos_modelos.status_producao` — produção por modelo
```
PENDENTE | EM_IMPRESSAO | EM_ACABAMENTO | CONCLUIDA | PAUSADA | CANCELADA
```

### `pedidos_kanban_status.coluna_kanban` — quadro visual
```
ARTE | APROVACAO | AGUARDANDO_OS | IMPRESSAO | ACABAMENTO | REVISAO | EXPEDICAO
```

---

## 13. Dúvidas — Respondidas e Pendentes

### ✅ Respondidas pelo Everton (2026-06-02)

**1. A produção começa antes do pagamento?**
> ✅ **SIM.** A produção começa pela Arte Final, independente do pagamento. O sistema não deve bloquear a criação de arte por status financeiro.

**2. Quem aprova a arte — interno ou externo?**
> ✅ **Ambos, em sequência.** Atendente revisa internamente → link enviado ao cliente → cliente aprova/reprova via checkout/link → atendente faz a liberação final modelo por modelo.

**3. Numeração é simples ou avançada?**
> ✅ **Avançada.** Não é só início/fim. Pode envolver: múltiplas numerações por modelo, posições diferentes (x/y), tamanho de fonte, inclinação, quantidade de dígitos, QR Code, código de barras 139 e padrões específicos do cliente. Ver Seção 19.

**4. Quem designa o designer?**
> ✅ **O atendente/vendedor** escolhe o designer responsável pelo pedido.

**5. Como a OS é gerada?**
> ✅ **Impressa pelo gerente de produção**, modelo por modelo, após todas as artes estarem liberadas. A OS é um documento físico que vai para o impressor.

**6. Quem define a fila e prioridade?**
> ✅ **O gerente de produção** define a fila de prioridade após receber os pedidos aprovados.

**7. Qual é o coração da produção?**
> ✅ **Impressão.** Tudo antes alimenta a impressão. Tudo depois organiza o que foi impresso.

**8. Pesagem é real?**
> ✅ **SIM.** O peso real deve ser aferido e comparado com o peso cadastrado no produto. Divergências precisam ser registradas e alertadas.

**9. Produtos mais frequentes?**
> ✅ **Pulseiras e cartões.**

**10. A arte pode ser enviada pelo sistema?**
> ✅ **Objetivo é centralizar no ERP.** Hoje chega por WhatsApp. O bucket `chat-ideal` já existe e pode receber artes. Ver Seções 17.6 e 19.

---

### ⏳ Ainda pendentes

**A. A tabela `public.pedidos` já existe no banco?**
- Quais campos ela tem hoje? Tem dados reais?
- Podemos expandir ou devemos criar nova estrutura?
- **Impacto**: define o ponto de partida da migration.

**B. O link de aprovação do cliente é interno (URL do sistema) ou externo (página pública)?**
- O cliente precisa estar logado ou é página pública com token?
- **Impacto**: define se precisamos de rota pública (`/aprovacao/[token]`) similar à página de pagamento já existente.

**C. Expedição: tabela separada ou campos em `pedidos`?**
- O Módulo 13 (Expedição) já está no planejamento. Como ele se conecta?
- Quem decide sobre múltiplos volumes? ("Pode ser em 3 volumes?")
- **Impacto**: define se `pedidos_pacotes` é necessária na fase 1 ou pode esperar.

**D. O Maestro gera briefing de arte automaticamente?**
- O Módulo 5 (Maestro) pode gerar instruções de arte?
- **Impacto**: fase atual ou etapa futura — não bloqueia o módulo de produção.

---

## 14. Riscos de Modelagem

| Risco | Descrição | Mitigação |
|---|---|---|
| **Quantidade inconsistente** | Soma dos modelos ≠ quantidade total do item | Validação no front + restrição de banco |
| **Numeração duplicada** | Dois modelos com intervalos sobrepostos | Cálculo automático de intervalos + validação |
| **Arte em proposta não aprovada** | Arte aprovada mas pagamento pendente | Alerta visual — não bloquear, mas avisar claramente |
| **Tabela `pedidos` já existente** | Campos existentes podem conflitar com o novo design | Revisar estrutura atual antes de qualquer migration |
| **Acoplamento com financeiro** | Pedido não deve alterar dados financeiros | Separação estrita: pedidos só leem `pagamentos_v2` |
| **Volume de arquivos de arte** | Múltiplas versões de arte podem gerar grande volume no Storage | Subpasta `artes/` em `chat-ideal`; limite de 10MB por arquivo já existente |
| **Complexidade de UI** | Muitos modelos por item pode gerar telas confusas | UI progressiva: simples por padrão, detalhada sob demanda |
| **Sincronização entre módulos** | Mudança no pedido deve notificar expedição e financeiro | `propostas_chat` com `tipo = PRODUCAO` + menções `@setor` como ponte imediata |
| **Poluição do chat comercial** | Mensagens de produção misturadas com negociação comercial | Filtro visual por `tipo` no drawer |
| **Trigger de loop no chat** | Mensagem automática acionar nova mensagem em cadeia | Gravação fire-and-forget; nunca gravar em `propostas_chat` dentro de trigger SQL |
| **Escala: 120+ pedidos simultâneos** | Interface e consultas não preparadas para volume alto | Kanban paginado; queries indexadas por `status_pedido` e `prioridade`; cache no front |
| **Arte errada vai para impressão** | Versão desatualizada impressa sem aprovação final | Status `LIBERADA` obrigatório antes de gerar OS; bloqueio no sistema |
| **Numeração errada** | Config de impressão incorreta (posição, dígitos, QR) vai para impressor | Campos de `pedidos_modelos_config_impressao` exibidos na OS para conferência manual |
| **Modelo faltando** | Pedido impresso sem todos os modelos aprovados | Dashboard de modelos pendentes; alerta antes de gerar OS parcial |
| **Comercial promete prazo errado** | Fila de impressão já cheia, prazo impossível | Kanban visível para o comercial; status da fila em tempo real |
| **Financeiro libera pedido sem arte** | Pedido entra em produção sem arte definida | Alerta visual de "arte pendente" mesmo após liberação financeira |
| **Peso aferido ≠ peso cadastrado** | Produto saiu com quantidade errada; problema na expedição | `pedidos_pesagem` registra diferença; alerta bloqueante se acima de tolerância |

---

## 15. Próximos Passos Sugeridos

### Prioridade 1 — Validação e diagnóstico (antes de qualquer código)
1. **Responder as dúvidas pendentes da Seção 13** — especialmente tabela `public.pedidos` e link de aprovação do cliente.
2. **Inspecionar a tabela `public.pedidos` no Supabase** — verificar schema real, dados existentes e campos usados.
3. **Validar o fluxo real com a equipe de produção** — confirmar status do Kanban e papéis (Seções 21 e 22).

### Prioridade 2 — Documentação e modelagem
4. **Finalizar o schema conceitual das 5 novas entidades** — especialmente `pedidos_modelos_config_impressao` e `pedidos_artes_aprovacoes`.
5. **Definir o formato do link de aprovação do cliente** — URL interna ou pública com token.
6. **Definir configurações de numeração suportadas** — quais campos mínimos para a fase 1.

### Prioridade 3 — Implementação (somente após aprovação do schema)
7. **Criar migration controlada** — iniciando por `pedidos` e `pedidos_modelos`.
8. **Implementar lista de pedidos com Kanban simples** — visão de fila por status.
9. **Implementar detalhe do pedido com modelos e chat integrado** — ver Seção 17.1.
10. **Implementar upload de arte e ciclo de aprovação interno** — atendente → cliente → liberação.
11. **Implementar pesagem e conferência pré-expedição** — `pedidos_pesagem` com alerta de divergência.
12. **Conectar com o Módulo de Expedição** — quando pedido estiver `PRONTO_EXPEDICAO`, gerar mensagem automática.

---

## 16. Referências e Inspirações

- **Printavo / shopVOX / PrintPLANR**: Sistemas de MIS (Management Information System) específicos para gráficas. A divisão em "Job Ticket" por item e "modelos" é prática padrão nestes sistemas.
- **Job Ticket**: Documento interno que contém todas as instruções técnicas de produção. Equivale à nossa "OS" futura.
- **Art Approval Workflow**: Ciclo de envio → análise → reprovação/aprovação com versionamento é padrão na indústria gráfica. Sistemas como Printxpand e shopVOX implementam portais de aprovação com link público para o cliente.
- **VDP (Variable Data Printing)**: Impressão com dados variáveis por peça (nomes, matrículas, numerações). O campo `tipo_numeracao` e o suporte a CSV de dados variáveis vêm desta referência.
- **Módulo 11 e 12 — ERP Ideal** (`docs/modulos/Módulos Planejados-11 a 16.md`): Base conceitual já documentada no projeto.
- **CHAT-INTERNO.md**: Documentação oficial do módulo de Chat Interno — base para toda a integração de timeline descrita na Seção 17.

---

## 17. Chat Interno como Timeline Operacional do Pedido

> **Princípio**: Não criar novo chat. Reaproveitar `public.propostas_chat` e `public.propostas_pendencias` já existentes.

O Chat Interno, implementado e estável no ERP Ideal, já funciona como timeline operacional das propostas usando `id_int` como chave. O módulo de Pedidos/Produção **não precisará de uma timeline própria** — ele usará o mesmo canal, com tipos de mensagem e setores distintos para diferenciar visualmente a comunicação de produção da comunicação comercial.

---

### 17.1 Como o Chat aparece no detalhe do pedido

O detalhe de um pedido terá o mesmo padrão visual já usado no detalhe da proposta (`OrcamentoDetailPage`): uma aba **"Chat do Pedido"** que abre o `PropostaChatDrawer` já existente, passando o `id_int` da proposta de origem.

```text
Detalhe do Pedido #3412
┌──────────────────────────────────────────────────────┐
│  [Resumo]  [Modelos/Lotes]  [Arte]  [Chat do Pedido ●] │
└──────────────────────────────────────────────────────┘
                                            ↓ clique
                          ┌─────────────────────────────┐
                          │  Timeline do Pedido #3412   │
                          │  (propostas_chat id_int=3412)│
                          │                             │
                          │  [Conversa] [Pendências]    │
                          │  ─────────────────────────  │
                          │  🔵 SISTEMA  14:22           │
                          │  Pedido criado a partir da  │
                          │  proposta #3412.             │
                          │                             │
                          │  🟡 PRODUCAO 14:45           │
                          │  Arte "Modelo Azul" enviada │
                          │  por João (Pré-impressão).  │
                          │  [📎 arte_azul_v1.pdf]      │
                          │                             │
                          │  🔴 PRODUCAO 15:10           │
                          │  Arte reprovada. Motivo:    │
                          │  sangria insuficiente.      │
                          │  @Maria Comercial notificada│
                          └─────────────────────────────┘
```

**Dados do drawer no contexto do pedido**:
- `id_int`: o mesmo da proposta de origem
- O drawer já existente (`PropostaChatDrawer`) é reutilizado sem modificação de componente
- As abas **Conversa** e **Pendências** ficam disponíveis para produção da mesma forma que estão para o comercial
- Badge de não lidas funciona da mesma forma, por `id_int`

---

### 17.2 Separação visual: Comercial vs. Produção

Como o `id_int` é compartilhado entre proposta e pedido, as mensagens comerciais e operacionais convivem na mesma timeline. A diferenciação é **visual e por filtro**, não por tabelas separadas.

| Tipo de mensagem | `tipo` no banco | Cor visual sugerida | Setor |
|---|---|---|---|
| Conversa comercial livre | `MENSAGEM` | Neutro / cinza | Comercial, Financeiro |
| Evento automático do sistema | `SISTEMA` | Azul discreto | Sistema |
| Evento financeiro automático | `FINANCEIRO` | Verde-azulado | Sistema/Financeiro |
| Evento de produção automático | `PRODUCAO` | Amarelo âmbar | Sistema/Produção |
| Mensagem manual de produção | `PRODUCAO` | Amarelo âmbar | Pré-impressão, Produção |

> O campo `setor` na tabela `propostas_chat` já existe e deve ser preenchido com `"Producao"`, `"Pre-impressao"` ou `"Sistema"` para mensagens do módulo de produção.

**Futura melhoria (não implementar agora)**: O drawer pode ganhar um filtro rápido de tipo — ex: botões "Tudo", "Comercial", "Produção" — para que cada setor visualize apenas o que é relevante.

---

### 17.3 Mensagens automáticas de arte

Cada evento no ciclo de vida da arte gera uma mensagem automática em `propostas_chat` com `tipo = PRODUCAO`, `visivel_externo = false`.

#### Evento: Arte enviada (upload de nova versão)

```json
{
  "id_int": 3412,
  "tipo": "PRODUCAO",
  "setor": "Pre-impressao",
  "visivel_externo": false,
  "autor_nome": "João (Pré-impressão)",
  "mensagem": "Arte enviada para o Modelo Azul (versão 1). Aguardando análise.",
  "anexos": [
    {
      "url": "https://.../chat-ideal/propostas/3412/artes/modelo-azul/arte_azul_v1.pdf",
      "name": "arte_azul_v1.pdf",
      "type": "application/pdf",
      "size": 2345678
    }
  ]
}
```

#### Evento: Arte aprovada

```json
{
  "id_int": 3412,
  "tipo": "PRODUCAO",
  "setor": "Sistema",
  "visivel_externo": false,
  "autor_nome": "Sistema",
  "mensagem": "✅ Arte aprovada: Modelo Azul (versão 1). Aprovado por Carlos (Pré-impressão) em 02/06/2026 às 15:30. Liberado para produção."
}
```

#### Evento: Arte reprovada

```json
{
  "id_int": 3412,
  "tipo": "PRODUCAO",
  "setor": "Sistema",
  "visivel_externo": false,
  "autor_nome": "Sistema",
  "mensagem": "❌ Arte reprovada: Modelo Vermelho (versão 1). Motivo: sangria insuficiente — mínimo de 3mm exigido. @Maria Comercial por favor solicitar nova arte ao cliente."
}
```

> A menção `@Maria` usa o mecanismo de menções já implementado em `propostas_chat_mentions`, gerando notificação em tempo real para o usuário mencionado.

#### Evento: Nova versão de arte enviada após reprovação

```json
{
  "id_int": 3412,
  "tipo": "PRODUCAO",
  "setor": "Pre-impressao",
  "visivel_externo": false,
  "autor_nome": "João (Pré-impressão)",
  "mensagem": "Nova versão de arte enviada: Modelo Vermelho (versão 2). @Carlos Pré-impressão, favor reanalisar.",
  "anexos": [{ "url": "...", "name": "arte_vermelho_v2.pdf", "type": "application/pdf", "size": 1900000 }]
}
```

---

### 17.4 Mensagens automáticas de produção

Eventos do ciclo de vida do pedido também geram mensagens automáticas com `tipo = PRODUCAO`.

| Evento | Mensagem automática gerada |
|---|---|
| Pedido criado a partir da proposta | `"Pedido criado a partir da proposta #3412. Status: NOVO. Responsável: Vendedor X."` |
| Status mudado para AGUARDANDO_ARTE | `"Pedido aguardando arte. 4 modelos pendentes de arquivo."` |
| Primeiro modelo com arte aprovada | `"Primeiro modelo com arte aprovada: Modelo Azul (750 un.). Produção pode iniciar este modelo."` |
| Todos os modelos com arte aprovada | `"✅ Todas as artes aprovadas para o pedido #3412. Pedido liberado para produção completa."` |
| Status mudado para EM_PRODUCAO | `"Pedido em produção. Iniciado por [operador] em [data/hora]."` |
| Status mudado para CONCLUIDO | `"✅ Produção concluída. Pedido #3412 pronto para expedição. @Expedição favor verificar."` |
| Pedido cancelado | `"❌ Pedido cancelado por [operador]. Motivo: [motivo registrado]."` |

> **Regra de segurança**: mensagens automáticas de produção são **fire-and-forget**. Se a gravação falhar, o fluxo principal (mudança de status do pedido) não é bloqueado. O erro é apenas logado no console.

---

### 17.5 Pendências entre setores

O módulo de Produção reaproveitará `public.propostas_pendencias` para comunicação formal entre setores, usando as categorias operacionais já definidas.

#### Casos de uso de pendências em produção

| Situação | Categoria | Prioridade sugerida |
|---|---|---|
| Arte reprovada aguardando reenvio do cliente | `PRODUCAO` | `ALTA` |
| Aguardando aprovação de orçamento de material adicional | `FINANCEIRO` | `MEDIA` |
| Pedido pausado por falta de material/insumo | `PRODUCAO` | `URGENTE` |
| Impressão com defeito — aguardando decisão comercial | `COMERCIAL` | `URGENTE` |
| Data de entrega em risco — escalonar para gerência | `PRODUCAO` | `URGENTE` |
| OS gerada aguardando conferência de expedição | `EXPEDICAO` | `MEDIA` |

#### Fluxo de pendência de arte reprovada

```text
Pré-impressão reprova arte
    ↓
Sistema gera mensagem PRODUCAO no chat (ver 17.3)
    ↓
Pré-impressão cria pendência em propostas_pendencias:
  categoria: PRODUCAO
  titulo: "Arte reprovada — Modelo Vermelho — aguardando nova versão"
  setor_destino: COMERCIAL
  prioridade: ALTA
    ↓
Sistema gera mensagem SISTEMA no chat:
  "Pendência criada: Arte reprovada — Modelo Vermelho. Aguardando ação do Comercial."
    ↓
Comercial recebe notificação em tempo real (badge na Topbar)
    ↓
Comercial solicita nova arte ao cliente
    ↓
Cliente envia nova arte → Comercial faz upload no chat
    ↓
Comercial menciona @João Pré-impressão
    ↓
João recebe notificação → analisa arte → aprova
    ↓
Pendência é concluída → mensagem automática de conclusão no chat
```

---

### 17.6 Anexos de arte e briefing no Storage

Os arquivos de arte são enviados pelo mecanismo já existente de upload de anexos do `PropostaChatPanel`, que salva no bucket `chat-ideal`.

**Path sugerido para artes de produção**:

```
chat-ideal/propostas/{id_int}/artes/{id_modelo}/{timestamp}_{nomeArquivo}
```

**Exemplo real**:
```
chat-ideal/propostas/3412/artes/modelo-azul-uuid/1748870400_arte_azul_v2.pdf
chat-ideal/propostas/3412/artes/modelo-verde-uuid/1748870800_arte_verde_v1.ai
```

**Tipos de arquivo esperados para artes**:

| Tipo | Extensão | Uso |
|---|---|---|
| PDF de arte | `.pdf` | Arte finalizada para produção |
| Illustrator | `.ai` | Arquivo editável de arte vetorial |
| PNG de preview | `.png` | Preview de aprovação |
| ZIP de dados variáveis | `.zip` | Planilha CSV + assets para VDP |

> O bucket `chat-ideal` já suporta PDFs e imagens até 10MB. Arquivos `.ai` e `.zip` também são suportados. Não é necessário criar novo bucket.

**Briefing / instruções gerais do pedido**:

O briefing operacional de um pedido (formato, material, dimensões, instruções de numeração, restrições de design) pode ser enviado como anexo na primeira mensagem de `tipo = PRODUCAO` quando o pedido é criado, ou como mensagem separada gerada pelo Maestro no futuro.

---

### 17.7 Aprovação e reprovação de arte via chat

**Fluxo proposto** (sem portal externo de aprovação para o cliente nesta fase):

```text
1. Operador envia arte como ANEXO no chat do pedido
   → mensagem tipo PRODUCAO com anexo PDF/PNG

2. Operador de pré-impressão analisa o arquivo
   → acessa o link direto do Storage no chat

3a. APROVAÇÃO:
    → Operador clica em "Aprovar Arte" (ação no painel do modelo)
    → Sistema atualiza pedidos_artes.status = APROVADA
    → Sistema gera mensagem automática de aprovação no chat
    → Sistema atualiza pedidos_modelos.status_arte = APROVADA

3b. REPROVAÇÃO:
    → Operador clica em "Reprovar Arte" (ação no painel do modelo)
    → Sistema abre campo para registrar o motivo
    → Sistema atualiza pedidos_artes.status = REPROVADA
    → Sistema gera mensagem automática de reprovação no chat com o motivo
    → Operador pode mencionar @VendedorX para notificar o comercial
    → Sistema pode criar pendência automática em propostas_pendencias
```

> **Decisão de design**: A aprovação/reprovação é uma **ação do painel de modelos**, não do chat em si. O chat recebe o registro automático do resultado, mas a ação parte da UI do pedido. Isso mantém o chat como registro rastreável, não como interface de ação.

---

### 17.8 Menções entre setores

O módulo de Produção usa o mecanismo de menções `@` já implementado para comunicação entre setores sem precisar de e-mail ou WhatsApp.

#### Casos de uso de menções em produção

| Situação | Quem menciona | Quem é mencionado |
|---|---|---|
| Arte reprovada, precisa de nova versão | Pré-impressão | `@Vendedor` ou `@Comercial` |
| Todos modelos aprovados, pedido pronto para imprimir | Pré-impressão | `@Producao` |
| Produção concluída, aguardando expedição | Produção | `@Expedicao` |
| Pedido urgente por prazo | Gerência | `@Producao` + `@Expedicao` |
| Dúvida técnica sobre produto | Produção | `@Vendedor` |
| Divergência no número de modelos | Pré-impressão | `@Financeiro` |

> Menções geram notificação em tempo real via `propostas_chat_mentions` + badge na Topbar + Toast interativo, exatamente como já funciona para o comercial.

---

### 17.9 Riscos específicos da integração com Chat

| Risco | Descrição | Mitigação |
|---|---|---|
| **Poluição da timeline** | Muitas mensagens automáticas de produção tornam a timeline ilegível para o comercial | Filtro por `tipo` no drawer; agrupar eventos consecutivos do mesmo tipo |
| **Trigger loop** | Mensagem automática de produção disparar outro evento | Nunca gravar em `propostas_chat` dentro de trigger SQL; gravar sempre pelo front/edge function |
| **Falha silenciosa** | Upload de arte falhar sem o operador perceber | Validar resposta do Storage antes de gravar no chat; mostrar erro visual explícito |
| **Arquivo muito grande** | Arte em alta resolução supera 10MB | Validar tamanho antes do upload; orientar compressão; limite atual: 10MB por arquivo |
| **Arte enviada no chat geral** | Operador envia arte como mensagem comum em vez de usar o fluxo de aprovação | UI deve ter botão dedicado "Enviar arte" no painel de modelos; chat é fallback, não caminho principal |
| **Menção a usuário incorreto** | `@` menciona pessoa errada de outro setor | Sem bloqueio técnico — processo operacional deve definir responsáveis por setor |

---

### 17.10 Próximos passos da integração Chat × Produção

1. **Confirmar com Everton** se o drawer do chat no detalhe do pedido deve usar o `id_int` da proposta (recomendado) ou um identificador próprio do pedido.
2. **Definir o path de Storage** para artes dentro do bucket `chat-ideal` (ver 17.6).
3. **Mapear quais mensagens automáticas serão implementadas na primeira versão** — sugestão: apenas `Pedido criado`, `Arte aprovada`, `Arte reprovada` e `Produção concluída`.
4. **Não implementar** filtro de tipo no drawer na primeira versão — deixar para quando o volume de mensagens tornar necessário.
5. **Não implementar** portal externo de aprovação de arte para o cliente nesta fase — aprovação é interna.
6. **Reutilizar `PropostaChatPanel`** sem alteração de componente — apenas instanciar com o `id_int` correto.

---

## 18. Fluxo Real da Operação (confirmado pelo Everton)

> Esta seção documenta o fluxo **exato** como a operação acontece hoje, independente do que o sistema faz ou não faz. É a base para qualquer decisão de UI e modelagem.

```text
ETAPA 1 — CLIENTE ESCOLHE O PRODUTO
  └─ Ex: Triband, pulseira, cartão
  └─ Pode vir por WhatsApp, e-mail ou balcão

ETAPA 2 — CLIENTE CHAMA O ATENDENTE NO WHATSAPP
  └─ Envia dados do evento: nome, data, local
  └─ Envia quantidade por modelo

ETAPA 3 — CLIENTE ENVIA REFERÊNCIAS E ARQUIVOS
  └─ Logos, fotos, modelos, arquivos de referência
  └─ Hoje: via WhatsApp → sistema deve centralizar isso

ETAPA 4 — ATENDENTE DEFINE / ORIENTA NUMERAÇÃO
  └─ Decide tipo e configuração de numeração
  └─ Pode ser simples (001–750) ou complexa (QR + código + posição)
  └─ Ver Seção 19 para configuração avançada

ETAPA 5 — CONFIGURAÇÃO DE NUMERAÇÃO (pode ser complexa)
  └─ Múltiplas numerações por modelo
  └─ Posições diferentes no layout (x/y)
  └─ Tamanho de fonte, inclinação, quantidade de dígitos
  └─ QR Code, código de barras 139, padrões do cliente

ETAPA 6 — ATENDENTE ESCOLHE O DESIGNER
  └─ Designa qual designer fica responsável pelo pedido
  └─ Sistema deve registrar: id_modelo → designer_responsavel

ETAPA 7 — DESIGNER CRIA A ARTE
  └─ Com base nas refs, logos e config de numeração
  └─ Salva no sistema (hoje: pasta compartilhada ou sistema legado)

ETAPA 8 — DESIGNER NOTIFICA O ATENDENTE
  └─ "Arte do Modelo Azul pronta, favor revisar"
  └─ Via chat interno: @atendente no propostas_chat

ETAPA 9 — ATENDENTE REVISA INTERNAMENTE
  └─ Verifica se arte está de acordo antes de enviar ao cliente
  └─ Pode pedir ajuste ao designer (volta para Etapa 7)

ETAPA 10 — LINK ENVIADO AO CLIENTE
  └─ Atendente gera link de aprovação
  └─ Cliente acessa: vê a arte, aprova, solicita ajuste ou reprova
  └─ Pode ser por modelo individual

ETAPA 11 — CLIENTE APROVA, SOLICITA AJUSTE OU REPROVA
  └─ Aprova → segue para Etapa 12
  └─ Solicita ajuste → motivo registrado → designer refaz
  └─ Ciclo pode repetir N vezes por modelo

ETAPA 12 — ATENDENTE FAZ APROVAÇÃO FINAL E LIBERA
  └─ Modelo por modelo
  └─ Liberação final é do atendente, não do cliente
  └─ Sistema marca modelo como LIBERADA → disponível para OS

ETAPA 13 — GERENTE DE PRODUÇÃO ANALISA E IMPRIME OS
  └─ Vê pedidos com arte liberada
  └─ Decide ordem/prioridade da fila
  └─ Imprime OS física para cada modelo (ou lote)

ETAPA 14 — PEDIDO ENTRA EM IMPRESSÃO
  └─ ⭐ CORAÇÃO DA PRODUÇÃO
  └─ OS vai para o impressor com arte + config de numeração
  └─ Status: EM_IMPRESSAO

ETAPA 15 — GERENTE DEFINE FILA DE PRIORIDADE
  └─ Urgência, prazo, cliente, tipo de produto
  └─ Pode reordenar a fila manualmente
  └─ Sistema deve mostrar quadro visual (Kanban)

ETAPA 16 — ACABAMENTO
  └─ Guilhotina (corte reto)
  └─ Serrilha (corte dentado)
  └─ Dobra, laminação, verniz etc.
  └─ Status: EM_ACABAMENTO

ETAPA 17 — REVISÃO FINAL, PACOTES E PESAGEM
  └─ Conferência visual da produção
  └─ Empacotamento por volumes (pode ser 1, 2, 3+ volumes)
  └─ Pesagem real do pacote

ETAPA 18 — CONFERÊNCIA DE PESO
  └─ Peso real aferido ≠ peso cadastrado no produto → ALERTA
  └─ Divergência significativa indica produto faltando ou a mais
  └─ Status: REVISAO_FINAL

ETAPA 19 — EXPEDIÇÃO
  └─ Pedido pronto entregue ao módulo de Expedição
  └─ Quem vai retirar? Transportadora? Motoboy? Cliente?
  └─ Status: PRONTO_EXPEDICAO → EXPEDIDO → FINALIZADO
```

---

## 19. Configuração Avançada de Numeração e Impressão

> A numeração em gráfica **não é simplesmente um intervalo de números**. Ela envolve múltiplos parâmetros técnicos que definem como o número aparecerá no produto físico.

### 19.1 Tipos de numeração

| Tipo | Código | Descrição | Exemplo |
|---|---|---|---|
| Sequencial por modelo | `SEQUENCIAL` | Números corridos dentro do modelo | 001 – 750 |
| Sequencial global | `SEQUENCIAL_GLOBAL` | Numeração corrida em todos os modelos do item | 001 – 3000 |
| Número fixo | `FIXO` | Todos os exemplares com o mesmo número | 9999 |
| Sem numeração | `SEM_NUMERACAO` | Produto sem número | — |
| QR Code | `QR_CODE` | QR com dado variável por peça | URL + matrícula |
| Código de barras 139 | `COD_BARRAS_139` | Barcode padrão 3 de 9 (Code 39) | *001234* |
| Dados variáveis (VDP) | `DADOS_VARIAVEIS` | Planilha CSV com dados por peça | nome, matrícula |
| Combinado | `COMBINADO` | Mais de um tipo simultâneo por modelo | QR + numérico |

### 19.2 Parâmetros de impressão por posição de numeração

Uma numeração pode ter **múltiplas ocorrências** no mesmo modelo (ex: frente e verso, canto superior e inferior). Cada ocorrência tem configuração independente.

| Campo | Tipo | Descrição |
|---|---|---|
| `posicao_x` | float | Posição horizontal em mm a partir da margem esquerda |
| `posicao_y` | float | Posição vertical em mm a partir do topo |
| `tamanho_fonte` | float | Tamanho em pontos tipográficos (pt) |
| `inclinacao` | integer | Ângulo de rotação em graus (0 = horizontal) |
| `qtd_digitos` | integer | Número de dígitos com zeros à esquerda (ex: 4 → 0001) |
| `cor` | text | Cor da numeração (ex: preto, branco, pantone específico) |
| `fonte` | text | Família tipográfica da numeração |
| `espelhado` | boolean | Numeração espelhada (impressão especial) |

### 19.3 Parâmetros de QR Code e código de barras

| Campo | Tipo | Descrição |
|---|---|---|
| `qr_tamanho` | float | Largura/altura do QR em mm |
| `qr_nivel_correcao` | text | Nível de correção de erro: L, M, Q, H |
| `qr_conteudo_template` | text | Template do conteúdo: ex: `https://meusite.com/check/{numero}` |
| `cod_barras_tipo` | text | Tipo do código: `CODE39`, `CODE128`, `EAN13` |
| `cod_barras_altura` | float | Altura em mm |
| `cod_barras_exibir_numero` | boolean | Mostrar número abaixo do código |

### 19.4 Dados variáveis (VDP)

Quando o conteúdo varia por peça (ex: nome, matrícula, foto), o modelo usa **planilha de dados variáveis**.

```
Arquivo: dados_variaveis.csv
Colunas: numero, nome, matricula, departamento, qr_url
Linhas:  1 linha por peça impressa

Exemplo:
001,João Silva,MAT-0042,RH,https://emp.com/id/42
002,Maria Costa,MAT-0103,TI,https://emp.com/id/103
```

> Entidade futura: `pedidos_modelos_config_impressao.dados_variaveis_url` aponta para o CSV no Storage.

### 19.5 Entidade conceitual: `pedidos_modelos_config_impressao`

```sql
-- Conceitual — NÃO implementar sem aprovação
CREATE TABLE pedidos_modelos_config_impressao (
  id                    uuid PRIMARY KEY,
  id_modelo             uuid REFERENCES pedidos_modelos(id),
  id_int                integer,              -- rastreabilidade
  posicao_numero        integer DEFAULT 1,    -- 1ª, 2ª, 3ª ocorrência no layout
  tipo_numeracao        text,                 -- SEQUENCIAL, QR_CODE, FIXO...
  posicao_x             float,
  posicao_y             float,
  tamanho_fonte         float,
  inclinacao            integer DEFAULT 0,
  qtd_digitos           integer DEFAULT 3,
  cor                   text DEFAULT 'preto',
  fonte                 text,
  espelhado             boolean DEFAULT false,
  qr_conteudo_template  text,
  cod_barras_tipo       text,
  dados_variaveis_url   text,                 -- path no Storage
  obs_impressao         text,                 -- instrução livre para o impressor
  created_at            timestamptz DEFAULT now()
);
```

---

## 20. Aprovação do Cliente via Link/Checkout

> A aprovação de arte pelo cliente não acontece dentro do ERP. O cliente acessa um **link externo** (página pública com token) onde vê a arte e registra sua decisão.

### 20.1 Fluxo do link de aprovação

```text
Atendente clica em "Enviar arte para aprovação" (por modelo)
    ↓
Sistema gera token único:
  token = uuid aleatório
  validade = 72h (configurável)
  Registra em: pedidos_artes_aprovacoes.token_aprovacao
    ↓
Sistema cria mensagem no chat:
  tipo: PRODUCAO
  "Arte do Modelo Azul enviada para aprovação do cliente.
   Link: https://erp.ideal.com.br/aprovacao/[token]"
    ↓
Atendente copia link e envia ao cliente via WhatsApp
    ↓
Cliente acessa a página pública:
  ┌────────────────────────────────────────────┐
  │  Aprovação de Arte — Ideal Gráfica         │
  │  Pedido #3412 — Modelo Azul                │
  │                                            │
  │  [Preview da arte em alta resolução]       │
  │                                            │
  │  ✅ Aprovar arte                           │
  │  ✏️ Solicitar ajuste: [campo de texto]     │
  │  ❌ Reprovar: [campo de motivo]            │
  └────────────────────────────────────────────┘
    ↓
Cliente registra decisão → sistema grava em:
  pedidos_artes_aprovacoes:
    status: APROVADA | AJUSTE_SOLICITADO | REPROVADA
    comentario_reprovacao: "texto do cliente"
    aprovado_por_nome: (campo livre — cliente digita o nome)
    aprovado_em: now()
    ip_cliente: (IP capturado para auditoria)
    ↓
Sistema atualiza pedidos_artes.status automaticamente
Sistema gera mensagem no chat com resultado
Sistema notifica atendente via menção @atendente ou toast
```

### 20.2 Entidade conceitual: `pedidos_artes_aprovacoes`

```sql
-- Conceitual — NÃO implementar sem aprovação
CREATE TABLE pedidos_artes_aprovacoes (
  id                     uuid PRIMARY KEY,
  id_arte                uuid REFERENCES pedidos_artes(id),
  id_modelo              uuid REFERENCES pedidos_modelos(id),
  id_int                 integer,
  versao                 integer,              -- versão da arte avaliada
  token_aprovacao        uuid UNIQUE,          -- token da URL pública
  token_expira_em        timestamptz,          -- validade do link
  status                 text,                 -- AGUARDANDO, APROVADA, REPROVADA, AJUSTE_SOLICITADO, EXPIRADO
  aprovado_por_nome      text,                 -- nome digitado pelo cliente
  aprovado_em            timestamptz,
  ip_cliente             text,
  comentario_reprovacao  text,
  created_at             timestamptz DEFAULT now()
);
```

### 20.3 Decisões em aberto sobre o link

| Questão | Opção A | Opção B |
|---|---|---|
| Onde fica a página? | Rota pública no próprio ERP: `/aprovacao/[token]` | Subdomínio separado: `aprovacao.ideal.com.br/[token]` |
| Cliente precisa de login? | Não — link com token é suficiente | Sim — cliente tem cadastro no sistema |
| Limite de tentativas? | Sem limite (cliente pode responder várias vezes) | Apenas 1 resposta por token (token expira ao usar) |
| Arte expira? | Token expira em 72h (gera novo se necessário) | Arte não expira até nova versão |

> **Recomendação**: Opção A (rota pública `/aprovacao/[token]`) sem exigir login do cliente, com token de uso único e validade de 72h. Alinhado com o padrão de link de pagamento já existente no ERP.

---

## 21. Papéis Operacionais: Atendente, Designer e Gerente de Produção

> Três papéis centrais definem quem faz o quê no módulo de Pedidos/Produção.

### 21.1 Atendente / Vendedor

**É o dono do pedido do ponto de vista comercial e de arte.**

| Responsabilidade | Detalhe |
|---|---|
| Receber dados do cliente | Logos, fotos, referências, dados do evento |
| Definir/orientar numeração | Tipo, parâmetros, início/fim |
| Designar designer | Escolhe quem faz a arte de cada modelo |
| Revisar arte internamente | Antes de enviar ao cliente |
| Enviar link ao cliente | Via WhatsApp (fora do sistema por enquanto) |
| Aprovação final | Libera modelo por modelo para produção |
| Comunicar urgências | Usa menções `@gerente` no chat |
| Responder dúvidas da produção | "Pode trocar a cor?" → decisão do atendente |

**O atendente é quem diz ao sistema: "essa arte está liberada para produção".**

### 21.2 Designer Gráfico

**É o executor da arte.**

| Responsabilidade | Detalhe |
|---|---|
| Criar arte por modelo | Com base em refs, logos e config de numeração |
| Salvar arte no sistema | Upload no Storage via painel do modelo |
| Notificar atendente | "@João, arte do Modelo Azul pronta" |
| Fazer revisões | Após reprovação do cliente ou pedido do atendente |
| Cada versão é um novo registro | Histórico completo preservado |

**O designer não libera arte para produção. Apenas cria e versiona.**

### 21.3 Gerente de Produção

**É o dono do chão de fábrica.**

| Responsabilidade | Detalhe |
|---|---|
| Ver pedidos com arte liberada | Fila de pedidos prontos para OS |
| Imprimir OS por modelo | Documento físico para o impressor |
| Definir fila de prioridade | Reordena manualmente no kanban |
| Sinalizar urgências | Pedidos com prazo crítico |
| Monitorar impressão | Acompanha andamento em tempo real |
| Autorizar produção parcial | "Pode mandar o que está pronto?" |
| Conferir pesagem | Assegura que peso real ≈ peso cadastrado |

**O gerente de produção define o ritmo do chão de fábrica a partir da fila de pedidos liberados.**

### 21.4 Tabela de permissões por papel

| Ação | Atendente | Designer | Gerente Prod. | Admin |
|---|---|---|---|---|
| Criar/editar modelos | ✅ | — | — | ✅ |
| Designar designer | ✅ | — | — | ✅ |
| Upload de arte | ✅ | ✅ | — | ✅ |
| Enviar link ao cliente | ✅ | — | — | ✅ |
| Liberar arte para produção | ✅ | — | — | ✅ |
| Imprimir OS | — | — | ✅ | ✅ |
| Definir prioridade na fila | — | — | ✅ | ✅ |
| Avançar status de produção | — | — | ✅ | ✅ |
| Conferir pesagem | — | — | ✅ | ✅ |
| Ver timeline do chat | ✅ | ✅ | ✅ | ✅ |

---

## 22. Kanban de Produção

> O **quadro de produção** é a principal ferramenta visual do gerente de produção. Ele mostra o status de cada pedido em tempo real e permite priorização manual.

### 22.1 Colunas do Kanban

```text
┌──────────┬──────────┬──────────────┬───────────┬───────────┬─────────┬──────────┐
│  ARTE    │ APROVAÇÃO│ AGUARD. OS   │ IMPRESSÃO │ACABAMENTO │ REVISÃO │ EXPEDIÇÃO│
│          │ CLIENTE  │              │     🖨️    │           │         │          │
├──────────┼──────────┼──────────────┼───────────┼───────────┼─────────┼──────────┤
│ Pedido   │ Pedido   │ Pedido       │ Pedido    │ Pedido    │ Pedido  │ Pedido   │
│ #3412    │ #3405    │ #3398        │ #3391 ⚡  │ #3385     │ #3380   │ #3375    │
│ Triband  │ Pulseira │ Cartão       │ Cartão    │ Pulseira  │ Triband │ Cartão   │
│ 4 mod.   │ 2 mod.   │ 1 mod.       │ URGENTE   │ 1500 un.  │ 3000 un.│ 500 un.  │
│ 3 pend.  │ Aguard.  │ Arte OK ✅   │           │           │         │          │
│          │ resp.    │              │           │           │         │          │
└──────────┴──────────┴──────────────┴───────────┴───────────┴─────────┴──────────┘
```

### 22.2 Informações de cada card no kanban

| Campo | Exibição |
|---|---|
| ID e número do pedido | `#3412` |
| Cliente | Nome resumido |
| Produto principal | Triband, Pulseira, Cartão |
| Quantidade total | `3.000 un.` |
| Modelos: total / pendentes | `4 mod. — 3 pend. de arte` |
| Data de entrega | `15/06` ou `URGENTE 🔴` |
| Designer responsável | Avatar ou iniciais |
| Status de arte | Badge por modelo: verde/amarelo/vermelho |
| Prazo de impressão | Estimativa em horas |

### 22.3 Ações rápidas no card do kanban

| Ação | Quem pode | Resultado |
|---|---|---|
| Mover para próxima coluna | Gerente Prod. | Atualiza `status_pedido` + mensagem no chat |
| Marcar como urgente | Gerente Prod., Admin | Flag `urgente = true`; card sobe ao topo da fila |
| Ver timeline do chat | Todos | Abre drawer do chat pelo `id_int` |
| Ver modelos pendentes de arte | Atendente, Gerente | Abre painel de modelos filtrado |
| Imprimir OS | Gerente Prod. | Gera PDF da OS com arte + config de numeração |
| Sinalizar problema | Qualquer | Cria pendência em `propostas_pendencias` |

### 22.4 Fila de prioridade

O gerente pode **reordenar manualmente** os cards dentro de cada coluna. A posição na fila é controlada por `pedidos_kanban_status.posicao_fila` (integer).

Critérios de prioridade automática sugeridos (sem reordenação manual):
1. `urgente = true` → sempre ao topo
2. `data_prevista_entrega ASC` → mais próximo primeiro
3. `created_at ASC` → mais antigo primeiro como desempate

### 22.5 Visibilidade por papel

| Papel | Vê no kanban |
|---|---|
| Gerente de Produção | Todos os pedidos de todas as empresas |
| Atendente | Apenas pedidos de seus clientes |
| Designer | Apenas modelos com arte designada para ele |
| Financeiro | Somente leitura — para consultar status |

### 22.6 Escala e performance

A operação vira caos com ~120 pedidos ativos sem sistema. Para suportar esse volume:

- Kanban paginado: **máximo 20 cards por coluna visíveis** (carregar mais sob demanda)
- Queries indexadas por: `status_pedido`, `urgente`, `data_prevista_entrega`
- Realtime para atualização automática dos cards (via canal Supabase da tabela `pedidos`)
- Cache local de 30s para evitar queries repetitivas ao navegar entre colunas

---

## 23. Decisões Operacionais Rápidas

> Esta seção documenta as **perguntas que a equipe faz no dia a dia** e como o sistema deve dar suporte a essas decisões. São as "dores reais" da operação.

### 23.1 "Qual é o mais urgente agora?"

**Resposta do sistema**: Kanban com coluna `EM_IMPRESSAO` ordenada por `urgente` e `data_prevista_entrega`. Cards urgentes marcados com ícone vermelho pulsante e movidos ao topo automaticamente.

**Como o gerente sinaliza urgência**: Botão "Marcar como urgente" no card. O sistema registra no chat: `"⚡ Pedido marcado como URGENTE por [gerente]."` e notifica o atendente.

---

### 23.2 "Não tenho a cor que o cliente pediu, posso trocar?"

**Resposta do sistema**: Essa é uma decisão **comercial e operacional combinada**. O sistema deve facilitar a comunicação:

1. Gerente cria pendência: `categoria: PRODUCAO`, `titulo: "Falta cor X — substituir por Y?"`
2. Sistema notifica atendente via `@menção` no chat
3. Atendente consulta cliente (via WhatsApp)
4. Atendente responde no chat: "Aprovado, pode usar Y"
5. Gerente conclui pendência e avança o pedido

**O sistema não decide — facilita a decisão rastreada.**

---

### 23.3 "Quem vai retirar o pedido?"

**Resposta do sistema**: Campo `modalidade_entrega` no pedido (ex: RETIRADA, MOTOBOY, TRANSPORTADORA, CORREIOS). Preenchido pelo atendente no momento da criação ou no módulo de Expedição.

Quando pedido chega em `PRONTO_EXPEDICAO`, o sistema gera mensagem automática: `"✅ Pedido #3412 pronto para expedição. Modalidade: [modalidade]. Responsável: [atendente]."` e notifica `@Expedição`.

---

### 23.4 "Pode ser em 3 volumes?"

**Resposta do sistema**: Tabela `pedidos_pacotes` (fase 2). Cada volume é um registro com:
- `numero_volume`: 1, 2, 3
- `qtd_itens`: quantas peças nesse volume
- `peso_aferido`: peso real
- `lacrado`: boolean
- `obs`: observação de embalagem

Na fase 1, o gerente pode registrar no campo `obs` do pedido: "Dividido em 3 volumes".

---

### 23.5 "Faltou material, pode mandar o que está pronto?"

**Resposta do sistema**: Produção **parcial** controlada por modelo.

Cada `pedidos_modelos` tem `status_producao` independente. O gerente pode avançar apenas os modelos prontos para `EM_ACABAMENTO → REVISAO_FINAL` enquanto os demais ficam em `AGUARDANDO_MATERIAL`.

O sistema gera mensagem automática: `"⚠️ Produção parcial: Modelo Azul e Modelo Verde prontos. Modelos Vermelho e Amarelo aguardando material."`

O atendente decide com o cliente se entrega o parcial ou aguarda o lote completo.

---

### 23.6 "Cliente muda arte depois de aprovada"

**Regra operacional**: Arte aprovada e liberada para produção **não pode ser alterada sem intervenção do atendente**.

Se o cliente pede mudança após a liberação:
1. Atendente avalia se a arte já foi para impressão
   - **Não foi**: desbloqueia o modelo, designer faz nova versão, ciclo recomeça
   - **Já foi**: decisão comercial (reimpressão com custo ou não)
2. Toda a decisão é registrada no chat com tipo `PRODUCAO`
3. Se houver custo adicional, atendente abre pendência para o financeiro

---

### 23.7 "Comercial prometeu prazo que não é possível"

**Resposta do sistema**: O kanban é **visível para o comercial** (somente leitura). Antes de prometer um prazo, o atendente/vendedor pode ver:
- Quantos pedidos estão em `EM_IMPRESSAO`
- Qual a fila de `AGUARDANDO_OS`
- Qual a capacidade estimada de impressão por dia

**Não resolve o problema humano, mas dá a informação necessária para decisão.**

---

### 23.8 "Financeiro liberou errado" / "Produto vai para produção sem pagamento"

**Regra confirmada**: A arte começa antes do pagamento — isso é **intencional e correto** para essa gráfica.

O sistema deve apenas:
- Exibir badge/alerta visual `"⚠️ Financeiro pendente"` no card do kanban
- **Não bloquear** a criação de arte nem a aprovação interna
- **Alertar**, mas não impedir, a liberação da arte se o financeiro não confirmou

A decisão de produzir ou não com financeiro pendente é do **gerente de produção e do atendente**, não do sistema.

---

### 23.9 Dores atuais (resumo operacional)

| Dor | Causa raiz | Como o sistema ajuda |
|---|---|---|
| Comunicação geral fraca | Tudo por WhatsApp, sem rastreamento | Chat interno por `id_int` + menções + pendências |
| Falta de quadro de produção | Sem visão de fila | Kanban de produção (Seção 22) |
| Arte errada na impressão | Versão antiga enviada ao impressor | Status `LIBERADA` obrigatório; bloqueio no fluxo de OS |
| Numeração errada | Config não documentada, feita de cabeça | `pedidos_modelos_config_impressao` com todos os parâmetros |
| Modelo faltando | Pedido impresso incompleto | Dashboard de modelos pendentes por pedido |
| Produção parcial | Material faltando, sem comunicação formal | Status por modelo + mensagem automática ao atendente |
| Cliente muda arte | Sem controle de versão formal | Histórico de versões em `pedidos_artes`; bloqueio pós-liberação |
| Urgência não sinalizada | Sem fila visual | Flag `urgente` no kanban com destaque visual |
| Comercial promete errado | Sem visibilidade da fila | Kanban read-only visível para atendentes |
| Financeiro libera errado | Fluxo desacoplado da arte | Alerta visual — não bloquear, mas sempre informar |

---

*Este documento é um rascunho conceitual (v0.3). Nenhuma tabela foi criada. Nenhum código foi implementado. Toda implementação depende de validação explícita com Everton.*
