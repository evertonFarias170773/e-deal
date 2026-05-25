# Módulos Planejados — 11 a 16

Estes módulos ainda não estão totalmente construídos no sistema atual, então devem ser tratados como módulos base/planejados para completar o mapa do novo ERP.

A regra geral é:

- não inventar estrutura definitiva sem validação;
- aproveitar tudo que já existe no Supabase;
- criar módulos simples no início;
- evoluir conforme o uso real;
- manter relação com `propostas.id_int`, que é a chave central do fluxo comercial.

---

# Módulo 11 — Pedidos

## Objetivo

Controlar a etapa posterior à aprovação financeira/comercial da proposta.

O Pedido representa uma proposta aprovada, pronta para seguir para produção, OS, expedição, financeiro e fiscal.

Hoje essa área ainda não está totalmente construída, então o módulo deve nascer de forma simples e evolutiva.

---

## Conceito

A proposta é o orçamento/venda em negociação.

O pedido é a venda aprovada.

Fluxo esperado:

```text
Proposta
↓
Pagamentos aprovados
↓
Pedido
↓
OS / Produção
↓
Expedição
↓
Conclusão

Origem do pedido

A origem principal de um pedido deve ser:

propostas.id_int

Um pedido só deve ser criado quando a proposta estiver financeiramente aprovada.

Regra atual de aprovação financeira:

pagamentos_v2.status = PAID
ou
pagamentos_v2.status = A_VENCER e confirmado = true

Se a proposta tiver pagamentos divididos, todos os pagamentos válidos vinculados ao mesmo id_int precisam estar aprovados.

Tabela existente

Existe uma tabela chamada:

public.pedidos

Ela pode ser usada como ponto inicial, mas precisa ser revisada antes de virar fonte definitiva.

Campos conhecidos:

id
id_cliente
id_int
id_endereco
id_cotacao_azul
id_vendedor
status_pedido
status_pagamento
status_arte
status_producao
status_expedicao
descricao
valor_total
forma_pagamento
data_pedido
data_aprovacao_arte
data_termino
codigo_rastreamento
link_pagamento
nota_fiscal_url
obs
Status sugeridos
status_pedido
NOVO
EM_ANDAMENTO
EM_PRODUCAO
AGUARDANDO_ARTE
AGUARDANDO_EXPEDICAO
FINALIZADO
CANCELADO
status_pagamento
AGUARDANDO
APROVADO
PARCIAL
CANCELADO
status_arte
PENDENTE
EM_ANALISE
APROVADA
REPROVADA
NAO_NECESSARIA
status_producao
PENDENTE
EM_PRODUCAO
CONCLUIDA
PAUSADA
status_expedicao
PENDENTE
SEPARADO
ENVIADO
ENTREGUE
RETIRADO
CANCELADO
Páginas necessárias
Lista de pedidos

Filtros:

número/id;
cliente;
status;
vendedor;
empresa;
período;
produção;
expedição.

Colunas desktop:

Pedido
Proposta
Cliente
Valor
Status pedido
Arte
Produção
Expedição
Data
Ações
Detalhe do pedido

Seções:

resumo;
cliente;
proposta origem;
itens;
pagamento;
arte;
produção;
expedição;
fiscal;
histórico.
Criar pedido a partir da proposta

Deve ser feito por ação segura.

Ação sugerida:

Gerar pedido

Essa ação deve:

validar aprovação financeira;
copiar dados principais da proposta;
vincular id_int;
copiar cliente;
copiar endereço;
copiar itens;
iniciar status;
registrar histórico.
Menu de ações

Ações possíveis:

Abrir pedido
Ver proposta origem
Ver financeiro
Gerar OS
Ver fiscal
Alterar status
Adicionar observação
Cancelar pedido
O que este módulo faz
representa a venda aprovada;
organiza o fluxo entre proposta e produção;
centraliza status operacional;
prepara geração de OS;
apoia expedição;
liga financeiro, fiscal e produção.
O que este módulo não faz
não cria orçamento;
não confirma pagamento;
não emite nota;
não controla produção detalhada;
não substitui OS.
Primeira implementação sugerida
Criar lista simples de pedidos.
Criar pedido a partir de proposta aprovada.
Exibir detalhe do pedido.
Permitir alteração controlada de status.
Preparar botão para gerar OS.
Módulo 12 — OS / Produção
Objetivo

Controlar a produção dos itens vendidos, desde a liberação do pedido até a conclusão da produção.

Este módulo ainda será construído, então deve nascer com estrutura clara e flexível.

Conceito

A OS é a ordem de serviço/produção.

Ela deve nascer a partir de um pedido ou proposta aprovada.

Fluxo esperado:

Pedido aprovado
↓
Gerar OS
↓
Produção
↓
Conferência
↓
Pronto para expedição
Entidades sugeridas

Como ainda não existe estrutura definitiva, sugerir criação futura de tabelas como:

ordens_servico
ordens_servico_itens
ordens_servico_etapas
ordens_servico_historico
ordens_servico_anexos

Nenhuma tabela deve ser criada sem revisão.

Campos esperados da OS
número da OS;
id_int;
pedido origem;
cliente;
vendedor;
empresa;
produto;
quantidade;
variações;
prazo;
status;
responsável;
setor;
observações;
arquivos/anexos;
data início;
data prevista;
data conclusão.
Status sugeridos
NOVA
AGUARDANDO_ARTE
ARTE_APROVADA
EM_PRODUCAO
PAUSADA
AGUARDANDO_MATERIAL
CONCLUIDA
ENVIADA_EXPEDICAO
CANCELADA
Etapas possíveis
conferência do pedido;
arte/layout;
aprovação de arte;
impressão;
acabamento;
conferência;
embalagem;
liberação para expedição.
Páginas necessárias
Lista de OS

Filtros:

número OS;
cliente;
produto;
status;
responsável;
prazo;
setor;
pedido/proposta.

Colunas desktop:

OS
Cliente
Produto
Quantidade
Status
Responsável
Prazo
Ações
Detalhe da OS

Seções:

resumo;
cliente;
produto;
arte;
produção;
etapas;
anexos;
observações;
histórico;
expedição.
Quadro de produção

Visão estilo kanban ou lista por etapa:

Nova
Aguardando arte
Em produção
Conferência
Pronta
Relação com Maestro

O Maestro pode gerar briefing de arte para a OS.

A OS pode receber:

descrição do produto;
prompt de arte;
observações comerciais;
textos obrigatórios;
dados variáveis;
instruções de segurança.
Relação com Produtos

A OS deve usar informações do produto:

nome;
formato;
variações;
prazo;
personalização;
nível de segurança;
instruções técnicas.
Menu de ações
Abrir OS
Alterar etapa
Adicionar observação
Anexar arquivo
Imprimir OS
Ver pedido
Ver proposta
Enviar para expedição
Cancelar OS
O que este módulo faz
controla produção;
organiza etapas;
registra histórico;
centraliza arquivos;
conecta pedido com expedição;
ajuda a operação a saber o que produzir.
O que este módulo não faz
não cria proposta;
não aprova pagamento;
não emite nota;
não controla entrega final sozinha.
Primeira implementação sugerida
Criar OS a partir de pedido.
Criar lista de OS.
Criar detalhe da OS.
Criar alteração simples de status.
Criar histórico de observações.
Criar anexos.
Criar visão de produção.
Módulo 13 — Expedição
Objetivo

Controlar a saída dos pedidos produzidos, incluindo retirada, entrega, transportadora, código de rastreio e status de entrega.

Este módulo ainda não está construído, então deve começar simples.

Conceito

A expedição começa quando a produção/OS está concluída.

Fluxo esperado:

OS concluída
↓
Expedição
↓
Separação
↓
Envio ou retirada
↓
Entregue/finalizado
Origem

A expedição deve se relacionar com:

pedido;
OS;
proposta;
cliente;
endereço escolhido;
transportadora;
cotação de frete.

Chave principal de ligação:

id_int

Dados necessários
cliente;
endereço de entrega;
contato;
telefone/WhatsApp;
transportadora;
serviço;
valor do frete;
prazo;
código de rastreio;
data envio;
data entrega;
observações;
status.
Status sugeridos
PENDENTE
AGUARDANDO_PRODUCAO
PRONTO_PARA_ENVIO
SEPARADO
ENVIADO
RETIRADO
ENTREGUE
PROBLEMA_ENTREGA
CANCELADO
Páginas necessárias
Lista de expedição

Filtros:

cliente;
status;
transportadora;
data;
cidade/UF;
pedido;
OS.

Colunas desktop:

Pedido/OS
Cliente
Cidade/UF
Transportadora
Status
Data envio
Rastreio
Ações
Detalhe da expedição

Seções:

cliente;
endereço;
itens;
transportadora;
frete;
rastreio;
histórico;
observações.
Relação com frete

Pode usar dados de:

cotacao_frete

A cotação escolhida no orçamento deve alimentar a expedição.

Relação com NF-e

Para produtos com NF-e, a expedição pode precisar do DANFE.

A expedição deve mostrar:

NF-e autorizada;
DANFE disponível;
XML disponível;
chave da nota.
Menu de ações
Abrir expedição
Ver OS
Ver pedido
Ver cliente
Copiar rastreio
Marcar como enviado
Marcar como entregue
Registrar problema
Cancelar envio
O que este módulo faz
controla saída do pedido;
organiza entregas;
registra rastreio;
registra retirada;
acompanha status de entrega.
O que este módulo não faz
não produz itens;
não calcula orçamento;
não confirma pagamento;
não emite nota fiscal.
Primeira implementação sugerida
Criar lista de expedições.
Criar expedição a partir de OS concluída.
Permitir informar transportadora/rastreio.
Permitir alterar status.
Registrar histórico.
Módulo 14 — Configurações / Cadastros Auxiliares
Objetivo

Centralizar cadastros auxiliares e parâmetros usados em todo o ERP.

Este módulo deve ser restrito a usuários administrativos.

Conceito

Configurações não são operação diária de venda.
São bases que alimentam outros módulos.

Exemplos:

tipos de contato;
tipos de endereço;
grupos de produtos;
unidades;
status do pedido;
dados da empresa;
CFOP;
natureza da operação;
NCM;
serviços padrão;
modelos de cobrança;
modelos de PDF.
Áreas de configuração
Empresas

Tabela:

empresas

Controla:

nome;
razão social;
CNPJ;
logomarca;
dados bancários;
dados fiscais;
NF-e;
NFS-e;
ambiente;
habilitações;
dados de contato.
Natureza da operação / CFOP

Tabela:

nfe_naturezas_operacao

Controla:

CFOP;
descrição;
tipo operação;
destino operação;
modelo fiscal;
ativo.
NCM

Tabela:

nfe_ncm

Controla:

código;
descrição;
data início;
data fim;
ativo;
fonte.
Serviços padrão NFS-e

Tabela:

nfse_servicos_padrao

Controla:

nome;
descrição padrão;
código serviço;
código tributação nacional ISS;
item lista serviço;
código NBS;
município prestação;
ISS retido;
ativo.
Modelos de cobrança

Tabela:

modelos_cobranca

Controla:

entrada;
quantidade de parcelas;
início;
intervalo;
modelo;
resultado.
Modelos de PDF de proposta

Tabela:

pdf_propostas_modelos

Controla:

empresa;
pagamento;
modelo;
arquivo/modelo PDF.
Produtos auxiliares

Pode incluir:

categorias;
grupos de produtos;
unidades;
cores;
variações;
origem do produto.
Páginas necessárias
Configurações gerais
Empresas
Fiscal
Produtos auxiliares
Cobrança
Modelos de PDF
Usuários e permissões, se aplicável
Regras importantes
Configurações devem ser protegidas por permissão.
Alterações podem impactar vários módulos.
Não excluir registros usados historicamente.
Preferir ativo = false.
Alterações fiscais exigem cuidado.
Dados de empresa não devem ser editados dentro da nota, e sim aqui.
Menu de ações
Ver
Editar
Ativar/Inativar
Duplicar
Ver dependências, quando possível
O que este módulo faz
mantém cadastros auxiliares;
organiza parâmetros do sistema;
centraliza dados da empresa;
apoia fiscal, financeiro, produtos e propostas.
Primeira implementação sugerida
Criar tela de empresas.
Criar tela fiscal auxiliar.
Criar tela de modelos de cobrança.
Criar tela de modelos de PDF.
Criar cadastros auxiliares simples.
Módulo 15 — Dashboard
Objetivo

Exibir uma visão rápida e resumida do sistema, separada por área.

O dashboard deve ajudar o usuário a entender o que precisa de atenção.

Tipos de dashboard
Dashboard Comercial

Indicadores:

propostas criadas;
propostas aprovadas;
propostas aguardando;
vendas por vendedor;
ticket médio;
clientes ativos;
propostas pendentes.
Dashboard Financeiro

Indicadores:

total recebido;
total a receber;
vencidos;
vencem hoje;
a vencer;
cobranças pendentes;
crédito aguardando aprovação;
boletos em aberto.
Dashboard Gerencial

Indicadores:

faturamento por empresa;
vendas por período;
margem, se disponível;
ranking de clientes;
ranking de vendedores;
produtos mais vendidos.
Dashboard Produção

Indicadores:

OS abertas;
OS atrasadas;
OS em produção;
aguardando arte;
concluídas;
expedições pendentes.
Dashboard Fiscal

Indicadores:

NF-e pendentes;
NF-e autorizadas;
NF-e com erro;
NFS-e pendentes;
NFS-e autorizadas;
notas aguardando correção.
Padrão visual

O dashboard deve usar:

cards de resumo;
gráficos simples;
listas de pendências;
alertas;
atalhos para ações.

Evitar dashboard poluído.

Regras importantes
Dashboard deve respeitar permissões.
Usuário vê apenas dados permitidos.
Super admin pode ver consolidado.
Vendedor pode ver visão própria.
Financeiro vê visão financeira.
Produção vê visão operacional.
Páginas necessárias
Dashboard inicial
Dashboard comercial
Dashboard financeiro
Dashboard produção
Dashboard fiscal
Dashboard gerencial
Primeira implementação sugerida
Criar dashboard inicial com cards simples.
Criar filtros por período e empresa.
Criar cards por área.
Adicionar listas de pendências.
Evoluir para gráficos.
Módulo 16 — Relatórios
Objetivo

Permitir consulta, análise, exportação e impressão de dados do ERP.

Relatórios devem ser mais analíticos e menos operacionais que as listas dos módulos.

Tipos de relatórios
Relatórios de vendas
vendas por período;
vendas por vendedor;
vendas por empresa;
produtos vendidos;
clientes mais ativos;
propostas aprovadas;
ticket médio.
Relatórios de OS / Produção
OS abertas;
OS concluídas;
OS atrasadas;
produção por período;
produção por produto;
produtividade por etapa.
Relatórios financeiros
recebidos;
a receber;
vencidos;
faturados;
boletos;
cartão;
PIX;
crédito;
inadimplência;
previsão de caixa.
Relatórios fiscais
NF-e emitidas;
NFS-e emitidas;
notas por empresa;
notas por cliente;
notas com erro;
valores fiscais por período.
Outros relatórios
clientes;
produtos;
transportadoras;
uso do Maestro;
expedições;
pendências.
Padrão de relatório

Todo relatório deve ter:

título;
período;
filtros;
totalizadores;
tabela;
exportação;
data de geração;
usuário que gerou, quando necessário.
Filtros comuns
período;
empresa;
cliente;
vendedor;
status;
tipo;
forma de pagamento;
produto;
categoria.
Exportações

Formatos desejados:

CSV;
Excel;
PDF;
impressão.
Regras importantes
Relatórios devem usar views/RPCs sempre que possível.
Não carregar grandes volumes sem paginação.
Filtros devem ser aplicados no backend.
Datas devem considerar dia inteiro.
Exibição deve respeitar timezone do Brasil.
Relatórios financeiros e fiscais devem respeitar permissões.
Páginas necessárias
Relatórios de vendas
Relatórios financeiros
Relatórios fiscais
Relatórios de produção
Relatórios personalizados
Primeira implementação sugerida
Criar central de relatórios.
Criar relatório de vendas pagas.
Criar relatório financeiro básico.
Criar relatório fiscal básico.
Criar exportação CSV/Excel.
Evoluir para PDF.
Resultado esperado

Ao final destes módulos planejados, o sistema terá um mapa completo do ERP, mesmo que alguns módulos ainda sejam implementados de forma básica no início.

A prioridade deve continuar sendo:

Não quebrar o backend existente.
Aproveitar Supabase.
Implementar módulos novos de forma incremental.
Criar telas melhores que as atuais do FlutterFlow.
Validar com uso real antes de sofisticar.