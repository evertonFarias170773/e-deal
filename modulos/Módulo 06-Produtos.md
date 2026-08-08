# Módulo 06 — Produtos

## Objetivo

Controlar o cadastro dos produtos vendidos pela empresa e servir como base para orçamentos, propostas, Maestro, cálculo de valores, descrição comercial, descrição técnica, imagens, variações e regras de produção.

O módulo de Produtos é central para o sistema, porque alimenta:

- propostas;
- orçamentos do Maestro;
- produtos da proposta;
- cálculo de valores;
- cálculo de peso;
- prazo de produção;
- descrição comercial;
- informações técnicas;
- fotos;
- variações;
- produtos com estoque;
- produtos personalizados;
- módulos fiscais, quando necessário.

A tabela principal é:

`public.produtos`

A chave operacional principal é:

`id_produto`

---

## Tabela principal: `produtos`

A tabela `produtos` guarda os dados principais de cada produto comercializado.

Ela deve ser tratada como a fonte oficial para nome, formato, valor, peso, prazo, descrição, segurança, personalização e categoria.

Mesmo que a tabela tenha uma coluna técnica `id`, o sistema usa `id_produto` como chave operacional.

---

## Chave principal operacional

### `id_produto`

Tipo: `smallint`

Identificador principal usado pelo ERP para reconhecer o produto.

Uso:

- buscar produto;
- vincular variações;
- vincular fotos;
- montar orçamento;
- alimentar produtos da proposta;
- permitir reconhecimento pelo Maestro;
- relacionar produtos em regras de cálculo.

No novo sistema, sempre considerar `id_produto` como o código comercial/operacional do produto.

---

## Colunas principais da tabela `produtos`

### `id`

Tipo: `bigint`

Identificador técnico da linha.

Uso interno do banco.

Não deve ser o código principal mostrado ao usuário.

---

### `created_at`

Tipo: `timestamp with time zone`

Data de criação do produto.

Uso:

- auditoria;
- histórico;
- ordenação administrativa.

---

### `id_produto`

Tipo: `smallint`

Código operacional do produto.

Deve ser usado como chave principal no front e nas integrações comerciais.

---

### `nomeReal`

Tipo: `text`

Nome oficial do produto.

Uso:

- exibição em listas;
- busca;
- proposta;
- Maestro;
- descrição para cliente.

Exemplos:

- Pulseira Triband
- Pulseira Tyvek
- Credencial PVC
- Ingresso de Segurança

---

### `formato`

Tipo: `text`

Formato físico ou descritivo do produto.

Uso:

- proposta;
- orçamento;
- descrição técnica;
- briefing de arte.

Exemplo:

- 25×2cm
- 10×15cm
- A6
- PVC 0,76mm

---

### `valorUnt`

Tipo: `double precision`

Valor unitário base do produto.

Uso:

- cálculo de orçamento;
- propostas;
- Maestro;
- produtos da proposta.

Observação:

Como é valor financeiro, no futuro pode ser interessante migrar para `numeric`, mas não alterar sem análise porque o sistema está em produção.

---

### `valorFixo`

Tipo: `double precision`

Valor fixo aplicado ao produto.

Uso:

- custo inicial;
- setup;
- valor mínimo;
- composição de orçamento.

---

### `peso`

Tipo: `real`

Peso base do produto.

Uso:

- cálculo de frete;
- peso total da proposta;
- cotação de transporte;
- NF-e, quando aplicável.

---

### `prazo`

Tipo: `text`

Prazo de produção.

Uso:

- proposta informal;
- proposta formal;
- Maestro;
- promessa comercial;
- OS/produção.

Exemplo:

- 1 dia útil
- 3 dias úteis
- sob consulta

---

### `nivelSeg`

Tipo: `text`

Nível de segurança do produto.

Uso:

- descrição técnica;
- comparação de produtos;
- Maestro;
- argumentação comercial.

Exemplo:

- baixo;
- médio;
- alto;
- antifraude;
- controle visual.

---

### `fraseCons`

Tipo: `text`

Frase consultiva do produto.

Uso:

- Maestro;
- apresentação comercial;
- descrição humanizada;
- proposta informal.

Deve ajudar o vendedor a explicar quando aquele produto é indicado.

---

### `descricao`

Tipo: `text`

Descrição do produto.

Uso:

- página de produto;
- Maestro;
- proposta;
- comparações;
- explicação técnica.

---

### `personalizacao`

Tipo: `text`

Descrição das opções de personalização.

Uso:

- proposta;
- Maestro;
- briefing de arte;
- descrição para cliente.

Exemplos:

- impressão colorida;
- numeração;
- QR Code;
- dados variáveis;
- arte personalizada.

---

### `categoria`

Tipo: `text`

Categoria comercial do produto.

Uso:

- filtros;
- organização;
- busca;
- agrupamento no catálogo.

Exemplos:

- Pulseiras
- Credenciais
- Ingressos
- Cartões
- Impressos
- Brindes

---

### `ativo`

Tipo: `boolean`

Indica se o produto está ativo.

Uso:

- esconder produtos antigos;
- impedir venda de produtos descontinuados;
- filtrar catálogo.

Produto inativo não deve aparecer por padrão para o vendedor.

---

### `apelidos`

Tipo: `text`

Lista textual de nomes alternativos, formas populares, abreviações ou erros comuns.

Uso muito importante para o Maestro.

Exemplos:

- triband
- pulseira tri band
- pulseirinha
- tyvek
- credencial pvc
- crachá pvc

O Maestro deve usar este campo para reconhecer produtos mesmo quando o vendedor escrever de forma informal.

---

### `is_estoque`

Tipo: `boolean` (default `false`)

**Produto de prateleira.** Desde 10/08/2026 este campo indica que o produto é
vendido pronto e, por isso, **dispensa o fluxo de arte**. Rótulo na interface:
"Produto de prateleira".

Uso:

- diferenciar produto sob demanda de produto vendido pronto;
- quando **todos** os itens ativos de uma proposta apontam para produtos com
  este flag, a proposta pula a etapa de Artes: com o pagamento integral
  confirmado, vai de `LIBERADO` direto para `REVISAO ATENDENTE`;
- basta **um** item sem o flag para a proposta seguir o fluxo normal de Artes.

Regras associadas:

- a decisão é congelada no item da proposta (`produtos_proposta.is_estoque`) no
  momento do save — alterar o cadastro depois não muda proposta já fechada;
- a dispensa é aplicada na engine de status e em
  `public.check_and_promote_proposta`; ocultar a aba Artes é só apresentação;
- não dispensa a confirmação financeira nem a liberação manual para produção
  (`is_prd_aprovado`);
- não existe controle de saldo/quantidade de estoque associado a este campo.

---

### `is_variacao`

Tipo: `boolean`

Indica se o produto possui variações.

Uso:

- exibir opções no cadastro;
- ativar lógica de variações;
- orientar Maestro;
- montar proposta com critérios adicionais.

---

### `valor_custo`

Tipo: `numeric`

Custo interno do produto.

Uso:

- margem;
- análise financeira;
- formação de preço;
- relatórios internos.

Não deve ser exibido para vendedor comum, a menos que tenha permissão.

---

## Tabela relacionada: `produto_variacoes`

A tabela `produto_variacoes` trata as variações disponíveis para cada produto.

Ela permite representar escolhas como:

- cor;
- tamanho;
- espessura;
- acabamento;
- tipo de impressão;
- furação;
- dados variáveis;
- material;
- modelo;
- tipo de personalização.

Relacionamento principal:

`produto_variacoes.id_produto` → `produtos.id_produto`

---

## Interpretação de variações

Uma variação é uma característica configurável de um produto.

Exemplo:

Produto:

`Cartão PVC`

Variações possíveis:

- espessura;
- tipo de impressão;
- acabamento;
- furação;
- tipo de dados.

Produto:

`Pulseira`

Variações possíveis:

- cor;
- largura;
- material;
- tipo de fechamento.

Produto:

`Credencial`

Variações possíveis:

- papel;
- PVC;
- acabamento;
- cordão;
- furo;
- laminação.

---

## Colunas principais da tabela `produto_variacoes`

### `id`

Tipo: `bigint`

Identificador técnico da variação vinculada ao produto.

---

### `id_produto`

Tipo: `bigint`

Código do produto ao qual a variação pertence.

Deve apontar para o produto principal.

---

### `id_variacao`

Tipo: `integer`

Identificador da variação.

Pode estar relacionado a uma tabela de variações gerais, se usada.

---

### `nome`

Tipo: `text`

Nome da variação.

Exemplos:

- Cor
- Tamanho
- Espessura
- Acabamento
- Tipo de impressão

---

### `is_obrigatorio`

Tipo: `boolean`

Indica se aquela variação precisa ser escolhida para montar o orçamento.

Uso:

- validação do orçamento;
- Maestro;
- proposta formal;
- tela de produto.

Exemplo:

Se `Espessura` for obrigatória, o sistema não deve permitir concluir o orçamento sem essa escolha.

---

### `is_multiplo`

Tipo: `boolean`

Indica se a variação permite múltiplas escolhas.

Exemplo:

- Uma pulseira pode permitir várias cores?
- Um produto pode ter mais de um acabamento?
- Um crachá pode ter furação e dados variáveis ao mesmo tempo?

---

## Tabela relacionada: `fotosProdutos`

A tabela `fotosProdutos` armazena URLs das imagens dos produtos.

Ela serve apenas para guardar referências visuais dos produtos.

Relacionamento esperado:

`fotosProdutos.idProduto` → `produtos.id_produto`

---

## Colunas principais da tabela `fotosProdutos`

### `id`

Identificador técnico da imagem.

---

### `created_at`

Data em que a imagem foi cadastrada.

---

### `nomeProduto`

Nome textual do produto relacionado.

Uso auxiliar.

---

### `imagensURL`

URL da imagem do produto.

Uso:

- catálogo;
- Maestro;
- proposta;
- comparação;
- tela de detalhe do produto.

---

### `idProduto`

Código do produto relacionado.

Deve ser usado para vincular a imagem ao produto.

---

## Uso das fotos no sistema

As fotos devem aparecer em:

- detalhe do produto;
- cards do catálogo;
- Maestro;
- comparações de produtos;
- proposta visual;
- briefing de arte, quando fizer sentido.

O Maestro deve conseguir mostrar imagens para o vendedor quando o produto for identificado.

---

## Páginas do módulo

### Lista de produtos

Objetivo:

Permitir localizar produtos rapidamente.

Filtros principais:

- busca por nome;
- id_produto;
- categoria;
- ativo;
- produto com variação;
- produto de estoque;
- nível de segurança.

Colunas desktop sugeridas:

- ID
- Produto
- Categoria
- Formato
- Valor unitário
- Valor fixo
- Prazo
- Ativo
- Variações
- Ações

No mobile, cada produto deve virar card.

---

### Detalhe do produto

Objetivo:

Exibir todos os dados comerciais e técnicos do produto.

Seções sugeridas:

1. Resumo
2. Dados comerciais
3. Descrição
4. Personalização
5. Segurança
6. Valores
7. Variações
8. Fotos
9. Uso no Maestro
10. Histórico/observações, se existir futuramente

---

### Novo produto

Objetivo:

Cadastrar novo produto.

Seções sugeridas:

1. Dados principais
2. Valores
3. Produção
4. Segurança e personalização
5. Variações
6. Fotos
7. Apelidos para IA/Maestro

---

### Editar produto

Objetivo:

Editar dados do produto com segurança.

Atenção:

Alterar preço, prazo ou peso pode impactar orçamento, Maestro, propostas e frete.

Alterações críticas devem ser restritas a usuários autorizados.

---

## Padrão de lista

A listagem deve seguir a Skill 02.

Regra importante:

Não usar vários ícones soltos na linha.

A coluna final deve ser:

`Ações`

Com menu padrão.

Exemplo de ações:

- Ver produto
- Editar produto
- Ver fotos
- Gerenciar variações
- Duplicar produto
- Testar no Maestro
- Inativar produto

Ações perigosas ficam separadas no final.

---

## Busca

A busca de produtos deve aceitar:

- `id_produto`;
- nome oficial;
- categoria;
- formato;
- apelidos;
- descrição;
- termos comuns;
- erros de digitação, quando possível.

Placeholder sugerido:

`Buscar por produto, código, categoria ou apelido`

---

## Filtros

Filtros principais:

- categoria;
- ativo;
- possui variação;
- produto de estoque;
- nível de segurança.

Filtros avançados:

- prazo;
- faixa de valor;
- peso;
- produtos usados pelo Maestro;
- produtos sem foto;
- produtos sem descrição;
- produtos sem apelidos.

---

## Status e badges

Badges sugeridos:

- ATIVO
- INATIVO
- COM VARIAÇÕES
- ESTOQUE
- SEM FOTO
- SEM DESCRIÇÃO
- USADO NO MAESTRO

Cores:

- ativo: verde;
- inativo: cinza;
- com variações: azul;
- estoque: roxo ou azul;
- sem foto/sem descrição: amarelo;
- erro/incompleto: vermelho.

---

## Relação com Maestro

O módulo Produtos é uma das principais bases do Maestro.

O Maestro deve usar produtos para:

- reconhecer pedidos;
- buscar nome oficial;
- interpretar apelidos;
- calcular orçamento;
- explicar o produto;
- comparar produtos;
- mostrar fotos;
- gerar proposta informal;
- gerar briefing de arte;
- recomendar melhor produto.

Campos importantes para o Maestro:

- `id_produto`
- `nomeReal`
- `formato`
- `valorUnt`
- `valorFixo`
- `peso`
- `prazo`
- `nivelSeg`
- `fraseCons`
- `descricao`
- `personalizacao`
- `categoria`
- `apelidos`
- `ativo`

Regra:

Produto inativo não deve ser sugerido pelo Maestro, salvo se o usuário pedir explicitamente ou tiver permissão.

---

## Relação com propostas

Produtos alimentam as propostas.

O produto selecionado em orçamento/proposta deve fornecer:

- nome;
- formato;
- valor unitário;
- valor fixo;
- peso;
- prazo;
- variações;
- descrição;
- categoria.

A tabela `produtos_proposta` deve guardar os itens efetivamente adicionados à proposta.

O módulo Produtos não substitui a tabela de itens da proposta.  
Ele apenas fornece a base do catálogo.

---

## Relação com frete

Campos importantes:

- peso;
- formato, se ajudar;
- quantidade;
- variações que alterem peso.

O peso do produto pode ser usado para cálculo de frete.

Se produto tiver peso ausente ou zerado, o sistema deve mostrar alerta.

---

## Relação com fotos

Cada produto pode ter uma ou mais imagens.

A interface deve permitir:

- visualizar fotos;
- adicionar URL de imagem;
- remover imagem;
- marcar imagem principal, se essa regra for criada futuramente.

No Maestro, fotos devem ser exibidas em cards.

---

## Relação com variações

Produtos com `is_variacao = true` devem exibir área de variações.

A tela deve permitir:

- listar variações do produto;
- adicionar variação;
- editar variação;
- indicar se é obrigatória;
- indicar se permite múltipla escolha;
- remover/inativar variação.

Se uma variação for obrigatória, o orçamento não deve ser concluído sem essa escolha.

---

## Regras importantes

1. `id_produto` é a chave operacional principal.
2. `produtos` é a fonte oficial do catálogo.
3. `produto_variacoes` guarda as variações configuráveis do produto.
4. `fotosProdutos` guarda as URLs das imagens.
5. Produto inativo não deve aparecer por padrão em vendas.
6. Preço, prazo e peso são informações sensíveis para orçamento.
7. O Maestro deve usar `apelidos` para reconhecer produtos.
8. Produto sem descrição prejudica Maestro e proposta.
9. Produto sem foto prejudica apresentação comercial.
10. Produto com variação obrigatória precisa exigir escolha antes do cálculo final.
11. Não excluir produto usado em propostas antigas.
12. Preferir inativar produto em vez de apagar.

---

## Ações críticas

Ações que exigem confirmação:

- inativar produto;
- alterar preço;
- alterar valor fixo;
- alterar peso;
- alterar prazo;
- remover variação;
- remover foto;
- alterar apelidos usados pelo Maestro;
- excluir produto, se permitido.

Excluir produto físico deve ser evitado.

Preferir:

`ativo = false`

---

## O que este módulo faz

Este módulo permite:

- listar produtos;
- cadastrar produto;
- editar produto;
- organizar por categoria;
- controlar valores;
- controlar prazo;
- controlar peso;
- controlar descrição;
- controlar segurança;
- controlar personalização;
- controlar apelidos;
- gerenciar variações;
- gerenciar fotos;
- alimentar Maestro;
- alimentar propostas.

---

## O que este módulo não faz

Este módulo não cria proposta sozinho.

Não calcula orçamento completo sozinho.

Não calcula frete sozinho.

Não emite nota.

Não controla estoque (saldo/quantidade). `is_estoque` significa produto de prateleira, e seu único efeito é dispensar o fluxo de arte.

Não deve apagar produto já usado historicamente.

---

## Componentes necessários

- ProdutosListPage
- ProdutoDetailPage
- ProdutoForm
- ProdutoHeader
- ProdutoActionsMenu
- ProdutoBadge
- ProdutoFotoGallery
- ProdutoFotoForm
- ProdutoVariacoesList
- ProdutoVariacaoForm
- ProdutoPrecoCard
- ProdutoPrazoCard
- ProdutoSegurancaCard
- ProdutoMaestroPreview
- ProdutoApelidosEditor

---

## Serviços necessários

- produtosService
- produtoVariacoesService
- fotosProdutosService
- produtosMaestroService

---

## Primeira implementação sugerida

Etapa 1:

- criar listagem de produtos;
- buscar produtos ativos;
- filtro por nome, código, categoria e ativo;
- menu de ações por linha.

Etapa 2:

- criar detalhe do produto;
- exibir dados comerciais;
- exibir descrição;
- exibir fotos;
- exibir variações.

Etapa 3:

- criar edição de produto;
- proteger alteração de valores, peso e prazo.

Etapa 4:

- criar gerenciamento de fotos;
- permitir cadastrar URLs de imagens.

Etapa 5:

- criar gerenciamento de variações;
- permitir marcar variação como obrigatória ou múltipla.

Etapa 6:

- criar prévia do produto para o Maestro;
- testar reconhecimento por apelidos.

---

## Resultado esperado

Ao final deste módulo, o sistema deve permitir:

- consultar produtos rapidamente;
- manter catálogo organizado;
- controlar valores e prazos;
- gerenciar variações;
- gerenciar fotos;
- melhorar a qualidade das respostas do Maestro;
- melhorar a montagem de propostas;
- preparar base para OS/produção;
- reduzir inconsistências comerciais.

---

## Observações importantes

A tabela se chama `produtos`, mas no novo sistema a interface pode chamar o módulo de:

`Produtos`

ou:

`Catálogo de Produtos`

O termo “Catálogo” pode ser mais adequado quando o foco for consulta comercial e Maestro.

Não renomear tabelas agora.

Qualquer mudança estrutural no catálogo deve considerar impacto em:

- Maestro;
- produtos_proposta;
- propostas;
- cálculo de orçamento;
- frete;
- relatórios;
- histórico comercial.