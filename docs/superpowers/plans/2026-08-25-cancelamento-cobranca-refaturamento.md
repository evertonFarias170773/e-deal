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
| **A1** | **Conferir o workflow `VIBE-BOLETO-FATURADO-INTER` no n8n** (leitura da UI do n8n — só você tem acesso) | É a premissa da Etapa 6 inteira. E: correções feitas por API naquele workflow já foram sobrescritas duas vezes por save/reimport na UI | Antes da Etapa 0 |
| **A2** | **Apagar `src/app/api/cobrancas/cancelar-boleto/route.ts`** | Remoção de rota, ainda que órfã | Etapa 8 |
| **A3** | **Primeiro cancelamento de título REAL na empresa 2 (Birô), em produção** | Aciona o Banco Inter de verdade. Irreversível: o título sai do banco e a linha de `boletos` é excluída pelo n8n | Etapa 13 |
| **A4** | **Primeiro cancelamento de cobrança REAL (passo 3), em produção** | Muda `pagamentos_v2` e rebaixa a proposta para `NOVO`. Reversível só na mão | Etapa 13 |
| **A5** | **Publicar** (`git add -A` + `git push origin erp-ideal-preview` → deploy Vercel) | Deploy automático de produção | Ao fim, ou nos cortes que você escolher |
| **A6** | **Alterar o workflow no n8n**, se A1 mostrar que é necessário | Fora do repo, e sujeito a ser sobrescrito | Só se A1 apontar |

**Não peço autorização para:** ler o banco (read-only), escrever código local, rodar `tsc`/`eslint`. Nada disso toca produção.

---

## 3. Etapa 0 — Conferência do workflow n8n (**antes de qualquer código**)

**Autorização A1.** Nada nesta rodada começa antes disto, porque a Etapa 6 assume um comportamento específico do workflow.

**O que precisa ser respondido, olhando o `VIBE-BOLETO-FATURADO-INTER` no n8n:**

1. Ele escreve em `pagamentos_v2` (`status`, `motivo_cancela`)? Sob qual condição — "não resta parcela ativa"?
2. Essa escrita acontece **antes** de o workflow responder o HTTP, ou depois? *(A releitura da Etapa 6 só enxerga a cascata se for antes.)*
3. Ele exclui a linha de `boletos` sempre, ou só quando o Inter confirma?
4. Existe retry, fila ou nó assíncrono que possa escrever **depois** da nossa reativação?
5. O fix histórico do `VIBE-BOLETO-FATURADO-INTER` ainda está lá, ou foi sobrescrito de novo por save/reimport?

**Evidência que já temos** (não substitui a conferência, mas indica o esperado): `docs/business/CHECKOUT-PAGAMENTOS.md:394-410` documenta a cascata e a defesa por releitura, e essa defesa **está em produção hoje** em `excluirTitulosDoFaturado`. Ou seja, a resposta esperada para (2) é "antes de responder" — mas é exatamente isso que precisa ser confirmado, não assumido.

**Valida antes de seguir:** as cinco respostas por escrito, coladas nesta seção do plano. Se (4) for "sim, existe caminho assíncrono", a Etapa 6 muda de desenho (precisaria de reconciliação posterior, não de releitura imediata) e eu volto para você antes de codar.

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

### Etapa 6 — `cancelar-boleto-faturado`: veredito + invariante do passo 1
**Aplicação.** A etapa mais delicada. Duas mudanças:

1. **Veredito antes da delegação.** Hoje a rota devolve `delegarLegado: true` no primeiro `if` após reler o título, sem checar nada. O veredito passa a ser consultado **antes** desse retorno, para valer nas três empresas.
2. **Reativação pós-cascata (empresa 2).** Depois de o n8n confirmar: reler `pagamentos_v2`; se voltou inativa, reabrir com `status='A_VENCER'`, `motivo_cancela=null`, `boleto_enviadoo=false`, `confirmado` preservado; devolver `cobrancaReativada`. Padrão já validado em `faturado-titulos.service.ts:129-160`.

Extrair `cancelarTituloNoBanco(...)` para os dois chamadores (o "Cancelar recebível" de Contas a Receber e o fluxo de salvar orçamento) usarem a mesma função.

**Depende de:** Etapa 0 respondida.

**Valida antes de seguir:** `tsc` + `eslint`. Empresas 1 e 3: conferir que `delegarLegado` continua saindo igual quando o veredito é `OK` — **não regredir o fluxo legado**, que está fora de escopo. Empresa 2: só em produção, na Etapa 13 (A3).

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

### Etapa 10 — UI: "Cancelar recebível" vira o passo 1
**Aplicação.** Só `ContasReceberPage`. **O Registro de Recebíveis não é tocado** — nem ação, nem filtro, nem `getRecebiveisParaRegistro` (decisão 14 revisada).

Nenhuma ação nova: o passo 1 é o **"Cancelar recebível"** já existente no menu Ações da Carteira, nos dois construtores de menu (linhas 2832 e 2943, ambos `canAdmin`). O que muda em `handleConfirmarCancelamento`:

1. **Corrigir o vínculo legado.** Hoje o `boleto_enviadoo = false` só acontece sob `if (item.is_faturado && item.id_pagamento)`, com `.eq("id_pagamento", …)`. Nos **266 títulos faturados sem `id_pagamento`** a condição é falsa e nada é gravado — a cobrança não volta ao Registro de Recebíveis e o passo 1 termina pela metade. **11 desses estão em aberto hoje** (7 `A_VENCER`, 4 `VENCIDO`) e falhariam em silêncio. Passa a usar o mesmo fallback de vínculo do dossiê (`id_int + is_faturado`), com a mesma recusa por ambiguidade.
2. **Consumir `cobrancaReativada`** da rota (Etapa 6) e não duplicar escrita: no caminho da empresa 2 quem reativa e grava `boleto_enviadoo = false` é a rota; no caminho legado (1 e 3) a tela segue gravando, como hoje.
3. **Mensagem de desfecho**: título cancelado, **cobrança mantida ativa**, de volta ao Registro de Recebíveis; e, com `cobrancaReativada`, que foi reativada após a cascata do Inter.

Cuidado de escopo: **não confundir com "Cancelar boleto"** (`onLifecycle.cancelarParaDeposito`), item vizinho do mesmo menu que transforma o boleto em depósito futuro. Outro fluxo, intocado.

**Valida antes de seguir:** `tsc` + `eslint`. Conferir em banco (read-only), num faturado legado **sem `id_pagamento`** e em aberto, que após o cancelamento a cobrança fica `A_VENCER` + `confirmado` + `boleto_enviadoo = false` e **volta a aparecer** na consulta do Registro de Recebíveis. Título liquidado continua desabilitado no menu (já é hoje) **e** recusado pela rota.

### Etapa 11 — `CancelPropostaModal`
**Aplicação.** Texto separado, botão "Cancelar só a cobrança", e a lista do que será cancelado junto.

**Valida antes de seguir:** `tsc` + `eslint`. Com uma cobrança ativa, o botão abre o modal de cobrança; com duas ou mais, leva para a aba Pagamentos.

### Etapa 12 — Documentação
**Aplicação.** Atualizar `docs/business/CANCELAMENTO-COBRANCAS.md` com o fluxo em três passos e a tabela de recusas; `docs/DOCUMENTATION_INDEX.md` se necessário.

**Valida antes de seguir:** o doc descreve o que o código faz — sem regra inventada, sem regra omitida.

### Etapa 13 — Validação fim a fim em produção
**Autorizações A3 e A4**, uma por vez, em cobranças que **você escolher**.

Roteiro, na ordem:
1. Passo 1 numa cobrança da **empresa 1 ou 3** (fluxo legado, menor risco): título cancelado, cobrança segue `A_VENCER`+confirmada, `boleto_enviadoo=false`, reaparece no Registro de Recebíveis.
2. Passo 1 numa cobrança da **empresa 2** (**A3** — aciona o Inter): idem, **mais** `cobrancaReativada = true`. Este é o teste que prova a invariante na Birô.
3. Passo 3 na mesma cobrança (**A4**): cobrança `CANCELADO`, proposta em `NOVO` com `tipo_cobranca = null`, modal de gerar abre pelo saldo.
4. Recusas: conferir uma de cada `code` alcançável com dados reais.

**Valida:** os 13 critérios de aceite da §14 da spec, um a um, com evidência.

---

## 5. Onde o n8n pode sobrescrever o resultado

Quatro pontos. Os três primeiros são de escrita concorrente; o quarto é de perda de configuração.

| # | Webhook / workflow | Risco | Defesa |
|---|---|---|---|
| 1 | **`cancela-boleto-fat-inter`** → `VIBE-BOLETO-FATURADO-INTER` (empresa 2, passo 1) | Marca `pagamentos_v2` como `CANCELADO` em cascata quando não resta parcela — **quebra a invariante da cobrança viva** em 18 dos 21 títulos faturados da empresa 2 | Releitura + reativação na Etapa 6. Só é correta se a Etapa 0 confirmar que a escrita do n8n acontece **antes** da resposta HTTP |
| 2 | **`del-boleto-vibe`** (empresas 1 e 3, legado, chamado pelo **navegador**) | Se escrever em `pagamentos_v2`, faria a mesma cascata sem que o servidor saiba | A documentação diz que o legado **não** exclui a linha nem cancela a cobrança (`faturado-titulos.service.ts`: "O caminho do Inter já exclui a linha; o legado e o depósito não"). **Confirmar na Etapa 0** — se escrever, a Etapa 6 precisa da mesma releitura no caminho legado |
| 3 | **`cancela-boleto-inter-biro`** e **`del-boleto-av-vibe`** (boleto comum, via `cancelar-externo`) | Escrita concorrente em `boletos`/`pagamentos_v2` depois do nosso cancelamento lógico | Conferir na Etapa 0 se algum deles escreve local. Hoje `cancelar-externo` assume que **não** e faz a escrita ele mesmo |
| 4 | **Qualquer correção feita por API no n8n** | Já aconteceu **duas vezes**: um fix aplicado por API no `VIBE-BOLETO-FATURADO-INTER` foi apagado por save/reimport na UI do n8n | Se A1 mostrar que o workflow precisa mudar (A6), a alteração é feita **na UI do n8n**, por você, e reconferida **imediatamente antes** de qualquer teste. Nunca por API. E a conferência se repete antes da Etapa 13 |

**Regra operacional:** entre a conferência (Etapa 0) e o teste em produção (Etapa 13) pode haver dias. **A conferência do item 4 se repete imediatamente antes da Etapa 13** — se o workflow tiver sido salvo pela UI nesse intervalo, o fix pode ter sumido de novo e o teste mediria outra coisa.

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
