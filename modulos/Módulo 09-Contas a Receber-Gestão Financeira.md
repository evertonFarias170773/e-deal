# Módulo 09 — Contas a Receber / Gestão Financeira

## Objetivo

Controlar a visão financeira dos recebimentos futuros e realizados da empresa, com base nas cobranças originadas a partir das propostas.

Este módulo não é responsável por criar a cobrança inicial.  
A criação da cobrança pertence ao módulo:

`Módulo 08 — Cobranças e Pagamentos`

O módulo de Contas a Receber tem foco em:

- acompanhar valores a receber;
- acompanhar vencimentos;
- controlar boletos;
- controlar depósitos futuros;
- controlar cartão aprovado com recebimento futuro;
- visualizar pagamentos pagos, futuros, vencidos e cancelados;
- apoiar o financeiro na confirmação e gestão dos recebíveis;
- garantir que uma proposta só seja liberada como pedido quando todas as partes do pagamento estiverem aprovadas conforme regra.

---

## Conceito principal

A origem comercial de uma cobrança é sempre uma proposta.

A chave principal de ligação é:

`id_int`

A proposta nasce em:

`public.propostas`

E os recebimentos/cobranças nascem em:

`public.pagamentos_v2`

Quando necessário, boletos e depósitos futuros são detalhados em:

`public.boletos`

---

## Diferença entre cobrança e contas a receber

### Cobrança

É o ato de criar uma forma de pagamento para o cliente.

Exemplos:

- gerar PIX;
- gerar boleto;
- gerar checkout de cartão;
- criar faturado;
- criar cobrança parcelada.

Tabela principal:

`pagamentos_v2`

---

### Contas a receber

É a gestão dos valores que ainda serão recebidos ou que já foram recebidos.

Exemplos:

- boleto a vencer;
- boleto vencido;
- faturado 30/60 dias;
- cartão aprovado com recebimento futuro;
- depósito futuro;
- pagamento confirmado;
- cobrança cancelada.

Tabelas principais:

- `pagamentos_v2`
- `boletos`

---

## Tabelas principais

### `public.propostas`

É a origem da venda.

Campo principal:

`id_int`

A proposta define:

- cliente;
- vendedor;
- produtos;
- frete;
- valor total;
- condição comercial;
- status interno.

---

### `public.pagamentos_v2`

Tabela principal de cobranças/pagamentos.

Cada registro representa uma parte do pagamento da proposta.

Uma proposta pode ter um ou mais registros em `pagamentos_v2`.

Exemplo:

Proposta `123456` no valor de R$ 10.000,00:

- `123456-A` — PIX de R$ 5.000,00
- `123456-B` — Cartão de crédito de R$ 2.000,00
- `123456-C` — Faturado de R$ 3.000,00

Todos vinculados ao mesmo:

`id_int = 123456`

---

### `public.boletos`

Tabela usada para detalhar boletos e depósitos futuros.

Um registro em `pagamentos_v2` pode gerar um ou mais registros em `boletos`.

Exemplo:

Pagamento `123456-C` faturado em R$ 3.000,00 pode gerar:

- boleto 1/2 — R$ 1.500,00 — vencimento em 30 dias;
- boleto 2/2 — R$ 1.500,00 — vencimento em 60 dias.

A tabela `boletos` também pode controlar depósitos futuros, quando usados como recebimento programado.

---

## Exemplo completo de desmembramento financeiro

Proposta:

```text
id_int: 123456
valor_total: R$ 10.000,00

Cliente escolhe pagar:

R$ 5.000,00 no PIX
R$ 2.000,00 no cartão de crédito em 3x
R$ 3.000,00 faturado em 2 boletos

Resultado esperado em pagamentos_v2:

id_pagamento: 123456-A
tipo_cobranca: PIX
valor: 5000
status: PAID
id_pagamento: 123456-B
tipo_cobranca: CREDIT_CARD
valor: 2000
status: A_VENCER ou PAID, conforme regra de confirmação
confirmado: true
id_pagamento: 123456-C
tipo_cobranca: E-Faturado
valor: 3000
status: A_VENCER
confirmado: true, somente se aprovado

Resultado esperado em boletos para o faturado:

id_int: 123456
id_pagamento: 123456-C
parcela: 1
total_parcelas: 2
valor: 1500
vencimento: 30 dias
id_int: 123456
id_pagamento: 123456-C
parcela: 2
total_parcelas: 2
valor: 1500
vencimento: 60 dias

---

Regra de liberação do pedido

Enquanto todas as partes do pagamento da proposta não estiverem aprovadas, a proposta não deve virar pedido.

Regra atual conhecida:

Uma parte do pagamento é considerada aprovada quando em pagamentos_v2:

status = PAID

ou:

status = A_VENCER
confirmado = true

A proposta só deve ser liberada para pedido quando todos os registros relevantes de pagamentos_v2 vinculados ao mesmo id_int estiverem aprovados por essa regra.

Interpretação dos status em Contas a Receber
PAID

Pagamento recebido.

Entra como valor pago/realizado.

Exemplo:

PIX pago;
cartão confirmado como pago;
boleto liquidado.
A_VENCER com confirmado = true

Pagamento aprovado para recebimento futuro.

Entra em contas a receber.

Exemplos:

faturado aprovado;
boleto futuro aprovado;
cartão aprovado com recebimento futuro;
depósito futuro confirmado.

Esse status pode liberar a proposta para virar pedido, mesmo que o dinheiro ainda não tenha entrado, porque o financeiro aprovou o recebimento futuro.

A_RECEBER

Cobrança criada, mas ainda pendente.

Não deve liberar pedido.

Pode representar:

cobrança aguardando pagamento;
checkout criado;
boleto ainda não confirmado;
solicitação em aberto.
CANCELADO

Cobrança cancelada.

Não deve contar como recebível ativo.

Se todos os pagamentos da proposta forem cancelados, a proposta pode ser cancelada conforme regra do módulo de Orçamentos.

Cartão de crédito como recebimento futuro

Cartão de crédito pode ser aprovado na hora, mas ainda representar recebimento futuro financeiro.

Por isso, no contas a receber, o cartão aprovado pode aparecer como:

aprovado;
confirmado;
valor futuro;
previsão de recebimento;
vinculado à proposta.

Regra:

Se o cartão estiver aprovado e validado pelo backend/webhook, pode contar como parte aprovada da proposta.

PIX

PIX normalmente não entra como contas a receber futuro.

Fluxo esperado:

enquanto não pago: cobrança pendente;
quando pago: PAID;
entra como recebido.

PIX não gera boleto e normalmente não gera recebimento futuro.

Faturado

Faturado representa crédito concedido ao cliente.

Pode gerar:

boleto futuro;
depósito futuro;
parcelas;
vencimentos 30/60/90;
necessidade de aprovação financeira.

Regra:

Faturado só deve ser considerado aprovado quando:

status = A_VENCER
confirmado = true

Antes disso, a proposta fica aguardando aprovação financeira.

Boletos

Boletos são registrados na tabela:

public.boletos

A emissão bancária dos boletos é feita pela API do banco C6 via n8n.

O cancelamento bancário também é feito via n8n.

A tabela boletos deve armazenar os dados operacionais do boleto:

id_int;
id_pagamento;
parcela;
total_parcelas;
valor;
vencimento;
status;
linha digitável;
código de barras;
PDF;
juros;
multa;
dias em atraso;
valor atualizado;
confirmação;
prorrogação;
dados do cliente;
empresa;
documento.
Depósitos futuros

Depósitos futuros também podem entrar na tabela boletos, mesmo não sendo boleto bancário.

Nesse caso, a tabela funciona como agenda de recebimento.

Diferença conceitual:

Boleto

Tem registro bancário, linha digitável, código de barras e PDF.

Depósito futuro

Representa uma previsão de recebimento, sem necessariamente ter registro bancário.

A interface deve deixar claro o tipo do registro.

Relação entre pagamentos_v2 e boletos

pagamentos_v2 representa a cobrança principal.

boletos representa o detalhamento das parcelas/vencimentos quando a cobrança gera boletos ou recebimentos futuros.

Exemplo:

pagamentos_v2
id_pagamento = 123456-C
valor = 3000
tipo_cobranca = E-Faturado
boletos
id_pagamento = 123456-C
parcela = 1/2
valor = 1500
boletos
id_pagamento = 123456-C
parcela = 2/2
valor = 1500
Visão principal do Contas a Receber

A tela de contas a receber deve permitir visualizar:

pagamentos futuros;
boletos a vencer;
boletos vencidos;
recebimentos confirmados;
cartão aprovado com recebimento futuro;
faturados pendentes;
depósitos futuros;
cobranças canceladas, se filtrado.

Fonte principal:

pagamentos_v2
boletos
views/RPCs de resumo financeiro, quando existirem.
Telas do módulo
Contas a receber

Objetivo:

Mostrar todos os recebíveis futuros e pendentes.

Filtros:

cliente;
id_int;
id_pagamento;
empresa;
tipo de cobrança;
status;
vencimento;
período;
confirmado;
vendedor/atendente.

Colunas desktop sugeridas:

ID pagamento
Proposta
Cliente
Empresa
Tipo
Parcela
Vencimento
Valor
Status
Confirmado
Ações

No mobile, cada recebível deve virar card.

Boletos e depósitos futuros

Objetivo:

Controlar registros da tabela boletos.

Filtros:

vencidos;
vencem hoje;
a vencer;
pagos;
cancelados;
prorrogados;
empresa;
cliente;
id_int;
id_pagamento;
tipo: boleto ou depósito.

Ações:

abrir PDF;
copiar linha digitável;
enviar WhatsApp;
confirmar pagamento;
cancelar boleto;
prorrogar vencimento;
atualizar status;
ver proposta;
ver cliente.
Detalhe do recebível

Objetivo:

Mostrar visão completa de uma cobrança/recebível.

Seções:

dados da proposta;
dados do cliente;
empresa recebedora;
tipo de cobrança;
valor;
vencimento;
status;
confirmação;
parcelas/boletos vinculados;
histórico;
mensagens internas;
links e documentos.
Resumo financeiro da proposta

Objetivo:

Mostrar como uma proposta foi dividida financeiramente.

Exemplo:

Proposta 123456 — Total R$ 10.000,00

PIX — R$ 5.000,00 — Pago
Cartão — R$ 2.000,00 — Aprovado / recebimento futuro
Faturado — R$ 3.000,00 — A vencer confirmado
  Boleto 1/2 — R$ 1.500,00 — 30 dias
  Boleto 2/2 — R$ 1.500,00 — 60 dias

Essa visão é muito importante para o financeiro e para o vendedor entenderem se a proposta pode virar pedido.

Regras para aprovação da proposta

Para liberar uma proposta como pedido:

Buscar todos os registros de pagamentos_v2 do mesmo id_int.
Ignorar registros cancelados conforme regra definida.
Verificar se todos os pagamentos válidos estão aprovados.
Um pagamento válido está aprovado se:
status = PAID; ou
status = A_VENCER e confirmado = true.
Se houver algum pagamento A_RECEBER ou não confirmado, a proposta não vira pedido.
Se houver pedido de crédito pendente, a proposta fica aguardando.
Se todos forem aprovados, a proposta pode seguir para pedido.
Solicitação de crédito e aprovação financeira

Quando o cliente pede faturado e não possui limite disponível:

Vendedor solicita faturamento.
Sistema verifica crédito.
Se limite insuficiente:
não aprova a proposta;
registra mensagem em propostas_chat;
financeiro analisa;
proposta fica aguardando.
Financeiro pode aprovar ou reprovar.
Se aprovar:
pagamento vira A_VENCER;
confirmado = true;
proposta pode ser liberada, se todos os demais pagamentos também estiverem aprovados.
Se reprovar:
proposta continua pendente;
vendedor deve negociar outra forma de pagamento.
propostas_chat como log financeiro

A tabela propostas_chat deve registrar eventos relevantes da análise financeira.

Exemplos:

solicitação de crédito;
pedido de faturamento;
aprovação do financeiro;
reprovação;
observações manuais;
alteração de forma de pagamento;
divergência de valores;
cobrança gerada;
cobrança cancelada.

Esse histórico deve aparecer tanto na proposta quanto no detalhe financeiro.

Indicadores do contas a receber

Cards de resumo sugeridos:

Total a vencer
Vencem hoje
Vencidos
Recebidos no período
Faturado aguardando aprovação
Cartão aprovado futuro
Boletos em aberto
Boletos vencidos

Esses cards devem respeitar os filtros aplicados.

Status visuais

Badges sugeridos:

Pagamentos
Pago
A vencer
A receber
Cancelado
Confirmado
Não confirmado
Aguardando crédito
Crédito aprovado
Crédito reprovado
Boletos
Gerado
A vencer
Vencido
Pago
Cancelado
Prorrogado
Depósito futuro
Menu de ações por linha

Seguir Skill 02.

A coluna final deve ser:

Ações

Ações possíveis:

Ver recebível
Ver proposta
Ver cliente
Abrir boleto/PDF
Copiar linha digitável
Enviar WhatsApp
Confirmar recebimento
Atualizar status
Prorrogar vencimento
Cancelar boleto
Cancelar cobrança
Ver histórico financeiro

Ações críticas devem ficar separadas no final.

Ações críticas

Exigem confirmação:

confirmar recebimento manualmente;
cancelar cobrança;
cancelar boleto bancário;
prorrogar vencimento;
alterar valor;
alterar vencimento;
aprovar crédito;
reprovar crédito;
marcar como confirmado;
reverter confirmação.
Alertas importantes

O sistema deve alertar quando:

boleto está vencido;
cobrança está sem confirmação;
valor dos pagamentos diverge do total da proposta;
proposta tem pagamentos parcialmente aprovados;
faturado está aguardando análise;
boleto bancário não foi registrado;
cancelamento bancário falhou;
pagamento foi cancelado;
cartão foi recusado;
checkout está pendente;
depósito futuro está vencido;
cliente tem restrição ou crédito insuficiente.
Relação com n8n / C6

A geração e cancelamento bancário de boletos é feita pela API do banco C6 via n8n.

O novo sistema deve aproveitar o backend existente.

O front não deve:

expor credenciais C6;
chamar banco diretamente do navegador;
recriar lógica bancária no client;
alterar status bancário sem retorno ou confirmação.

O front deve:

acionar fluxo seguro;
mostrar status;
registrar erro amigável;
permitir reprocessar quando fizer sentido;
preservar histórico.
Relação com Orçamentos

O módulo de Contas a Receber depende de Orçamentos.

Toda cobrança deve estar ligada a:

id_int

A proposta deve exibir um resumo financeiro com:

total da proposta;
pagamentos criados;
valores pagos;
valores futuros;
saldo pendente;
status de liberação para pedido.
Relação com Pedidos

A proposta só vira pedido quando as condições financeiras estiverem aprovadas.

Regra atual:

PAID
ou
A_VENCER com confirmado = true

Se houver mais de uma parte no pagamento, todas devem estar aprovadas.

Relação com Relatórios

Este módulo deve alimentar relatórios financeiros como:

recebíveis por período;
recebíveis por empresa;
recebíveis por cliente;
vencidos;
pagos;
a vencer;
faturado aprovado;
inadimplência;
carteira de boletos;
previsão de caixa.
O que este módulo faz

Este módulo permite:

visualizar contas a receber;
controlar recebíveis futuros;
controlar boletos;
controlar depósitos futuros;
acompanhar cartão aprovado com recebimento futuro;
acompanhar faturados;
confirmar recebimentos;
cancelar recebíveis;
prorrogar boletos;
analisar pendências financeiras;
verificar se proposta pode virar pedido.
O que este módulo não faz

Este módulo não cria orçamento.

Não cria cobrança inicial do zero sem origem em proposta.

Não emite nota fiscal.

Não controla contas a pagar.

Não substitui o backend C6/n8n.

Não aprova proposta sem respeitar todos os pagamentos vinculados ao id_int.

Não deve alterar status financeiro crítico sem confirmação e registro.

Componentes necessários
ContasReceberListPage
RecebivelDetailPage
BoletosListPage
BoletoDetailPanel
ResumoFinanceiroProposta
PagamentosPropostaTimeline
RecebivelActionsMenu
BoletoActionsMenu
StatusPagamentoBadge
StatusBoletoBadge
ConfirmarRecebimentoDialog
CancelarCobrancaDialog
ProrrogarBoletoDialog
AnaliseCreditoPanel
PropostasChatFinanceiroPanel
Serviços necessários
contasReceberService
pagamentosService
boletosService
propostasFinanceiroService
creditoService
propostasChatService
empresasService
RPCs / funções recomendadas

Preferir RPCs para:

calcular resumo financeiro da proposta;
validar se proposta pode virar pedido;
confirmar recebimento;
cancelar cobrança;
cancelar boleto;
prorrogar boleto;
aprovar crédito;
reprovar crédito;
registrar mensagem financeira;
recalcular saldo pendente.

Funções ou views importantes já existentes ou esperadas:

vw_pagamentos_resumo
rpc_boletos_resumo
fn_analise_credito_cliente
funções de sincronização de status da proposta
funções de saldo pendente
Primeira implementação sugerida

Etapa 1:

criar tela de contas a receber baseada em pagamentos_v2;
filtros por empresa, status, tipo, vencimento e cliente;
cards de resumo;
menu de ações.

Etapa 2:

criar tela/lista de boletos baseada em boletos;
filtros por vencidos, hoje, a vencer, pagos e cancelados.

Etapa 3:

criar detalhe financeiro da proposta;
mostrar todos os pagamentos do mesmo id_int;
mostrar se a proposta está liberada ou pendente.

Etapa 4:

criar fluxo de aprovação/reprovação de crédito;
registrar eventos em propostas_chat.

Etapa 5:

integrar ações com backend/n8n existente para boletos;
cancelar, atualizar e consultar status.
Resultado esperado

Ao final deste módulo, o sistema deve permitir:

acompanhar todos os recebíveis;
entender cobranças desmembradas por proposta;
controlar boletos e depósitos futuros;
visualizar cartão aprovado com recebimento futuro;
saber se a proposta pode virar pedido;
apoiar o financeiro na aprovação de crédito;
manter histórico claro das decisões financeiras;
alimentar relatórios e dashboard financeiro.
Observações importantes

Contas a receber é básico, mas precisa ser extremamente confiável.

A regra central é:

Uma proposta só vira pedido quando todos os pagamentos válidos vinculados ao id_int estiverem aprovados.

Aprovação financeira atual:

status = PAID
ou
status = A_VENCER e confirmado = true

O sistema deve ser preparado para pagamentos parciais e desmembrados, mesmo que sejam casos raros.

O exemplo extremo de PIX + cartão + faturado deve ser suportado pela modelagem, porque ele mostra que uma proposta pode ter múltiplas partes financeiras.
