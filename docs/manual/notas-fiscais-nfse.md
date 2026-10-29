# Notas fiscais: NFS-e (nota de serviço)

> **Última revisão:** 29/10/2026
> **Caminho no menu:** Financeiro → Notas fiscais → aba **Fila Faturamento** → **NFS-e**
> **Endereço:** `/notas-fiscais`

## Para que serve

É a emissão da **nota de serviço** (NFS-e) de um pedido, pela janela **Gerar NFS-e**. Só vale para pedido da **BIRÔ IDEAL**: nas outras empresas o botão não aparece.

A nota de produtos (NF-e), a fila, o histórico e tudo o que vem depois da nota estão em [Notas fiscais](notas-fiscais.md). Aqui ficam a janela da NFS-e, as regras dela e os avisos que ela dá.

## Quem acessa

- Emite quem tem a permissão **Emitir NFS-e (Serviço)** no perfil, além de Administrador e Super Administrador.
- O campo **NBS** do rascunho e o botão de salvá-lo aparecem só para administrador e super administrador.
- Quem vê a tela de Notas fiscais vê o histórico das notas de serviço, mesmo sem poder emitir.

## Botões e ações da tela

Nomes exatamente como aparecem na tela. Os botões da fila, do histórico e da NF-e estão em [Notas fiscais](notas-fiscais.md).

| Nome na tela | Onde fica | O que faz |
|---|---|---|
| **NFS-e** | Aba Fila, coluna **Ação**, entre **Nota emitida no sistema antigo** e **Faturar**; só em pedido da **BIRÔ IDEAL** | Abre a janela **Gerar NFS-e**. O texto muda com a nota de serviço do pedido: **NFS-e** (sem nota ou com rascunho), **NFS-e nº N** (autorizada), **NFS-e em análise** e **NFS-e (reenviar)** (o envio falhou). |
| **Endereço que vai na nota** (lista) | Janela **Gerar NFS-e**, seção **Endereço do tomador** | Escolhe o endereço do tomador entre os do cliente. Endereços iguais aparecem uma vez só; endereço com "cadastro incompleto" fica apagado. |
| **Serviço fiscal** (lista) | Janela **Gerar NFS-e**, seção **Serviço e itens** | Escolhe o serviço da nota entre os serviços ativos do cadastro. Abaixo aparecem o código de tributação e o NBS do escolhido. Hoje há um serviço só (13.05.01). |
| Caixa de marcar de cada item | Janela **Gerar NFS-e**, tabela de itens | Diz se o item do pedido entra na nota. Todos vêm marcados, e pelo menos um tem de ficar. |
| **Usar a soma** | Janela **Gerar NFS-e**, abaixo do **Valor da nota** | Volta o valor para a soma dos itens marcados. Aparece quando o valor foi alterado. |
| **Refazer a partir dos itens** | Janela **Gerar NFS-e**, abaixo da **Descrição do serviço** | Refaz a descrição com os itens marcados. Aparece quando a descrição foi alterada. |
| **Informações complementares (saem na nota)** (campo) | Janela **Gerar NFS-e**, seção **Pagamento do pedido**, abaixo da tabela | Texto que sai escrito na NFS-e. Vem preenchido com a condição de pagamento do pedido e pode ser alterado ou apagado. O contador mostra quantos caracteres já foram usados, de 2000. |
| **Refazer a partir do pagamento** | Janela **Gerar NFS-e**, abaixo das **Informações complementares** | Volta o texto para a condição de pagamento do pedido. Aparece quando o texto foi alterado. |
| **Avisos informativos (N)** | Janela **Gerar NFS-e**, seção **Validação** | Abre e fecha a lista dos avisos que só informam. |
| **Mais ações** | Janela **Gerar NFS-e**, rodapé, com o rascunho aberto | Abre o menu com **Criar outro rascunho**. |
| **Criar rascunho** | Janela **Gerar NFS-e** | Grava o rascunho da nota de serviço com o serviço, o endereço, o valor, a descrição e as informações complementares da janela. Não transmite nada. |
| **Emitir NFS-e** / **Reenviar NFS-e** | Janela **Gerar NFS-e**, com o rascunho aberto | Em homologação, envia a nota na hora, sem pedir confirmação. Em produção, abre a confirmação com o resumo da nota. |
| **Emitir em PRODUÇÃO** / **Voltar** | Janela **Gerar NFS-e**, na confirmação de produção | **Emitir em PRODUÇÃO** envia a nota com valor fiscal; **Voltar** fecha a confirmação sem enviar. |
| **Copiar detalhes** | Janela **Gerar NFS-e**, no quadro vermelho de erro | Copia o pedido, a referência da nota, a etapa, a hora e o código do erro, para mandar a quem vai investigar. |
| **Dispensar** | Janela **Gerar NFS-e**, no quadro vermelho de erro | Tira o erro da janela. Sem isso ele continua aparecendo, mesmo fechando e abrindo a janela. |
| **Ler de novo** | Janela **Gerar NFS-e**, quando os dados do pedido não carregam | Tenta ler os dados do pedido outra vez. |
| **Criar outro rascunho** | Janela **Gerar NFS-e**, menu **Mais ações** | Abre a composição de novo para criar um rascunho novo. O anterior fica sem uso. |
| **Voltar ao rascunho atual** | Janela **Gerar NFS-e**, no formulário aberto por **Criar outro rascunho** | Desiste do rascunho novo e volta ao que já existe. |
| **Consultar agora** | Janela **Gerar NFS-e**, com a nota em análise | Pergunta o status da nota na hora, sem esperar a consulta automática. |
| **Abrir PDF** / **Abrir XML** | Janela **Gerar NFS-e**, com a nota autorizada | Abre o PDF ou o XML da nota de serviço. |
| **Baixar PDF** / **Baixar XML** | Janela **Gerar NFS-e**, com a nota autorizada | Salva o arquivo no computador, com o nome "NFS-e-N-Pedido-P" (N é o número da NFS-e e P o do pedido). |
| **Fechar** | Janela **Gerar NFS-e** | Fecha a janela. O que já foi criado ou enviado continua valendo. |

## Passo a passo

### Emitir a NFS-e (nota de serviço) de um pedido

Só para pedido da **BIRÔ IDEAL** e para quem tem a permissão **Emitir NFS-e (Serviço)**.

1. Na aba **Fila Faturamento**, ache o pedido e clique em **NFS-e**, entre **Nota emitida no sistema antigo** e **Faturar**.
2. A janela abre com o título **NFS-e · Pedido #N**, o selo do status (Novo enquanto o rascunho não foi criado; depois Rascunho, Em análise, Autorizada ou Erro) e a faixa do ambiente. Em homologação a faixa é amarela e diz "HOMOLOGAÇÃO: NOTA DE TESTE, sem valor fiscal"; em produção é vermelha.
3. Confira os três quadros do resumo: **Informações gerais** (empresa emissora, ambiente e serviço fiscal), **Valores** (serviços e total da nota) e **Tomador** (nome, CPF ou CNPJ, e-mail e telefone do cliente do pedido).
4. Em **Endereço do tomador**, escolha o endereço na lista. Com um endereço só, ele já vem escolhido; com vários, a escolha é obrigatória.
5. Em **Serviço e itens**, confira o **Serviço fiscal** e a tabela dos itens do pedido (produto, quantidade, valor unitário e subtotal). Desmarque o item que não entra nesta nota.
6. Confira o **Valor da nota**. Ele é a soma dos itens marcados, já com o desconto do pedido, e pode ser alterado; se ficar diferente da soma, a janela avisa.
7. Confira a **Descrição do serviço**. Ela é gerada com os itens marcados (quantidade, nome e valor unitário) e pode ser alterada. O "Valor Unit R$ …" que vem no nome de alguns produtos do cadastro não entra. Com desconto no pedido, cada item sai com o subtotal e a descrição fecha com o desconto e o total, por exemplo "Desconto tabela especial (10%): - R$ 10,00" e "Total: R$ 90,00"; o desconto é calculado pela diferença entre o bruto dos itens e o total do pedido. O contador mostra quantos caracteres já foram usados, de 1000.
8. Em **Pagamento do pedido**, confira o campo **Informações complementares (saem na nota)**. Ele vem com a condição de pagamento do pedido, uma cobrança por linha, e pode ser alterado ou apagado. Depois clique em **Criar rascunho**: a janela passa a mostrar o rascunho, com a referência (por exemplo NFS-22760-001) e a seção **Validação**.
9. Clique em **Emitir NFS-e**. Em homologação a nota é enviada na hora, sem confirmação. Em produção aparece uma confirmação com a faixa **PRODUÇÃO**, a empresa, o tomador e o valor: confira e clique em **Emitir em PRODUÇÃO**.
10. A janela acompanha a nota sozinha: consulta a cada 15 segundos, por até 5 minutos. Quando a prefeitura responde, aparece a seção **Documentos**, com o número da NFS-e, a data de emissão, a chave de acesso e os botões **Abrir PDF**, **Baixar PDF**, **Abrir XML** e **Baixar XML**.
11. Se passar dos 5 minutos, a janela mostra "A nota continua em análise. Consulte depois.". Clique em **Consultar agora**, ou feche e volte mais tarde pelo botão **NFS-e em análise** da fila.

Depois da NFS-e autorizada o pedido sai da fila. Para vê-lo de novo, marque **Mostrar também pedidos com NFS-e emitida**: ele volta com o botão **NFS-e nº N**. Clicar nele abre a nota só para leitura, com os mesmos botões de abrir e de baixar o PDF e o XML. A nota também fica no **Histórico NFS-e**.

O rascunho não é editado depois de criado. Se o endereço, o valor, a descrição ou as informações complementares ficaram errados, abra **Mais ações** e clique em **Criar outro rascunho**: o anterior fica sem uso e a nota sai pelo novo.

A seção **Pagamento do pedido** mostra a forma, as parcelas, os vencimentos e os valores das cobranças ativas do pedido. A tabela é só para conferência: a NFS-e nacional não leva parcelas. O que vai para a nota é o texto do campo **Informações complementares (saem na nota)**, logo abaixo da tabela.

O texto das informações complementares é montado com o pagamento do pedido, uma frase por cobrança ativa:

- faturado: "Forma de pagamento: Faturado. 2 parcelas. Vencimentos: 28/10/2026 (R$ 50,00) e 11/11/2026 (R$ 50,00)."
- PIX ou boleto já pago: "Forma de pagamento: PIX. Pago em 06/10/2026 (R$ 270,00)."
- PIX ou boleto em aberto: "Forma de pagamento: Boleto. Vencimento: 20/10/2026 (R$ 80,00)."
- cartão: "Forma de pagamento: Cartão, 3 parcelas. Pago em 06/10/2026 (R$ 300,00)."

Quando a data não está gravada no pedido, a frase sai sem ela. Pedido sem cobrança ativa abre com o campo vazio, e a nota pode ser criada assim mesmo. Com o rascunho criado ou a nota autorizada, a janela mostra o texto gravado, só para leitura; se a nota não tem texto, aparece "Sem informações complementares".

Na seção **Validação**, o quadro verde "Rascunho validado, sem erros bloqueantes." diz que a nota pode ser enviada. Aviso em vermelho impede o envio; aviso em amarelo pede uma conferida e não impede; os que só informam ficam recolhidos em **Avisos informativos (N)**.

Enquanto a janela trabalha (lendo o pedido, criando o rascunho, emitindo ou consultando), os botões ficam apagados e aparece "Aguarde, não clique de novo". Depois de 15 segundos o aviso muda para "Ainda processando. Não feche nem clique de novo". A emissão pode levar vários segundos: espere.

Se a resposta não chegar (demora ou queda de conexão), a janela não conclui que deu errado: ela relê a nota e mostra o que existe, por exemplo "A resposta não chegou, mas o envio saiu: a nota está em análise". Leia o quadro vermelho antes de clicar de novo.

#### Saber se a NFS-e emitida pelo Vibe vale (homologação ou produção)

1. Abra a janela **Gerar NFS-e** do pedido e olhe a faixa do ambiente no topo. No **Histórico NFS-e (Serviços)**, olhe a coluna **Ambiente**.
2. **HOMOLOGAÇÃO** quer dizer nota de teste, sem valor fiscal. Hoje toda NFS-e emitida pelo Vibe sai assim.
3. Ainda não dá para emitir NFS-e em produção pelo Vibe. A emissão em produção existe no sistema só para a **BIRÔ IDEAL** e não foi ativada.
4. Para ter uma NFS-e com valor fiscal, emita pelo portal nacional (www.nfse.gov.br). O cancelamento de NFS-e também é pelo portal.

## Regras e bloqueios

- NFS-e (nota de serviço): sai pelo botão **NFS-e** da fila, só para pedido da **BIRÔ IDEAL**. Para as outras empresas o botão não aparece e o servidor recusa.
- Hoje a NFS-e pelo Vibe sai em **HOMOLOGAÇÃO**: é nota de teste, sem valor fiscal (o DANFSe traz o aviso "sem validade jurídica").
- A emissão em produção existe no sistema só para a **BIRÔ IDEAL** e ainda não foi ativada: a empresa continua em homologação. Enquanto a janela mostrar **HOMOLOGAÇÃO**, a nota não vale, e a NFS-e de verdade continua sendo emitida pelo portal nacional (www.nfse.gov.br).
- Um pedido tem uma NFS-e viva por vez:
  - com nota autorizada, a janela só mostra a nota e não cria outra;
  - com nota em análise, é preciso esperar o desfecho;
  - com rascunho, a janela reabre o mesmo, ou cria outro se você pedir;
  - com erro de envio, reenvia a mesma nota;
  - com nota recusada pela prefeitura ou cancelada, permite um rascunho novo.
- O cliente precisa ter CPF (11 dígitos) ou CNPJ (14 dígitos) no cadastro. Sem isso o rascunho não é criado.
- O valor sugerido para a nota é a soma dos itens marcados, com o desconto do pedido na mesma proporção. O frete do pedido não entra na nota de serviço.
- O subtotal de cada item é o que está gravado no pedido e inclui o valor fixo do item, quando há. Por isso pode ser maior que quantidade vezes valor unitário.
- Item cancelado no pedido não aparece na tabela. Pelo menos um item tem de ficar marcado.
- Endereços iguais do cliente (mesmo logradouro, número e CEP) aparecem uma vez só na lista.
- Endereço com texto inválido em algum campo ("NULL", "[object Object]" ou "<RUA>") aparece como "cadastro incompleto" e não pode ser escolhido. Corrija o cadastro do cliente.
- Não existe a opção de emitir sem endereço para cliente que tem endereço cadastrado: a escolha de um endereço é obrigatória.
- Na seção **Pagamento do pedido**, a tabela é só leitura e não é enviada na nota. O que é enviado é o texto das **Informações complementares**.
- As informações complementares são opcionais e têm até 2000 caracteres. Acima disso o **Criar rascunho** fica apagado. Quebra de linha é mantida.
- Cobrança cancelada não entra no texto das informações complementares. Cartão não ganha vencimento de parcela: quem define é a operadora.
- Alterar o pagamento do pedido depois de criar o rascunho não muda o texto já gravado. Para atualizar, crie outro rascunho.
- O serviço escolhido precisa estar ativo e ter código de tributação e NBS de 9 dígitos no cadastro. Sem isso o **Criar rascunho** fica apagado.
- Só entra na nota serviço com o NBS 121011000. Serviço com outro NBS é recusado até o banco ser ajustado para gravar o NBS do serviço.
- **NBS do rascunho:** super administrador e administrador veem o campo **NBS** e o botão **Salvar NBS** no rascunho (ou na nota com erro de envio), antes de emitir. O NBS precisa ter exatamente 9 dígitos, sem pontos. Nota autorizada, em análise, recusada ou cancelada não muda. Para os outros usuários o NBS aparece só para leitura. A alteração fica registrada com o nome de quem mudou.
- Os serviços da lista vêm do cadastro de serviços da NFS-e. A janela não cadastra nem altera serviço.
- A descrição do serviço tem de 1 a 1000 caracteres. Acima disso o **Criar rascunho** fica apagado.
- Quando o município do endereço escolhido não é reconhecido, a nota sai sem o endereço do tomador. A janela avisa e não bloqueia. O mesmo vale para cliente sem endereço cadastrado.
- Homologação não pede confirmação para emitir. Produção pede uma, com o resumo da nota.
- A janela nunca tenta de novo sozinha. Depois de um erro, quem decide repetir é você, com o que o quadro vermelho informar.
- O erro fica na janela até você clicar em **Dispensar**, ou até a nota ser autorizada. Fechar a janela não o apaga.
- Os alertas mostrados antes de emitir são informativos. Os marcados em vermelho apontam dado que a integração recusa: corrija o cadastro antes de enviar.
- O número que identifica a nota de serviço é o **número da NFS-e**. A referência (NFS-pedido-sequência) é interna do Vibe.
- Pedido com NFS-e **autorizada** sai da fila. A caixa **Mostrar também pedidos com NFS-e emitida** traz esses pedidos de volta. NFS-e em rascunho, em análise ou com erro mantém o pedido na fila. A nota de venda (NF-e) continua tirando o pedido da fila como antes, assim que sai do rascunho.
- No **Histórico NFS-e (Serviços)** ficam a busca, os filtros por empresa, por status e por ambiente, **Abrir PDF**, **Abrir XML** e **Copiar Link**.
- Cada nota de serviço do histórico mostra o selo do ambiente: **HOMOLOGAÇÃO** ou **PRODUÇÃO**. Nota sem ambiente gravado aparece como HOMOLOGAÇÃO.
- A NFS-e não se cancela pelo Vibe. O item **Cancelar NFS-e** aparece apagado na nota autorizada; o cancelamento é pelo portal nacional (www.nfse.gov.br), avisando o fiscal.
- Nota de serviço com status que a tela não conhece (por exemplo, recusada pela prefeitura ou com retorno não reconhecido) aparece como **Em análise**. Parando o mouse sobre o status, a dica mostra o status real. Ela continua na lista e entra no filtro **Em análise**.

## O que não confundir

- **NF-e** e **NFS-e**: a NF-e é a nota dos produtos do pedido; a NFS-e é a nota de serviço, só da **BIRÔ IDEAL**. Um pedido pode ter as duas, cada uma com a própria numeração.
- **Histórico NF-e (Produtos)** e **Histórico NFS-e (Serviços)**: são listas separadas, cada uma com a própria busca e os próprios filtros.
- **Rascunho** e **nota**: o **Criar rascunho** só grava a composição no Vibe. A nota só existe para a prefeitura depois do **Emitir NFS-e**.

## Erros comuns

| O que aparece | Por que acontece | O que fazer |
|---|---|---|
| "A emissão de NFS-e pelo Vibe não está liberada para ..." | O pedido não é da **BIRÔ IDEAL**. | Não há NFS-e pelo Vibe para essa empresa. |
| "O cliente não tem CPF (11 dígitos) ou CNPJ (14 dígitos) no cadastro." | O documento do cliente está vazio ou incompleto. | Corrija o cadastro do cliente e abra a janela de novo. |
| "Escolha o endereço do tomador." | O cliente tem endereço e nenhum foi marcado. | Marque um endereço e clique em **Criar rascunho**. |
| "O serviço ... está sem código de tributação no cadastro." ou "... sem NBS de 9 dígitos no cadastro." | O cadastro do serviço está incompleto. | Peça ao administrador para acertar o cadastro do serviço. |
| "O serviço ... está inativo." | O serviço foi desativado depois que a janela abriu. | Feche e abra a janela, e escolha outro serviço. |
| "O serviço ... tem NBS ..., mas o banco ainda grava 121011000 em toda nota." | O serviço tem um NBS que o banco ainda não sabe gravar na nota. | Avise o administrador. A emissão com esse serviço depende de ajuste no banco. |
| "Não foi possível ler os serviços da NFS-e. Sem serviço, o rascunho não é criado." | O servidor não conseguiu ler o cadastro de serviços. | Feche e abra a janela. Se continuar, avise o administrador. |
| "Esta nota ainda não tem PDF guardado." (ou XML) | A nota foi autorizada, mas o arquivo ainda não chegou ao armazenamento. | Clique em **Consultar agora** no Histórico ou tente mais tarde. |
| "O PDF desta nota não foi encontrado no armazenamento." (ou XML) | O arquivo não está onde deveria. | Avise o administrador. |
| "O município deste endereço não foi reconhecido. A nota sairá sem o endereço do tomador." | A cidade ou a UF do endereço não confere com a lista oficial de municípios. | Pode seguir. Para a nota sair com endereço, corrija a cidade e a UF no cadastro do cliente antes de criar o rascunho. |
| "O valor difere da soma dos itens marcados (R$ ...)." | O valor digitado não é a soma dos itens marcados. | Confirme se é isso mesmo, ou clique em **Usar a soma**. Não bloqueia. |
| "O endereço escolhido está com o cadastro incompleto." | O endereço tem texto inválido em algum campo. | Escolha outro endereço ou corrija o cadastro do cliente. |
| "Marque pelo menos um item do pedido." | Nenhum item ficou marcado. | Marque o item que entra na nota. |
| "N de 1000 caracteres: reduza o texto para criar o rascunho." | A descrição passou do limite. | Encurte a descrição. |
| "N de 2000 caracteres: reduza o texto para criar o rascunho." | As informações complementares passaram do limite. | Encurte o texto ou clique em **Refazer a partir do pagamento**. |
| "Sem informações complementares" | O rascunho ou a nota foi criado sem texto. | Nada a fazer. Se o texto era necessário e a nota ainda é rascunho, crie outro rascunho. |
| "Este pedido já tem NFS-e autorizada (nº N)." | Alguém já emitiu a nota deste pedido. | Use a nota existente. A janela passa a mostrá-la. |
| "A NFS-e ... deste pedido está em análise. Aguarde o desfecho antes de criar outra." | Há uma nota do pedido sem resposta da prefeitura. | Clique em **Consultar agora** ou volte mais tarde. |
| "A resposta não chegou, mas o rascunho ... foi criado." | A criação do rascunho demorou ou a conexão caiu, e o rascunho existe. | Confira o rascunho mostrado e emita por ele. Não crie outro. |
| "A resposta não chegou e o rascunho NÃO foi criado." | A criação não chegou ao servidor. | Clique em **Criar rascunho** de novo. |
| "A resposta não chegou, mas o envio saiu: a nota está em análise." | A emissão demorou ou a conexão caiu, e a nota foi enviada. | Aguarde. A janela acompanha sozinha; se quiser, clique em **Consultar agora**. |
| "A resposta não chegou, mas a nota foi AUTORIZADA (NFS-e nº N)." | A resposta se perdeu, mas a nota saiu. | Nada a fazer: a nota está emitida. |
| "... o envio foi registrado e pode estar a caminho. NÃO emita de novo" | O envio foi iniciado e ainda não há retorno gravado. | Não clique em emitir. Aguarde e use **Consultar agora**. |
| "A resposta não chegou e o envio NÃO foi registrado. A nota continua como rascunho." | A emissão não chegou ao servidor. | Clique em **Emitir NFS-e** de novo. |
| "A resposta não chegou e não foi possível conferir o estado da nota." | A conexão caiu e a releitura também falhou. | Feche a janela, abra de novo e confira o que aparece antes de repetir. |
| "A leitura dos dados do pedido demorou demais." ou "Sem conexão com o servidor" | Os dados do pedido não carregaram. | Clique em **Ler de novo**. |
| "Outra emissão desta mesma nota já está em andamento." | Duas pessoas clicaram em emitir a mesma nota. | Aguarde e clique em **Consultar agora**. |
| "Sem permissão para emitir NFS-e (fiscal.emit_nfse)." | Seu perfil não tem a permissão **Emitir NFS-e (Serviço)**. | Peça a emissão a quem tem a permissão, ou peça a permissão ao administrador. |
| "A empresa ... está sem o ambiente de NFS-e definido ..." | O cadastro da empresa emitente está sem o ambiente de NFS-e. | Avise a equipe técnica: hoje o ambiente da empresa (homologação ou produção) é definido direto no banco de dados, e não existe tela para isso. Depois que a equipe técnica definir, emita de novo. |
| "Esta nota de serviço já foi emitida (número N). Nova emissão bloqueada." | A nota já tem número de NFS-e. | Não reenvie. Use a nota existente; clique em **Consultar agora** para atualizar o que a janela mostra. |
| "Esta NFS-e não pode ser enviada de novo: ..." | O retorno guardado da integração mostra que a prefeitura já processou esta nota. | Clique em **Consultar agora** para trazer o desfecho. Só crie outra nota se esta não tiver sido autorizada. |
| "Emissão não permitida: a nota está em ..." | A nota já foi enviada ou está em um status que não aceita envio. | Clique em **Consultar agora** e aguarde o desfecho. |
| "Não foi possível contatar a integração fiscal. A nota segue pronta para envio." | O Vibe não conseguiu falar com a integração fiscal. | Clique em **Consultar agora**; se a nota continuar como rascunho, clique em **Emitir NFS-e** de novo. Se repetir, avise o suporte. |
| Faixa vermelha com a mensagem da prefeitura ou do envio | A nota foi recusada ou o envio falhou. | Leia a mensagem. Em erro de envio, corrija e clique em **Reenviar NFS-e**; em nota recusada pela prefeitura, abra a janela de novo e crie outro rascunho. |
| "A integração fiscal não respondeu à consulta. O status mostrado é o último gravado." | A consulta não chegou à integração. | Tente **Consultar agora** em alguns minutos. |
| "A nota continua em análise. Consulte depois." | Passaram 5 minutos sem resposta da prefeitura. | Clique em **Consultar agora** ou feche e volte pelo botão **NFS-e em análise**. |

## Veja também

- [Notas fiscais](notas-fiscais.md)
- [Proposta: aba Pagamentos](proposta-pagamentos.md)
- [Carteira (contas a receber)](carteira.md)
- [Pedidos (lista)](pedidos.md)

## Arquivos de origem

- `src/features/nfse/components/GerarNfseModal.tsx`
- `src/features/nfse/components/PecasNfse.tsx`
- `src/features/nfse/lib/regras-emissao.ts`
- `src/features/nfse/lib/janela-nfse.ts`
- `src/features/nfse/lib/composicao-nfse.ts`
- `src/features/nfse/services/nfse-pedido.server.ts`
- `src/app/api/fiscal/rascunho-nfse/route.ts`
- `src/app/api/fiscal/emitir-nfse/route.ts`
- `src/app/api/fiscal/consultar-nfse/route.ts`
- `src/app/api/fiscal/nfse-arquivo/route.ts`
- `src/features/fiscal/NotasFiscaisPage.tsx`
