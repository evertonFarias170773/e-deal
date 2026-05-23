# Módulo 08 — Cobranças e Pagamentos
## Objetivo

Controlar o fluxo financeiro gerado a partir das propostas/orçamentos, principalmente contas a receber, cobranças, boletos, PIX, cartão, faturado, confirmação de pagamentos, análise de crédito e histórico financeiro.

Neste momento, o foco principal do módulo é:

- contas a receber;
- geração de cobranças;
- controle de pagamentos;
- boletos;
- PIX;
- cartão de crédito;
- faturado/crédito;
- confirmação financeira;
- mensagens internas relacionadas ao financeiro.

O módulo de contas a pagar ainda não está estruturado no sistema atual e deve ficar como área planejada para evolução futura.

---

## Conceito do fluxo financeiro

No ERP, o financeiro nasce principalmente a partir de uma proposta aprovada pelo cliente.

O vendedor volta no orçamento/proposta e cria uma cobrança conforme a intenção de pagamento informada pelo cliente.

Essa cobrança gera um registro na tabela:

`public.pagamentos_v2`

A partir desse registro, o backend e os fluxos existentes cuidam da geração de PIX, boleto, cartão, checkout, links, status e confirmação.

O sistema já possui backend bem estruturado para criação de checkouts e controle de pagamentos realizados.  
O novo front não deve recriar essa lógica do zero.

---

## Tabela principal

Tabela principal do módulo:

`public.pagamentos_v2`

Essa tabela concentra as cobranças, pagamentos e lançamentos financeiros vinculados às propostas.

Chave de ligação com proposta:

`id_int`

Relacionamento conceitual:

`pagamentos_v2.id_int` → `propostas.id_int`

---

## Tabelas relacionadas

O módulo financeiro se relaciona principalmente com:

- `pagamentos_v2`
- `propostas`
- `clientes`
- `clientes_socios`
- `boletos`
- `pagamentos_publicos`
- `empresas`
- `movimento_credito`
- `modelos_cobranca`
- `propostas_chat`

---

## Tabela `pagamentos_v2`

A tabela `pagamentos_v2` representa uma cobrança ou lançamento financeiro vinculado a uma proposta.

Campos importantes conhecidos:

- `id`
- `id_int`
- `id_cliente`
- `valor`
- `status`
- `tipo_cobranca`
- `pix_copia_cola`
- `linha_digitavel`
- `url_cobranca`
- `id_fatura`
- `created_at`
- `paid_at`
- `vencimento`
- `motivo_cancela`
- `url_pdf`
- `whats_contato`
- `cliente`
- `empresa`
- `descricao`
- `documento`
- `atendente`
- `confirmado`
- `confirmado_por`
- `os_ideal`
- `id_empresa`
- `id_pagamento`
- `aprovado_por`
- `obs_v2`
- `data_confirmacao`
- `token_publico`
- `erro_pagamento`
- `forma_fatu`
- `troca_tipo_pgto`
- `motivo_troca`
- `e_fatu_aprovado`
- `forma_pgto`
- `cartao_parcelas`
- `cartao_taxa_percentual`
- `cartao_valor_taxa`
- `cartao_valor_final`
- `cartao_checkout_id`
- `cartao_checkout_url`
- `cartao_status`
- `is_parcial`
- `saldo_pendente`
- `valor_frete`
- `p_valor_entrada`
- `p_qtd_parcelas`
- `p_dias_pra_inicio`
- `p_intervalo`

---

## Status financeiros

Status principais usados:

### `A_RECEBER`

Cobrança criada, mas ainda não concluída ou confirmada.

É o status inicial padrão.

---

### `A_VENCER`

Cobrança aprovada para recebimento futuro.

Usado principalmente em:

- boleto a prazo;
- faturado;
- cobrança futura;
- cartão/fluxos confirmados mas com vencimento futuro, conforme regra.

---

### `PAID`

Pagamento recebido/concluído.

Indica que o financeiro reconhece o pagamento como pago.

---

### `CANCELADO`

Cobrança cancelada.

Não deve contar como recebível ativo.

---

### `CARD_PARCELADO`

Status/fluxo ligado ao cartão parcelado, quando o cliente escolhe parcelamento antes do checkout final.

---

## Tipos de cobrança

Tipos conhecidos:

- `PIX`
- `BOLETO`
- `CREDIT_CARD`
- `CARD_PARCELADO`
- `E-Faturado`

A interface deve exibir nomes amigáveis:

- PIX
- Boleto
- Cartão de crédito
- Cartão parcelado
- Faturado

---

## Criação de cobrança

A cobrança é criada pelo vendedor após o cliente aprovar a proposta ou informar a forma de pagamento.

Fluxo principal:

1. Cliente aprova ou solicita uma forma de pagamento.
2. Vendedor acessa a proposta/orçamento.
3. Vendedor escolhe a forma de pagamento.
4. Sistema cria um registro em `pagamentos_v2`.
5. Conforme o tipo de cobrança, o sistema aciona backend/n8n/Edge Function.
6. O backend gera PIX, boleto, checkout ou solicitação de faturamento.
7. O status financeiro passa a ser acompanhado pelo módulo financeiro.

---

## Escolha da empresa recebedora

Para PIX, boleto à vista e cartão de crédito, o vendedor deve escolher qual empresa será a recebedora.

Empresas conhecidas:

- Ideal
- Birô
- E3

Cada empresa possui conta bancária/credencial própria.

Isso significa que cada empresa pode acionar um fluxo diferente no backend/n8n para gerar a cobrança.

A escolha da empresa recebedora deve preencher ou respeitar:

- `id_empresa`
- `empresa`
- dados bancários da empresa
- credenciais de integração corretas
- fluxo correto de cobrança

Regra importante:

O front não deve expor credenciais bancárias, tokens ou segredos.

---

## PIX

No fluxo PIX:

1. Vendedor escolhe PIX.
2. Vendedor escolhe empresa recebedora.
3. Sistema cria cobrança em `pagamentos_v2`.
4. Backend gera o PIX.
5. Retorna dados como:
   - copia e cola;
   - QR Code, se disponível;
   - link público;
   - status;
   - token público.
6. Cliente paga.
7. Webhook/backend atualiza `pagamentos_v2`.

Campos envolvidos:

- `pix_copia_cola`
- `url_cobranca`
- `token_publico`
- `status`
- `paid_at`
- `confirmado`

---

## Boleto à vista

No fluxo de boleto à vista:

1. Vendedor escolhe boleto.
2. Vendedor escolhe empresa recebedora.
3. Sistema cria cobrança em `pagamentos_v2`.
4. Backend gera boleto.
5. Sistema cria ou atualiza registro em `boletos`.
6. Retorna:
   - linha digitável;
   - código de barras;
   - PDF;
   - vencimento;
   - status.

Campos envolvidos:

- `linha_digitavel`
- `url_pdf`
- `vencimento`
- `id_pagamento`
- `status`

---

## Cartão de crédito

No fluxo de cartão:

1. Vendedor escolhe cartão de crédito.
2. Vendedor escolhe empresa recebedora.
3. Sistema cria cobrança em `pagamentos_v2`.
4. Backend gera checkout.
5. Cliente acessa checkout.
6. Webhook confirma ou rejeita pagamento.
7. Sistema atualiza status.

Campos envolvidos:

- `cartao_checkout_id`
- `cartao_checkout_url`
- `cartao_status`
- `cartao_parcelas`
- `cartao_valor_final`
- `status`

---

## Cartão parcelado

No cartão parcelado, o sistema permite calcular parcelas e embutir taxa no valor final.

Campos importantes:

- `cartao_parcelas`
- `cartao_taxa_percentual`
- `cartao_valor_taxa`
- `cartao_valor_final`
- `cartao_checkout_id`
- `cartao_checkout_url`
- `cartao_status`

Regra:

A taxa deve ser embutida no valor final, e o cliente deve ver o valor da parcela de forma clara.

Exemplo de apresentação:

- 1x de R$ 100,00 sem juros
- 2x de R$ 52,25 com juros

---

## Faturado / Crédito

O fluxo faturado é diferente dos demais.

Ele representa quando o cliente solicita crédito, normalmente boleto a prazo ou pagamento futuro.

Fluxo esperado:

1. Cliente solicita pagamento faturado.
2. Vendedor tenta criar condição faturada.
3. Sistema verifica limite disponível do cadastro.
4. Se houver limite suficiente:
   - cobrança pode ser criada/aprovada;
   - proposta pode seguir para aprovado;
   - pagamento pode entrar como `A_VENCER` e `confirmado = true`, conforme regra.
5. Se não houver limite:
   - proposta não deve ser aprovada automaticamente;
   - financeiro deve receber solicitação de crédito;
   - proposta fica pendente/aguardando;
   - mensagem deve ser registrada em `propostas_chat`.

---

## Análise de crédito

A análise de crédito deve considerar dados financeiros do cliente.

Fontes possíveis:

- `movimento_credito`
- `vw_clientes_limite_credito`
- `vw_clientes_credito`
- `fn_analise_credito_cliente`
- `pagamentos_v2`
- histórico de propostas aprovadas
- atrasos
- limite disponível

O novo front deve preferir RPC existente para análise de crédito.

Dados esperados da análise:

- limite de crédito;
- utilizado;
- saldo disponível;
- risco;
- padrão de pagamento;
- atrasos;
- ticket médio;
- quantidade de pedidos aprovados.

---

## Pedido de crédito ao financeiro

Quando o cliente não tem limite suficiente, o sistema deve registrar uma solicitação para o financeiro.

Essa solicitação pode ser registrada em:

`propostas_chat`

A tabela `propostas_chat` funciona como um log/mensageria interna da proposta.

Uso:

- mensagens automáticas;
- mensagens manuais;
- solicitação de crédito;
- aprovação financeira;
- reprovação financeira;
- histórico de decisões;
- comunicação entre vendedor e financeiro.

---

## Tabela `propostas_chat`

A tabela `propostas_chat` deve ser tratada como histórico interno da proposta.

Ela registra eventos e mensagens como:

- solicitação de faturamento;
- pedido de crédito;
- aprovação do financeiro;
- reprovação do financeiro;
- alteração de forma de pagamento;
- observações manuais;
- mensagens automáticas do sistema.

Regra:

Eventos importantes do financeiro devem ser registrados em `propostas_chat`.

Exemplo de mensagem automática:

> Solicitação de crédito enviada ao financeiro para análise.

Exemplo de aprovação:

> Crédito aprovado pelo financeiro. Proposta liberada para faturamento.

Exemplo de reprovação:

> Crédito não aprovado. Solicitar outra forma de pagamento ao cliente.

---

## Aprovação financeira

A aprovação financeira pode ocorrer por:

- pagamento `PAID`;
- cobrança `A_VENCER` com `confirmado = true`;
- faturado aprovado pelo financeiro;
- cartão confirmado;
- boleto aprovado/faturado conforme regra.

Quando o financeiro aprova faturado, o sistema pode:

- atualizar `pagamentos_v2`;
- marcar `confirmado = true`;
- preencher `confirmado_por`;
- preencher `data_confirmacao`;
- atualizar status da proposta;
- registrar mensagem em `propostas_chat`.

---

## Relação com status da proposta

O financeiro influencia diretamente o status da proposta.

Regra geral:

- pagamento `PAID` pode aprovar proposta;
- pagamento `A_VENCER` com `confirmado = true` pode aprovar proposta;
- pedido de crédito sem aprovação mantém proposta em `AGUARDANDO`;
- pagamento cancelado não aprova proposta;
- todos pagamentos cancelados podem cancelar proposta;
- divergência financeira mantém proposta pendente/aguardando.

---

## Contas a receber

Contas a receber é a principal área atual do módulo financeiro.

Deve exibir cobranças de `pagamentos_v2`.

Filtros:

- cliente;
- id_int;
- empresa;
- status;
- tipo de cobrança;
- vencimento;
- período;
- confirmado;
- atendente;
- valor.

Colunas desktop sugeridas:

- ID
- Proposta
- Cliente
- Empresa
- Tipo
- Vencimento
- Valor
- Status
- Confirmado
- Ações

No mobile, cada cobrança vira card.

---

## Cadastro/controle de boletos

Boletos devem ser controlados pela tabela:

`boletos`

Uso:

- boleto gerado;
- parcela;
- vencimento;
- valor;
- linha digitável;
- código de barras;
- PDF;
- status;
- atraso;
- juros;
- multa;
- valor atualizado;
- confirmação;
- prorrogação.

A tela de boletos deve permitir:

- listar boletos;
- filtrar por vencimento;
- filtrar por status;
- abrir PDF;
- copiar linha digitável;
- enviar WhatsApp;
- confirmar pagamento;
- cancelar;
- prorrogar, se permitido.

---

## Contas a pagar

O contas a pagar ainda não está estruturado no sistema atual.

Para o mapa do sistema, deve ficar como módulo planejado.

Objetivo futuro:

- cadastrar despesas;
- fornecedores;
- vencimentos;
- pagamentos realizados;
- centro de custo;
- empresa pagadora;
- anexos;
- comprovantes;
- status.

Não implementar agora como fluxo definitivo sem modelagem própria.

---

## Páginas do módulo financeiro

### Dashboard financeiro

Objetivo:

Mostrar visão resumida do financeiro.

Indicadores possíveis:

- total a receber;
- total pago;
- total vencido;
- total a vencer;
- vencem hoje;
- faturado pendente;
- crédito aguardando aprovação;
- cartões pendentes;
- boletos vencidos.

---

### Contas a receber

Objetivo:

Listar cobranças e pagamentos.

Fonte principal:

`pagamentos_v2`

Ações:

- ver cobrança;
- abrir link;
- copiar PIX;
- copiar linha digitável;
- abrir PDF;
- enviar WhatsApp;
- confirmar pagamento;
- cancelar cobrança;
- alterar forma de pagamento;
- ver proposta;
- ver cliente.

---

### Boletos

Objetivo:

Controlar boletos emitidos.

Fonte principal:

`boletos`

Ações:

- abrir PDF;
- copiar linha digitável;
- enviar WhatsApp;
- atualizar status;
- confirmar;
- cancelar;
- prorrogar.

---

### Solicitações de crédito

Objetivo:

Permitir ao financeiro analisar pedidos de faturado/crédito.

Fonte:

- `propostas_chat`
- `pagamentos_v2`
- análise de crédito do cliente
- proposta relacionada

Ações:

- aprovar crédito;
- reprovar crédito;
- solicitar ajuste;
- comentar;
- ver histórico;
- ver cliente;
- ver proposta.

---

### Detalhe da cobrança

Objetivo:

Mostrar todos os dados de uma cobrança.

Seções:

- dados da proposta;
- cliente;
- empresa recebedora;
- tipo de cobrança;
- valores;
- vencimento;
- status;
- links/documentos;
- histórico;
- mensagens internas.

---

## Menu de ações por linha

Seguir Skill 02.

Não usar múltiplos ícones soltos.

A coluna final deve ser:

`Ações`

Ações possíveis em cobrança:

- Ver cobrança
- Abrir proposta
- Ver cliente
- Abrir link de pagamento
- Copiar PIX
- Copiar linha digitável
- Abrir PDF
- Enviar WhatsApp
- Confirmar pagamento
- Atualizar status
- Alterar forma de pagamento
- Cancelar cobrança

Ações perigosas separadas no final.

---

## Ações críticas

Exigem confirmação:

- confirmar pagamento;
- cancelar cobrança;
- alterar forma de pagamento;
- aprovar crédito;
- reprovar crédito;
- prorrogar boleto;
- alterar vencimento;
- alterar valor;
- marcar como pago manualmente.

---

## Alertas financeiros

O sistema deve alertar quando:

- cobrança vencida;
- cobrança sem link;
- PIX expirado;
- boleto vencido;
- valor divergente da proposta;
- cliente sem crédito;
- pedido de crédito pendente;
- pagamento sem confirmação;
- webhook retornou erro;
- checkout foi criado mas não pago;
- cobrança cancelada;
- proposta aprovada sem cobrança válida.

---

## Relação com Orçamentos

O financeiro nasce principalmente da proposta.

A proposta envia para o financeiro:

- `id_int`;
- cliente;
- valor;
- empresa;
- vendedor;
- condição de pagamento;
- forma de cobrança;
- descrição;
- frete;
- parcelas;
- vencimentos.

O financeiro devolve para a proposta:

- status de pagamento;
- confirmação;
- aprovação/reprovação;
- cobrança gerada;
- link de pagamento;
- boleto/PDF;
- saldo pendente.

---

## Relação com Clientes/Cadastros

O financeiro usa o cadastro para:

- nome;
- documento;
- e-mail;
- WhatsApp;
- limite de crédito;
- risco;
- padrão de pagamento;
- vínculos comerciais;
- histórico financeiro.

Se houver relação em `clientes_socios`, o sistema deve considerar que a cobrança pode estar vinculada a um cadastro relacionado ou autorizado.

---

## Relação com Empresas

Cada cobrança deve estar vinculada a uma empresa recebedora.

A empresa define:

- conta bancária;
- credencial de cobrança;
- modelo de boleto;
- fluxo n8n/backend;
- logomarca;
- dados comerciais;
- relatórios.

Campos envolvidos:

- `id_empresa`
- `empresa`

---

## Relação com n8n / backend

O sistema atual usa fluxos externos para gerar cobranças.

Esses fluxos já estão estruturados e não devem ser reescritos sem necessidade.

O novo front deve apenas acionar o fluxo correto de forma segura.

Regras:

- não expor webhook sensível diretamente se puder passar por backend;
- não expor token bancário;
- não expor credenciais;
- registrar retorno em `pagamentos_v2`;
- manter idempotência;
- tratar erros com mensagens amigáveis.

---

## Relação com webhooks

Pagamentos podem ser atualizados por webhook.

Exemplos:

- PIX pago;
- boleto pago;
- cartão aprovado;
- cartão recusado;
- checkout cancelado;
- cobrança expirada.

O webhook deve atualizar:

- `status`;
- `paid_at`;
- `confirmado`;
- `data_confirmacao`;
- campos específicos do método de pagamento.

O front deve refletir o status atualizado.

---

## Padrão de criação de cobrança

Ao criar cobrança, o front deve pedir:

- forma de pagamento;
- empresa recebedora;
- valor;
- vencimento, quando aplicável;
- parcelas, quando aplicável;
- entrada, quando aplicável;
- intervalo, quando aplicável;
- observação, se necessário.

Para faturado:

- validar crédito antes;
- se crédito insuficiente, gerar solicitação ao financeiro.

---

## Padrão mobile

No mobile, contas a receber e boletos devem usar cards.

Card de cobrança:

- cliente;
- proposta;
- valor;
- vencimento;
- status;
- tipo de cobrança;
- empresa;
- ação principal;
- menu de ações.

Ações em menu bottom sheet.

---

## O que este módulo faz

Este módulo permite:

- criar cobrança a partir da proposta;
- controlar contas a receber;
- gerar PIX;
- gerar boleto;
- gerar checkout de cartão;
- controlar cartão parcelado;
- controlar faturado;
- analisar crédito;
- registrar mensagens financeiras;
- acompanhar pagamentos;
- confirmar pagamentos;
- cancelar cobranças;
- listar boletos;
- abrir documentos financeiros.

---

## O que este módulo não faz

Este módulo não deve:

- recriar backend de cobrança já existente;
- expor credenciais bancárias;
- confirmar pagamento sem validação;
- aprovar crédito sem registro;
- emitir nota fiscal;
- controlar contas a pagar agora;
- apagar histórico financeiro;
- alterar status da proposta sem respeitar regras financeiras.

---

## Componentes necessários

- FinanceiroDashboardPage
- ContasReceberListPage
- CobrancaDetailPage
- CriarCobrancaDialog
- FormaPagamentoSelector
- EmpresaRecebedoraSelector
- BoletosListPage
- BoletoDetailPanel
- SolicitacoesCreditoPage
- CreditoAnaliseCard
- FinanceiroActionsMenu
- PagamentoStatusBadge
- CobrancaResumoCard
- PropostasChatFinanceiroPanel

---

## Serviços necessários

- financeiroService
- pagamentosService
- boletosService
- creditoService
- cobrancaService
- propostasChatService
- empresasService

---

## RPCs / funções recomendadas

Preferir RPCs ou backend seguro para:

- criar cobrança;
- gerar PIX;
- gerar boleto;
- gerar checkout cartão;
- confirmar pagamento;
- cancelar cobrança;
- aprovar faturado;
- reprovar faturado;
- registrar mensagem financeira;
- recalcular saldo da proposta;
- sincronizar status da proposta.

---

## Primeira implementação sugerida

Etapa 1:

- criar lista de contas a receber usando `pagamentos_v2`;
- filtros por status, empresa, cliente, vencimento e tipo;
- menu de ações.

Etapa 2:

- criar detalhe da cobrança;
- mostrar proposta, cliente, empresa, valores e status.

Etapa 3:

- criar fluxo de criação de cobrança a partir da proposta;
- escolher forma de pagamento;
- escolher empresa recebedora.

Etapa 4:

- integrar ações com backend existente;
- gerar PIX, boleto ou checkout.

Etapa 5:

- criar tela de boletos;
- listar e abrir PDFs.

Etapa 6:

- criar tela de solicitações de crédito/faturado;
- usar `propostas_chat` como histórico/log.

Etapa 7:

- planejar contas a pagar como módulo futuro.

---

## Resultado esperado

Ao final deste módulo, o sistema deve permitir:

- controlar contas a receber;
- criar cobranças a partir de propostas;
- escolher empresa recebedora;
- gerar PIX, boleto e cartão;
- tratar faturado com análise de crédito;
- registrar pedidos de crédito para o financeiro;
- acompanhar pagamento;
- confirmar ou cancelar cobranças;
- visualizar boletos;
- manter histórico financeiro da proposta.

---

## Observações importantes

O backend financeiro atual já está avançado.

O novo sistema deve aproveitar esse backend, não substituir sem necessidade.

O maior ganho do novo front deve ser:

- clareza do fluxo;
- melhor tela de criação de cobrança;
- melhor visualização de status;
- melhor controle das solicitações de crédito;
- melhor uso de `propostas_chat`;
- menos dependência visual do FlutterFlow;
- mais segurança para ações críticas.

Contas a pagar deve ficar planejado, mas não bloquear o início do novo sistema.