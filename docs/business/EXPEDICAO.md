# EXPEDICAO.md

Versão: 1.0
Status: Oficial — Correios em homologação
Última atualização: 15/08/2026
Projeto: Vibe

---

# Expedição e Logística

Este documento descreve o que está implementado no módulo de Expedição do Vibe em 15/08/2026 — não o planejado nem etapas futuras de um roadmap.

O painel `/expedicao` (`src/features/expedicao/ExpedicaoPage.tsx`, rota `src/app/(erp)/expedicao/page.tsx`) cobre o funil logístico de uma proposta já liberada para produção, do `APROVADO` até `ENTREGUE`. Quem opera as transições e o despacho é o expedidor — na prática, qualquer usuário com a permissão `expedicao.processar` (seção 8).

O status oficial do pedido continua em `public.propostas.status_interno`, conforme `FLUXO-OFICIAL-STATUS-PROPOSTAS.md` §6.13–6.15. A Expedição não substitui essa fonte: ela acrescenta uma tabela de execução (`public.expedicoes`) e uma tela para operar as transições que já existiam no fluxo oficial.

---

# 1. O Que É

- Rota: `/expedicao` → `src/app/(erp)/expedicao/page.tsx` → componente `ExpedicaoPage`.
- Navegação cruzada com a Fila Geral de produção: link "Voltar para Fila Geral (OS)" para `/pedidos`.
- Universo do painel: propostas com `is_prd_aprovado = true` e `status_interno` num dos status do funil (`STATUS_FUNIL_EXPEDICAO`, em `expedicao.service.ts`) — desde `APROVADO`/`LIBERADO`, passando pelas etapas de produção e acabamento, até `EXPEDICAO`, `A RETIRAR`, `EM TRANSITO` e `ENTREGUE`.
- Cada `status_interno` é agrupado numa `EtapaExpedicao` (tipo em `src/features/expedicao/types.ts`) para exibição: `PRODUCAO`, `ACABAMENTO`, `PRONTO` (o status real por trás é `EXPEDICAO`), `A_RETIRAR`, `EM_TRANSITO`, `ENTREGUE`.
- 6 cards de resumo (`SummaryCard`), um por etapa — clicar num card filtra a lista por aquela etapa (`toggleEtapa`).
- 4 chips de alerta — Atrasados, Prometidos hoje, Sem NF, Frete a definir — cada um filtra a lista (`toggleAlerta`).
- Filtros (busca, etapa, alerta, tipo de frete, empresa) vivem na URL (`q`, `etapa`, `alerta`, `frete`, `emp`), no padrão de `PADRAO-FILTROS-URL-NAVEGACAO.md`. Não existe seletor global de empresa: o filtro `emp` segue o mesmo padrão da Fila Geral — opções derivadas dos próprios dados carregados, não de um cadastro à parte.
- Padrão da lista: `etapa=ATIVOS` (oculta `ENTREGUE`); pedidos entregues somem do painel depois de 30 dias (seção 3).
- Botão "Transportadoras" abre um modal (`TransportadorasModal`) de consulta/atalho de cadastro sobre `public.clientes` com `categoria = 'TRANSPORTADORA'` (24 cadastros em 15/08/2026, via `getTransportadoras()`) — não é uma tabela própria da Expedição, reaproveita o cadastro de clientes.

---

# 2. Fontes de Dados

`listarPainelExpedicao()` (`src/features/expedicao/services/expedicao.service.ts`) monta cada linha do painel (tipo `PedidoExpedicao`) buscando em paralelo 7 tabelas:

| # | Tabela | O que fornece | Chave |
|---|---|---|---|
| 1 | `public.propostas` | cliente, empresa, `status_interno`, `libera_nf`, `volume`; filtro `is_prd_aprovado = true` | `id_int` |
| 2 | `public.propostas_os` | `data_termino` (promessa exibida), `codigo_rastreamento` (legado), `obs` | `id_int` |
| 3 | `public.cotacao_frete` | `servico`, `valor`, `peso` da cotação com `escolhido = true` | `id_int` |
| 4 | `public.notas_fiscais` | `status`, `numero_nf` | `id_int` |
| 5 | `public.expedicoes` | dados de execução gravados pelo expedidor (peso aferido, volumes, transportadora, rastreio, prepostagem, datas) | `id_int` (única) |
| 6 | `public.clientes` | nome, fantasia, `cidade_uf` do destinatário | `id_cliente` |
| 7 | `public.produtos_proposta` | `peso_total` por item (somado = peso teórico do pedido) | `id_int` |

Erro ao buscar qualquer uma das tabelas 2, 4, 5, 6 ou 7 é tolerado (loga aviso, segue com o que faltar vazio); erro em `cotacao_frete` é logado com destaque (`console.error`) porque a tela antiga tinha um bug nesse ponto.

Duas tabelas adicionais entram fora do painel, em pontos específicos: `public.enderecos` (endereço de entrega — escolhido no despacho > mesmo CEP da cotação > mais recente do cliente) e `public.empresas` (dados do remetente — casada por nome com `propostas.empresa` via `ilike`, com fallback para a primeira empresa cadastrada).

`propostas.libera_nf` é lido e vira `PedidoExpedicao.liberaNf`, mas hoje esse campo não é exibido nem usado em nenhuma condição da tela — está calculado e disponível, sem consumidor ainda.

## 2.1 Precedências

- **Peso**: aferido (`expedicoes.peso_kg`) > cotado (`cotacao_frete.peso`, em gramas, convertido para kg) > teórico (soma de `produtos_proposta.peso_total`).
- **Rastreio**: `expedicoes.codigo_rastreamento` > `propostas_os.codigo_rastreamento` (campo legado, mantido para telas antigas).
- **Tipo de frete**: `expedicoes.tipo_frete` (definido no despacho) > normalização de `cotacao_frete.servico` (seção 5).
- **Transportadora exibida**: `expedicoes.transportadora_nome` > `cotacao_frete.servico` (texto cru da cotação).
- **NF**: `AUTORIZADA` vence qualquer outra; senão, qualquer nota não `CANCELADA` conta como `PENDENTE`; sem registro nenhum = `SEM_NF`.

---

# 3. Estados e Transições

O status oficial continua em `propostas.status_interno` (`FLUXO-OFICIAL-STATUS-PROPOSTAS.md` §6.13–6.15). As funções abaixo (`src/features/expedicao/services/expedicao-acoes.service.ts`) operam essa transição e, na sequência, gravam os dados de execução em `public.expedicoes`:

| Função | Transição | Tipo | Efeito em `expedicoes` |
|---|---|---|---|
| `marcarPronto` | (produção/acabamento) → `EXPEDICAO` | NATURAL | `data_pronto` |
| `despachar` | `EXPEDICAO` → `EM TRANSITO` (transporte) ou `A RETIRAR` (retirada) | NATURAL | tipo de frete, transportadora, peso, volumes, endereço, rastreio, `data_despacho`, `despachado_por` |
| `confirmarRetirada` | `A RETIRAR` → `ENTREGUE` | NATURAL | `data_entrega`, `retirado_por` |
| `marcarEntregue` | `EM TRANSITO` → `ENTREGUE` | NATURAL | `data_entrega` |
| `voltarStatus` | desfaz 1 passo (abaixo) | RETORNO | limpa a data do passo desfeito |

`marcarPronto` recusa se o status atual já estiver em `STATUS_FLUXO_LOGISTICO` (`EXPEDICAO`, `A RETIRAR`, `EM TRANSITO`, `ENTREGUE`) — não dá para "marcar pronto" duas vezes.

`despachar` confirma a transição de status ANTES de gravar os dados em `expedicoes`: se a gravação falhar depois de o status já ter mudado, a mensagem de erro orienta explicitamente a usar "Editar dados de expedição" para regravar — o pedido não fica travado, mas os dados ficam pendentes de uma nova tentativa. `despachar` também espelha `codigo_rastreamento` em `propostas_os` (best-effort — falha aqui só gera aviso em console).

`voltarStatus` desfaz exatamente 1 passo:

```text
ENTREGUE      -> EM TRANSITO (ou A RETIRAR, se foi retirada balcão)
EM TRANSITO   -> EXPEDICAO
A RETIRAR     -> EXPEDICAO
EXPEDICAO     -> EM ACABAMENTO
```

Não há retorno definido a partir de nenhum outro status (produção, acabamento antes de "EM ACABAMENTO" etc.) — a UI já esconde a opção "Voltar status" nesses casos.

## 3.1 Guarda de concorrência

Toda transição roda como `UPDATE propostas SET status_interno = novo WHERE id_int = X AND status_interno = statusEsperado`. Se a cláusula `WHERE` não achar nenhuma linha (porque outra aba já mudou o status), a operação falha com uma mensagem de conflito pedindo para recarregar a lista, em vez de sobrescrever silenciosamente um status mais novo.

## 3.2 Corrida documentada em "Voltar status"

Ao voltar de `ENTREGUE`, a escolha entre `A RETIRAR` e `EM TRANSITO` depende de um `SELECT` solto (sem lock) em `expedicoes.tipo_frete`/`retirado_por`, feito antes do `UPDATE` em `propostas`. Uma edição concorrente entre esse `SELECT` e o `UPDATE` pode, em teoria, escolher o braço errado. Isso é aceito conscientemente no código como operação de baixo volume/baixa concorrência (balcão) e reversível — um novo "Voltar status" corrige. A correção completa exigiria uma RPC transacional (`SELECT ... FOR UPDATE` + `UPDATE` na mesma transação), não implementada nesta fase.

## 3.3 Trilha de auditoria (`os_status_log`)

Toda transição bem-sucedida grava uma linha em `public.os_status_log` com `origem = 'EXPEDICAO_UI'`, `resultado = 'sucesso'`, `tipo_transicao` (`NATURAL` ou `RETORNO`), `ator_tipo = 'USUARIO'`, `ator_uid`/`ator_nome` do usuário logado, e o motivo (preenchido em "Voltar status"; nulo nas demais). Falha ao gravar essa linha não desfaz a transição — é só observabilidade: loga aviso em console e segue.

A tabela já existia (criada para o QR de produção) com RLS ligado e zero policies — só as RPCs `SECURITY DEFINER` do QR público conseguiam escrever. A migration `20260815_expedicoes.sql` deu à Expedição do ERP uma policy de `INSERT` para `authenticated`, sem `SELECT`/`UPDATE`/`DELETE`: escrita e esquecida do lado do client.

---

# 4. Regra de Nota Fiscal

A falta de NF-e autorizada nunca bloqueia uma transição de status ou o despacho — é alerta, não trava:

- No modal Despachar, se o pedido não está com NF `AUTORIZADA` e é o primeiro despacho (não uma edição posterior), aparece um aviso vermelho com uma caixa de confirmação ("Despachar mesmo assim..."); o botão de confirmar só funciona depois de marcá-la.
- Reabrir o modal em modo edição (já despachado) não repete esse aviso.
- O chip de alerta "Sem NF" (contagem no topo da tela) e o badge "SEM NF" na coluna NF da lista só existem para pedidos nas etapas `PRONTO`, `A_RETIRAR` ou `EM_TRANSITO`. Em produção ou acabamento, não ter NF ainda é normal e não gera alerta; em `ENTREGUE`, o alerta também deixa de aparecer.

---

# 5. Normalizador de Tipo de Frete

`normalizarTipoFrete()` (`src/features/expedicao/lib/tipo-frete.ts`) reduz o texto livre de `cotacao_frete.servico` a 6 categorias canônicas (`TipoFreteNormalizado`):

| Categoria | Regra de match | Exemplos reais e nº de ocorrências (levantamento de 15/08/2026) |
|---|---|---|
| `CORREIOS` | "SEDEX" ou "PAC" como palavra isolada | SEDEX (490) |
| `MOTOBOY` | contém "MOTOBOY" | MOTOBOY (69) |
| `TRANSPORTADORA` | contém SÃO MIGUEL, UNESUL, BRASPRESS/BRASPESS, AZUL, ECOMM, VEPPO, TROCA ou a palavra "TRANSPORTADORA" | SÃO MIGUEL (28), AZUL ECOMM/ECOMM/AZUL (34), VEPPO/VEPPO-RS (23), UNESUL (5), BRASPRESS/BRASPESS (3), TROCA (2), TRANSPORTADORA PARCEIRA (5) |
| `RETIRA_BALCAO` | contém "RETIRA" ou "BALCAO" | RETIRA* (25) |
| `SEM_CUSTO` | contém "SEM CUSTO" | SEM CUSTO (97) |
| `INDEFINIDO` | não casa com nada acima | FRETE INCLUSO (1077 — nome enganoso, mas cai aqui), e lixo textual ("12", "AS", "DD", "NÃO", "FRETE"...) |

Duas decisões importantes do normalizador:

- **"SEM CUSTO" é frete grátis, não é retirada.** Corrige a heurística antiga da tela, que classificava "SEM CUSTO" como retirada local — são conceitos diferentes (envio sem cobrança vs. o cliente vem buscar no balcão).
- A checagem de "RETIRA" acontece antes da de "TRANSPORTADORA" (para não classificar errado um serviço que combine as duas palavras); acentos são removidos do texto antes de qualquer comparação.

Essa normalização só se aplica enquanto não há uma escolha explícita do expedidor: assim que o despacho grava `expedicoes.tipo_frete`, esse valor passa a valer para o pedido (precedência da seção 2.1).

---

# 6. Etiquetas

## 6.1 Etiqueta interna (10×15 cm)

- Rota: `GET /api/expedicao/etiqueta?id_int=...&volumes=...` (`src/app/api/expedicao/etiqueta/route.ts`), exige permissão `expedicao.view`.
- Monta um "view model" (`montarEtiquetaViewModel`, `src/features/expedicao/services/etiqueta-viewmodel.service.ts`): remetente = `public.empresas` casada por nome com `propostas.empresa` (fallback: primeira empresa cadastrada); destinatário = cliente + endereço de entrega (mesma precedência da seção 2).
- PDF gerado com `@react-pdf/renderer` (`EtiquetaPdfDocument`, `src/features/expedicao/pdf/EtiquetaPdfDocument.tsx`): página de 100×150mm (10×15cm), **1 página por volume** (`vm.volumes`, ajustável por query param `volumes` na própria rota), com QR code (link `/orcamentos/:id_int` do pedido — serve para conferência interna, não é rastreio) gerado com a lib `qrcode`.
- No front, `abrirEtiqueta()` (`src/features/expedicao/services/etiqueta.client.ts`) abre a aba de forma síncrona no clique para não cair no bloqueio de pop-up do navegador; se for bloqueada mesmo assim, baixa o PDF por `fetch` autenticado com Bearer token.

## 6.2 Etiqueta oficial dos Correios (prepostagem)

Fluxo em duas etapas: gerar a prepostagem (grava o objeto no sistema dos Correios) e depois baixar o rótulo oficial em PDF.

- Geração: `POST /api/expedicao/correios/prepostagem` (`src/app/api/expedicao/correios/prepostagem/route.ts`), exige permissão `expedicao.processar`. Chama `criarPrepostagem()` (`src/lib/correios/cws.ts`), grava `expedicoes.correios_id_prepostagem`, `correios_codigo_objeto` e usa o código do objeto também como `codigo_rastreamento`; espelha em `propostas_os` (best-effort).
- Rótulo: `GET /api/expedicao/correios/etiqueta?id_int=...` (`src/app/api/expedicao/correios/etiqueta/route.ts`), exige permissão `expedicao.view`. Baixa o PDF assíncrono (`baixarRotuloPdf`, `tipoRotulo: "P"`, `formatoRotulo: "ET"`) com até 6 tentativas de poll.
- Status: `GET /api/expedicao/correios/status` informa se as credenciais estão configuradas (`configurado`) e qual ambiente (`ambiente`: `producao` ou `homologacao`).
- No modal Despachar, os botões "Gerar prepostagem SEDEX/PAC" só aparecem quando o tipo de frete é `CORREIOS` e `correiosStatus()` confirma `configurado: true`.
- O formulário do modal é **salvo antes** de chamar a prepostagem: a rota lê peso e endereço já persistidos em `expedicoes`, então qualquer alteração ainda não salva na tela seria ignorada. Por isso `handleGerarPrepostagem` chama `salvarDadosExpedicao()` primeiro e só segue para os Correios se esse salvamento confirmar sucesso.

Ver seção 9 para as limitações conhecidas dessa integração — leitura obrigatória antes de qualquer teste com os Correios de verdade.

---

# 7. Rastreio via n8n

- `rastrearObjeto()` (`src/features/expedicao/services/rastro.service.ts`) chama, via `POST`, o webhook `https://10074.hostoo.net.br/webhook/rastro-e-deal-todos` — um fluxo n8n do dono, externo ao ERP — com `{ rastro: codigo }`.
- Resposta esperada: `{ sucesso: boolean, mensagem: string }`. `mensagem` é texto formatado estilo WhatsApp (`*negrito*`, blocos `╭...╰` para eventos, emojis como marcadores de campo).
- `parseMensagemRastro()` interpreta esse texto num resumo (campo → valor, ex. "Status", "Situação atual", "Previsão de entrega") e numa lista de eventos (título, data, local, detalhe). Se o formato mudar no n8n e nada for reconhecido, o modal (`RastreioModal`) cai no texto bruto (`mensagemBruta`) — nunca quebra a tela.
- **Detecção de entrega**: considera entregue quando o texto (status + situação atual + título do 1º evento, em minúsculas) contém "entregue" **e não** contém "não entregue"/"nao entregue". Uma negação explícita nunca conta como entrega — distinção necessária porque mensagens como "Objeto não entregue — destinatário ausente" também contêm a palavra "entregue".
- O atalho **"Marcar entregue"** dentro do modal de rastreio só aparece quando três condições valem ao mesmo tempo: usuário tem permissão de operação (`expedicao.processar` + fallback admin), o rastreio deu `entregue: true`, **e** o pedido está na etapa `EM_TRANSITO` (não aparece para `A_RETIRAR`, nem depois de já `ENTREGUE`).

---

# 8. Permissões

| Permissão | Rótulo no catálogo | Libera no código |
|---|---|---|
| `expedicao.view` | "Visualizar Expedição" | Ver o painel `/expedicao` e gerar as duas etiquetas (interna e Correios) |
| `expedicao.processar` | "Processar Envio / Retirada" | Marcar pronto, despachar, confirmar retirada, marcar entregue, voltar status, editar dados de expedição, gerar prepostagem Correios |

Fallback: `user.isSuperAdmin || user.isAdmin` sempre libera visualização e operação, tanto no client (`ExpedicaoPage.tsx`) quanto no server (`verificarPermissaoServerSide`, em `src/lib/auth/verificar-permissao.ts`, retorna `true` direto se `is_super_adm`; se o perfil do usuário não tiver a permissão específica nem `"*"`, o fallback final da função ainda é `is_admin`).

Duas notas de nomenclatura:

- **Não existe `expedicao.operar`.** Esse era o nome usado no plano original da task; o código implementado usa `expedicao.processar` em todo lugar (telas e rotas).
- O catálogo de perfis (`src/features/usuarios-perfis/components/PerfisPermissoesPanel.tsx`) também define `expedicao.admin` ("Configurar Expedição" — "Permite configurar métodos de envio e integrações logísticas"), mas nenhuma tela ou rota da Expedição checa essa chave hoje. Está reservada, sem uso.

---

# 9. Limitações Conhecidas (Correios)

A integração com a API CWS dos Correios (`src/lib/correios/cws.ts`) foi construída sem acesso ao Swagger oficial (login-gated) — validada por cruzamento de fontes públicas secundárias. Antes de qualquer teste real, atenção a:

1. **Dimensões declaradas fixas: 10×20×25 cm.** `cotacao_frete.altura`, `largura` e `comprimento` estão `NULL` em 100% das cotações reais — nenhum fluxo do sistema grava esses campos hoje. Enquanto isso não mudar, toda prepostagem sai com esse padrão de caixa (`src/app/api/expedicao/correios/prepostagem/route.ts`), independentemente do tamanho real do pacote.
2. **`itensDeclaracaoConteudo` não implementado.** Esse campo aparece em fontes secundárias sobre o DTO da API, mas sem a estrutura interna confirmada — para não inventar um formato, ele não entra no payload de `criarPrepostagem()`. **É o primeiro suspeito se a homologação retornar HTTP 400.**
3. **`cienteObjetoNaoProibido: "S"` validado só documentalmente**, por cruzamento de fontes públicas (não pelo Swagger oficial, inacessível sem login do dono). O mesmo vale para os valores fixos de `modalidadePagamento` e `codigoFormatoObjetoInformado` (mantidos por convenção histórica dos Correios).
4. **Telefone ausente é omitido, nunca vai vazio.** Se o telefone (remetente ou destinatário) tiver menos de 10 dígitos após limpeza, os campos `dddTelefone`/`telefone` inteiros somem do payload em vez de irem como string vazia (`telefoneParaPayload()`) — suspeita de que uma string vazia causaria 400 na Correios.
5. **Comece sempre em `CORREIOS_AMBIENTE=homologacao`.** Só considerar `producao` depois de gerar e conferir uma prepostagem e um rótulo reais em homologação.

---

# 10. Pendências do Dono

1. Atribuir `expedicao.processar` aos perfis que efetivamente vão operar a expedição no dia a dia — a chave já existe no catálogo (`PerfisPermissoesPanel.tsx`); hoje, na prática, só admin/super admin conseguem operar (via fallback).
2. Preencher as credenciais dos Correios em `.env.local` (`CORREIOS_AMBIENTE`, `CORREIOS_USUARIO`, `CORREIOS_CODIGO_ACESSO`, `CORREIOS_CARTAO_POSTAGEM`; opcionalmente `CORREIOS_SERVICO_SEDEX`/`CORREIOS_SERVICO_PAC`) e replicar as mesmas variáveis na Vercel antes de publicar.
3. Validar a etiqueta em homologação (SEDEX e PAC) antes de trocar `CORREIOS_AMBIENTE` para `producao`.
4. Rodar um roteiro manual de validação visual: painel (cards, chips, filtros), os quatro modais (Despachar, Confirmar retirada, Voltar status, Rastreio) e os PDFs de etiqueta (interna e Correios) impressos em 10×15 real.
5. Preencher `telefone_nfe` nas empresas cadastradas sem esse campo (3 das 4 empresas, em 15/08/2026) — sem ele, o remetente sai incompleto na etiqueta interna e o telefone some do payload da prepostagem (seção 9, item 4).

---

# 11. Decisões de 15/08/2026

- A entrada no fluxo logístico parte de uma ação explícita do expedidor ("Marcar pronto"), não de automação por status.
- Dados de execução da expedição ganharam tabela própria, `public.expedicoes` (1 linha por `id_int`) — `propostas.peso` é `smallint` (estoura perto de 32kg) e `cotacao_frete` é histórico de cotação, que não deve ser mutado depois de fechado.
- Etiqueta interna no formato 10×15cm, uma página por volume, com QR de conferência.
- Falta de NF-e nunca bloqueia o despacho — vira alerta com confirmação explícita, não trava a operação.

---

# 12. Documentação Relacionada

- `./FLUXO-OFICIAL-STATUS-PROPOSTAS.md`
- `./PEDIDOS-PRODUCAO.md`
- `../technical/PERFIS-PERMISSOES.md`
- `../technical/MATRIZ-SEGURANCA-ESCRITA-SUPABASE.md`
- `../technical/PADRAO-FILTROS-URL-NAVEGACAO.md`
- `../BUSINESS_RULES.md`
- `../SECURITY.md`

---

# Fonte da Verdade

Este documento descreve o estado implementado do módulo de Expedição.

O status oficial do pedido continua em `public.propostas.status_interno`; `public.expedicoes` guarda apenas a execução (peso aferido, volumes, transportadora, rastreio, prepostagem e datas).

Fontes principais:

```text
public.propostas
public.propostas_os
public.cotacao_frete
public.notas_fiscais
public.expedicoes
public.clientes
public.produtos_proposta
public.os_status_log
```

A Matriz de Segurança e o catálogo de permissões definem quem pode ver e quem pode operar.
