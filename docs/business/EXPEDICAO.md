# EXPEDICAO.md

Versão: 1.1
Status: Oficial — Correios em produção (prepostagens reais emitidas em 16/08/2026)
Última atualização: 17/08/2026
Projeto: Vibe

---

# Expedição e Logística

Este documento descreve o que está implementado no módulo de Expedição do Vibe em 17/08/2026 — não o planejado nem etapas futuras de um roadmap.

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
- Filtros (busca, etapa, alerta, tipo de frete, empresa) e a visão da lista vivem na URL (`q`, `etapa`, `alerta`, `frete`, `emp`, `visao`), no padrão de `PADRAO-FILTROS-URL-NAVEGACAO.md`. Não existe seletor global de empresa: o filtro `emp` segue o mesmo padrão da Fila Geral — opções derivadas dos próprios dados carregados, não de um cadastro à parte.
- Padrão da lista: `etapa=ATIVOS` (oculta `ENTREGUE`); pedidos entregues somem do painel depois de 30 dias (seção 3).
- Botão "Transportadoras" abre um modal (`TransportadorasModal`) de consulta/atalho de cadastro sobre `public.clientes` com `categoria = 'TRANSPORTADORA'` (24 cadastros em 15/08/2026, via `getTransportadoras()`) — não é uma tabela própria da Expedição, reaproveita o cadastro de clientes.

## 1.1 Menu de ações da linha

O menu de cada pedido (`construirAcoes`, em `ExpedicaoPage.tsx`) monta os itens por etapa e por estado, nunca fixo:

| Item | Quando aparece |
|---|---|
| Rastrear objeto | há `codigo_rastreamento` |
| Editar dados de expedição | `canOperar` e etapa `A_RETIRAR`, `EM_TRANSITO` ou `ENTREGUE` (nas demais é redundante com o botão primário) |
| Imprimir etiqueta 10x15 | fora de `PRODUCAO`/`ACABAMENTO` |
| Declaração de conteúdo | fora de `PRODUCAO`/`ACABAMENTO` **e** NF diferente de `AUTORIZADA` (seção 6.3) |
| Etiqueta Correios (oficial) | existe `expedicoes.correios_id_prepostagem` |
| Boletim da produção | sempre — abre `/pedidos/boletim?id_int=…&modo=edicao` |
| Voltar status | `canOperar` e fora de `PRODUCAO`/`ACABAMENTO` (o service não define retorno a partir dessas etapas) |

"Boletim da produção" substituiu "Detalhes da proposta" em 16/08/2026: na bancada da expedição o que se consulta é o que foi produzido, não a negociação.

## 1.2 Confirmação de ação

"Marcar pronto" e "Marcar entregue" mudam o `status_interno` sem modal de dados, mas não usam mais `window.confirm` — pedem confirmação em `ConfirmarAcaoModal` (`src/features/expedicao/components/ConfirmarAcaoModal.tsx`), no mesmo padrão visual dos demais modais da tela. O diálogo nativo do navegador não é aceitável para transição de status: não segue o tema, não identifica o pedido e é indistinguível de um pop-up de site.

## 1.3 Visão "Por transportadora" (17/08/2026)

Chip ao lado dos 4 de alerta (`visao=transportadoras` na URL) troca a tabela por
colunas estilo kanban (`KanbanTransportadoras.tsx`), sem arrastar — trocar a
transportadora continua no modal Despachar/Editar. A visão consome a MESMA lista
filtrada da tabela (busca, cards, alertas, frete, empresa continuam valendo).

- É visão de BANCADA: `EM_TRANSITO` e `ENTREGUE` nunca aparecem nela (já saíram
  fisicamente da expedição) — para esses, a visão de lista. Pedido dos Correios
  com etiqueta gerada continua na bancada ("Aguardando transportadora") até o
  expedidor confirmar o despacho, que é quando o status vira `EM TRANSITO`.
- Colunas, só as não-vazias: `Retira balcão` · `Motoboy` · `Correios` · uma por
  transportadora (nome resolvido, ordem alfabética) · `Outros / A definir`
  (sem custo, frete incluso, sem nome) por último.
- Card compacto: nº, cliente, badge de status, chips `ATRASADO Xd`/`HOJE`,
  peso · volumes e o menu `⋯` (com a ação primária como primeiro item).
- **Fundo azul clarinho** = `etiquetaGerada` (prepostagem Correios OU
  `etiqueta_impressa_em` OU rastreio preenchido). Nesta visão a urgência fica
  SÓ nos chips — o fundo vermelho/âmbar da tabela não se aplica aos cards.
- **Sub-estado visual "Aguardando transportadora"**: pedido `PRONTO` (status
  oficial `EXPEDICAO`) com etiqueta gerada e que não é retira-balcão exibe esse
  badge no lugar de "Na Expedição". NÃO é um status novo em
  `propostas.status_interno` — o fluxo oficial segue
  `EXPEDICAO → A RETIRAR | EM TRANSITO → ENTREGUE`, e o "Em trânsito" continua
  sendo marcado manualmente pelo expedidor no Despachar.

---

# 2. Fontes de Dados

`listarPainelExpedicao()` (`src/features/expedicao/services/expedicao.service.ts`) monta cada linha do painel (tipo `PedidoExpedicao`) buscando em paralelo 7 tabelas:

| # | Tabela | O que fornece | Chave |
|---|---|---|---|
| 1 | `public.propostas` | cliente, empresa, `status_interno`, `libera_nf`, `volume`; filtro `is_prd_aprovado = true` | `id_int` |
| 2 | `public.propostas_os` | `data_termino` (promessa exibida), `codigo_rastreamento` (legado), `obs` | `id_int` |
| 3 | `public.cotacao_frete` | `servico`, `valor`, `peso` da cotação com `escolhido = true` | `id_int` |
| 4 | `public.notas_fiscais` | `status`, `numero_nf` | `id_int` |
| 5 | `public.expedicoes` | dados de execução gravados pelo expedidor (peso aferido, volumes, transportadora, rastreio, prepostagem, datas) e, desde 16/08/2026, o peso bruto vindo da Revisão do boletim (`peso_bruto_kg`, `pesos_volumes`) | `id_int` (única) |
| 6 | `public.clientes` | nome, fantasia, `cidade_uf` do destinatário | `id_cliente` |
| 7 | `public.produtos_proposta` | `peso_total` por item (somado = peso teórico do pedido) | `id_int` |

Erro ao buscar qualquer uma das tabelas 2, 4, 5, 6 ou 7 é tolerado (loga aviso, segue com o que faltar vazio); erro em `cotacao_frete` é logado com destaque (`console.error`) porque a tela antiga tinha um bug nesse ponto.

Duas tabelas adicionais entram fora do painel, em pontos específicos: `public.enderecos` (endereço de entrega — escolhido no despacho > mesmo CEP da cotação > mais recente do cliente) e `public.empresas` (dados do remetente — casada por nome com `propostas.empresa` via `ilike`, com fallback para a primeira empresa cadastrada).

`propostas.libera_nf` é lido e vira `PedidoExpedicao.liberaNf`, mas hoje esse campo não é exibido nem usado em nenhuma condição da tela — está calculado e disponível, sem consumidor ainda.

## 2.1 Precedências

- **Peso**: aferido (`expedicoes.peso_kg`) > cotado (`cotacao_frete.peso`, em gramas, convertido para kg) > teórico (soma de `produtos_proposta.peso_total`). `peso_bruto_kg` **não entra nessa cadeia**: é grandeza diferente (inclui embalagem), preenchida na Revisão do boletim e destinada à NF-e — ver `PEDIDOS-PRODUCAO.md` §19.
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
| `confirmarRevisao` | idem — delega a `marcarPronto` | NATURAL | grava antes volume, tipo e peso bruto (seção 3.4) |
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

## 3.4 Entrada pela Revisão do boletim (16/08/2026)

O pedido também chega a `EXPEDICAO` pelo botão **"Confirmar revisão e liberar para Expedição"** da aba Revisão do boletim (`confirmarRevisao`, em `src/features/pedidos/services/revisao-expedicao.service.ts`). Regras que valem ali:

- a função **não escreve status por conta própria**: grava volume, tipo e peso bruto em `expedicoes` e delega a transição a `marcarPronto` — mesma guarda de concorrência, mesma trilha em `os_status_log`. Não existe um segundo caminho para o mesmo estado;
- o status comparado é relido do banco no momento do clique, não o que a tela viu ao abrir: um boletim fica aberto muito tempo;
- a liberação exige todos os setores conferidos (peso real + responsável) e, do pedido, quantidade de volumes, tipo e peso bruto. Sem peso, o pedido chegaria à Expedição sem como emitir etiqueta nem prepostagem;
- as pendências são listadas por setor antes do botão, que fica desabilitado até a lista esvaziar.

O critério e os campos estão descritos em `PEDIDOS-PRODUCAO.md` §19.

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
- Monta um "view model" (`montarEtiquetaViewModel`, `src/features/expedicao/services/etiqueta-viewmodel.service.ts`): remetente = `public.empresas` casada por nome com `propostas.empresa` (fallback: primeira empresa cadastrada); destinatário = cliente + endereço de entrega (mesma precedência da seção 2); número da NF só quando existe nota `AUTORIZADA` em `notas_fiscais`.
- PDF gerado com `@react-pdf/renderer` (`EtiquetaPdfDocument`, `src/features/expedicao/pdf/EtiquetaPdfDocument.tsx`): página de 100×150mm (10×15cm), **1 página por volume** (`vm.volumes`, ajustável por query param `volumes` na própria rota).
- No front, `abrirEtiqueta()` (`src/features/expedicao/services/etiqueta.client.ts`) abre a aba de forma síncrona no clique para não cair no bloqueio de pop-up do navegador; se for bloqueada mesmo assim, baixa o PDF por `fetch` autenticado com Bearer token.
- A rota registra a geração em `expedicoes.etiqueta_impressa_em` (migration
  `20260817_expedicoes_etiqueta_impressa.sql`) após render bem-sucedido —
  best-effort, falha no registro não bloqueia o PDF. É esse carimbo que
  alimenta o `etiquetaGerada` e o sub-estado "Aguardando transportadora" da
  visão por transportadora (seção 1.3).

**Layout (redesenhado em 16/08/2026).** A versão anterior era uma lista de linhas de texto do mesmo tamanho, que deixava metade da etiqueta vazia e obrigava a ler tudo para achar a cidade. O desenho atual divide a página em blocos com moldura, hierarquizados pelo que o conferente e o transportador precisam ver de longe:

| Bloco | Conteúdo |
|---|---|
| Cabeçalho | título `DESTINATÁRIO` |
| Identificação | `NF-E` e `PEDIDO` lado a lado, em número grande (NF-E vira "—" sem nota autorizada) |
| Destinatário | nome em destaque, A/C quando houver, endereço, `BAIRRO`, **cidade/UF em corpo grande**, CEP ancorado no rodapé do bloco, e uma linha final com CNPJ/CPF e telefone |
| Transportadora | nome (ou `A DEFINIR`) e três colunas — Volumes (`n de N`), Embalagem, Peso bruto — mais o código de rastreio quando existir |
| Observação | `OBSERVAÇÃO DE TRANSPORTE`, só quando há `obs` |
| Rodapé | remetente em uma linha + QR pequeno |

O QR aponta para `{APP_URL}/orcamentos/:id_int` — **é conferência interna, não rastreio**: quem escaneia cai no pedido dentro do ERP. Se `APP_URL` não estiver definida, a rota usa o origin da própria requisição. Falha ao gerar o QR não derruba a etiqueta: sai sem ele.

## 6.2 Etiqueta oficial dos Correios (prepostagem)

Fluxo em duas etapas: gerar a prepostagem (grava o objeto no sistema dos Correios) e depois baixar o rótulo oficial em PDF.

- Geração: `POST /api/expedicao/correios/prepostagem` (`src/app/api/expedicao/correios/prepostagem/route.ts`), exige permissão `expedicao.processar`. Chama `criarPrepostagem()` (`src/lib/correios/cws.ts`), grava `expedicoes.correios_id_prepostagem`, `correios_codigo_objeto` e usa o código do objeto também como `codigo_rastreamento`; espelha em `propostas_os` (best-effort).
- Rótulo: `GET /api/expedicao/correios/etiqueta?id_int=...` (`src/app/api/expedicao/correios/etiqueta/route.ts`), exige permissão `expedicao.view`. Baixa o PDF assíncrono (`baixarRotuloPdf`, `tipoRotulo: "P"`, `formatoRotulo: "ET"`) com até 6 tentativas de poll.
- Status: `GET /api/expedicao/correios/status` informa se as credenciais estão configuradas (`configurado`) e qual ambiente (`ambiente`: `producao` ou `homologacao`).
- No modal Despachar, os botões "Gerar prepostagem SEDEX/PAC" só aparecem quando o tipo de frete é `CORREIOS` e `correiosStatus()` confirma `configurado: true`.
- O formulário do modal é **salvo antes** de chamar a prepostagem: a rota lê peso e endereço já persistidos em `expedicoes`, então qualquer alteração ainda não salva na tela seria ignorada. Por isso `handleGerarPrepostagem` chama `salvarDadosExpedicao()` primeiro e só segue para os Correios se esse salvamento confirmar sucesso.

### Credenciais por empresa (16/08/2026)

Cartão de postagem e contrato são **por CNPJ**, e as empresas do grupo têm contratos distintos. A configuração é lida por empresa:

```text
CORREIOS_AMBIENTE=producao|homologacao          (global)
CORREIOS_<empresas.id>_USUARIO
CORREIOS_<empresas.id>_CODIGO_ACESSO            (aceita também um token cws-… pronto)
CORREIOS_<empresas.id>_CARTAO_POSTAGEM
CORREIOS_<empresas.id>_CONTRATO
CORREIOS_SERVICO_SEDEX / CORREIOS_SERVICO_PAC   (opcionais: 03220 / 03298)
```

- `lerConfigCorreios(idEmpresa)` procura primeiro a variável com sufixo da empresa e cai nas variáveis sem sufixo como padrão — ambiente já configurado no formato antigo continua funcionando.
- O segredo é reconhecido pelo prefixo: valor começando com `cws-` é tratado como **token pronto** (dura horas, precisa ser trocado à mão); qualquer outro valor é tratado como **código de acesso**, e aí o token é renovado a cada operação, sem manutenção.
- `correiosConfigurado()` sem empresa responde se **alguma** está configurada — é o que a tela usa para decidir se mostra os botões.
- A empresa remetente é resolvida por `resolverEmpresaRemetente()` (`src/lib/correios/empresa-remetente.ts`), casando `propostas.empresa` com `public.empresas` por `ilike`, com fallback para a primeira linha. **As duas rotas (prepostagem e rótulo) resolvem a empresa da mesma forma**, e isso é obrigatório: o rótulo só pode ser baixado com o mesmo cartão que criou a pré-postagem — resolver diferente devolveria 403/404 dos Correios.

Ver seção 9 para as limitações conhecidas dessa integração.

## 6.3 Declaração de conteúdo (sem NF)

- Rota: `GET /api/expedicao/declaracao-conteudo?id_int=...` (`src/app/api/expedicao/declaracao-conteudo/route.ts`), exige `expedicao.view`, mesmo esquema de autenticação da etiqueta (Bearer ou cookie).
- PDF A4 (`DeclaracaoConteudoPdfDocument`) montado por `montarDeclaracaoViewModel`: remetente e destinatário completos, itens reais do pedido (descrição, quantidade, valor), totais, os textos legais exigidos e linha de assinatura. A tabela sai com no mínimo 8 linhas — uma declaração com espaço em branco é preenchível à mão na bancada.
- Aparece no menu de ações **apenas quando o pedido não tem NF-e autorizada**. É o papel que acompanha o volume nesse caso: o rótulo dos Correios traz só a etiqueta de endereçamento, não a declaração.
- Não confundir com `itensDeclaracaoConteudo` do payload da prepostagem (seção 9): aquilo é campo de API, isto é documento impresso.

---

# 7. Rastreio via n8n

- `rastrearObjeto()` (`src/features/expedicao/services/rastro.service.ts`) chama, via `POST`, o webhook `https://10074.hostoo.net.br/webhook/rastro-e-deal-todos` — um fluxo n8n do dono, externo ao ERP — com `{ rastro: codigo }`.

## 7.1 Webhook oficial dos Correios (17/08/2026)

O contrato tem a API Webhook (78) com o serviço `wh-rastro`: os Correios fazem
POST na nossa URL a cada evento do objeto — sem polling. Explorado via OpenAPI
v1.5.16 (leitura autenticada) em 17/08/2026.

- **Receiver**: `POST /api/correios/webhook`
  (`src/app/api/correios/webhook/route.ts`). Sem sessão de usuário — quem chama
  são os Correios; a autenticidade vem do HMAC `x-correios-signature` validado
  contra `CORREIOS_WEBHOOK_SECRET` (aceita SHA-256 hex/base64, com/sem prefixo
  `sha256=`; o formato exato se confirma no primeiro teste real). Escrita via
  service-role, mesmo padrão do QR público.
- **Efeitos** (trilha em `os_status_log`, `origem='CORREIOS_WEBHOOK'`,
  `ator_tipo='SISTEMA'`): postagem/coleta (`PO-1/2/9`, `CO-1/15/16`, `CMT-0`)
  move `EXPEDICAO` → `EM TRANSITO`; entrega ao destinatário
  (`BDE|BDI|BDR-1|67|68|70`) move para `ENTREGUE` (+`data_entrega`), inclusive
  direto de `EXPEDICAO` se o evento de postagem tiver se perdido. Qualquer
  evento assinado atualiza `expedicoes.correios_ultimo_evento(_em)` (migration
  `20260817_expedicoes_webhook_correios.sql`).
- **Tolerância**: corpo interpretado por campos comuns + regex de código de
  objeto (`AA123456789BR`) e de tipo de evento; evento sem objeto/pedido
  correspondente responde `200` e é ignorado (4xx faria os Correios reenviarem
  para sempre).
- **Assinatura**: gerida por `scripts/correios-webhook.mjs`
  (`--acao listar|assinar|testar|eventos`), usando `CORREIOS_<empresa>_WEBHOOK`
  como Bearer; vincula o contrato (`CORREIOS_<empresa>_CONTRATO`) à assinatura.
  Ordem de ativação: publicar o app (receiver no ar) → `assinar` → `testar`.
- **Pré-requisitos**: código de acesso CWS com APIs 78 (Webhook) e 534 (SRO
  Rastro); URL pública HTTPS com certificado de CA (Vercel atende);
  `CORREIOS_WEBHOOK_SECRET` e `SUPABASE_SERVICE_ROLE_KEY` no ambiente.
- A consulta manual via n8n (acima) continua existindo — é o botão "Rastrear
  objeto"; o webhook é o caminho automático.
- Resposta esperada: `{ sucesso: boolean, mensagem: string }`. `mensagem` é texto formatado estilo WhatsApp (`*negrito*`, blocos `╭...╰` para eventos, emojis como marcadores de campo).
- `parseMensagemRastro()` interpreta esse texto num resumo (campo → valor, ex. "Status", "Situação atual", "Previsão de entrega") e numa lista de eventos (título, data, local, detalhe). Se o formato mudar no n8n e nada for reconhecido, o modal (`RastreioModal`) cai no texto bruto (`mensagemBruta`) — nunca quebra a tela.
- **Detecção de entrega**: considera entregue quando o texto (status + situação atual + título do 1º evento, em minúsculas) contém "entregue" **e não** contém "não entregue"/"nao entregue". Uma negação explícita nunca conta como entrega — distinção necessária porque mensagens como "Objeto não entregue — destinatário ausente" também contêm a palavra "entregue".
- O atalho **"Marcar entregue"** dentro do modal de rastreio só aparece quando três condições valem ao mesmo tempo: usuário tem permissão de operação (`expedicao.processar` + fallback admin), o rastreio deu `entregue: true`, **e** o pedido está na etapa `EM_TRANSITO` (não aparece para `A_RETIRAR`, nem depois de já `ENTREGUE`).

---

# 8. Permissões

| Permissão | Rótulo no catálogo | Libera no código |
|---|---|---|
| `expedicao.view` | "Visualizar Expedição" | Ver o painel `/expedicao`, gerar as duas etiquetas (interna e Correios) e a declaração de conteúdo |
| `expedicao.processar` | "Processar Envio / Retirada" | Marcar pronto, despachar, confirmar retirada, marcar entregue, voltar status, editar dados de expedição, gerar prepostagem Correios |

Fallback: `user.isSuperAdmin || user.isAdmin` sempre libera visualização e operação, tanto no client (`ExpedicaoPage.tsx`) quanto no server (`verificarPermissaoServerSide`, em `src/lib/auth/verificar-permissao.ts`, retorna `true` direto se `is_super_adm`; se o perfil do usuário não tiver a permissão específica nem `"*"`, o fallback final da função ainda é `is_admin`).

Duas notas de nomenclatura:

- **Não existe `expedicao.operar`.** Esse era o nome usado no plano original da task; o código implementado usa `expedicao.processar` em todo lugar (telas e rotas).
- O catálogo de perfis (`src/features/usuarios-perfis/components/PerfisPermissoesPanel.tsx`) também define `expedicao.admin` ("Configurar Expedição" — "Permite configurar métodos de envio e integrações logísticas"), mas nenhuma tela ou rota da Expedição checa essa chave hoje. Está reservada, sem uso.

---

# 9. Payload dos Correios: evidência real e limitações

A primeira versão de `src/lib/correios/cws.ts` foi escrita sem acesso ao Swagger oficial (login-gated) e validada por cruzamento de fontes públicas secundárias. **Em 16/08/2026 isso deixou de ser suposição:** duas pré-postagens foram criadas de fato em **produção** pelo fluxo n8n "Correios - Emissão de Etiquetas" do dono — `AD802864385BR` (Ideal Gráfica, cartão …6812) e `AD802865749BR` (E3, cartão …6696). O payload do ERP foi alinhado ao que comprovadamente passou:

| Campo | Antes (inferido) | Agora (exercido contra a API) |
|---|---|---|
| `cienteObjetoNaoProibido` | `"S"` | **`"1"`** |
| `itensDeclaracaoConteudo` | fora do payload (estrutura desconhecida) | **presente** — `{ conteudo, quantidade, valor }`; sem itens, vai um genérico de material gráfico |
| `numeroCartaoPostagem` / `numeroContrato` | ausentes | **presentes** (contrato só quando cadastrado) |
| `solicitarColeta` | ausente | **`"N"`** |
| `modalidadePagamento` | presente | **removido** — não existia no payload aprovado, e campo extra é candidato a 400 |

Limitações que continuam valendo:

1. **Dimensões declaradas fixas: 10×20×25 cm.** `cotacao_frete.altura`, `largura` e `comprimento` estão `NULL` em 100% das cotações reais — nenhum fluxo do sistema grava esses campos hoje. Enquanto isso não mudar, toda prepostagem sai com esse padrão de caixa (`src/app/api/expedicao/correios/prepostagem/route.ts`), independentemente do tamanho real do pacote.
2. **Celular e telefone são campos diferentes, e o par certo depende do número.** A API valida `celular` com 9 dígitos e `telefone` com 8: mandar um celular no campo `telefone` volta como *"Telefone do destinatário inválido"* — foi exatamente o erro da primeira emissão pela tela, e o mesmo que o fluxo n8n já havia resolvido. `contatoParaPayload()` decide pelo tamanho: 9 dígitos → `dddCelular`/`celular`; 8 → `dddTelefone`/`telefone`.
3. **Contato ausente é omitido, nunca vai vazio.** Menos de 10 dígitos após limpeza, ou tamanho fora do padrão brasileiro, e os campos somem do payload em vez de irem como string vazia — string vazia tem boa chance de virar 400.
4. **`codigoFormatoObjetoInformado: "2"`** continua por convenção histórica dos Correios, não por confirmação no Swagger.
5. **Token de curta duração.** Quando o segredo cadastrado é um token `cws-…` pronto, ele expira em horas e precisa ser trocado à mão. Cadastrar o **código de acesso** em vez do token elimina essa manutenção — o ERP renova o token a cada operação.

---

# 10. Pendências do Dono

1. Atribuir `expedicao.processar` aos perfis que efetivamente vão operar a expedição no dia a dia — a chave já existe no catálogo (`PerfisPermissoesPanel.tsx`); hoje, na prática, só admin/super admin conseguem operar (via fallback).
2. **Trocar token por código de acesso** nas empresas cadastradas com `cws-…` em `CODIGO_ACESSO` (seção 9, item 5). Enquanto for token, a emissão para de funcionar quando ele expirar, com erro de autenticação dos Correios.
3. Exercitar o contrato da empresa **2 (Ideal Birô)**: as prepostagens reais de 16/08/2026 cobriram Ideal Gráfica e E3; o cartão da 2 nunca foi usado de verdade.
4. Rodar um roteiro manual de validação visual: painel (cards, chips, filtros), os modais (Despachar, Confirmar retirada, Voltar status, Rastreio, Confirmar ação) e os PDFs — etiqueta interna e rótulo dos Correios impressos em 10×15 real, declaração de conteúdo em A4.
5. Preencher `telefone_nfe` nas empresas cadastradas sem esse campo (3 das 4 empresas, em 15/08/2026) — sem ele, o remetente sai incompleto na etiqueta interna e o contato some do payload da prepostagem (seção 9, item 3).

**Variáveis de ambiente na Vercel:** as 13 dos Correios (`CORREIOS_AMBIENTE` + `CORREIOS_{1,2,3}_{USUARIO,CODIGO_ACESSO,CARTAO_POSTAGEM,CONTRATO}`) foram aplicadas em 17/08/2026, junto com as três do QR público (`OS_QR_PUBLICO_ENABLED`, `OS_QR_TOKEN_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`) e o redeploy correspondente.

---

# 11. Decisões de 15/08/2026

- A entrada no fluxo logístico parte de uma ação explícita do expedidor ("Marcar pronto"), não de automação por status.
- Dados de execução da expedição ganharam tabela própria, `public.expedicoes` (1 linha por `id_int`) — `propostas.peso` é `smallint` (estoura perto de 32kg) e `cotacao_frete` é histórico de cotação, que não deve ser mutado depois de fechado.
- Etiqueta interna no formato 10×15cm, uma página por volume, com QR de conferência.
- Falta de NF-e nunca bloqueia o despacho — vira alerta com confirmação explícita, não trava a operação.

## 11.1 Decisões de 16–17/08/2026

- **Credencial dos Correios é por empresa, não do sistema.** Cartão e contrato são por CNPJ; a empresa remetente sai da proposta e decide qual credencial usar — e a mesma resolução vale para baixar o rótulo.
- **Payload alinhado ao que passou de verdade**, não ao que a documentação secundária sugeria (seção 9).
- **Sem NF autorizada, o volume viaja com declaração de conteúdo** — documento próprio do ERP, oferecido no mesmo menu da etiqueta.
- **Etiqueta 10×15 hierarquizada por distância de leitura**: cidade/UF e números de NF/pedido em corpo grande; o resto em blocos com moldura.
- **Confirmação de transição usa modal do sistema**, nunca `window.confirm`.
- **Peso bruto entra pela Revisão do boletim**, não pela Expedição: quem embala é quem sabe o peso com embalagem, e a Expedição precisa dele já pronto para a NF-e.

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
public.empresas
public.enderecos
```

`public.empresas` deixou de ser só a fonte do remetente impresso: é ela que define **qual credencial dos Correios** a operação usa (seção 6.2).

A Matriz de Segurança e o catálogo de permissões definem quem pode ver e quem pode operar.
