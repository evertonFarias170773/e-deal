# EXPEDICAO.md

Versão: 1.6
Status: Oficial — Correios em produção (prepostagens reais emitidas em 16/08/2026)
Última atualização: 20/08/2026
Projeto: Vibe

---

# Expedição e Logística

Este documento descreve o que está implementado no módulo de Expedição do Vibe em 19/08/2026 — não o planejado nem etapas futuras de um roadmap.

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
- Pedido de **teste encerrado** (`propostas.encerrado_teste_em` preenchida) não entra no painel: `.is("encerrado_teste_em", null)` no mesmo `select` do universo. Corte independente do auto-ocultar de `ENTREGUE` acima — um trata de pedido que nunca foi real, o outro de pedido real que já terminou. O item **"Encerrar teste"** está no menu de ações da linha (permissão `propostas.release_producao`); **reabrir só em Orçamentos**, onde o pedido continua visível com badge. Regra completa: `PEDIDOS-PRODUCAO.md` §8-A.
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

- O Kanban MOSTRA O QUE O RECORTE ENTREGAR (01/09/2026). Até virar a visão
  inicial ele descartava `EM_TRANSITO` e `ENTREGUE` por conta própria, e clicar
  nesses cards do topo abria um Kanban vazio sem explicar por quê. Quem recorta
  agora são os cards e os filtros, e só eles. Pedido dos Correios com etiqueta
  gerada continua na bancada ("Aguardando transportadora") até o expedidor
  confirmar o despacho, que é quando o status vira `EM TRANSITO`.
- Colunas de **344 px SEM moldura** (02/09/2026), só as não-vazias:
  `Retira balcão` · `Motoboy` · `Correios` · uma por transportadora (nome
  resolvido, ordem alfabética) · `Outros / A definir` (sem custo, frete
  incluso, sem nome) por último. A caixa branca com borda e sombra saiu: ela
  desenhava duas bordas em volta de cada pedido. A coluna virou largura +
  rótulo (título e contagem), os cards ficam soltos sobre o fundo da página com
  `shadow-sm`, e a separação vem do `gap-6` entre colunas e do `space-y-4`
  (16 px) entre cards.
- Card, de cima para baixo: linha de identidade (nº · `cli <id_cliente>` · menu
  `⋯`), nome do cliente em até duas linhas, linha de selos e, separado por fio,
  o rodapé de números — peso · volumes à esquerda, frete à direita.
  - O menu usa `ActionsMenu variant="icone"`: só o `⋯`, 36 px. O gatilho com
    rótulo (~112 px) ocupava metade da largura útil do card e quebrava a linha
    do número. Os rótulos das ações continuam por extenso DENTRO do menu, e a
    ação primária segue como primeiro item.
  - O **selo de status some quando só repete o recorte** (`p.etapa === filters.etapa`):
    com "Em trânsito" ativo, todo card dizia "Em Trânsito". Nos recortes que
    atravessam etapas (`DIA`, `ATIVOS`, `TODAS`) ele volta sozinho. Os chips
    `ATRASADO Xd` / `HOJE` e o sub-estado "Aguardando transportadora" nunca
    somem.
  - Frete **sempre** ocupa o canto direito do rodapé, com `—` quando não há
    valor, para as linhas alinharem entre cards. Regra do valor inalterada:
    nulo e zero não viram `R$ 0,00`.
- **Legenda das cores** (02/09/2026), na mesma linha do alternador de visão e à
  direita dele, só quando `visao=transportadoras` — na lista os fundos não
  existem. Os marcadores recebem LITERALMENTE a mesma string de classe que
  pinta o card (`FASES_CARD_KANBAN` em `KanbanTransportadoras.tsx` é fonte
  única: cada tom aparece uma vez só no arquivo), então legenda e card não têm
  como divergir. Em largura reduzida a legenda desce inteira para a linha
  seguinte (`flex-wrap` no container) e cada item é `whitespace-nowrap`, então
  nenhum rótulo se parte no meio.
- **Cor de fundo do card** — precedência INVERTIDA em 02/09/2026, avaliada de
  cima para baixo em `faseDoCard`:
  1. **laranja** (`amber-300/50`) aguardando coleta — PREVISTO, sem ocupante
     possível ainda (ver abaixo);
  2. **azul** (`sky-300/50`) etapa `PRONTO` (status `EXPEDICAO`), **com ou sem
     etiqueta**;
  3. **verde** (`emerald-300/50`) `etiquetaGerada` (prepostagem Correios OU
     `etiqueta_impressa_em` OU rastreio) **e** etapa em `A_RETIRAR`,
     `EM_TRANSITO` ou `ENTREGUE`;
  4. **cinza** (`slate-200/50`) o resto.

  **Por que inverteu.** Até 02/09 o verde vencia sempre e, como quase todo
  pedido ganha etiqueta em algum momento, o painel virou monocromático: **33
  verdes, 1 azul e 10 cinzas em 44**. O azul, que deveria marcar o que pede
  ação, aparecia por uma janela de segundos — no 21487 durou **25 segundos**,
  entre imprimir a etiqueta (09:31:44) e confirmar o despacho (09:32:09). A cor
  tinha deixado de ajudar a achar trabalho.

  **A leitura nova**: azul é o que ainda está na bancada e precisa de ação;
  verde é o que já saiu, rotulado. Por isso o azul ignora a etiqueta —
  imprimir etiqueta não tira o pedido da bancada, só o despacho tira — e o
  verde exige ter saído, senão voltaria a roubar o azul. Efeito colateral
  aceito: pedido ainda em produção com rastreio deixa de ser verde e vira
  cinza (zero casos no painel de 02/09) — ele não saiu de lugar nenhum.

  **O laranja não tem ocupante.** O estado é derivado (Desenho A da Etapa 7,
  `613961c`): despacho confirmado + `expedicoes.coletado_em` nula + etapa
  `PRONTO` + transporte `TRANSPORTADORA`/`MOTOBOY`. A coluna `coletado_em`
  **não existe no banco** — a migration está escrita e não aplicada. A condição
  fica escrita e tipada atrás da flag `COLETA_TEM_FONTE_NO_BANCO`, anotada como
  `boolean` (e não inferida como `false`, que tornaria o corpo código morto para
  o compilador); devolve `false` para todo pedido até a coluna existir. Ligar é
  trocar a flag e ler `coletado_em` no service.

  Nesta visão a urgência fica SÓ nos chips — o fundo vermelho/âmbar da tabela
  não se aplica aos cards.
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
| 1 | `public.propostas` | cliente, empresa, `status_interno`, `libera_nf`, `volume` e, desde 18/08/2026, a modalidade declarada no orçamento (`modalidade_frete`, `id_transportadora_cliente` — leitura apenas, seção 5.2); filtro `is_prd_aprovado = true` | `id_int` |
| 2 | `public.propostas_os` | `data_termino` (promessa exibida), `codigo_rastreamento` (legado), `obs` | `id_int` |
| 3 | `public.cotacao_frete` | `servico`, `valor`, `peso` da cotação com `escolhido = true` | `id_int` |
| 4 | `public.notas_fiscais` | `status`, `numero_nf` | `id_int` |
| 5 | `public.expedicoes` | dados de execução gravados pelo expedidor (modalidade do frete, peso aferido, volumes, transportadora, rastreio, prepostagem, datas) e, desde 16/08/2026, o peso bruto vindo da Revisão do boletim (`peso_bruto_kg`, `pesos_volumes`) | `id_int` (única) |
| 6 | `public.clientes` | nome, fantasia, `cidade_uf` do destinatário | `id_cliente` |
| 7 | `public.produtos_proposta` | `peso_total` por item (somado = peso teórico do pedido) | `id_int` |

Erro ao buscar qualquer uma das tabelas 2, 4, 5, 6 ou 7 é tolerado (loga aviso, segue com o que faltar vazio); erro em `cotacao_frete` é logado com destaque (`console.error`) porque a tela antiga tinha um bug nesse ponto.

> ### ⚠️ `cotacao_frete` é SOMENTE LEITURA para a Expedição
>
> Escrever em `public.cotacao_frete` — INSERT, UPDATE ou DELETE, de qualquer
> lugar — **altera o valor e o status da proposta**, por efeito de triggers do
> banco. Verificado no banco vivo em 18/08/2026:
>
> | Trigger | Eventos | Função | O que executa de fato |
> |---|---|---|---|
> | `trg_recalc_after_frete` | `AFTER INSERT OR UPDATE`, por linha | `recalcular_proposta_v3_trigger` → `recalcular_proposta_v3` (`void`) | **`UPDATE propostas SET valor, volume, valor_total`** (`valor_total` = produtos − desconto + frete) |
> | `trg_frete_sync_financeiro` | `AFTER INSERT OR DELETE OR UPDATE`, por linha | `tg_recalc_financeiro_por_frete` → `atualizar_status_financeiro_proposta` (`void`) | **`UPDATE propostas SET status_interno`** para `NOVO`, `AGUARDANDO`, `APROVADO` ou `CANCELADO`, conforme as linhas de `pagamentos_v2` |
> | `tg_recalc_frete_v4` | `AFTER INSERT OR DELETE OR UPDATE`, por linha | `recalcular_proposta_v4_trigger` → `recalcular_proposta_v4` (`RETURNS TABLE`) | **No-op**: o trigger faz `PERFORM` e descarta o resultado, sem `UPDATE` |
>
> **A documentação do repositório diverge do banco neste ponto.** A migration
> `supabase/migrations/20260804_recalc_valor_total_propostas.sql` descreve os
> triggers de recálculo como no-op — isso vale apenas para o `v4`. Os outros
> dois existem no banco de produção, não estão nessa migration e têm efeito
> real.
>
> Consequência prática para a Expedição: um pedido em `EXPEDICAO`, `A RETIRAR`
> ou `EM TRANSITO` cujo `cotacao_frete` fosse tocado seria **jogado para fora do
> funil logístico** no ato, porque `status_interno` é reescrito pelos
> pagamentos. Por isso os dados de execução moram em `public.expedicoes`
> (seção 12) e nenhum caminho da Expedição escreve em `cotacao_frete` —
> nem o despacho, nem a Revisão do boletim, nem as rotas dos Correios.

Duas tabelas adicionais entram fora do painel, em pontos específicos: `public.enderecos` (endereço de entrega — escolhido no despacho > mesmo CEP da cotação > mais recente do cliente) e `public.empresas` (dados do remetente — casada por nome com `propostas.empresa` via `ilike`, com fallback para a primeira empresa cadastrada).

`propostas.libera_nf` é lido e vira `PedidoExpedicao.liberaNf`, mas hoje esse campo não é exibido nem usado em nenhuma condição da tela — está calculado e disponível, sem consumidor ainda.

## 2.1 Precedências

- **Peso** (corrigido em 18/08/2026 — ver 2.2): aferido no despacho (`expedicoes.peso_kg`, kg) > **bruto da Revisão (`expedicoes.peso_bruto_kg`, kg)** > cotado (`cotacao_frete.peso`, em gramas, convertido para kg) > teórico (soma de `produtos_proposta.peso_total`, em gramas, convertido para kg). Zero, negativo ou valor não numérico não conta como peso informado e cai para o próximo da fila.
- **Rastreio**: `expedicoes.codigo_rastreamento` > `propostas_os.codigo_rastreamento` (campo legado, mantido para telas antigas).
- **Tipo de frete**: `expedicoes.tipo_frete` (definido no despacho) > normalização de `cotacao_frete.servico` (seção 5).
- **Modalidade do frete** (quem paga, seções 5.1 e 5.2): `expedicoes.modalidade_frete` (declarada no despacho) > `propostas.modalidade_frete` (declarada no orçamento) > nula. Não há inferência a partir da cotação. Mesma precedência para a transportadora (`expedicoes.id_transportadora_cliente` > `propostas.id_transportadora_cliente`).
- **Transportadora exibida**: `expedicoes.transportadora_nome` > `cotacao_frete.servico` (texto cru da cotação).
- **NF**: `AUTORIZADA` vence qualquer outra; senão, qualquer nota não `CANCELADA` conta como `PENDENTE`; sem registro nenhum = `SEM_NF`.

## 2.2 Peso: helper único (18/08/2026)

A precedência de peso vivia copiada em quatro lugares e divergiu: nenhum deles
lia `expedicoes.peso_bruto_kg`, gravado pela Revisão do boletim. Um pedido
revisado com 32,7 kg (caso real: proposta 20678) aparecia como 31,20 kg no modal
de despacho — o peso da cotação — e o mesmo número ia para a etiqueta, para a
declaração de conteúdo e para o payload dos Correios.

A regra passou a viver em **`src/features/expedicao/lib/peso.ts`**
(`resolverPesoExpedicao`), consumida pelos quatro caminhos:

| Consumidor | Arquivo |
|---|---|
| Painel e modal de despacho | `src/features/expedicao/services/expedicao.service.ts` |
| Etiqueta interna 10×15 | `src/features/expedicao/services/etiqueta-viewmodel.service.ts` |
| Declaração de conteúdo | `src/features/expedicao/services/declaracao-viewmodel.service.ts` |
| Prepostagem dos Correios | `src/app/api/expedicao/correios/prepostagem/route.ts` |

- `PedidoExpedicao.pesoOrigem` ganhou o valor **`"bruto"`**, que identifica o peso
  bruto vindo da Revisão — ao lado de `"aferido"` (pesado no despacho),
  `"cotado"` e `"teorico"`.
- Unidades ficam como estão no banco (`expedicoes` em kg, `cotacao_frete` e
  `produtos_proposta` em gramas); a conversão acontece só dentro do helper.
- O **fallback de 300 g da prepostagem continua valendo**: quando nenhuma fonte
  tem peso utilizável, a rota dos Correios envia 300 g, porque a API recusa
  peso ausente.
- Peso digitado pelo expedidor no despacho continua tendo prioridade sobre o
  bruto da Revisão.

O peso bruto na **NF-e** segue pendente e é tarefa do módulo fiscal: a nota usa
hoje a soma teórica dos itens (`nfe.service.ts`), não `peso_bruto_kg` — ver
`PEDIDOS-PRODUCAO.md` §19.


### `peso_kg` pode vir de rascunho (20/08/2026)

Desde 20/08/2026 o modal Despachar tem **"Salvar sem despachar"**: o expedidor altera peso, endereço ou transporte, grava, e fecha o modal para pedir liberação de recotação a um admin — sem perder o que preencheu. A gravação usa `salvarDadosExpedicao`, o mesmo caminho do modo edição, e **não toca `data_despacho`**.

**O marcador que separa rascunho de despacho confirmado é `expedicoes.data_despacho IS NULL`.** Não há coluna própria: só `despachar()` escreve essa data, e ela já é a fonte da `etapa` (seção 3). Uma coluna nova seria uma segunda verdade sobre o mesmo fato, livre para divergir da primeira.

Consequência direta para esta seção: **`expedicoes.peso_kg`, o primeiro degrau da precedência, pode vir de um despacho ainda não confirmado.** Isso é deliberado — é o peso real que alguém mediu na balança, e é o número certo para cotar, conferir divergência e imprimir. A ordem da precedência não muda.

Quem **ignora** rascunho, lendo só o estado confirmado:

| Consumidor | Comportamento |
|---|---|
| Lista e visão por transportadora | `transportadoraNome` e `tipoFrete` derivam de `expedicoes` **apenas** quando há `data_despacho`; sem ela vale a normalização da cotação. Um rascunho não move o pedido de coluna no kanban |
| Etiqueta 10×15 | destino, transportadora, rastreio e observação saem do estado confirmado. Etiqueta impressa vira caixa despachada |
| Declaração de conteúdo | mesmo critério para o destino |
| Referência de transporte da divergência | rascunho **não** vira sua própria referência — senão o bloqueio se limparia sozinho ao trocar o "COMO VAI" |

Duas exceções na etiqueta, e as duas são dado legítimo de **antes** do despacho: o **peso**, pela precedência acima, e **volumes / tipo de volume**, que a Revisão do boletim (`revisao-expedicao.service.ts`, seção 3.4) grava muito antes de existir despacho — gateá-los apagaria da etiqueta o que a Revisão registrou.

Quem **consome** rascunho, de propósito: a **divergência de frete** (o expedidor precisa pedir liberação com os dados já persistidos), a **recotação** (`cotar` e `aplicar` leem peso e endereço de `expedicoes`) e a **prepostagem** — que já salvava o formulário antes de gerar exatamente por ler o persistido, e agora tem esse salvamento como redundância em vez de necessidade.

---

# 3. Estados e Transições

O status oficial continua em `propostas.status_interno` (`FLUXO-OFICIAL-STATUS-PROPOSTAS.md` §6.13–6.15). As funções abaixo (`src/features/expedicao/services/expedicao-acoes.service.ts`) operam essa transição e, na sequência, gravam os dados de execução em `public.expedicoes`:

| Função | Transição | Tipo | Efeito em `expedicoes` |
|---|---|---|---|
| `marcarPronto` | (produção/acabamento) → `EXPEDICAO` | NATURAL | `data_pronto` |
| `confirmarRevisao` | idem — delega a `marcarPronto` | NATURAL | grava antes volume, tipo e peso bruto (seção 3.4) |
| `despachar` | `EXPEDICAO` → `EM TRANSITO` (transporte) ou `A RETIRAR` (retirada) | NATURAL | modalidade, tipo de frete, transportadora, peso, volumes, endereço, rastreio, `data_despacho`, `despachado_por` |
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

## 3.5 Ordem de escrita do despacho, e a janela que sobra (20/08/2026)

**`despachar()` grava `expedicoes` ANTES de transicionar.** Até 20/08/2026 era o contrário: o status ia primeiro, e uma falha na gravação dos dados deixava o pedido **fora do funil logístico com os dados pela metade** — o próprio código admitia isso na mensagem de erro, que mandava usar "Editar dados de expedição" para regravar. Invertida, uma falha de escrita deixa o pedido exatamente onde estava, e o expedidor tenta de novo.

**A inversão afrouxou a proteção anterior.** A ordem antiga existia por um motivo: *ganhar a transição primeiro* impedia que uma aba obsoleta sobrescrevesse os dados de um despacho já feito por outra aba. Gravando primeiro, essa garantia se perde. A mitigação é dupla:

1. uma **leitura prévia** de `propostas.status_interno` antes de escrever, que pega a aba obsoleta no caso comum e recusa com a mensagem de conflito;
2. a **guarda de concorrência da transição**, `.eq("status_interno", statusEsperado)`, preservada intacta (§3.1) — ela continua sendo quem garante que só uma chamada transiciona.

**A janela que sobra.** Entre a leitura prévia e o `upsert` existe um intervalo estreito em que uma aba obsoleta ainda regravaria `expedicoes`. Nesse caso a **transição falha** (a guarda pega), e a mensagem devolvida diz que os dados do despacho foram gravados e que o pedido segue em `EXPEDICAO`. Ou seja: o estado é consistente e recuperável — o pedido não sai do funil —, mas os dados na linha de `expedicoes` podem ser os da aba errada. É a mesma classe de corrida aceita conscientemente em §3.2, pelo mesmo motivo: balcão, volume baixo, e reversível pela tela de edição.

**Fechar a janela de vez exige mover o despacho para uma RPC** `SECURITY DEFINER`, com `SELECT ... FOR UPDATE` na proposta e as duas escritas na mesma transação — igual ao que já foi feito em `exp_aplicar_recotacao`. Não implementado nesta fase.

### A pendência de fundo: não existe rota de API para despachar

O despacho inteiro é **PostgREST direto do browser**. `expedicao-acoes.service.ts` usa `getSupabaseClient()`, não há rota em `src/app/api/expedicao/` para despachar, e a RLS de `propostas` é permissiva (há uma policy `update_all_propostas` com `USING (true) WITH CHECK (true)` e uma `acesso geral completo` para `ALL`).

Consequência prática: **`camposMinimosDespacho` é a única trava que existe**. Ela roda nos dois lados — no `disabled` do botão e dentro do `despachar()` — precisamente porque não há servidor para revalidar. Quem chamar o PostgREST por fora contorna tudo.

A mesma RPC que fecharia a janela de concorrência resolveria isto junto, movendo a validação para o banco. As duas coisas são o mesmo trabalho, e é por isso que estão registradas no mesmo lugar.

### A mesma dívida no Orçamento: `editar-paga` (26/08/2026)

Desde 26/08/2026 esta pendência tem uma **terceira** ocorrência, fora da Expedição, e pelo mesmo motivo — vale registrar aqui porque o conserto é o mesmo trabalho.

`POST /api/orcamentos/editar-paga` recusa edição de proposta com cobrança ativa não confirmada quando a edição **muda o valor**: o link de pagamento já está com o cliente, tem valor fixo no provedor e não pode ser ajustado, só cancelado e reemitido. A checagem compara **campo a campo** o `formState` contra o banco (`src/features/orcamentos/lib/edicao-financeira.ts`), e não pelo total — o `novoTotal` que chega na requisição é o cálculo do client, e a própria rota registra que ele "serviu só para escolher o caminho": quem decide o valor gravado é o banco, depois dos triggers de `produtos_proposta` e `cotacao_frete` e da consolidação final do `saveProposta`.

A comparação campo a campo **reduz** a janela, mas não a fecha: entre a validação e a gravação o estado ainda pode mudar, e `saveProposta` roda várias escritas por PostgREST, sem transação que as una. Se a divergência aparecer depois, a proposta já foi gravada e não há `ROLLBACK` — sobra proposta e cobrança com valores diferentes.

Fechar de vez é o mesmo desenho das duas pendências acima: **RPC `SECURITY DEFINER` com `SELECT ... FOR UPDATE` na proposta, validação e escrita na mesma transação**. Não implementado.

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

**A Unesul saiu da cotação em 19/08/2026, mas continua no normalizador — de propósito.** O sistema parou de oferecer cotação nova dela: o bloco que lia o `un` da RPC `calcular_frete_transportadora` foi removido de `solicitarCotacaoTransportadoras` (`src/features/orcamentos/services/frete.service.ts`). A RPC segue devolvendo as três colunas (`sm`, `un`, `mb`) e a tabela `transportadoras` não foi alterada — quem decide é o código, e São Miguel e Motoboy continuam cotando normalmente pela mesma chamada.

O que motivou: as tarifas UN estavam degradadas a ponto de virar ficção — `1kg_UN` zerado em **todas** as 919 linhas da tabela e `extra_UN` sobrando em torno de **R$ 1,00/kg sem piso** (40 das 87 linhas ativas com exatamente 1,00). Na prática a Unesul aparecia sempre como a opção mais barata da lista: numa cotação real para Santa Cruz do Sul/RS com 500 g, ela saía a **R$ 0,50** contra R$ 59,50 da São Miguel. A última cotação Unesul gerada foi em 26/07/2026.

**`UNESUL` permanece em `normalizarTipoFrete`** (categoria `TRANSPORTADORA`) porque parar de oferecer não apaga o passado: são **35 cotações gravadas, 5 delas escolhidas** (propostas 19713, 18874, 18866, 18044 e 15463, todas em `NOVO`), que precisam seguir legíveis no painel, no PDF e nos relatórios. Tirar a palavra do normalizador jogaria essas cotações em `INDEFINIDO` — o histórico ficaria sem ícone e sem rótulo. **Não há cadastro de Unesul em `clientes`**, então nada a desativar ali: ela nunca foi selecionável como transportadora FOB.

## 5.1 Modalidade do frete: quem paga (18/08/2026)

O tipo de frete responde **por onde vai**. A modalidade responde **quem paga** — são dimensões ortogonais, e o sistema só tinha a primeira. Por isso o modal de despacho chegou a oferecer "Sem custo" como se fosse um tipo de transporte.

A modalidade é declarada pelo expedidor e gravada em **`expedicoes.modalidade_frete`** (`text`, nullable, CHECK `RETIRA | FOB | CIF`, migration `20260818_expedicoes_modalidade_frete.sql`). Tipo e constantes em `src/features/expedicao/types.ts`.

| Modalidade | Significado | Transportes oferecidos no passo 2 |
|---|---|---|
| `RETIRA` | o cliente busca no balcão | nenhum — o submit força `tipo_frete = RETIRA_BALCAO`, `transportadora_nome = "Retira balcão"`, `id_transportadora_cliente = null`, destino `A RETIRAR` |
| `FOB` | transporte por conta do cliente | Transportadora, Motoboy |
| `CIF` | transporte por conta da empresa | **Correios**, Transportadora, Motoboy |

> ### CIF recota, mas ainda não grava (19/08/2026)
>
> `CIF` grava quem paga, libera os Correios no passo 2 e, desde 19/08/2026,
> **habilita a recotação do frete no despacho** — Parte C, Etapa 1: rota
> `POST /api/expedicao/recotacao/cotar` e botão no modal Despachar, visíveis
> só quando o pedido está em `EXPEDICAO` **e** a modalidade efetiva é `CIF`.
>
> A recotação é **estritamente somente leitura**. Ela cota de novo a partir do
> endereço de entrega, do peso resolvido (mesma precedência da seção 2) e do
> subtotal dos itens, e mostra a diferença de cada opção contra o que a
> proposta cobra hoje. Ela **não altera `valor_frete`/`valor_total`, não
> escreve em `cotacao_frete`, não toca `expedicoes` e não lança nada na Conta
> Corrente** — o painel de resultado diz isso em rodapé, para o expedidor não
> supor que escolher ali mudou alguma coisa.
>
> **Seguem pendentes as etapas de escrita**: o ledger `expedicao_recotacoes`
> com a gravação do frete recotado em `propostas.valor_frete`/`valor_total`, o
> lançamento da diferença na Conta Corrente, a alçada do expedidor e a
> aprovação do Financeiro — ver seção 10.
>
> ### Recotar depende de liberação de um admin (20/08/2026)
>
> O expedidor **não tem autonomia** para recotar. O botão "Recotar frete" no
> modal Despachar **nasce bloqueado**, com cadeado e o motivo escrito — ele
> não some, porque o expedidor precisa saber que a função existe e de quem
> depende. Um admin libera **caso a caso**, pelo menu **Ações** da lista de
> Expedição.
>
> A liberação é registrada em `public.expedicao_recotacao_liberacoes`, uma
> linha por autorização, e tem quatro propriedades:
>
> - **cobre o fluxo inteiro** — ver as opções (rota `cotar`) e aplicar uma
>   delas (rota `aplicar`). Uma liberação habilita as duas coisas;
> - **é de uso único** — consumida quando uma aplicação acontece, e o botão
>   volta a bloquear. **Recotar sem aplicar não consome**: ela vale até ser
>   usada;
> - **é por pedido**, nunca permissão geral de perfil;
> - **não expira por tempo.** Só por consumo ou por revogação. Não há job para
>   varrer, e expiração preguiçosa espalharia a mesma regra de prazo por três
>   lugares (UI, `cotar`, `aplicar`) — três chances de divergirem.
>
> **Uma liberação ativa por pedido**, garantida pelo índice único parcial
> `exp_lib_uma_ativa_por_pedido` (`WHERE consumida_em IS NULL AND revogada_em
> IS NULL`) — mesma técnica de `ux_ccp_uma_aberta_por_proposta` na Conta
> Corrente. Liberar um pedido já liberado é **idempotente**: devolve a
> existente, não cria segunda linha e não é erro na tela. Consumir ou revogar
> abre o slot para uma nova, o que preserva o histórico em vez de sobrescrever.
>
> **O consumo é atômico e acontece dentro da transação da aplicação.** Em
> `exp_aplicar_recotacao`, um `UPDATE ... WHERE consumida_em IS NULL RETURNING`
> reivindica a liberação depois dos gates e antes das escritas: duas aplicações
> simultâneas não passam com uma liberação só, porque a segunda transação
> bloqueia na trava de linha e depois casa zero linhas. E a checagem de
> idempotência por `chave` vem **antes** do consumo — um retry de rede devolve
> o registro anterior e não queima uma segunda autorização do admin.
>
> **Revogação**: liberação dada por engano se desfaz pelo item "Cancelar
> liberação", no mesmo menu, com a mesma permissão. Só alcança liberação
> **ativa e não consumida** — o que já foi usado não se desfaz por ali.
>
> **Permissão: `expedicao.admin`**, que já existia no catálogo de perfis e não
> era usada em lugar nenhum do código. Vale o fallback padrão do projeto:
> super admin passa sempre, a chave no perfil passa, e `is_admin` passa por
> fallback. Ou seja, **a chave não restringe quem já é admin** — ela existe
> para poder delegar a liberação a um supervisor sem dar admin geral do ERP.
>
> **Trilha em três camadas**: a própria tabela (quem liberou, quando, quando
> consumiu, por qual aplicação, quem revogou e por quê); o trigger
> `audit.log_row_changes_v2()`, que ela carrega porque **sofre UPDATE** —
> diferente do ledger `expedicao_recotacoes`, que é append-only e por isso é a
> própria trilha; e linhas em `propostas_chat` na liberação e na revogação,
> gravadas pelas rotas em best-effort, fora da transação.
>
> **O pedido 20960 não recebeu liberação retroativa.** Ele teve a aplicação #1
> do ledger em 20/08/2026, antes desta regra existir. Liberação é autorização
> *prévia*: fabricar uma depois inventaria um ato administrativo que não houve
> e o assinaria em nome de alguém. O ledger já guarda autor, data e valores
> daquela aplicação. Na prática ele volta a ficar bloqueado como todos os
> outros — que é exatamente o comportamento desejado.

**Por que Correios só em CIF.** A prepostagem sai pelo cartão de postagem da empresa, que é quem paga. Em FOB quem posta é o cliente, com contrato próprio — não há serviço dos Correios a cobrar dele. Daí a trava não ser só de UI: os botões de prepostagem exigem `modalidade === "CIF"` além de `tipo_frete === "CORREIOS"` (seção 6.2).

**Ordem no modal** (`DespacharModal.tsx`), inclusive em modo edição — a modalidade é informação nova, e pedido despachado antes de 18/08/2026 precisa poder ganhar uma:

1. **Modalidade** — sempre; sem ela o botão de confirmar recusa com aviso.
2. **Como vai** — só em FOB/CIF, com a lista da tabela acima.
3. **Transportadora** — cadastrada (`clientes` com `categoria = TRANSPORTADORA`) ou nome livre.
4. **Endereço, rastreio e prepostagem** — como antes.

**Sem chute e sem backfill.** O modal só pré-seleciona a modalidade quando ela já foi declarada — no despacho ou no orçamento (seção 5.2) — ou quando a cotação diz `RETIRA_BALCAO` sem ambiguidade. Pedido cotado como "Sem custo" ou indefinido abre **sem modalidade**, obrigando a escolha — o texto da cotação é ambíguo o bastante para o banco (`osqr__forma_entrega`, que o lê como indefinido) e o TypeScript (`normalizarTipoFrete`, que o lê como envio) divergirem entre si. Pelo mesmo motivo nenhuma das migrations fez backfill: a modalidade nasce quando alguém a declara.

**Pedido legado com envio pelos Correios.** Marcar `FOB` num pedido cujo transporte gravado é `CORREIOS` **nunca** troca o transporte sozinho: aparece um aviso com o código do objeto/prepostagem e uma confirmação explícita ("este pedido deixa de ir pelos Correios"), e o passo 2 fica fechado até o expedidor decidir. Confirmando, só o rótulo do transporte muda para `TRANSPORTADORA` — **prepostagem, código de objeto, rastreio e etiqueta oficial continuam gravados** e a etiqueta oficial segue emitível, porque ela depende da prepostagem, não do tipo. Desmarcar, ou trocar de modalidade, devolve o transporte a `CORREIOS`.

**`SEM_CUSTO` saiu do despacho, não do sistema.** A categoria continua na union, no `LABELS`, no `ICONE_TIPO_FRETE`, no `normalizarTipoFrete`, no filtro do painel e nas colunas do kanban — são 98 cotações vivas, geradas continuamente pelo Orçamento ("Retirada Local" para UF = RS), e o painel precisa seguir exibindo e filtrando esses pedidos. O que mudou é que o expedidor não pode mais *escolher* "Sem custo" como transporte: chegando um pedido assim, ele declara a modalidade.

## 5.2 A modalidade nasce no Orçamento (18/08/2026)

A modalidade estreou no despacho, mas esse é o lugar errado: quem sabe se o cliente assume o frete é **o vendedor**, no momento da venda. Desde 18/08/2026 ela é declarada na **aba Fretes do Orçamento** e atravessa o fluxo até a Expedição.

**Campos**, aditivos em `public.propostas` (migration `20260818_propostas_modalidade_frete.sql`):

| Coluna | Tipo | Papel |
|---|---|---|
| `modalidade_frete` | `text`, nullable, CHECK `RETIRA \| FOB \| CIF` | quem paga, no mesmo vocabulário de `expedicoes.modalidade_frete` |
| `id_transportadora_cliente` | `integer`, nullable, FK → `clientes(id_cliente)` | transportadora definida em FOB — **FK, não texto livre** |

**Na tela** (`OrcamentoFormPage.tsx`, aba "7. Fretes e Entrega", vale também para proposta avulsa):

- as três modalidades, com os rótulos da Expedição;
- em **FOB**, seletor de transportadora alimentado por `getTransportadoras()` — `clientes` com `categoria = TRANSPORTADORA` **e** `ativo = true`, a mesma fonte do despacho;
- **FOB sem transportadora não salva**: o botão recusa com toast e reabre a aba Fretes. É justamente o dado que a Expedição vai usar.

**FOB vale zero.** Em FOB o cliente contrata e paga o transporte: não há frete a cobrar, qualquer que seja a cotação em tela. A regra vive num ponto único — `src/features/orcamentos/lib/modalidade-frete.ts` — e é aplicada na **fronteira de consumo**, os três lugares que precisam concordar: o resumo da tela, o resumo do salvamento e o valor gravado em `propostas.valor_frete` e `cotacao_frete.valor`. Os valores cotados continuam visíveis na lista como referência; só a opção **escolhida** é zerada.

Consequência: **nenhuma escrita nova em `cotacao_frete`**. O zero desce pelo `DELETE` + `INSERT` que o salvamento já fazia — ver o aviso da seção 2 sobre os triggers dessa tabela.

### CIF é o padrão desde 19/08/2026, e o passado fica como está

CIF responde por cerca de **95% dos pedidos**. Nascendo nula, a modalidade dependia de alguém lembrar de declarar — e ninguém lembrava: em 19/08/2026 havia **8.238 propostas sem modalidade e zero pedidos CIF** no banco, um mês depois de a coluna existir. Sem um único pedido CIF, a recotação da Parte C não tinha como sequer ser exercitada.

Desde 19/08/2026 **proposta nova nasce `CIF`**, pelos dois caminhos que criam proposta: a aba Fretes (`createInitialState`) e o Maestro (`maestro-save-proposta.server.ts`). RETIRA e FOB continuam como escolha explícita, e CIF **não exige transportadora** — só FOB exige.

O default é seguro porque **CIF e "sem modalidade" produzem exatamente o mesmo dinheiro e o mesmo rótulo**: `valorFreteEfetivo` e `aplicarModalidadeNosFretes` só agem em FOB, e `nomeTransporteEfetivo` devolve o serviço cotado para tudo que não é FOB. Quem zera o frete é FOB, nunca CIF. Seis asserções em `scripts/testes/modalidade-frete-rotulo.test.mts` fixam essa equivalência, para o dia em que CIF ganhar regra própria a quebra aparecer no teste e não na tela.

**Propostas anteriores a 19/08/2026 permanecem com `modalidade_frete` nula, por decisão.** O backfill foi levantado e **recusado** em 19/08/2026. O critério seguro chegou a ser montado — proposta normal, não cancelada, `valor_frete > 0`, cotação escolhida que não fosse retirada nem "sem custo", o que selecionava **635 linhas**. O que barrou não foi o critério, foi um efeito colateral irreversível:

- os dois triggers `BEFORE UPDATE` de `propostas` (`propostas_set_timestamp` e `trg_set_updated_at`) fazem `NEW.updated_at = now()` **incondicionalmente**;
- a lista de Orçamentos ordena no servidor por `updated_at DESC, id_int DESC`, e a coluna "Data / Hora" exibe `updatedAt || createdAt`;
- o backfill recarimbaria as 635 (algumas de junho), jogando-as à frente de **4.783 propostas** e exibindo todas com a data de hoje — ocupando as primeiras páginas da lista;
- **o rollback não desfaz isso**: devolveria `modalidade_frete` a null, nunca o `updated_at` original. Evitar exigiria desligar os triggers, o que não se faz por um dado retroativo.

E não é necessário: **só o fluxo novo consome a modalidade** — a pré-seleção do despacho, a divergência entre orçamento e bancada, e a recotação da Parte C. Nada retroativo depende dela. O conjunto sem modalidade também encolhe sozinho conforme as propostas são tocadas: caiu de 636 para 635 em meia hora, no dia em que o default entrou.

Registrado para não ser reaberto sem motivo novo: se um dia a modalidade retroativa passar a ser necessária, o custo a discutir é a ordenação da lista, não o critério de seleção.

> ### Por que a edição para em LIBERADO
>
> Os dois campos ficam **somente leitura quando `status_interno` não é `NOVO` nem
> `AGUARDANDO`** (as formas compostas `NOVO / EM ARTE` e `AGUARDANDO / EM ARTE`
> contam como editáveis — a barra separa o estado de arte, não o estágio do
> pedido). A tela mostra um aviso âmbar com o motivo.
>
> O motivo é do banco, não de processo: salvar o orçamento faz `DELETE` +
> `INSERT` em `cotacao_frete`, e o trigger `trg_frete_sync_financeiro` reescreve
> `status_interno` a partir de `pagamentos_v2` — **com zero pagamentos ele força
> `NOVO` incondicionalmente**, sem guarda por status atual. Editar o frete de um
> pedido já liberado o rebaixaria e o tiraria do fluxo de produção. Em
> 18/08/2026 havia 5 propostas `EM PRODUCAO` e 3 `CANCELADO` sem nenhum
> pagamento — exatamente as que seriam rebaixadas.
>
> **Travado significa "não altera", nunca "apaga".** Fora da fase de orçamento os
> dois campos não entram no `UPDATE`, e o que o vendedor declarou permanece.

**Na Expedição, precedência em três níveis** (`DespacharModal.tsx`):

1. `expedicoes.modalidade_frete` — o que o expedidor declarou. **Soberana**: é o que aconteceu na bancada;
2. `propostas.modalidade_frete` — o que o vendedor declarou. Chega como pré-seleção;
3. nada — o modal abre sem modalidade e exige escolha.

A mesma precedência vale para a transportadora. Quando a transportadora vem pré-selecionada do orçamento e o despacho ainda não tem nome próprio gravado, o nome é resolvido pelo cadastro, não pelo texto da cotação.

**Divergência aparece, não bloqueia.** Se o expedidor escolher modalidade ou transportadora diferente da que veio do orçamento, um aviso azul nomeia as duas versões lado a lado. Vale o que o despacho declarar; **a Expedição nunca escreve em `propostas`**, e a diferença fica registrada nas duas pontas.

### Pendências conhecidas desta fase

1. **NF-e emite o código errado em FOB.** `nfe.service.ts` deriva a modalidade fiscal de `valorFrete > 0 ? 0 : 9`. Como FOB grava zero, a nota sai com **`9` (sem ocorrência de transporte)** quando o correto seria **`1` (por conta do destinatário)**. Nenhuma das 43 notas usa `1` hoje. O campo é editável na tela da NF-e, então há saída manual. Corrigir é decisão fiscal — fora desta tarefa.
2. **O avaliador de cobrança mostra o motivo errado.** `frete-desatualizado.ts` devolve `FRETE_SEM_CUSTO` para qualquer `valor === 0`, sem olhar modalidade. O comportamento acerta por acaso (FOB não deve bloquear cobrança por peso divergente, porque o cliente não paga frete à empresa), mas o motivo exibido mente. Falta um `FRETE_FOB` próprio.
3. **Duplicar proposta perde a modalidade em silêncio.** `copiar_proposta_v2` e `duplicar_proposta` copiam `frete_escolhido`, mas **não copiam as colunas novas**. Duplicar uma proposta FOB gera uma cópia sem modalidade e sem transportadora, sem aviso nenhum. Atualizar as duas funções ficou fora desta tarefa.

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
- No modal Despachar, os botões "Gerar prepostagem SEDEX/PAC" só aparecem quando a **modalidade é `CIF`** (seção 5.1), o tipo de frete é `CORREIOS` e `correiosStatus()` confirma `configurado: true`.
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

# 7. Rastreio (consulta sob demanda)

`rastrearObjeto()` (`src/features/expedicao/services/rastro.service.ts`) consulta **duas fontes, nesta ordem**, e só mostra erro depois que as duas falham:

| Ordem | Fonte | Cobre |
|---|---|---|
| 1ª | `GET /api/expedicao/correios/rastro` → API `srorastro` dos Correios | objetos dos contratos das empresas do grupo |
| 2ª | webhook n8n do dono (`.../webhook/rastro-e-deal-todos`, `POST { rastro }`) | o que a primeira não reconhece — código de transportadora, contrato de terceiro |

## 7.1 Um objeto só aparece para o contrato que o postou (19/08/2026)

A API do SRO devolve `200` com `SRO-009: Objeto não pertence ao contrato` quando a chave usada não é a do contrato dono do objeto. Comprovado em 19/08/2026 consultando o mesmo objeto com as três credenciais: a matriz é complementar — cada objeto responde para uma empresa e falha para as outras.

Foi o que quebrou o rastreio da Birô: o fluxo n8n tem **uma credencial só** (Ideal Gráfica), então devolvia corpo vazio para objetos de Birô e E3 — e a tela mostrava "Resposta inesperada do rastreador", que não distingue "objeto de outro contrato" de "rastreador fora do ar". Duas sessões de investigação foram para o lugar errado por causa dessa mensagem.

Por isso a rota **varre os contratos**: começa pela empresa da proposta (acerta de primeira no caso normal) e só então tenta as demais, via `empresasComRastro()`. Detalhes que custaram tempo e ficam registrados:

- o idioma vai no header **`Accept-Language: pt-BR`**; como query param a API recusa com `SRO-018`, mesmo recebendo o valor certo;
- `SRO-009` **não é erro de credencial** — tem situação própria (`outro_contrato`) e não interrompe a varredura;
- um erro real (chave sem permissão, Correios fora do ar) é preservado e vira a mensagem final, em vez de virar "não encontrado".

**Entrega é decidida pelo código do evento**, não por texto: `EVENTOS_ENTREGUE` em `src/lib/correios/eventos.ts` (famílias BDE/BDI/BDR, variantes 1/67/68/70) — a mesma lista que o receiver do webhook usa para marcar `ENTREGUE` sozinho, agora em ponto único. O SRO manda o tipo com zero à esquerda (`"01"`) e o webhook sem (`"1"`); `chaveEvento()` normaliza os dois. Testes em `scripts/testes/correios-eventos.test.mts`.

## 7.2 Webhook oficial dos Correios (17/08/2026)

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
6. **Aprovar as etapas de escrita da recotação (Parte C).** As quatro decisões de negócio que travavam a Parte C **foram tomadas em 19/08/2026**: o novo valor de frete entra em `propostas.valor_frete`/`valor_total` (nunca em `cotacao_frete`, intocável pelos triggers da seção 2); a diferença vai para a Conta Corrente, com `FRETE` como exceção explícita à regra de 22/07, acumulando em vez de bloquear; a alçada do expedidor é de R$ 150 medidos sobre o **valor do frete novo**, e acima dela a operação é barrada, dependendo de aprovação do Financeiro. Com isso saíram a **Etapa 0** (alinhamento de `cc_abrir_pendencia` ao corpo vivo) e a **Etapa 1** (recotação somente leitura, seção 5.1) — as duas no ar. O que resta como decisão do dono é aprovar o plano das etapas seguintes: ledger `expedicao_recotacoes` e gravação do frete na proposta, lançamento da diferença na Conta Corrente, alçada e aprovação do Financeiro, e o que fazer quando já existe NF-e autorizada ou o pedido já está quitado. O plano da **Etapa 2** (aplicar a recotação e gravar o frete, ainda sem Conta Corrente) está em `docs/superpowers/plans/2026-08-19-recotacao-frete-etapa2.md`. A **Etapa 3** vai encontrar pela frente a falha registrada em `CONTA-CORRENTE-CREDITO.md` §4.2: `cc_abrir_pendencia` recusa proposta de cliente com tabela especial, porque `cc__total_soberano_proposta` ignora esse desconto. A Etapa 2 não depende disso — ela move `valor_total` pelo delta do frete, e não pela fórmula soberana.

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

## 11.2 Decisões de 18/08/2026

- **Quem paga e por onde vai são dimensões separadas** (seção 5.1). A modalidade ganhou coluna própria, aditiva, em vez de virar mais um valor de `tipo_frete` — que teria misturado as duas e quebrado filtro, kanban e rótulos.
- **`CIF` entra nesta fase só como rótulo**, sem cotação e sem qualquer efeito financeiro. A alternativa — deixar CIF fora da tela — desligaria a emissão pelos Correios, que é sempre CIF por natureza.
- **Correios fora do FOB**, por regra operacional e não só de UI: a postagem sai pelo cartão da empresa.
- **Nenhum rebaixamento silencioso de transporte.** Trocar um envio dos Correios por transportadora exige confirmação explícita do expedidor, e não apaga prepostagem, rastreio nem etiqueta.
- **`SEM_CUSTO` sai do despacho e permanece na leitura**: o Orçamento continua gerando essas cotações, e os pedidos precisam continuar visíveis e filtráveis.
- **A modalidade passa a nascer no Orçamento** (seção 5.2), onde a decisão de fato acontece — o despacho deixa de redescobri-la no fim do fluxo.
- **A edição da modalidade para em `LIBERADO`**, por causa do trigger de `cotacao_frete`, não por processo. Travado não apaga o que já foi declarado.
- **Divergência entre orçamento e despacho é exibida, nunca silenciada** — e resolvida sempre a favor do despacho, sem reescrever a proposta.
- **Transportadora do orçamento é FK para o cadastro**, não texto livre: é o que permite o despacho reaproveitar o vínculo e emitir etiqueta e rastreio.

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
