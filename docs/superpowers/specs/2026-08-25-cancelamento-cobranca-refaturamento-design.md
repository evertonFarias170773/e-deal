# Cancelamento de cobrança para refaturamento

Data: 25/08/2026
Status: Design aprovado — aguardando plano de implementação
Módulo: Financeiro / Conferência de pagamentos, Contas a Receber, Registro de Recebíveis

---

## 1. Problema

O financeiro precisa cancelar uma cobrança faturada e liberar a proposta para refaturamento. O refaturamento em si já funciona: o modal de gerar cobrança reabre pelo saldo (`saldoRestante = total − já cobrado`, em `PropostaCobrancaPanel`) assim que a cobrança sai de ativa. O que falta é o cancelamento.

Hoje a decisão de "esta cobrança pode ser cancelada?" está espalhada em quatro lugares que discordam entre si:

| Onde | O que decide | Problema |
|---|---|---|
| `CobrancasProvider.tsx:1287-1293` | Recusa `PAID` e `A_VENCER` no navegador | **Nenhuma requisição sai do browser.** A decisão nunca chega ao servidor |
| `cancelar-externo/route.ts` (passo 7) | Recusa `PAID`, `A_VENCER`, `confirmado`, `paid_at`, `data_confirmacao` | `A_VENCER + confirmado` é o estado normal de todo faturado aprovado — recusa o caso que queremos atender |
| `cancelar-pago/route.ts` (passo 6) | Bloqueio de produção (`bloqueiaCancelamentoPago`) | A regra de produção só existe nesta rota |
| `cancelar-boleto-faturado/route.ts` | Recusa liquidação no título e na cobrança | Não conhece produção nem nota fiscal |

E a nota fiscal **não é consultada em lugar nenhum**: nenhuma das rotas de cancelamento lê `notas_fiscais` ou `notas_servico`.

### Números medidos em produção (25/08/2026)

| Medida | Valor |
|---|---|
| Cobranças `E-FATURADO` + `A_VENCER` + `confirmado` (a população-alvo) | 272 |
| …com título ativo vinculado | 152 |
| …com título já liquidado | 108 |
| Propostas dessas cobranças em `APROVADO` | 254 |
| Propostas dessas cobranças em `LIBERADO` | 18 |
| Propostas com 2 ou mais cobranças ativas | 22 |
| Títulos faturados **sem `id_pagamento`** (vínculo legado quebrado) | 266 |
| …desses, com status `PAID` | 255 |
| Notas fiscais autorizadas em ambiente `producao` | **0** (todas as 10 são `homologacao`) |

---

## 2. Decisão estruturante: passo a passo, não cascata

O cancelamento acontece em **três ações separadas, cada uma iniciada pelo usuário**. Nenhuma delas dispara a seguinte.

```
Passo 1 — Cancelar o(s) título(s)          [tela: Contas a Receber]
          Cancela no banco e no registro.
          A COBRANÇA CONTINUA VIVA: A_VENCER, confirmado = true,
          boleto_enviadoo = false → volta a aparecer na lista de
          Títulos do Registro de Recebíveis.
                        │
                        ▼
Passo 2 — O financeiro decide               [decisão humana]
          ├── gerar novo título ────────────► fim (refaturamento sem cancelar)
          └── seguir para o passo 3
                        │
                        ▼
Passo 3 — Cancelar a cobrança               [tela: Conferência (/cobrancas),
          A cobrança vira CANCELADO.         aba Confirmadas]
          O saldo da proposta reabre.
```

**Consequência direta:** `cancelar-externo` **não cancela títulos em cascata**. Se houver título em aberto vinculado, o veredito **recusa** e manda cancelar o título primeiro. O campo `titulosParaCancelar` do desenho anterior deixa de ser lista de ação e vira `titulosEmAberto` — o **motivo da recusa**.

### Por que passo a passo

- Cancelar título e cancelar cobrança são decisões diferentes, tomadas em momentos diferentes, muitas vezes por motivos diferentes (trocar o valor do título ≠ desfazer o faturamento).
- Uma cascata iniciada no servidor teria que orquestrar o webhook legado das empresas 1 e 3, que hoje é chamado **pelo navegador**. O passo a passo evita essa dependência inteira.
- Cada ação fica atômica do ponto de vista do usuário: se o banco recusar o cancelamento do título, nada mais foi tocado.

---

## 3. Decisões tomadas

| # | Decisão | Motivo |
|---|---|---|
| 1 | Um **único ponto de decisão no servidor**, consumido por todas as rotas e pela UI | Hoje quatro lugares discordam; o critério passa a ter um dono só |
| 2 | Fluxo em **três passos**, sem cascata (§2) | Ações independentes, e evita orquestrar o webhook legado |
| 3 | Ordem da recusa: **dinheiro recebido → nota fiscal → produção → vínculo ambíguo → E-CREDITO → título em aberto** | §5 |
| 4 | Nota **antes** de produção | Nota tem prazo legal (24h SEFAZ) e a tarefa é do próprio financeiro/fiscal; produção depende do gerente |
| 5 | `ambiente = 'homologacao'` **não bloqueia**. Só nota de `producao` | As 10 notas do banco são de homologação; sem esse filtro a regra bloquearia por nota de teste |
| 6 | A nota bloqueia **todas as cobranças da proposta** | `notas_fiscais.id_int` aponta para a proposta; não existe coluna ligando nota a cobrança |
| 7 | Modo restrito (`propostas.cancelar_cobranca_nao_paga`) continua **só `A_RECEBER`** | Refaturamento é operação do financeiro, não do vendedor |
| 8 | Vínculo cobrança↔título ganha **fallback por `id_int + is_faturado`**, com recusa por ambiguidade | 266 títulos legados sem `id_pagamento`, 255 deles `PAID` (§9, risco 1) |
| 9 | `/api/cobrancas/cancelar-boleto` é **apagada** | Órfã, divergente e com roteamento de banco errado (§8) |
| 10 | `CancelPropostaModal` separa os dois cancelamentos no texto e oferece **"Cancelar só a cobrança"** | O texto atual promete cancelar cobranças vinculadas e por isso atrai quem queria só a cobrança |
| 11 | Estado final da proposta após o passo 3: **`NOVO` com `tipo_cobranca = null`** | Cobrança morta significa condição financeira a renegociar — o rebaixamento a partir de `APROVADO`/`LIBERADO` é o correto, não um efeito colateral a corrigir |
| 12 | A **reativação da cobrança na empresa 2** (cascata do Inter) entra **nesta rodada** | É o que viola a invariante da cobrança viva; sem ela o passo 1 não funciona na Birô (§7) |
| 13 | `cancelar-proposta` aplica **só as regras de dinheiro** — recusa 1 (`COBRANCA_RECEBIDA`) e `TITULO_LIQUIDADO`. Nota autorizada e produção ativa **não** bloqueiam essa rota | Cancelar a proposta é **encerrar o pedido**, não refaturar. Nota e produção existem para proteger o refaturamento, e valem só nas rotas de cancelamento de cobrança |
| 14 | A ação de cancelar título fica **somente em Contas a Receber**, no menu Ações da Carteira, reusando o **"Cancelar recebível"** que já existe. O Registro de Recebíveis **não** ganha ação de cancelamento e **seu filtro não muda** | Aquela lista mostra só o que ainda **não** virou título; uma ação de cancelamento ali nasceria cobrindo zero casos. Revoga a decisão anterior de colocar a ação nas duas telas |
| 15 | Motivo do passo 3: **texto livre**, como hoje no fluxo não pago. Sem catálogo | Catálogo de motivo + destino do valor existe porque o fluxo pago mexe em receita reconhecida. Refaturamento não mexe |
| 16 | São **três** vínculos cobrança↔título, não dois: primário por `id_pagamento`, BOLETO por `id_boleto_c6 + id_int`, e o fallback legado | O vínculo do BOLETO é o mesmo filtro composto que `cancelar-externo` já usa. Sem ele, cobrança BOLETO com título liquidado não seria vista pelo veredito |
| 17 | Sob `vinculoAmbiguo`, os títulos órfãos **saem do dossiê** | Se ficassem, a recusa exibida seria sobre um título que talvez nem seja daquela cobrança. Saindo, a recusa é `VINCULO_AMBIGUO` — a informação honesta |

---

## 4. O ponto único de decisão

Três camadas, um critério:

| Camada | Arquivo | Responsabilidade |
|---|---|---|
| Núcleo puro | `src/features/cobrancas/cancelamento-elegibilidade.ts` | Recebe o dossiê montado, devolve o veredito. Sem I/O, sem React — testável isolado. Mesmo padrão de `cancelamento-pago.ts` |
| Coletor server-side | `src/features/cobrancas/services/cancelamento-elegibilidade.server.ts` | `avaliarCancelamento(supabase, pagamentoId)`: monta o dossiê e chama o núcleo |
| Rota de leitura | `GET /api/cobrancas/pode-cancelar?id=<uuid>` | Só para a UI. Zero efeito colateral |

As rotas de escrita chamam **o coletor diretamente** (chamada de função, não HTTP). A UI chama a rota. O mesmo código decide nos dois caminhos — é isso que impede a divergência de hoje entre tela e servidor.

O coletor usa o **client JWT do usuário**, sem service role, como todas as rotas de cobrança — a RLS continua valendo.

### O dossiê

Quatro consultas, disparadas em paralelo:

1. **`pagamentos_v2`** pela PK — `id, id_int, id_pagamento, id_cliente, id_empresa, status, confirmado, tipo_cobranca, paid_at, data_confirmacao, cod_solicitacao_inter, reserva_estado, id_pendencia, chave_reserva, valor`
2. **`propostas`** por `id_int` — `status_interno, is_prd_aprovado, empresa, vendedor`
3. **`boletos`** — títulos vinculados, por **três** vias, unidas e deduplicadas por `id` (decisão 16):
   - **primária**: `id_pagamento = pagamento.id_pagamento`
   - **BOLETO comum**: `id_boleto_c6 = pagamento.cod_solicitacao_inter AND id_int = pagamento.id_int` — o mesmo filtro composto que `cancelar-externo` já usa (nunca `id_int` isolado)
   - **fallback legado**: `id_int = pagamento.id_int AND is_faturado IS TRUE AND id_pagamento IS NULL`, e só quando a cobrança é da família faturado — um BOLETO não possui título faturado
   - o fallback só é aceito quando a proposta tem **exatamente uma** cobrança da família faturado; com mais de uma, o dossiê marca `vinculoAmbiguo = true` e os órfãos **saem do dossiê** (decisão 17)
4. **`notas_fiscais`** e **`notas_servico`** por `id_int`, com `status = 'AUTORIZADA'` **e** `ambiente = 'producao'` — regra nova, nenhuma rota consulta isso hoje

### O veredito

```ts
type VereditoCancelamento = {
  pode: boolean;
  code: CodigoVeredito;
  message: string;              // diz ao usuário O QUE FAZER
  acao?: AcaoSugerida;          // dirige o botão do modal
  fluxo: "NORMAL" | "PAGO";     // qual rota/formulário atende
  titulosEmAberto: TituloResumo[];  // motivo da recusa TITULO_EM_ABERTO — nunca lista de ação
};

type CodigoVeredito =
  | "OK"
  | "JA_INATIVA"
  | "COBRANCA_RECEBIDA"
  | "TITULO_LIQUIDADO"
  | "NOTA_AUTORIZADA"
  | "PRODUCAO_ATIVA"
  | "VINCULO_AMBIGUO"
  | "CREDITO_CONSUMIDO"
  | "TITULO_EM_ABERTO";

type AcaoSugerida =
  | "CANCELAR_NOTA"       // → Fiscal › Notas Fiscais
  | "DEVOLVER_OS"         // → Pedidos, devolver para REVISAO ATENDENTE
  | "RETIRAR_PRODUCAO"    // → Pedidos, retirar da produção
  | "CANCELAR_TITULO"     // → Contas a Receber (passo 1)
  | "ABRIR_DEVOLUCAO"
  | "CONFERIR_MANUAL";
```

`titulosEmAberto` carrega `id`, `parcela`, `total_parcelas`, `valor`, `vencimento`, `id_empresa` — o suficiente para a mensagem nomear o título e para o modal linkar a tela certa.

---

## 5. Ordem das checagens e a mensagem de cada recusa

A ordem define qual recusa o usuário lê quando mais de uma se aplica. O critério de ordenação: **primeiro o que nenhuma ação do usuário destrava**, depois o que ele mesmo resolve, depois o que depende de terceiros, e por último a instrução operacional do fluxo.

### 0. Idempotência — `JA_INATIVA`

`status ∈ {CANCELADO, CANCELADA, EXTORNADO, RECUSADO}` → **sucesso no-op**, não recusa.

> Cobrança já estava cancelada. Nenhuma ação executada.

Protege contra duplo clique, como já fazem as rotas hoje.

### 1. Dinheiro já recebido

Vem primeiro porque nem cancelar a nota, nem devolver a OS, nem cancelar o título muda o fato de o dinheiro ter entrado. Duas variantes, com mensagens diferentes:

**`COBRANCA_RECEBIDA`** — `status = PAID` ou `paid_at` preenchido:

> Esta cobrança já foi recebida em 12/08/2026. Cancelar não devolve o dinheiro — o caso é devolução, não cancelamento.

`acao = ABRIR_DEVOLUCAO`. O fluxo excepcional de super admin (`cancelar-pago`) continua existindo à parte e é sinalizado por `fluxo: "PAGO"`.

**`TITULO_LIQUIDADO`** — algum título vinculado com `paid_at` ou `status = PAID`:

> O título 1/1 desta cobrança (R$ 2.480,00) foi liquidado em 12/08/2026. A cobrança inteira vira devolução — não cancele por aqui.

`acao = ABRIR_DEVOLUCAO`. Esta é a regra 3 na sua metade dura: **título liquidado bloqueia a cobrança inteira**.

### 2. Nota fiscal autorizada — `NOTA_AUTORIZADA`

Nota de **produção** com `status = 'AUTORIZADA'` em `notas_fiscais` **ou** `notas_servico`, para o `id_int` da proposta.

> A proposta 20714 tem NF-e nº 1832 autorizada. Cancele a nota em Fiscal › Notas Fiscais antes de cancelar a cobrança.

Para NFS-e, a mesma frase com "NFS-e nº …". `acao = CANCELAR_NOTA`.

Antes de produção por decisão 4: prazo legal e tarefa do próprio financeiro/fiscal.

### 3. Produção ativa — `PRODUCAO_ATIVA`

Reusa `bloqueiaCancelamentoPago` e `mensagemBloqueioProducao` de `cancelamento-pago.ts` sem alteração — as duas variantes já estão certas:

> Proposta 20714 está EM PRODUCAO. Peça ao gerente para devolver a proposta para REVISAO ATENDENTE antes de cancelar a cobrança.

`acao = DEVOLVER_OS`; e, quando o bloqueio vier de `is_prd_aprovado` com status ainda anterior à produção:

> Proposta 20714 consta liberada para a produção. Peça ao gerente para retirá-la da produção antes de cancelar a cobrança.

`acao = RETIRAR_PRODUCAO`.

Esta é a regra 2, que hoje só vale no `cancelar-pago` e passa a valer em todas as rotas.

### 4. Vínculo de títulos ambíguo — `VINCULO_AMBIGUO`

Há título legado sem `id_pagamento` na proposta **e** a proposta tem mais de uma cobrança da família faturado.

> Não foi possível identificar com segurança quais títulos pertencem a esta cobrança (registro antigo, sem vínculo gravado). Peça conferência manual antes de cancelar.

`acao = CONFERIR_MANUAL`. Recusa conservadora: **1 caso** no banco hoje. O custo de errar aqui é cancelar uma cobrança cujo título foi pago.

### 5. Crédito consumido — `CREDITO_CONSUMIDO`

`tipo_cobranca = E-CREDITO`. Mantém o bloqueio já existente:

> Cobrança paga com crédito do cliente: o cancelamento não estorna o crédito consumido. Use o estorno de crédito.

### 6. Título em aberto — `TITULO_EM_ABERTO`

Algum título vinculado que não está cancelado nem liquidado.

> Esta cobrança tem o título 1/1 (R$ 2.480,00, vence 30/08/2026) em aberto no banco. Cancele o título primeiro em Contas a Receber — a cobrança continua ativa e volta para o Registro de Recebíveis.

`acao = CANCELAR_TITULO`, com `titulosEmAberto` preenchido.

**Por que é a última.** É a única recusa que é uma instrução de fluxo, não um impedimento. Se ela viesse antes, uma proposta em produção com título em aberto ouviria "cancele o título primeiro" — conselho errado: o título não é o problema, a produção é. Deixando por último, a mensagem só aparece quando cancelar o título é de fato o próximo passo correto.

### 7. Regra 4 — `A_VENCER` + `confirmado` + `E-FATURADO` **passa**

Deixa de ser impeditivo por si só. O que impede são as regras 1, 2 e 3, verificadas acima. Este é o destravamento central da spec.

### 8. `OK`

`pode = true`. Nas rotas, o cancelamento segue. Na UI, o formulário de motivo abre.

---

## 6. As rotas

| Rota | O que muda | O que sai |
|---|---|---|
| `POST /api/cobrancas/cancelar-externo` | Os passos 7 e 7b saem e viram a chamada a `avaliarCancelamento`. Passa a aceitar `A_VENCER + confirmado` quando o veredito disser `OK`. **Não cancela títulos** — título em aberto é recusa | `{ success, partial, resultados }`; recusa → 409 com `code` e `message` do veredito |
| `POST /api/cobrancas/cancelar-pago` | Mantém o que é dele (super admin, motivo de catálogo, destino do valor, mês fechado). O passo 6 (produção) vira a chamada ao veredito com o subconjunto `RECUSAS_COBRANCA_PAGA` = **nota fiscal + produção**. Ganha a checagem de nota, que nenhuma rota fazia | Contrato atual + os códigos `NOTA_AUTORIZADA` e `FALHA_LEITURA` |
| `POST /api/cobrancas/cancelar-boleto-faturado` | Consulta o veredito da cobrança-mãe **antes** de acionar Inter/legado; e passa a garantir a invariante do passo 1 (§7) | Payload atual + `code` do veredito na recusa + `cobrancaReativada: boolean` |
| `POST /api/orcamentos/cancelar-proposta` | Veredito por cobrança ativa com `RECUSAS_DE_DINHEIRO` (decisão 13); `NOTA_AUTORIZADA` e `PRODUCAO_ATIVA` são **ignoradas** aqui. **Mais** uma regra de nível proposta que o veredito não alcança — ver abaixo | Recusa passa a dizer o que fazer, não só "não pode" |

**A regra que fica fora do veredito.** O veredito é de nível **cobrança**; `cancelar-proposta` é de nível **proposta**. Um boleto liquidado cuja cobrança já foi cancelada não aparece em nenhum dossiê de cobrança ativa — e mesmo assim significa que entrou dinheiro naquela proposta. Medido em 25/08/2026: **193 propostas** estão nessa situação. Por isso a checagem "qualquer boleto com `paid_at` no `id_int`" permanece na rota, explícita, antes do laço do veredito.

**Afrouxamento medido.** A regra antiga barrava também por `confirmado === true` isolado. Faturado aprovado é recebimento futuro autorizado, não dinheiro recebido — mesmo critério da regra 4. Isso destrava **268 propostas** que hoje não podem ser canceladas sem ter recebido nada.
| `GET /api/cobrancas/pode-cancelar` | **Nova.** Leitura pura para a UI | O veredito |
| `POST /api/cobrancas/cancelar-boleto` | **Apagada** (§8) | — |

O **modo restrito** (`propostas.cancelar_cobranca_nao_paga`) continua sendo uma allowlist aplicada **por cima** do veredito: exige `A_RECEBER`, proposta do próprio usuário, sem vínculo de Conta Corrente. Nunca relaxa nada que o veredito tenha travado, e não ganha o faturado (decisão 7).

### Aplicar um subconjunto das recusas

`cancelar-proposta` precisa de duas das seis recusas, e só. Para isso o veredito é **granular por natureza**: o coletor devolve, junto do `code` da primeira recusa, o conjunto de todas as recusas aplicáveis. Cada chamador declara quais respeita:

| Chamador | Recusas aplicadas |
|---|---|
| `cancelar-externo`, `pode-cancelar` | Todas |
| `cancelar-proposta` | `RECUSAS_DE_DINHEIRO` — só `COBRANCA_RECEBIDA` e `TITULO_LIQUIDADO` (decisão 13) |
| `cancelar-pago` | `RECUSAS_COBRANCA_PAGA` — só `NOTA_AUTORIZADA` e `PRODUCAO_ATIVA` |
| `cancelar-boleto-faturado` | `RECUSAS_CANCELAMENTO_TITULO` — só `COBRANCA_RECEBIDA` |

**Por que `cancelar-boleto-faturado` aplica só uma.** É operação de **título**, não de cobrança, e é o passo 1 — cancelar o título aberto é o serviço que ela presta. `TITULO_LIQUIDADO` tem granularidade de cobrança ("algum título pago") e impediria cancelar a 3ª parcela de um faturado cuja 1ª foi paga (2 casos reais em 25/08/2026); a checagem do título **alvo** continua na própria rota, que é onde a granularidade existe. `NOTA_AUTORIZADA` e `PRODUCAO_ATIVA` bloqueariam o "cancelar título para reemitir", inclusive no fluxo de salvar orçamento, que chama a mesma rota — cancelar um boleto não invalida NF-e, e estar em produção não congela a forma de pagamento. Medido: dos 58 faturados com título aberto, **zero** em produção e **zero** com nota de produção.

**Por que `cancelar-pago` não aplica as recusas de dinheiro.** Ali o dinheiro recebido é a **premissa**, não o impedimento: aquela rota existe para cancelar o que já foi pago e declarar o destino do valor. `COBRANCA_RECEBIDA` e `TITULO_LIQUIDADO` são duas formas de afirmar o mesmo fato que ela trata. Medido em 25/08/2026: aplicar `TITULO_LIQUIDADO` ali recusaria **150 dos 182 boletos pagos** e mais 20 PIX, exibindo "a cobrança inteira vira devolução — não cancele por aqui" justamente no fluxo de devolução. `CREDITO_CONSUMIDO` fica de fora porque a rota já tem bloqueio próprio de tipo, com mensagem e código específicos; e `TITULO_EM_ABERTO` é da família faturado, que ela recusa antes por tipo.

A ordem de §5 continua valendo dentro de cada subconjunto: quem aplica duas recusas exibe a primeira das duas que se aplicar. O que **nunca** é permitido é um chamador inventar recusa própria — se uma regra nova aparecer, ela nasce no núcleo e os chamadores escolhem se a respeitam.

---

## 7. Passo 1 e a invariante "a cobrança continua viva"

O passo 1 acontece hoje em **Contas a Receber** (`ContasReceberPage.handleConfirmarCancelamento`), que chama `deleteBoletoFromBankViaN8n` → `POST /api/cobrancas/cancelar-boleto-faturado`.

**A invariante que o passo 1 precisa garantir, ao terminar:**

```
pagamentos_v2:  status = 'A_VENCER'
                confirmado = true
                motivo_cancela = null
                boleto_enviadoo = false
boletos:        o título cancelado saiu (empresa 2) ou está CANCELADO (empresas 1 e 3)
```

Com `boleto_enviadoo = false`, a cobrança volta a casar com o filtro do Registro de Recebíveis (`tipo_cobranca IN (E-FATURADO,…) AND status = 'A_VENCER' AND confirmado = true AND boleto_enviadoo IS NULL OR false`) e reaparece na lista de Títulos.

### Empresa 2 (Ideal Birô — Inter, webhook `cancela-boleto-fat-inter`)

> **Revisado em 25/08/2026 pela Etapa 0 do plano** (leitura do workflow vivo `8ahqXY8sASxqOETd`, 45 nós). O que esta seção afirmava sobre a cascata estava errado. O texto abaixo é o comportamento verificado.

**A cascata não existe.** O ramo do webhook `cancela-boleto-fat-inter` faz:

```
Cancelar PIX (Inter) → Code (cancelado = !temErro) → If
  ├─ false → Respond to Webhook (409)
  └─ true  → Busca boleto alvo (por id_boleto_c6, limit 1)
             → deleta_boleto (DELETE físico em boletos)
             → Busca parcelas restantes (por id_int, status != CANCELADO)
             → Conta parcelas ativas → IF Sem parcela ativa
                  ├─ true  ─┐
                  └─ false ─┴→ Responde Sucesso    ← as DUAS saídas no mesmo nó
```

**Nenhum nó do ramo escreve em `pagamentos_v2`.** O único que escreveria, `Update v2`, está **desativado e órfão** — e é nó de emissão (`cod_solicitacao_inter`, `linha_digitavel`, `url_pdf`), não de cancelamento. Também não há trigger em `boletos` que escreva em `pagamentos_v2`, nem outro workflow atendendo aquele path.

Consequências para o desenho:

1. **A invariante da cobrança viva já é verdadeira na Birô hoje**, porque nada cancela a cobrança. Quem a sustenta é o **lado ERP** — a correção de `boleto_enviadoo` com fallback de vínculo, §12.
2. **A reativação continua na rodada, como defesa idempotente**, não como o que sustenta a invariante. Ela é barata, não tem efeito quando não há o que reativar, e protege caso a cascata volte num save da UI do n8n. O padrão vem de `faturado-titulos.service.ts:129-160`, herdado pelos dois chamadores: o "Cancelar recebível" de Contas a Receber e o fluxo de salvar orçamento.
3. **A decisão é sempre por releitura do banco, nunca pelo retorno do webhook.** Ver abaixo.

**`pagamento_cancelado` e `pagamentoCancelado` não são confiáveis.** O nó `Responde Sucesso` devolve `pagamento_cancelado: semParcelaAtiva` — e `semParcelaAtiva` é apenas **calculado**, nunca aplicado. Quando vem `true`, o campo afirma que a cobrança foi cancelada **sem que nada tenha sido escrito**: é informação falsa. A rota `cancelar-boleto-faturado` repassa isso como `pagamentoCancelado`. Nem a rota nem a tela podem decidir por esses campos — **a decisão sai sempre de uma releitura de `pagamentos_v2`.**

**`parcelas_ativas_restantes` é contado por `id_int`, não por cobrança.** O nó `Busca parcelas restantes` filtra `boletos` por `id_int` e `status != CANCELADO`. Numa proposta com duas cobranças faturadas, as parcelas de uma entram na contagem da outra. O número **não pode ser exibido como se fosse da cobrança** — nem usado para decidir. A recusa `VINCULO_AMBIGUO` cobre o caso no nosso lado; o número devolvido pelo webhook segue sendo diagnóstico, não fato.

**Nunca observado em produção.** Nas 18 execuções retidas (a mais recente de 19/08/2026) **nenhum cancelamento chegou ao `deleta_boleto`** — todos foram recusados pelo Inter. Não é possível saber se a cascata já existiu e se perdeu num save, ou se a documentação sempre esteve errada.

**A versão atual do ramo nunca executou.** O workflow foi alterado em **21/08/2026 22:33Z** (o fix do "204 sem corpo", que cita a execução 116724 de 19/08) e a execução retida mais recente é de 19/08. O primeiro cancelamento real na Birô será **também o primeiro teste desta versão do ramo** — ver §13, risco 7.

**Lacuna medida hoje, do lado ERP:** `ContasReceberPage` grava `boleto_enviadoo = false` apenas sob `is_faturado && id_pagamento`. É essa lacuna — não a cascata — que quebra o passo 1 hoje. §12.

### Empresas 1 e 3 (C6 — legado)

A rota devolve `delegarLegado: true` e o **navegador** chama o webhook `del-boleto-vibe`, com o tratamento de `ehRecusaPorTituloInativo` (o C6 dá baixa automática após o vencimento e passa a recusar o cancelamento) vivendo no cliente.

**Nesta rodada o cancelamento em si não muda.** Uma única alteração no servidor: hoje a rota devolve `delegarLegado: true` **antes de qualquer checagem** (primeiro `if` depois de reler o título). O veredito passa a ser consultado **antes desse retorno**, para que uma cobrança com nota autorizada, produção ativa ou título liquidado seja recusada nas três empresas — não só na 2.

O que continua exatamente como é hoje, do lado do cliente: a chamada ao webhook `del-boleto-vibe`, o tratamento de `ehRecusaPorTituloInativo` e a escrita de `boleto_enviadoo = false` em `ContasReceberPage`. A reconciliação de reativação descrita acima **não se aplica** às empresas 1 e 3: o fluxo legado não escreve em `pagamentos_v2`, então não há cascata para desfazer.

Trazer o webhook legado para o servidor é rodada própria (§11).

### Passo 3

Quando o financeiro chega ao passo 3, o veredito já não encontra título em aberto — a recusa `TITULO_EM_ABERTO` não dispara, e o cancelamento da cobrança segue por `cancelar-externo`.

---

## 8. A rota órfã `/api/cobrancas/cancelar-boleto`

**Nenhum chamador** — verificado por busca em todo o `src`. Ela:

- duplica `cancelar-externo` com regras que discordam dele;
- bloqueia `A_VENCER` e `confirmado`, exatamente o que a regra 4 destrava;
- aponta direto para o webhook do C6 (`del-boleto-av-vibe`) **sem o roteamento por empresa** — chamada para uma cobrança da Birô, mandaria um boleto do Inter para o C6.

**Decisão: apagar.** O histórico do git preserva o arquivo.

---

## 9. Conta Corrente e status da proposta

### Conta Corrente

- **Reserva de débito:** `liberarReservaSeHouver` (RPC `cc_encerrar_pendencia`, modo `LIBERAR_RESERVA`) já existe em `cancelar-externo` e passa a valer também para o faturado. Sem mudança de comportamento.
- **Refaturamento não gera crédito.** Não houve dinheiro recebido; não há o que lançar em conta corrente. O lançamento de crédito continua exclusivo do fluxo de cobrança paga (`cancelar-pago`, RPC `mc_ajuste_avulso_criar`, idempotente pela chave `pagamento.id`).
- **E-CREDITO** segue bloqueado (§5.5): o cancelamento não estorna o consumo.

### Status da proposta

Correção de premissa, medida no banco: em `pagamentos_v2` existem três triggers que escrevem em `propostas`, mas **um está desabilitado** (`tg_atualiza_status_proposta_pagamento`, `tgenabled = 'D'`). Ativos, dois:

| Trigger | Função | Efeito no cancelamento |
|---|---|---|
| `trg_sync_finiro_to_proposta` | `check_and_promote_proposta` | Com a única cobrança cancelada, `v_pagamentos_total = 0` → **não faz nada** |
| `trg_sync_status_proposta` | `atualizar_status_financeiro_proposta` | Tem guarda de status protegido (`REVISAO ATENDENTE` … `RECEBIDO`) e retorna sem escrever nesses casos. Fora da guarda, com **todas** as cobranças canceladas, grava `propostas.status_interno = 'CANCELADO'` |

Depois dos triggers, ainda no passo 3, a aplicação executa em `cancelar-externo`:

1. `reverterStatusPropostaSeSemCobranca` — conta cobranças não canceladas; sendo zero, lê o status atual e, se não for protegido, grava `NOVO` e `tipo_cobranca = null`;
2. `aplicarStatusRecomendadoProposta(…, "AUTO_FINANCEIRO")` — reconcilia pelo fluxo oficial (best-effort, nunca derruba o cancelamento).

**Sequência real para a população-alvo**, medida: as 272 cobranças estão em propostas `APROVADO` (254) ou `LIBERADO` (18). Nenhum desses dois status está na guarda do trigger, e **ambos estão** em `PROPOSTA_STATUS_PROTEGIDOS` do app. Logo, em 269 dos 272 casos (cobrança única na proposta):

```
UPDATE pagamentos_v2 → CANCELADO
   └─ trigger grava  propostas.status_interno = 'CANCELADO'     ← ramo 2 (§10.1)
app: reverterStatusPropostaSeSemCobranca lê 'CANCELADO'
   └─ 'CANCELADO' não é protegido → grava 'NOVO', tipo_cobranca = null
estado final: proposta NOVO, saldo reaberto, pronta para refaturar
```

Até 26/08/2026 esse `NOVO` **não era estável**: o próximo save do orçamento disparava o trigger e o ramo 2 reescrevia `CANCELADO` (medido em 150 ms, proposta 21232). Corrigido fora deste plano — §10.1.

**`NOVO` com `tipo_cobranca = null` é o estado final desejado** (decisão 11), não um efeito colateral tolerado: uma cobrança morta significa condição financeira a renegociar, e o rebaixamento a partir de `APROVADO`/`LIBERADO` diz exatamente isso. O comportamento atual de `reverterStatusPropostaSeSemCobranca` já entrega esse estado e **não muda** nesta rodada.

O que continua sendo pendência é o **caminho** até ele — e ele é pior do que esta seção descrevia até 25/08. O estado final é alcançado passando por `CANCELADO`, o app conserta uma vez, e **o trigger reescreve `CANCELADO` no próximo salvamento do orçamento**: hoje o `NOVO` não é estável. Correção em andamento fora deste plano; quando entrar, passa a ser. Ver **§10.1**.

---

## 10. Pendências conhecidas (não resolvidas nesta rodada)

### 10.1 `atualizar_status_financeiro_proposta` escreve status que ninguém pediu

> **RESOLVIDA em 26/08/2026.** Deixou de ser pendência. A correção foi feita **fora deste plano**, em trabalho paralelo autorizado, e está em produção no commit `fd000a0` — *fix(propostas): funcao financeira nao cancela nem reabre proposta*.
>
> Verificado no banco em 26/08/2026, nas duas sobrecargas de `atualizar_status_financeiro_proposta`: a função **não grava mais `CANCELADO`** e ganhou a guarda que a impede de tirar uma proposta desse status. Do lado da aplicação, `/api/orcamentos/cancelar-proposta` deixou de depender do efeito colateral do trigger — relê o status imediatamente antes do `UPDATE` e trava nele.
>
> **Consequência para este plano:** o estado final `NOVO` validado nas Etapas 7 e 9 **é estável**. Antes ele era correto no instante seguinte ao cancelamento e o trigger o reescrevia no próximo salvamento do orçamento; agora permanece. Provado em produção pelo dono: cancelar a cobrança e salvar o orçamento não derruba mais a proposta.
>
> O histórico abaixo fica registrado porque explica um comportamento que ainda aparece no audit de propostas antigas — e porque dois pontos **não** foram resolvidos pela correção (§10.1.4).
>
> *(Nota anterior, 26/08: a primeira versão desta seção descrevia a passagem por `CANCELADO` como transitória, corrigida pela aplicação. Estava errado, e subestimava o problema em dois pontos.)*

A função (nas duas sobrecargas, `integer` e `bigint`) tem dois ramos de "não há cobrança válida", e os dois escrevem status por conta própria:

| Ramo | Condição | Grava | Defeito |
|---|---|---|---|
| 1 | `v_total_pagamentos = 0` | `NOVO` | **Reabre proposta cancelada de propósito** |
| 2 | `v_total_cancelados = v_total_pagamentos` | `CANCELADO` | **Cancela proposta que ninguém mandou cancelar** |

#### 10.1.1 O ramo 2 não é transitório — ele se reafirma

Cancelamento de cobrança é lógico: a linha continua em `pagamentos_v2`. Então a conta "todas canceladas" **dá igual para sempre**. A aplicação corrige uma vez (`reverterStatusPropostaSeSemCobranca`), mas a correção é pontual e o trigger é permanente: **no próximo salvamento do orçamento** — que escreve em `produtos_proposta`/`cotacao_frete` — a função roda de novo e a proposta volta a `CANCELADO`.

Reproduzido na proposta **21232** em 26/08/2026, por `audit.logs_v2`:

```
14:50:12.403  AGUARDANDO -> CANCELADO   <- ramo 2
14:50:25.806  CANCELADO  -> NOVO        <- reversão do app
14:50:26.714  NOVO       -> AGUARDANDO  <- save do orçamento
14:50:26.862  AGUARDANDO -> CANCELADO   <- ramo 2 de novo, 150 ms depois
```

#### 10.1.2 O ramo 1 reabre proposta cancelada

Proposta cancelada pela rota própria fica, na prática, sem nenhuma linha em `pagamentos_v2`. Qualquer escrita em `produtos_proposta` ou `cotacao_frete` dessas propostas cai no ramo 1 e as devolve para `NOVO`. O buraco está aberto hoje; ainda não disparou porque ninguém tocou nos itens das canceladas depois do cancelamento.

#### 10.1.3 Amplitude medida (26/08/2026)

| Medida | Valor |
|---|---|
| Propostas em `CANCELADO` | 35 |
| …legítimas (têm a mensagem que só a rota própria escreve) | **4** |
| …vindas do ramo 2 | **31**, com 66 eventos de cancelamento no audit (2,1 por proposta) |
| Propostas em `NOVO` com todas as cobranças canceladas | **30** — voltam a `CANCELADO` no próximo save |
| Em `EM PRODUCAO` na mesma condição | 2 — protegidas pela guarda de status |

As consequências que esta spec já registrava — leitura concorrente vendo um cancelamento que não aconteceu, e dois eventos no audit indistinguíveis de cancelamento manual — continuam valendo, e são **maiores** do que o descrito: não é uma janela por operação, é um estado que se reinstala a cada salvamento.

#### 10.1.4 A correção — aplicada em 26/08/2026, fora deste plano

Feita em trabalho paralelo autorizado: migration `supabase/migrations/20260826_funcao_financeira_nao_cancela_proposta.sql` + ajuste da rota `/api/orcamentos/cancelar-proposta`, publicados juntos no commit `fd000a0`. **Não é escopo deste plano e não deve ser tocada aqui** (§10.1.5).

O que ela fez: os ramos 1 e 2 viram a mesma regra — *não há cobrança válida → `NOVO`, e só se a proposta não estiver `CANCELADA`*. A função nunca mais escreve `CANCELADO` nem tira uma proposta de `CANCELADO`. A reativação por cobrança nova continua funcionando, porque cai nos ramos 3/4 (`AGUARDANDO`/`APROVADO`), que não têm guarda.

**Efeito sobre este plano:** o estado final `NOVO` validado nas Etapas 7 e 9 **é estável**. Nada nas Etapas 4-10 mudou por causa disso — o que mudou é a durabilidade do resultado. A Etapa 13 pode ser executada sem a ressalva que existia: o passo 3 já é validado num estado que persiste.

Dois pontos que ela **não** resolveu, e que ficam registrados:

- **Sem backfill.** As 31 propostas já em `CANCELADO` não se corrigem sozinhas: a consulta de propostas filtra `status_interno <> 'CANCELADO'`, então ninguém as abre nem as salva. Precisam de ação separada.
- **Acoplamento na rota — resolvido junto.** A rota **dependia** do ramo 2 para gravar o `CANCELADO` quando havia cobrança pendente: a trava otimista do passo 6 falhava e a rota tratava o `CANCELADO` do trigger como sucesso. Sem o ajuste, a reconsulta passaria a encontrar `NOVO` e a rota devolveria 409 com as cobranças canceladas e a proposta **não** cancelada. Por isso migration e rota entraram **juntas**, no mesmo commit.

#### 10.1.5 Divisão de escopo (26/08/2026)

Duas frentes trabalham na mesma área. Para não haver atropelo:

| Frente | Cuida de |
|---|---|
| Sessão paralela | `atualizar_status_financeiro_proposta` e `/api/orcamentos/cancelar-proposta` |
| **Este plano** | O modal e a UI de cancelamento de cobrança |

Este plano **não toca** naqueles dois. A Etapa 7 já entregou o consumo do veredito em `cancelar-proposta` e não será mexida de novo aqui.

### 10.2 Nota fiscal e cobrança não têm vínculo

`notas_fiscais.id_int` e `notas_servico.id_int` apontam para a proposta. Numa proposta com mais de uma cobrança (22 propostas hoje), a nota autorizada bloqueia todas. É a decisão 6, tomada por falta de coluna — não por ser o comportamento ideal.

### 10.3 Nada disso é transacional

Provedor → `boletos` → `pagamentos_v2` → `propostas`. Uma falha no meio deixa estado parcial. Já é assim hoje; o passo a passo reduz a superfície (cada passo é uma ação isolada), mas não elimina. A ordem provedor-primeiro se mantém, e as rotas continuam reportando `partial`.

---

## 11. Fora desta rodada

- **Trazer o webhook legado das empresas 1 e 3 para o servidor.** Rodada própria. Nesta spec, o cancelamento de título dessas empresas segue como é hoje: rota devolve `delegarLegado: true` e o navegador chama `del-boleto-vibe`.
- ~~Corrigir `atualizar_status_financeiro_proposta` e o acoplamento de `/api/orcamentos/cancelar-proposta`~~ — **feito em 26/08/2026**, fora deste plano (commit `fd000a0`). Este plano segue não tocando nesses dois — divisão de escopo em §10.1.5.

---

## 12. O que muda na UI

### Conferência (`/cobrancas`) — passo 3

Nos três pontos de entrada do cancelamento — `CobrancaActionsMenu`, `CobrancaDetail` e `PropostaCobrancaPanel`:

- O item "Cancelar cobrança" deixa de ser desabilitado por status. Fica habilitado **por permissão apenas**.
- Ao abrir, o modal consulta `GET /api/cobrancas/pode-cancelar` e mostra um de dois estados:
  - **`OK`** → formulário de motivo, como hoje;
  - **recusa** → a `message` do veredito e um botão que leva ao lugar certo conforme `acao` (Fiscal › Notas Fiscais, Pedidos, Contas a Receber, devolução). Confirmar fica desabilitado. Para `TITULO_EM_ABERTO`, o modal lista os títulos que precisam ser cancelados antes — parcela, valor, vencimento.

### `CobrancasProvider.cancelCobranca`

O bloco `1287-1293` **deixa de decidir**. O que sobra ali é roteamento: `fluxo: "PAGO"` → `cancelar-pago`; caso contrário → `cancelar-externo`. Nenhuma recusa nasce mais no navegador.

`isCobrancaPagaParaCancelamento` continua existindo, mas só para escolher **qual formulário** montar (motivo livre × catálogo + destino do valor). É forma, não permissão.

### `CancelPropostaModal`

O aviso atual — *"Cobranças locais pendentes vinculadas também serão canceladas"* — descreve certo o que a rota faz, e é exatamente por isso que atrai quem queria cancelar só a cobrança. Passa a:

> Cancelar a proposta encerra o pedido. As cobranças pendentes vinculadas são canceladas junto.
> **Se você só quer refazer a cobrança, não cancele a proposta** — cancele a cobrança na aba Pagamentos.

Mais um botão secundário **"Cancelar só a cobrança"**, que fecha este modal e abre o de cobrança quando houver exatamente uma ativa; havendo mais de uma, leva para a aba Pagamentos.

O modal passa a listar o que será cancelado junto (cobranças e títulos) antes de confirmar — hoje o usuário confirma às cegas.

### Passo 1 — "Cancelar recebível", em Contas a Receber

Decisão 14: a ação vive **em uma tela só**. Não há ação nova de cancelamento — o passo 1 é o **"Cancelar recebível"** que já existe no menu Ações da Carteira de `ContasReceberPage`, em ambos os construtores de menu (`canAdmin`, os dois caindo em `handleConfirmarCancelamento`).

**O Registro de Recebíveis não muda.** Nem a ação, nem o filtro. Aquela lista mostra o que ainda não virou título; cobrança com título ativo aparece lá apenas como o badge informativo `POSSUI_TITULOS`, que continua sendo só um aviso apontando para Contas a Receber.

**O que "Cancelar recebível" passa a garantir.** Hoje ele cancela o título e grava `boleto_enviadoo = false`. Passa a ser o passo 1 completo, com a invariante da §7 valendo ao fim:

```
pagamentos_v2:  status = 'A_VENCER'
                confirmado = true
                motivo_cancela = null
                boleto_enviadoo = false
```

Três ajustes para isso:

1. **A cascata do Inter** (empresa 2) é reconciliada dentro da rota — §7. A tela apenas informa o desfecho, incluindo `cobrancaReativada`.
2. **O vínculo legado.** `handleConfirmarCancelamento` só grava `boleto_enviadoo = false` sob `if (item.is_faturado && item.id_pagamento)`, com `UPDATE … .eq("id_pagamento", item.id_pagamento)`. Nos **266 títulos faturados sem `id_pagamento`** essa condição é falsa e **nada é gravado**: a cobrança não volta para o Registro de Recebíveis, e o passo 1 termina pela metade. Dos 266, **11 estão em aberto** (7 `A_VENCER`, 4 `VENCIDO`) — são os casos que hoje falhariam em silêncio. O `boleto_enviadoo = false` passa a usar o **mesmo fallback de vínculo do dossiê** (`id_int + is_faturado`, com a mesma recusa por ambiguidade), em vez de depender de `id_pagamento`.
3. **A mensagem de desfecho** passa a dizer o que de fato aconteceu: título cancelado, **cobrança mantida ativa**, de volta ao Registro de Recebíveis — e, quando `cobrancaReativada` vier `true`, que ela foi reativada após a cascata do Inter.

**Não confundir com "Cancelar boleto"**, o item vizinho do mesmo menu (`onLifecycle.cancelarParaDeposito`): aquele transforma o boleto em depósito futuro e é outro fluxo, intocado por esta spec.

---

## 13. Riscos

| # | Risco | Mitigação |
|---|---|---|
| 1 | **266 títulos faturados sem `id_pagamento`, 255 deles `PAID`.** Olhando só `id_pagamento`, o veredito liberaria o cancelamento de cobranças cujo título já foi pago — falha silenciosa e a mais grave da spec | Fallback por `id_int + is_faturado` (decisão 8) e recusa `VINCULO_AMBIGUO`. Medido: os 266 se espalham por 99 propostas, **98 com uma única cobrança faturada** — o fallback é inequívoco em 98/99 |
| 2 | **Zero notas de produção no banco.** A regra 1 não bloqueia nada hoje e nunca foi exercitada em produção | O filtro `ambiente = 'producao'` (decisão 5) impede bloqueio por nota de teste. A regra precisa de teste dedicado quando a emissão em produção entrar no ar |
| 3 | **Retorno do webhook mente.** `pagamento_cancelado` vem `true` sem que nada tenha sido escrito, e `parcelas_ativas_restantes` é contado por `id_int`, misturando cobranças da mesma proposta | Nunca decidir por esses campos: **releitura de `pagamentos_v2`** sempre (§7). O número de parcelas é diagnóstico, nunca exibido como se fosse da cobrança |
| 4 | **A cascata pode voltar** num save da UI do n8n, sem aviso — foi assim que correções por API já se perderam duas vezes | A reativação fica na rodada como **defesa idempotente** (§7), inócua enquanto não houver cascata. Reconferir o workflow imediatamente antes de cada teste em produção |
| 5 | **Duplo clique / retry** no passo 1 com vários títulos | Cada título é uma ação do usuário; a idempotência por cobrança já existe. Rever a de título no plano |
| 6 | ~~Proposta transita por `CANCELADO` e o trigger reescreve o status a cada save~~ — **RESOLVIDO em 26/08/2026** (commit `fd000a0`, fora deste plano) | §10.1. A função não grava mais `CANCELADO`; o `NOVO` das Etapas 7 e 9 é estável. Resta sem backfill as 31 propostas já marcadas |
| 7 | **A versão atual do ramo de cancelamento do Inter nunca executou em produção** (alterada em 21/08, última execução retida em 19/08) | O primeiro cancelamento real na Birô é **também o primeiro teste da versão**. Tratar como estreia: uma cobrança escolhida pelo dono, conferência do resultado no banco antes de qualquer segunda execução |
| 8 | **Empresas 1 e 3 cancelam o título pelo navegador** | Fora de escopo (§11). O veredito ainda é consultado no servidor antes |

---

## 14. Critérios de aceite

1. Cobrança `E-FATURADO` + `A_VENCER` + `confirmado`, **sem** título em aberto, **sem** nota de produção, proposta fora de produção → cancelamento passa, saldo da proposta reabre, modal de gerar cobrança abre.
2. A mesma cobrança **com** título em aberto → recusa `TITULO_EM_ABERTO`, nomeando o título; nenhuma escrita acontece.
3. Cancelar o título (passo 1) → cobrança permanece `A_VENCER`, `confirmado = true`, `motivo_cancela = null`, `boleto_enviadoo = false`, e reaparece na lista de Títulos do Registro de Recebíveis. **Vale igualmente para faturado de parcela única da empresa 2**, apesar da cascata do n8n.
4. Cobrança com título liquidado → recusa `TITULO_LIQUIDADO` com texto de devolução, em todas as rotas.
5. Proposta com NF-e ou NFS-e autorizada **em produção** → recusa `NOTA_AUTORIZADA` mandando cancelar a nota. Nota em `homologacao` **não** bloqueia.
6. Proposta em estágio produtivo → recusa `PRODUCAO_ATIVA` com a variante correta (devolver × retirar da produção).
7. **`cancelar-proposta` com nota autorizada ou proposta em produção → cancela normalmente.** Só dinheiro recebido e título liquidado a barram (decisão 13).
8. Após o passo 3, a proposta fica em **`NOVO` com `tipo_cobranca = null`** e o modal de gerar cobrança abre pelo saldo reaberto.
9. "Cancelar recebível", em Contas a Receber, cumpre o passo 1 inteiro — **inclusive num faturado legado sem `id_pagamento`**, em que a cobrança precisa voltar ao Registro de Recebíveis pelo fallback de vínculo. O Registro de Recebíveis não ganhou ação nem mudou de filtro.
10. Motivo do passo 3 é **texto livre**; nenhum catálogo ou destino do valor é exigido.
11. Tela e servidor **nunca divergem**: qualquer recusa exibida na UI é a mesma que a rota produziria, porque vêm do mesmo código.
12. **Nenhuma decisão da rota ou da tela usa `pagamento_cancelado` / `pagamentoCancelado` do retorno do webhook.** O estado da cobrança após o passo 1 sai sempre de uma releitura de `pagamentos_v2` — verificável por busca no código: esses campos não aparecem em condicional alguma.
13. **`parcelas_ativas_restantes` não é exibido como número de parcelas da cobrança** nem usado para decidir; segue apenas como diagnóstico, porque é contado por `id_int`.
14. `GET /api/cobrancas/pode-cancelar` não escreve nada.
15. `/api/cobrancas/cancelar-boleto` deixou de existir.

---

## 15. Referências

- `docs/business/CANCELAMENTO-COBRANCAS.md` — regra vigente de cancelamento
- `docs/business/FLUXO-OFICIAL-STATUS-PROPOSTAS.md` — semântica de `LIBERADO`, `APROVADO`, `REVISAO ATENDENTE`
- `docs/business/CHECKOUT-PAGAMENTOS.md` — seção faturado
- `docs/superpowers/specs/2026-08-11-cancelamento-cobranca-paga-design.md` — fluxo de cobrança já paga, que esta spec passa a consumir o mesmo veredito
