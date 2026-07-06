# MAESTRO — Knowledge Base Canônica do ERP Ideal

> Versão: 1.1 | Branch: `erp-ideal-preview` | Data: 2026-07-03  
> Implementação: `src/features/maestro/core/knowledge/`  
> Sem alteração de banco, schema, RLS, triggers, RPCs ou views.

---

## O que é o Maestro?

O Maestro é o **Copiloto Inteligente do ERP Ideal**. Ele não é um chatbot genérico — é uma IA especializada no ciclo de vida do ERP: orçamentos, propostas, pedidos, produção, expedição e faturamento.

**Segurança funciona como trilho de liberação, não bloqueio permanente:**
1. Entender o contexto
2. Ler com permissão adequada
3. Executar ações com confirmação e log

---

## Empresas do ERP (fixas)

| id_empresa | Razão Social | Apelido |
|---|---|---|
| 1 | IDEAL GRÁFICA EXPRESSA EIRELI | Ideal Gráfica |
| 2 | IDEAL BIRÔ SERV. GRAFICOS | Ideal Birô |
| 3 | E3 BRINDES LTDA | E3 Brindes |

---

## Mapa de Entidades

| Entidade | Tabela | Chave Operacional | Filtro Cliente | Status Tool |
|---|---|---|---|---|
| Clientes | `vw_cadastros_clientes_lista` | `id_cliente` (int) | `id_cliente` | ✅ Ativo |
| Propostas/Pedidos | `public.propostas` | `id_int` | `id_cliente` | 🔜 Planejado |
| OS | `public.propostas_os` | `id_int` | `id_cliente` | 🔜 Planejado |
| Modelos/Lotes | `public.pedidos_modelos` | `id_int` | - | 🔜 Planejado |
| Artes | `public.pedidos_artes` | `id_int` | - | 🔜 Planejado |
| Produtos Proposta | `public.produtos_proposta` | `id_int` | - | 🔜 Planejado |
| Cobranças | `public.pagamentos_v2` | `id_int`, `id_cliente` | `id_cliente` | 🔜 Planejado |
| Boletos | `public.boletos` | `id_int`, `id_cliente` | `id_cliente` | 🔜 Planejado |
| Frete | `public.cotacao_frete` | `id_int` | - | 🔜 Planejado |
| NF-e | `public.notas_fiscais` | `ref` (NFE-{idInt}-{seq}) | - | 🔜 Planejado |
| NFS-e | `public.notas_servico` | `id_int` | - | 🔜 Planejado |
| Chat/Timeline | `public.propostas_chat` | `id_int` | `id_cliente` | 🔜 Planejado |
| Pendências | `public.propostas_pendencias` | `id_int` | `id_cliente` | 🔜 Planejado |

---

## Relacionamentos por id_int

A partir de um `id_int`, o Maestro pode navegar para todas essas tabelas:

```
propostas (id_int)
├── produtos_proposta (id_int)
│   └── produtos_proposta_variacao (id_produto_proposta)
├── pagamentos_v2 (id_int)
├── propostas_os (id_int) ← só existe após liberação para produção
│   └── pedidos_modelos (id_int)
├── pedidos_artes (id_int)
├── propostas_chat (id_int)
├── propostas_pendencias (id_int)
└── cotacao_frete (id_int)
```

---

## Relacionamentos por id_cliente

```
cadastros_clientes (id_cliente)
├── propostas (id_cliente)
├── pagamentos_v2 (id_cliente)
├── boletos (id_cliente)
└── propostas_pendencias (id_cliente)
```

---

## Dois IDs de Cliente — Diferença Crítica

| Campo | Tipo | Uso |
|---|---|---|
| `clientDisplayCode` | string ("8469") | Código exibido ao usuário |
| `clientInternalId` | number (8469) | Inteiro usado em filtros SQL (propostas.id_cliente) |

> ⚠️ Nunca assumir que são iguais sem confirmar. O adapter retorna ambos.

---

## Ciclo de Vida: Orçamento → Pedido → OS

```
[NOVO] → [AGUARDANDO] → [APROVADO]    ← orçamento comercial
                              ↓
                  liberarPropostaParaProducao()
                  is_prd_aprovado = true        ← pedido real
                              ↓
                  [REVISAO ATENDENTE] → [REVISAO PRODUCAO]
                              ↓
                  [EM PRODUCAO] → [EM IMPRESSAO] → [EM ACABAMENTO]
                              ↓
                  [EXPEDICAO] → [EM TRANSITO] → [ENTREGUE]
```

**Regra:** `propostas.status_interno = "APROVADO"` **não** significa pedido real.  
Pedido real = `is_prd_aprovado = true` **ou** status operacional confirmado.

---

## Regras Financeiras

### pagamentos_v2 vs boletos

| | `pagamentos_v2` | `boletos` |
|---|---|---|
| Escopo | Toda cobrança do ERP | Apenas boleto bancário C6 Bank |
| Inadimplência | Sem dias_atraso | Com `dias_atraso`, `multa`, `juros_dia` |
| Tool futura | `cobrancas.consultar` | `boletos.consultar` |

### Identificar status

| Situação | Regra |
|---|---|
| Pago | `status = "PAID"` ou `paid_at IS NOT NULL` ou (`status = "A_VENCER"` AND `confirmado = true`) |
| Pendente | status ≠ PAID/CANCELADO + paid_at IS NULL + confirmado ≠ true |
| Vencido | Pendente + `vencimento < hoje` |
| Cancelado | Excluir de cálculos: `CANCELADO`, `EXTORNADO`, `RECUSADO` |

### Tipos E-* (faturamento)
Tipos começando com `E-` (E-Faturado, E-Retrabalho, E-Permuta, E-Amostra) exigem confirmação manual financeira antes de serem considerados aprovados.

---

## Regras Fiscais

| | NF-e | NFS-e |
|---|---|---|
| Tabela | `notas_fiscais` | `notas_servico` |
| Tipo | Produto físico | Serviço |
| Modelo | 55 | Municipal |
| Gatilho | `propostas.libera_nf = true` | Idem |
| Ambiente atual | **Homologação** (não produção SEFAZ) | Não confirmado |

**O Maestro NUNCA:** emite, cancela ou altera nota fiscal.  
**O Maestro PODE:** consultar status, informar número da NF, encaminhar ao módulo Fiscal.

---

## Segurança — Campos Proibidos

O Maestro **nunca** exibe esses campos diretamente:

```
token_publico | public_token | pix_copia_cola | linha_digitavel
codigo_barras | url_cobranca | id_fatura | payload_envio
payload_retorno | chave_nfe | caminho_xml | caminho_danfe
```

**Mascaramento obrigatório:**
- CPF/CNPJ: exibir parcialmente (`***.456.789/0001-**`)
- Chave PIX pessoal: nunca exibir

---

## Tools Registradas

| Tool ID | Status | Adapter | Tabela |
|---|---|---|---|
| `clientes.consultar` | ✅ Ativo | `cadastros.adapter.ts` | `vw_cadastros_clientes_lista` |
| `propostas.consultar` | 🔜 Planejado | a criar | `public.propostas` |
| `cobrancas.consultar` | 🔜 Planejado | a criar | `public.pagamentos_v2` |
| `boletos.consultar` | 🔜 Planejado | a criar | `public.boletos` |
| `fiscal.consultar` | 🔜 Planejado | a criar | `public.notas_fiscais` |
| `os.consultar` | 🔜 Planejado | a criar | `public.propostas_os` |
| `producao.consultar` | 🔜 Planejado | a criar | `public.propostas_os + pedidos_modelos` |

---

## Intents e Templates do Planner

| Intent ID | Domínio | Tool Estimada | Status |
|---|---|---|---|
| `com-consultar-cliente` | Comercial | `clientes.consultar` | ✅ Ativo |
| `com-consultar-proposta` | Comercial | `propostas.consultar` | 🔜 Tool planejada |
| `com-criar-proposta` | Comercial | - | 🔜 Confirmação |
| `prod-consultar-pedido` | Produção | `propostas.consultar` | 🔜 Tool planejada |
| `fin-consultar-boleto` | Financeiro | `boletos.consultar` | 🔜 Tool planejada |
| `fin-consultar-pagamento` | Financeiro | `cobrancas.consultar` | 🔜 Tool planejada |
| `fis-consultar-nf` | Fiscal | `fiscal.consultar` | 🔜 Tool planejada |

---

## Fallbacks Contextuais

Quando a tool não está conectada, o Maestro responde de forma assistiva:

| Domínio | Fallback |
|---|---|
| Pedido/Proposta | Menciona o cliente ativo, explica que precisa de `propostas.consultar` + `is_prd_aprovado` |
| Financeiro | Menciona o cliente ativo, informa que `cobrancas.consultar` está planejada, nunca inventa dado |
| Boleto | Diferencia de `pagamentos_v2`, menciona `boletos.consultar` planejada, alerta sobre campos sensíveis |
| Fiscal | Explica NF-e vs NFS-e, informa que nunca emite nota, encaminha ao módulo Fiscal |
| Genérico | Mantém contexto ativo, oferece o que pode consultar (dados cadastrais do cliente) |

---

## Arquivos da Implementação

```
src/features/maestro/core/knowledge/
├── erp-ideal.context.ts        — Identidade do ERP e do Maestro
├── erp-relationships.ts        — Mapa de entidades e relacionamentos
├── business-rules.ts           — Regras de orçamento/pedido/OS/produção
├── finance-rules.ts            — Regras financeiras (pagamentos_v2, boletos)
├── fiscal-rules.ts             — Regras fiscais (NF-e, NFS-e)
├── security-rules.ts           — Segurança, campos proibidos, trilho de liberação
├── index.ts                    — ERP_IDEAL_KNOWLEDGE_BASE + helpers para Prompt Builder
└── knowledge.regras-venda.ts   — Stub (Sprint 4 — mantido)

src/features/maestro/core/
├── ai/ai.prompt.builder.ts     — Usa KB para montar system prompt
├── context/context.builder.ts  — Separa clientInternalId / clientDisplayCode
├── response/response.engine.ts — Roteamento por domínio com fallbacks contextuais
├── response/response.templates.ts — Novos templates: pedido, financeiro, fiscal
└── planner/planner.templates.ts   — Novos intents: prod-consultar-pedido, fin-consultar-pagamento, fis-consultar-nf

src/features/maestro/core/tools/adapters/
└── cadastros.adapter.ts        — Retorna idClienteInterno (int) + idCliente (string)

src/features/maestro/types/index.ts  — ConversationContext com campos novos
docs/MAESTRO-KNOWLEDGE-BASE.md       — Esta documentação
```
