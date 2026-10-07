# Expedição

> **Última revisão:** 07/10/2026
> **Caminho no menu:** Expedição (item direto do menu lateral, sem subitens; é o quarto, depois de Conferência, Pedidos e Clientes). Também se chega pela aba **Expedição** no topo do Kanban e da Fila de impressão da Produção.
> **Endereço:** `/expedicao`

## Para que serve

É a bancada de saída dos pedidos: do acabamento até a entrega. Aqui o expedidor confere peso e volumes, imprime a etiqueta, gera a prepostagem dos Correios, despacha, confirma a coleta, a retirada no balcão e a entrega.

A tela também avisa o que está atrasado ou prometido para hoje e segura o despacho quando o frete cobrado na proposta não corresponde mais ao envio.

## Quem acessa

- Vê a tela quem tem a permissão **Visualizar Expedição** no perfil, além de Administrador e Super Administrador. Quem não tem recebe "Acesso Negado — Você não tem permissão para visualizar a Expedição." Só com essa permissão já dá para gerar etiquetas, a declaração de conteúdo e consultar o rastreio.
- Para agir (marcar pronto, despachar, confirmar coleta, retirada e entrega, voltar status, editar dados de expedição, gerar prepostagem, recotar frete) é preciso a permissão **Processar Envio / Retirada**. O perfil Expedidor já nasce com as duas.
- Só o administrador da Expedição (permissão **Configurar Expedição**, ou Administrador) libera a aplicação de uma recotação, libera um despacho travado pela diferença de frete e marca uma prepostagem como cancelada.
- **Corrigir frete** aparece para quem tem a permissão **Editar Proposta Paga** (ou Administrador).
- **Encerrar teste** é exclusivo do Super Administrador.

## Botões e ações da tela

Nomes exatamente como aparecem na tela, inclusive maiúsculas, acentos e erros de grafia.

### Topo da tela e filtros

| Nome na tela | Onde fica | O que faz |
|---|---|---|
| **Voltar para Fila Geral (OS)** | Faixa no alto da tela, ao lado de "Expedição e Logística" | Abre o painel de Produção (`/pedidos`) |
| **Transportadoras** | Cabeçalho, à direita do título | Abre a lista de transportadoras cadastradas |
| **Expedição do dia** | Cartão do topo ("Atrasados e prometidos hoje") | Filtra atrasados e prometidos para hoje, em qualquer etapa. É o filtro com que a tela abre |
| **Pronto p/ expedir** | Cartão do topo ("A despachar e aguardando coleta") | Filtra os pedidos com status Na Expedição |
| **A retirar** | Cartão do topo ("Cliente busca no balcão") | Filtra os pedidos com status A Retirar |
| **Em trânsito** | Cartão do topo ("Com a transportadora") | Filtra os pedidos com status Em Trânsito |
| **Entregues** | Cartão do topo ("Últimos 7 dias") | Filtra os pedidos entregues nos últimos 7 dias, do mais recente para o mais antigo |
| **Ver em lista** / **Ver por transportadora** | Abaixo dos cartões, à esquerda da legenda de cores | Alterna entre o Kanban e a tabela. O texto diz para onde o botão leva |
| Campo **Buscar por nº do pedido, cadastro, cliente, rastreio ou transportadora...** | Caixa de filtros | Busca nas duas visões |
| **Todos os fretes** | Caixa de filtros | Filtra por categoria de transporte: Correios, Motoboy, Retira balcão, Rodoviário, Aéreo, Veppo, Extras |
| **Todas Empresas** | Caixa de filtros | Filtra pela empresa do pedido |
| **Todos os pedidos** / **Só complementos** / **Só com complemento** | Caixa de filtros | Filtra pelo vínculo de pedido complementar |
| **Limpar filtros** | Caixa de filtros | Volta ao estado inicial: Expedição do dia, Kanban, sem busca e sem filtros |

### Kanban e lista

| Nome na tela | Onde fica | O que faz |
|---|---|---|
| Nome da coluna com a contagem (**Correios**, **Motoboy**, **Retira balcão**, **Rodoviário**, **Aéreo**, **Veppo**, **Extras**) | Barra fixa no topo do Kanban | Rola o Kanban até a coluna |
| Setas (ícones; texto "Ver colunas à esquerda" / "Ver colunas à direita") | Pontas da barra do Kanban | Rolam uma coluna por vez |
| Ícone de arquivo com seta (texto "Baixar DANFE - …" ou "Baixar DANFE (N notas)") | Canto do card, ao lado do menu; só com nota autorizada | Abre a DANFE. Com mais de uma nota, abre a lista **Baixar DANFE** para escolher |
| Ícone **⋯** (texto "Ações") | Canto do card no Kanban | Abre o menu de ações do pedido. A ação principal da etapa é o primeiro item |
| **⋯ Acoes** (escrito assim, sem acento) | Coluna **Ações** da lista | Abre o menu de ações do pedido. Em tela estreita o menu abre de baixo para cima, com o título "Menu de acoes" e o botão **Fechar** |
| Código de rastreio (texto "Copiar código") | Coluna **Rastreio** da lista | Copia o código |
| **Marcar pronto** | Botão na lista; primeiro item do menu no Kanban. Pedido ainda na fábrica | Pede confirmação e leva o pedido para a bancada |
| **Despachar** | Idem. Pedido Na Expedição ainda não despachado | Abre a janela **Despachar pedido** |
| **Confirmar coleta** | Idem. Pedido despachado aguardando coleta | Pede confirmação e leva o pedido para Em Trânsito |
| **Confirmar retirada** | Idem. Pedido A Retirar | Abre a janela **Confirmar retirada** |
| **Marcar entregue** | Idem. Pedido Em Trânsito | Pede confirmação e conclui o pedido como Entregue |

### Menu de ações do pedido

Os itens aparecem nesta ordem, cada um só quando se aplica.

| Nome na tela | Onde fica | O que faz |
|---|---|---|
| **Rastrear objeto** | Menu de ações; só com código de rastreio | Abre a janela **Rastreamento** |
| **Marcar prepostagem como cancelada** | Menu de ações; só administrador da Expedição, com prepostagem ainda não marcada | Registra que a prepostagem foi cancelada no portal dos Correios |
| **Editar dados de expedição** | Menu de ações; pedido com etiqueta gerada ou já despachado | Abre a mesma janela do despacho em modo de edição |
| **Declaração de conteúdo** | Menu de ações; pedido que já chegou à Expedição e não tem nota autorizada | Abre o PDF da declaração |
| **Boletim da produção** | Menu de ações; sempre | Abre o boletim do pedido |
| **Liberar aplicação da recotação** | Menu de ações; só administrador da Expedição, pedido Na Expedição | Autoriza uma aplicação de recotação na proposta |
| **Recotação já liberada** | No lugar do item acima, apagado | Só informa que já há liberação ativa |
| **Cancelar liberação** | Menu de ações, abaixo de "Recotação já liberada" | Desfaz a liberação ainda não usada |
| **Corrigir frete** | Menu de ações; quem pode editar proposta paga, sem nota autorizada, sem despacho confirmado | Abre a janela **Corrigir frete** |
| **Voltar status** | Menu de ações; pedido que já chegou à Expedição | Abre a janela **Voltar status** |
| **Encerrar teste** | Menu de ações; só Super Administrador | Tira o pedido de teste das listas operacionais, depois de uma confirmação do navegador |

### Janela Despachar pedido / Editar dados de expedição

| Nome na tela | Onde fica | O que faz |
|---|---|---|
| **Retira no balcão** / **FOB — por conta do cliente** / **CIF — por conta da empresa** | Topo da janela, só em pedido sem modalidade definida | Escolhe quem paga o transporte |
| **Confirmo: este pedido deixa de ir pelos Correios.** | Caixa de marcar no aviso amarelo, em pedido FOB que estava definido para os Correios | Troca o transporte para transportadora |
| **Recotar frete** | Bloco "Recotar frete", em pedido CIF Na Expedição | Cota de novo e registra o resultado. Não altera a proposta |
| **Aplicar** | Ao lado de cada opção recotada | Grava o frete novo na proposta. Fica apagado sem liberação ou quando a opção encarece |
| **Gerar prepostagem SEDEX** | Abaixo do rastreio, em envio CIF pelos Correios. Não aparece quando o pedido tem transportadora escolhida que não é os Correios | Cria a prepostagem SEDEX e preenche o rastreio |
| **PAC** | Ao lado do botão acima | Cria a prepostagem PAC |
| **Gerar SEDEX** / **Gerar PAC** | Confirmação "Gerar outra prepostagem?" | Gera outra prepostagem em pedido que já tinha uma |
| **Gerar etiqueta 10x15** | Botão azul largo, abaixo das observações | Salva o formulário e abre a etiqueta de envio |
| **Etiqueta de retirada** | Mesmo botão, em retirada no balcão | Salva e abre a etiqueta de balcão |
| **Etiqueta Correios (oficial)** | Mesmo botão, em Correios com prepostagem | Salva e abre o rótulo oficial dos Correios |
| **Etiqueta Correios — gere a prepostagem** | Mesmo botão, apagado, em Correios sem prepostagem válida | Não abre nada: avisa que falta a prepostagem |
| **Despachar mesmo assim (há justificativa: remessa sem NF, retirada, etc.)** | Caixa de marcar no aviso vermelho de pedido sem nota | Libera o botão de confirmar |
| **Desvincular e despachar separado** | Caixa de marcar no quadro do pedido complementar | Separa o complemento, com motivo obrigatório |
| **Liberar despacho (ADM)** | Quadro vermelho da trava de frete; só administrador da Expedição | Libera um despacho, com motivo obrigatório |
| **Cancelar liberação** | Quadro verde "Despacho liberado"; só administrador da Expedição | Desfaz a liberação do despacho |
| **Cancelar** | Rodapé | Fecha sem gravar |
| **Salvar sem despachar** | Rodapé, só no despacho | Guarda o que foi preenchido; o pedido segue Na Expedição |
| **Confirmar despacho** | Rodapé, no despacho por transporte | Despacha o pedido |
| **Confirmar: aguardando retirada** | Rodapé, no despacho de retirada | Leva o pedido para A Retirar |
| **Salvar dados** | Rodapé, no modo de edição | Grava as correções sem mudar o status |

### Outras janelas

| Nome na tela | Onde fica | O que faz |
|---|---|---|
| **Marcar pronto** / **Confirmar coleta** / **Confirmar entrega** | Janelas de confirmação "Marcar como pronto", "Confirmar coleta" e "Confirmar entrega" | Executa a mudança de status. **Cancelar** desiste |
| **Confirmar entrega** | Janela **Confirmar retirada**, botão verde | Conclui a retirada no balcão |
| **Voltar 1 passo** | Janela **Voltar status** | Desfaz um passo, com motivo |
| Ícone de setas em círculo (texto "Atualizar") | Topo da janela **Rastreamento** | Refaz a consulta do rastreio |
| **Correios confirmam a entrega — marcar ENTREGUE no sistema** | Rodapé da janela **Rastreamento**, quando os Correios acusam a entrega de um pedido Em Trânsito | Abre a confirmação de entrega |
| **Nova transportadora** | Topo da janela **Transportadoras** | Abre o cadastro de uma transportadora nova |
| **Editar** | Em cada linha da janela **Transportadoras** | Abre o cadastro daquela transportadora |
| **Rodoviário** / **Aéreo** | Janela **Corrigir frete**, pergunta "Como vai o transporte?" | Define a coluna do Kanban quando o sistema não reconhece a transportadora |
| **Confirmar correção** | Rodapé da janela **Corrigir frete** | Grava a correção. Vira **Nada a corrigir** (apagado) quando nada mudou |
| **Revisar o crédito** → **Gravar e escolher o destino** | Mesmo botão, quando sobra valor a favor do cliente | Mostra o crédito e, no segundo clique, grava a correção |
| **Manter crédito para uso futuro** / **Devolver ao cliente (solicitar ao Financeiro)** / **Abater débito existente** | Janela "Diferença Financeira — Crédito ao Cliente", depois da correção | Escolhe o destino do crédito. **Confirmar** registra |

## Passo a passo

### Entender a tela

1. No topo ficam cinco cartões, e cada um é um filtro. A tela abre em **Expedição do dia**.
   - **Expedição do dia** — atrasados e prometidos para hoje, em qualquer etapa, inclusive os que ainda estão na fábrica.
   - **Pronto p/ expedir** — pedidos com status Na Expedição: os que ainda vão ser despachados e os já despachados que aguardam a coleta.
   - **A retirar** — pedidos com status A Retirar: estão no balcão esperando o cliente buscar.
   - **Em trânsito** — pedidos com status Em Trânsito: já saíram com Correios, transportadora ou motoboy.
   - **Entregues** — pedidos com status Entregue nos últimos 7 dias. O pedido entregue continua no painel e na busca por 30 dias.
2. Clicar num cartão troca o filtro. Clicar de novo no mesmo cartão não desfaz; para voltar ao início use **Expedição do dia** ou **Limpar filtros**.
3. Abaixo dos cartões, a busca aceita número do pedido, número do cadastro, nome do cliente (razão ou fantasia), rastreio ou transportadora. O número de um pedido complementar também acha o principal, e vice-versa.
4. Os filtros ao lado são **Todos os fretes** (por categoria), **Todas Empresas** e **Todos os pedidos** / **Só complementos** / **Só com complemento**.
5. O botão **Transportadoras**, no cabeçalho, abre a lista de transportadoras cadastradas, com **Nova transportadora** e **Editar**.

### Usar o Kanban e a lista

1. A tela abre no Kanban. As colunas são as categorias de transporte, nesta ordem: **Correios**, **Motoboy**, **Retira balcão**, **Rodoviário**, **Aéreo**, **Veppo** e **Extras**. Coluna vazia não aparece. Pedido ainda sem categoria definida fica em **Extras**.
2. A barra no topo do Kanban lista as colunas com a quantidade de cada uma. Clique no nome para ir até a coluna; as setas rolam uma coluna por vez.
3. Dentro de cada coluna, os pedidos prontos para despachar aparecem primeiro.
4. Cada card mostra o número do pedido, o cadastro (`cli 8469`), o nome do cliente, a cidade de entrega, o pagador (quando é outra pessoa), quem leva, o último acontecimento com data e hora ("Pronto", "No balcão", "Despachado", "Coletado", "Entregue"), a data prevista (`prev`), peso, volumes e o frete cobrado.
5. Quando o pedido tem nota autorizada, o card traz o ícone de baixar a DANFE.
6. As ações ficam no ícone **⋯** do card (ao passar o mouse aparece "Ações"). A ação principal da etapa é sempre a primeira da lista.
7. Clique em **Ver em lista** para trocar para a tabela, e em **Ver por transportadora** para voltar ao Kanban. Na lista a ação principal vira um botão na coluna **Ações**, ao lado do botão **⋯ Acoes** que abre o mesmo menu, e o rastreio pode ser copiado com um clique.
8. O selo de status mostra **Na Expedição**, **A Retirar**, **Em Trânsito** e **Entregue**. No Kanban, o selo some quando repete o cartão do topo que está ativo.

### Ler as cores e os avisos de prazo

1. A legenda ao lado do botão de visão vale para o fundo do card no Kanban e para o ponto ao lado do status na lista:
   - branco — **ainda na fábrica**;
   - azul — **na bancada, a despachar**;
   - laranja — **despachado, aguardando coleta**;
   - verde — **já saiu**.
2. O selo vermelho **ATRASADO Nd** aparece quando a data prometida já passou e o pedido ainda não saiu da bancada. Na lista, a linha inteira fica avermelhada.
3. O selo âmbar **HOJE** aparece quando a promessa é para hoje e o pedido ainda não saiu. Na lista, a linha fica amarelada.
4. Na lista, **SEM NF** aparece em vermelho para pedidos com status Na Expedição, A Retirar ou Em Trânsito sem nota autorizada.
5. Os selos **Compl. de #X** e **+ compl. #Y** marcam pedido complementar. O **+ compl.** fica verde quando o complemento já está na Expedição e âmbar quando ainda não chegou.

### Marcar o pedido como pronto

1. No pedido que ainda está em produção ou acabamento, clique em **Marcar pronto**.
2. Confirme em **Marcar pronto**. O pedido passa para o status Na Expedição e vai para a bancada.

O pedido também chega à Expedição pela Revisão do boletim da produção.

### Conferir o pedido (peso e volumes)

1. No pedido com status Na Expedição, clique em **Despachar**.
2. Confira o quadro do topo: **Destinatário**, **Endereço**, **Bairro**, **Fone**, **CEP**, **Cidade/UF**, **Forma de envio** e **Observações**. Endereço e transportadora vêm da proposta e não são trocados aqui. Em pedido CIF com transportadora escolhida, **Forma de envio** mostra "TRANSPORTADORA" e o nome dela, mesmo que o frete tenha sido cotado como SEDEX ou PAC.
3. Preencha **Peso aferido (kg)**. O campo já vem com a soma do peso medido nos setores, quando existe. Abaixo dele aparecem o peso previsto e, se algum setor ficou sem pesar, o aviso para conferir na balança.
4. Preencha **Qtd. volumes** (de 1 a 50) e **Tipo de volume** (Pacote, Caixa, Envelope ou Outro).
5. Se não há nota autorizada, digite o número em **Nº da nota fiscal** quando houver. Com nota autorizada o campo vem preenchido e não é editável.
6. Em **Observações (vão na etiqueta)**, escreva o que deve sair impresso no volume.
7. Se o pedido não tem modalidade de frete definida, escolha uma: **Retira no balcão**, **FOB — por conta do cliente** ou **CIF — por conta da empresa**. Quando a modalidade já está definida, ela aparece só para leitura no cabeçalho.
8. Para guardar o que preencheu e continuar depois, clique em **Salvar sem despachar**. O pedido segue na Expedição.

### Gerar a etiqueta

1. Dentro de **Despachar** (ou de **Editar dados de expedição**), preencha os dados do envio.
2. Clique no botão azul grande. O nome dele muda conforme o envio:
   - **Gerar etiqueta 10x15** — transportadora e motoboy;
   - **Etiqueta de retirada** — retirada no balcão;
   - **Etiqueta Correios (oficial)** — Correios com prepostagem gerada.
3. O sistema salva o que está na tela e abre o PDF.
4. Para reimprimir depois, use **Editar dados de expedição** no menu do pedido e clique no mesmo botão.

### Gerar a prepostagem dos Correios

1. O envio precisa ser CIF e pelos Correios. Em **Despachar**, preencha peso, volumes e confira o endereço.
2. Clique em **Gerar prepostagem SEDEX** ou em **PAC**.
3. O rastreio é preenchido sozinho e aparece o aviso "Prepostagem criada". A partir daí o botão da etiqueta vira **Etiqueta Correios (oficial)**.
4. Se o pedido já tinha prepostagem, o sistema pergunta "Gerar outra prepostagem?" e mostra os códigos. Copie o código que vai sair do registro se ainda precisar cancelá-lo no portal, e confirme em **Gerar SEDEX** ou **Gerar PAC**.

Também é possível digitar o código em **Código de rastreio (manual)**, que só aparece em envio pelos Correios.

### Cancelar a prepostagem

1. Cancele a prepostagem no portal dos Correios. O Vibe não cancela nos Correios.
2. No menu do pedido, clique em **Marcar prepostagem como cancelada** (só administrador da Expedição).
3. O rastreio e a etiqueta oficial somem da tela, e uma nova prepostagem pode ser gerada.

### Imprimir a declaração de conteúdo

1. No menu do pedido, clique em **Declaração de conteúdo**.
2. O PDF abre com remetente, destinatário e os itens do pedido.

A opção só aparece em pedido que já chegou à Expedição e não tem nota autorizada. É o papel que acompanha o volume no lugar da nota.

### Despachar

1. No pedido com status Na Expedição, clique em **Despachar** e faça a conferência.
2. Se o pedido não tem nota autorizada, marque **Despachar mesmo assim (há justificativa: remessa sem NF, retirada, etc.)**.
3. Se aparecer um quadro sobre o frete, resolva-o antes (veja "Recotar o frete").
4. Clique em **Confirmar despacho**. Em retirada, o botão se chama **Confirmar: aguardando retirada**.
5. O destino depende de como o pedido sai:
   - Correios — vai direto para Em Trânsito;
   - transportadora ou motoboy — continua Na Expedição como "aguardando coleta", com o card laranja, até o carro passar;
   - retirada — vai para A Retirar.

### Recotar o frete

O bloco **Recotar frete** aparece em **Despachar** quando o pedido é CIF e está Na Expedição.

1. Clique em **Recotar frete**. Qualquer expedidor pode recotar; isso não altera a proposta.
2. O sistema lista as opções com o valor e a diferença para o frete da proposta.
3. Veja o quadro que aparece acima dos botões:
   - **Recotação dentro do limite de R$ 4,00** — é só um aviso; o despacho segue. O frete e o total da proposta não mudam.
   - **Recotação acima do limite de R$ 4,00** — o despacho fica bloqueado até um administrador liberar.
   - **Recote o frete antes de despachar** — o endereço ou o transporte não são os cotados; é preciso recotar para medir a diferença.
4. Para liberar o despacho bloqueado, o administrador da Expedição abre o mesmo pedido em **Despachar**, escreve o motivo e clica em **Liberar despacho (ADM)**. A liberação vale para um despacho e pode ser desfeita em **Cancelar liberação**.
5. Para gravar o frete novo na proposta, o administrador usa antes **Liberar aplicação da recotação** no menu do pedido. Depois o expedidor recota e clica em **Aplicar** na opção desejada. A liberação vale para uma aplicação e pode ser desfeita em **Cancelar liberação**, no menu.
6. Ao aplicar, o frete e o total do pedido mudam pelo mesmo valor e o fato fica registrado na timeline do pedido. A diferença não é lançada na conta do cliente.

### Corrigir frete

Serve para trocar a modalidade (quem paga) e a transportadora de um pedido que já saiu do orçamento.

1. No menu do pedido, clique em **Corrigir frete**.
2. Escolha a **Modalidade do frete** e, fora de retirada, a **Transportadora** (obrigatória em FOB, opcional em CIF).
3. Se aparecer **Como vai o transporte?**, escolha **Rodoviário** ou **Aéreo**. Serve só para definir a coluna do Kanban; em branco, o pedido fica em **Extras**.
4. Confira o quadro com **Total atual**, **Total novo** e **Frete**. Em FOB e em retirada a proposta não cobra frete, então o total cai; em CIF vale o frete cotado.
5. Clique em **Confirmar correção**.
6. Se sobrar dinheiro a favor do cliente, o botão vira **Revisar o crédito** e depois **Gravar e escolher o destino**. A correção é gravada, o crédito é aberto na Conta Corrente do cliente e você escolhe o destino: **Manter crédito para uso futuro**, **Devolver ao cliente (solicitar ao Financeiro)** ou **Abater débito existente**.
7. Se ficar valor a receber, a correção grava direto. O saldo continua sendo da proposta e é cobrado na aba Pagamentos.

### Confirmar a coleta

1. No pedido laranja (despachado, aguardando coleta), clique em **Confirmar coleta** quando a transportadora ou o motoboy levar o volume.
2. Confirme. O pedido passa para Em Trânsito.

### Informar o rastreio e rastrear

1. O código de rastreio entra pela prepostagem ou pelo campo **Código de rastreio (manual)**, em envio pelos Correios.
2. Na lista, clique no código para copiá-lo.
3. No menu do pedido, clique em **Rastrear objeto**. A janela mostra a situação atual e os eventos; o botão de atualizar refaz a consulta.
4. Quando os Correios confirmam a entrega de um pedido Em Trânsito, aparece o botão **Correios confirmam a entrega — marcar ENTREGUE no sistema**.

### Confirmar a retirada no balcão

1. No pedido com status A Retirar, clique em **Confirmar retirada**.
2. Em **Quem retirou?**, escreva o nome de quem levou o pedido.
3. Clique em **Confirmar entrega**. O pedido passa para Entregue.

### Marcar como entregue

1. No pedido com status Em Trânsito, clique em **Marcar entregue**.
2. Leia o aviso, se houver, e clique em **Confirmar entrega**.

Em envio pelos Correios despachado há menos de 12 horas, o sistema avisa há quanto tempo o pedido foi postado. É só um aviso: confirmando, a entrega fica registrada com a data e a hora de agora.

### Voltar um passo

1. No menu do pedido, clique em **Voltar status**.
2. Escreva o motivo (obrigatório, mínimo de 3 letras; fica registrado).
3. Clique em **Voltar 1 passo**.

Os retornos possíveis são: Entregue volta para Em Trânsito (ou para A Retirar, se foi retirada); Em Trânsito e A Retirar voltam para Na Expedição; Na Expedição volta para EM ACABAMENTO.

### Editar dados de um pedido já despachado

1. No menu do pedido, clique em **Editar dados de expedição**.
2. Corrija peso, volumes, observações da etiqueta ou o número da nota, ou reimprima a etiqueta.
3. Clique em **Salvar dados**. O status não muda.

### Despachar pedido com complemento

1. O despacho é feito pelo pedido principal. O complemento que já está na Expedição e pago sai junto, com o mesmo transporte e a mesma data.
2. O quadro **Pedido complementar do mesmo evento** mostra a situação de cada complemento: "em EXPEDICAO, sai junto" ou o motivo do bloqueio.
3. Se o complemento ainda não chegou à Expedição ou não está pago por inteiro, espere ou marque **Desvincular e despachar separado** e escreva o **Motivo**. O complemento deixa de sair junto e passa a precisar de frete próprio.
4. Confirmar coleta, retirada e entrega no principal levam junto o complemento que está no mesmo status.
5. Se o complemento não acompanhou o despacho, abra **Despachar** no próprio complemento para repetir o passo.

### Abrir o boletim da produção

1. No menu do pedido, clique em **Boletim da produção**.

### Encerrar pedido de teste

1. No menu do pedido, clique em **Encerrar teste** (só Super Administrador).
2. Confirme. O pedido sai deste painel, do painel de Produção, do Kanban e da fila de impressão.
3. Para reabrir, use o menu de ações do pedido na tela **Pedidos** do menu lateral (o aviso a chama de "Orçamentos").

## Regras e bloqueios

- Não dá para despachar sem a modalidade do frete, a transportadora, o endereço de entrega, o peso aferido e a quantidade de volumes. Em retirada, basta a modalidade. O rastreio é opcional.
- A etiqueta e a prepostagem exigem os mesmos dados do despacho enquanto o pedido ainda não saiu. Imprimir etiqueta de um envio que ninguém terminou de declarar não é permitido.
- **Salvar sem despachar** e **Salvar dados** não exigem os campos mínimos: servem para guardar ou corrigir.
- Não dá para trocar o endereço de entrega nem a transportadora na Expedição. Os dois vêm da proposta. A modalidade também, quando já está definida; ela se corrige na aba Fretes da proposta ou em **Corrigir frete**.
- Pedido CIF com transportadora escolhida (no orçamento ou em **Corrigir frete**) vai por transportadora, mesmo com frete cotado como SEDEX ou PAC: a **Forma de envio** mostra a transportadora, os botões de prepostagem dos Correios não aparecem e o sistema recusa gerar prepostagem. Isso não vale quando a transportadora escolhida é o próprio cadastro dos Correios, nem quando o frete foi cotado como motoboy. Tirar a transportadora em **Corrigir frete** volta o pedido ao serviço cotado.
- Se o pedido já tem prepostagem dos Correios gerada e não cancelada, ele continua como Correios e a janela avisa: "Já há prepostagem dos Correios gerada; cancele-a para despachar por transportadora". Cancele a prepostagem e marque-a como cancelada para o pedido passar a ir pela transportadora.
- Falta de nota autorizada não bloqueia o despacho, mas exige marcar a confirmação.
- A trava de frete só vale em CIF. Quando o CEP de entrega ou o transporte são diferentes dos cotados, vale a última recotação feita para o CEP atual: até R$ 4,00 acima do frete da proposta só avisa; acima disso, ou sem recotação, o despacho e a prepostagem ficam bloqueados até a liberação de um administrador da Expedição.
- Peso acima do cotado (além de 200 g ou 5%, o que for maior) gera o aviso "O frete cobrado pode não refletir este envio", mas não bloqueia.
- Recotar é livre para o expedidor. **Aplicar** depende de liberação do administrador e só aceita opção que barateia ou empata o frete; com nota autorizada, só o que barateia. Não se aplica em pedido sem pagamento confirmado, em proposta avulsa, em pedido já entregue nem em pedido despachado com rastreio ou prepostagem emitidos.
- Recotação só existe em CIF e com o pedido Na Expedição.
- Prepostagem só existe em CIF. Em FOB não há envio pelos Correios pelo cartão da empresa: se o pedido estava definido para os Correios, é preciso marcar **Confirmo: este pedido deixa de ir pelos Correios.**
- Depois de gerada a prepostagem, nome, endereço e telefone do destinatário ficam congelados nos Correios. Para corrigir, gere outra prepostagem e cancele a anterior no portal.
- Gerar outra prepostagem não cancela a anterior. O sistema guarda só a última anterior.
- Cada empresa posta no próprio contrato dos Correios. Sem credencial da empresa do pedido, a prepostagem é recusada.
- **Corrigir frete** só vale para pedido Na Expedição ou A Retirar. Não aparece com nota autorizada, com despacho confirmado ou com pedido entregue. Com despacho confirmado, volte um passo antes; com nota autorizada, cancele a nota antes. Na prática, o pedido A Retirar já tem o despacho confirmado, então precisa voltar um passo para ser corrigido.
- **Corrigir frete** é recusado quando o total muda e o pedido tem título ativo no Contas a Receber. Se o total não muda, a correção passa.
- **Corrigir frete** muda o total do pedido conforme a modalidade nova. A etiqueta já impressa continua válida.
- Pedido complementar não é despachado sozinho enquanto o principal não foi despachado.
- **Voltar status** no principal não volta o complemento.
- Toda mudança de status confere se o pedido ainda está no status que a tela mostrava. Se outra pessoa mexeu antes, a ação é recusada e a lista recarrega.
- Marcar a prepostagem como cancelada não apaga o código: ele só deixa de aparecer na tela.
- Pedido de teste encerrado continua acessível por busca e por endereço direto, e segue contando no faturamento.

## O que não confundir

- **Colunas do Kanban x cartões do topo.** As colunas dizem por onde o pedido vai (Correios, Motoboy, Retira balcão, Rodoviário, Aéreo, Veppo, Extras). Os cartões dizem em que etapa ele está. Despachar muda o cartão e a cor do pedido; a coluna continua sendo o transporte.
- **Coluna Retira balcão x cartão A retirar.** A coluna reúne todo pedido de retirada, em qualquer etapa. O cartão mostra só os que já estão no balcão esperando o cliente (status A Retirar).
- **Cartão Pronto p/ expedir x cor do card.** O cartão junta dois momentos do mesmo status Na Expedição: o azul ainda vai ser despachado; o laranja já foi despachado e espera a coleta.
- **Despachar x Confirmar coleta.** Com transportadora ou motoboy, despachar só registra que o volume está pronto e rotulado; o pedido só vai para Em Trânsito em **Confirmar coleta**. Com Correios, despachar já leva para Em Trânsito.
- **Despachar x Editar dados de expedição.** É a mesma janela. **Despachar** confirma a saída e muda o status; **Editar dados de expedição** só corrige dados e reimprime a etiqueta.
- **Salvar sem despachar x Confirmar despacho.** O primeiro guarda um rascunho e o pedido não sai da bancada. O segundo é o despacho de fato.
- **Recotar frete x Aplicar.** Recotar só consulta o preço e registra o resultado; a proposta não muda. Aplicar grava o frete novo e o total na proposta e depende de liberação do administrador.
- **Liberar aplicação da recotação x Liberar despacho (ADM).** A primeira fica no menu de ações e autoriza gravar o frete recotado na proposta. A segunda fica dentro da janela de despacho e deixa o pedido sair apesar da diferença acima de R$ 4,00, sem mudar a proposta. Cada uma tem o seu **Cancelar liberação**.
- **Recotação x Corrigir frete.** A recotação mexe no preço do frete de um pedido CIF. **Corrigir frete** troca quem paga (Retira, FOB ou CIF) e a transportadora; o valor muda só como consequência da modalidade.
- **Limite de R$ 4,00 x "acima da alçada".** O limite de R$ 4,00 é a diferença entre a recotação e o frete da proposta, e é ele que trava o despacho. O selo "acima da alçada" aparece em opção de frete acima de R$ 150,00 e é só informativo.
- **Voltar status x Corrigir frete.** **Voltar status** desfaz um passo do andamento, com motivo. Não muda frete nem valor. É o caminho para reabrir **Corrigir frete** num pedido já despachado.
- **Marcar prepostagem como cancelada x cancelar nos Correios.** O item do menu só avisa o Vibe. O cancelamento de verdade é feito no portal dos Correios.
- **Gerar etiqueta 10x15 x Etiqueta Correios (oficial).** A 10x15 é a etiqueta do Vibe para transportadora e motoboy. O rótulo oficial vem dos Correios e só existe depois da prepostagem. Um não substitui o outro.
- **Declaração de conteúdo x etiqueta.** A declaração é o papel que acompanha o volume quando não há nota. A etiqueta é o endereçamento colado no volume.
- **Peso aferido x Previsto.** O aferido é o que foi para a balança e é o que o despacho grava. O previsto, mostrado abaixo do campo e marcado como "(cotado)" ou "(previsto)" nos cards, é estimativa.
- **Cidade do card x cidade do cadastro.** O card e a lista mostram a cidade do endereço de entrega, que pode ser diferente da cidade do cadastro do cliente.
- **Segunda linha colorida abaixo do nome do cliente.** É o pagador, quando quem paga não é o cliente do pedido.
- **Confirmar entrega nas duas janelas.** Na janela **Confirmar retirada** o botão conclui a retirada no balcão; na janela **Confirmar entrega** conclui a entrega de um pedido Em Trânsito. As duas levam ao status Entregue.
- **Entregues (7 dias) x permanência no painel (30 dias).** O cartão conta só a última semana. O pedido entregue segue na busca por 30 dias.
- **Status na tela x status nos avisos.** O selo mostra "Na Expedição", "A Retirar", "Em Trânsito" e "Entregue". Vários avisos escrevem os mesmos status em maiúsculas e sem acento: EXPEDICAO, A RETIRAR, EM TRANSITO, ENTREGUE.
- **Expedição x Produção x Pedidos.** O link **Voltar para Fila Geral (OS)** abre a tela que o menu lateral chama de **Produção**. Quando um aviso fala em "Orçamentos", é a tela que o menu chama de **Pedidos**.
- **"menu Ações" nos avisos.** É o menu **⋯** do pedido nesta tela, que na lista aparece escrito **Acoes**.

## Erros comuns

| O que aparece | Por que acontece | O que fazer |
|---|---|---|
| Falta informar o peso aferido (ou a transportadora, o endereço de entrega, a quantidade de volumes, a modalidade do frete) | Falta dado mínimo do despacho | Preencher o campo indicado. Endereço e transportadora se corrigem na proposta |
| Esta proposta não tem endereço de entrega definido. Defina o endereço na proposta para poder despachar. | A proposta está sem endereço de entrega | Definir o endereço na proposta |
| Confirme o despacho sem NF | O pedido não tem nota autorizada e a caixa não foi marcada | Marcar **Despachar mesmo assim** |
| Recote o frete para o CEP de entrega antes de despachar. | Pedido CIF com CEP ou transporte diferente do cotado, sem recotação | Clicar em **Recotar frete** |
| A recotação (R$ …) passa R$ … do frete da proposta (R$ …): acima de R$ 4,00 só com liberação de ADM. | A diferença passou do limite | Pedir ao administrador da Expedição o **Liberar despacho (ADM)** |
| Só um ADM da Expedição pode liberar o despacho com essa diferença. | Quem está na tela não é administrador da Expedição | Chamar o administrador |
| Recotação bloqueada: peça a um administrador para liberar este pedido no menu Ações da Expedição. | Tentou aplicar sem liberação | Pedir **Liberar aplicação da recotação** |
| Esta opção encarece o frete em R$ … Nesta fase só é possível aplicar o que barateia ou empata. | A opção é mais cara que o frete atual | Escolher outra opção, ou seguir pelo limite de R$ 4,00 ou pela liberação do despacho |
| O preço mudou desde a consulta … Recote para confirmar. | O valor da opção mudou entre recotar e aplicar | Recotar de novo |
| Pedido sem pagamento confirmado — a recotação só se aplica depois de pago. | Tentou aplicar em pedido sem pagamento | Aguardar o pagamento |
| Recotação só em CIF; este pedido está em FOB (ou RETIRA) | A modalidade não permite recotar | Corrigir a modalidade, se for o caso |
| Correios recusaram a prepostagem | Os Correios rejeitaram os dados, ou a empresa não tem credencial | Ler o motivo exibido, corrigir e gerar de novo |
| O rótulo oficial dos Correios só existe depois da prepostagem — gere-a acima. | Envio pelos Correios sem prepostagem válida | Gerar a prepostagem |
| Este pedido é complemento do #…: o despacho é feito pelo pedido principal, e os dois saem juntos. | Tentou despachar o complemento antes do principal | Despachar o principal |
| Complemento ainda não chegou | O complemento está fora da Expedição | Esperar ou usar **Desvincular e despachar separado** com motivo |
| Complemento sem pagamento integral | O complemento está na Expedição sem estar pago por inteiro | Esperar o pagamento ou desvincular com motivo |
| Complemento não saiu junto | O principal foi despachado, mas o complemento falhou | Abrir **Despachar** no complemento |
| O pedido mudou de status em outra tela. A lista será recarregada. | Outra pessoa alterou o pedido antes | Conferir o pedido na lista recarregada |
| Pedido #… ja foi despachado. Para corrigir o frete, volte um passo… | Corrigir frete com despacho confirmado | **Voltar status** e tentar de novo |
| Pedido #… tem a NF-e … autorizada… Cancele a nota antes de corrigir o frete. | Corrigir frete com nota autorizada | Cancelar a nota antes |
| Pedido #… ainda tem … titulo(s) ativo(s) no Contas a Receber. | A correção muda o total e há título ativo | Tratar os títulos com o financeiro antes |
| "…" não tem o formato de um objeto dos Correios… | O código não é dos Correios | Consultar no site da transportadora |
| Objeto … não foi encontrado em nenhum dos contratos… | Etiqueta recém-gerada ou código errado | Aguardar alguns minutos e atualizar |
| Peso inválido / Volumes inválidos | Peso zerado ou negativo; volumes fora de 1 a 50 | Corrigir o valor |

## Veja também

- [Pedidos (lista)](pedidos.md)
- [Produção (ordens de serviço)](producao.md)
- [Proposta: aba Fretes](proposta-fretes.md)
- [Proposta: aba Pagamentos](proposta-pagamentos.md)
- [Proposta: abas Produção, Boletim e Histórico](proposta-producao-boletim-historico.md)
- [Notas fiscais](notas-fiscais.md)
- [Carteira (contas a receber)](carteira.md)
- [Conferência](conferencia.md)

## Arquivos de origem

Arquivos de código de onde esta ficha saiu. O `scripts/checar-manual.mjs` lê esta lista: quando um deles muda e a ficha não, ele avisa.

- `src/features/expedicao/ExpedicaoPage.tsx`
- `src/features/expedicao/types.ts`
- `src/features/expedicao/components/KanbanTransportadoras.tsx`
- `src/features/expedicao/components/DespacharModal.tsx`
- `src/features/expedicao/components/ConferenciaDespacho.tsx`
- `src/features/expedicao/components/ConfirmarAcaoModal.tsx`
- `src/features/expedicao/components/CorrigirFreteModal.tsx`
- `src/features/expedicao/components/RastreioModal.tsx`
- `src/features/expedicao/components/RetiradaModal.tsx`
- `src/features/expedicao/components/VoltarStatusModal.tsx`
- `src/features/expedicao/components/TransportadorasModal.tsx`
- `src/features/expedicao/services/expedicao.service.ts`
- `src/features/expedicao/services/expedicao-acoes.service.ts`
- `src/features/expedicao/services/recotacao.client.ts`
- `src/features/expedicao/services/corrigir-frete-simulacao.ts`
- `src/features/expedicao/services/corrigir-frete-gravacao.ts`
- `src/features/expedicao/services/rastro.service.ts`
- `src/features/expedicao/lib/campos-minimos-despacho.ts`
- `src/features/expedicao/lib/carimbo-etapa.ts`
- `src/features/expedicao/lib/destino-despacho.ts`
- `src/features/expedicao/lib/divergencia-frete-despacho.ts`
- `src/features/expedicao/lib/entrega-cedo.ts`
- `src/features/expedicao/lib/etiqueta-do-pedido.ts`
- `src/features/expedicao/lib/filtro-categoria.ts`
- `src/features/expedicao/lib/pedido-em-aberto.ts`
- `src/app/(erp)/expedicao/page.tsx`
- `src/app/api/expedicao/`
- `src/app/api/pedidos/encerrar-teste/route.ts`
- `src/features/orcamentos/lib/categoria-frete.ts`
- `src/features/orcamentos/lib/modalidade-frete.ts`
- `src/features/orcamentos/components/DiferencaFinanceiraModal.tsx`
- `src/components/common/ActionsMenu.tsx`
- `src/components/common/BotaoDanfe.tsx`
- `src/components/common/StatusBadge.tsx`
- `src/lib/formatters/status.ts`
- `src/constants/navigation.ts`
- `src/features/auth/usuarios.service.ts`
- `src/features/usuarios-perfis/catalogo-permissoes.ts`
