# Conferência

> **Última revisão:** 10/10/2026
> **Caminho no menu:** Conferência (primeiro item do menu lateral; é um link direto, sem subitens)
> **Endereço:** `/cobrancas` (o detalhe de uma cobrança abre em `/cobrancas/<cobrança>`)

## Para que serve

É a fila do financeiro. Aqui chegam as cobranças que já foram pagas ou que tiveram o faturamento autorizado, e o financeiro confere cada uma antes de o pedido seguir adiante. Também é aqui que se analisa a condição de um faturamento pedido pelo vendedor, se consulta o crédito do cliente e se cancela uma cobrança.

No topo da tela, o título é **Conferência de pagamentos**. A lista tem as colunas **N°** (número da cobrança e, embaixo, a OS), **Cliente**, **Status**, **Empresa**, **Valor**, **Tipo**, **Data/Hora** (na aba de confirmadas a coluna vira **Confirmação**, com a data e o nome de quem confirmou) e **Ações**. Na coluna **Cliente**, o código e o nome são os do cliente do pedido; quando quem paga é outro cadastro, aparece embaixo a linha **Sócio pagador**. Passe o mouse sobre o cliente para ver o documento.

## Quem acessa

- Vê a tela quem tem a permissão **Visualizar Conferência** no perfil, além de administradores.
- **Confirmar Conferência** e **Voltar para lista principal** aparecem no menu de ações para administradores e para quem tem a permissão **Confirmar Pagamento**.
- O administrador também confirma a conferência pelo menu de ações da lista de Pedidos ([Pedidos](pedidos.md)): é a mesma ação, com a mesma janela e a mesma regra de Fila.
- **Analisar condição** (aprovar, alterar ou reprovar um faturamento) aparece para administradores e para quem tem a permissão **Liberar OS / Confirmar**. Para a aprovação ser gravada, o usuário também precisa da permissão **Confirmar Pagamento**.
- **Autorizar e conferir**, na aba **Aprovar** da mesma janela, exige as duas permissões: **Liberar OS / Confirmar** e **Confirmar Pagamento** (administradores têm as duas). O botão só aparece para quem tem as duas, e o servidor confere de novo.
- **Cancelar cobrança** de uma cobrança que ainda não foi paga fica habilitado para administradores e para quem tem **Cancelar / Estornar Cobranças** ou **Cancelar Cobrança Não Paga**. Além da permissão, é preciso ter acesso à proposta daquela cobrança.
- **Cancelar cobrança** de uma cobrança já paga só fica habilitado para super administrador, e mesmo para ele a tela recusa o cancelamento (veja "Regras e bloqueios").
- As demais ações do menu (ver cobrança, abrir proposta, ver cliente, chat, copiar PIX, copiar linha digitável, nova tarefa) ficam disponíveis para quem vê a tela.

## Botões e ações da tela

Nomes exatamente como aparecem na tela, inclusive maiúsculas, acentos e erros de grafia.

| Nome na tela | Onde fica | O que faz |
|---|---|---|
| **Abrir propostas** | Topo da tela, à direita do título | Abre a lista de Pedidos. |
| **Pendentes de aprovação** | Card do topo (clicável) | Mostra quantidade e valor dos faturamentos que esperam a decisão do financeiro e filtra a lista por eles. |
| **Confirmados do dia** | Card do topo (clicável) | Mostra quantidade e valor do que foi confirmado hoje e lista essas cobranças. |
| **Faturamento do período** | Card do topo (não clicável) | Total confirmado no mês atual, dividido por empresa (Ideal Gráfica, Ideal Birô e E3 Brindes). |
| **Faturamento por Período** | Card do topo, com dois campos de data | Total confirmado entre as duas datas escolhidas no card, dividido por empresa. |
| **Fila de Conferência** | Aba, acima da lista | Mostra o que está esperando a conferência do financeiro. |
| **Cobranças Confirmadas** | Aba, acima da lista | Mostra o que já foi conferido, com a data e o nome de quem confirmou. |
| Campo **Buscar por número, cliente, ID, documento ou empresa** | Barra de filtros | Filtra a lista pelo texto; com três ou mais caracteres, procura em todo o período. |
| Filtro de tipo (**Pendentes aprovação**, **Confirmados do dia**, **PIX**, **Boleto**, **Faturado**, **Cartão**, **Cancelados**, **E-Crédito**, **Todos os tipos**) | Barra de filtros | Filtra por situação ou por tipo de pagamento. |
| **Todas empresas** | Barra de filtros | Filtra pela empresa recebedora. |
| **Todos os vendedores** | Barra de filtros | Filtra pelo vendedor. |
| **Período:** (duas datas) | Barra de filtros, só na aba **Cobranças Confirmadas** | Filtra pela data da confirmação. Começa no mês atual. |
| **Limpar filtros** | Barra de filtros | Volta busca, filtros, aba e período ao padrão. |
| Nome da empresa (sublinhado pontilhado) | Coluna **Empresa**, só em cobrança **Aguardando financeiro** | Abre a janela **Atualizar empresa**. |
| **OS Ideal** | Coluna **Ações**, só em cobrança com número de OS | Abre a OS no sistema antigo em outra aba e copia um resumo da cobrança (proposta, tipo, valor, data do pagamento e empresa) para colar lá. |
| **Acoes** | Coluna **Ações** de cada linha e cabeçalho do detalhe | Abre o menu de ações da cobrança. Na lista em formato de cartões (tela estreita) o botão se chama **Mais**. |
| **Ver cobrança** | Menu de ações; também é botão nos cartões da tela estreita | Abre o detalhe da cobrança. |
| **Abrir proposta** | Menu de ações | Abre o pedido da cobrança. |
| **Ver cliente** | Menu de ações | Abre o cadastro do cliente. |
| **Abrir chat da proposta** | Menu de ações | Abre o chat do pedido, onde fica o histórico. |
| **Analisar condição** | Menu de ações, em faturamento **Aguardando financeiro** | Abre a janela **Análise de Faturamento**. |
| **Confirmar Conferência** | Menu de ações, em cobrança da fila | Abre a janela **Confirmar Liberação Operacional**. |
| **Voltar para lista principal** | Menu de ações, em cobrança já confirmada | Devolve a cobrança para a Fila de Conferência. |
| **Analisar crédito** | Menu de ações | Abre a janela **Análise de Crédito**. Fica desabilitado fora de faturamento ainda não conferido. |
| **Copiar PIX** | Menu de ações (não aparece em cartão parcelado) | Copia o código PIX. Desabilitado quando a cobrança não tem PIX. |
| **Copiar linha digitável** | Menu de ações (não aparece em cartão parcelado) | Copia a linha digitável do boleto. Desabilitado quando não há boleto. |
| **Nova tarefa** | Menu de ações | Cria uma tarefa para um colega, já com o pedido, o cliente e a descrição da cobrança. |
| **Cancelar cobrança** | Menu de ações (em vermelho) e **Ações Administrativas** do detalhe | Abre a janela **Cancelar Cobrança**. |
| **Confirmar Liberação** | Janela **Confirmar Liberação Operacional** | Confirma a conferência da cobrança. Enquanto confirma, o botão mostra "Confirmando..." e fica apagado; a janela fecha assim que a confirmação é gravada. |
| Aviso **Atualizando a lista...** | Na linha das abas, à direita | Aparece depois de uma confirmação, enquanto a lista inteira é recarregada. Não é preciso esperar: a tela continua liberada. |
| Aviso **Lista incompleta: há mais cobranças do que o limite carregado. Avise o suporte.** | Acima das abas, em faixa amarela | Aparece quando a tela carregou 30.000 cobranças e ainda há outras, mais antigas, que ficaram de fora. A lista e os cards do período continuam valendo; o que fica bloqueado está em Regras e bloqueios. |
| **Cancelar** | Janelas **Confirmar Liberação Operacional**, **Análise de Faturamento** e **Atualizar empresa** | Fecha a janela sem gravar. |
| **Entendi, voltar** | Alerta **Não é possível confirmar esta cobrança** | Fecha o alerta. |
| **Aprovar**, **Alterar**, **Reprovar** | Abas da janela **Análise de Faturamento** | Escolhem o que fazer com a condição pedida pelo vendedor. |
| **Confirmar Autorização** | Janela **Análise de Faturamento**, aba **Aprovar** | Autoriza o faturamento e o envia para a Fila de Conferência. |
| **Autorizar e conferir** | Janela **Análise de Faturamento**, aba **Aprovar**, ao lado de **Confirmar Autorização**; só em faturamento que espera a autorização | Autoriza o faturamento e já confirma a conferência, sem passar pela Fila de Conferência. |
| **Alterar Condição** | Janela **Análise de Faturamento**, aba **Alterar** | Troca a condição de pagamento; a cobrança continua aguardando análise. |
| **Reprovar e cancelar cobrança** | Janela **Análise de Faturamento**, aba **Reprovar** | Reprova a condição, cancela a cobrança e devolve a proposta para NOVO. |
| **Salvar empresa** | Janela **Atualizar empresa** | Grava a empresa escolhida na cobrança pendente. |
| **Atualizar Limite** | Janela **Análise de Crédito** | Grava o novo limite de crédito do cliente e refaz a análise. |
| **Ver Contas a Receber do Cliente** | Rodapé da janela **Análise de Crédito** | Abre a Carteira em outra aba, já filtrada pelo cliente. |
| **Fechar** | Rodapé da janela **Análise de Crédito** | Fecha a janela. |
| **Confirmar Cancelamento** | Janela **Cancelar Cobrança** | Cancela a cobrança. Só habilita depois que o sistema libera e o motivo é preenchido. |
| **Voltar** | Janela **Cancelar Cobrança** | Fecha a janela sem cancelar. |
| **Ir para Notas Fiscais**, **Ir para Pedidos**, **Ir para Contas a Receber** | Janela **Cancelar Cobrança**, quando o cancelamento é recusado | Leva à tela onde a pendência se resolve. |
| **Voltar para cobranças** | Topo do detalhe | Retorna à lista. |
| **Atualizar status** | Detalhe, no aviso **Gerando código PIX...** | Recarrega os dados da cobrança. |
| **Abrir** e **Copiar** | Detalhe, bloco **Links e Códigos de Pagamento**, linha **Link de Pagamento** | Abre o link de pagamento em outra aba ou o copia. |
| **Copiar PIX** | Detalhe, bloco **Links e Códigos de Pagamento** | Copia o código PIX copia e cola. |
| **Copiar Código** | Detalhe, bloco **Links e Códigos de Pagamento** | Copia a linha digitável. |
| **Baixar PDF** | Detalhe, bloco **Links e Códigos de Pagamento** | Abre o PDF da cobrança. |
| **Atualizar Status** | Detalhe, bloco **Ações Administrativas** | Recarrega os dados da cobrança. |
| **Visualizar Checkout** | Detalhe, bloco **Ações Administrativas** (não aparece em boleto, PIX nem cartão parcelado) | Abre a página de pagamento da cobrança. |
| **Liberar para pedido** | Detalhe, bloco **Ações Administrativas** | Não libera o pedido: a tela responde "Liberação de pedido automática desativada nesta etapa de testes." |

## Passo a passo

### Confirmar a conferência de uma cobrança

1. Na aba **Fila de Conferência**, localize a cobrança.
2. Abra o menu de ações da linha e clique em **Confirmar Conferência**.
3. Confira cliente, proposta e valor na janela **Confirmar Liberação Operacional**.
4. Clique em **Confirmar Liberação**. A janela fecha assim que a confirmação é gravada.

O que acontece depois:

- A cobrança sai da fila e passa para **Cobranças Confirmadas**, com a data e o seu nome. Essa linha e os totais dos cards mudam na hora.
- O resto da lista é recarregado em seguida, sem travar a tela. Enquanto isso aparece o aviso **Atualizando a lista...** ao lado das abas. Você já pode confirmar a próxima cobrança.
- E-Permuta, E-Amostra e E-Retrabalho passam a constar como pagos na hora, porque não geram título para receber depois. O E-Faturado continua a vencer: quem liquida é o título, lançado no Registro de recebíveis.
- O chat da proposta recebe a mensagem "Cobrança conferida e liberada para os próximos fluxos operacionais: expedição, fiscal, boletos e produção."
- O status do pedido é reavaliado:
  - se as cobranças confirmadas cobrem o valor total do pedido, ele vai para **LIBERADO**;
  - se, além disso, todas as artes já estão aprovadas, ele vai direto para **REVISAO ATENDENTE**;
  - se o pedido é todo de produtos de prateleira (sem arte), ele passa por **REVISAO ATENDENTE** e segue sozinho para **REVISAO PRODUCAO**, com aviso no chat;
  - se o valor confirmado ainda não cobre o total, o pedido fica em **AGUARDANDO**.
- Pedido que já está em produção, expedição ou entregue não tem o status alterado pela confirmação.

### Devolver uma cobrança confirmada para a fila

1. Na aba **Cobranças Confirmadas**, abra o menu de ações da linha.
2. Clique em **Voltar para lista principal**.
3. Confirme a pergunta "Tem certeza que quer voltar esta OS para a lista principal de conferência?".

A cobrança perde a data e o nome de quem confirmou e volta para a **Fila de Conferência**.

### Analisar a condição de um faturamento pendente

1. Clique no card **Pendentes de aprovação** (ou escolha **Pendentes aprovação** no filtro de tipo).
2. Abra o menu de ações da linha e clique em **Analisar condição**. Abre a janela **Análise de Faturamento**, com cliente, proposta, valor e a **Condição Solicitada** pelo vendedor.
3. Escolha uma das três abas:
   - **Aprovar**: escreva uma observação, se quiser, e clique em **Confirmar Autorização**. A cobrança passa para **Faturamento autorizado / A liberar** e entra na Fila de Conferência. A aprovação vale só para esta cobrança; não altera o limite de crédito do cliente.
   - **Aprovar e já conferir**: na mesma aba, clique em **Autorizar e conferir** em vez de **Confirmar Autorização**. A cobrança é autorizada e conferida de uma vez: não passa pela Fila de Conferência e vai direto para **Cobranças Confirmadas**, com o seu nome como autor da autorização e da conferência. O chat da proposta recebe uma mensagem só, dizendo que o faturamento foi autorizado e conferido. O que acontece com o pedido é o mesmo de **Confirmar Conferência** (veja acima). A trava de valor também é a mesma: se a conferência seria recusada por a soma das cobranças ser menor que o total do pedido, aparece o alerta e nada é gravado.
   - **Alterar**: escolha a **Nova Condição de Pagamento** e clique em **Alterar Condição**. A condição muda, a troca fica registrada no chat da proposta e a cobrança continua aguardando análise.
   - **Reprovar**: preencha o **Motivo da Reprovação (Obrigatório)** e clique em **Reprovar e cancelar cobrança**. A cobrança é cancelada, a proposta volta para **NOVO** e o vendedor é avisado no chat, com o motivo.

### Trocar a empresa de um faturamento pendente

1. Em uma cobrança com status **Aguardando financeiro**, clique no nome da empresa (ele aparece sublinhado).
2. Na janela **Atualizar empresa**, escolha a empresa correta.
3. Clique em **Salvar empresa**.

### Analisar o crédito do cliente

1. No menu de ações de um faturamento ainda não conferido, clique em **Analisar crédito**.
2. A janela **Análise de Crédito** mostra **Limite de Crédito**, **Utilizado**, **Disponível**, **Saldo de Carteira**, **Faturamentos Vencidos** e **Risco de Crédito**, com a conclusão embaixo: **Crédito Operacional Disponível** ou **Aguardando Análise Financeira**.
3. Para mudar o limite, preencha **Atualizar Limite de Crédito** e clique em **Atualizar Limite**.
4. Se, com o novo limite, o cliente ficar com crédito suficiente e sem impedimento, o faturamento é autorizado na hora ("Faturamento aprovado automaticamente (limite suficiente)!") e segue para a Fila de Conferência. Se não, aparece o aviso "Limite atualizado, mas a cobrança permanece pendente por impedimento financeiro."
5. O botão **Ver Contas a Receber do Cliente** abre a Carteira já filtrada pelo cliente.

### Cancelar uma cobrança que ainda não foi paga

1. No menu de ações da linha (ou no detalhe da cobrança), clique em **Cancelar cobrança**.
2. Aguarde a mensagem "Verificando se esta cobrança pode ser cancelada...". O sistema confere a situação real da cobrança antes de liberar o formulário.
3. Se o cancelamento for possível, preencha o **Motivo do Cancelamento**.
4. Clique em **Confirmar Cancelamento**.

O que acontece:

- Boleto, PIX e cartão são cancelados também no banco ou na operadora. Se o banco recusar, nada é alterado no sistema.
- A cobrança passa a **Cancelado** e o saldo da proposta reabre, permitindo gerar uma cobrança nova.
- Se não sobrar nenhuma cobrança ativa, a proposta volta para **NOVO** e o tipo de cobrança é limpo. Pedido que já avançou (liberado, em revisão, em produção, em expedição ou entregue) não regride.
- O chat da proposta registra quem cancelou e o motivo.

Se o cancelamento não for possível, a janela mostra **Não é possível cancelar agora**, explica o motivo e, quando existe uma tela para resolver, oferece o botão que leva até ela (**Ir para Notas Fiscais**, **Ir para Pedidos** ou **Ir para Contas a Receber**).

### Cancelar um faturamento já conferido (para refaturar)

São três passos, cada um feito por você. Nenhum dispara o seguinte.

1. Cancele os títulos em aberto na Carteira, pela ação **Cancelar recebível**. A cobrança continua ativa e volta para o Registro de recebíveis.
2. Decida se vai gerar um título novo ou seguir com o cancelamento.
3. Volte à Conferência, aba **Cobranças Confirmadas**, e use **Cancelar cobrança**.

Enquanto houver título em aberto, a Conferência recusa o cancelamento, lista os títulos e oferece o botão **Ir para Contas a Receber**.

### Abrir o detalhe de uma cobrança

1. No menu de ações da linha, clique em **Ver cobrança**.
2. O detalhe mostra:
   - cabeçalho com o número da cobrança, o cliente, a proposta, o CPF/CNPJ e o status;
   - **Informações Financeiras**: valor (e parcelas, no cartão parcelado), vencimento, data do pagamento, tipo de cobrança, empresa recebedora, vendedor e OS Ideal, além da condição comercial e das observações, quando existem;
   - **Links e Códigos de Pagamento**: link de pagamento, código PIX, linha digitável e PDF, conforme o tipo da cobrança;
   - **Ações Administrativas**: **Atualizar Status**, **Visualizar Checkout** (em alguns tipos de cobrança), **Liberar para pedido** e **Cancelar cobrança**;
   - o mesmo menu de ações da lista, ao lado do status.
3. Avisos que podem aparecer no detalhe: **Gerando código PIX...** (PIX ainda sem código; use **Atualizar status**) e **Vencimento Excedido** (o prazo da cobrança expirou). Esse aviso só aparece a partir do dia seguinte ao vencimento; no próprio dia do vencimento a cobrança ainda está no prazo.
4. **Voltar para cobranças** retorna à lista.

### Consultar o histórico

O bloco **Histórico da cobrança**, no detalhe, ainda mostra "Histórico ainda não disponível." O registro do que aconteceu com a cobrança (criação, autorização, alteração de condição, reprovação, conferência e cancelamento, com o autor) fica no chat da proposta. Use **Abrir chat da proposta** no menu de ações.

## Regras e bloqueios

O que entra e o que não entra na fila:

- Entra na **Fila de Conferência** a cobrança já paga e ainda não conferida (status **Pago / A liberar**) e o faturamento já autorizado e ainda não conferido (status **Faturamento autorizado / A liberar**).
- Cobrança com o selo vermelho **Cancelada e paga: não confirmar** foi cancelada e voltou a constar como paga: a confirmação é recusada, e quem decide entre reativar e devolver é a gestão.
- Cobrança que o cliente ainda não pagou (PIX, boleto ou cartão em aberto) não aparece na lista. Ela só chega à fila depois do pagamento.
- Faturamento que ainda espera a análise do financeiro não entra na fila. Fica no card **Pendentes de aprovação** (ou no filtro **Pendentes aprovação**), com o status **Aguardando financeiro**.
- Cobrança cancelada só aparece no filtro **Cancelados**.
- Cobrança já conferida sai da fila e passa para a aba **Cobranças Confirmadas**.
- **Autorizar e conferir** só aparece em faturamento que espera a autorização (**Aguardando financeiro**). Faturamento já autorizado, que está na fila, se confere pelo **Confirmar Conferência**: a autorização de quem aprovou antes não é refeita. Clicar de novo, ou duas pessoas ao mesmo tempo, não gera segunda confirmação: a segunda chamada não grava nada e o chat não repete a mensagem.
- Faturamento só entra na fila depois de autorizado. O E-Faturado é autorizado sozinho, na criação, quando o cliente não tem restrição, não tem faturamento vencido e o limite de crédito comporta este e os demais faturamentos pendentes. E-Permuta, E-Amostra e E-Retrabalho sempre esperam a análise do financeiro.
- A tela carrega no máximo 30.000 cobranças, das mais novas para as mais antigas. Se o total passar disso, aparece o aviso **Lista incompleta** e, até o suporte resolver, a aba Pagamentos das propostas não mostra as cobranças nem deixa gerar cobrança nova.
- E-Amostra e E-Retrabalho já conferidos não aparecem na aba **Cobranças Confirmadas**, pelo mesmo motivo de não entrarem no faturamento. Para consultá-los, abra a proposta.

Status mostrados na lista e no detalhe:

- **Aguardando financeiro**: faturamento (E-Faturado, E-Permuta, E-Amostra ou E-Retrabalho) que ainda não foi autorizado.
- **Faturamento autorizado / A liberar**: faturamento autorizado, esperando a conferência.
- **Pago / A liberar**: pagamento recebido, esperando a conferência.
- **Liberado**: cobrança conferida.
- **Cancelado**: cobrança cancelada.
- **A receber**: cobrança em aberto, ainda sem pagamento.

Lista, filtros e cards:

- As linhas de faturamento (E-Faturado, E-Permuta, E-Amostra e E-Retrabalho) ficam com fundo amarelo claro, nas duas abas e em qualquer empresa. O destaque é só visual: não muda filtros nem ações.
- Escolher um tipo de pagamento no filtro (PIX, Boleto, Faturado, Cartão, E-Crédito) leva para a aba **Cobranças Confirmadas**: esses filtros mostram só o que já foi conferido.
- O período só vale na aba **Cobranças Confirmadas** e filtra pela data da confirmação.
- Com três ou mais caracteres na busca, o período deixa de valer para a lista, e a tela avisa: "Buscando ... em todo o período. Os cards acima continuam somando apenas o período selecionado. Limpe a busca para voltar a filtrar por data."
- Os cards do topo não mudam quando você digita na busca.
- Os três cards de faturamento não somam E-Amostra nem E-Retrabalho, porque são cortesia e não receita. E-Permuta entra na soma.
- A lista mostra no máximo 500 cobranças por vez. Se a que você procura não aparece, use a busca ou reduza o período.
- Os filtros ficam no endereço da página. Atualizar a tela, voltar pelo navegador ou mandar o link para um colega mantém a mesma visão.

Conferência:

- Não dá para confirmar uma cobrança quando o pedido tem duas ou mais cobranças ativas e a soma das já quitadas com a que está sendo conferida fica abaixo do total do pedido. A tela abre o alerta **Não é possível confirmar esta cobrança**, com o **Total da Proposta**, o **Saldo Pendente (Falta)** e o resumo das cobranças. É preciso cadastrar a cobrança que falta ou corrigir o valor do pedido.
- Pedido com uma única cobrança pode ser confirmado mesmo com valor menor que o total. Nesse caso o pedido fica em **AGUARDANDO** até o restante ser coberto.
- Não dá para confirmar cobrança cancelada.
- A empresa da cobrança só pode ser trocada pela lista enquanto o faturamento está **Aguardando financeiro**.
- **Analisar crédito** só fica habilitado em faturamento que ainda não foi conferido.

Cancelamento:

- Não dá para cancelar por esta tela uma cobrança já paga. Para quem não é super administrador, **Cancelar cobrança** fica desabilitado. Para o super administrador a janela abre, mas a verificação responde **Não é possível cancelar agora**, com o aviso de que a cobrança já foi recebida e de que o caso é devolução; o formulário de cancelamento não é exibido.
- Não dá para cancelar uma cobrança enquanto o pedido tem nota fiscal autorizada. Cancele a nota primeiro, em Notas fiscais. A nota é do pedido inteiro: bloqueia todas as cobranças dele.
- Não dá para cancelar uma cobrança de pedido que já está na produção (REVISAO PRODUCAO em diante, ou liberado para a produção). O gerente precisa devolver o pedido para REVISAO ATENDENTE, ou retirá-lo da produção, antes.
- Não dá para cancelar um faturamento com título em aberto. Cancele o título na Carteira primeiro.
- Cobrança com título já pago não é cancelada por aqui: o caso é devolução.
- Cobrança paga com crédito do cliente (E-Crédito) não é cancelada por aqui, porque o cancelamento não devolve o crédito consumido. O caminho é o estorno de crédito.
- A permissão **Cancelar Cobrança Não Paga** só alcança cobrança emitida e ainda não paga, de pedido do próprio usuário, e não alcança cobrança ligada à Conta Corrente. Como a Conferência lista o que já foi pago ou autorizado, essa permissão é usada na prática pela aba Pagamentos da proposta.
- O cancelamento de uma cobrança é irreversível. Para cobrar de novo, gere outra cobrança na proposta.

Outros:

- O rodapé da lista traz o texto "Esta tela é somente leitura. As ações continuam simuladas nesta fase." As ações descritas nesta página gravam de verdade.

## O que não confundir

- **Confirmar Autorização** e **Autorizar e conferir**: o primeiro só autoriza, e a cobrança ainda espera a conferência na fila; o segundo autoriza e confere de uma vez, e a cobrança não passa pela fila.
- **Analisar condição** e **Confirmar Conferência**: a primeira autoriza (ou altera, ou reprova) a condição de um faturamento; a segunda confere a cobrança e faz o pedido andar. Autorizar não é conferir: depois de autorizado, o faturamento ainda precisa da conferência.
- **Analisar condição** e **Analisar crédito**: a primeira decide sobre a condição de pagamento desta cobrança; a segunda mostra o limite e a situação de crédito do cliente e permite mudar o limite.
- **Aguardando financeiro** e **Faturamento autorizado / A liberar**: no primeiro o faturamento ainda espera a autorização; no segundo já foi autorizado e espera a conferência.
- **Pago / A liberar** e **Liberado**: no primeiro o dinheiro entrou mas a cobrança ainda não foi conferida; no segundo a cobrança já foi conferida.
- Status **Liberado** (da cobrança) e status **LIBERADO** (do pedido): a cobrança conferida fica **Liberado**; o pedido só vai para **LIBERADO** quando as cobranças confirmadas cobrem o valor total.
- Card **Faturamento do período** e card **Faturamento por Período**: o primeiro soma o mês atual; o segundo soma o intervalo das duas datas do próprio card.
- Card **Pendentes de aprovação** e aba **Fila de Conferência**: o card reúne faturamentos que esperam autorização; a fila reúne o que já foi pago ou autorizado e espera conferência.
- **Atualizar status** (no aviso do PIX) e **Atualizar Status** (em Ações Administrativas): os dois só recarregam os dados da cobrança; nenhum muda o status dela.
- **Liberar para pedido** (no detalhe) e **Confirmar Conferência**: o primeiro não libera nada hoje; quem faz o pedido andar é a confirmação da conferência.
- **Cancelar** e **Cancelar cobrança**: **Cancelar** só fecha a janela aberta; **Cancelar cobrança** abre o cancelamento da cobrança.
- **Cancelar cobrança** (aqui) e **Cancelar recebível** (na Carteira): a primeira cancela a cobrança do pedido; a segunda cancela um título (boleto) e mantém a cobrança ativa.
- **Reprovar e cancelar cobrança** e **Cancelar cobrança**: a reprovação vale para faturamento ainda não autorizado e devolve a proposta para NOVO avisando o vendedor; o cancelamento comum passa pela verificação e pede só o motivo.
- **OS Ideal** e **Abrir proposta**: **OS Ideal** abre a OS no sistema antigo; **Abrir proposta** abre o pedido no Vibe.
- **Preparar boletos** não fica nesta tela: o lançamento dos títulos de um faturamento conferido é feito no Registro de recebíveis e em Notas fiscais.
- Título que o banco já baixou não se resolve aqui: é tratado na Carteira, no **Cancelar recebível**. Quando o banco recusa o cancelamento porque o título já está expirado, baixado ou cancelado, o sistema confirma no banco que não houve pagamento e cancela o título só no sistema, registrando isso no chat da proposta. Essa saída vale para a Ideal Gráfica e a E3 Brindes; título da Ideal Birô nessa situação segue para tratamento manual.
- **Corrigir telefone do pagador** não fica nesta tela: aparece na aba Pagamentos da proposta, na hora de gerar a cobrança, quando o telefone do cadastro não serve para o tipo de pagamento escolhido.
- **Faturado no sistema antigo** não fica nesta tela: é uma ação de Notas fiscais.

## Erros comuns

| O que aparece | Por que acontece | O que fazer |
|---|---|---|
| "Não é possível confirmar esta cobrança — A soma das cobranças é inferior ao total da proposta." | O pedido tem mais de uma cobrança e, mesmo contando esta, o total não é coberto. | Veja o resumo no alerta. Cadastre a cobrança que falta na proposta ou corrija o valor do pedido, e confirme de novo. |
| "Esta cobrança não está aguardando a autorização do financeiro. Atualize a lista; se ela já foi autorizada, confirme pela Fila de Conferência." | Ao clicar em **Autorizar e conferir**, a cobrança já tinha sido autorizada, confirmada ou paga por outra pessoa. | Atualize a lista. Se ela estiver na fila, use **Confirmar Conferência**. |
| "A cobrança mudou enquanto era processada. Atualize a lista e confira o estado antes de tentar de novo." | Alguém mudou a cobrança (por exemplo, cancelou) no mesmo instante em que você autorizava e conferia. Nada foi gravado. | Atualize a lista e confira o estado da cobrança. |
| "Sem permissão para autorizar faturamento." | Ao usar **Autorizar e conferir**, o perfil não tem **Liberar OS / Confirmar**. | Peça a um administrador para ajustar o perfil ou fazer a autorização. |
| "Sem permissão para confirmar cobrança." | O perfil não tem **Confirmar Pagamento**. | Peça a um administrador para ajustar o perfil ou fazer a confirmação. |
| "Não é possível confirmar uma cobrança com status inválido." | A cobrança foi cancelada enquanto a tela estava aberta. | Atualize a tela. |
| "Esta cobrança foi cancelada e consta como paga. Não confirme: o dinheiro pode ter entrado em duplicidade. Avise a gestão para decidir entre reativar ou devolver." | A cobrança foi cancelada e depois o banco informou o pagamento dela. Na lista ela aparece com o selo vermelho **Cancelada e paga: não confirmar**. | Não confirme e não gere outra cobrança. Avise a gestão, com o número do pedido. |
| "Não foi possível cancelar o PIX no banco. A cobrança continua ativa: não gere outra cobrança para este pedido." | O banco não confirmou o cancelamento do PIX (recusou, não respondeu a tempo ou a ligação falhou). O Vibe só cancela a cobrança quando o banco confirma. | Não gere outra cobrança. Tente de novo em alguns minutos; se o cliente pode ter pago, aguarde a baixa. Persistindo, avise a gestão. |
| "Esta cobrança já foi recebida em (data). Cancelar não devolve o dinheiro — o caso é devolução, não cancelamento." | A cobrança já está paga. | A tela não cancela cobrança paga. Trate como devolução, com o financeiro. |
| "O título ... desta cobrança ... foi liquidado ... A cobrança inteira vira devolução — não cancele por aqui." | Um título ligado à cobrança já foi pago. | Trate como devolução. |
| "A proposta ... tem NF-e nº ... autorizada. Cancele a nota em Fiscal › Notas Fiscais antes de cancelar a cobrança." | O pedido tem nota fiscal autorizada. | Use **Ir para Notas Fiscais**, cancele a nota e volte. |
| "Proposta ... está (status). Peça ao gerente para devolver a proposta para REVISAO ATENDENTE antes de cancelar a cobrança." | O pedido já passou pela revisão do gerente. | Peça a devolução ao gerente e tente de novo. |
| "Proposta ... consta liberada para a produção. Peça ao gerente para retirá-la da produção antes de cancelar a cobrança." | O pedido está liberado para a produção. | Peça ao gerente para retirar da produção e tente de novo. |
| "Esta cobrança tem o título ... em aberto no banco. Cancele o título primeiro em Contas a Receber ..." | Faturamento com título ainda ativo. | Use **Ir para Contas a Receber**, cancele o título e volte. |
| "Não foi possível identificar com segurança quais títulos pertencem a esta cobrança ..." | Registro antigo, sem vínculo entre título e cobrança, em pedido com mais de um faturamento. | Peça conferência manual antes de cancelar. |
| "Cobrança paga com crédito do cliente: o cancelamento não estorna o crédito consumido. Use o estorno de crédito." | A cobrança é E-Crédito. | Faça o estorno de crédito. |
| "Esta cobrança já está cancelada" | A cobrança já tinha sido cancelada. | Nada a fazer. |
| "Não foi possível verificar" seguido de "Sem essa verificação o cancelamento não é liberado. Feche e tente de novo." | A verificação falhou (conexão, sessão expirada) ou o usuário não tem permissão ou acesso àquela cobrança. | Leia a linha de cima, que traz o motivo. Feche e tente de novo; se persistir, entre novamente no sistema ou procure um administrador. |
| "Acesso negado a esta cobrança." | A cobrança é de um pedido fora do seu alcance (outro vendedor ou outra empresa). | Peça a quem tem acesso ao pedido. |
| "A API bancária recusou o cancelamento do Boleto. Nenhuma alteração local foi feita." (ou a mesma mensagem para PIX ou Cartão) | O banco ou a operadora recusou o cancelamento. | Nada foi alterado. Tente mais tarde ou confira a cobrança no banco. |
| "Cobrança do Cartão Asaas ainda sem identificador sincronizado. Aguarde alguns instantes e tente cancelar novamente. Nenhuma alteração foi feita." | O link do cartão ainda está sendo registrado. | Aguarde e tente de novo. |
| "Erro ao reprovar", com explicação | A reprovação não foi gravada. | Nada foi alterado. Leia a explicação e tente de novo. |
| "Cliente não identificado para análise de crédito." | A cobrança não tem cliente vinculado. | Corrija o cliente na proposta. |
| "Liberação de pedido automática desativada nesta etapa de testes." | Clique em **Liberar para pedido** no detalhe. | Use **Confirmar Conferência**; é ela que faz o pedido andar. |
| "Cobrança não encontrada" no detalhe | A cobrança não está entre as carregadas na tela. | Volte para a lista, localize pela busca e abra de novo. |
| "Nenhuma cobrança encontrada" | Nada bate com os filtros, a aba e a busca. | Troque de aba, ajuste o período ou use **Limpar filtros**. |
| "Lista incompleta: há mais cobranças do que o limite carregado. Avise o suporte." | A tela carrega no máximo 30.000 cobranças, das mais novas para as mais antigas, e o total passou disso. | Avise o suporte. Enquanto o aviso aparecer, a aba Pagamentos da proposta não mostra as cobranças nem deixa gerar cobrança nova, para não duplicar uma antiga que não foi carregada. |

## Veja também

- [Proposta: aba Pagamentos](proposta-pagamentos.md)
- [Pedidos (lista)](pedidos.md)
- [Carteira (contas a receber)](carteira.md)
- [Registro de recebíveis](registro-de-recebiveis.md)
- [Notas fiscais](notas-fiscais.md)
- [Produção (ordens de serviço)](producao.md)
- [Tarefas](tarefas.md)

## Arquivos de origem

Arquivos de código de onde esta ficha saiu. O `scripts/checar-manual.mjs` lê esta lista: quando um deles muda e a ficha não, ele avisa. Um caminho por item, entre crases, a partir da raiz do repositório; pasta termina com `/` e vale para tudo dentro dela.

- `src/app/(erp)/cobrancas/page.tsx`
- `src/app/(erp)/cobrancas/[id]/page.tsx`
- `src/features/cobrancas/CobrancasList.tsx`
- `src/features/cobrancas/CobrancaActionsMenu.tsx`
- `src/features/cobrancas/CobrancaDetail.tsx`
- `src/features/cobrancas/CobrancaStatusBadge.tsx`
- `src/features/cobrancas/CobrancaHistoricoPanel.tsx`
- `src/features/cobrancas/ConfirmarLiberacaoModal.tsx`
- `src/features/cobrancas/lib/confirmar-conferencia.ts`
- `src/features/cobrancas/lib/autorizar-e-conferir.ts`
- `src/features/cobrancas/lib/recarga-em-ordem.ts`
- `src/features/cobrancas/lib/limite-da-carga.ts`
- `src/features/cobrancas/lib/cancelada-que-consta-paga.ts`
- `src/features/cobrancas/services/cancelamento-pix.ts`
- `src/features/cobrancas/ConferenciaFinanceiraAlertaModal.tsx`
- `src/features/cobrancas/AutorizarFaturamentoModal.tsx`
- `src/features/cobrancas/AnaliseCreditoModal.tsx`
- `src/features/cobrancas/CancelCobrancaModal.tsx`
- `src/features/cobrancas/CobrancasProvider.tsx`
- `src/features/cobrancas/cobrancas-utils.ts`
- `src/features/cobrancas/cancelamento-elegibilidade.ts`
- `src/features/cobrancas/cancelamento-pago.ts`
- `src/features/cobrancas/services/cancelamento-elegibilidade.server.ts`
- `src/features/cobrancas/services/conferencia-financeira.service.ts`
- `src/features/cobrancas/services/pagamentos-v2.service.ts`
- `src/features/orcamentos/services/status-engine.service.ts`
- `src/app/api/cobrancas/confirmar/route.ts`
- `src/app/api/cobrancas/pode-cancelar/route.ts`
- `src/app/api/cobrancas/cancelar-externo/route.ts`
- `src/app/api/cobrancas/aprovar-faturado-automatico/route.ts`
- `src/app/api/cobrancas/titulo-inativo-no-banco/route.ts`
- `src/components/common/ActionsMenu.tsx`
- `src/constants/navigation.ts`
