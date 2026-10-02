# Proposta: aba Pedido (Boletim Técnico & Lotes)

> **Última revisão:** 02/10/2026
> **Caminho no menu:** Pedidos → abrir um pedido → Editar proposta → aba Pedido
> **Endereço:** `/orcamentos/[número]/editar?tab=pedido`

## Para que serve

É onde a quantidade vendida de cada produto é dividida em modelos (também chamados de lotes): quantos de cada cor, com qual numeração, verso e numerador. O que você monta aqui é o que a arte recebe e o que a fábrica produz.

A aba tem uma lista rápida por produto: uma linha por modelo, que pode ser digitada ou colada direto da planilha do cliente. Nesta lista, a soma dos modelos manda na quantidade do produto.

## Quem acessa

- Quem abre a edição do pedido vê a aba Pedido. Não há permissão separada para ela.
- A aba **não aparece** em proposta avulsa.
- Em pedido que já tem cobrança, só altera os modelos quem tem a permissão **Editar Proposta Paga** (ou **Editar Proposta com Faturado a Vencer**, quando a cobrança é faturada e ainda não foi recebida). Para os demais, a lista abre só para ver.
- Em pedido sem cobrança, quem abre a aba grava os modelos.

## Botões e ações da tela

Nomes exatamente como aparecem na tela.

| Nome na tela | Onde fica | O que faz |
|---|---|---|
| **Pedido** | Barra de abas do pedido, entre **Fretes** e **Artes** | Abre a aba, com o título **Boletim Técnico & Lotes**. |
| Botão com a seta | À esquerda do nome de cada produto | Recolhe ou abre a lista daquele produto. O que foi digitado não se perde ao recolher. |
| **Amostras** | Cabeçalho de cada produto | Mostra ou esconde a amostra da arte abaixo de cada modelo. Começa desligado. |
| Campo numérico (dica "Quantas linhas criar de uma vez") | Barra da lista, antes do botão de linha | Diz quantas linhas o botão ao lado cria. Vai de 1 a 200. |
| **Linha** / **N linhas** | Barra da lista | Acrescenta uma linha em branco no fim (ou N, conforme o campo ao lado). |
| **Gravar lote** | Barra da lista, em pedido sem cobrança | Grava todos os modelos daquele produto e acerta a quantidade do produto pela soma. Enquanto grava, mostra "Gravando...". |
| **Cada modelo começa do 1** | Faixa **Numeração** | Caixa de marcar. Todo modelo recebe Nº Inicial 1 (exemplo da tela: "1–300, 1–150, 1–80"). |
| **Sequencial entre os modelos** | Faixa **Numeração** | Caixa de marcar. Cada modelo continua de onde o anterior parou ("1–300, 301–450, 451–530"). |
| Ícone de copiar (dica "Duplicar modelo (com a quantidade)") | Fim de cada linha | Cria uma cópia da linha logo abaixo, com a mesma quantidade. |
| Ícone de lixeira (dica "Remover lote") | Fim de cada linha | Tira a linha da lista. A exclusão vale depois de gravar. |
| **X** (dica "Voltar para opções fixas") | Campo **Bloco**, depois de escolher **Outro** | Volta o campo Bloco para a lista de opções. |
| Imagem da amostra (dica "Clique para ampliar") | Abaixo do modelo, com **Amostras** ligado | Abre a arte ampliada, frente e verso. |
| **X** (dica "Fechar (Esc)") | Canto da arte ampliada | Fecha a arte ampliada. A tecla Esc faz o mesmo. |
| **Salvar alterações** | Barra fixa no rodapé do pedido | Salva o pedido e, junto, os modelos pendentes da lista de todos os produtos. |

## Passo a passo

### Entender a tela

1. Cada produto do pedido tem o seu quadro, com o nome, as variações, **Qtd:** (a quantidade do produto no pedido) e o saldo: **Restam: N** enquanto a soma dos modelos é menor que a quantidade, ou **Saldo distribuído 100%**.
2. A barra da lista mostra "N lote(s) · N un" (quantas linhas e a soma das quantidades). Quando a soma é diferente da quantidade do produto, aparece em laranja "quantidade do item: X → Y": é o que vai acontecer com a quantidade ao gravar.
3. Ao lado fica a situação: **Não gravado**, **Salvando...**, **Salvo** ou **Erro ao salvar**.
4. Cada linha é um modelo. Na coluna **Arte** aparece a situação da arte daquele modelo (PENDENTE quando ainda não há).
5. Produto que acabou de ser incluído e ainda não foi salvo mostra "Salve a proposta uma vez antes de montar os lotes deste produto.". Clique em **Salvar alterações** e volte.

### Preencher os campos de um modelo

As colunas dependem do produto: campo que o produto não usa não aparece.

1. **Modelo**: o nome do modelo (exemplo da tela: "Talão"). Dentro do campo aparece o número do modelo ("#1001304") ou "novo", quando a linha ainda não foi gravada.
2. **Qtd \***: a quantidade daquele modelo. Apertar Enter neste campo cria a próxima linha.
3. **Nº Inicial** e **Nº Final**: a faixa de numeração. O Nº Final é sempre calculado. O Nº Inicial só pode ser digitado quando nenhuma das duas caixas da faixa **Numeração** está marcada.
4. **Cor papel \***: escolha na lista. Só aparecem as cores do formato do produto.
5. **Bloco**: Nenhum, 10, 15, 20, 25, 40, 50, 75, 100 ou **Outro** (que abre um campo para digitar, exemplo "50x2").
6. **Verso**: SÓ FRENTE, FRENTE E VERSO, VERSO FIXO ou VERSO VARIÁVEL.
7. **Numerador**: escolha na lista. Numerador exclusivo de um cliente só aparece em pedido daquele cliente.

Os campos com asterisco são obrigatórios: **Modelo**, **Qtd** e, quando o produto usa cor, **Cor papel**.

Linha nova já nasce com cor, numerador, verso (SÓ FRENTE) e bloco (50) preenchidos: ela copia a linha anterior e, quando não há anterior, usa o cadastro do produto. A **Qtd** nasce sempre em branco.

### Montar os modelos digitando

1. Preencha a primeira linha.
2. No campo **Qtd**, aperte Enter para abrir a próxima linha. Ou use o botão **Linha**; para abrir várias de uma vez, digite o número no campo ao lado e clique em **N linhas**.
3. Repita até a lista estar completa.
4. Clique em **Gravar lote**. O aviso **Salvo** confirma.

### Colar a lista do cliente

1. Copie da planilha as linhas com a cor e a quantidade (uma linha por modelo).
2. Clique no campo **Modelo** ou **Qtd** de uma linha e cole.
3. O sistema cria uma linha para cada linha colada e avisa "N lote(s) lidos da lista".
4. Confira as linhas com borda vermelha: são cores que não existem no cadastro do produto ("cor da lista não reconhecida: “...” — escolha na Cor papel"). Escolha a cor certa na lista.
5. Clique em **Gravar lote**.

Como a colagem é lida: a quantidade é o último número da linha e a cor é tudo o que vem antes. Vale separar por tabulação (como sai da planilha), ponto e vírgula ou vírgula. Linha sem número, como o cabeçalho da planilha, é ignorada. Colar sempre acrescenta linhas, nunca substitui as que já estão na tela. O nome do modelo das linhas coladas é o da linha onde você colou ou, se ela estiver sem nome, o nome do produto.

### Duplicar ou remover um modelo

1. Para duplicar, clique no ícone de copiar da linha. A cópia entra logo abaixo, com todos os campos e a mesma quantidade.
2. Para remover, clique na lixeira da linha.
3. Clique em **Gravar lote**. Só então a cópia passa a existir e o modelo removido é apagado.

### Trocar a quantidade

1. Altere a **Qtd** dos modelos, acrescente ou remova linhas. A barra mostra "quantidade do item: X → Y".
2. Clique em **Gravar lote**.
3. Se a soma ficou **menor** que a quantidade atual do produto, o sistema pergunta antes: "A soma dos lotes (X) é menor que a quantidade atual do item (Y). Confirme para reduzir." e avisa que o subtotal e o peso acompanham. Confirme para reduzir, ou cancele para manter.
4. Depois de gravar, a quantidade do produto, o subtotal e o total do pedido mudam na hora.
5. Se o peso mudou em relação ao frete cotado, aparece o aviso "O frete precisa ser atualizado". Ele não impede nada agora: recote o frete na aba **Fretes** antes de gerar a cobrança.

### Definir a numeração

1. A faixa **Numeração** aparece em produto que usa numeração.
2. Produto sem nenhum modelo abre com **Cada modelo começa do 1** já marcado. Produto que já tem modelos abre sem nenhuma caixa marcada, para não renumerar o que está gravado.
3. Marque **Sequencial entre os modelos** se a numeração deve continuar de um modelo para o outro, na ordem da lista.
4. Para digitar o Nº Inicial à mão, desmarque as duas caixas. Sem marcar, cada modelo mantém o Nº Inicial que já tem.
5. Clique em **Gravar lote**.

Em numerador do tipo Camarote, aparecem os campos **Q CAM \***, **L CAM \*** e **C INI**, e a **Qtd** deixa de ser digitada: ela é Q CAM × L CAM. Em numerador do tipo Ticket, cada unidade consome mais de um número e o Nº Final leva isso em conta; a regra aparece escrita abaixo da linha.

### Gravar em pedido com cobrança

1. Em pedido que já tem cobrança, o botão **Gravar lote** dá lugar ao aviso "Proposta com cobrança: grava pelo Salvar da proposta".
2. Faça as alterações na lista. O aviso muda para "Alterações pendentes: use Salvar alterações da proposta".
3. Clique em **Salvar alterações**, na barra do rodapé. Os modelos, as exclusões e a nova quantidade do produto são gravados junto com o pedido, e a diferença de valor segue o fluxo de pedido pago.

### Ver a amostra da arte

1. Clique em **Amostras** no cabeçalho do produto.
2. Abaixo de cada modelo aparece a imagem da arte (frente e, quando existe, verso), ou "Sem amostra de arte.".
3. Clique na imagem para ampliar.

### Conferir antes de liberar para a produção

1. Para cada produto, a quantidade do produto tem de ser **igual** à soma dos modelos. Soma maior, soma menor e produto sem nenhum modelo barram a liberação.
2. Confira se o quadro de cada produto mostra **Saldo distribuído 100%** e se não há **Não gravado** em nenhuma lista.
3. Confira os campos que a aba **Artes** cobra de cada modelo: Modelo, Qtd, Cor Papel, Numerador, Nº Inicial, Nº Final e Verso (só os que o produto usa).

## Regras e bloqueios

- Nesta lista a soma dos modelos manda: ao gravar, a quantidade do produto no pedido passa a ser a soma das quantidades dos modelos. Não há limite de saldo no campo Qtd.
- Nada é gravado sozinho. O que está na lista só vai para o sistema em **Gravar lote** ou em **Salvar alterações**.
- Não dá para sair da aba com modelo não gravado sem responder à pergunta "Há modelos não gravados na lista rápida da aba Pedido. Sair e descartar as alterações? Para manter, cancele e use Salvar alterações.". Se você confirmar, o que não foi gravado se perde.
- Linha nova sem os obrigatórios não é gravada. A tela avisa: "N lote(s) ainda sem os obrigatórios — não são gravados até ficarem completos.". As demais linhas são gravadas normalmente.
- Modelo que já existe e ficou sem um campo obrigatório segura a gravação inteira do produto, até ser completado.
- **Salvar alterações** não salva nada se houver linha em que você mexeu e que ficou incompleta: ele avisa qual produto e o que falta, e mantém na tela o que foi digitado. Linha em branco em que ninguém mexeu não segura o salvamento.
- Reduzir a quantidade do produto pela lista sempre pede confirmação, porque o subtotal e o peso caem junto.
- Na troca de quantidade vale a última gravação. Se duas pessoas gravarem os modelos do mesmo produto, fica o que foi gravado por último, sem aviso.
- Em pedido com cobrança a lista não grava direto. Quem tem permissão grava pelo **Salvar alterações**; quem não tem vê a lista travada.
- Campo que o produto não usa não aparece e não recebe valor em modelo novo. Em modelo que já existe, o valor guardado nesse campo fica como está.
- Produto de prateleira mostra só **Qtd** e **Cor papel**. O nome do modelo é o nome do produto, e não há coluna **Arte** nem amostra.
- O Nº Final nunca é digitado. Ele é refeito sempre que a quantidade, o Nº Inicial ou o numerador mudam.
- Modelo sem quantidade não recebe numeração e não entra na sequência.
- O botão de linhas cria no máximo 200 de uma vez.
- Produto removido do pedido não aparece nesta aba.
- A liberação para a produção recusa o pedido em que a quantidade de algum produto não bate com a soma dos modelos, e lista cada caso: "Produto X: vendido N, lotes somam M". Vale também para produto de prateleira.
- Depois que o pedido entra na produção, os modelos aparecem na OS (tela Produção) só para leitura. Lá não se altera quantidade, cor nem numeração.

## O que não confundir

- **Modelo** e **lote** são a mesma coisa nesta aba: uma linha da lista. A tela usa as duas palavras.
- **Gravar lote** não é **Salvar alterações**. O primeiro grava só os modelos de um produto e fica na aba; o segundo salva o pedido inteiro (e leva junto os modelos pendentes de todos os produtos).
- **Qtd:** no cabeçalho do produto é a quantidade vendida; **Qtd \*** na linha é a quantidade daquele modelo; "N un" na barra é a soma dos modelos.
- A aba **Pedido** não é o menu **Pedidos**. O menu é a lista de todos os pedidos; a aba é a divisão em modelos de um pedido só.
- A aba chama-se **Pedido**, mas o título dentro dela é **Boletim Técnico & Lotes**. Não é o boletim da OS, que fica na tela **Produção**.
- A aba dos produtos chama-se **Orçamento** na barra de abas. O aviso "Nenhum produto encontrado" desta aba fala em aba "Produtos": é a mesma aba Orçamento.
- **Cada modelo começa do 1** e **Sequencial entre os modelos** são caixas da tela, que valem para todos os modelos do produto. Não são o campo **Numerador**, que é escolhido linha a linha.
- **Numerador** não é numeração. O numerador é o tipo de numeração cadastrado para o formato; a numeração é a faixa (**Nº Inicial** a **Nº Final**).
- A coluna **Arte** de cada linha é a situação da arte daquele modelo. O selo do cabeçalho do pedido é o status da arte do pedido inteiro.
- **Não gravado** (laranja, na barra) quer dizer que há alteração só na tela. **Erro ao salvar** quer dizer que a gravação foi tentada e recusada; o motivo aparece em vermelho logo abaixo.
- **Cor papel** com borda vermelha na linha não é erro de gravação: é cor colada da planilha que não existe no cadastro do produto.

## Erros comuns

| O que aparece | Por que acontece | O que fazer |
|---|---|---|
| "Nenhum produto encontrado" | O pedido não tem produto. | Inclua os produtos na aba **Orçamento** e salve. |
| "Salve a proposta uma vez antes de montar os lotes deste produto." | O produto foi incluído e o pedido ainda não foi salvo. | Clique em **Salvar alterações** e volte à aba. |
| "N lote(s) ainda sem os obrigatórios — não são gravados até ficarem completos." | Há linha nova sem Modelo, Qtd ou Cor papel. | Complete a linha ou remova-a. |
| "Complete os campos obrigatórios do modelo #... para voltar a gravar." | Um modelo que já existia ficou sem campo obrigatório. | Preencha o campo naquele modelo e grave de novo. |
| "Informe a quantidade de pelo menos um lote." | Nenhuma linha tem quantidade. | Preencha a **Qtd**. |
| "Redução não confirmada: a quantidade do item não foi alterada." | Você cancelou a pergunta de redução. | Nada foi gravado. Ajuste as quantidades ou grave de novo e confirme. |
| "Esta proposta já tem cobrança gerada. Alterar as quantidades aqui está bloqueado — use a edição da proposta, que sabe acertar a diferença do que já foi cobrado." | A cobrança foi gerada depois que a aba foi aberta. | Atualize a página e grave pelo **Salvar alterações**. |
| "Este item nao existe mais nesta proposta. Recarregue a pagina." | O produto foi removido do pedido por outra pessoa ou em outra aba. | Atualize a página. |
| "Modelos incompletos na aba Pedido" — "[produto]: N modelo(s) sem ... Complete ou remova a linha para salvar. Nada foi gravado e o que você digitou continua na tela." | Você clicou em **Salvar alterações** com linha mexida e incompleta. | Complete ou remova a linha e salve de novo. |
| "Modelos não gravados" — "... A proposta não foi salva e o que você digitou continua na tela." | A gravação dos modelos foi recusada durante o **Salvar alterações** (por exemplo, redução não confirmada). | Leia o motivo no começo do aviso, acerte e salve de novo. |
| "Nada reconhecido na lista" — "Esperado uma linha por lote, com a cor e a quantidade — como sai da planilha." | O texto colado não tem linha com número no fim. | Copie de novo, com a cor e a quantidade em cada linha. |
| "cor da lista não reconhecida: “...” — escolha na Cor papel" | A cor colada não existe no cadastro do produto. | Escolha a cor certa no campo **Cor papel** da linha. |
| "O frete precisa ser atualizado" | A quantidade mudou e o peso não bate mais com o frete cotado. | Recote o frete na aba **Fretes** antes de gerar a cobrança. |
| Campo **Cor papel** ou **Numerador** mostrando "Sem formato" | O produto não tem formato configurado no cadastro. | Peça para acertar o cadastro do produto. |
| "Com um modo de numeração marcado acima, o Nº Inicial é calculado. Desmarque para editar." | Há uma caixa marcada na faixa **Numeração**. | Desmarque a caixa para digitar o Nº Inicial. |
| A liberação recusa com "A quantidade vendida não bate com a soma dos lotes. Acerte os lotes antes de liberar para produção:" | Algum produto tem quantidade diferente da soma dos modelos, ou não tem modelo. | Acerte os modelos do produto listado e grave. |

## Veja também

- [Proposta: visão geral e abas](proposta.md)
- [Proposta: aba Produtos](proposta-produtos.md)
- [Proposta: aba Fretes](proposta-fretes.md)
- [Proposta: aba Artes](proposta-artes.md)
- [Proposta: abas Produção, Boletim e Histórico](proposta-producao-boletim-historico.md)
- [Produção (ordens de serviço)](producao.md)

## Arquivos de origem

- `src/features/orcamentos/components/PedidoModelosTab.tsx`
- `src/features/orcamentos/components/LotesGrid.tsx`
- `src/features/orcamentos/components/ModeloCampos.tsx`
- `src/features/orcamentos/services/lotes-colagem.ts`
- `src/features/orcamentos/services/lotes-numeracao.ts`
- `src/features/orcamentos/lib/checklist-lote.ts`
- `src/features/orcamentos/lib/divergencia-lotes.ts`
- `src/app/api/pedidos/lotes-em-massa/route.ts`
- `src/features/orcamentos/OrcamentoFormPage.tsx`
- `src/features/usuarios-perfis/catalogo-permissoes.ts`
