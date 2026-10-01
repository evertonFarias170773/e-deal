# Proposta: aba Artes

> **Última revisão:** 01/10/2026
> **Onde fica:** menu → Pedidos → abrir o pedido → **Editar proposta** → aba **Artes** (endereço `/orcamentos/[número]/editar?tab=artes`)

## Para que serve

É onde o vendedor entrega o pedido para a equipe de arte. Aqui você escreve o briefing do evento, anexa os arquivos de referência (logos, imagens, PDF), escolhe o designer e envia o pedido para arte.

O andamento da arte depois do envio aparece no selo de **Status da arte**, no cabeçalho do pedido e na coluna **Status Arte** da lista de Pedidos. A criação e a aprovação da arte acontecem no Ideal Imposition, que é outro sistema; o Vibe mostra o resultado.

## Quem acessa

- Quem abre a edição do pedido vê a aba Artes. Não há permissão separada para ela.
- A aba **não aparece** em proposta avulsa.
- A aba **não aparece** quando todos os produtos do pedido são de prateleira (vendidos prontos). Nesse caso a arte é dispensada e o pedido segue sem essa etapa.
- O botão do Ideal Imposition, no cabeçalho, aparece para qualquer pessoa que abre um pedido já salvo.

## Passo a passo

### Abrir a aba Artes

1. Monte primeiro os modelos na aba **Pedido**. A aba Artes depende deles.
2. Clique na aba **Artes**.
3. Se aparecer a janela **Modelos incompletos**, leia a lista: cada linha traz o nome do modelo e o que falta nele (por exemplo "Qtd, Cor Papel"). Clique em **Entendi**, volte à aba **Pedido**, complete os campos e tente de novo.
4. Se a aba abrir com o aviso "Configure os modelos/lotes na aba Pedido antes de iniciar a etapa de Artes.", o pedido ainda não tem nenhum modelo. Crie os modelos na aba **Pedido**.

### Preencher o briefing

1. No bloco **Briefing Base do Evento**, preencha **Nome do Evento / Tema**. Esse campo é obrigatório para enviar para arte.
2. Preencha **Data do Evento** e **Local da Festa/Evento**, se souber.
3. Em **Observações por produto** há um campo de texto para cada produto do pedido, identificado pela quantidade e pelo nome ("1000 un. - nome do produto"). Escreva ali o que o designer precisa saber daquele produto: cor principal, onde vai o logo, textos.

### Anexar arquivos de referência

1. No bloco **Arquivos de referência**, clique em **Adicionar arquivos de referência**.
2. Na janela **Anexar Referência**, escolha um ou mais arquivos no campo **Arquivos**. São aceitos JPEG, PNG e PDF, com até 10 MB cada.
3. Clique em **Adicionar**. O aviso "N arquivo(s) anexado(s) com sucesso!" confirma.
4. Os arquivos aparecem em **Arquivos Anexados**, com o nome, quem enviou, o tamanho e a data.
5. Para abrir um arquivo, use o ícone **Abrir arquivo**. Para apagar, use o ícone **Excluir arquivo** e confirme a pergunta "Deseja realmente excluir este arquivo de referência?".

O arquivo é gravado na hora em que você clica em **Adicionar**. Não é preciso salvar o pedido depois para ele ficar guardado.

### Enviar para arte

1. No bloco **Designers Ideal**, clique no designer que vai cuidar do pedido. A linha fica destacada e ganha o selo **Selecionado**. Ao lado de cada nome aparecem **Pedidos** e **Modelos**: quantos pedidos e quantos modelos já estão com aquele designer.
2. Confira se o **Nome do Evento / Tema** está preenchido.
3. Com um designer selecionado, o botão flutuante da aba passa a se chamar **Enviar para arte**. Clique nele.
4. O aviso "Dados da arte salvos com sucesso!" confirma. O status da arte passa a **EM ARTE** e o designer escolhido fica gravado no pedido.

### Salvar o briefing sem enviar

1. Sem nenhum designer selecionado, o botão flutuante da aba se chama **Salvar dados da arte**.
2. Clique nele para gravar o briefing. O status da arte fica **AGUARDANDO**: os dados estão guardados, mas ninguém da arte foi acionado.
3. O **Salvar alterações** do pedido (botão geral da tela) também grava o que você digitou no briefing, sem mexer no status da arte.

### Trocar ou tirar o designer

1. Clique em outro designer para trocar, ou clique de novo no designer selecionado para desmarcar.
2. Clique no botão flutuante para gravar a troca.

Atenção: o botão flutuante sempre grava o status junto. Com designer selecionado ele grava **EM ARTE**; sem designer, grava **AGUARDANDO**. Veja "Regras e bloqueios".

### Acompanhar o status da arte

O selo de status da arte fica no cabeçalho do pedido, ao lado do status do pedido (ao passar o mouse aparece "Status da arte"). O mesmo texto aparece na coluna **Status Arte** da lista de Pedidos, com a data e a hora da última mudança. Pedido que ainda não teve nada gravado na aba Artes não mostra selo.

Do **Enviar para arte** em diante, quem muda o status é a equipe de arte, no Ideal Imposition. O Vibe exibe o texto como foi gravado lá.

| Status | Cor do selo | O que indica para o vendedor |
|---|---|---|
| AGUARDANDO | cinza | O briefing foi salvo, mas o pedido ainda não foi enviado para arte. Falta escolher o designer e clicar em **Enviar para arte**. |
| Enviar Arte | azul | A arte ainda precisa ser enviada. Na lista de Pedidos, com o card **Em arte** ligado, esses pedidos vêm primeiro e com a linha laranja. |
| Em Arte | azul | O pedido está com o designer. É o status que o **Enviar para arte** grava. |
| Em Aprovação | laranja | A arte está em aprovação. |
| Apr Parcial | laranja | Aprovação parcial: parte da arte foi aprovada e parte não. "Aprovado Parcial" tem o mesmo significado. |
| Em Alteração | vermelho | A arte está sendo alterada. |
| Dados Pendentes | azul | Faltam dados para a arte andar. |
| Corrigir Dados | vermelho | Há dado a corrigir. É um dos dois status que deixam o card **Em arte** laranja na lista de Pedidos. |
| Pendente Informação | cinza | Falta informação para a arte andar. Também deixa o card **Em arte** laranja; com o card ligado, a linha desses pedidos fica vermelha. |
| APROVADO | verde | Arte aprovada. É o único status de arte que deixa o pedido ser liberado para a produção. |

Enquanto o status for qualquer um da tabela diferente de AGUARDANDO e de APROVADO, o pedido é contado no card **Em arte** da lista de Pedidos. Com APROVADO, ele passa para o card **Arte Aprovada** até ser liberado para a produção.

Em **Corrigir Dados**, **Dados Pendentes** e **Pendente Informação**, a arte está parada esperando alguma coisa. Abra o histórico do pedido ou fale com o designer para saber o que falta.

### Abrir o painel do cliente (link de aprovação)

1. Vá para a lista de Pedidos (menu → Pedidos).
2. Na coluna **Status Arte**, ao lado do selo, aparece um botão com o ícone de link quando o pedido tem um painel do cliente ativo.
3. Clique nele. O painel do cliente abre em nova aba. É esse endereço que o cliente usa para ver e aprovar a arte.

O link é criado pelo sistema de artes, não pelo Vibe. Pedido sem link ativo não mostra o botão. Dentro do pedido não há botão para o painel do cliente; ele fica só na lista.

### Abrir o pedido no Ideal Imposition

1. No cabeçalho do pedido, clique no botão com o logo do Ideal Imposition (ao passar o mouse aparece "Abrir no Ideal Imposition").
2. O Imposition abre **na mesma janela**, já no pedido correspondente.
3. Se houver alteração não salva no pedido, o navegador pergunta antes de sair. Salve antes de clicar.

### Consultar os últimos pedidos do cliente

O bloco **Últimos pedidos** lista as cinco propostas mais recentes do mesmo cliente, com o número e a data. Serve só para consulta. A coluna **Nome do Evento** mostra sempre "Evento não informado" e o link **Ver histórico completo** ainda não abre nada.

## Regras e bloqueios

- Não dá para abrir a aba Artes enquanto houver modelo incompleto na aba Pedido. A janela **Modelos incompletos** lista, por modelo, o que falta entre: Modelo, Qtd, Cor Papel, Numerador, Nº Inicial, Nº Final e Verso. Aparece também "Nº Final < Inicial" quando a numeração final é menor que a inicial.
- A trava só cobra o campo que o produto usa. Se o produto não tem verso ou numeração, esses campos nem aparecem na aba Pedido e não são cobrados aqui.
- Não dá para iniciar a arte de um pedido sem modelos. A aba mostra o aviso e nada mais.
- Não dá para enviar para arte sem o **Nome do Evento / Tema**.
- Não dá para anexar arquivo nem salvar o briefing em pedido que ainda não foi salvo pela primeira vez. Salve o pedido antes.
- Só entram JPEG, PNG e PDF como arquivo de referência, com até 10 MB cada.
- Clicar em **Enviar para arte** em um pedido cuja arte já andou (por exemplo, já em Em Aprovação) volta o status da arte para **EM ARTE**. Clicar em **Salvar dados da arte** sem designer selecionado volta para **AGUARDANDO**. Para só corrigir o texto do briefing sem mexer no status, use o **Salvar alterações** do pedido.
- Produto de prateleira não tem arte. Se todos os produtos do pedido forem de prateleira, a aba Artes some, o pedido não ganha "/ EM ARTE" no status e, quando o pagamento cobre o pedido inteiro, ele vai direto para REVISAO ATENDENTE.
- Em pedido misto (prateleira junto com produto normal), a arte continua valendo para o pedido inteiro. A aba aparece e o fluxo é o normal.
- O pedido só pode ser liberado para a produção quando o status da arte é **APROVADO**. Qualquer outro status barra a liberação com o aviso de pendência de arte.
- O "/ EM ARTE" que aparece no status do pedido (por exemplo "LIBERADO / EM ARTE") diz apenas que ainda há arte pendente. Em que ponto ela está é o selo de status da arte.

## Erros comuns

| O que aparece | Por que acontece | O que fazer |
|---|---|---|
| Janela **Modelos incompletos**: "Antes de acessar Artes, complete os modelos do Pedido." | Há modelo na aba Pedido sem algum campo que o produto exige. | Clique em **Entendi**, vá à aba **Pedido**, preencha o que a lista apontou e grave. |
| "Configure os modelos/lotes na aba Pedido antes de iniciar a etapa de Artes." | O pedido não tem nenhum modelo. | Crie os modelos na aba **Pedido**. |
| "Informe o Nome do Evento / Tema antes de enviar para arte." | Há designer selecionado, mas o nome do evento está vazio. | Preencha **Nome do Evento / Tema** e clique de novo em **Enviar para arte**. |
| "Salve a proposta antes de anexar arquivos de referência." | O pedido ainda não foi salvo pela primeira vez. | Salve o pedido e volte à aba. |
| "Formato inválido" — "Formato de arquivo não suportado. Apenas JPEG, PNG e PDF são permitidos." | O arquivo escolhido é de outro tipo (Word, Corel, ZIP...). | Converta para PDF, JPEG ou PNG. O chat do pedido, na aba Histórico, aceita também Word, Excel, ZIP, RAR e texto. |
| "Erro ao subir [nome do arquivo]" — "O tamanho do arquivo excede o limite permitido de 10MB." | O arquivo passa de 10 MB. | Reduza o arquivo ou divida em partes. |
| "Selecione ao menos um arquivo." | Clicou em **Adicionar** sem escolher arquivo. | Escolha o arquivo no campo **Arquivos**. |
| "Falha ao salvar dados da arte. Verifique o console." | O sistema não conseguiu gravar o briefing. | Confira a conexão e tente de novo. Se continuar, avise o suporte. |
| A aba Artes não aparece no pedido | O pedido é avulso ou todos os produtos são de prateleira. | Nada a fazer: esse pedido não passa por arte. |
| "Nenhum designer encontrado." | A lista de designers veio vazia. | Atualize a página. Se continuar vazia, peça a um administrador para conferir o cadastro dos designers. |
| O botão do painel do cliente não aparece na lista | O pedido não tem link ativo de painel do cliente. | O link nasce no sistema de artes. Fale com o designer. |

## Veja também

- [Proposta: visão geral e abas](proposta.md)
- [Proposta: aba Pedido (Boletim Técnico & Lotes)](proposta-pedido.md)
- [Proposta: abas Produção, Boletim e Histórico](proposta-producao-boletim-historico.md)
- [Proposta: aba Produtos](proposta-produtos.md)
- [Pedidos (lista)](pedidos.md)
- [Produção (ordens de serviço)](producao.md)
