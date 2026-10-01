# Notas fiscais

> **Última revisão:** 01/10/2026
> **Onde fica:** menu Financeiro → Notas fiscais (endereço `/notas-fiscais`; a nota aberta fica em `/notas-fiscais/[id]`)

## Para que serve

É a central de faturamento. Na aba **Fila Faturamento** ficam os pedidos que ainda precisam de nota e as notas que estão no meio do caminho (rascunho, processando ou com erro). Na aba **Histórico NF-e / NFS-e** ficam as notas que já viraram documento fiscal: autorizadas e canceladas.

Daqui se emite a NF-e de produto, se acompanha a autorização, se baixa o DANFE e o XML, se envia carta de correção e se cancela a nota.

## Quem acessa

- Só vê a tela quem tem a permissão **Visualizar Painel Fiscal**. Sem ela, o item não abre.
- **Emitir NF-e (Produto)**: mostra o botão **Faturar** na fila, o **Emitir NF-e** dentro da nota e o **Enviar para Focus** no menu da nota. Sem essa permissão a pessoa consegue abrir e conferir a nota, mas não transmite.
- **Cancelar Nota Fiscal**: mostra **Cancelar NF-e** e **Cancelar NFS-e** no menu da nota autorizada.
- **Liberar para Nota Fiscal**: mostra o botão **Nota emitida no sistema antigo** na fila e, em Orçamentos, a ação que desfaz essa marca.
- Hoje os perfis **Administrador** e **Financeiro** têm todas essas permissões, e o **Super Administrador** pode tudo. O perfil **Designer** só visualiza a tela.
- Carta de correção, nota avulsa, segunda nota do pedido e descarte de rascunho não pedem permissão própria: aparecem para quem vê a tela. Transmitir a nota criada continua exigindo **Emitir NF-e (Produto)**.
- Abrir DANFE e XML exige apenas estar logado e enxergar a nota.

## Passo a passo

### Entender a Fila Faturamento

1. Abra **Financeiro → Notas fiscais**. A tela já abre na aba **Fila Faturamento**, com a quantidade de pedidos entre parênteses.
2. A primeira lista é a dos **pedidos** que esperam nota. Cada linha mostra **Pedido** (clique no número para abrir a proposta), **Cliente / Destinatário** (clique para abrir o cadastro; quando quem paga é outro cadastro, aparece **Sócio pagador**), **Em produção desde**, **Empresa Emitente**, **Valor Total**, **Tipo de cobrança** e **Status do pedido**.
3. Use os filtros do topo: a busca **Buscar fila por Ref, ID Cliente ou Nome...** (também acha por sócio pagador e por vendedor), **Todas as Empresas Emitentes**, **Todos os status do pedido** e a caixa **Só faturados**, que deixa só os pedidos com cobrança do tipo faturado.
4. Abaixo vem a seção **Notas em processo**. Ela lista toda nota que ainda não é documento fiscal: pendente, pronta para envio, processando ou com erro. Os filtros do topo não escondem nada desta seção, de propósito.

O status do pedido é só informação: ele não impede nem libera a emissão.

### O que põe e o que tira um pedido da fila

Entra na fila o pedido que foi **liberado para produção**. Não existe uma liberação separada para nota: a liberação para produção já coloca o pedido na fila.

Sai da lista de pedidos quando:

- o pedido ganha uma nota de venda que já saiu do rascunho (pronta para envio, processando, autorizada ou com erro). A nota passa a aparecer em **Notas em processo** ou no **Histórico**;
- alguém marca **Nota emitida no sistema antigo**;
- o cliente do pedido está com o interruptor **Nota** desligado no cadastro;
- o pedido foi encerrado como teste.

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
- **Salvar e sair**: grava o rascunho como está.
- **Voltar**: volta para a lista sem gravar.

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

### Marcar "Nota emitida no sistema antigo" e desfazer

Ação temporária, da transição entre sistemas. Use só quando a nota do pedido já foi emitida no sistema antigo.

1. Na fila, clique em **Nota emitida no sistema antigo** na linha do pedido e confirme.
2. O pedido sai da fila. Liberação para nota, status e produção do pedido ficam como estavam, e nenhuma nota é criada no Vibe. O registro fica na linha do tempo do pedido.
3. Para desfazer, vá em **Orçamentos**, ache o pedido (ele mostra a etiqueta **faturado no sistema antigo**), abra o menu da linha e clique em **Voltar para a Fila de Faturamento (desfazer nota no sistema antigo)**. O pedido volta a aparecer na fila.

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
- Nota autorizada não se desfaz: só sai por cancelamento. Nota Autorizada, Cancelada ou Processando não pode ser editada.
- Não dá para transmitir duas vezes a mesma nota. Se ela já tem número ou chave, ou se o retorno guardado indica autorização, a nova emissão é bloqueada.
- Só nota **Autorizada** pode ser cancelada, e só uma vez. Justificativa e texto de carta de correção precisam de pelo menos 15 caracteres.
- O Vibe não confere prazo de cancelamento nem de carta de correção. Quem aceita ou recusa é a SEFAZ, e o motivo da recusa aparece no aviso.
- Só dá para descartar rascunho que nunca foi transmitido. Não dá para desfazer o descarte.
- Nota de remessa só pode ser gerada depois da nota de venda autorizada, e exige nome e CPF ou CNPJ do recebedor no endereço de entrega. Ela não tira o pedido da fila e não gera título.
- Cliente com o interruptor **Nota** desligado no cadastro não entra na fila. Vale o cliente do pedido, não o pagador. Esses pedidos não têm nota emitida pelo Vibe.
- **Só faturados** e a coluna **Contas a Receber** existem porque só venda faturada vira título. **Lançar no Contas a Receber** só aparece em nota autorizada de pedido com cobrança faturada em aberto.
- A empresa emitente é uma de três: **INGRESSO IDEAL**, **BIRÔ IDEAL** e **E3 BRINDES**. Ela vem do pedido e pode ser trocada no bloco Emitente enquanto a nota ainda puder ser editada.
- NFS-e (nota de serviço): a tela só oferece o **Histórico NFS-e (Serviços)**, com busca, filtro por empresa e por status, **Abrir PDF**, **Abrir XML**, **Copiar Link** e **Cancelar NFS-e** para nota autorizada. Não existe emissão de NFS-e pela tela.

## Erros comuns

| O que aparece | Por que acontece | O que fazer |
|---|---|---|
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

## Veja também

- [Carteira (contas a receber)](carteira.md)
- [Registro de recebíveis](registro-de-recebiveis.md)
- [Conferência](conferencia.md)
- [Pedidos (lista)](pedidos.md)
- [Proposta: aba Pagamentos](proposta-pagamentos.md)
- [Proposta: aba Fretes](proposta-fretes.md)
- [Expedição](expedicao.md)
