# CHECKOUT-PAGAMENTOS.md

Versão: 2.0  
Status: Oficial  
Última atualização: 18/07/2026  
Projeto: Vibe

---

# Checkout, Cobranças e Pagamentos

Este documento define o fluxo oficial de criação, geração, acompanhamento e confirmação de cobranças no Vibe.

Seu objetivo é separar claramente as responsabilidades entre proposta, cobrança, boleto, pagamento, frontend, backend, n8n, Edge Functions e integrações externas.

---

# Escopo

Este documento descreve:

- a origem operacional das cobranças;
- a responsabilidade de `public.pagamentos_v2`;
- a responsabilidade de `public.boletos`;
- os fluxos por forma de pagamento;
- os status financeiros principais;
- a liberação financeira da proposta;
- a separação entre frontend e integrações;
- as regras gerais de segurança.

O cancelamento detalhado de cobranças é tratado em:

- `CANCELAMENTO-COBRANCAS.md`

---

# Princípios Fundamentais

## Proposta não é cobrança

A proposta representa o processo comercial.

A cobrança representa o processo financeiro originado a partir da proposta.

Uma proposta pode possuir uma ou mais cobranças.

---

## Boleto não é pagamento

`public.boletos` e `public.pagamentos_v2` possuem responsabilidades diferentes.

- `public.pagamentos_v2`: fonte principal da geração, conferência e acompanhamento das cobranças do ERP;
- `public.boletos`: fonte específica dos títulos bancários e da carteira de Contas a Receber.

Nunca substituir uma tabela pela outra.

---

## O frontend não gera instrumentos financeiros

O frontend ERP solicita a operação e apresenta o retorno.

A geração real de PIX, boleto ou checkout deve ocorrer no backend oficial, em Edge Function, rota de API, n8n ou integração homologada.

Credenciais e segredos nunca devem ser expostos no cliente.

---

# Origem de Toda Cobrança

Toda cobrança nasce de uma proposta identificada pela chave operacional:

```text
id_int
```

Regras:

- uma proposta pode gerar uma ou mais cobranças;
- todas as cobranças da mesma proposta compartilham o mesmo `id_int`;
- o cliente deve estar identificado por `id_cliente`;
- a empresa recebedora deve respeitar a empresa definida no fluxo da proposta;
- a criação ocorre prioritariamente na área de cobranças da própria proposta;
- o módulo de Cobranças funciona como fila de conferência financeira, não como fluxo comercial paralelo.

---

# Fontes Oficiais de Dados

## `public.pagamentos_v2`

Fonte principal para:

- cobranças;
- pagamentos;
- recebimentos;
- PIX;
- cartão;
- faturado;
- confirmação financeira;
- acompanhamento do status financeiro.

---

## `public.boletos`

Fonte específica para:

- títulos bancários;
- carteira de Contas a Receber;
- vencimentos;
- dias de atraso;
- multa;
- juros;
- identificação bancária do boleto.

---

# Tabela Principal: `public.pagamentos_v2`

## Campos Operacionais Relevantes

| Campo | Responsabilidade |
|---|---|
| `id` | Identificador interno da cobrança |
| `id_int` | Proposta de origem |
| `id_cliente` | Cliente vinculado |
| `id_empresa` | Empresa recebedora |
| `cliente` | Nome ou referência do cliente |
| `empresa` | Empresa recebedora |
| `valor` | Valor principal da cobrança |
| `status` | Status financeiro principal |
| `tipo_cobranca` | PIX, BOLETO, cartão, faturado ou outro tipo homologado |
| `created_at` | Data de criação |
| `paid_at` | Data de confirmação do pagamento |
| `vencimento` | Data de vencimento |
| `confirmado` | Confirmação manual ou operacional |
| `confirmado_por` | Usuário responsável pela confirmação |
| `data_confirmacao` | Data da confirmação |
| `descricao` | Descrição da cobrança |
| `documento` | CPF ou CNPJ do pagador |
| `atendente` | Vendedor ou responsável |
| `os_ideal` | Referência operacional do sistema legado durante a transição |
| `id_pagamento` | Referência externa ou sequencial |
| `token_publico` | Token da página pública |
| `url_cobranca` | URL pública da cobrança |
| `pix_copia_cola` | Código PIX retornado pela integração |
| `linha_digitavel` | Linha digitável do boleto |
| `url_pdf` | PDF do boleto ou documento associado |
| `erro_pagamento` | Erro retornado pela integração |
| `is_parcial` | Indica recebimento parcial |
| `saldo_pendente` | Saldo restante |
| `valor_frete` | Frete incluído na cobrança |
| `forma_pgto` | Condição de pagamento selecionada |

## Campos de Cartão

| Campo | Responsabilidade |
|---|---|
| `cartao_parcelas` | Quantidade de parcelas |
| `cartao_taxa_percentual` | Percentual da taxa |
| `cartao_valor_taxa` | Valor da taxa |
| `cartao_valor_final` | Valor final cobrado |
| `cartao_checkout_id` | Identificador do checkout |
| `cartao_checkout_url` | URL do checkout |
| `cartao_status` | Status específico do fluxo de cartão |

## Campos de Parcelamento ou Faturado

| Campo | Responsabilidade |
|---|---|
| `p_valor_entrada` | Valor da entrada |
| `p_qtd_parcelas` | Quantidade de parcelas programadas |
| `p_dias_pra_inicio` | Dias até o primeiro vencimento |
| `p_intervalo` | Intervalo entre parcelas |

---

# Estado Atual das Integrações

A disponibilidade de cada fluxo deve ser confirmada na implementação e na Matriz de Segurança antes de qualquer alteração.

| Fluxo | Estado documentado |
|---|---|
| PIX real | Disponível somente quando a integração e o backend financeiro oficial estiverem ativos para a empresa selecionada; confirmar o escopo atual no código |
| Boleto bancário | Possui integração externa e regras específicas de sincronização e cancelamento |
| Faturado | Condição persistida em `pagamentos_v2.forma_pgto` e registrada na timeline da proposta |
| Cartão | Depende da integração oficial disponível no fluxo atual |
| Cartão parcelado | Deve ser tratado como tipo de cobrança, não como status financeiro principal |

Não ampliar integrações para outras empresas ou provedores apenas por semelhança de fluxo.

---

# Fluxo Geral

```text
1. Proposta é criada.
2. Cliente aprova a condição comercial e informa a forma de pagamento.
3. Vendedor acessa a proposta.
4. Vendedor abre a área "Criar e ver cobranças".
5. Sistema valida proposta, cliente, empresa, valor e campos obrigatórios.
6. Sistema cria ou solicita a criação da cobrança em pagamentos_v2.
7. Backend oficial aciona a integração correspondente.
8. Retorno externo é persistido no fluxo oficial.
9. Cliente acessa a página pública ou checkout quando aplicável.
10. Webhook ou confirmação financeira atualiza pagamentos_v2.
11. O status financeiro da proposta é recalculado.
12. A entrada na Produção continua dependendo da liberação operacional manual.
```

---

# Experiência de Criação na Proposta

O modal de criação deve permanecer simples e operacional.

Deve permitir:

- conferir proposta;
- conferir cliente;
- conferir empresa recebedora;
- informar `os_ideal` quando exigido;
- informar valor;
- escolher a forma de pagamento;
- informar vencimento ou parcelas quando aplicável;
- informar observação;
- confirmar a geração.

Não deve expor:

- payloads de integração;
- credenciais;
- tokens secretos;
- configurações internas do provedor;
- detalhes técnicos desnecessários ao vendedor.

---

# Empresas Recebedoras

Empresas conhecidas do ERP:

- Ideal Gráfica;
- Ideal Birô;
- E3 Brindes.

Cada empresa pode possuir:

- conta bancária própria;
- credenciais próprias;
- configuração própria;
- fluxo n8n próprio;
- disponibilidade diferente por forma de pagamento.

A empresa recebedora deve ser herdada do contexto oficial da proposta.

Qualquer troca manual deve depender de fluxo administrativo e permissão específica.

---

# Fluxos por Forma de Pagamento

## PIX

Fluxo oficial:

1. Vendedor seleciona PIX na proposta.
2. Sistema valida empresa, cliente, documento e valor.
3. A cobrança é registrada em `public.pagamentos_v2`.
4. O backend oficial gera o PIX.
5. O retorno pode preencher:
   - `pix_copia_cola`;
   - `token_publico`;
   - `url_cobranca`;
   - referência externa.
6. O cliente realiza o pagamento.
7. Webhook ou confirmação oficial atualiza o registro para `PAID`.

A disponibilidade real depende da empresa, da integração ativa e do backend financeiro oficial. O escopo deve ser confirmado no código antes de qualquer alteração.

---

## Boleto

Fluxo oficial:

1. Vendedor seleciona boleto na proposta.
2. Sistema valida empresa, cliente, documento, valor e vencimento.
3. A cobrança principal é registrada em `public.pagamentos_v2`.
4. O backend oficial gera o boleto no provedor homologado.
5. O fluxo pode criar ou atualizar o registro correspondente em `public.boletos`.
6. O retorno pode preencher:
   - linha digitável;
   - código bancário;
   - PDF;
   - vencimento;
   - identificador externo.
7. Alterações e cancelamentos devem manter o ERP e o provedor externo sincronizados.

As regras detalhadas de cancelamento ficam em `CANCELAMENTO-COBRANCAS.md`.

---

## Cartão de Crédito

Fluxo esperado:

1. Vendedor seleciona cartão.
2. Sistema registra a cobrança em `public.pagamentos_v2`.
3. O backend oficial gera o checkout quando a integração estiver disponível.
4. O retorno pode preencher:
   - `cartao_checkout_id`;
   - `cartao_checkout_url`;
   - `cartao_status`.
5. O cliente conclui o pagamento fora do ERP.
6. O webhook atualiza o status financeiro.

Não considerar a integração ativa sem confirmação no código e na Matriz de Segurança.

---

## Cartão Parcelado

`CARD_PARCELADO` representa um tipo ou etapa do fluxo de cartão.

Não é status financeiro principal.

O fluxo pode envolver:

- número de parcelas;
- taxa percentual;
- valor da taxa;
- valor final;
- checkout externo;
- atualização por webhook.

O cálculo definitivo deve ocorrer no backend oficial ou integração homologada.

---

## Faturado

Fluxo oficial:

1. Cliente solicita pagamento a prazo.
2. Sistema consulta as regras de crédito e autorização.
3. Se aprovado:
   - `status = A_VENCER`;
   - `confirmado = true`;
   - a condição é persistida em `forma_pgto`;
   - a decisão é registrada na timeline da proposta.
4. Se depender de análise:
   - permanece sem confirmação financeira;
   - deve gerar encaminhamento ao Financeiro;
   - pode gerar registro no Chat Interno ou pendência operacional.

A aprovação de faturado não representa pagamento recebido.

Ela representa recebimento futuro autorizado.

### Alteração da proposta com faturado a vencer

Porque o valor ainda não entrou, a proposta continua alterável enquanto o
faturado estiver em `A_VENCER` e não liquidado — inclusive depois de
confirmado, que é conferência e não recebimento. Vale trocar frete, incluir e
excluir produto; o `valor` da cobrança acompanha o novo total e, como o
faturamento é lido de `pagamentos_v2`, o mês fecha certo sozinho.

Quem pode: perfil com `propostas.editar_faturado` (concedida ao Financeiro em
13/08/2026) ou com `propostas.editar_paga`. Regras em
`src/features/orcamentos/services/faturado-editavel.ts`, aplicadas na tela e
revalidadas em `POST /api/orcamentos/editar-paga` antes de gravar.

Vale inclusive para **proposta avulsa**, desde 13/08/2026. A trava "avulsa já
paga não pode ser alterada" (caso #19486) protege contra dois danos que só
existem com dinheiro recebido — crédito de Conta Corrente a favor do cliente
sobre valor que entrou no caixa, e proposta quitada voltando para `AGUARDANDO`.
Os dois já estão desligados neste caminho. Avulsa faturada é caso corrente:
acrescentar item, mudar o frete, renegociar depois de pronto. A avulsa **paga
de verdade** continua bloqueada, e sem precisar de regra extra: PIX, cartão e
boleto liquidado nunca satisfazem `isFaturadoAjustavel`, então o bloqueio
antigo volta sozinho.

Consequências, sempre confirmadas em modal antes de salvar:

- os títulos daquela cobrança saem do Contas a Receber, e boleto registrado é
  cancelado no banco pelo caminho de sempre (`deleteBoletoFromBankViaN8n`);
- `boleto_enviadoo` volta a `false`, então a cobrança reaparece em Registros de
  Recebíveis para ser registrada de novo com o valor novo;
- a alteração é registrada na timeline da proposta.

### Cancelamento em cascata da cobrança (parcela única)

O workflow `VIBE-BOLETO-FATURADO-INTER` marca `pagamentos_v2` inteiro como
`CANCELADO` quando não resta parcela ativa. Num faturado de parcela única —
a maioria — excluir o título mata a cobrança junto, o que não é o que este
fluxo quer.

Duas defesas, porque o desfecho silencioso seria grave (proposta com valor
novo, cobrança com valor velho, receita fora do faturamento e sem histórico):

1. `excluirTitulosDoFaturado` relê a cobrança depois da exclusão e, se ela
   tiver sido cancelada em cascata, reabre como `A_VENCER` com
   `motivo_cancela` limpo, avisando na tela. Não conseguindo reabrir, o save
   é abortado.
2. A tela envia `faturadoEsperadoId` no corpo de `editar-paga`. Se aquela
   cobrança não estiver mais ativa quando a rota reler o banco, a resposta é
   `409 FATURADO_SUMIU` e **nada é gravado** — falhar alto em vez de gravar
   torto.

Pela mesma razão, falha ao ler os títulos nunca é tratada como "não há
títulos": enquanto a leitura não confirmar, o caminho do faturado fica
fechado.

Fora deste fluxo, a proposta **volta ao comportamento de sempre** — quem tem
`propostas.editar_paga` continua editando pela Conta Corrente. Não é um
bloqueio novo; é só a ausência do atalho. Para quem só tem
`propostas.editar_faturado`, a tela e a rota mostram o motivo:

| Situação | Código |
|---|---|
| Título já quitado (`PAID` ou com `paid_at`) | `TITULO_QUITADO` |
| Faturado liquidado | `FATURADO_LIQUIDADO` |
| Mais de um faturado ativo na proposta | `MAIS_DE_UM_FATURADO` |
| Proposta com mais de uma cobrança e título sem `id_pagamento` | `TITULO_AMBIGUO` — apagar título de outra cobrança seria destruir recebível alheio |
| Novo total não cobre as demais cobranças | `VALOR_NAO_CABE` |

> **Título quitado é o caso mais comum, não a exceção.** Em 13/08/2026, 181 das
> 247 propostas com faturado a vencer já tinham título `PAID` no Contas a
> Receber — o dinheiro entrou, mas `pagamentos_v2` continuou em `A_VENCER`,
> porque a liquidação do título não promove a cobrança. Por isso o título é a
> fonte da verdade sobre recebimento neste fluxo, e não o status da cobrança.

Numa proposta mista (ex.: PIX pago + faturado a vencer) o faturado absorve toda
a diferença e a parte já recebida não é tocada. A Conta Corrente **não** é
acionada neste caminho: não há dinheiro recebido para creditar ou cobrar.

---

# Status Financeiros Principais

| Status | Significado |
|---|---|
| `A_RECEBER` | Cobrança criada, ainda pendente |
| `A_VENCER` | Recebimento futuro aprovado |
| `PAID` | Pagamento recebido ou confirmado |
| `CANCELADO` | Cobrança cancelada |

Status adicionais de integração não devem substituir os status financeiros oficiais sem regra documentada.

---

# Regras de Classificação Financeira

## Aprovado

Um pagamento é considerado financeiramente aprovado quando:

```text
status = PAID
```

ou:

```text
status = A_VENCER
AND confirmado = true
```

---

## Pendente

Uma cobrança permanece pendente quando:

- não está paga;
- não está cancelada;
- não possui confirmação válida;
- não possui `paid_at`.

---

## Cancelado

Cobranças com status cancelado, estornado ou recusado não devem participar dos cálculos de recebimento ativo.

A lista exata de status excluídos deve seguir o fluxo financeiro oficial.

---

# Liberação Financeira e Entrada na Produção

A aprovação financeira pode promover a proposta ao estado financeiro liberado.

Entretanto, a entrada oficial na lista de Produção/Pedidos não é automática.

Ela depende da flag operacional:

```text
public.propostas.is_prd_aprovado = true
```

Regras:

- a liberação para Produção é manual;
- deve ocorrer pela ação oficial da interface;
- deve validar pagamentos, artes e contexto operacional;
- `status_interno` não deve ser usado isoladamente como substituto dessa flag;
- pagamento aprovado não significa, sozinho, pedido já inserido na fila de Produção.

---

# Página Pública de Pagamento

A página pública pode ser acessada por `token_publico`.

Ela pode exibir, conforme a cobrança:

- identificação resumida;
- valor;
- vencimento;
- status;
- PIX;
- checkout;
- boleto;
- confirmação de pagamento.

A página pública nunca deve expor:

- credenciais;
- payloads internos;
- chaves privadas;
- informações administrativas;
- dados de outras cobranças.

---

# Responsabilidades

## Frontend ERP

Responsável por:

- coletar os dados operacionais;
- solicitar a geração;
- apresentar status e retorno;
- validar campos obrigatórios;
- aplicar permissões visuais;
- tratar erros de forma clara;
- atualizar a interface após confirmação real.

Não é responsável por:

- armazenar credenciais;
- gerar PIX diretamente;
- gerar boleto diretamente;
- criar checkout diretamente;
- decidir sozinho o resultado de um webhook.

---

## Backend, Edge Functions e Rotas de API

Responsáveis por:

- validar o payload;
- confirmar contexto e permissões;
- acionar integrações;
- persistir retornos;
- proteger credenciais;
- tratar erros;
- manter idempotência;
- sincronizar o estado local.

---

## n8n e Integrações Externas

Responsáveis apenas pelos fluxos oficialmente conectados.

Devem preservar:

- contratos;
- identificadores;
- rastreabilidade;
- respostas de erro;
- compatibilidade com o ERP.

### Encargos em `public.boletos` — obrigação de enviar zero explícito

Regra vigente desde 30/07/2026.

Todo processo que insere em `public.boletos` deve enviar **explicitamente**:

```text
multa = 0
juros_dia = 0
```

Multa e mora são opt-in: só devem vir preenchidas quando houver decisão comercial
registrada para aquele título. Nunca por omissão.

Motivo: as colunas tinham `DEFAULT 2` (multa %) e `DEFAULT 0.033` (mora %/dia).
Quem omitia os campos herdava os encargos. No vencimento, o job pg_cron
`atualizar-atraso-boletos` atualiza `status`/`dias_atraso` e, por tocar `status`,
dispara `tg_recalcular_encargos_boleto`, que materializa multa + mora em
`valor_atualizado` — encargo cobrado sem ninguém ter pedido. A migration
`20260730_boletos_defaults_encargos_zero.sql` zerou os defaults, mas o payload
completo continua sendo responsabilidade de quem insere.

Caminhos do ERP já ajustados: `launchBoletosForNfe`
(`src/features/nfe/services/nfe.service.ts`), `emitirBoletoReal`
(`src/features/cobrancas/CobrancasProvider.tsx`), `PrepararBoletosModal`,
prorrogação em `ContasReceberPage` e `RevisarGeracaoBancariaModal`.

### PDF interno do boleto — contrato e persistência

A Edge Function `gerar-boleto-pdf` monta o PDF do boleto com o template da
empresa e devolve o arquivo já salvo no Storage. Ela **não grava** em
`public.boletos`: quem chama é que precisa persistir o retorno.

Contrato observado (Supabase Storage, bucket `boletos`):

```text
POST {SUPABASE_URL}/functions/v1/gerar-boleto-pdf
headers: Authorization: Bearer <key>, Content-Type: application/json
body:    { "id": "<uuid de public.boletos>", "template_url": "<empresas.url_boleto_base>" }

200 -> { "url": "https://<proj>.supabase.co/storage/v1/object/public/boletos/<id_int>/parcela_<n>.pdf",
         "path": "<id_int>/parcela_<n>.pdf" }
500 -> falha de renderização; observada com "bwip-js: bar code text not specified"
        quando o boleto está sem codigo_barras
```

Note que `path` vem **sem o bucket** — o bucket é sempre `boletos`. Guardar
`path` cru e usá-lo como href gera link quebrado; ver
`src/lib/boletos/pdf-url.ts`, que é o único normalizador desses dois campos.

Mapeamento obrigatório de quem persiste:

```text
public.boletos.url_pdf     <- resposta.url    (URL absoluta)
public.boletos.pdf_storage <- resposta.path   (caminho relativo ao bucket boletos)
```

#### Pendência: workflow n8n "BOLETO A VISTA E3 e IDEAL - VIBE" não persiste o PDF

O workflow (webhook `boleto-vibe`) já chama `gerar-boleto-pdf` nos nós
`HTTP Request ideal` e `HTTP Request e3`, logo após `Create a row boleto
id_empresa=1` / `=3`, passando `{ id: {{ $('Create a row').item.json.id }},
template_url: <template da empresa> }`.

O que falta: **não existe nó de update depois dessas chamadas**, então o `url` e o
`path` retornados são descartados. Evidência: a auditoria de `public.boletos`
cobre a base inteira (desde 28/03/2026) e registra apenas 12 escritas em
`url_pdf`/`pdf_storage`, todas rastreáveis a sessões humanas — se o fluxo
automático gravasse, seriam centenas. Em 30/07/2026, de 272 boletos com PDF, só 5
tinham o PDF interno; os outros 267 têm o link público do C6, gravado no INSERT.

Ajuste a aplicar no n8n (não versionado neste repositório):

1. após `HTTP Request ideal`, adicionar um nó Supabase **Update** em `boletos`
   com `id = {{ $('Create a row boleto id_empresa=1').item.json.id }}` e os campos
   `url_pdf = {{ $json.url }}` e `pdf_storage = {{ $json.path }}`;
2. idem após `HTTP Request e3`, referenciando `Create a row boleto id_empresa=3`;
3. idempotência: usar o `id` da linha criada no próprio fluxo (nunca `id_int`, que
   se repete entre parcelas) e condicionar a chamada a `url_pdf IS NULL`, para um
   reprocessamento do webhook não gerar o PDF de novo;
4. tratar o 500 como falha não bloqueante — o boleto no C6 já está emitido, e a
   ação manual "Gerar/Regerar PDF do Boleto" no ERP continua sendo o fallback.

Enquanto isso não for feito, o PDF interno só existe quando alguém aciona a ação
manual em Financeiro → Carteira. Ela deve ser preservada.

#### Pendência: workflow n8n de contas a receber por NF

Existe um processo **fora deste repositório** que insere em `public.boletos` via
PostgREST sem JWT de usuário (chave anon/service) e **omite** `multa` e
`juros_dia`. Ele é a origem de 248 dos 521 títulos existentes em 30/07/2026 —
todos com `multa = 2` e `juros_dia = 0.033`.

O workflow não foi identificado por nome porque os fluxos n8n não são versionados
aqui. Para localizá-lo, esta é a assinatura dos registros que ele cria:

| Evidência | Valor |
|---|---|
| Conexão | PostgREST (`session_user = authenticator`), sem `auth.uid()` e sem JWT |
| `descricao` | `Parcela 1/1 - REF. <n_nf>` |
| `contato` / `whats` | `Fulano de Tal` / `55` (placeholders fixos) |
| `deposito_conta` | `true` em 248/248 |
| `n_nf` | sempre preenchido (236 NFs distintas) |
| `ext_reference`, `id_pagamento`, `id_boleto_c6` | sempre nulos |
| `id_int` | 154/248 fora da faixa de `public.propostas` (até 999104) — recebíveis de origem legada/externa |
| Janela observada | 08/04/2026 a 24/07/2026 |

Nenhum builder deste repositório gera esse payload — o mais próximo,
`PrepararBoletosModal`, escreve `Parcela 1/1 - Boleto E-Faturado - OS: <n>`, envia
`deposito_conta: false` e já manda os encargos zerados.

Ação pendente no n8n: incluir `multa: 0` e `juros_dia: 0` no corpo do INSERT.
Enquanto isso não for feito, o efeito prático fica coberto pelo default zerado no
banco, mas o payload segue incompleto e volta a cobrar encargos se o default for
revertido.

---

# Cancelamento e Exclusão

Cobranças integradas externamente devem ser canceladas primeiro no provedor oficial.

A alteração local só pode ocorrer após sucesso da operação externa.

Cobranças liquidadas ou faturadas aprovadas não podem ser excluídas ou canceladas fora das regras homologadas.

O comportamento completo está documentado em:

- `CANCELAMENTO-COBRANCAS.md`

---

# Segurança

Nunca:

- expor credenciais no frontend;
- registrar segredos em logs;
- alterar status por conveniência visual;
- confirmar pagamento sem evidência;
- atualizar simultaneamente tabelas financeiras sem o fluxo oficial;
- criar integração paralela;
- escrever em produção por tentativa e erro.

Toda escrita deve respeitar:

- `SECURITY.md`;
- `MATRIZ-SEGURANCA-ESCRITA-SUPABASE.md`;
- permissões do usuário;
- contratos das integrações.

---

# Validação Obrigatória

Antes de concluir uma alteração valide:

- criação da cobrança;
- associação correta por `id_int`;
- associação correta por `id_cliente`;
- empresa recebedora;
- status inicial;
- retorno da integração;
- tratamento de falha;
- atualização por webhook;
- ausência de duplicidade;
- comportamento de cancelamento;
- ausência de regressão em Contas a Receber;
- ausência de regressão na liberação da proposta.

---

# Documentação Relacionada

- `../PROJECT_CONTEXT.md`
- `../SECURITY.md`
- `../BUSINESS_RULES.md`
- `../technical/MATRIZ-SEGURANCA-ESCRITA-SUPABASE.md`
- `./CANCELAMENTO-COBRANCAS.md`
- `./FLUXO-OFICIAL-STATUS-PROPOSTAS.md`
- `../maestro/MAESTRO-KNOWLEDGE-BASE.md`

---

# Fonte da Verdade

Este documento representa a referência oficial do fluxo de checkout, cobranças e pagamentos do Vibe.

A Matriz de Segurança define quais operações de escrita estão liberadas.

O documento de Cancelamento define como interromper cobranças.

O Fluxo Oficial de Status define como o resultado financeiro influencia a proposta.

Nenhuma implementação deve criar um fluxo financeiro paralelo.
