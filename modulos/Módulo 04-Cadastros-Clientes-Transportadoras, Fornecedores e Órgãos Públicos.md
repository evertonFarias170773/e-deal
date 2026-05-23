# Módulo 04 — Cadastros / Clientes, Transportadoras, Fornecedores e Órgãos Públicos

## Objetivo

Controlar o cadastro geral de entidades usadas no ERP.

Apesar da tabela se chamar `public.clientes`, ela não representa apenas clientes.  
Ela funciona como uma tabela ampla de cadastros, usada para registrar:

- clientes;
- transportadoras;
- fornecedores;
- órgãos públicos;
- possíveis outros tipos de contato comercial ou operacional.

A separação entre esses tipos acontece principalmente pela coluna:

`categoria`

A chave principal operacional usada no sistema é:

`id_cliente`

---

## Nome atual da tabela

Tabela atual:

`public.clientes`

Nome ideal conceitual:

`cadastros`

Porém, como o sistema está em produção e várias funções, views, telas, RPCs e fluxos já dependem de `clientes`, não é prioridade renomear agora.

Regra para o novo sistema:

- no banco, continuar usando `public.clientes`;
- na interface, chamar o módulo de `Cadastros` ou `Clientes e Cadastros`;
- internamente no código, pode usar nomes como `cadastrosService`, mas apontando para a tabela `clientes`.

---

## Chave principal

A chave operacional principal é:

`id_cliente`

Mesmo que a tabela tenha também uma coluna `id` do tipo UUID, o sistema usa `id_cliente` como referência prática em várias relações.

Exemplos de tabelas que usam ou se relacionam com `id_cliente`:

- `enderecos`
- `contatos`
- `clientes_socios`
- `propostas`
- `pagamentos_v2`
- `boletos`
- `notas_fiscais`
- `notas_servico`
- `movimento_credito`

No novo front, sempre tratar `id_cliente` como identificador principal do cadastro.

---

## Estrutura relacional do cadastro

O módulo de Cadastros não é formado apenas pela tabela `clientes`.

A tabela `clientes` é a tabela principal, mas existem tabelas diretamente relacionadas que completam o cadastro:

- `clientes`
- `enderecos`
- `contatos`
- `clientes_socios`

Essas tabelas devem ser tratadas como partes do mesmo módulo.

---

## Tabela principal: `clientes`

A tabela `clientes` é a tabela-mãe dos cadastros.

Ela armazena os dados principais da entidade cadastrada, que pode ser:

- cliente;
- transportadora;
- fornecedor;
- órgão público;
- pessoa física;
- pessoa jurídica;
- cadastro relacionado comercialmente a outro cadastro.

A chave operacional principal é:

`id_cliente`

Essa chave é usada para relacionar o cadastro com endereços, contatos, sócios/vínculos, propostas, financeiro e documentos fiscais.

A categoria do cadastro é definida pela coluna:

`categoria`

Exemplos de categoria:

- CLIENTE
- TRANSPORTADORA
- FORNECEDOR
- ORGAO_PUBLICO

---

## Tabela relacionada: `enderecos`

A tabela `enderecos` armazena os endereços vinculados ao cadastro.

Relacionamento:

`enderecos.id_cliente` → `clientes.id_cliente`

Um cadastro pode ter múltiplos endereços.

Exemplos de uso:

- endereço principal;
- endereço fiscal;
- endereço de entrega;
- endereço de cobrança;
- endereço de transportadora;
- endereço usado em NF-e;
- endereço usado em NFS-e;
- endereço usado para cálculo de frete.

Campos importantes:

- `id_cliente`
- `cep`
- `endereco`
- `numero`
- `complemento`
- `bairro`
- `cidade`
- `uf`
- `tipo_endereco`
- `obs`
- `Latitude`
- `longitude`
- `distancia`

Regra do módulo:

O cadastro deve permitir visualizar, criar, editar e remover/inativar múltiplos endereços relacionados ao mesmo `id_cliente`.

No detalhe do cadastro, deve existir uma seção própria chamada:

`Endereços`

---

## Tabela relacionada: `contatos`

A tabela `contatos` armazena pessoas físicas vinculadas a um cadastro.

Relacionamento:

`contatos.id_cliente` → `clientes.id_cliente`

Um cadastro pode ter múltiplos contatos.

Esses contatos representam pessoas físicas associadas à empresa/cadastro, como:

- comprador;
- financeiro;
- responsável fiscal;
- responsável por produção;
- contato de entrega;
- proprietário;
- gestor;
- atendente interno do cliente.

Campos importantes:

- `id_cliente`
- `nome_contato`
- `cargo`
- `whats`
- `e_mail`
- `created_at`

Regra do módulo:

Contatos não substituem o cadastro principal.  
Eles representam pessoas vinculadas ao cadastro principal.

No detalhe do cadastro, deve existir uma seção própria chamada:

`Contatos`

Cada contato deve permitir ações como:

- editar contato;
- abrir WhatsApp;
- copiar e-mail;
- remover contato;
- marcar como contato principal, se essa regra for criada futuramente.

---

## Tabela relacionada: `clientes_socios`

A tabela `clientes_socios` representa vínculos comerciais entre cadastros da própria tabela `clientes`.

Relacionamentos:

`clientes_socios.id_cliente_principal` → `clientes.id_cliente`

`clientes_socios.id_cliente_socio` → `clientes.id_cliente`

Apesar do nome `socios`, essa tabela não deve ser entendida apenas como quadro societário.

No sistema, ela representa outros cadastros, CPF ou CNPJ, que possuem relação comercial com o cadastro principal.

Uso principal:

Permitir que um cadastro relacionado faça pedidos, compras ou movimentações vinculadas ao `id_cliente_principal`, como se tivesse uma procuração/autorização comercial para comprar em nome dele.

Exemplo conceitual:

- Empresa principal: Cliente A
- Cadastro relacionado: Pessoa B ou Empresa C
- Pessoa B/Empresa C pode fazer pedidos para Cliente A
- No resumo financeiro, essas movimentações podem ser consideradas dentro do contexto do Cliente A

Campos importantes:

- `id`
- `id_cliente_principal`
- `id_cliente_socio`
- `tipo_relacao`
- `data_criacao`

Regra do módulo:

Essa tabela deve ser exibida no cadastro como uma seção chamada:

`Vínculos comerciais`

ou:

`Autorizados / Relacionados`

Evitar usar apenas o nome “Sócios” na interface, porque o significado real é mais amplo.

Sugestão de nomes para interface:

- Vínculos comerciais
- Cadastros relacionados
- Autorizados a comprar
- Pessoas/empresas autorizadas
- Relações comerciais

---

## Interpretação correta dos vínculos

A relação em `clientes_socios` deve permitir entender que:

1. Um cadastro principal pode ter vários cadastros relacionados.
2. O cadastro relacionado pode ser CPF ou CNPJ.
3. O cadastro relacionado também existe na tabela `clientes`.
4. A relação pode indicar permissão comercial para fazer pedidos em nome do cadastro principal.
5. Essa relação pode impactar resumo financeiro, histórico e análise do cliente principal.

---

## Exemplo prático

Cliente principal:

`id_cliente = 1001`  
`nome = EMPRESA PRINCIPAL LTDA`

Cadastro relacionado:

`id_cliente = 2005`  
`nome = JOÃO DA SILVA`  
`documento = CPF`

Registro em `clientes_socios`:

`id_cliente_principal = 1001`  
`id_cliente_socio = 2005`  
`tipo_relacao = autorizado`

Interpretação:

João da Silva está autorizado ou relacionado comercialmente à Empresa Principal LTDA e pode gerar pedidos vinculados a ela, conforme regra comercial do sistema.

---

## Como a tela de detalhe do cadastro deve organizar isso

A página de detalhe do cadastro deve ter seções ou abas:

1. Resumo
2. Dados principais
3. Fiscal
4. Endereços
5. Contatos
6. Vínculos comerciais
7. Crédito / Financeiro
8. Histórico
9. Observações

---

## Ações na seção Endereços

- Adicionar endereço
- Editar endereço
- Definir como principal
- Definir como entrega
- Definir como cobrança
- Remover/inativar endereço

---

## Ações na seção Contatos

- Adicionar contato
- Editar contato
- Abrir WhatsApp
- Copiar e-mail
- Remover contato

---

## Ações na seção Vínculos comerciais

- Adicionar cadastro relacionado
- Buscar cadastro existente
- Vincular CPF/CNPJ ao cadastro principal
- Definir tipo de relação
- Remover vínculo
- Abrir cadastro relacionado
- Ver movimentações relacionadas, se aplicável

---

## Regras importantes atualizadas

1. `clientes` é a tabela-mãe do cadastro.
2. `id_cliente` é a chave operacional principal.
3. `enderecos` pode ter múltiplos registros por `id_cliente`.
4. `contatos` pode ter múltiplas pessoas físicas por `id_cliente`.
5. `clientes_socios` relaciona um cadastro principal com outros cadastros da própria tabela `clientes`.
6. `clientes_socios` não representa apenas sócios legais.
7. `clientes_socios` pode representar autorização comercial para comprar/pedir em nome de outro cadastro.
8. Para resumo financeiro, os vínculos comerciais podem precisar ser considerados junto ao cadastro principal.
9. A interface deve evitar chamar essa seção apenas de “Sócios”.
10. O nome recomendado na interface é “Vínculos comerciais” ou “Autorizados”.

---

## Categorias

A coluna:

`categoria`

define o tipo de cadastro.

Categorias conhecidas ou esperadas:

- CLIENTE
- TRANSPORTADORA
- FORNECEDOR
- ORGAO_PUBLICO

A categoria padrão atual da tabela é `CLIENTE`. :contentReference[oaicite:0]{index=0}

A interface deve deixar claro que o usuário pode cadastrar tipos diferentes de entidades.

Exemplo de campo no formulário:

`Tipo de cadastro`

Opções:

- Cliente
- Transportadora
- Fornecedor
- Órgão público

---

## Tabela principal: `public.clientes`

Colunas reais importantes identificadas:

### `id`

Tipo: `uuid`

Identificador técnico da linha.

Uso:
- controle interno;
- chave primária técnica;
- não deve ser o identificador principal exibido para o usuário.

---

### `id_cliente`

Tipo: `integer`

Identificador operacional principal do cadastro.

Uso:
- buscar cliente;
- relacionar com propostas;
- relacionar com pagamentos;
- relacionar com notas fiscais;
- relacionar com endereços;
- relacionar com crédito;
- exibir na interface.

Este é o ID que o usuário costuma reconhecer no sistema.

---

### `id_vendedor`

Tipo: `uuid`

Identificador do vendedor responsável pelo cadastro.

Uso:
- vínculo comercial;
- filtros por vendedor;
- relatórios;
- controle de carteira.

---

### `nome`

Tipo: `text`

Nome principal do cadastro.

Uso:
- razão social;
- nome do cliente;
- nome da transportadora;
- nome do fornecedor;
- nome do órgão público.

Campo obrigatório na tabela.

---

### `fantasia`

Tipo: `text`

Nome fantasia.

Uso:
- exibição amigável;
- busca;
- diferenciação de empresas com razão social longa.

---

### `apelido`

Tipo: `text`

Nome curto ou apelido interno.

Uso:
- facilitar localização;
- exibição em listas;
- busca rápida.

---

### `contato`

Tipo: `text`

Contato principal.

Uso:
- pessoa responsável;
- referência comercial;
- contato da empresa.

---

### `documento`

Tipo: `text`

CPF ou CNPJ do cadastro.

Uso:
- identificação fiscal;
- emissão NF-e/NFS-e;
- cobrança;
- consulta;
- validações.

No front, deve ter máscara e validação conforme CPF ou CNPJ.

---

### `tipo_pessoa`

Tipo: `text`

Indica se é pessoa física ou jurídica.

Valores esperados:

- FISICA
- JURIDICA

Ou equivalentes usados atualmente.

---

### `ins_estadual`

Tipo: `text`

Inscrição estadual.

Uso:
- emissão NF-e;
- definição de contribuinte;
- validação fiscal.

---

### `ins_municipal`

Tipo: `text`

Inscrição municipal.

Uso:
- NFS-e;
- cadastro fiscal;
- prestação de serviço.

---

### `tipo_contribuinte`

Tipo: `text`

Indica o tipo fiscal do destinatário.

Uso:
- NF-e;
- indicador de inscrição estadual;
- validações fiscais.

Este campo é importante para o módulo fiscal.

---

### `data_fundacao`

Tipo: `date`

Data de fundação ou nascimento.

Uso:
- cadastro;
- análise de perfil;
- histórico.

---

### `email_contato`

Tipo: `text`

E-mail principal de contato.

Uso:
- comunicação;
- envio de proposta;
- envio de documentos;
- contato comercial.

---

### `email_financeiro`

Tipo: `text`

E-mail financeiro.

Uso:
- envio de cobranças;
- boletos;
- comprovantes;
- assuntos financeiros.

---

### `email`

Tipo: `text`

E-mail geral.

Pode ser redundante com `email_contato`.

No novo sistema, definir prioridade de uso:

1. `email_contato`
2. `email_financeiro`
3. `email`

---

### `telefone_fixo`

Tipo: `text`

Telefone fixo.

Uso:
- contato;
- cadastro.

---

### `whatsapp_1`

Tipo: `text`

WhatsApp principal.

Uso:
- contato comercial;
- envio de cobrança;
- comunicação rápida.

---

### `whatsapp_2`

Tipo: `text`

WhatsApp secundário.

Uso:
- contato alternativo.

---

### `site`

Tipo: `text`

Site do cadastro.

Uso:
- consulta;
- informação complementar.

---

### `ativo`

Tipo: `boolean`

Indica se o cadastro está ativo.

Uso:
- filtrar cadastros ativos;
- evitar uso de registros antigos;
- controlar visibilidade.

---

### `restricao`

Tipo: `boolean`

Indica se o cadastro possui restrição.

Uso:
- alerta comercial;
- alerta financeiro;
- bloqueio ou atenção em proposta/venda.

---

### `limite_credito`

Tipo: `numeric`

Limite de crédito base do cadastro.

Uso:
- análise de crédito;
- faturamento;
- vendas a prazo.

---

### `credito`

Tipo: `numeric`

Campo de crédito/saldo.

Uso:
- carteira;
- crédito disponível;
- análise financeira.

Precisa ser tratado junto ao módulo de crédito.

---

### `risco_credito`

Tipo: `text`

Classificação de risco.

Uso:
- análise financeira;
- bloqueio/alerta em faturamento;
- consulta comercial.

---

### `padrao_pagamento`

Tipo: `text`

Padrão de pagamento do cliente.

Exemplo atual default:

`Pix à vista 3 dias`

Uso:
- sugestão comercial;
- análise de crédito;
- condição padrão de venda.

---

### `ultima_compra`

Tipo: `date`

Data da última compra.

Uso:
- histórico;
- carteira comercial;
- análise de relacionamento.

---

### `total_compras`

Tipo: `numeric`

Total comprado.

Uso:
- análise comercial;
- segmentação;
- crédito.

---

### `obs`

Tipo: `text`

Observações gerais.

Uso:
- informações internas;
- alertas;
- histórico informal.

---

### `nota`

Tipo: `boolean`

Uso a confirmar.

Pode indicar necessidade de nota fiscal ou algum controle antigo.

---

### `verificado`

Tipo: `boolean`

Indica se o cadastro foi verificado.

Uso:
- validação de dados;
- conferência fiscal/cadastral.

---

### `data_verificacao`

Tipo: `date`

Data da verificação.

Uso:
- auditoria cadastral;
- controle de qualidade do cadastro.

---

### `empresa_padrao`

Tipo: `text`

Empresa padrão associada ao cadastro.

Uso:
- sugestão de empresa emissora;
- filtro operacional;
- compatibilidade com regras antigas.

---

### `cidade_uf`

Tipo: `text`

Cidade/UF consolidado.

Uso:
- listagem;
- busca;
- exibição rápida.

---

### `cpf_invalido`

Tipo: `boolean`

Indica documento inválido.

Uso:
- alerta cadastral;
- bloqueio fiscal;
- validação.

---

### `cpf_erro`

Tipo: `text`

Mensagem ou detalhe sobre erro de CPF/CNPJ.

Uso:
- diagnóstico;
- correção de cadastro.

---

### `is_bonus`

Tipo: `boolean`

Indica se o cadastro possui regra de bônus.

Uso:
- condição comercial;
- benefício especial.

---

### `percentual_bunus`

Tipo: `smallint`

Percentual de bônus.

Observação:
O nome possui provável erro de digitação: `bunus`.

Não renomear sem análise de dependência.

---

## Tabelas relacionadas

### `public.enderecos`

Armazena endereços dos cadastros.

Relacionamento:

`enderecos.id_cliente` → `clientes.id_cliente`

Campos importantes:

- cep
- endereco
- numero
- complemento
- bairro
- cidade
- uf
- tipo_endereco
- obs
- latitude
- longitude
- distancia

Uso:
- endereço principal;
- endereço de entrega;
- endereço fiscal;
- transportadora;
- NF-e;
- NFS-e;
- frete.

---

### `public.contatos`

Armazena contatos adicionais do cadastro.

Relacionamento:

`contatos.id_cliente` → `clientes.id_cliente`

Campos importantes:

- nome_contato
- cargo
- whats
- e_mail

Uso:
- múltiplos contatos por cliente;
- contato financeiro;
- contato comercial;
- contato operacional.

---

### `public.clientes_socios`

Relaciona cadastros entre si.

Relacionamentos:

- `id_cliente_principal`
- `id_cliente_socio`

Uso:
- sócios;
- vínculos entre empresas;
- relacionamento societário;
- possível grupo econômico.

---

## Tipos de cadastro

### Cliente

Usado para:

- propostas;
- pedidos;
- financeiro;
- emissão fiscal;
- crédito;
- relacionamento comercial.

Ações principais:

- criar proposta;
- consultar crédito;
- ver histórico;
- editar cadastro;
- abrir WhatsApp;
- gerar NF-e/NFS-e a partir de pedido.

---

### Transportadora

Usada para:

- cotação/frete;
- NF-e;
- dados de transporte;
- entrega.

Ações principais:

- editar dados fiscais;
- editar endereço;
- usar como transportadora na NF-e;
- consultar contatos.

---

### Fornecedor

Usado para:

- cadastro administrativo;
- compras futuras;
- referência interna;
- possível integração futura.

Ações principais:

- editar cadastro;
- consultar contatos;
- consultar documentos.

---

### Órgão público

Usado para:

- clientes institucionais;
- emissão fiscal;
- propostas;
- contratos;
- vendas públicas.

Ações principais:

- editar dados fiscais;
- controlar documentos;
- criar proposta;
- emitir nota.

---

## Páginas do módulo

### Lista de cadastros

Objetivo:

Encontrar rapidamente qualquer cadastro.

Filtros principais:

- busca por nome;
- id_cliente;
- documento;
- categoria;
- cidade/UF;
- vendedor;
- ativo;
- restrição.

Colunas desktop sugeridas:

- ID
- Nome
- Categoria
- Documento
- Cidade/UF
- Vendedor
- Crédito/Risco
- Ativo
- Ações

No mobile, cada registro vira card.

Card mobile sugerido:

- ID
- Nome
- Categoria
- Documento
- Cidade/UF
- Status/ativo
- Ações

---

### Novo cadastro

Objetivo:

Criar novo cadastro de cliente, transportadora, fornecedor ou órgão público.

Seções sugeridas:

1. Tipo de cadastro
2. Dados principais
3. Documentos fiscais
4. Contatos
5. Endereço principal
6. Crédito e observações

Campos mínimos:

- categoria
- nome
- documento
- tipo_pessoa
- email_contato ou whatsapp_1
- endereço principal, quando necessário

---

### Detalhe do cadastro

Objetivo:

Exibir visão completa do cadastro.

Seções:

- resumo;
- dados principais;
- contatos;
- endereços;
- crédito;
- histórico comercial;
- financeiro;
- fiscal;
- observações.

Ações:

- editar;
- criar proposta;
- abrir WhatsApp;
- consultar crédito;
- ver pagamentos;
- ver notas;
- inativar.

---

### Editar cadastro

Objetivo:

Editar dados cadastrais com segurança.

Organização por abas:

- Dados gerais
- Fiscal
- Contatos
- Endereços
- Crédito
- Observações
- Histórico

---

## Padrão de lista

A listagem deve seguir a Skill 02.

Regra importante:

Não usar vários ícones soltos na linha.

A coluna final deve ser:

`Ações`

Com menu padrão.

Exemplo de ações:

- Ver cadastro
- Editar cadastro
- Criar proposta
- Consultar crédito
- Abrir WhatsApp
- Ver financeiro
- Ver notas fiscais
- Ver contatos
- Ver endereços
- Inativar cadastro

Ações perigosas ficam separadas no final.

---

## Busca

A busca deve aceitar:

- nome;
- fantasia;
- apelido;
- documento;
- id_cliente;
- telefone/WhatsApp;
- e-mail.

Placeholder sugerido:

`Buscar por nome, documento, ID, WhatsApp ou e-mail`

---

## Filtros

Filtros principais:

- categoria;
- ativo;
- restrição;
- vendedor;
- cidade/UF;
- tipo pessoa;
- risco crédito.

Filtros avançados:

- data de cadastro;
- última compra;
- verificado;
- recebe e-mail;
- recebe WhatsApp;
- empresa padrão.

---

## Status e badges

Badges sugeridos:

### Categoria

- CLIENTE
- TRANSPORTADORA
- FORNECEDOR
- ÓRGÃO PÚBLICO

### Situação

- ATIVO
- INATIVO
- COM RESTRIÇÃO
- VERIFICADO
- DOCUMENTO INVÁLIDO

Cores:

- ativo: verde;
- inativo: cinza;
- restrição: vermelho;
- verificado: azul/verde;
- documento inválido: vermelho;
- categoria: cor neutra ou por tipo.

---

## Regras importantes

1. `id_cliente` é o identificador operacional principal.
2. `categoria` define o tipo do cadastro.
3. Não assumir que todo registro da tabela `clientes` é cliente comercial.
4. Transportadoras, fornecedores e órgãos públicos usam a mesma estrutura.
5. Endereços ficam em `enderecos`.
6. Contatos adicionais ficam em `contatos`.
7. Sócios/vínculos ficam em `clientes_socios`.
8. Documento deve ser limpo e validado.
9. E-mails devem tratar `null`, vazio e texto inválido.
10. WhatsApp deve ser normalizado.
11. Dados fiscais são importantes para NF-e/NFS-e.
12. Crédito e restrição devem gerar alerta visual.
13. Inativar é melhor que excluir.

---

## Regras para documento

O campo `documento` pode receber CPF ou CNPJ.

No front:

- aplicar máscara;
- limpar pontuação antes de salvar, se esse for o padrão definido;
- validar quantidade de dígitos;
- indicar se documento é inválido;
- preencher `tipo_pessoa` quando possível.

Para emissão fiscal:

- CNPJ alimenta `cnpj_destinatario`;
- CPF alimenta `cpf_destinatario`.

---

## Regras para e-mail

Prioridade recomendada:

1. `email_contato`
2. `email_financeiro`
3. `email`

O sistema deve ignorar:

- vazio;
- `null`;
- `undefined`;
- `-`;
- e-mail inválido.

---

## Regras para WhatsApp

Prioridade recomendada:

1. `whatsapp_1`
2. `whatsapp_2`
3. telefone fixo, se aplicável.

Normalizar para apenas dígitos quando for enviar para integração.

---

## Crédito

O cadastro possui campos ligados à análise de crédito:

- `limite_credito`
- `credito`
- `risco_credito`
- `padrao_pagamento`
- `ultima_compra`
- `total_compras`
- `restricao`

Esses campos devem aparecer em seção própria.

O módulo de crédito detalhado pertence ao módulo financeiro/crédito, mas o cadastro deve exibir resumo.

---

## Fiscal

Campos fiscais importantes:

- documento;
- tipo_pessoa;
- ins_estadual;
- ins_municipal;
- tipo_contribuinte;
- nota;
- verificado;
- cpf_invalido;
- cpf_erro.

Esses dados alimentam:

- NF-e;
- NFS-e;
- validações fiscais;
- payload Focus.

---

## Endereços

O cadastro pode ter múltiplos endereços.

Tipos possíveis:

- principal;
- entrega;
- cobrança;
- fiscal;
- transportadora.

O endereço principal deve ser usado como padrão para:

- proposta;
- frete;
- NF-e;
- NFS-e;
- relatórios.

---

## Contatos

O cadastro pode ter múltiplos contatos.

Cada contato pode ter:

- nome;
- cargo;
- WhatsApp;
- e-mail.

No detalhe do cadastro, contatos devem aparecer em lista própria.

---

## Ações críticas

Ações que exigem confirmação:

- inativar cadastro;
- marcar restrição;
- remover restrição;
- alterar documento;
- alterar categoria;
- excluir contato;
- excluir endereço;
- alterar dados fiscais usados em nota.

Excluir cadastro físico deve ser evitado.

Preferir:

`ativo = false`

---

## O que este módulo faz

Este módulo permite:

- listar cadastros;
- criar cadastro;
- editar cadastro;
- classificar por categoria;
- consultar dados fiscais;
- consultar contatos;
- consultar endereços;
- consultar crédito resumido;
- consultar histórico;
- usar cadastro como cliente, transportadora, fornecedor ou órgão público.

---

## O que este módulo não faz

Este módulo não emite nota.

Não confirma pagamento.

Não aprova crédito sozinho.

Não gera cobrança sozinho.

Não cria proposta sozinho, mas pode iniciar uma proposta a partir do cadastro.

Não deve excluir registros críticos sem confirmação e análise.

---

## Componentes necessários

- CadastroListPage
- CadastroDetailPage
- CadastroForm
- CadastroHeader
- CadastroStatusBadges
- CadastroActionsMenu
- CategoriaBadge
- DocumentoField
- WhatsappField
- EmailField
- EnderecosList
- EnderecoForm
- ContatosList
- ContatoForm
- CreditoResumoCard
- FiscalResumoCard
- RestricaoAlert

---

## Serviços necessários

- cadastrosService
- enderecosService
- contatosService
- creditoService
- fiscalCadastroService

Mesmo que o service se chame `cadastrosService`, ele deve consultar a tabela `public.clientes`.

---

## Primeira implementação sugerida

Etapa 1:

- criar listagem de cadastros;
- buscar dados da tabela `clientes`;
- filtros por categoria, nome, documento e ativo;
- menu de ações por linha.

Etapa 2:

- criar detalhe do cadastro;
- exibir dados principais;
- exibir endereço principal;
- exibir contatos;
- exibir resumo de crédito.

Etapa 3:

- criar formulário de novo cadastro;
- permitir escolher categoria;
- validar documento;
- salvar dados principais.

Etapa 4:

- criar edição de cadastro;
- separar abas por dados gerais, fiscal, contatos, endereços e crédito.

---

## Resultado esperado

Ao final deste módulo, o sistema deve permitir:

- usar `clientes` como tabela geral de cadastros;
- diferenciar cliente, transportadora, fornecedor e órgão público;
- pesquisar rapidamente qualquer cadastro;
- visualizar informações operacionais importantes;
- editar dados com segurança;
- preparar dados para proposta, financeiro e fiscal;
- melhorar a experiência atual do FlutterFlow com uma tela mais organizada e responsiva.

---

## Observações importantes

Embora o nome da tabela seja `clientes`, no novo sistema o módulo deve ser pensado como `Cadastros`.

Não renomear a tabela agora.

Se no futuro houver desejo de renomear para `cadastros`, será necessário criar plano de migração com:

- análise de dependências;
- views;
- funções;
- triggers;
- FlutterFlow;
- n8n;
- Edge Functions;
- RPCs;
- políticas RLS.

Essa mudança não é prioridade para iniciar o novo projeto.