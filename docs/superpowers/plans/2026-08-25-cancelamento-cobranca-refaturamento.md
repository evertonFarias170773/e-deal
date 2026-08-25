# Plano de implementação — Cancelamento de cobrança para refaturamento

**Spec:** `docs/superpowers/specs/2026-08-25-cancelamento-cobranca-refaturamento-design.md`
**Data:** 25/08/2026
**Branch:** `erp-ideal-preview` (branch única — todo trabalho acumula local até o dono pedir "publica")

**Objetivo:** um único ponto de decisão no servidor responde "esta cobrança pode ser cancelada?", com o motivo; o fluxo passa a ter três passos separados (cancelar título → decidir → cancelar cobrança); a trava client-side deixa de decidir.

---

## 1. Migration × código de aplicação

**Não há migration nesta rodada. Zero DDL, zero escrita estrutural no banco.**

Verificado em 25/08/2026:

| O que a spec precisa | Já existe? |
|---|---|
| `notas_fiscais.status`, `.ambiente`, `.id_int`, `.numero_nf` | Sim |
| `notas_servico.status`, `.ambiente`, `.id_int`, `.numero_nfse` | Sim |
| `boletos.id_pagamento`, `.is_faturado`, `.paid_at`, `.parcela`, `.total_parcelas` | Sim |
| `pagamentos_v2.boleto_enviadoo`, `.motivo_cancela`, `.confirmado` | Sim |
| Leitura de `notas_fiscais` / `notas_servico` pelo JWT do usuário | Sim — políticas RLS de `SELECT` são `USING (true)` para `authenticated`. **Sem risco de "zero linhas" silencioso**, que faria a regra da nota nunca disparar |
| Leitura de `boletos` pelo JWT | Sim — política `geral`, `USING (true)` |

**Tudo é código de aplicação:** dois módulos novos, uma rota nova, quatro rotas alteradas, uma rota apagada, cinco pontos de UI.

**Escritas em banco que o código faz** — todas por rotas já existentes, nenhuma nova tabela ou coluna:

- `UPDATE pagamentos_v2 SET status, motivo_cancela` (cancelamento — já existe)
- `UPDATE pagamentos_v2 SET status='A_VENCER', motivo_cancela=null, boleto_enviadoo=false` (reativação pós-cascata — padrão já em produção em `faturado-titulos.service.ts`)
- `UPDATE boletos SET status='CANCELADO'` (já existe)
- `INSERT propostas_chat` (histórico — já existe)

**O único item de banco desta linha de trabalho — o ramo `todas canceladas → propostas.status_interno = 'CANCELADO'` em `atualizar_status_financeiro_proposta`** — está registrado como pendência conhecida na §10.1 da spec e **fica fora desta rodada** por decisão do dono.

---

## 2. Autorizações que preciso de você, uma a uma

Nenhuma destas acontece sem seu "pode".

| # | Ação | Por que precisa de você | Quando |
|---|---|---|---|
| **A1** | ~~Conferir o workflow `VIBE-BOLETO-FATURADO-INTER` no n8n~~ — **concluída em 25/08/2026** | Era a premissa da Etapa 6. **Correção:** este plano dizia que só o dono alcançava o n8n. Errado — há `API_KEY_N8N` e `URLN8N` no `.env.local`, e a leitura foi feita por GET na API (`/api/v1/workflows`, `/api/v1/executions`). Alterar workflow segue exigindo autorização (A6) | ✔ feita |
| **A2** | **Apagar `src/app/api/cobrancas/cancelar-boleto/route.ts`** | Remoção de rota, ainda que órfã | Etapa 8 |
| **A3** | **Primeiro cancelamento de título REAL na empresa 2 (Birô), em produção** | Aciona o Banco Inter de verdade. Irreversível: o título sai do banco e a linha de `boletos` é excluída pelo n8n | Etapa 13 |
| **A4** | **Primeiro cancelamento de cobrança REAL (passo 3), em produção** | Muda `pagamentos_v2` e rebaixa a proposta para `NOVO`. Reversível só na mão | Etapa 13 |
| **A5** | **Publicar** (`git add -A` + `git push origin erp-ideal-preview` → deploy Vercel) | Deploy automático de produção | Ao fim, ou nos cortes que você escolher |
| **A6** | **Alterar o workflow no n8n**, se A1 mostrar que é necessário | Fora do repo, e sujeito a ser sobrescrito | Só se A1 apontar |

**Não peço autorização para:** ler o banco (read-only), escrever código local, rodar `tsc`/`eslint`. Nada disso toca produção.

---

## 3. Etapa 0 — Conferência do workflow n8n (**antes de qualquer código**)

**Status: CONCLUÍDA em 25/08/2026** (leitura por GET na API do n8n; nada alterado). Workflow `8ahqXY8sASxqOETd`, ativo, 45 nós.

| # | Pergunta | Resposta verificada |
|---|---|---|
| 1 | Escreve em `pagamentos_v2`? Sob qual condição? | **Não, em condição nenhuma.** O único nó capaz disso, `Update v2`, está desativado e órfão — e é nó de emissão, não de cancelamento |
| 2 | A escrita é antes ou depois da resposta HTTP? | **Sem objeto** — não há escrita. (No `cancela-boleto-inter-biro`, que escreve: **antes** do respond) |
| 3 | Exclui a linha de `boletos` sempre ou só no sucesso? | Só no sucesso, e é **DELETE físico** |
| 4 | Há retry/fila que escreva depois? | Não no ramo de cancelamento; o laço `Aguarda Inter` é do ramo de emissão |
| 5 | O fix histórico continua lá? | **Sim, intacto.** 45 nós, `Update v2` desativado e órfão, `Cria-boleto` como `update` filtrando `id_pagamento + ext_reference` com os 6 campos bancários e sem `onError`, laço de retry completo — bate com o checklist do estado correto |

**Achados adicionais, todos incorporados na §7 da spec:**

- `Responde Sucesso` devolve `pagamento_cancelado: semParcelaAtiva`, valor apenas **calculado e nunca aplicado** — informação falsa quando `true`. A rota repassa como `pagamentoCancelado`. **Nenhuma decisão pode usar esses campos**; a fonte é sempre uma releitura de `pagamentos_v2`.
- `parcelas_ativas_restantes` é contado por **`id_int`**, misturando cobranças da mesma proposta. Diagnóstico, nunca fato, e nunca exibido como parcelas da cobrança.
- O ramo acha o título por `id_boleto_c6` e conta parcelas por `id_int`; lê `id_pagamento` no contexto e **nunca o usa**. Os 266 títulos legados sem `id_pagamento` **não afetam o workflow** — o problema é exclusivamente do lado ERP (Etapa 10).
- **A versão atual do ramo nunca executou.** Alterado em 21/08/2026 22:33Z; a execução retida mais recente é de 19/08. Nas 18 retidas, nenhum cancelamento chegou ao `deleta_boleto` — todos recusados pelo Inter. O primeiro cancelamento real na Birô será o primeiro teste desta versão (risco 7 da spec; ver Etapa 13).
- Empresas 1 e 3 (`del-boleto-vibe`, `del-boleto-av-vibe`): **não tocam o banco**, só o C6 — confirma o que a spec assumia. `cancela-boleto-inter-biro` (boleto à vista da Birô): **escreve** `pagamentos_v2.status='CANCELADO'` por `cod_solicitacao_inter`, antes do respond, e nunca grava `motivo_cancela`.

**Consequência para o plano:** a **Etapa 6 deixa de ser crítica** — a invariante da cobrança viva já é verdadeira na Birô, porque nada cancela a cobrança. A reativação segue na rodada como **defesa idempotente**. **A Etapa 10 passa a ser a etapa crítica do passo 1**, porque é a lacuna de `boleto_enviadoo` no lado ERP que hoje quebra o fluxo.

---

## 4. Etapas de código

Ordem de execução. Cada etapa só começa quando a anterior valida.

### Etapa 1 — Núcleo puro do veredito
**Aplicação.** `src/features/cobrancas/cancelamento-elegibilidade.ts`

Tipos (`VereditoCancelamento`, `CodigoVeredito`, `AcaoSugerida`), catálogo de mensagens, e a função pura que recebe o dossiê e devolve o veredito na ordem da §5 da spec. Reusa `bloqueiaCancelamentoPago` e `mensagemBloqueioProducao` de `cancelamento-pago.ts` — não reescreve a regra de produção.

**Valida antes de seguir:** `npx tsc --noEmit` limpo. Uma tabela de casos cobrindo as seis recusas + `OK` + `JA_INATIVA`, incluindo: nota `homologacao` **não** bloqueia; nota `producao` bloqueia; `A_VENCER + confirmado + E-FATURADO` sem impedimento passa; título liquidado ganha `ABRIR_DEVOLUCAO`; título em aberto é a **última** recusa.

### Etapa 2 — Coletor server-side
**Aplicação.** `src/features/cobrancas/services/cancelamento-elegibilidade.server.ts`

`avaliarCancelamento(supabase, pagamentoId)`: quatro consultas em paralelo, montagem do dossiê, chamada ao núcleo. Inclui o fallback de vínculo `id_int + is_faturado + id_pagamento IS NULL` e a marcação `vinculoAmbiguo`.

**Valida antes de seguir:** `tsc` limpo. E, por consulta read-only no banco, conferir o dossiê contra os números da spec: uma cobrança com título órfão (sem `id_pagamento`) precisa trazer o título pelo fallback — **é o risco 1 da spec, e é o que separa "funciona" de "libera cancelamento de cobrança com título pago"**. Testar contra pelo menos um dos 255 casos `PAID` órfãos.

### Etapa 3 — Rota de leitura
**Aplicação.** `GET /api/cobrancas/pode-cancelar?id=`

Sessão + escopo (mesmo padrão de `cancelar-externo`), chama o coletor, devolve o veredito. **Nenhuma escrita.**

**Valida antes de seguir:** `tsc` + `eslint`. Chamada local contra 3 cobranças reais de estados diferentes; conferir que o `code` bate com o esperado e que nada mudou no banco.

### Etapa 4 — `cancelar-externo` consome o veredito
**Aplicação.** Passos 7 e 7b saem; entra a chamada ao coletor. Passa a aceitar `A_VENCER + confirmado`. **Não cancela títulos** — título em aberto vira recusa 409.

**Valida antes de seguir:** `tsc` + `eslint`. Teste local: cobrança com título em aberto → 409 `TITULO_EM_ABERTO`, **e nenhuma escrita no banco** (conferir por releitura). Cobrança `A_RECEBER` comum → continua cancelando como hoje (não regredir o caminho existente).

### Etapa 5 — `cancelar-pago` consome o veredito
**Aplicação.** O passo 6 (produção) vira a chamada ao coletor; a rota herda nota fiscal e título liquidado. O resto (super admin, catálogo, destino, mês fechado) não muda.

**Valida antes de seguir:** `tsc` + `eslint`. Conferir que o contrato de resposta **não mudou** — `CancelCobrancaModal` depende dele.

### Etapa 6 — `cancelar-boleto-faturado`: veredito + defesa idempotente
**Aplicação.** *(Reclassificada para **secundária** pela Etapa 0: a cascata não existe, então esta etapa não é mais o que sustenta a invariante — ver Etapa 10.)* Três mudanças:

1. **Veredito antes da delegação.** Hoje a rota devolve `delegarLegado: true` no primeiro `if` após reler o título, sem checar nada. O veredito passa a ser consultado **antes** desse retorno, para valer nas três empresas. *(Esta é a parte que realmente muda comportamento nesta etapa.)*
2. **Reativação como defesa idempotente.** Depois de o n8n confirmar: reler `pagamentos_v2`; **se** voltou inativa, reabrir com `status='A_VENCER'`, `motivo_cancela=null`, `boleto_enviadoo=false`, `confirmado` preservado; devolver `cobrancaReativada`. Hoje esse ramo **não dispara**, porque nada cancela a cobrança. Fica porque é barato, inócuo quando não há o que reativar, e protege se a cascata voltar num save da UI do n8n. Padrão de `faturado-titulos.service.ts:129-160`.
3. **Não confiar no retorno do webhook.** A decisão sai da releitura, **nunca** de `pagamento_cancelado` / `pagamentoCancelado` — que vêm `true` sem escrita nenhuma. E `parcelas_ativas_restantes`, contado por `id_int`, não decide nada nem é repassado como parcelas da cobrança.

Extrair `cancelarTituloNoBanco(...)` para os dois chamadores (o "Cancelar recebível" de Contas a Receber e o fluxo de salvar orçamento) usarem a mesma função.

**Valida antes de seguir:** `tsc` + `eslint`. Empresas 1 e 3: conferir que `delegarLegado` continua saindo igual quando o veredito é `OK` — **não regredir o fluxo legado**, que está fora de escopo. Busca no código: `pagamentoCancelado` e `parcelas_ativas_restantes` não aparecem em nenhuma condicional. Empresa 2: só em produção, na Etapa 13 (A3).

### Etapa 7 — `cancelar-proposta` com subconjunto de regras
**Aplicação.** Substitui as regras próprias (linhas 97-120) pelo veredito, aplicando **só** `COBRANCA_RECEBIDA` e `TITULO_LIQUIDADO` (decisão 13). Nota e produção **não** bloqueiam aqui.

**Valida antes de seguir:** `tsc` + `eslint`. Caso explícito: proposta em produção com cobrança não paga → **cancela** (comportamento preservado). Proposta com título liquidado → recusa.

### Etapa 8 — Apagar a rota órfã
**Autorização A2.** Remover `src/app/api/cobrancas/cancelar-boleto/route.ts`.

**Valida antes de seguir:** busca em todo o `src` por `cancelar-boleto` que não seja `cancelar-boleto-faturado` → zero resultados fora de comentários. `tsc` + build limpos.

### Etapa 9 — UI: o provider deixa de decidir
**Aplicação.** `CobrancasProvider.cancelCobranca`: o bloco `1287-1293` deixa de recusar; vira roteamento por `fluxo` (`PAGO` → `cancelar-pago`; senão → `cancelar-externo`). Os três pontos de entrada (`CobrancaActionsMenu`, `CobrancaDetail`, `PropostaCobrancaPanel`) param de desabilitar por status — só permissão.

`CancelCobrancaModal` consulta `pode-cancelar` ao abrir e mostra: formulário de motivo (texto livre — decisão 15) quando `OK`; ou a mensagem + botão de ação quando recusa, com Confirmar desabilitado.

**Valida antes de seguir:** `tsc` + `eslint`. Na tela, para cada `code`, a mensagem exibida é **idêntica** à que a rota devolveria (critério de aceite 11 da spec).

### Etapa 10 — UI: "Cancelar recebível" vira o passo 1 ⭐ **etapa crítica**
**Aplicação.** Só `ContasReceberPage`. **O Registro de Recebíveis não é tocado** — nem ação, nem filtro, nem `getRecebiveisParaRegistro` (decisão 14 revisada).

> **Por que é a etapa crítica.** A Etapa 0 mostrou que a cascata do Inter não existe: nada no n8n cancela a cobrança. Logo, o que hoje quebra o passo 1 **não** é o workflow — é a lacuna do item 1 abaixo, no lado ERP. Sem esta etapa, o passo 1 termina pela metade e a cobrança não volta para o Registro de Recebíveis.

Nenhuma ação nova: o passo 1 é o **"Cancelar recebível"** já existente no menu Ações da Carteira, nos dois construtores de menu (linhas 2832 e 2943, ambos `canAdmin`). O que muda em `handleConfirmarCancelamento`:

1. **Corrigir o vínculo legado.** Hoje o `boleto_enviadoo = false` só acontece sob `if (item.is_faturado && item.id_pagamento)`, com `.eq("id_pagamento", …)`. Nos **266 títulos faturados sem `id_pagamento`** a condição é falsa e nada é gravado — a cobrança não volta ao Registro de Recebíveis e o passo 1 termina pela metade. **11 desses estão em aberto hoje** (7 `A_VENCER`, 4 `VENCIDO`) e falhariam em silêncio. Passa a usar o mesmo fallback de vínculo do dossiê (`id_int + is_faturado`), com a mesma recusa por ambiguidade.
2. **Consumir `cobrancaReativada`** da rota (Etapa 6) e não duplicar escrita: no caminho da empresa 2 quem reativa e grava `boleto_enviadoo = false` é a rota; no caminho legado (1 e 3) a tela segue gravando, como hoje.
3. **Mensagem de desfecho**: título cancelado, **cobrança mantida ativa**, de volta ao Registro de Recebíveis; e, com `cobrancaReativada`, que foi reativada após a cascata do Inter.

Cuidado de escopo: **não confundir com "Cancelar boleto"** (`onLifecycle.cancelarParaDeposito`), item vizinho do mesmo menu que transforma o boleto em depósito futuro. Outro fluxo, intocado.

**Valida antes de seguir:** `tsc` + `eslint`. Conferir em banco (read-only), num faturado legado **sem `id_pagamento`** e em aberto, que após o cancelamento a cobrança fica `A_VENCER` + `confirmado` + `boleto_enviadoo = false` e **volta a aparecer** na consulta do Registro de Recebíveis. Título liquidado continua desabilitado no menu (já é hoje) **e** recusado pela rota.

### Etapa 11 — `CancelPropostaModal`
**Aplicação.** Texto separado, botão "Cancelar só a cobrança", e a lista do que será cancelado junto.

**Valida antes de seguir:** `tsc` + `eslint`. Com uma cobrança ativa, o botão abre o modal de cobrança; com duas ou mais, leva para a aba Pagamentos.

### Etapa 12 — Documentação, incluindo três pontos hoje **errados**
**Aplicação.** Além de atualizar `docs/business/CANCELAMENTO-COBRANCAS.md` com o fluxo em três passos e a tabela de recusas (e `docs/DOCUMENTATION_INDEX.md` se necessário), corrigir os três lugares que afirmam uma cascata que **não existe** — verificado na Etapa 0:

1. **`src/app/api/cobrancas/cancelar-boleto-faturado/route.ts`**, cabeçalho: diz que o workflow "só marca `pagamentos_v2` como CANCELADO quando não resta parcela ativa". Não marca nunca. Reescrever descrevendo o comportamento real e dizendo explicitamente que `pagamento_cancelado` do retorno não é confiável.
2. **`docs/business/CHECKOUT-PAGAMENTOS.md:394-410`**, seção "Cancelamento em cascata da cobrança (parcela única)": descreve a cascata como fato. Corrigir, preservando a descrição das duas defesas — que continuam válidas como proteção, não como reação a algo que ocorre hoje.
3. **`src/features/orcamentos/services/faturado-titulos.service.ts:129-160`**, comentário da reativação: explica o código como resposta a uma cascata observada. Reescrever como defesa idempotente, registrando que o ramo não dispara hoje e por que fica.

**Valida antes de seguir:** o doc descreve o que o código faz — sem regra inventada, sem regra omitida. Busca por "cascata" no repo não retorna afirmação de que o Inter cancela `pagamentos_v2`.

### Etapa 13 — Validação fim a fim em produção
**Autorizações A3 e A4**, uma por vez, em cobranças que **você escolher**.

> **Estreia de versão.** O ramo de cancelamento do `VIBE-BOLETO-FATURADO-INTER` foi alterado em 21/08/2026 e **nunca executou**: a execução retida mais recente é de 19/08, e nenhuma das 18 chegou a excluir um título — todas foram recusadas pelo Inter. O passo 2 abaixo é, ao mesmo tempo, o primeiro cancelamento real do fluxo novo **e** a primeira execução desta versão do workflow. Uma cobrança só, escolhida por você, com conferência no banco antes de qualquer segunda execução.

Roteiro, na ordem:
1. Passo 1 numa cobrança da **empresa 1 ou 3** (fluxo legado, menor risco): título cancelado, cobrança segue `A_VENCER`+confirmada, `boleto_enviadoo=false`, reaparece no Registro de Recebíveis. **Incluir um faturado legado sem `id_pagamento`** — é o caso que a Etapa 10 corrige.
2. Passo 1 numa cobrança da **empresa 2** (**A3** — aciona o Inter): idem. `cobrancaReativada` deve vir **`false`**, porque não há cascata; se vier `true`, a cascata voltou no workflow e o resultado precisa ser reconferido antes de seguir. Conferir o estado **relendo `pagamentos_v2`**, nunca pelo retorno do webhook.
3. Passo 3 na mesma cobrança (**A4**): cobrança `CANCELADO`, proposta em `NOVO` com `tipo_cobranca = null`, modal de gerar abre pelo saldo.
4. Recusas: conferir uma de cada `code` alcançável com dados reais.

**Valida:** os 13 critérios de aceite da §14 da spec, um a um, com evidência.

---

## 5. Onde o n8n pode sobrescrever o resultado

Quatro pontos, agora **medidos** na Etapa 0 e não mais presumidos.

| # | Webhook / workflow | Situação verificada em 25/08/2026 | Defesa |
|---|---|---|---|
| 1 | **`cancela-boleto-fat-inter`** → `VIBE-BOLETO-FATURADO-INTER` (empresa 2, passo 1) | **Não escreve em `pagamentos_v2`.** A cascata não existe. Mas o retorno **mente**: `pagamento_cancelado` vem `true` sem escrita, e `parcelas_ativas_restantes` é contado por `id_int` | Decidir **sempre** por releitura do banco, nunca pelo retorno (Etapa 6, item 3). Reativação mantida como defesa idempotente caso a cascata volte |
| 2 | **`del-boleto-vibe`** (empresas 1 e 3, legado, chamado pelo **navegador**) | **Confirmado: não toca banco nenhum**, só chama o C6. Não exclui nem cancela a linha de `boletos` — quem faz isso é o ERP | Nada muda. O caminho legado segue fora de escopo |
| 3 | **`cancela-boleto-inter-biro`** (boleto comum da Birô, via `cancelar-externo`) | **Escreve sim**: `pagamentos_v2.status='CANCELADO'`, casando por `cod_solicitacao_inter`, **antes** do respond. Nunca grava `motivo_cancela`. `del-boleto-av-vibe` **não escreve** | Duplicação benigna hoje — `cancelar-externo` grava o mesmo status depois, e o `motivo_cancela` do ERP sobrevive. Não introduzir dependência de ordem; conferir por releitura |
| 4 | **Qualquer correção feita por API no n8n** | O fix do `VIBE-BOLETO-FATURADO-INTER` está **intacto** (45 nós, checklist do estado correto bate em todos os pontos). Última alteração 21/08/2026 22:33Z | Se o workflow precisar mudar (A6), a alteração é feita **na UI do n8n**, por você, e reconferida **imediatamente antes** de qualquer teste. Nunca por API |

**Regra operacional:** entre a conferência (Etapa 0) e o teste em produção (Etapa 13) pode haver dias. **A conferência se repete imediatamente antes da Etapa 13** — se o workflow tiver sido salvo pela UI nesse intervalo, tanto o fix pode ter sumido quanto a cascata pode ter voltado, e o teste mediria outra coisa. Checklist mínimo: 45 nós, `Update v2` desativado e órfão, e nenhum nó `pagamentos_v2` alcançável a partir do webhook `cancela-boleto-fat-inter`.

---

## 6. Publicação e reversão

**Publicação:** só com A5. Fluxo do AGENTS.md — `npx tsc --noEmit`, `npx eslint` nos arquivos alterados, `git add -A`, mensagem `tipo(modulo): descricao` em ASCII sem aspas duplas (here-string `@'...'@`), `git push origin erp-ideal-preview`.

Sugestão de corte, se você preferir publicar em duas partes:

- **Corte 1** (Etapas 1-8): servidor inteiro, com a UI ainda decidindo como hoje. Seguro: o veredito passa a valer nas rotas, e a tela continua conservadora. Nenhum comportamento novo chega ao usuário.
- **Corte 2** (Etapas 9-12): a UI passa a refletir o servidor. É aqui que o usuário vê a mudança.

**Reversão:** sempre `git revert` (novo commit), nunca reescrita de histórico. A Etapa 8 (rota apagada) é a única que um revert precisa restaurar — e ela não tem chamador, então reverter é inócuo.

---

## 7. Fora deste plano

- Trazer o webhook legado das empresas 1 e 3 para o servidor — rodada própria.
- Corrigir o ramo `todas canceladas → propostas.status_interno = 'CANCELADO'` — migration, rodada própria (§10.1 da spec).

---

## 8. Questões em aberto

Nenhuma. A última — onde vive a ação de cancelar título — foi decidida em 25/08/2026: **somente em Contas a Receber**, reusando "Cancelar recebível"; o Registro de Recebíveis não ganha ação e seu filtro não muda. A decisão anterior, de colocar a ação nas duas telas, está revogada e refletida na decisão 14 da spec e na Etapa 10 deste plano.

O plano está pronto para execução, começando pela **Etapa 0** (autorização A1 — conferência do workflow no n8n).
