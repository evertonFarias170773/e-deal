<!--
STATUS DOCUMENTAL: HISTÓRICO / LEGADO
ORIGEM: Blueprint técnico inicial de 03/07/2026
NÃO USAR COMO ARQUITETURA IMPLEMENTADA ATUAL.

Fontes vigentes relacionadas:
- ../../maestro/MAESTRO-VISAO-PRODUTO.md
- ../../maestro/MAESTRO-KNOWLEDGE-BASE.md
- ../../maestro/MAESTRO-SEGURANCA-E-GOVERNANCA.md
- ../../maestro/STATUS-MAESTRO-V2.md
- ../../architecture/ARQUITETURA-MODULAR-ERP-IDEAL.md

O documento preserva a proposta arquitetural inicial. Nomes de arquivos,
fases, componentes, agentes, tabelas e camadas descritos abaixo precisam ser
confirmados no código antes de qualquer uso.
-->

> **Status:** Histórico — blueprint inicial substituído pelo estado real do Maestro V2  
> **Uso permitido:** compreender decisões e alternativas consideradas.  
> **Não utilizar como mapa do código, roadmap vigente ou autorização de implementação.**

---

# MAESTRO — Blueprint Técnico
> Vibe · Branch: `erp-ideal-preview` · Versão: 0.2-blueprint · Data: 2026-07-03

---

## 1. Visão Geral

O **Maestro** é o **núcleo inteligente do Vibe** — um copiloto que observa, interpreta e auxilia quem usa o sistema. Ele nasce como uso **interno**, para funcionários logados, mas sua arquitetura é projetada para evoluir de forma segura para atendimento **externo** futuro a clientes, representantes e parceiros.

O Maestro não é um chat genérico. É um orquestrador com camadas de planejamento, especialização, ferramentas e controle de permissão. Cada resposta cita fontes. Cada ação é autorizada antes de executada.

### Princípios fundadores

| Princípio | Descrição |
|-----------|-----------|
| **Leitura antes de escrita** | Fase 1 exclusivamente leitura. Nenhuma escrita real sem confirmação explícita. |
| **Dados reais, nunca inventados** | Toda informação comercial vem de consulta ao banco. O Maestro nunca inventa clientes, produtos, preços ou condições. |
| **Orquestrador, não chat** | O Maestro planeja, delega a Especialistas e cita fontes. Não é um assistente de propósito geral. |
| **Permissão antes de ação** | Qualquer escrita futura depende de perfil, confirmação dupla e log de auditoria. |
| **Fallback seguro** | Quando dados não estiverem disponíveis, exibe "dados indisponíveis" — nunca dados fictícios. |
| **Separação de contextos** | Maestro Interno e Maestro Externo são contextos completamente separados em escopo e permissão. |
| **Sem lock-in de provedor de IA** | A arquitetura não depende de um único provedor. O motor de IA é plugável e substituível. |

---

## 2. Estado Atual do Projeto

### Diagnóstico realizado em 2026-07-03

| Artefato | Estado |
|----------|--------|
| `src/constants/navigation.ts` linha 27 | EXISTE — Item `Maestro` com `disabled: true` e ícone `Bot` |
| `src/app/(erp)/maestro/` | NAO EXISTE — Rota ainda não criada |
| `src/features/maestro/` | NAO EXISTE — Feature ainda não criada |
| `docs/Módulo 05-Maestro-Assistente Comercial de IA.md` | NAO ENCONTRADO |
| `public.propostas_chat` | EXISTE — Usada no módulo de Orçamentos/Chat |
| `public.propostas` | EXISTE — Integrada |
| `public.clientes` | EXISTE — Integrada |
| `public.produtos` | EXISTE — Integrada |

### Conclusão do diagnóstico

O Maestro existe apenas como item de menu desabilitado. Está em ponto zero ideal para construção limpa e modular seguindo a arquitetura de `src/features`.

---

## 3. Públicos do Maestro

O Maestro atende dois públicos distintos com escopos, permissões e interfaces completamente separados.

### 3.1 Maestro Interno (Fases 1 a 7)

Destinado a **funcionários logados no Vibe**: vendedores, gerentes, administradores e equipes de produção, expedição e financeiro.

- Acesso via autenticação Supabase Auth com sessão JWT
- Escopo filtrado por perfil, empresa e setor
- Pode acessar dados comerciais, financeiros, de produção e propostas (com permissão)
- Ações de escrita controladas por confirmação dupla e log
- Contexto compartilhado com demais módulos do ERP (seletor de empresa, escopo de dados)

### 3.2 Maestro Externo (Fase 8 — futuro)

Destinado a **clientes, representantes ou parceiros externos** com acesso extremamente restrito.

- Autenticação por token seguro, e-mail + código, CNPJ/CPF + telefone ou link com expiração
- Acesso somente aos próprios dados do cliente
- Sem acesso a dados internos, margens, custos, observações internas, financeiro de outros clientes, propostas de terceiros ou informações administrativas
- Interface simplificada, diferente do ERP interno
- Nunca compartilha contexto com o Maestro Interno

**Exemplos de uso externo permitido (quando implementado):**
- Solicitar segunda via de boleto
- Baixar PDF de nota fiscal própria
- Consultar status de pedido próprio
- Consultar status de aprovação de arte
- Reenviar link de pagamento
- Consultar rastreio de entrega
- Abrir solicitação de atendimento

> ATENCAO: O Maestro Externo NAO sera implementado antes da Fase 8 e NAO pode ser desbloqueado sem aprovação explícita de segurança, negócio e TI.

---

## 4. Modos de Uso do Maestro

| Modo | Descrição | Público |
|------|-----------|---------|
| **Modo Conversa** | Interação livre em linguagem natural. O usuário faz perguntas e o Maestro responde com dados reais. | Interno e Externo (escopo limitado) |
| **Modo Assistente** | O Maestro guia o usuário por um fluxo estruturado. Ex: criação de orçamento, revisão de proposta. | Interno |
| **Modo Automação** | O Maestro executa ações controladas com base em gatilhos ou confirmações explícitas. | Interno — somente Fases 7+ |

---

## 5. Camadas Inteligentes do Maestro

O Maestro não é um chat simples. Ele possui camadas internas que separam responsabilidades, garantindo modularidade, segurança e escalabilidade.

```
+--------------------------------------------------------------+
|                     INPUT DO USUÁRIO                         |
+--------------------------------------------------------------+
                             |
                             v
+--------------------------------------------------------------+
|                     PLANNER (Planejador)                     |
|  Decompõe o pedido em etapas. Decide quais Especialistas     |
|  e Tools chamar. Valida se a intenção é permitida antes de   |
|  agir. Nunca chama ferramentas diretamente sem plano.        |
+--------------------------------------------------------------+
                             |
            +----------------+----------------+
            |                |                |
            v                v                v
+------------------+ +------------------+ +------------------+
|   ESPECIALISTA   | |   ESPECIALISTA   | |   ESPECIALISTA   |
|  (ex: Comercial) | |  (ex: Orçamento) | | (ex: Financeiro) |
|  Domínio focado. | |  Domínio focado. | |  Domínio focado. |
+------------------+ +------------------+ +------------------+
            |                |                |
            v                v                v
+--------------------------------------------------------------+
|                     TOOL REGISTRY                            |
|  Registro central de todas as ferramentas disponíveis.       |
|  Cada tool tem: nome, escopo, permissão, entrada, saída,     |
|  risco e modo (leitura/escrita).                             |
+--------------------------------------------------------------+
            |                |                |
            v                v                v
+------------------+ +------------------+ +------------------+
|   TOOLS          | |  KNOWLEDGE BASE  | |   MEMORY         |
|  Consultas reais | |  Docs internos,  | |  Histórico de    |
|  ao Supabase     | |  regras, produtos| |  sessão e        |
|  (leitura/esc.)  | |  e processos     | |  preferências    |
+------------------+ +------------------+ +------------------+
                             |
                             v
+--------------------------------------------------------------+
|                     ACTION GUARD                             |
|  Barreira de segurança final. Bloqueia qualquer ação de      |
|  escrita ou ação sensível que não tenha permissão explícita  |
|  do perfil ativo + confirmação do usuário. Registra log.     |
+--------------------------------------------------------------+
                             |
                             v
+--------------------------------------------------------------+
|                    RESPOSTA AO USUÁRIO                       |
|  Texto + fontes citadas + painel de atividade + ações        |
+--------------------------------------------------------------+
```

### 5.1 Planner — Planejador

O Planner é o ponto de entrada de toda intenção do usuário. Ele:

- Analisa o texto recebido e identifica a intenção principal
- Decompõe pedidos complexos em etapas sequenciais seguras
- Decide quais Especialistas e Tools serão acionados
- Verifica previamente se a intenção é permitida para o perfil ativo
- Nunca chama ferramentas diretamente sem decompor o plano antes
- Limita profundidade de delegação (máximo 3 níveis de profundidade)

> O Planner é o único ponto que conhece o contexto completo do usuário, empresa e permissões.

### 5.2 Especialistas (Experts)

Especialistas são unidades de lógica focada em um domínio do ERP. Em termos de produto chamamos de "Especialistas"; no código os arquivos podem ter o prefixo `agent.*`.

| Especialista | Domínio | Arquivo técnico | Fase |
|---|---|---|---|
| Especialista Comercial | Interpretação de intenção, resumo de clientes e propostas | `agent.comercial.ts` | Fase 3 |
| Especialista de Orçamento | Criação guiada de orçamentos, cálculo de preços e frete | `agent.orcamento.ts` | Fase 4 |
| Especialista Financeiro | Pagamentos, boletos, inadimplência (somente leitura) | `agent.financeiro.ts` | Fase 3 |
| Especialista de Produtos | Busca, variações, estoque e sugestão de produtos | `agent.produtos.ts` | Fase 3 |
| Especialista de Pedidos | Acompanhamento de pedidos e produção | `agent.pedidos.ts` | Fase 5 |
| Especialista de Memória | Persistência de contexto e preferências do usuário | `agent.memoria.ts` | Fase 5 |
| Especialista Externo | Atendimento restrito a clientes externos | `agent.externo.ts` | Fase 8 |

Cada Especialista:
- Conhece apenas seu domínio
- Só acessa Tools autorizadas para aquele domínio
- Retorna resultados estruturados com fonte
- Não inventa dados

### 5.3 Tool Registry — Registro Central de Ferramentas

O Maestro nunca chama ferramentas avulsas. Todas as ferramentas são registradas em um registry central, com metadados explícitos:

```typescript
interface ToolRegistryEntry {
  name: string;               // Identificador único
  description: string;        // O que a tool faz
  scope: 'internal' | 'external';  // Contexto permitido
  mode: 'read' | 'write';    // Tipo de operação
  requiredProfiles: string[]; // Perfis que podem usar
  inputSchema: object;        // Estrutura da entrada
  outputSchema: object;       // Estrutura da saída
  riskLevel: 'low' | 'medium' | 'high'; // Nível de risco
  requiresConfirmation: boolean;         // Exige confirmação dupla
  tables: string[];           // Tabelas acessadas
}
```

Ao receber um plano do Planner, o Maestro consulta o Tool Registry antes de executar qualquer ferramenta. Se a tool não estiver registrada, ou o perfil não tiver permissão, a chamada é bloqueada pelo Action Guard.

### 5.4 Knowledge Base — Base de Conhecimento

A Knowledge Base separa claramente duas fontes de informação:

**Dados Operacionais (Supabase — dados reais):**
- Clientes cadastrados
- Produtos e variações
- Propostas e orçamentos
- Pedidos e produção
- Financeiro e cobranças
- Notas fiscais

**Conhecimento Interno (documentos e regras):**
- Regras de venda (ex: mínimo de pedido, condições especiais)
- Explicações de produtos (fichas técnicas, diferenciais)
- Processos operacionais (fluxo de aprovação, prazos)
- Instruções de atendimento (scripts, respostas padrão)
- Documentos internos (políticas, tabelas de preço base)

> Dados operacionais sempre vêm do Supabase com SELECT e citação de fonte. Conhecimento interno pode ser carregado de arquivos `.md`, `.json` ou tabelas dedicadas sem dados de cliente.

### 5.5 Memory — Memória de Sessão

A Memory armazena contexto entre interações do mesmo usuário:

- Proposta ou cliente que estava sendo trabalhado
- Preferências de visualização do vendedor
- Histórico de consultas recentes
- Contexto de fluxo guiado em andamento (ex: orçamento não finalizado)

Implementada na Fase 5. Requer criação de nova tabela `public.maestro_sessions` (com migration aprovada).

### 5.6 Tools — Ferramentas de Consulta

As Tools são funções tipadas que realizam operações reais, sempre via Tool Registry. Seguem política de somente leitura até a Fase 7.

**Contrato padrão:**

```typescript
interface MaestroTool<TInput, TOutput> {
  name: string;
  description: string;
  registryEntry: ToolRegistryEntry;
  execute: (input: TInput, context: MaestroContext) => Promise<MaestroToolResult<TOutput>>;
}

interface MaestroToolResult<T> {
  data: T | null;
  source: string;       // Tabela/view consultada
  queriedAt: string;    // ISO timestamp
  error?: string;
}
```

| Tool | Tabela consultada | Modo | Fase |
|------|------------------|------|------|
| `tool.clientes` | `public.clientes` | Leitura | 3 |
| `tool.produtos` | `public.produtos` + variações | Leitura | 3 |
| `tool.propostas` | `public.propostas` + `produtos_proposta` | Leitura | 3 |
| `tool.frete` | `public.cotacao_frete` | Leitura | 4 |
| `tool.financeiro` | `public.pagamentos_v2` + `public.boletos` | Leitura restrita | 3 |
| `tool.pedidos` | `public.pedidos` | Leitura | 5 |
| `tool.fiscal` | tabelas NF-e/NFS-e (a mapear) | Leitura | 6 |
| `tool.externo.boleto` | `public.boletos` (filtro por cliente) | Leitura externa | 8 |
| `tool.externo.nf` | tabelas fiscais (filtro por cliente) | Leitura externa | 8 |
| `tool.externo.pedido` | `public.pedidos` (filtro por cliente) | Leitura externa | 8 |

### 5.7 Action Guard — Barreira de Segurança

O Action Guard é a última camada antes de qualquer ação sensível. Ele:

- Verifica se o perfil do usuário autoriza a ação
- Verifica se o contexto (empresa, escopo) é compatível
- Exige confirmação dupla do usuário para ações de escrita
- Bloqueia completamente qualquer ação não registrada no Tool Registry
- Registra em log toda ação executada ou bloqueada
- Exibe na UI o motivo do bloqueio de forma clara e não técnica

---

## 6. Painel de Atividade

A UI do Maestro deve exibir em tempo real as etapas que estão sendo executadas. Isso aumenta transparência, confiança e rastreabilidade.

### 6.1 Etapas exibidas no painel

| Etapa | Ícone sugerido | Descrição |
|-------|----------------|-----------|
| Analisando pedido | Loader animado | Planner interpretando a intenção |
| Cliente identificado | CheckCircle verde | Dados do cliente carregados |
| Produto localizado | CheckCircle verde | Produto encontrado no catálogo |
| Preço consultado | CheckCircle verde | Tabela de preços verificada |
| Frete verificado | CheckCircle verde | Cotação de frete localizada |
| Fonte consultada | Database icon | Tabela e timestamp da consulta |
| Resposta montada | Bot icon | Resposta gerada com base nos dados |
| Ação bloqueada | Lock vermelho | Permissão insuficiente — motivo exibido |
| Aguardando confirmação | AlertCircle laranja | Ação de escrita aguardando aprovação |

### 6.2 Componente MaestroActivityPanel

```
+-------------------------------+
| Painel de Atividade           |
+-------------------------------+
| [✓] Cliente identificado      |
|     João Silva — CNPJ: ...    |
| [✓] Proposta localizada       |
|     #1234 — R$ 4.800,00       |
| [✓] Frete consultado          |
|     cotacao_frete — 10:32:01  |
| [⟳] Montando resposta...      |
| [⚠] Fonte: public.propostas   |
+-------------------------------+
```

Este componente é mockado na Fase 1 e conectado a dados reais a partir da Fase 3.

---

## 7. Arquitetura Proposta — `src/features/maestro`

A estrutura segue o padrão modular do Vibe (vide `ARQUITETURA-MODULAR-ERP-IDEAL.md`).

```
src/features/maestro/
├── index.ts
├── types.ts
├── constants.ts
│
├── MaestroPage.tsx
│
├── components/
│   ├── MaestroPageHeader.tsx
│   ├── MaestroConversationArea.tsx
│   ├── MaestroMessageBubble.tsx
│   ├── MaestroQuickSuggestions.tsx
│   ├── MaestroContextPanel.tsx
│   ├── MaestroActivityPanel.tsx       # Painel de etapas executadas (novo)
│   ├── MaestroSourcesCard.tsx
│   ├── MaestroActionBar.tsx
│   ├── MaestroRecentHistory.tsx
│   └── MaestroStatusBadge.tsx
│
├── planner/
│   └── maestro.planner.ts             # Decomposição de intenção em etapas (Fase 2+)
│
├── registry/
│   └── tool.registry.ts               # Registro central de ferramentas (Fase 2+)
│
├── hooks/
│   ├── useMaestroSession.ts
│   ├── useMaestroContext.ts
│   └── useMaestroPermissions.ts
│
├── services/
│   ├── maestro.service.ts             # Orquestrador principal
│   ├── maestro-context.service.ts     # Contexto ativo do usuário
│   └── maestro-guard.service.ts       # Action Guard (Fase 3+)
│
├── tools/
│   ├── tool.clientes.ts
│   ├── tool.produtos.ts
│   ├── tool.propostas.ts
│   ├── tool.frete.ts
│   ├── tool.financeiro.ts
│   ├── tool.pedidos.ts
│   ├── tool.fiscal.ts                 # NF-e / NFS-e (Fase 6)
│   └── external/                      # Tools externas com escopo restrito (Fase 8)
│       ├── tool.externo.boleto.ts
│       ├── tool.externo.nf.ts
│       └── tool.externo.pedido.ts
│
├── knowledge/
│   ├── knowledge.regras-venda.ts      # Regras de venda e condições
│   ├── knowledge.produtos.ts          # Fichas técnicas e diferenciais
│   └── knowledge.processos.ts         # Instruções operacionais internas
│
├── agents/                            # Especialistas por domínio
│   ├── agent.comercial.ts
│   ├── agent.orcamento.ts
│   ├── agent.financeiro.ts
│   ├── agent.produtos.ts
│   ├── agent.pedidos.ts
│   ├── agent.memoria.ts
│   └── agent.externo.ts              # Especialista externo (Fase 8)
│
└── mocks/
    ├── maestro-session.mock.ts
    ├── maestro-messages.mock.ts
    ├── maestro-activity.mock.ts       # Mock do painel de atividade (novo)
    └── maestro-context.mock.ts
```

---

## 8. Rota Next.js

```
src/app/(erp)/maestro/
└── page.tsx    # Shell fina — importa MaestroPage de src/features/maestro
```

A rota `/maestro` permanece com `disabled: true` em `navigation.ts` até que a Fase 1 (UI mockada) seja aprovada.

> Nenhuma rota pública ou externa será criada antes da Fase 8 e sem aprovação de segurança.

---

## 9. Layout Visual da Tela — Fase 1

### Estrutura de grid (desktop)

```
+-------------------------------------------------------------------+
|  PageHeader: "Maestro" · icone Bot · badge "Interno" · status    |
+-------------------------------+-----------------------------------+
|                               |  MaestroContextPanel             |
|  MaestroConversationArea      |  --------------------------      |
|                               |  Contexto ativo:                 |
|  +-------------------------+  |  Proposta #1234                  |
|  | Mensagem do usuario     |  |  Cliente: João Silva             |
|  +-------------------------+  |  Empresa: Ideal                  |
|                               |  --------------------------      |
|  +-------------------------+  |  MaestroActivityPanel            |
|  | Resposta do Maestro     |  |  --------------------------      |
|  | Fonte: [proposta #1234] |  |  [✓] Cliente identificado        |
|  +-------------------------+  |  [✓] Proposta localizada         |
|                               |  [✓] Fonte consultada            |
|  MaestroQuickSuggestions      |  --------------------------      |
|  [Ver proposta] [Orçamento]   |  MaestroSourcesCard              |
|  [Pendencias] [Resumir]       |  public.propostas · 10:32:01     |
|                               |  --------------------------      |
|  +-------------------------+  |  MaestroRecentHistory            |
|  | Digite sua pergunta...  |  |  Hoje 10:32 — Proposta           |
|  +-------------------------+  |  Ontem 15:10 — Cliente           |
|                               |  --------------------------      |
|  MaestroActionBar (bloq.)     |  MaestroActionBar (bloq.)        |
+-------------------------------+-----------------------------------+
```

### Padrão visual (respeita `PADROES-UX-UI.md`)

| Elemento | Token aplicado |
|----------|---------------|
| Header | `--primary` (#0a2540) |
| Badge "Interno" | `--secondary` (#0d9488) teal |
| Badge "Externo" (futuro) | `--accent` (#e07b16) laranja |
| Badge "Processando" | `--accent` pulsante |
| Badge "Erro" | `--action-danger` (#dc2626) |
| Balão usuário | `--card` com borda `--primary` |
| Balão Maestro | `--card` com ícone Bot e borda teal |
| Etapa concluída no painel | CheckCircle verde |
| Etapa bloqueada | Lock vermelho com tooltip |
| Fontes citadas | chips com ícone de banco de dados |

---

## 10. Segurança — Público Interno

### 10.1 Política de não invenção de dados

```
SE dados reais não disponíveis:
  → Exibir: "Não encontrei dados para essa consulta. Verifique se o registro existe."
  → NAO gerar dados fictícios
  → NAO interpolar valores de outros registros
  → NAO usar dados de mocks em produção
```

### 10.2 Permissões por perfil (a implementar nas Fases 2–3)

| Perfil | Leitura | Orçamento assistido | Ações de escrita |
|--------|---------|--------------------|--------------------|
| `vendedor` | Próprias propostas e clientes | Fase 4 | Nunca automático |
| `gerente` | Equipe inteira | Fase 4 | Confirmação dupla |
| `admin` | Tudo | Fase 4 | Confirmação dupla + log |
| `visualizador` | Somente leitura própria | Não | Não |

### 10.3 Dados financeiros — proteção máxima

- `public.pagamentos_v2` — somente leitura, requer perfil `admin` ou `gerente`
- `public.boletos` — somente leitura
- Nunca exibir dados financeiros de outras empresas sem escopo validado
- Qualquer ação em dados financeiros exige confirmação explícita + log

### 10.4 Escopo de empresa

O Maestro respeita o `CompanySwitcher` ativo. Consultas sempre filtradas por empresa selecionada, seguindo a infraestrutura de `getDataScope` já estabelecida.

---

## 11. Segurança — Público Externo (Fase 8)

> Esta seção é planejamento futuro. Nenhum item abaixo será implementado antes da Fase 8 e sem aprovação explícita.

### 11.1 Autenticação e validação de identidade

- Token seguro com expiração configurável (ex: 24h ou por sessão)
- Validação por combinação de CNPJ/CPF + e-mail ou telefone
- Links com expiração e uso único para ações sensíveis
- Nenhum acesso sem autenticação confirmada

### 11.2 Escopo completamente restrito

O cliente externo só pode acessar dados dele mesmo, validados no momento da autenticação.

**Nunca acessar:**
- Dados de outros clientes
- Margens, custos ou observações internas
- Propostas de terceiros
- Dados administrativos ou financeiros internos
- Qualquer dado que não seja do próprio cliente autenticado

### 11.3 Controles operacionais

- Rate limit por IP e por token (ex: máx. 20 req/min)
- Log completo de toda interação externa
- Auditoria com timestamp, IP, token, ação e resultado
- Mascaramento de dados sensíveis nas respostas (ex: CNPJ parcial, valor mascarado)
- Separação total entre contexto interno e contexto externo — sem cruzamento possível
- Sessão isolada sem acesso ao ERP interno

---

## 12. Mapeamento de Tabelas (Futuras Dependências)

> Nenhuma alteração de banco nesta fase. Apenas mapeamento de dependências futuras.

| Tabela | Uso no Maestro | Fase | Acesso |
|--------|---------------|------|--------|
| `public.clientes` | Busca e contexto de cliente | 3 | Leitura interna |
| `public.produtos` | Catálogo e busca de produtos | 3 | Leitura interna |
| `public.propostas` | Resumo e análise de propostas | 3 | Leitura interna |
| `public.produtos_proposta` | Itens de proposta | 3 | Leitura interna |
| `public.cotacao_frete` | Simulação de frete | 4 | Leitura interna |
| `public.propostas_chat` | Histórico de chat por proposta | 3 | Leitura interna |
| `public.pagamentos_v2` | Resumo financeiro (restrito) | 3 | Leitura admin/gerente |
| `public.boletos` | Inadimplência e segunda via | 3/8 | Leitura interna; leitura externa restrita |
| `public.pedidos` | Acompanhamento de produção | 5/8 | Leitura interna; leitura externa restrita |
| Tabelas NF-e/NFS-e | Notas fiscais para download | 6/8 | A mapear quando integradas |
| `public.maestro_sessions` | Memória de sessão | 5 | Leitura/escrita controlada |
| `public.maestro_audit_log` | Log de ações | 7 | Escrita append-only |

---

## 13. Roadmap por Fases

### Fase 0 — Blueprint (concluído)
> Documentar, planejar e alinhar antes de qualquer código.
- [x] Diagnóstico do estado atual
- [x] Arquitetura de `src/features/maestro` definida
- [x] Camadas inteligentes documentadas
- [x] Públicos interno e externo diferenciados
- [x] Regras de segurança documentadas
- [x] Roadmap criado

---

### Fase 1 — UI Mockada (interna)
> Tela visual completa com dados mockados. Sem backend, sem IA.

**Entregas:**
- `src/app/(erp)/maestro/page.tsx` (shell)
- `src/features/maestro/MaestroPage.tsx` e todos os componentes
- Mocks em `mocks/` incluindo `maestro-activity.mock.ts`
- `MaestroActivityPanel` com etapas mockadas
- Item de menu habilitado apenas após aprovação visual

**Critério:** Tela visível, responsiva, com padrão visual do ERP. Zero chamadas ao Supabase.

---

### Fase 2 — Motor de Interpretação + Planner
> Input do usuário processado por Planner com decomposição de intenção.

**Entregas:**
- `maestro.planner.ts` com parser básico de intenção por palavras-chave
- `tool.registry.ts` com registro inicial de tools mock
- Mapeamento de intenções: "resumir proposta", "buscar cliente", "ver pendências"
- `MaestroActivityPanel` atualizado conforme etapas do Planner
- Fontes mockadas com timestamp

**Critério:** Usuário digita "resumir proposta 1234" e o Maestro exibe etapas, dados mockados e fonte.

---

### Fase 3 — Tools de Leitura Real
> Substituir mocks por consultas reais ao Supabase (somente leitura).

**Entregas:**
- `tool.clientes.ts`, `tool.produtos.ts`, `tool.propostas.ts` conectadas ao banco
- `maestro-context.service.ts` com leitura real
- `maestro-guard.service.ts` verificando perfil antes de cada tool
- `MaestroContextPanel` e `MaestroActivityPanel` com dados reais
- Respeito a RLS e escopo de empresa

> ATENCAO: Apenas SELECT nesta fase. Nenhuma escrita.

---

### Fase 4 — Orçamento Assistido + Motor de IA
> Especialista de Orçamento guia criação de propostas em linguagem natural.

**Entregas:**
- `agent.orcamento.ts` ativo
- `tool.frete.ts` conectada
- Fluxo guiado: "Criar orçamento para cliente X com produto Y"
- Simulação de totais e frete
- ActionBar com "Salvar rascunho" (escrita controlada + confirmação dupla)
- Integração com motor de IA via interface plugável (sem lock-in de provedor)

> DECISAO PENDENTE (D1): Escolha do provedor de IA (OpenAI / Gemini / Anthropic).

---

### Fase 5 — Memória de Sessão
> Maestro lembra contexto entre sessões do mesmo usuário.

**Entregas:**
- Nova tabela `public.maestro_sessions` (requer migration aprovada)
- `agent.memoria.ts` ativo
- `MaestroRecentHistory` com histórico real

> Requer criação de migration com aprovação explícita antes de iniciar.

---

### Fase 6 — Especialistas por Domínio
> Cada área do ERP tem seu Especialista orquestrado pelo Maestro.

**Entregas:**
- `agent.comercial.ts` — pipeline, clientes em risco, oportunidades
- `agent.financeiro.ts` — inadimplência e fluxo de caixa (leitura)
- `agent.pedidos.ts` — acompanhamento de produção e expedição
- `tool.fiscal.ts` — consulta de NF-e/NFS-e (se integradas ao banco)
- Sistema de roteamento de intenção entre Especialistas

---

### Fase 7 — Ações Controladas (Internas)
> Maestro executa ações reais internas com confirmação dupla e log completo.

**Entregas:**
- Ações permitidas definidas com negócio (ex: atualizar status de proposta)
- Action Guard ativo e auditado
- `public.maestro_audit_log` criado e gravado
- Rollback documentado para ações reversíveis

> EXIGE APROVAÇÃO EXPLÍCITA DE NEGÓCIO E TI antes de iniciar.

---

### Fase 8 — Maestro Externo (Portal de Cliente)
> Atendimento externo a clientes, representantes ou parceiros com escopo extremamente restrito.

**Entregas:**
- Interface separada e independente do ERP interno
- Autenticação por token + validação de identidade
- `agent.externo.ts` com domínio restrito
- Tools externas: `tool.externo.boleto.ts`, `tool.externo.nf.ts`, `tool.externo.pedido.ts`
- Rate limit, log, auditoria e mascaramento de dados
- Separação total de contexto interno/externo

> ESTA FASE EXIGE: aprovação de segurança, aprovação de negócio, aprovação de TI, definição de regras de escopo, testes em staging e rollback documentado. NAO iniciar sem todos esses pré-requisitos.

---

## 14. Riscos e Decisões Pendentes

### Riscos identificados

| # | Risco | Impacto | Mitigação |
|---|-------|---------|-----------|
| R1 | Maestro exibir dado de outro cliente/empresa | Alto | Filtro obrigatório por escopo + RLS |
| R2 | Invenção de dados quando IA não tem certeza | Alto | Política explícita de fallback seguro |
| R3 | Escrita acidental no banco por bug de ferramenta | Alto | Fase 1-3 sem nenhuma escrita implementada |
| R4 | Custo excessivo de tokens de IA em produção | Médio | Rate limiting por usuário/sessão (Fase 4) |
| R5 | Loop de chamadas entre Especialistas | Médio | Limite de profundidade do Planner (max 3 níveis) |
| R6 | RLS bloqueando tools de leitura de dados próprios | Médio | Testar cada tool com usuário real antes de liberar |
| R7 | Dados financeiros expostos sem verificação de perfil | Alto | Action Guard verificando perfil em toda tool financeira |
| R8 | Cliente externo acessando dados de outro cliente | Crítico | Fase 8 com validação de identidade obrigatória + escopo por ID |
| R9 | Lock-in de provedor de IA | Médio | Interface plugável sem depender de SDK específico |
| R10 | Rota externa exposta sem autenticação | Crítico | Nenhuma rota pública antes da Fase 8 aprovada |

### Decisões pendentes (requerem aprovação)

| # | Decisão | Responsável | Fase impactada |
|---|---------|-------------|----------------|
| D1 | Escolha do provedor de IA (OpenAI / Gemini / Anthropic) | Tech Lead + Negócio | Fase 4 |
| D2 | Quais ações o Maestro pode executar na Fase 7 | Negócio | Fase 7 |
| D3 | Política de retenção de histórico de sessão | Tech Lead | Fase 5 |
| D4 | Escopo de dados do Especialista Financeiro (por vendedor ou gerente) | Negócio | Fase 3 |
| D5 | Onde armazenar memória de sessão (Supabase ou Redis) | Tech Lead | Fase 5 |
| D6 | Habilitar botão Maestro no menu antes ou depois da Fase 1 | Product | Fase 1 |
| D7 | Quais ações externas são permitidas na Fase 8 | Negócio + Jurídico | Fase 8 |
| D8 | Método de autenticação do Maestro Externo | TI + Segurança | Fase 8 |
| D9 | Tabelas fiscais NF-e/NFS-e já existem no banco? | Tech Lead | Fase 6 |

---

## 15. O que NAO fazer (Restrições absolutas)

- NAO criar migrations sem aprovação explícita
- NAO alterar schema, RLS, triggers, RPCs ou views existentes
- NAO fazer escrita real no Supabase antes da Fase 4 e sem confirmação
- NAO integrar API de IA antes da Fase 4
- NAO criar Edge Functions sem aprovação
- NAO alterar módulos críticos: pagamentos_v2, boletos, vw_proposta_completa
- NAO remover mocks ou fallbacks existentes de outros módulos
- NAO inventar dados comerciais
- NAO criar triggers que possam causar loops infinitos
- NAO alterar lógica de cálculo de frete ou peso sem autorização
- NAO criar rota pública ou externa antes da Fase 8 aprovada
- NAO acoplar o Maestro a um único provedor de IA
- NAO cruzar contexto interno e externo de forma alguma

---

## 16. Checklist de Validação (Fase 0 atualizada)

- [x] `docs/MAESTRO-BLUEPRINT.md` atualizado para versão 0.2
- [x] `docs/MAESTRO-VISAO-PRODUTO.md` criado
- [x] Nenhuma migration criada
- [x] Nenhum schema, RLS, trigger, RPC ou view alterado
- [x] Nenhuma escrita real no Supabase
- [x] Nenhuma UI implementada
- [x] Nenhuma integração com IA
- [x] Menu do Maestro continua desabilitado
- [x] Planner, Especialistas, Tool Registry, Knowledge Base, Memory, Tools e Action Guard documentados
- [x] Maestro Interno e Maestro Externo diferenciados
- [x] Roadmap inclui Fase 8 externa
- [x] Riscos e decisões pendentes atualizados
- [x] Restrições absolutas documentadas

---

## 17. Próximo Passo Sugerido

**Fase 1: UI Mockada (Maestro Interno)**

Para iniciar: solicite explicitamente **"Iniciar Fase 1 do Maestro — UI Mockada"**.

---

> **Governança:** Todas as decisions arquiteturais deste documento estão sujeitas às regras definidas em [MAESTRO-SEGURANCA-E-GOVERNANCA.md](../../maestro/MAESTRO-SEGURANCA-E-GOVERNANCA.md), que atua como Constituição de Segurança do Maestro.

*Documento atualizado por Antigravity · Vibe · 2026-07-03 · Versão 0.2*
*Nenhuma alteração de banco de dados foi realizada nesta etapa.*
