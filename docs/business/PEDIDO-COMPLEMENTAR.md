# PEDIDO-COMPLEMENTAR.md

Versão: 1.0
Status: Regra aprovada — **em implementação** (E0 a E4 concluídas; E5 a E10 pendentes)
Última atualização: 13/09/2026
Projeto: Vibe

---

# Pedido Complementar

> **Este documento descreve a REGRA APROVADA, não o que já está no ar.** Em
> 13/09/2026 existem no banco a coluna `propostas.id_int_pedido_principal` e a
> tabela `complementos_frete` (E1), e a função `criar_pedido_complementar`
> (E2), que cria só o **cabeçalho** do complemento. Na lista de Orçamentos
> existem o item "Criar pedido complementar", o modal de confirmação e o selo
> "Compl. de #X" na linha do complemento (E3). O formulário e o detalhe mostram
> o vínculo nos dois lados, o complemento abre com endereço, contato, pagador,
> modalidade e transportadora travados, a tela não cota frete para ele e o
> salvamento não toca `cotacao_frete` nem as colunas herdadas (E4). Não há
> frete complementar — o complemento fica com frete zero até a E6 — nem nada
> na Expedição. O item do menu só
> aparece para quem tem a chave `propostas.complementar` ou o coringa `*`, e
> nenhum perfil tem a chave ainda (isso é da E10): hoje só o Super
> Administrador o vê. A função do banco também aceita usuários com
> `usuarios.is_admin = true` (seção 12). O ledger continua vazio. A seção 16
> diz o que já foi entregue, etapa por etapa. Qualquer afirmação aqui sobre
> comportamento do sistema além disso é o comportamento **que será
> implementado**.
>
> Plano de implementação: [`docs/superpowers/plans/2026-09-13-pedido-complementar.md`](../superpowers/plans/2026-09-13-pedido-complementar.md).

---

# 1. O Que É

Um **pedido complementar** é uma proposta nova, criada a partir de um pedido
original **já pago e ainda não expedido**, para unir dois pedidos **do mesmo
evento** numa entrega só.

- Nasce como cópia do **cabeçalho** do original — cliente, endereço de entrega,
  contato, pagador, modalidade e transportadora —, porém **sem nenhum item**.
- O vendedor inclui os itens novos no complemento, que segue o fluxo de uma
  proposta comum: orçamento, arte, cobrança, produção.
- O **frete é o núcleo**: o complemento aproveita o peso do original e cobra
  **só a diferença** que falta para levar os dois juntos.
- A **Expedição** sabe que aquele despacho tem um complemento, e os dois saem
  numa caixa só.

Começa pelo menu de ações da lista de propostas.

---

# 2. Por Que Existe

Hoje, quando o cliente pede itens a mais num pedido já pago do mesmo evento, o
único caminho é **editar o pedido original pago** (`/api/orcamentos/editar-paga`).
Esse contorno tem limitações que motivaram o recurso:

1. Os itens novos entram na mesma proposta. Depois, não há como distinguir o
   que foi vendido na primeira rodada e o que foi acrescentado —
   `produtos_proposta` só tem `status_item`.
2. A diferença devedora é silenciosa: sem modal, sem pendência (regra de
   22/07/2026 em `src/features/cobrancas/services/diferenca-financeira-proposta.ts`),
   e vira uma "cobrança complementar", que é **uma nova linha em `pagamentos_v2`
   no mesmo `id_int`** — não um pedido novo.
3. O frete não acompanha o peso novo. Depois de `AGUARDANDO` a modalidade e a
   transportadora ficam congeladas (`src/features/orcamentos/lib/modalidade-frete.ts`),
   e o guarda de frete desatualizado só bloqueia a cobrança; não recalcula.
4. `editar-paga` não verifica se o pedido já foi expedido.
5. A Expedição não sabe que dois pedidos vão na mesma caixa:
   `expedicoes.id_int` é único, um pedido = um card, e o painel não agrupa por
   cliente, endereço nem evento.

Em 13/09/2026, "pedido complementar", "juntar pedidos" e "mesmo evento" tinham
**zero ocorrências** no código e na documentação. O conceito nasce aqui.

---

# 3. Decisões do Dono

| # | Decisão | Data |
|---|---|---|
| 1 | O vínculo é uma **coluna nova** em `propostas` (`id_int_pedido_principal`). Não se reaproveita a cópia de proposta. | 13/09/2026 |
| 2 | Se o frete do peso somado ficar **menor** que o já cobrado no original, o complemento cobra **R$ 0,00** e a diferença negativa fica só registrada. Nenhuma escrita no original, **nenhum crédito automático**. | 13/09/2026 |
| 3 | Se o original chegar em `EXPEDICAO` com o complemento ainda não pronto, **o despacho do original é recusado**, com um override explícito: **"Desvincular e despachar separado"**. | 13/09/2026 |
| 4 | Permissão **nova**: `propostas.complementar`. | 13/09/2026 |
| 5 | O **despacho conjunto exige o complemento pago**, com checagem explícita. Complemento sem pagamento integral é tratado como não pronto. | 13/09/2026 |
| 6 | **Um complemento aberto por original**, por enquanto. | 13/09/2026 |
| 7 | Fiscal — uma caixa saindo com duas NF-e: **PENDENTE**, decisão com a contabilidade (seção 13). | 13/09/2026 |
| 8 | **Arte**: o complemento passa por arte como qualquer proposta. **Não herda** modelos nem artes aprovadas do original. | 13/09/2026 |
| 9 | **Serviço de frete do complemento: livre**, com destaque "Mesmo serviço do #X". | 13/09/2026 |
| 10 | Perfis que recebem `propostas.complementar`: **Administrador** e **Vendedor**. | 13/09/2026 |
| 11 | Cancelar o complemento: aceita também quem tem **`propostas.cancel`**. | 13/09/2026 |
| 12 | **Peso do original**: segue a precedência já existente de `src/features/expedicao/lib/peso.ts`. | 13/09/2026 |

---

# 4. Quando Pode Ser Criado

Todas as condições abaixo, verificadas **no banco**, no ato da criação. A tela
só esconde o botão; quem recusa é o servidor.

| # | Condição | Recusa com |
|---|---|---|
| 1 | Usuário tem `propostas.complementar` | permissão |
| 2 | A proposta original existe | `COMPL_ORIGEM` |
| 3 | O original **não é avulso** | `COMPL_AVULSA` |
| 4 | O original **não é ele mesmo um complemento** (cadeia de um nível só) | `COMPL_ENCADEADO` |
| 5 | O original está **pago integralmente** | `COMPL_NAO_PAGA` |
| 6 | O original **não foi expedido** (regra composta abaixo) | `COMPL_STATUS` ou `COMPL_EXPEDIDA` |
| 7 | O original **não tem outro complemento aberto** (não cancelado) | `COMPL_JA_EXISTE` |

## 4.1 "Pago integralmente"

Mesma regra que o sistema já usa para liberar um pedido:

- valor pago = soma das cobranças de `pagamentos_v2` com `status = 'PAID'`, ou
  `status = 'A_VENCER'` com `confirmado = true`, descontando o marcador
  `[ABATIMENTO_DEBITO:x]` de `obs_v2`. É o que `cc__valor_pago(id_int)` calcula
  no banco.
- pago integralmente = `valor_total > 0` **e** valor pago ≥ `valor_total`, em
  centavos. Um centavo devido **não** conta como pago (mesmo critério da engine
  de status, `status-engine.service.ts`).

## 4.2 "Não expedido" — regra composta

Não existe uma coluna única que responda "o pedido já saiu". Duas coisas
precisam valer ao mesmo tempo:

1. `status_interno` entre a liberação e a Expedição: `LIBERADO`,
   `LIBERADO / EM ARTE`, `REVISAO ATENDENTE`, `REVISAO PRODUCAO`, `EM PRODUCAO`,
   `EM IMPRESSAO`, `EM IMPRESSAO / PENDENTE`, `EM ACABAMENTO`,
   `EM ACABAMENTO / PENDENTE`, `EXPEDICAO`;
2. **e** não existe despacho registrado: nenhuma linha em `expedicoes` com
   `data_despacho` preenchida para o pedido.

Por que as duas: `status_interno` sozinho não basta, porque pedido de
TRANSPORTADORA ou MOTOBOY já despachado continua em `EXPEDICAO`, aguardando
coleta (`expedicao-acoes.service.ts`). E `data_despacho` é o marcador oficial
de despacho (`src/features/expedicao/types.ts`).

Medido em 13/09/2026: das 3.652 propostas pagas criadas desde junho, 3.569 não
estavam expedidas; nenhuma saiu sem `data_despacho`.

---

# 5. O Que o Complemento Herda — e o Que Não

## 5.1 Herda do original

`cliente`, `id_cliente`, `cnpjCpf`, `proposta`, `prop_reduz`, `id_conversa`,
`empresa`, `vendedor`, `id_vendedor`, **`contato`, `id_contato`,
`id_endereco_ent`, `cep`, `id_faturado`** (pagador), **`modalidade_frete`,
`id_transportadora_cliente`, `transporte_categoria`, `categoria_frete`**,
`frete_escolhido`, `tipo_cob_edeal`, `tipo_boleto_edeal`, `tem_veppo`,
`obs_proposta`.

Endereço, contato, pagador, modalidade e transportadora ficam **travados** no
complemento: os dois pedidos vão para o mesmo lugar, pelo mesmo transporte.

## 5.2 Nasce com

| Campo | Valor |
|---|---|
| `status_interno` | `NOVO` |
| `valor`, `valor_frete`, `valor_total` | `0` |
| `is_prd_aprovado` | `false` |
| `is_copia` | `false` — **não é uma cópia** |
| `id_int_origem_copia` | nulo |
| `id_int_pedido_principal` | o `id_int` do original |
| `is_avulso` | `false` |
| `obs_tecnica` | nula — instrução técnica depende dos itens |

## 5.3 Não herda

Itens (`produtos_proposta`), variações, desconto (`desconto_proposta`), cotação
de frete (`cotacao_frete`), **modelos (`pedidos_modelos`) e artes
(`pedidos_artes`)**, cobranças (`pagamentos_v2`), boletos, notas fiscais,
linha de expedição, OS/boletim, chat.

**Arte (decisão 8):** o complemento passa pelo fluxo de arte como qualquer
proposta. Arte aprovada no original não vale para o complemento.

## 5.4 Registro no chat

Na criação, uma mensagem de sistema em cada pedido:

- no original: *"Pedido complementar #Y criado a partir desta proposta (mesmo
  evento). O complemento herda endereço, contato, pagador, modalidade e
  transportadora, e cobra só a diferença de frete do peso somado. Os dois saem
  juntos na Expedição."*
- no complemento: *"Pedido complementar da proposta #X. Endereço, contato,
  pagador, modalidade e transportadora herdados do principal e travados. Sem
  itens: inclua os produtos e depois cote o frete complementar na aba Fretes."*

---

# 6. Vínculo — Quem É o Dono da Verdade

| Informação | Onde mora | Quem escreve |
|---|---|---|
| "Y é complemento de X" | `propostas.id_int_pedido_principal` de Y | só as funções de criar e de desvincular |
| Com quanto o frete complementar foi calculado | `public.complementos_frete` (ledger) | só a função de aplicar frete |
| Que o vínculo foi desfeito, por quem e por quê | carimbo `desvinculado_*` no ledger + chat | só a função de desvincular |

- O vínculo é de **um nível**: complemento não tem complemento.
- É **1 → N no modelo**, mas a regra atual permite **um aberto por vez**
  (decisão 6).
- **Não se confunde com a cópia de proposta.** "Duplicar proposta"
  (`copiar_proposta_v2`) grava `is_copia` e `id_int_origem_copia` e faz o
  contrário do complemento: zera endereço, contato e pagador, e copia itens e
  valores.

O ledger é **append-only**. Cada aplicação de frete gera uma linha com chave de
idempotência; recotar gera linha nova. A linha **vigente** é a mais recente
daquele complemento.

---

# 7. Frete Complementar

## 7.1 A conta

1. **Peso do original** — precedência de `lib/peso.ts` (decisão 12): peso
   **aferido** no despacho > peso **bruto da Revisão** > peso **cotado** >
   peso **teórico** (soma dos itens).
2. **Peso do complemento** — soma de `produtos_proposta.peso_total` dos itens
   não cancelados do complemento.
3. **Peso somado** = original + complemento.
4. **Frete cotado** — cotação do peso somado, no **endereço do original**, com
   as mesmas cotadoras do sistema (SEDEX, Azul Cargo, transportadoras, VEPPO).
   O valor declarado para seguro é a soma dos subtotais de itens dos dois
   pedidos.
5. **Já cobrado no original** = `propostas.valor_frete` do original — o que a
   proposta **cobra**, não o que foi cotado.
6. **Diferença** = frete cotado − já cobrado no original.
7. **A cobrar no complemento** = o maior entre a diferença e zero.

**Exemplo ilustrativo** (valores de frete fictícios):

| | |
|---|---|
| Peso do original | 4,5 kg |
| Peso do complemento | 1,0 kg |
| Peso somado cotado | 5,5 kg |
| Frete cotado para 5,5 kg | R$ 92,00 |
| Já cobrado no original (4,5 kg) | R$ 78,00 |
| Diferença | R$ 14,00 |
| **A cobrar no complemento** | **R$ 14,00** |

## 7.2 Frete somado menor que o já cobrado (decisão 2)

Pode acontecer quando o peso somado cai numa faixa mais barata ou o serviço
escolhido é outro. Nesse caso:

- o complemento cobra **R$ 0,00** de frete;
- a diferença **negativa** fica registrada no ledger;
- **nada** é escrito no original e **nenhum crédito** é gerado para o cliente;
- o chat do complemento diz que a diferença negativa foi registrada e nada foi
  creditado.

## 7.3 Serviço de frete (decisão 9)

O vendedor escolhe **qualquer** opção cotada. A opção com o mesmo serviço do
original aparece destacada como **"Mesmo serviço do #X"**.

## 7.4 A regra que não pode ser quebrada: o original não é tocado

**Nada do frete do original muda.** Não se escreve em `cotacao_frete` do
original, não se recota o original, não se altera `valor_frete` nem
`valor_total` do original.

O motivo é de banco. `cotacao_frete` tem três gatilhos, e qualquer INSERT,
UPDATE ou DELETE ali reescreve a proposta daquela linha:

| Gatilho | O que faz na proposta |
|---|---|
| `trg_recalc_after_frete` → `recalcular_proposta_v3` | reescreve `valor`, `volume`, `valor_total` |
| `trg_frete_sync_financeiro` → `atualizar_status_financeiro_proposta` | reescreve `status_interno` a partir das cobranças; `NOVO`, `AGUARDANDO`, `APROVADO` e `LIBERADO` **não** são protegidos |
| `tg_recalc_frete_v4` | nada (no-op) |

Tocar a cotação de um original `LIBERADO` o rebaixaria. Ver também
`EXPEDICAO.md` §2, "`cotacao_frete` é SOMENTE LEITURA para a Expedição".

## 7.5 Onde o frete complementar é gravado

Só no **complemento**:

- a linha escolhida de `cotacao_frete` do complemento recebe o serviço, o prazo,
  o CEP, **o valor a cobrar** e **o peso do próprio complemento** (não o
  somado);
- `propostas.valor_frete` do complemento recebe o valor a cobrar;
- o peso somado, o frete cotado total, o já cobrado no original e a diferença
  vão para o **ledger**.

Os gatilhos da tabela agem então só sobre o complemento — que é o
comportamento normal de qualquer orçamento: `valor_total` do complemento vira
subtotal dos itens − desconto + valor a cobrar, e o status sai das cobranças
**do próprio complemento**.

Por que o peso do complemento, e não o somado, na `cotacao_frete`: o guarda de
frete desatualizado (`frete-desatualizado.ts`) compara o peso da cotação com a
soma dos itens **do mesmo pedido**, com tolerância de 1 g. Com o peso somado
ali, a cobrança do complemento ficaria bloqueada para sempre.

## 7.6 Quando o frete complementar pode ser aplicado

- Complemento em **`NOVO` ou `AGUARDANDO`** — depois disso, a correção de frete
  é pelos fluxos que já existem (correção de frete e recotação da Expedição).
- Modalidade **CIF**. Em RETIRA e FOB não há frete a cobrar: o complemento
  herda a modalidade e sai junto, sem cotação.
- Original **ainda não expedido**.
- Itens do complemento **salvos** e sem mudança desde a cotação.
- Frete cobrado do original **sem mudança** desde a cotação.

---

# 8. Formulário do Complemento

- Selo no cabeçalho, ao lado do status: **"Complemento do #X"** (com link). No
  original: **"Complemento: #Y · status"**.
- **Travados**, com a nota "Herdado do pedido #X": endereço de entrega,
  contato, pagador, modalidade, transportadora e motoboy.
- A **cotação automática** de frete e o botão de cotar da aba Fretes ficam
  **desligados**.
- A aba **Fretes** mostra o card **"Frete complementar"**: peso do original
  (com a origem do peso), peso deste pedido, peso somado, frete cotado, já
  cobrado no original e **a cobrar aqui**; botão **"Cotar frete
  complementar"**; lista de opções com o destaque "Mesmo serviço do #X";
  **Aplicar** em cada opção.
- Sem itens salvos, o botão de cotar fica desabilitado: *"Salve os itens antes
  de cotar"*.
- Salvar o complemento **não regrava** a cotação de frete.

---

# 9. Guardas

| # | Situação | O que acontece |
|---|---|---|
| a | Trocar endereço ou modalidade do complemento | bloqueado na tela e recusado no servidor |
| b | **Cancelar o original** com complemento aberto | recusado — `COMPLEMENTO_ABERTO`. Cancele ou desvincule o complemento antes |
| c | **Despachar o original** com complemento **fora de `EXPEDICAO`** | recusado — `COMPLEMENTO_FORA_EXPEDICAO` — com o override "Desvincular e despachar separado" |
| d | **Cancelar o complemento** | cancela como proposta comum; o ledger recebe o carimbo de desvinculação; o original não muda. Aceita `propostas.complementar` **ou** `propostas.cancel` (decisão 11) |
| e | **Despachar o original** com complemento em `EXPEDICAO` **sem pagamento integral** | recusado — `COMPLEMENTO_NAO_PAGO` (decisão 5) — com o mesmo override |
| f | **Gerar cobrança do complemento** sem frete complementar aplicado | bloqueado — frete complementar pendente |
| g | **Gerar cobrança do complemento** com o frete invalidado por desvinculação | bloqueado — frete complementar invalidado; é preciso frete próprio |

## 9.1 "Desvincular e despachar separado"

Escolha explícita do expedidor, com **motivo obrigatório**:

- o vínculo do complemento é desfeito;
- o ledger recebe o carimbo `desvinculado_em`, `desvinculado_por`,
  `desvinculado_motivo`, com origem `EXPEDICAO`;
- os dois pedidos recebem mensagem no chat;
- o original despacha sozinho;
- o complemento passa a ser uma proposta comum e **passa a precisar de frete
  próprio**: o frete-diferença aplicado perde a validade, e a cobrança fica
  bloqueada até recotar.

A cotação do complemento **não é apagada** na desvinculação. Um DELETE em
`cotacao_frete` dispararia `trg_frete_sync_financeiro`, que rebaixaria um
complemento já `LIBERADO`. "Frete a recotar" é um estado **derivado** do
carimbo no ledger.

---

# 10. Expedição

## 10.1 Painel

- O card do original mostra **"+ compl. #Y"** — verde se o complemento está em
  `EXPEDICAO`, âmbar se ainda não.
- O card do complemento mostra **"Compl. de #X"**.
- Complemento em `NOVO` ou `AGUARDANDO` aparece no card do original mesmo fora
  do funil logístico.
- Filtro **vínculo**: todos, só complementos, só principais. A busca acha o par
  pelo número do outro.

## 10.2 Despacho conjunto

O despacho é feito **pelo original**. Despachar o complemento sozinho, com o
original ainda não despachado, é recusado: *"o despacho é feito pelo pedido
principal, e os dois saem juntos"*.

Ao despachar o original com complemento em `EXPEDICAO` e **pago
integralmente**:

- o original grava peso aferido, volumes e rastreio — **a caixa é uma só**;
- a linha de `expedicoes` do complemento recebe a **mesma `data_despacho`**,
  o mesmo transporte e endereço, e a observação *"Despachado junto com #X"* —
  **sem** peso, volumes, código de rastreio nem código de objeto dos Correios;
- os dois pedidos fazem a mesma transição de status (`A RETIRAR`,
  `EM TRANSITO` ou permanência em `EXPEDICAO` aguardando coleta, conforme o
  tipo de entrega);
- o rastreio do complemento aparece pelo espelho de `propostas_os`, então
  "Rastrear objeto" funciona no card do complemento;
- confirmação de coleta e marcação de entregue do original propagam para o
  complemento.

Por que o código de rastreio não é copiado para `expedicoes` do complemento: o
webhook dos Correios localiza o pedido pelo código do objeto com
`maybeSingle` (`src/app/api/correios/webhook/route.ts`). Duas linhas com o
mesmo código quebrariam o recebimento do evento.

## 10.3 Etiqueta, declaração e prepostagem

- **Etiqueta 10×15**: sai **pelo original** e imprime **"Pedido #X + #Y"**.
- **Declaração de conteúdo**: lista os itens dos dois pedidos.
- **Prepostagem dos Correios**: um objeto por caixa — só o do original.

---

# 11. Cenários

| Cenário | Comportamento |
|---|---|
| Original cancelado com complemento aberto | Recusado. Primeiro cancele ou desvincule o complemento |
| Complemento cancelado | Cancela como proposta comum; ledger carimbado; chat nos dois; o vínculo fica como histórico; o original segue livre |
| Original chega em `EXPEDICAO` antes do complemento | Despacho recusado. O expedidor espera, ou desvincula e despacha separado |
| Complemento nunca pago | Fica em `NOVO`/`AGUARDANDO`; aparece no card do original; quando o original chega em `EXPEDICAO`, o despacho recusa |
| Complemento em `EXPEDICAO` sem pagamento integral | Despacho do original recusado com `COMPLEMENTO_NAO_PAGO` |
| Complemento salvo sem itens | Permitido; cotação desabilitada; cobrança bloqueada por frete pendente |
| Frete somado menor que o já cobrado | Complemento cobra R$ 0,00; diferença negativa só no ledger; nada no original; nenhum crédito |
| Itens do complemento mudam depois do frete aplicado | O peso da cotação diverge da soma dos itens; a cobrança bloqueia até cotar de novo, o que gera nova linha no ledger |
| Original em RETIRA ou FOB | Complemento herda; sem frete a cobrar; sem cotação nem ledger |

---

# 12. Permissões

| Permissão | Para quê | Perfis |
|---|---|---|
| `propostas.complementar` | criar o complemento, cotar e aplicar o frete complementar, desvincular pela área comercial | Administrador, Vendedor (decisão 10). Super Administrador pelo coringa `*`. No banco, também qualquer usuário com `usuarios.is_admin = true` (ver abaixo) |
| `propostas.cancel` | também aceita para cancelar o complemento e carimbar o ledger (decisão 11) | os perfis que já a têm |
| `expedicao.processar` | despachar e "Desvincular e despachar separado" | os perfis que já a têm |

A permissão `propostas.complementar` é concedida aos perfis **só na última
etapa da implementação**, para que vendedores não criem complemento antes de o
fluxo estar inteiro.

Até lá, a permissão **não fica sem dono**. O Super Administrador passa pelo
coringa `*`. A função do banco confere a permissão por `cc__assert_permissao`,
que aprova também qualquer usuário com `usuarios.is_admin = true`, mesmo que o
perfil dele não tenha a chave. Em 13/09/2026 são 2 usuários do perfil
Administrador nessa situação. Eles conseguem criar complemento chamando a
função, mas não veem o item no menu, porque a tela confere só a chave e o
coringa. O dono aceitou esse comportamento em 13/09/2026: `cc__assert_permissao`
é compartilhada por todo o sistema e não muda.

---

# 13. Pendências Abertas

| Pendência | Situação |
|---|---|
| **Fiscal — uma caixa com duas NF-e** (decisão 7) | **PENDENTE, decisão com a contabilidade.** Cada proposta emite a sua nota; no despacho conjunto a caixa sai com duas NF-e e a etiqueta imprime a do original. Nada será implementado sobre isso até a decisão. Não bloqueia nenhuma etapa |

---

# 14. Limitações Conhecidas

1. **Pedido que voltou de etapa depois de despachado (caso #21594).** Os
   carimbos de `expedicoes` são foto do último acontecimento, não histórico
   (`src/features/expedicao/lib/carimbo-etapa.ts`). Pedido que foi despachado e
   voltou para acabamento continua com `data_despacho` preenchida, e a regra
   composta o trata como expedido: **não aceita complemento**. Medido em
   13/09/2026: 4 casos na base.
2. **Duas NF-e numa caixa** — ver seção 13.
3. **"Voltar status" do original não desfaz o despacho do complemento.** Se o
   expedidor voltar o original para uma etapa anterior depois do despacho
   conjunto, o complemento permanece despachado e precisa ser tratado à mão.
4. **Escrita direta na coluna de vínculo.** A política RLS de `propostas` é
   permissiva, então uma sessão autenticada consegue gravar
   `id_int_pedido_principal` por PostgREST, como qualquer outra coluna da
   tabela. O sistema só escreve por função do banco, e a auditoria
   (`trg_audit_propostas`) registra quem tocou.
5. **Abatimento de débito no original.** `cc__valor_pago` desconta o marcador
   `[ABATIMENTO_DEBITO:x]`. Original com abatimento pode ser recusado como "não
   pago integralmente"; a mensagem de recusa mostra o valor pago e o total.

---

# 15. O Que Não Fazer

- Não usar "Duplicar proposta" (`copiar_proposta_v2`, `is_copia`,
  `id_int_origem_copia`) como base do complemento.
- Não escrever em `cotacao_frete` do original, nem "só o peso".
- Não recotar o original.
- Não apagar `cotacao_frete` do complemento ao desvincular.
- Não copiar código de rastreio ou de objeto dos Correios para `expedicoes` do
  complemento.
- Não usar a edição do original pago como contorno para o mesmo evento.
- Não criar uma entidade genérica de "remessa" ou "carga" nesta versão: o
  vínculo por coluna resolve o caso, e o painel e o despacho já são por pedido.

---

# 16. Estado da Implementação

| Etapa | Entrega | Situação |
|---|---|---|
| E0 | Este documento de regra | **Concluída em 13/09/2026** |
| E1 | Migration: coluna de vínculo + ledger | **Concluída em 13/09/2026** — `supabase/migrations/20260914_pedido_complementar_vinculo_e_ledger.sql`, aplicada em produção (versão `20260913204321`) |
| E2 | Função de criar o complemento | **Concluída em 13/09/2026** — `supabase/migrations/20260914_criar_pedido_complementar.sql`, aplicada em produção (versão `20260913211243`). Validada com o par de teste #22067 (principal, pago por E-Amostra) e #22068 (complemento, cancelado ao final) |
| E3 | Serviço, item no menu de ações e modal | **Concluída em 13/09/2026** — item "Criar pedido complementar" na lista de Orçamentos, `CriarComplementoModal`, selo "Compl. de #X" e a chave no catálogo de permissões. Validada com o complemento #22069 da #22067, criado pelo menu |
| E4 | Leitura do vínculo, selos, travas e salvamento neutro | **Concluída em 13/09/2026** — selos "Complemento do #X" e "Complemento: #Y" no formulário e no detalhe, travas de endereço, contato, pagador e modalidade, cotação desligada e salvamento sem `cotacao_frete` no complemento. Validada com a #22069; proposta comum sem mudança |
| E5 | Rota de cotar frete complementar | Pendente |
| E6 | Rota e função de aplicar frete + card no formulário | Pendente |
| E7 | Guardas de cancelamento e de cobrança | Pendente |
| E8 | Expedição: vínculo no painel, bloqueio de despacho e desvinculação | Pendente |
| E9 | Despacho conjunto, etiqueta e declaração | Pendente |
| E10 | Documentação final e concessão da permissão | Pendente |

---

# 17. Referências

- Plano: [`docs/superpowers/plans/2026-09-13-pedido-complementar.md`](../superpowers/plans/2026-09-13-pedido-complementar.md)
- [`EXPEDICAO.md`](./EXPEDICAO.md) — funil logístico, despacho, `cotacao_frete` somente leitura (§2)
- [`FLUXO-OFICIAL-STATUS-PROPOSTAS.md`](./FLUXO-OFICIAL-STATUS-PROPOSTAS.md) — vocabulário de status e fonte financeira (§7)
- [`CONTA-CORRENTE-CREDITO.md`](./CONTA-CORRENTE-CREDITO.md) — edição de proposta paga e diferença financeira (§1.3)
- [`CHECKOUT-PAGAMENTOS.md`](./CHECKOUT-PAGAMENTOS.md) — cobranças e status de pagamento
- [`../technical/PERFIS-PERMISSOES.md`](../technical/PERFIS-PERMISSOES.md) — catálogo de permissões
