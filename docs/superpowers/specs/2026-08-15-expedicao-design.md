# Expedição — Design (15/08/2026)

Status: aprovado em conversa (seções 1–3) — aguardando revisão final do documento
Módulo: Expedição (`/expedicao`)
Branch: `erp-ideal-preview` (branch única)

---

## 1. Objetivo

Transformar a tela de Expedição — hoje somente-leitura, vazia em produção e fora
do padrão visual — no centro de controle logístico do ERP: do acabamento à
entrega, com dados 100% reais, alertas visuais de urgência, etiquetas térmicas
e integração oficial com os Correios.

## 2. Decisões de negócio (fechadas com o dono)

| Decisão | Escolha |
|---|---|
| Entrada no funil | O **expedidor marca "Pronto"** na própria tela. A lista mostra o funil desde a produção (visibilidade de acabamento, atrasados, prometidos do dia). |
| Correios | Empresa **tem contrato + credenciais CWS** — integração real de prepostagem/rótulo via `api.correios.com.br`, começando em homologação. |
| Etiqueta térmica | **10×15 cm** (100×150 mm), PDF no tamanho exato, impressão pelo navegador. |
| Pedido sem NF | **Alerta forte, sem bloqueio** — badge "SEM NF" + confirmação explícita ao despachar. |
| Dados de execução | **Tabela nova `expedicoes`** (1 linha por `id_int`). Status oficial permanece em `propostas.status_interno`. |

## 3. Estado atual (diagnóstico)

- A tela ativa é `src/features/expedicao/ExpedicaoPage.tsx` (~300 linhas), rota
  `src/app/(erp)/expedicao/page.tsx`. Dados reais, porém:
  - **Bug**: `expedicao.service.ts:81` seleciona colunas inexistentes em
    `cotacao_frete` (`transportadora`, `peso_usado`, `volumes`, `observacao`);
    o select falha silenciosamente e todo pedido cai em "SEM FRETE". Os nomes
    reais são `servico` e `peso` (ver mapper correto em `frete.service.ts:7`).
  - **0 pedidos em produção**: nenhuma proposta tem status logístico; não existe
    botão no ERP que mova para `EXPEDICAO` (só o QR público, com flag desligada).
  - Somente-leitura (botão de ação é toast "Fase 1B"), sem `PermissionGuard`,
    sem componentes oficiais (`SummaryCard`, `StatusBadge`, `ResponsiveList`...).
- **Código morto mockado**: `src/features/pedidos/ExpedicaoPage.tsx` (582 linhas,
  transportadora sorteada por `id % 3`), exportado em
  `src/features/pedidos/index.ts:8`, sem rota. **Será apagado.**
- Fatos do banco (15/08/2026): 7 pedidos ativos (`is_prd_aprovado=true` em
  status produtivo); `propostas.prazo_operacional` vazio em 100% deles;
  `propostas_os.data_termino` preenchido em 7/7 → **fonte da promessa**;
  `cotacao_frete.servico` é texto livre ("FRETE INCLUSO" 1.077×, "SEDEX" 490×,
  variantes de "RETIRA", "BRASPRESS"/"BRASPESS", lixo "12"/"AS"/"DD") →
  **precisa de normalizador**; `propostas_os.id_endereco` vazio em 100% →
  endereço de entrega vem de `public.enderecos` por cliente;
  24 cadastros `clientes.categoria='TRANSPORTADORA'`.

## 4. A tela

Estrutura no padrão de `PedidosListPage`/`conta-corrente`, componentes oficiais.

### 4.1 Cards do funil (`SummaryCard`, clicáveis = filtro de etapa)

| Card | Status contados | Tom |
|---|---|---|
| Em produção | `APROVADO`, `REVISAO ATENDENTE`, `REVISAO PRODUCAO`, `EM PRODUCAO`, `EM IMPRESSAO`, `EM IMPRESSAO / PENDENTE` | neutral |
| Em acabamento | `EM ACABAMENTO`, `EM ACABAMENTO / PENDENTE` | info |
| Pronto p/ expedir | `EXPEDICAO` | warning |
| A retirar | `A RETIRAR` | special |
| Em trânsito | `EM TRANSITO` | info |
| Entregues | `ENTREGUE` com entrega nos últimos 30 dias | success |

Universo da query: `propostas.is_prd_aprovado = true` e status acima
(ENTREGUE limitado a 30 dias pela `expedicoes.data_entrega`; sem registro em
`expedicoes`, entra no recorte — hoje são 0 casos). Filtro de Empresa
(`propostas.empresa`) no padrão real do sistema: select por página com estado
na URL (`emp`), como na Fila Geral — não existe seletor global no código
(corrigido na revisão de 15/08 durante o plano).

### 4.2 Faixa de alertas (chips clicáveis)

- 🔴 **Atrasados (n)** — `data_termino < hoje` e status ≠ `ENTREGUE`.
- 🟠 **Prometidos hoje (n)** — `data_termino = hoje` e status ≠ `ENTREGUE`.
- **Sem NF (n)** — status `EXPEDICAO` em diante sem NF-e `AUTORIZADA` em
  `notas_fiscais` (pedido ainda em produção sem NF é normal e não conta no chip;
  o badge da coluna NF aparece em todas as linhas).
- **Frete a definir (n)** — tipo normalizado `INDEFINIDO` (ex.: "FRETE INCLUSO")
  e ainda sem transportadora definida em `expedicoes`.

### 4.3 Filtros (padrão `useUrlFilters` — estado na URL)

- Busca com debounce: nº (`id_int`), cliente, rastreio.
- Select **tipo de frete** (normalizado): Correios / Motoboy / Transportadora /
  Retira balcão / Sem custo / A definir.
- Etapa (cards) e alertas (chips) também viram parâmetros de URL.

### 4.4 Lista (`ResponsiveList` — tabela desktop, cards mobile)

Colunas: `Pedido #id_int` (+ sigla da empresa) · `Cliente` (nome + cidade/UF) ·
`Status` (`StatusBadge`) · `Promessa` (`data_termino`; "ATRASADO Xd" vermelho /
"HOJE" âmbar) · `Frete` (ícone do tipo + transportadora/serviço + peso · volumes)
· `NF` (verde nº / vermelho "SEM NF" / âmbar "PENDENTE") · `Rastreio` (clique
copia) · `Ações`.

- Peso exibido: `expedicoes.peso_kg` (aferido) → `cotacao_frete.peso` (cotado,
  em gramas → kg) → soma de `produtos_proposta.peso_total` (teórico). Indicar a
  origem (ex.: sufixo "aferido"/"previsto").
- Volumes: `expedicoes.qtd_volumes` → `propostas.volume`.
- Highlight de linha (`getRowHighlight`): vermelho p/ atrasado, âmbar p/ hoje.
- Ordenação padrão: atrasados → prometidos hoje → demais por `data_termino` asc.
- Visão padrão: funil ativo (sem `ENTREGUE`). Entregues aparecem somente ao
  clicar no card "Entregues" (ordenados por `data_entrega` desc).

### 4.5 Ação primária contextual por status

| Status | Botão primário | Efeito |
|---|---|---|
| produção/acabamento | Marcar pronto | → `EXPEDICAO` + `expedicoes.data_pronto` |
| `EXPEDICAO` | Despachar… | modal (4.6) → `EM TRANSITO` ou `A RETIRAR` |
| `A RETIRAR` | Confirmar retirada | modal (quem retirou) → `ENTREGUE` |
| `EM TRANSITO` | Marcar entregue | confirmação → `ENTREGUE` |

Menu ⋯: Etiqueta térmica (Nº de volumes) · Etiqueta Correios (se tipo Correios e
credenciais configuradas) · **Rastrear** (linhas com rastreio — modal do §8.1) ·
Editar dados de expedição · Voltar status (1 passo, com confirmação e motivo em
`os_status_log`) · Copiar rastreio · Ver pedido.

### 4.6 Modal "Despachar"

- **Tipo de entrega**: transporte | retirada — pré-preenchido pelo tipo de frete
  normalizado; editável.
- **Transportadora**: combobox = serviço da cotação escolhida + cadastros
  `categoria='TRANSPORTADORA'` (ativos) + texto livre. Preenche
  `transportadora_nome` e, quando for cadastro, `id_transportadora_cliente`.
- **Peso aferido (kg)** e **volumes (qtd + tipo: Pacote/Caixa/Envelope/Outro)** —
  pré-preenchidos com previsto/cotado.
- **Endereço de entrega**: seletor de `enderecos` do cliente (default: o que
  casa com o CEP da cotação; senão `tipo_endereco` de entrega; senão o único).
  Usado na etiqueta e na prepostagem.
- **Rastreio**: campo manual OU botão "Gerar prepostagem Correios" (fase 4).
- **Aviso SEM NF**: destaque vermelho + confirmação explícita (não bloqueia).
- Confirmar: grava `expedicoes`, espelha rastreio em
  `propostas_os.codigo_rastreamento`, move status (retirada → `A RETIRAR`;
  transporte → `EM TRANSITO`), loga em `os_status_log`.

### 4.7 Header

`PageHeader` + botão "Transportadoras" (modal leve: busca nos cadastros
`TRANSPORTADORA`, linha com "Editar" → `/cadastros/[id]/editar`, botão "Nova
transportadora" → `/cadastros/novo?categoria=TRANSPORTADORA`). O
`CadastroFormPage` passa a aceitar categoria inicial via query param (mudança
pequena; sem duplicar o formulário de 2.254 linhas em modal).

## 5. Modelo de dados

### 5.1 Migration — `public.expedicoes`

```sql
create table public.expedicoes (
  id bigint generated always as identity primary key,
  id_int integer not null unique,
  tipo_frete text,                        -- CORREIOS|MOTOBOY|TRANSPORTADORA|RETIRA_BALCAO|SEM_CUSTO|INDEFINIDO
  transportadora_nome text,
  id_transportadora_cliente integer references public.clientes(id_cliente),
  peso_kg numeric,
  qtd_volumes integer,
  tipo_volume text,
  id_endereco_entrega uuid references public.enderecos(id),
  codigo_rastreamento text,
  correios_id_prepostagem text,
  correios_codigo_objeto text,
  data_pronto timestamptz,
  data_despacho timestamptz,
  data_entrega timestamptz,
  despachado_por text,
  retirado_por text,
  obs text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

- RLS no mesmo padrão de `propostas_os_setores` (20260813): enable RLS +
  políticas `to authenticated` para select/insert/update; **sem** política
  `anon`; delete não é necessário (sem política = bloqueado).
- Cabeçalho da migration em PT-BR com o quê/por quê/rollback, como as demais.
- Atualizar `docs/technical/MATRIZ-SEGURANCA-ESCRITA-SUPABASE.md` com a tabela.

### 5.2 Fontes lidas pelo service novo (`listarPainelExpedicao`)

| Fonte | Campos |
|---|---|
| `propostas` | `id_int`, `empresa`, `id_cliente`, `status_interno`, `libera_nf`, `frete_escolhido`, `valor_frete`, `volume`, `cep` |
| `clientes` | `nome`/`fantasia`, `cidade_uf`, `whatsapp_1` |
| `propostas_os` | `data_termino`, `codigo_rastreamento`, `nota_fiscal_url`, `obs` |
| `cotacao_frete` (`escolhido=true`) | `servico`, `valor`, `peso`, `prazo`, `cep`, `altura/largura/comprimento` |
| `notas_fiscais` | `status`, `numero_nf` por `id_int` (`AUTORIZADA` vence) |
| `expedicoes` | tudo |
| `produtos_proposta` | soma de `peso_total` (fallback teórico) |

### 5.3 Normalizador de tipo de frete

Função pura `normalizarTipoFrete(servico)` em `src/features/expedicao/lib/`,
derivada dos valores reais do banco:

- `CORREIOS`: SEDEX, PAC
- `MOTOBOY`: MOTOBOY (com/sem espaço)
- `TRANSPORTADORA`: SÃO MIGUEL/EXPRESSO SÃO MIGUEL, UNESUL, BRASPRESS/BRASPESS,
  AZUL/AZUL ECOMM/ECOMM/AZUL EXPRESSO, VEPPO/VEPPO-RS, TROCA TRANSPORTES,
  TRANSPORTADORA PARCEIRA
- `RETIRA_BALCAO`: RETIRA, RETIRADA, BALCÃO/BALCAO (alinhado ao SQL
  `osqr__forma_entrega`; **corrige** a heurística atual do front que trata
  "SEM CUSTO" como retirada)
- `SEM_CUSTO`: SEM CUSTO (frete grátis — ainda é envio)
- `INDEFINIDO`: FRETE INCLUSO, FRETE, NÃO, vazio e demais lixos → candidato a
  "Frete a definir"; o despacho define o tipo real em `expedicoes.tipo_frete`.

Precedência: `expedicoes.tipo_frete` (definido no despacho) > normalização da
cotação escolhida.

## 6. Transições de status (escrita)

- Service autenticado (mesmo padrão dos demais módulos): `UPDATE
  propostas.status_interno` + `INSERT os_status_log` (`origem='EXPEDICAO_UI'`,
  `ator_tipo='USUARIO'`, `ator_uid`, `ator_nome`, `status_anterior`,
  `status_novo`, `tipo_transicao`, `motivo` quando houver).
- Transições permitidas (fluxo oficial `FLUXO-OFICIAL-STATUS-PROPOSTAS.md` §6.13):
  produção → `EXPEDICAO` → (`A RETIRAR` | `EM TRANSITO`) → `ENTREGUE`.
  "Voltar status" desfaz exatamente 1 passo, com confirmação + motivo.
- Guarda de concorrência: o update usa `WHERE status_interno = <status esperado>`
  e falha com aviso se outro usuário já moveu o pedido (recarrega a lista).

## 7. Etiqueta térmica interna (10×15)

- `GET /api/expedicao/etiqueta?id_int=X` — mesmo padrão de
  `/api/pedidos/imprimir-os` (`@react-pdf/renderer`; client reutiliza o padrão
  `abrirPdfOs` de `imprimir-os.client.ts`: `window.open` síncrono no clique,
  fallback download).
- Página de exatamente 100×150 mm; **1 página por volume** ("VOLUME 1/3"...),
  quantidade vinda de `expedicoes.qtd_volumes` (parâmetro sobrepõe).
- Conteúdo: remetente (empresa do pedido — `public.empresas` casada por nome
  com `propostas.empresa`; "E3 Brindes" não tem linha → fallback para a empresa
  matriz, resolvido na implementação) · destinatário em fonte grande (nome,
  endereço selecionado, CEP, cidade/UF, A/C `recebedor`, telefone) ·
  transportadora/serviço · nº do pedido em destaque · peso · observação ·
  QR code (lib `qrcode` já no projeto) apontando para o pedido.
- Disponível para qualquer tipo de frete a partir do status `EXPEDICAO`.

## 8. Correios — prepostagem e rótulo oficial (API CWS)

- Credenciais **server-only** (`.env.local`; o dono replica na Vercel ao
  publicar): `CORREIOS_USUARIO`, `CORREIOS_CODIGO_ACESSO`,
  `CORREIOS_CARTAO_POSTAGEM`, `CORREIOS_AMBIENTE` (`homologacao`|`producao`).
- `GET /api/expedicao/correios/status` — diz se está configurado (controla a
  visibilidade dos botões no client).
- `POST /api/expedicao/correios/prepostagem` — autentica
  (`/token/v1/autentica/cartaopostagem`), cria a prepostagem (destinatário do
  endereço escolhido, remetente da empresa, peso/dimensões de
  `expedicoes`/`cotacao_frete`, serviço do contrato — SEDEX/PAC), grava
  `correios_id_prepostagem` + `correios_codigo_objeto` (rastreio) em
  `expedicoes` e espelha em `propostas_os.codigo_rastreamento`.
- `GET /api/expedicao/correios/etiqueta?id_int=X` — solicita o rótulo à API e
  devolve o PDF oficial 10×15 (datamatrix homologado) para impressão.
- Endpoints exatos e payloads serão validados contra a documentação oficial do
  CWS na implementação (WebFetch), **primeiro em homologação**; produção só
  após validar uma etiqueta real. Erros da API sobem no toast com a mensagem
  original.

### 8.1 Rastreamento de objetos (fluxo n8n existente — entra na Fase 2)

- Fluxo **já pronto** no n8n do dono:
  `POST https://10074.hostoo.net.br/webhook/rastro-e-deal-todos` com body
  `{"rastro": "<código>"}`. Testado em 15/08/2026: responde
  `{sucesso: boolean, mensagem: string}`, onde `mensagem` é texto formatado
  para WhatsApp (negrito `*`, emojis, cabeçalho com Categoria/Formato/Peso/
  Status/Situação/Local/Última atualização/Previsão + eventos em molduras
  `╭━┃╰`).
- Ação **"Rastrear"** em qualquer linha com código de rastreamento (foco:
  `EM TRANSITO`), abrindo modal com:
  - parse leve da `mensagem` (cabeçalho por regex nas linhas rotuladas;
    eventos separados pelas molduras) → resumo + linha do tempo;
  - **fallback**: se o parse falhar (formato do fluxo mudar), exibe o texto
    puro com quebras preservadas — nunca quebra;
  - se a situação indicar entrega ("Objeto entregue…"/status "Entregue"),
    o modal oferece o atalho **"Marcar entregue"** (transição normal do §6).
- Chamada segue o padrão dos webhooks de cotação em `frete.service.ts`
  (client → n8n); se CORS bloquear, proxy fino em
  `/api/expedicao/rastro` (decidido na implementação).
- Consulta **manual** (clique do expedidor). Polling/atualização automática de
  status por rastreio continua fora de escopo (§13).

## 9. Permissões e segurança

- Tela sob `PermissionGuard` (módulo `expedicao`), seguindo `PedidosListPage`.
- Rotas API validam sessão (mesmo padrão de `/api/pedidos/imprimir-os`).
- Nenhum segredo no client; credenciais Correios só em runtime server.
- `MATRIZ-SEGURANCA-ESCRITA-SUPABASE.md` ganha: `expedicoes` (INSERT/UPDATE
  liberado autenticado), escrita de `propostas.status_interno` pela Expedição e
  espelhamento de `propostas_os.codigo_rastreamento`.

## 10. Limpeza incluída

1. Apagar `src/features/pedidos/ExpedicaoPage.tsx` + export em
   `src/features/pedidos/index.ts:8` (mock morto).
2. Reescrever service (corrige o bug das colunas) e a página com componentes
   oficiais.
3. `StatusBadge`: adicionar tons para `EXPEDICAO`, `A RETIRAR`, `EM TRANSITO`,
   `ENTREGUE`.
4. Criar `docs/business/EXPEDICAO.md` e atualizar `DOCUMENTATION_INDEX.md`.

## 11. Fases de entrega (cada uma utilizável e testável sozinha)

1. **Painel** — migration `expedicoes` + service novo + tela completa (cards,
   alertas, filtros, lista, peso/volume, NF) + limpeza + permissão.
2. **Ações** — transições + modal Despachar + retirada/entrega + acesso rápido
   Transportadoras (+ query param no `CadastroFormPage`) + **modal Rastrear via
   n8n (§8.1 — fluxo já pronto, sem dependência de credencial)**.
3. **Etiqueta térmica** — rota PDF 10×15 + client de impressão.
4. **Correios** — status/prepostagem/rótulo + preenchimento automático do
   rastreio.

## 12. Validação

- `npx tsc --noEmit` + `npx eslint` nos arquivos alterados, a cada fase.
- Teste manual no localhost contra produção (7 pedidos reais hoje) com roteiro
  por fase; Correios validado em homologação antes de produção.
- Publicação segue o fluxo AGENTS.md (branch única, `git add -A` + push somente
  quando o dono pedir "publica").

## 13. Fora de escopo / riscos

- **Fora**: rastreamento **automático** (polling/webhook SRO atualizando status
  sozinho — a consulta manual via n8n do §8.1 está DENTRO), cotação de frete
  (já existe em Orçamentos), romaneio/manifesto de carga, expedição parcial por
  setor (doc oficial: "expedição é do pedido, não do setor").
- **Riscos**: payloads do CWS podem variar por contrato (mitigado por
  homologação); `propostas.empresa` sem linha em `empresas` (fallback de
  remetente); texto livre de `servico` pode ter valores futuros fora do
  normalizador (caem em `INDEFINIDO`, visíveis no chip "Frete a definir").
