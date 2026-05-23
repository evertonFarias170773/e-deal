# Módulo 07 — Orçamentos / Propostas

## Objetivo

Controlar todo o fluxo de orçamento comercial, desde a escolha do cliente até a geração de proposta, frete, condição de pagamento, PDF e cobrança.

Este módulo é o coração comercial do ERP.

Ele conecta:

- cadastros/clientes;
- produtos;
- variações;
- formação de preço;
- descontos;
- frete;
- proposta em PDF;
- cobranças;
- financeiro;
- pedidos;
- NF-e;
- NFS-e;
- Maestro.

A tabela principal do fluxo é:

`public.propostas`

A chave operacional central é:

`id_int`

---

## Conceito do módulo

No sistema atual, o orçamento/proposta representa uma venda em construção.

Ele pode começar de várias formas:

- manualmente pelo vendedor;
- a partir de um cliente;
- a partir do Maestro;
- a partir de uma conversa comercial;
- como clone de uma proposta anterior;
- como complemento ou ajuste de pedido.

O orçamento pode evoluir para:

- proposta enviada ao cliente;
- cobrança gerada;
- pedido aprovado;
- OS/produção;
- emissão fiscal;
- entrega/expedição.

---

## Tabela principal: `propostas`

A tabela `propostas` é a base do orçamento.

Ela guarda o cabeçalho da proposta, dados do cliente, vendedor, empresa, status, totais, frete e informações gerais.

Mesmo que o sistema tenha outras tabelas relacionadas, a proposta é identificada principalmente por:

`id_int`

---

## Chave operacional principal

### `id_int`

Identificador central da proposta.

Uso:

- relacionar produtos da proposta;
- relacionar pagamentos;
- relacionar cotação de frete;
- relacionar boletos;
- relacionar NF-e;
- relacionar NFS-e;
- relacionar futuro pedido;
- relacionar futura OS;
- localizar histórico comercial.

Regra:

Sempre que possível, usar `id_int` como referência principal do orçamento/proposta.

---

## Tabelas diretamente relacionadas

O módulo de Orçamentos não usa apenas `propostas`.

Ele depende de várias tabelas relacionadas:

- `propostas`
- `produtos_proposta`
- `produtos`
- `produto_variacoes`
- `produtos_proposta_variacao`
- `clientes`
- `enderecos`
- `contatos`
- `cotacao_frete`
- `desconto_proposta`
- `pagamentos_v2`
- `boletos`
- `pdf_propostas_modelos`
- `empresas`

---

## Tabela relacionada: `produtos_proposta`

A tabela `produtos_proposta` representa os itens adicionados ao orçamento.

Cada linha representa um produto dentro de uma proposta.

Relacionamento:

`produtos_proposta.id_int` → `propostas.id_int`

Uso:

- listar itens do orçamento;
- calcular subtotal;
- calcular peso;
- calcular prazo;
- aplicar variações;
- gerar PDF da proposta;
- alimentar NF-e;
- alimentar futura OS.

Cada item da proposta deve guardar os dados necessários para preservar o histórico da venda, mesmo que o cadastro do produto seja alterado futuramente.

---

## Tabela relacionada: `produtos`

A tabela `produtos` fornece a base do catálogo.

Uso no orçamento:

- buscar produto;
- buscar nome;
- buscar formato;
- buscar valor unitário;
- buscar valor fixo;
- buscar peso;
- buscar prazo;
- buscar descrição;
- buscar personalização;
- buscar nível de segurança;
- buscar apelidos para o Maestro.

A chave usada é:

`produtos.id_produto`

---

## Tabela relacionada: `produto_variacoes`

A tabela `produto_variacoes` define quais variações um produto pode ter.

Exemplos:

- cor;
- tamanho;
- espessura;
- acabamento;
- tipo de impressão;
- furação;
- tipo de dados;
- material;
- modelo.

Uso no orçamento:

- exibir opções configuráveis;
- exigir variações obrigatórias;
- permitir múltiplas escolhas quando aplicável;
- influenciar preço, peso ou descrição.

---

## Tabela relacionada: `produtos_proposta_variacao`

A tabela `produtos_proposta_variacao` deve registrar as variações escolhidas em cada item da proposta.

Uso:

- preservar a configuração exata vendida;
- montar descrição completa do item;
- alimentar cálculo;
- alimentar PDF;
- alimentar OS;
- alimentar fiscal, se necessário.

Exemplo:

Produto:

`Cartão PVC`

Variações escolhidas:

- espessura: 0.76mm;
- impressão: frente e verso;
- acabamento: com furo;
- dados: variáveis.

---

## Tabela relacionada: `clientes`

A tabela `clientes` fornece o cadastro principal do cliente da proposta.

Uso:

- definir cliente;
- buscar nome;
- buscar documento;
- buscar e-mails;
- buscar WhatsApp;
- buscar condição/risco de crédito;
- buscar vendedor;
- buscar categoria;
- alimentar proposta;
- alimentar cobrança;
- alimentar nota fiscal.

A chave principal usada é:

`clientes.id_cliente`

---

## Tabela relacionada: `enderecos`

A tabela `enderecos` fornece os endereços do cliente.

Uso:

- endereço principal;
- endereço de entrega;
- cálculo de frete;
- cidade/UF da proposta;
- dados de NF-e/NFS-e;
- PDF da proposta.

Relacionamento:

`enderecos.id_cliente` → `clientes.id_cliente`

---

## Tabela relacionada: `contatos`

A tabela `contatos` fornece pessoas vinculadas ao cadastro.

Uso:

- contato comprador;
- contato financeiro;
- contato para envio de proposta;
- contato para WhatsApp;
- contato de entrega.

Relacionamento:

`contatos.id_cliente` → `clientes.id_cliente`

---

## Tabela relacionada: `clientes_socios`

A tabela `clientes_socios` pode influenciar o orçamento quando outro cadastro está autorizado a comprar em nome do cliente principal.

Uso:

- permitir que uma pessoa/empresa relacionada faça pedido para outro `id_cliente`;
- considerar vínculo comercial;
- apoiar resumo financeiro;
- apoiar identificação do comprador real.

A interface deve tratar isso como:

`Vínculos comerciais`  
ou  
`Autorizados a comprar`

---

## Tabela relacionada: `cotacao_frete`

A tabela `cotacao_frete` guarda opções de frete vinculadas à proposta.

Relacionamento:

`cotacao_frete.id_int` → `propostas.id_int`

Uso:

- guardar cotações de transportadoras;
- definir frete escolhido;
- salvar valor;
- salvar prazo;
- salvar serviço;
- exibir opções no orçamento;
- alimentar total final;
- alimentar expedição futuramente.

Campo importante:

`escolhido`

Quando `escolhido = true`, aquela cotação é o frete selecionado da proposta.

---

## Tabela relacionada: `desconto_proposta`

A tabela `desconto_proposta` guarda descontos vinculados ao orçamento.

Relacionamento:

`desconto_proposta.id_int` → `propostas.id_int`

Uso:

- desconto percentual;
- desconto nominal;
- validade do desconto;
- motivo/descrição;
- controle comercial.

Alterações de desconto devem ser tratadas como ação sensível.

---

## Tabela relacionada: `pagamentos_v2`

A tabela `pagamentos_v2` representa cobranças e lançamentos financeiros gerados a partir da proposta.

Relacionamento:

`pagamentos_v2.id_int` → `propostas.id_int`

Uso:

- PIX;
- boleto;
- cartão;
- cartão parcelado;
- faturado;
- status financeiro;
- confirmação;
- vínculo com pedido aprovado.

Status importantes:

- A_RECEBER
- A_VENCER
- PAID
- CANCELADO
- CARD_PARCELADO

---

## Tabela relacionada: `boletos`

A tabela `boletos` registra boletos gerados a partir de uma cobrança/proposta.

Relacionamento:

`boletos.id_int` → `propostas.id_int`

Uso:

- parcela;
- vencimento;
- valor;
- linha digitável;
- código de barras;
- PDF;
- status;
- juros;
- multa;
- atraso.

---

## Tabela relacionada: `pdf_propostas_modelos`

A tabela `pdf_propostas_modelos` guarda modelos de PDF para proposta.

Uso:

- selecionar modelo por empresa;
- selecionar modelo por forma de pagamento;
- gerar PDF personalizado;
- respeitar identidade visual da empresa.

---

## Tabela relacionada: `empresas`

A tabela `empresas` define a empresa vinculada à proposta.

Uso:

- logomarca;
- dados da empresa;
- modelo de proposta;
- credenciais financeiras/fiscais;
- separação multiempresa;
- emissão futura de nota;
- geração de cobrança.

Empresas conhecidas:

- `1` — Ideal Gráfica
- `2` — Ideal Birô
- `3` — E3 Brindes

---

## Fluxo principal do orçamento

1. Vendedor inicia um orçamento.
2. Define ou busca o cliente.
3. Sistema carrega dados do cliente.
4. Vendedor adiciona produtos.
5. Sistema busca dados dos produtos.
6. Sistema aplica quantidade, variações e adicionais.
7. Sistema calcula subtotal dos itens.
8. Sistema calcula peso e prazo.
9. Sistema permite cotar frete.
10. Vendedor escolhe transportadora/frete.
11. Sistema calcula total final.
12. Vendedor define condição de pagamento.
13. Sistema gera PDF da proposta, se necessário.
14. Sistema gera cobrança, se necessário.
15. Proposta pode ser enviada ao cliente.
16. Quando aprovada/paga/confirmada, pode virar pedido.

---

## Criação do orçamento

O orçamento pode ser criado por:

### Manualmente

Vendedor entra na tela de nova proposta e seleciona cliente/produtos.

### A partir do cadastro do cliente

Na tela do cliente, ação:

`Criar proposta`

### A partir do Maestro

O Maestro interpreta o pedido, calcula orçamento e pode transformar em proposta formal.

### A partir de proposta existente

Ação:

`Duplicar proposta`

ou

`Clonar proposta`

---

## Definir cliente

A primeira etapa do orçamento deve ser definir o cliente.

Busca por:

- `id_cliente`;
- nome;
- fantasia;
- apelido;
- documento;
- WhatsApp;
- e-mail.

Ao selecionar o cliente, o sistema deve carregar:

- nome;
- documento;
- contatos;
- endereço principal;
- cidade/UF;
- vendedor;
- crédito/resumo financeiro;
- restrições;
- vínculos comerciais;
- padrão de pagamento.

Se o cliente tiver restrição, mostrar alerta visual.

---

## Vínculos comerciais no orçamento

Se o cliente tiver registros em `clientes_socios`, o orçamento deve permitir identificar se há um comprador autorizado ou cadastro relacionado.

Exemplo:

- cliente principal: empresa;
- comprador autorizado: pessoa física;
- pedido vinculado financeiramente ao cliente principal.

Essa regra deve ser tratada com cuidado para resumo financeiro e histórico.

---

## Adição de produtos

Ao adicionar produto, o sistema deve buscar dados em `produtos`.

Dados carregados:

- nome;
- formato;
- valor unitário;
- valor fixo;
- peso;
- prazo;
- descrição;
- categoria;
- personalização;
- nível de segurança;
- variações;
- fotos, quando útil.

O item adicionado deve ficar salvo em `produtos_proposta`.

---

## Formação do custo

A formação do custo deve considerar:

- valor unitário;
- quantidade;
- valor fixo;
- variações;
- adicionais;
- desconto;
- frete;
- regras específicas do produto;
- possíveis mínimos;
- arredondamentos;
- condições comerciais.

Regra geral esperada:

`subtotal_item = quantidade × valor_unitario + valor_fixo + extras`

Mas produtos específicos podem ter regras próprias.

Se existir trigger, RPC ou função de cálculo no Supabase, o front deve usar essa regra em vez de recalcular tudo localmente.

---

## Variações no orçamento

Quando o produto possuir variações, o sistema deve exibir os campos necessários.

Exemplos:

- cor;
- tamanho;
- espessura;
- tipo de impressão;
- acabamento;
- furação;
- dados variáveis.

Se a variação for obrigatória, o orçamento não pode ser finalizado sem preencher.

As variações escolhidas devem ser salvas em `produtos_proposta_variacao`.

---

## Quantidade

Quantidade é obrigatória para cálculo.

Regras:

- não permitir quantidade vazia;
- não permitir quantidade zero;
- validar quantidade mínima, se houver;
- recalcular item ao alterar quantidade;
- atualizar peso total;
- atualizar total da proposta.

---

## Peso e frete

O sistema deve calcular ou buscar peso total da proposta a partir dos produtos.

O peso influencia:

- cotação de frete;
- transportadora;
- expedição;
- NF-e;
- OS/produção.

Se peso estiver ausente ou zerado, mostrar alerta.

---

## Cotação de frete

O orçamento deve permitir buscar opções de frete.

Dados necessários:

- CEP destino;
- cidade/UF;
- peso;
- dimensões, quando disponíveis;
- valor declarado, se necessário;
- empresa remetente;
- produto/quantidade.

Opções de frete devem ser salvas em `cotacao_frete`.

Cada opção pode conter:

- serviço;
- transportadora;
- valor;
- prazo;
- agência/loja;
- telefone;
- observação;
- flag `escolhido`.

---

## Definição da transportadora

Após cotar frete, o vendedor deve escolher uma opção.

A opção escolhida deve:

- alimentar o total final;
- aparecer no PDF da proposta;
- aparecer na proposta informal;
- alimentar pedido/expedição futuramente;
- alimentar NF-e se houver transporte;
- ficar marcada em `cotacao_frete.escolhido = true`.

Só deve haver uma cotação escolhida por proposta, salvo regra futura.

---

## Descontos

O orçamento pode receber desconto.

Tipos possíveis:

- percentual;
- valor nominal;
- cupom/código;
- condição especial.

Tabela:

`desconto_proposta`

Regras:

- desconto deve recalcular total;
- desconto deve aparecer no resumo;
- desconto pode exigir permissão;
- desconto pode ter validade;
- desconto deve ficar registrado.

---

## Condição de pagamento

A proposta pode ter condição de pagamento definida.

Tipos conhecidos:

- PIX;
- BOLETO;
- CREDIT_CARD;
- CARD_PARCELADO;
- E-Faturado.

A condição de pagamento pode gerar registros em `pagamentos_v2`.

Campos recentes relacionados a parcelamento:

- `p_valor_entrada`
- `p_qtd_parcelas`
- `p_dias_pra_inicio`
- `p_intervalo`

Esses campos ajudam a montar cobrança parcelada ou faturada.

---

## Geração de cobrança

A partir do orçamento/proposta, o sistema pode gerar cobrança.

Tipos:

### PIX

Gera cobrança PIX e link/status público.

### Boleto

Gera boleto, linha digitável, código de barras e PDF.

### Cartão

Gera checkout de cartão.

### Cartão parcelado

Permite escolher parcelas e embutir taxa no valor final.

### Faturado

Gera cobrança com vencimento futuro e pode depender de crédito/aprovação.

A cobrança deve ser registrada em `pagamentos_v2`.

---

## Status da proposta

Status internos conhecidos ou esperados:

- NOVO
- AGUARDANDO
- APROVADO
- CANCELADO

Interpretação:

### NOVO

Orçamento criado, ainda sem pagamento/condição final definida.

### AGUARDANDO

Existe solicitação financeira, faturamento ou cobrança pendente de aprovação/confirmação.

### APROVADO

Proposta aprovada comercialmente/financeiramente.

Pode ocorrer quando pagamento está:

- PAID;
- A_VENCER com `confirmado = true`.

### CANCELADO

Proposta cancelada ou todos os pagamentos vinculados foram cancelados.

---

## Regras de status financeiro

A proposta não deve ser aprovada apenas visualmente.

Ela deve respeitar a relação com `pagamentos_v2`.

Regra conhecida:

Se pagamento está `A_VENCER` e `confirmado = true`, a proposta pode ser considerada aprovada.

Se pagamento está `PAID`, a proposta pode ser considerada aprovada.

Se todos os pagamentos estão `CANCELADO`, a proposta pode ir para cancelada.

Se houver mistura de pagamentos pendentes e pagos, manter conforme regra financeira existente.

---

## Geração de PDF da proposta

A proposta deve poder gerar PDF.

O PDF deve usar:

- dados da empresa;
- logomarca;
- dados do cliente;
- itens;
- valores;
- frete;
- prazo;
- condição de pagamento;
- observações;
- modelo adequado.

Tabela relacionada:

`pdf_propostas_modelos`

O PDF pode variar por:

- empresa;
- modelo;
- forma de pagamento;
- layout comercial.

O PDF deve ser gerado por Edge Function ou backend seguro, não diretamente no front quando exigir lógica complexa.

---

## Proposta informal

Além do PDF formal, o sistema deve permitir proposta informal, especialmente via Maestro.

A proposta informal pode ser copiada para WhatsApp.

Deve conter:

- cliente;
- produto;
- quantidade;
- valor;
- prazo;
- frete;
- total;
- condição;
- texto comercial.

---

## Integração com Maestro

O Maestro pode criar ou preparar orçamento.

Fluxo esperado:

1. Vendedor envia pedido ao Maestro.
2. Maestro identifica cliente, produto e quantidade.
3. Maestro busca dados no Supabase.
4. Maestro calcula orçamento.
5. Maestro busca frete.
6. Maestro formata proposta informal.
7. Vendedor confirma.
8. Maestro pode criar proposta formal via função segura.

O Maestro não deve criar proposta formal sem confirmação do vendedor.

---

## Integração com Financeiro

O orçamento gera a base do financeiro.

Quando houver condição de pagamento, o sistema pode criar registros em:

`pagamentos_v2`

A proposta deve exibir resumo financeiro:

- valor total;
- valor pago;
- saldo pendente;
- status dos pagamentos;
- tipo de cobrança;
- vencimentos;
- confirmação.

---

## Integração com Notas Fiscais

A proposta aprovada pode originar:

- NF-e;
- NFS-e;
- ou ambas, conforme natureza da venda.

Dados necessários:

- cliente;
- produtos;
- valores;
- frete;
- forma de pagamento;
- empresa emitente;
- endereço;
- CFOP/natureza;
- itens fiscais.

A proposta não deve emitir nota diretamente.  
Ela deve iniciar rascunho fiscal ou direcionar para o módulo fiscal.

---

## Integração com Pedidos

Quando a proposta for aprovada, ela pode gerar um pedido.

Como o módulo de Pedidos ainda está em aberto, o orçamento deve deixar preparado:

- status aprovado;
- itens;
- cliente;
- frete;
- pagamento;
- observações;
- dados para OS/produção.

O pedido deve nascer de uma proposta aprovada.

---

## Integração com OS / Produção

Produtos aprovados em proposta devem alimentar futura OS.

Dados importantes:

- cliente;
- produto;
- quantidade;
- variações;
- prazo;
- arte;
- observações;
- dados de entrega;
- vendedor;
- arquivos/anexos.

O módulo de Orçamento não controla produção, mas fornece a base.

---

## Páginas do módulo

### Lista de orçamentos/propostas

Objetivo:

Permitir localizar e acompanhar propostas.

Filtros:

- `id_int`;
- cliente;
- vendedor;
- empresa;
- status;
- período;
- tipo de cobrança;
- valor;
- aprovado/pendente/cancelado.

Colunas desktop sugeridas:

- Nº proposta
- Cliente
- Empresa
- Vendedor
- Data
- Status
- Valor
- Cobrança
- Ações

No mobile, cada proposta vira card.

---

### Nova proposta

Objetivo:

Criar orçamento manualmente.

Etapas:

1. Selecionar cliente
2. Selecionar produtos
3. Configurar variações
4. Definir quantidades
5. Calcular valores
6. Cotar frete
7. Definir condição de pagamento
8. Gerar proposta/PDF/cobrança

---

### Edição da proposta

Objetivo:

Permitir ajustes antes da aprovação.

Seções sugeridas:

- Cabeçalho
- Cliente
- Itens
- Frete
- Descontos
- Pagamento
- PDF
- Histórico
- Observações

---

### Detalhe da proposta

Objetivo:

Exibir visão completa da proposta.

Deve mostrar:

- cliente;
- status;
- vendedor;
- empresa;
- itens;
- total;
- frete;
- condição de pagamento;
- cobranças;
- PDF;
- histórico;
- botões de ação.

---

### Proposta aprovada

Objetivo:

Mostrar proposta já aprovada e permitir próximos passos.

Ações:

- gerar pedido;
- gerar OS;
- gerar NF-e;
- gerar NFS-e;
- ver financeiro;
- ver PDF;
- clonar.

---

## Menu de ações por linha

Seguir a Skill 02.

Não usar vários ícones soltos.

A coluna final deve ser:

`Ações`

Ações possíveis:

- Abrir proposta
- Editar proposta
- Duplicar proposta
- Gerar PDF
- Copiar proposta informal
- Gerar cobrança
- Ver financeiro
- Cadastrar frete
- Gerar pedido
- Gerar OS
- Emitir NF-e
- Emitir NFS-e
- Cancelar proposta

Ações críticas separadas no final.

---

## Ações críticas

Exigem confirmação:

- cancelar proposta;
- alterar cliente da proposta;
- remover produto;
- alterar valores manualmente;
- aplicar desconto;
- trocar empresa;
- gerar cobrança;
- aprovar faturado;
- gerar pedido;
- gerar OS;
- iniciar emissão fiscal.

---

## Alertas importantes

A proposta deve mostrar alertas quando:

- cliente tem restrição;
- documento inválido;
- endereço ausente;
- produto sem peso;
- produto sem preço;
- produto inativo;
- variação obrigatória não selecionada;
- frete não definido;
- pagamento não configurado;
- valor da cobrança diverge do total;
- há saldo pendente;
- cliente não possui crédito suficiente.

---

## Padrão de resumo da proposta

O resumo deve mostrar:

- subtotal produtos;
- desconto;
- frete;
- total final;
- total cobrado;
- total pago;
- saldo pendente;
- status financeiro.

---

## Padrão mobile

No celular, a proposta deve ser editável sem tabela larga.

Padrão:

- cabeçalho fixo com nº proposta, cliente e status;
- cards para itens;
- cards para frete;
- cards para pagamento;
- resumo financeiro fixo ou recolhível;
- ações principais no rodapé;
- menu de ações em bottom sheet.

---

## O que este módulo faz

Este módulo permite:

- criar orçamento;
- escolher cliente;
- adicionar produtos;
- configurar variações;
- calcular valores;
- consultar frete;
- escolher transportadora;
- aplicar desconto;
- gerar PDF;
- gerar proposta informal;
- gerar cobrança;
- acompanhar status;
- preparar pedido;
- preparar emissão fiscal;
- alimentar Maestro.

---

## O que este módulo não faz

Este módulo não deve:

- confirmar pagamento sozinho;
- emitir nota diretamente;
- controlar produção;
- finalizar expedição;
- alterar crédito sem regra financeira;
- criar pedido sem aprovação;
- ignorar validações fiscais/financeiras;
- recalcular regras críticas fora do Supabase se já houver função oficial.

---

## Componentes necessários

- PropostasListPage
- PropostaDetailPage
- PropostaForm
- PropostaHeader
- PropostaActionsMenu
- ClienteSelector
- ProdutoSelector
- ProdutosPropostaList
- ProdutoPropostaCard
- ProdutoVariacoesSelector
- ResumoValoresProposta
- FreteCotacaoPanel
- FreteOptionsList
- PagamentoPropostaPanel
- DescontoPropostaForm
- PropostaPdfPanel
- PropostaStatusBadge
- PropostaAlertasCard

---

## Serviços necessários

- propostasService
- produtosPropostaService
- cotacaoFreteService
- descontoPropostaService
- pagamentosService
- pdfPropostaService
- maestroPropostaService
- clientesService

---

## RPCs / funções recomendadas

Sempre preferir RPCs para operações críticas.

Funções possíveis ou desejáveis:

- criar proposta;
- clonar proposta;
- recalcular proposta;
- adicionar produto;
- remover produto;
- aplicar desconto;
- escolher frete;
- gerar cobrança;
- validar proposta;
- aprovar proposta;
- cancelar proposta;
- gerar rascunho fiscal;
- gerar pedido.

Se já existirem funções no Supabase para essas ações, o novo front deve usá-las.

---

## Primeira implementação sugerida

Etapa 1:

- criar lista de propostas;
- buscar por `id_int`, cliente, status e período;
- exibir status, valor e vendedor;
- menu de ações por linha.

Etapa 2:

- criar detalhe da proposta;
- exibir cabeçalho, cliente, itens e resumo financeiro.

Etapa 3:

- criar edição básica;
- permitir alterar dados somente enquanto status permitir.

Etapa 4:

- adicionar produtos;
- salvar em `produtos_proposta`;
- recalcular totais usando regra oficial.

Etapa 5:

- integrar frete;
- listar opções;
- marcar frete escolhido.

Etapa 6:

- integrar PDF;
- gerar proposta formal.

Etapa 7:

- integrar financeiro;
- gerar cobrança.

Etapa 8:

- preparar geração de pedido/OS/fiscal.

---

## Resultado esperado

Ao final deste módulo, o sistema deve permitir:

- montar orçamento completo;
- calcular produtos;
- cotar frete;
- escolher transportadora;
- gerar proposta informal;
- gerar PDF;
- gerar cobrança;
- acompanhar aprovação;
- preparar pedido;
- alimentar financeiro;
- alimentar fiscal;
- alimentar OS.


## Escolha do cliente, comprador e endereço

No orçamento, a escolha do cliente não deve ser tratada como um simples campo de cadastro.

O sistema precisa considerar que:

1. A proposta possui um cliente principal.
2. A cobrança pode ser feita para outro cadastro vinculado.
3. O endereço de entrega/faturamento deve ser escolhido explicitamente quando houver mais de um endereço cadastrado.
4. A tabela `clientes_socios` representa vínculos comerciais/autorizados, não apenas sócios legais.

---

## Cliente principal da proposta

A proposta deve sempre ter um `id_cliente` principal.

Esse cliente principal é a entidade principal da negociação e deve alimentar:

- cabeçalho da proposta;
- histórico comercial;
- resumo financeiro;
- análise de crédito;
- emissão fiscal, quando aplicável;
- relatórios;
- vínculo com pedido/OS.

---

## Comprador ou cadastro autorizado

Como existe a tabela `clientes_socios`, o sistema deve permitir que um cadastro relacionado faça pedido em nome do cliente principal.

Exemplo:

- Cliente principal: Empresa X
- Cadastro autorizado: Pessoa Y ou Empresa Z
- Pessoa Y pode fazer pedido para Empresa X
- O resumo financeiro e histórico podem ser vinculados ao cliente principal

No front, essa escolha pode aparecer como:

`Comprador / autorizado`

ou:

`Cadastro relacionado`

Regra:

Se o cliente principal tiver vínculos comerciais, o sistema deve permitir selecionar quem está realizando o pedido.

---

## Escolha obrigatória do endereço

Quando o cliente possuir mais de um endereço em `enderecos`, o vendedor deve escolher qual endereço será usado na proposta.

Essa escolha é obrigatória quando houver múltiplos endereços.

O endereço escolhido pode impactar:

- frete;
- prazo de entrega;
- transportadora;
- NF-e;
- NFS-e;
- expedição;
- PDF da proposta;
- OS/produção.

A interface deve mostrar os endereços disponíveis de forma clara.

Exemplo:

- Endereço principal
- Endereço de entrega
- Endereço fiscal
- Endereço de cobrança

Se houver apenas um endereço, o sistema pode selecionar automaticamente, mas deve permitir revisão.

---

## Validações antes de concluir orçamento

Antes de finalizar proposta, gerar cobrança ou gerar PDF, validar:

- cliente principal definido;
- comprador/autorizado definido, se aplicável;
- endereço escolhido;
- produto adicionado;
- quantidade válida;
- frete definido, quando necessário;
- condição de pagamento definida, quando necessário;
- valores calculados;
- restrição ou crédito do cliente, quando aplicável.
---

## Observações importantes

O módulo de Orçamentos é um dos pontos mais críticos do sistema.

Ele deve ser construído com cuidado porque afeta:

- comercial;
- financeiro;
- fiscal;
- produção;
- expedição;
- relatórios;
- Maestro.

O novo sistema deve melhorar a experiência atual do FlutterFlow, principalmente em:

- edição de itens;
- responsividade;
- clareza dos totais;
- organização das ações;
- frete;
- cobrança;
- geração de PDF;
- integração com Maestro.

Não alterar regras de cálculo diretamente no front sem validar no Supabase.

Não criar proposta formal a partir do Maestro sem confirmação do vendedor.

Não apagar propostas antigas.

Cancelar ou inativar é preferível a excluir.