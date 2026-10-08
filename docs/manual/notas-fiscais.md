# Notas fiscais

> **Última revisão:** 08/10/2026
> **Caminho no menu:** Financeiro → Notas fiscais (primeiro item da seção Financeiro do menu lateral)
> **Endereço:** `/notas-fiscais` (a nota aberta fica em `/notas-fiscais/[id]`)

## Para que serve

É a central de faturamento. Na aba **Fila Faturamento** ficam os pedidos que ainda precisam de nota e as notas que estão no meio do caminho (rascunho, processando ou com erro). Na aba **Histórico NF-e / NFS-e** ficam as notas que já viraram documento fiscal: autorizadas e canceladas.

Daqui se emite a NF-e de produto, se acompanha a autorização, se baixa o DANFE e o XML, se envia carta de correção, se cancela a nota e se lança a nota autorizada no contas a receber.

## Quem acessa

- Só vê a tela quem tem a permissão **Visualizar Painel Fiscal**. Sem ela, o item não abre.
- **Emitir NF-e (Produto)**: mostra o botão **Faturar** na fila, o **Emitir NF-e** dentro da nota e o **Enviar para Focus** no menu da nota. Sem essa permissão a pessoa consegue abrir e conferir a nota, mas não transmite.
- **Emitir NFS-e (Serviço)**: mostra o botão **NFS-e** na fila, só nos pedidos da **BIRÔ IDEAL**, e permite criar o rascunho, emitir e consultar a nota de serviço. O servidor confere a mesma permissão em cada passo.
- **Cancelar Nota Fiscal**: mostra **Cancelar NF-e** no menu da NF-e autorizada. O item **Cancelar NFS-e** também aparece, mas apagado: a NFS-e ainda não se cancela pelo Vibe.
- **Liberar para Nota Fiscal**: mostra o botão **Nota emitida no sistema antigo** na fila e, na tela **Pedidos**, a ação que desfaz essa marca.
- **Emitir Carta de Correção**: mostra **Carta de Correção** no menu da nota autorizada. O servidor confere a mesma permissão antes de enviar.
- Hoje os perfis **Administrador** e **Financeiro** têm todas essas permissões, e o **Super Administrador** pode tudo. O perfil **Designer** só visualiza a tela.
- Nota avulsa, segunda nota do pedido e descarte de rascunho não pedem permissão própria: aparecem para quem vê a tela. Transmitir a nota criada continua exigindo **Emitir NF-e (Produto)**.
- Abrir DANFE e XML exige apenas estar logado e enxergar a nota.

## Botões e ações da tela

Nomes exatamente como aparecem na tela, inclusive maiúsculas, acentos e erros de grafia. A tabela segue esta ordem: a lista (`/notas-fiscais`), as janelas que ela abre e, por fim, a nota aberta (`/notas-fiscais/[id]`).

| Nome na tela | Onde fica | O que faz |
|---|---|---|
| **Nova nota avulsa** | Cabeçalho da tela, à direita | Abre a janela **Nova nota avulsa**, para criar uma NF-e que não nasce de pedido. |
| **Fila Faturamento (N)** (aba) | Abas do topo, 1ª | Mostra os pedidos a faturar e a seção **Notas em processo**. O número conta só os pedidos. |
| **Histórico NF-e / NFS-e** (aba) | Abas do topo, 2ª | Mostra **Histórico NF-e (Produtos)** e, abaixo, **Histórico NFS-e (Serviços)**. |
| **Buscar fila por Ref, ID Cliente ou Nome...** | Aba Fila, filtros | Busca na lista de pedidos por número, código ou nome do cliente, sócio pagador e vendedor. |
| **Todas as Empresas Emitentes** | Filtros da Fila e dos dois Históricos | Filtra por **INGRESSO IDEAL**, **BIRÔ IDEAL** ou **E3 BRINDES**. |
| **Todos os status do pedido (N)** | Aba Fila, filtros | Filtra a lista de pedidos pelo status do pedido; cada opção mostra quantos pedidos tem. |
| **Só faturados (N)** — as cobranças do Financeiro | Aba Fila, caixa de marcar abaixo dos filtros | Deixa só os pedidos com cobrança do tipo **Faturado**. |
| **Mostrar também pedidos com NFS-e emitida** — inclui pedidos que ainda podem ter NF-e a emitir | Aba Fila, caixa de marcar ao lado de **Só faturados** | Traz de volta os pedidos que saíram da fila por já terem NFS-e autorizada. Desmarcada por padrão. Quando há pedidos escondidos, mostra **(+M com NFS-e emitida)**. |
| Número do pedido (**#N**, dica "Abrir a proposta") | Aba Fila, coluna **Pedido** | Abre a proposta do pedido. |
| Nome do cliente (dica "Abrir o cadastro do cliente") | Aba Fila, coluna **Cliente / Destinatário** | Abre o cadastro do cliente em edição. |
| **Nota emitida no sistema antigo** | Aba Fila, coluna **Ação** | Marca o pedido como faturado no sistema antigo e o tira da fila. Enquanto grava mostra "Marcando...". |
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
| **Faturar** | Aba Fila, coluna **Ação** | Confere o pedido e abre (ou cria) o rascunho da NF-e. Não transmite nada. |
| **Notas em processo (N)** | Aba Fila, abaixo da lista de pedidos | Seção com as notas que ainda não são documento fiscal. |
| Ícone de arquivo com seta (dica "Baixar DANFE - ..." ou "Baixar DANFE (N notas)") | Linha da nota, coluna **Ações** | Abre a DANFE; com mais de uma nota no pedido, abre a lista **Baixar DANFE** para escolher. |
| **Acoes** (na versão de celular, **Ações**) | Linha da nota, coluna **Ações** | Abre o menu da nota. Os itens mudam com o status. |
| **Editar** | Menu da nota Pendente | Abre a nota para edição. |
| **DANFE Preview** | Menu da nota Pendente ou Pronta para Envio; cabeçalho da nota aberta | Gera uma prévia da DANFE em outra aba, sem validade fiscal. |
| **Editar última hora** | Menu da nota Pronta para Envio | Devolve a nota a rascunho e abre para edição. |
| **Enviar para Focus** | Menu da nota Pronta para Envio | Abre a confirmação **Emitir NF-e**. |
| **Consultar status** | Menu da nota Processando; janela de emissão | Consulta a situação da nota. Não emite. |
| **Visualizar detalhes** | Menu da nota Processando, Autorizada, Cancelada ou Denegada | Abre a nota, só para leitura. |
| **Ver detalhes** | Menu da nota Rejeitada ou com erro de envio | Abre a nota para ler o motivo. |
| **Corrigir rascunho** | Menu da nota Rejeitada ou com erro de envio | Devolve a nota a Pendente, limpa o erro e abre para edição. |
| **Reenviar NF-e** | Menu da nota Rejeitada ou com erro de envio | Prepara a nota de novo e abre a confirmação **Emitir NF-e**. |
| **Atualizar status** | Menu da nota Rejeitada ou com erro de envio | Consulta a situação da nota. Não emite. |
| **Gerar outra nota de venda (faturamento parcial)** | Menu da nota de venda Autorizada em produção | Pede confirmação e abre o rascunho de uma segunda nota de venda do pedido. |
| **Gerar nota de remessa** | Menu da nota de venda Autorizada em produção | Pede confirmação e abre o rascunho da nota de remessa do pedido. |
| **Abrir DANFE (PDF)** | Menu da nota Autorizada | Abre a DANFE desta nota em outra aba. |
| **Copiar Link (PDF)** | Menu da nota Autorizada; menu da NFS-e | Copia um link do PDF que vale por 7 dias. |
| **Baixar XML** | Menu da nota Autorizada; janela de emissão | Baixa o XML da nota. |
| **Copiar Link (XML)** | Menu da nota Autorizada; menu da NFS-e | Copia um link do XML que vale por 7 dias. |
| **Lançar no Contas a Receber** | Menu da nota Autorizada de venda faturada ainda não lançada | Abre a janela **Preparar Cobrança** com as parcelas da nota. |
| **Revisar para gerar boletos** | Menu da nota Autorizada que já tem títulos | Abre a janela **Revisar para Geração Bancária**. |
| **Ver contas a receber** | Menu da nota Autorizada que já tem títulos | Abre a Carteira com a busca pela referência da nota. |
| **Cancelar NF-e** | Menu da nota Autorizada | Abre a janela **Cancelar NF-e**. |
| **Abrir Carta de Correção (PDF)** | Menu da nota Autorizada que já tem carta | Abre o PDF da última carta de correção. |
| **Baixar XML da Carta de Correção** | Menu da nota Autorizada que já tem carta | Abre o XML da última carta de correção. |
| **Carta de Correção** | Menu da nota Autorizada, para quem tem a permissão **Emitir Carta de Correção** | Abre a janela **Carta de Correção (CCe)**. |
| **Abrir XML** | Menu da nota Cancelada ou Denegada; menu da NFS-e | Abre o XML da nota. |
| **Descartar rascunho** | Menu da nota que nunca foi transmitida | Pede confirmação e apaga o rascunho. |
| **Copiar Ref** | Último item do menu de toda nota | Copia a referência da nota. |
| **Buscar por Nº Nota, Ref, ID ou Nome...** | Histórico NF-e, filtros | Busca nas notas autorizadas e canceladas. |
| **Todos os Status** | Histórico NF-e (Autorizada, Cancelada) e Histórico NFS-e (Pendente, Pronta para envio, Processando, Autorizada, Erro de Envio, Rejeitada, Cancelada, Em análise) | Filtra pelo status da nota. |
| **Ambiente: Todos** | Histórico NFS-e, filtros | Filtra as notas de serviço por **Produção** ou **Homologação**. Começa em Todos. |
| Selo **HOMOLOGAÇÃO** / **PRODUÇÃO** | Histórico NFS-e, coluna **Ambiente** | Diz em que ambiente a nota de serviço foi emitida. Homologação é nota de teste, sem valor fiscal. |
| **Buscar por Nº NFS-e, Ref, ID ou Nome...** | Histórico NFS-e, filtros | Busca nas notas de serviço. |
| **Cancelar NFS-e** | Menu da NFS-e Autorizada | Aparece apagado e não faz nada. Parando o mouse sobre ele, a dica explica: o cancelamento de NFS-e ainda não está disponível no Vibe. |
| **Abrir PDF** | Menu da NFS-e | Abre o PDF da nota de serviço. |
| **Abrir para corrigir** | Janela **A nota não pode ser aberta ainda**, em cada pendência | Leva à tela onde o dado se corrige (proposta, cadastro ou produtos). |
| **Reconferir** / **Fechar** | Janela **A nota não pode ser aberta ainda**, rodapé | Repete a conferência do pedido, ou fecha a janela. |
| **Emitir NF-e** / **Cancelar** | Janela **Emitir NF-e** | Transmite a nota, ou fecha sem transmitir. Durante a conferência o botão mostra "Conferindo...". |
| **Abrir DANFE** | Janela de emissão, com a nota autorizada | Abre a DANFE em outra aba, sem fechar a janela. |
| **Abrir a nota** | Janela de emissão, quando há erro (só na lista) | Leva à nota para corrigir. Não muda o status. |
| **Fechar** | Janela de emissão, depois do resultado | Fecha a janela. |
| **Buscar** | Janela **Nova nota avulsa**, ao lado do campo **Destinatário** | Procura o cadastro por código, nome, fantasia ou CNPJ. |
| **Criar rascunho** / **Cancelar** | Janela **Nova nota avulsa**, rodapé | Cria a nota avulsa e abre para edição, ou fecha. |
| **Gerar outra nota de venda** / **Cancelar** | Janela "Gerar OUTRA nota de venda do pedido #N?" | Cria o rascunho da segunda nota de venda, ou fecha. |
| **Gerar nota de remessa** / **Cancelar** | Janela "Gerar nota de REMESSA do pedido #N?" | Cria o rascunho da remessa, ou fecha. |
| **Descartar rascunho** / **Cancelar** | Janela "Descartar o rascunho ...?" | Apaga o rascunho, ou fecha sem apagar. |
| **Enviar CCe** / **Cancelar** | Janela **Carta de Correção (CCe)** | Envia a carta de correção, ou fecha. |
| **Confirmar** / **Cancelar** | Janela **Cancelar NF-e** | **Confirmar** cancela a nota; **Cancelar** só fecha a janela. |
| **Confirmar Lançamento** / **Cancelar** | Janela **Preparar Cobrança** | Cria os títulos no contas a receber e abre a Carteira, ou fecha. |
| **Depósito em conta** | Janela **Preparar Cobrança**, em cada parcela | Marca a parcela para ser lançada como depósito, sem boleto. |
| **Registrar boleto** | Janela **Revisar para Geração Bancária**, em cada parcela | Registra o boleto da parcela no banco. |
| **Registrar todos os boletos desta proposta** | Janela **Revisar para Geração Bancária** | Registra no banco todos os boletos elegíveis. |
| **Salvar Alterações** / **Cancelar** | Janela **Revisar para Geração Bancária**, rodapé | Grava os ajustes das parcelas, ou fecha. |
| **Voltar** | Cabeçalho da nota aberta | Volta para a lista, sem gravar. |
| **Emitir NF-e** | Cabeçalho da nota | Salva, valida, prepara a nota e abre a confirmação de emissão. Fica desabilitado enquanto houver pendência que impede. |
| **Só concluir rascunho** | Cabeçalho da nota | Salva, valida e, depois de **Confirmar Conclusão**, deixa a nota Pronta para Envio e volta para a lista. Não transmite. |
| **Salvar e sair** | Cabeçalho da nota | Grava o rascunho. A tela continua na nota. |
| **Reconferir** | Painel de pendências, no topo da nota | Recarrega a nota e o cadastro do cliente e refaz a conferência. |
| **Abrir em ...** (nome do bloco) | Painel de pendências, em cada linha | Abre o bloco e leva o cursor ao campo. |
| **Abrir cadastro** | Painel de pendências, em cada linha | Abre o cadastro do cliente em outra aba. |
| **Resumo**, **Emitente**, **Destinatário**, **Itens**, **Transporte/Frete**, **Pagamentos**, **Totais**, **Informações adicionais**, **Validação**, **Documentos/Preview** | Lateral **Conferência da nota** e cabeçalho de cada bloco | Na lateral, abre o bloco e rola até ele. No cabeçalho do bloco, abre ou recolhe. |
| **Natureza da operação** (lista "Selecionar natureza...") | Bloco Resumo | Define a natureza, o CFOP e a situação tributária de todos os itens. |
| **Empresa Emitente** | Bloco Emitente | Troca a empresa que emite a nota. |
| **Voltar ao cadastro** | Bloco Destinatário, abaixo de cada campo "só nesta nota" preenchido | Limpa o campo; a nota volta a usar o cadastro. |
| **Usar endereço de entrega diferente** | Bloco Destinatário, caixa de marcar | Mostra os endereços do cliente para escolher o de entrega. |
| **Informar novo endereço** | Bloco Destinatário, último cartão de endereço | Abre os campos para digitar um endereço de entrega. |
| **Salvar no cadastro do endereço** / **Desfazer** | Bloco Destinatário, só em nota de remessa | Grava nome e CPF do recebedor no cadastro do endereço, ou desfaz o que foi digitado. |
| **Adicionar Item Fiscal** / **Fechar Formulário** | Bloco Itens, à direita do título | Abre ou fecha o formulário **Adicionar Novo Item Fiscal**. |
| **CST** | Bloco Itens, coluna **Ações** de cada item | Abre a **Situação tributária** do item. Um ponto âmbar indica valor diferente do padrão da natureza. |
| **Salvar \*** (vira **Salvo** quando não há mudança) | Bloco Itens, coluna **Ações** | Grava a linha alterada. |
| **Excluir** | Bloco Itens, coluna **Ações** | Pede confirmação e remove o item. |
| **Adicionar Item** | Formulário **Adicionar Novo Item Fiscal** | Inclui o item na nota. |
| **Aplicar esta condição** | Bloco Pagamentos, abaixo de **Condição de pagamento** | Devolve quantidade, dias e intervalo aos valores da condição escolhida. |
| **Parcela única com vencimento específico** | Bloco Pagamentos, caixa de marcar | Gera uma parcela só, no vencimento escolhido. |
| **Arredondar valores das parcelas** | Bloco Pagamentos, caixa de marcar | Arredonda as parcelas e ajusta a diferença na última. |
| **Gerar Parcelas Fiscais** | Bloco Pagamentos | Cria as parcelas da nota, substituindo as que existirem. |
| **Usar datas e valores dos títulos** / **Descartar sugestão** | Bloco Pagamentos, aviso de títulos já lançados | Copia datas e valores dos títulos para as parcelas, ou volta ao que estava gravado. |
| **Visualizar arquivo técnico da nota (JSON)** | Bloco Documentos/Preview | Mostra os dados técnicos que serão enviados. |
| **Continuar e Invalidar** / **Cancelar** | Janela **Invalidação de Pagamentos** | Apaga as parcelas e segue com a alteração, ou desiste. |
| **Confirmar Conclusão** / **Cancelar** | Janela **Concluir Rascunho Fiscal** | Deixa a nota Pronta para Envio, ou fecha. |
| **Visualizar Pendências** | Janela **Inconsistências Fiscais Identificadas** | Leva ao bloco Validação. |
| **Reconferir mesmo assim** / **Voltar e salvar antes** | Janela **Reconferir descarta o que não foi salvo** | Recarrega e perde o que não foi salvo, ou volta. |
| **Confirmar** / **Cancelar** | Janelas **Confirmar Remoção**, **Remover Item e Invalidar Pagamentos** e **Alterar Forma de Pagamento** | Confirma a ação, ou fecha. |

## Passo a passo

### Entender a Fila Faturamento

1. Abra **Financeiro → Notas fiscais**. A tela já abre na aba **Fila Faturamento**, com a quantidade de pedidos entre parênteses.
2. A primeira lista é a dos **pedidos** que esperam nota. Cada linha mostra **Pedido** (clique no número para abrir a proposta), **Cliente / Destinatário** (clique para abrir o cadastro; quando quem paga é outro cadastro, aparece **Sócio pagador**), **Em produção desde**, **Empresa Emitente**, **Valor Total**, **Tipo de cobrança** e **Status do pedido**.
3. Use os filtros do topo: a busca **Buscar fila por Ref, ID Cliente ou Nome...** (também acha por sócio pagador e por vendedor), **Todas as Empresas Emitentes**, **Todos os status do pedido** e a caixa **Só faturados**, que deixa só os pedidos com cobrança do tipo faturado. A caixa **Mostrar também pedidos com NFS-e emitida** traz de volta os pedidos que já têm nota de serviço autorizada.
4. Abaixo vem a seção **Notas em processo**. Ela lista toda nota que ainda não é documento fiscal: pendente, pronta para envio, processando ou com erro. Os filtros do topo não escondem nada desta seção, de propósito.

O status do pedido é só informação: ele não impede nem libera a emissão.

### O que põe e o que tira um pedido da fila

Entra na fila o pedido que foi **liberado para produção**. Não existe uma liberação separada para nota: a liberação para produção já coloca o pedido na fila.

Sai da lista de pedidos quando:

- o pedido ganha uma nota de venda que já saiu do rascunho (pronta para envio, processando, autorizada ou com erro). A nota passa a aparecer em **Notas em processo** ou no **Histórico**;
- alguém marca **Nota emitida no sistema antigo**;
- o cliente do pedido está com o interruptor **Nota** desligado no cadastro;
- o pedido foi encerrado como teste;
- a **NFS-e** do pedido foi **autorizada**. Este é o único caso que dá para pedir de volta: marque **Mostrar também pedidos com NFS-e emitida**.

O número da aba **Fila Faturamento (N)**, o de **Só faturados** e os do filtro de status contam só o que está na tela. Quando há pedidos escondidos por NFS-e emitida, aparece **(+M com NFS-e emitida)** ao lado do número da aba e da caixa.

NFS-e em rascunho, em análise ou com erro não tira o pedido da fila: ainda há o que fazer nele. Se o Vibe não conseguir ler as notas de serviço, nenhum pedido é escondido.

Se o pedido com NFS-e emitida ainda precisa de **NF-e** (venda de produto), marque a caixa para ele voltar e use **Faturar** normalmente.

Volta para a lista quando a nota é **cancelada** ou **denegada**, quando o rascunho é **descartado** ou quando a marca de sistema antigo é desfeita. Rascunho ainda pendente e nota de remessa não tiram o pedido da fila.

### Emitir a NF-e de um pedido

1. Na fila, clique em **Faturar** na linha do pedido.
2. O sistema confere os dados do pedido antes de abrir a nota. Se faltar algo, aparece **A nota não pode ser aberta ainda**, com cada pendência, o setor que corrige e o botão **Abrir para corrigir**. Depois de corrigir na origem, clique em **Reconferir**.
3. Com tudo certo, abre o rascunho da nota. A referência segue o padrão `NFE-<pedido>-001`. Se o pedido já tinha um rascunho pendente, é ele que abre, e não um novo.
4. No topo, o painel **Falta resolver N coisas antes de emitir** lista o que trava a emissão. Cada linha tem **Abrir em ...** (leva ao campo) ou **Abrir cadastro** (abre o cadastro do cliente em outra aba). Depois de corrigir o cadastro, clique em **Reconferir**.
5. Confira os blocos da nota, na ordem da lateral:
   - **Resumo**: empresa, a linha **Sairá em** (PRODUÇÃO ou HOMOLOGAÇÃO) e a **Natureza da operação**. A natureza define o CFOP e a situação tributária de todos os itens; a lista só oferece as naturezas compatíveis com a operação (dentro ou fora do estado).
   - **Emitente**: a **Empresa Emitente** vem do pedido e pode ser trocada aqui.
   - **Destinatário**: a nota sai no nome de quem paga o pedido, com o endereço principal do cadastro. Confira **Consumidor Final** e **Tipo de Contribuinte**. A Inscrição Estadual vem do cadastro e só se corrige lá.
   - **Itens**: descrição, unidade, quantidade, valores, NCM e peso. O CFOP não se digita. O botão **CST** abre a situação tributária do item. **Adicionar Item Fiscal** inclui um item; **Salvar \*** grava a linha alterada; **Excluir** remove.
   - **Transporte/Frete**: **Modalidade do Frete**, transportadora, valor do frete, volumes e pesos.
   - **Pagamentos**: **Forma de Pagamento** e parcelas (veja a tarefa seguinte).
   - **Informações adicionais**: **Informações Complementares (Impresso na DANFE)**, que já nasce com o número do pedido, e **Observações Internas**, que não vão para a nota.
6. Se quiser ver como a nota vai ficar, clique em **DANFE Preview**, no cabeçalho. A prévia não tem validade fiscal.
7. Clique em **Emitir NF-e**. O sistema salva, valida e abre a confirmação **Emitir NF-e**. Leia o aviso (**Esta ação não pode ser desfeita**) e confirme em **Emitir NF-e**.
8. Acompanhe na própria janela: **Enviando nota para Focus...**, **Nota enviada. Aguardando processamento da Focus...** e **Consultando autorização e documentos fiscais...**. Enquanto aparecer **Não feche esta tela...**, espere.
9. Com **NF-e autorizada com sucesso.**, o DANFE abre sozinho em outra aba. Use **Abrir DANFE** e **Baixar XML** se precisar e depois **Fechar**: a tela volta para a fila.

Outros botões do cabeçalho da nota:

- **Só concluir rascunho**: valida e deixa a nota **Pronta para Envio**, sem transmitir. Depois, no menu da nota em **Notas em processo**, use **Enviar para Focus**.
- **Salvar e sair**: grava o rascunho como está. Apesar do nome, a tela continua na nota.
- **Voltar**: volta para a lista sem gravar.

### Emitir a NFS-e (nota de serviço) de um pedido

Só para pedido da **BIRÔ IDEAL** e para quem tem a permissão **Emitir NFS-e (Serviço)**.

1. Na aba **Fila Faturamento**, ache o pedido e clique em **NFS-e**, entre **Nota emitida no sistema antigo** e **Faturar**.
2. A janela abre com o título **NFS-e · Pedido #N**, o selo do status (Novo enquanto o rascunho não foi criado; depois Rascunho, Em análise, Autorizada ou Erro) e a faixa do ambiente. Em homologação a faixa é amarela e diz "HOMOLOGAÇÃO: NOTA DE TESTE, sem valor fiscal"; em produção é vermelha.
3. Confira os três quadros do resumo: **Informações gerais** (empresa emissora, ambiente e serviço fiscal), **Valores** (serviços e total da nota) e **Tomador** (nome, CPF ou CNPJ, e-mail e telefone do cliente do pedido).
4. Em **Endereço do tomador**, escolha o endereço na lista. Com um endereço só, ele já vem escolhido; com vários, a escolha é obrigatória.
5. Em **Serviço e itens**, confira o **Serviço fiscal** e a tabela dos itens do pedido (produto, quantidade, valor unitário e subtotal). Desmarque o item que não entra nesta nota.
6. Confira o **Valor da nota**. Ele é a soma dos itens marcados, já com o desconto do pedido, e pode ser alterado; se ficar diferente da soma, a janela avisa.
7. Confira a **Descrição do serviço**. Ela é gerada com os itens marcados (quantidade, nome e valor unitário) e pode ser alterada. O contador mostra quantos caracteres já foram usados, de 1000.
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

### Conferir parcelas e duplicatas

1. No bloco **Pagamentos**, escolha a **Forma de Pagamento**. Só **15 - Boleto Bancário** gera parcelas; as outras formas são tratadas como à vista, com um pagamento único no total da nota.
2. Para boleto, use **Gerar Parcelas Automaticamente**: escolha a **Condição de pagamento** (ela preenche quantidade, dias e intervalo, que continuam editáveis) ou marque **Parcela única com vencimento específico**. Se quiser, informe **Valor de entrada** e marque **Arredondar valores das parcelas**.
3. Clique em **Gerar Parcelas Fiscais**. A contagem de dias parte de hoje.
4. Ajuste **Vencimento** e **Valor Parcela (R$)** direto na tabela, se precisar, e salve.
5. Se a proposta já tem títulos no contas a receber, aparece o aviso com datas e valores e o botão **Usar datas e valores dos títulos**, que copia os dois para as parcelas de mesmo número. **Descartar sugestão** desfaz.

### Usar endereço de entrega diferente e encurtar dados do destinatário

1. No bloco **Destinatário**, marque **Usar endereço de entrega diferente** só quando a entrega for em endereço diferente do principal. Escolha um endereço cadastrado do cliente ou **Informar novo endereço** e salve. A nota nasce sempre com essa caixa desmarcada.
2. Quando o nome ou o endereço do cadastro passa de 60 caracteres, preencha **Nome / Razão Social (só nesta nota)** ou os campos de **Endereço só nesta nota** (Logradouro, Número, Complemento, Bairro). O cadastro do cliente não muda. **Voltar ao cadastro** limpa o campo.
3. Município, UF e CEP não têm versão só da nota: corrigem-se no cadastro do cliente. O código do município não é digitado em lugar nenhum; ele sai do nome da cidade e da UF do endereço, por isso os dois precisam estar escritos corretamente.

### Acompanhar o status e resolver nota parada

Abra o menu de ações da nota (em **Notas em processo** ou no **Histórico**). As opções mudam com o status:

| Status na tela | O que significa | O que fazer |
|---|---|---|
| Pendente | Rascunho ainda não concluído. | **Editar** para abrir a nota; **DANFE Preview**; **Descartar rascunho** se não for usar. |
| Pronta para Envio | Validada, esperando transmissão. | **Enviar para Focus** para emitir; **Editar última hora** devolve a nota a rascunho. |
| Processando | Transmitida, sem resposta final. | **Consultar status**. Não emita de novo. |
| Autorizada | Documento fiscal válido. | Baixar DANFE e XML, carta de correção, cancelamento. |
| Rejeitada | A SEFAZ recusou. | **Ver detalhes** para ler o motivo, **Corrigir rascunho** para reabrir, corrigir e emitir de novo. |
| ERRO_ENVIO, Falha de integração/envio, Retorno Focus, Não encontrada no Focus | A nota não chegou a ser autorizada por falha no envio ou recusa antes da SEFAZ. | **Atualizar status** primeiro. Se confirmar que não saiu, **Corrigir rascunho** ou **Reenviar NF-e**. |
| CANCELADA | Cancelada na SEFAZ. | **Visualizar detalhes** e **Abrir XML**. |

- **Corrigir rascunho** devolve a nota para Pendente, limpa o erro anterior e abre a nota para edição.
- **Reenviar NF-e** prepara a nota de novo e abre a confirmação de emissão, sem passar pela edição.
- Na janela de emissão, quando há erro, **Consultar status** só relê a situação (não emite) e **Abrir a nota** leva à nota para corrigir.

### Baixar DANFE e XML

1. Na linha da nota, clique no ícone **Baixar DANFE**. Com uma nota só, o PDF abre direto. Com mais de uma nota no pedido, o menu mostra **NF venda**, **NF complementar** e **NF remessa**, cada uma com número e referência.
2. No menu de ações da nota autorizada há **Abrir DANFE (PDF)**, **Copiar Link (PDF)**, **Baixar XML** e **Copiar Link (XML)**.
3. O link copiado vale por 7 dias a partir do momento em que foi copiado. Para mandar de novo depois disso, copie outro.

O ícone **Baixar DANFE** só aparece para nota autorizada em produção, com número e com o arquivo disponível.

### Enviar carta de correção (CC-e)

1. No **Histórico**, abra o menu da nota autorizada e clique em **Carta de Correção**.
2. Escreva o texto da correção, com pelo menos 15 caracteres. O botão **Enviar CCe** só libera depois disso.
3. Clique em **Enviar CCe**. Aparece **A solicitação foi enviada. Atualize a nota para conferir o status final.**
4. Depois de registrada, o menu da nota passa a mostrar **Abrir Carta de Correção (PDF)** e **Baixar XML da Carta de Correção**. O evento também aparece em **Eventos fiscais**, no bloco Resumo da nota.

### Cancelar uma nota

1. No **Histórico**, abra o menu da nota autorizada e clique em **Cancelar NF-e**.
2. Informe a justificativa, com pelo menos 15 caracteres, e clique em **Confirmar**.
3. Com **A nota fiscal foi cancelada com sucesso.**, a nota passa a Cancelada. Se o pedido não tiver outra nota de venda, ele volta para a lista da fila e pode ser faturado de novo.

Isso vale para a NF-e. **A NFS-e (nota de serviço) não se cancela pelo Vibe**: o item **Cancelar NFS-e** do menu fica apagado. Para cancelar uma NFS-e, use o portal nacional (www.nfse.gov.br) e avise o fiscal.

### Lançar a nota no contas a receber e preparar a cobrança

Vale para nota autorizada de pedido com cobrança do tipo **Faturado**. A coluna **Contas a Receber** da lista diz em que pé está: **Não lançado no contas a receber**, **Parcialmente lançado**, **Divergência**, **A receber criado — boleto não registrado**, **Boleto registrado**, **Depósito em conta** ou **Sem vencimentos fiscais**.

1. No **Histórico**, abra o menu da nota e clique em **Lançar no Contas a Receber**.
2. Abre a janela **Preparar Cobrança**, com o aviso **Parcelas definidas pela NF-e nº ...**. Vencimento e valor vêm da nota e não podem ser alterados aqui.
3. Confira a **Empresa recebedora** e, se precisar, ajuste **Descrição**, **Multa (%)** e **Juros/Dia (%)**. Marque **Depósito em conta** na parcela que não deve gerar boleto.
4. Clique em **Confirmar Lançamento**. O título é criado e o sistema abre a [Carteira](carteira.md) filtrada pela proposta, com a janela **Revisar para Geração Bancária** para registrar o boleto no banco.
5. Para voltar a essa janela depois, use **Revisar para gerar boletos** no menu da nota. **Ver contas a receber** abre a Carteira com a busca pela referência da nota.

Nota com duas parcelas ou mais não é lançada por este caminho: a janela mostra **Nota parcelada ainda não é suportada neste caminho**. Nesse caso, gere os títulos pelo [Registro de recebíveis](registro-de-recebiveis.md).

### Marcar "Nota emitida no sistema antigo" e desfazer

Ação temporária, da transição entre sistemas. Use só quando a nota do pedido já foi emitida no sistema antigo.

1. Na fila, clique em **Nota emitida no sistema antigo** na linha do pedido e confirme.
2. O pedido sai da fila. Liberação para nota, status e produção do pedido ficam como estavam, e nenhuma nota é criada no Vibe. O registro fica na linha do tempo do pedido.
3. Para desfazer, abra **Pedidos** no menu lateral (é a tela que o aviso chama de Orçamentos), ache o pedido (ele mostra a etiqueta **faturado no sistema antigo**), abra o menu da linha e clique em **Voltar para a Fila de Faturamento (desfazer nota no sistema antigo)**. O pedido volta a aparecer na fila.

### Gerar outra nota do mesmo pedido

No menu de uma nota de venda autorizada em produção:

- **Gerar outra nota de venda (faturamento parcial)**: cria uma segunda nota de venda do pedido, com número próprio.
- **Gerar nota de remessa**: cria a nota que acompanha a mercadoria, no nome de quem recebe e no endereço de entrega, sem cobrança. Ela não substitui a nota de venda.

Nos dois casos a confirmação lista as notas autorizadas que o pedido já tem. Nada é transmitido na hora: abre um rascunho para conferir e emitir.

### Criar uma nota avulsa

1. Clique em **Nova nota avulsa**, no cabeçalho da tela.
2. Escolha a **Empresa emitente**, busque o **Destinatário** por código, nome, fantasia ou CNPJ e confira os **Dados fiscais do destinatário**.
3. Clique em **Criar rascunho**. A nota nasce sem itens e sem cobrança: lance os itens, a natureza e o transporte na própria nota. Nas listas ela aparece como **Avulsa**.

### Descartar um rascunho

1. No menu da nota, clique em **Descartar rascunho** e confirme.
2. O rascunho some junto com os itens e as parcelas. O pedido não é alterado e pode ser faturado de novo.

## Regras e bloqueios

- Não dá para abrir a nota enquanto o pedido tiver pendência de origem: CPF ou CNPJ inválido de quem paga, tipo de contribuinte não definido, CNPJ contribuinte de ICMS sem Inscrição Estadual, endereço do pedido ausente ou incompleto, item sem NCM de 8 dígitos ou sem produto cadastrado, valor total zerado, pedido sem cobrança registrada ou empresa não habilitada para NF-e. A correção é feita na origem (cadastro, orçamento ou produto), não no fiscal.
- O botão **Emitir NF-e** fica desabilitado enquanto houver pendência que impede a emissão. Avisos não travam.
- Não dá para emitir com a soma das parcelas diferente do total da nota, nem com parcela vencendo antes da data de emissão.
- Nome, logradouro, número, complemento, bairro e município do destinatário, dados da transportadora e natureza da operação aceitam no máximo 60 caracteres na NF-e; a descrição do item, 120. Passando disso, a nota não é transmitida e a tela diz qual campo encurtar. Nada é cortado automaticamente.
- Alterar quantidade, valor de item ou frete em nota de boleto invalida as parcelas: é preciso gerá-las de novo.
- Trocar a forma de pagamento para uma que não seja boleto substitui as parcelas por um pagamento único à vista.
- A nota sai no ambiente em que a empresa emitente está no momento da transmissão. Com **Sairá em PRODUÇÃO**, a nota tem valor fiscal e número definitivo.
- Nota autorizada não se desfaz: só sai por cancelamento. Nota Autorizada, Cancelada, Denegada ou Processando não pode ser editada.
- Não dá para transmitir duas vezes a mesma nota. Se ela já tem número ou chave, ou se o retorno guardado indica autorização, a nova emissão é bloqueada.
- Só nota **Autorizada** pode ser cancelada, e só uma vez. Justificativa e texto de carta de correção precisam de pelo menos 15 caracteres.
- Carta de correção só vale para nota **Autorizada**, e o texto aceita no máximo 1.000 caracteres.
- O Vibe não confere prazo de cancelamento nem de carta de correção. Quem aceita ou recusa é a SEFAZ, e o motivo da recusa aparece no aviso.
- Só dá para descartar rascunho que nunca foi transmitido. Não dá para desfazer o descarte.
- Nota de remessa só pode ser gerada depois da nota de venda autorizada, e exige nome e CPF ou CNPJ do recebedor no endereço de entrega. Ela não tira o pedido da fila e não gera título.
- Cliente com o interruptor **Nota** desligado no cadastro não entra na fila. Vale o cliente do pedido, não o pagador. Esses pedidos não têm nota emitida pelo Vibe.
- **Só faturados** e a coluna **Contas a Receber** existem porque só venda faturada vira título. **Lançar no Contas a Receber** só aparece em nota autorizada de pedido com cobrança faturada em aberto.
- Não dá para lançar no contas a receber quando a soma das parcelas da nota difere do total faturado em aberto da proposta, nem quando a parcela já tem título ativo. Os valores não se ajustam na janela de lançamento: vêm da nota autorizada.
- Nota de remessa e nota de pedido pago por PIX, cartão, crédito ou boleto à vista não oferecem **Lançar no Contas a Receber**.
- A empresa emitente é uma de três: **INGRESSO IDEAL**, **BIRÔ IDEAL** e **E3 BRINDES**. Ela vem do pedido e pode ser trocada no bloco Emitente enquanto a nota ainda puder ser editada.
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

- Lista de pedidos da **Fila Faturamento**, **Notas em processo** e **Histórico**: a primeira é de pedidos que ainda não têm nota; a segunda é de notas que ainda não são documento fiscal; o Histórico só tem nota autorizada ou cancelada.
- Número da aba **Fila Faturamento (N)** e **Notas em processo (N)**: o da aba conta só os pedidos a faturar; as notas em processo têm contador próprio.
- **Faturar**, **Emitir NF-e** e **Enviar para Focus**: Faturar só abre o rascunho; Emitir NF-e (dentro da nota) e Enviar para Focus (no menu da nota pronta) transmitem de verdade.
- **Emitir NF-e** e **Só concluir rascunho**: o primeiro transmite; o segundo para em Pronta para Envio e não transmite.
- **Salvar e sair** e **Voltar**: Salvar e sair grava e continua na nota; Voltar sai para a lista sem gravar.
- **DANFE Preview** e **Abrir DANFE (PDF)**: a prévia é de rascunho e não vale como documento; a DANFE é a da nota autorizada.
- **Corrigir rascunho**, **Reenviar NF-e** e **Editar última hora**: Corrigir rascunho reabre a nota com erro para edição; Reenviar tenta de novo sem editar; Editar última hora reabre uma nota que estava pronta e ainda não foi transmitida.
- **Consultar status** e **Atualizar status**: fazem a mesma consulta; o nome muda conforme o status da nota. Nenhum dos dois emite.
- **Editar**, **Ver detalhes** e **Visualizar detalhes**: os três abrem a mesma tela da nota; ela fica só para leitura quando a nota está Autorizada, Cancelada, Denegada ou Processando.
- **Cancelar NF-e**, **Carta de Correção** e **Descartar rascunho**: cancelar anula uma nota autorizada na SEFAZ; a carta corrige um dado sem anular; descartar apaga um rascunho que nunca foi transmitido.
- Botão **Cancelar** e botão **Confirmar** na janela **Cancelar NF-e**: Cancelar só fecha a janela; quem cancela a nota é Confirmar.
- Status **Rejeitada** e aviso **A Focus recusou a nota**: rejeitada chegou à SEFAZ e foi recusada por ela; recusada pela Focus nem chegou à SEFAZ.
- **Nota emitida no sistema antigo** e nota emitida pelo Vibe: a marca só tira o pedido da fila e não cria nota, número nem DANFE no Vibe.
- Etiqueta **faturado no sistema antigo** e tipo de cobrança **Faturado**: a etiqueta diz que a nota saiu por fora; Faturado é a forma de cobrança do pedido (venda a prazo que vira título).
- Caixa **Só faturados** e pedidos já faturados: a caixa filtra pela forma de cobrança Faturado; pedido que já tem nota não aparece na lista de pedidos.
- **Gerar outra nota de venda (faturamento parcial)**, **Gerar nota de remessa** e **Nova nota avulsa**: as duas primeiras criam mais uma nota de um pedido que já tem nota autorizada; a avulsa não tem pedido.
- **NF venda**, **NF complementar** e **NF remessa** na lista **Baixar DANFE**: venda é a primeira nota de venda autorizada do pedido; complementar é cada nota de venda seguinte; remessa acompanha a mercadoria e não cobra.
- **Nº Nota**, referência (`NFE-...`) e **Pedido**: o número é o que a SEFAZ deu e só existe depois da autorização (antes aparece `****`); a referência identifica a nota no Vibe desde o rascunho; o pedido é o número da proposta.
- Status da nota e status do pedido na coluna **Status**: a etiqueta de cima é da nota; a de baixo, em cinza, é do pedido e não interfere na emissão.
- Parcelas da nota (**Gerar Parcelas Fiscais**) e títulos do contas a receber (**Lançar no Contas a Receber**): as parcelas são o que a nota declara à SEFAZ; os títulos são a cobrança na Carteira e só nascem com o lançamento.
- **Lançar no Contas a Receber** e **Revisar para gerar boletos**: o primeiro cria o título; o segundo abre títulos que já existem para registrar o boleto no banco.
- **A receber criado — boleto não registrado** e **Boleto registrado**: no primeiro o título existe, mas o boleto ainda não foi registrado no banco.
- **Empresa Emitente** (nota) e **Empresa recebedora** (janela Preparar Cobrança): a primeira emite a nota; a segunda é a que recebe o título e define o banco do boleto.
- Cliente e **Sócio pagador**: o cliente é quem fez o pedido; a nota sai no nome de quem paga.
- Endereço principal, **Usar endereço de entrega diferente** e **Endereço só nesta nota**: o principal é o do destinatário na nota; o de entrega é um segundo endereço informado na nota; "só nesta nota" apenas encurta o texto do endereço principal.
- **Sairá em** e **Transmitida em**: Sairá em mostra o ambiente em que a empresa está hoje, para nota ainda não transmitida; Transmitida em mostra onde a nota já saiu.
- **Data / Hora** da nota e **Em produção desde** do pedido: a primeira é quando a nota foi criada no Vibe, não a data da autorização; a segunda é quando o pedido foi liberado para produção, com data e hora na mesma linha (horário de Brasília). Logo abaixo vem um selo com a data prevista de entrega que a produção definiu no boletim do pedido. O selo diz o estado e muda de cor: **Previsão: dd/mm/aa** em azul quando a entrega é de amanhã em diante; **Previsão: hoje** em âmbar quando é hoje; **Atrasado: dd/mm/aa** em vermelho quando o dia já passou e o pedido continua na fila; **Sem previsão** em cinza quando a produção ainda não definiu a data. No celular o selo mostra também a data de hoje e há quantos dias está atrasado; no computador, essa informação aparece ao parar o mouse sobre o selo. Se o Vibe não conseguir ler as previsões, a coluna mostra só a data e a hora.
- **Abrir DANFE (PDF)** e **Copiar Link (PDF)**: abrir serve para ver agora; o link copiado é o que se manda a outra pessoa e vale por 7 dias.
- **Histórico NF-e (Produtos)** e **Histórico NFS-e (Serviços)**: são listas separadas, cada uma com a própria busca e os próprios filtros.
- Permissão **Liberar para Nota Fiscal** e entrada na fila: a permissão controla a marca de sistema antigo; quem põe o pedido na fila é a liberação para produção.
- Menu **Pedidos** e "Orçamentos": são a mesma tela; os avisos desta tela ainda usam o nome antigo.

## Erros comuns

| O que aparece | Por que acontece | O que fazer |
|---|---|---|
| "Sem permissão para emitir carta de correção (fiscal.carta_correcao)." | Seu perfil não tem a permissão **Emitir Carta de Correção**. | Peça o envio a quem tem a permissão. |
| "Carta de correção não permitida: a nota está em ..." | A nota deixou de estar Autorizada (foi cancelada, por exemplo). | Atualize a lista e confira o status da nota. |
| A nota não pode ser aberta ainda | A conferência do **Faturar** achou dado faltando no pedido, no cadastro ou no produto. | Use **Abrir para corrigir** em cada pendência e depois **Reconferir**. |
| Falta resolver N coisas antes de emitir | A nota tem pendência que impede a emissão. | Siga cada linha do painel pelo botão **Abrir em ...** ou **Abrir cadastro** e clique em **Reconferir**. |
| A nota não foi enviada: um campo passa do tamanho que a NF-e aceita. | Nome, endereço, transportadora, natureza ou descrição de item acima do limite. | Encurte no campo que o aviso indica (em geral os campos "só nesta nota") e emita de novo. Nada foi transmitido. |
| NF-e rejeitada pela Sefaz | A SEFAZ recusou a nota. A janela mostra o código, **O que significa** e **Como resolver**. | Feche, use **Corrigir rascunho**, ajuste o que o motivo aponta e emita de novo. |
| A Focus recusou a nota | A nota foi barrada antes de chegar à SEFAZ. Quando o motivo fala em município, a cidade ou a UF do endereço do destinatário está errada. | Corrija o que o motivo aponta e use **Reenviar NF-e**. Enviar de novo não gera nota em dobro. |
| Falha de autenticação com a Focus NFe | A credencial da empresa emissora foi recusada. | Peça a revisão da credencial e depois use **Consultar status**. |
| Falha de processamento | Falha de comunicação; não dá para saber se a nota saiu. | Use **Consultar status** antes de tentar de novo. |
| A NF-e ainda está em processamento. Consulte novamente em alguns instantes. | A SEFAZ ainda não respondeu. | Aguarde e use **Consultar status**. |
| Outra emissão desta mesma nota já está em andamento. | Duas pessoas ou dois cliques emitiram ao mesmo tempo. | Aguarde e use **Consultar status**. |
| Esta nota já foi emitida. Nova emissão bloqueada. | A nota já tem número ou chave. | Não reenvie. Atualize o status da nota. |
| Esta nota JÁ PARECE AUTORIZADA na SEFAZ | O retorno guardado indica autorização, mas a nota ficou sem número na tela. | Não emita de novo. Confira na SEFAZ e avise o administrador. |
| Ambiente da empresa não definido | A empresa emitente está sem ambiente de NF-e configurado. | Peça ao administrador para definir o ambiente da empresa. |
| Os pagamentos precisam ser regenerados! | Itens ou frete mudaram depois das parcelas. | No bloco Pagamentos, clique em **Gerar Parcelas Fiscais**. |
| Existe parcela com vencimento anterior à data de emissão. | Há parcela com data no passado. | Corrija o vencimento no bloco Pagamentos. |
| Informe o vencimento do pagamento antes de salvar. | Parcela sem data. | Preencha o vencimento e salve. |
| Cancelamento não permitido: a nota está em "..." | Só nota Autorizada pode ser cancelada. | Confira o status da nota. |
| Outro cancelamento desta mesma nota já está em andamento. | O cancelamento foi pedido duas vezes. | Aguarde e recarregue a lista. |
| Sem permissão para emitir NF-e / para cancelar nota fiscal | Seu perfil não tem a permissão da ação. | Peça ao administrador. |
| Não foi possível gerar a remessa | O endereço de entrega está sem recebedor ou sem CPF/CNPJ, ou o pedido não tem nota de venda autorizada. | Complete o endereço de entrega no cadastro do cliente e tente de novo. |
| Não foi possível descartar | A nota já tem número, chave, protocolo ou evento registrado. | Essa nota não pode ser apagada; se for o caso, cancele. |
| Nota sem parcela fiscal ativa | A nota não tem vencimento gravado para lançar. | Não há o que lançar a partir desta nota. Gere os títulos pelo Registro de recebíveis. |
| Sem faturado em aberto | A proposta não tem cobrança faturada em aberto. | Nada a lançar: só venda faturada entra no contas a receber. |
| Nota parcelada ainda não é suportada neste caminho | A nota tem duas parcelas ou mais. | Gere os títulos pelo Registro de recebíveis. |
| Lançamento bloqueado: totais não fecham | A soma das parcelas da nota difere do total faturado em aberto da proposta. | Regularize a nota ou a cobrança da proposta antes de lançar. |
| Duplicidade detectada! A parcela N desta origem já possui um boleto ativo no Contas a Receber | A parcela já foi lançada. | Use **Revisar para gerar boletos**. Para refazer, cancele o título atual na Carteira antes. |
### Na janela Gerar NFS-e

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
| "A empresa ... está sem o ambiente de NFS-e definido ..." | O cadastro da empresa emitente está sem o ambiente de NFS-e. | Avise o administrador: o ambiente se define em Cadastros › Empresas. Depois emita de novo. |
| "Esta nota de serviço já foi emitida (número N). Nova emissão bloqueada." | A nota já tem número de NFS-e. | Não reenvie. Use a nota existente; clique em **Consultar agora** para atualizar o que a janela mostra. |
| "Esta NFS-e não pode ser enviada de novo: ..." | O retorno guardado da integração mostra que a prefeitura já processou esta nota. | Clique em **Consultar agora** para trazer o desfecho. Só crie outra nota se esta não tiver sido autorizada. |
| "Emissão não permitida: a nota está em ..." | A nota já foi enviada ou está em um status que não aceita envio. | Clique em **Consultar agora** e aguarde o desfecho. |
| "Não foi possível contatar a integração fiscal. A nota segue pronta para envio." | O Vibe não conseguiu falar com a integração fiscal. | Clique em **Consultar agora**; se a nota continuar como rascunho, clique em **Emitir NFS-e** de novo. Se repetir, avise o suporte. |
| Faixa vermelha com a mensagem da prefeitura ou do envio | A nota foi recusada ou o envio falhou. | Leia a mensagem. Em erro de envio, corrija e clique em **Reenviar NFS-e**; em nota recusada pela prefeitura, abra a janela de novo e crie outro rascunho. |
| "A integração fiscal não respondeu à consulta. O status mostrado é o último gravado." | A consulta não chegou à integração. | Tente **Consultar agora** em alguns minutos. |
| "A nota continua em análise. Consulte depois." | Passaram 5 minutos sem resposta da prefeitura. | Clique em **Consultar agora** ou feche e volte pelo botão **NFS-e em análise**. |

## Veja também

- [Carteira (contas a receber)](carteira.md)
- [Registro de recebíveis](registro-de-recebiveis.md)
- [Conferência](conferencia.md)
- [Pedidos (lista)](pedidos.md)
- [Proposta: aba Pagamentos](proposta-pagamentos.md)
- [Proposta: aba Fretes](proposta-fretes.md)
- [Expedição](expedicao.md)

## Arquivos de origem

Arquivos de código de onde esta ficha saiu. O `scripts/checar-manual.mjs` lê esta lista: quando um deles muda e a ficha não, ele avisa. Um caminho por item, entre crases, a partir da raiz do repositório; pasta termina com `/` e vale para tudo dentro dela.

- `src/app/(erp)/notas-fiscais/`
- `src/features/fiscal/NotasFiscaisPage.tsx`
- `src/features/fiscal/lib/fila-producao-desde.ts`
- `src/features/fiscal/components/SeloDaPrevisao.tsx`
- `src/features/fiscal/hooks/usePrevisaoDaProducao.ts`
- `src/features/fiscal/components/EmissaoNfeModal.tsx`
- `src/features/nfse/components/GerarNfseModal.tsx`
- `src/features/nfse/lib/regras-emissao.ts`
- `src/features/nfse/lib/janela-nfse.ts`
- `src/features/nfse/lib/composicao-nfse.ts`
- `src/features/nfse/components/PecasNfse.tsx`
- `src/features/nfse/services/nfse-pedido.server.ts`
- `src/app/api/fiscal/rascunho-nfse/route.ts`
- `src/app/api/fiscal/consultar-nfse/route.ts`
- `src/app/api/fiscal/nfse-arquivo/route.ts`
- `src/app/api/fiscal/emitir-nfse/route.ts`
- `src/features/fiscal/components/ConferenciaFaturamentoModal.tsx`
- `src/features/fiscal/components/NovaNotaAvulsaModal.tsx`
- `src/features/fiscal/services/conferencia-faturamento.ts`
- `src/features/fiscal/services/ambiente-fiscal.ts`
- `src/features/fiscal/services/ja-autorizada.ts`
- `src/features/fiscal/services/faturado-fora.client.ts`
- `src/features/fiscal/lib/limites-layout-nfe.ts`
- `src/features/fiscal/lib/confirmacao-segunda-nota.ts`
- `src/features/fiscal/lib/fila-status.ts`
- `src/features/fiscal/constants/sefaz-rejeicoes.ts`
- `src/features/nfe/components/NfeDetailPage.tsx`
- `src/features/nfe/components/ConferenciaNfe.tsx`
- `src/features/nfe/pendencias.ts`
- `src/features/nfe/lib/ambiente-exibido.ts`
- `src/features/nfe/services/nfe.service.ts`
- `src/features/nfe/services/remessa.service.ts`
- `src/app/api/fiscal/emitir-nfe/`
- `src/app/api/fiscal/cancelar-nfe/`
- `src/app/api/fiscal/faturado-fora/`
- `src/app/api/fiscal/documento-nota/`
- `src/app/api/fiscal/emitir-nfse/`
- `src/lib/fiscal/danfes-do-pedido.ts`
- `src/lib/fiscal/documento-nota.ts`
- `src/components/common/BotaoDanfe.tsx`
- `src/components/common/ActionsMenu.tsx`
- `src/features/expedicao/components/ConfirmarAcaoModal.tsx`
- `src/features/cobrancas/PrepararBoletosModal.tsx`
- `src/features/contas-a-receber/components/RevisarGeracaoBancariaModal.tsx`
- `src/features/orcamentos/OrcamentosListPageReal.tsx`
- `src/features/orcamentos/services/orcamentos.service.ts`
- `src/features/cadastros/CadastroFormPage.tsx`
- `src/features/usuarios-perfis/catalogo-permissoes.ts`
- `src/lib/formatters/status.ts`
- `src/constants/navigation.ts`
- `src/app/api/fiscal/carta-correcao/route.ts`
- `src/lib/fiscal/carta-correcao.ts`

> **Mudança desta revisão:** 08/10/2026 — texto da NFS-e alinhado ao que está publicado: pedido com NFS-e autorizada sai da fila, a emissão segue em homologação (produção só existe para a BIRÔ IDEAL e não foi ativada) e a tabela de erros da janela traz as recusas atuais. Só documentação, sem mudança de código (regra da fila: commit `fa1aa0f`).
