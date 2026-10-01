# Conferência

> **Última revisão:** 01/10/2026
> **Onde fica:** menu → Conferência (endereço `/cobrancas`; o detalhe de uma cobrança abre em `/cobrancas/<cobrança>`)

## Para que serve

É a fila do financeiro. Aqui chegam as cobranças que já foram pagas ou que tiveram o faturamento autorizado, e o financeiro confere cada uma antes de o pedido seguir adiante. Também é aqui que se analisa a condição de um faturamento pedido pelo vendedor, se consulta o crédito do cliente e se cancela uma cobrança.

No topo da tela, o título é **Conferência de pagamentos**.

## Quem acessa

- Vê a tela quem tem a permissão **Visualizar Conferência** no perfil, além de administradores.
- **Confirmar Conferência** e **Voltar para lista principal** aparecem no menu de ações para administradores e para quem tem a permissão **Confirmar Pagamento**.
- **Analisar condição** (aprovar, alterar ou reprovar um faturamento) aparece para administradores e para quem tem a permissão **Liberar OS / Confirmar**. Para a aprovação ser gravada, o usuário também precisa da permissão **Confirmar Pagamento**.
- **Cancelar cobrança** de uma cobrança que ainda não foi paga fica habilitado para administradores e para quem tem **Cancelar / Estornar Cobranças** ou **Cancelar Cobrança Não Paga**. Além da permissão, é preciso ter acesso à proposta daquela cobrança.
- **Cancelar cobrança** de uma cobrança já paga é exclusivo de super administrador.
- As demais ações do menu (ver cobrança, abrir proposta, ver cliente, chat, copiar PIX, copiar linha digitável, nova tarefa) ficam disponíveis para quem vê a tela.

## O que aparece na tela

### Cards do topo

- **Pendentes de aprovação**: quantidade e valor dos faturamentos que ainda esperam a decisão do financeiro. Clicar no card filtra a lista por eles.
- **Confirmados do dia**: quantidade e valor do que foi confirmado hoje. Clicar no card mostra essas cobranças.
- **Faturamento do período**: total confirmado no mês atual, com a divisão por empresa (Ideal Gráfica, Ideal Birô e E3 Brindes).
- **Faturamento por Período**: total confirmado entre as duas datas escolhidas no próprio card, também dividido por empresa.

Os três cards de faturamento não somam E-Amostra nem E-Retrabalho, porque são cortesia e não receita. E-Permuta entra na soma. Os cards não mudam quando você digita na busca.

### Abas

- **Fila de Conferência**: o que está esperando a conferência do financeiro.
- **Cobranças Confirmadas**: o que já foi conferido, com a data e o nome de quem confirmou.

### O que entra na Fila de Conferência

- Cobrança já paga e ainda não conferida. Aparece com o status **Pago / A liberar**.
- Faturamento já autorizado (pelo financeiro ou automaticamente) e ainda não conferido. Aparece com o status **Faturamento autorizado / A liberar**.

### O que não entra na Fila de Conferência

- Cobrança que o cliente ainda não pagou (PIX, boleto ou cartão em aberto). Ela só chega à fila depois do pagamento.
- Faturamento que ainda espera a análise do financeiro. Esses ficam no card **Pendentes de aprovação** (ou no filtro **Pendentes aprovação**), com o status **Aguardando financeiro**.
- Cobrança cancelada. Para vê-las, use o filtro **Cancelados**.
- Cobrança já conferida. Ela passa para a aba **Cobranças Confirmadas**.

### Status mostrados

| Status | O que significa |
|---|---|
| **Aguardando financeiro** | Faturamento (E-Faturado, E-Permuta, E-Amostra ou E-Retrabalho) que ainda não foi autorizado. |
| **Faturamento autorizado / A liberar** | Faturamento autorizado, esperando a conferência. |
| **Pago / A liberar** | Pagamento recebido, esperando a conferência. |
| **Liberado** | Cobrança conferida. |
| **Cancelado** | Cobrança cancelada. |
| **A receber** | Cobrança em aberto, ainda sem pagamento. |

### Colunas da lista

**N°** (número da cobrança e, embaixo, a OS), **Cliente**, **Status**, **Empresa**, **Valor**, **Tipo**, **Data/Hora** (na aba de confirmadas a coluna vira **Confirmação**, com a data e o nome de quem confirmou) e **Ações**.

- Na coluna **Cliente**, o código e o nome são os do cliente do pedido. Quando quem paga é outro cadastro, aparece embaixo a linha **Sócio pagador**. Passe o mouse sobre o cliente para ver o documento.
- Quando a cobrança tem número de OS, aparece o botão **OS Ideal**: ele abre a OS no sistema antigo em outra aba e copia um resumo da cobrança (proposta, tipo, valor, data do pagamento e empresa) para colar lá.

### Cores das linhas

As linhas de faturamento (E-Faturado, E-Permuta, E-Amostra e E-Retrabalho) ficam com fundo amarelo claro, nas duas abas e em qualquer empresa. O destaque é só visual: não muda filtros nem ações.

### Filtros

- **Busca**: por número, cliente, ID, documento ou empresa. Com três ou mais caracteres, a busca passa a procurar em todo o período, e a tela avisa: "Buscando ... em todo o período. Os cards acima continuam somando apenas o período selecionado. Limpe a busca para voltar a filtrar por data."
- **Tipo**: **Pendentes aprovação**, **Confirmados do dia**, **PIX**, **Boleto**, **Faturado**, **Cartão**, **Cancelados**, **E-Crédito** e **Todos os tipos**. Escolher um tipo de pagamento (PIX, Boleto, Faturado, Cartão, E-Crédito) leva para a aba **Cobranças Confirmadas**: esses filtros mostram só o que já foi conferido.
- **Todas empresas** e **Todos os vendedores**.
- **Período**: aparece só na aba **Cobranças Confirmadas** e filtra pela data da confirmação. Começa no mês atual.
- **Limpar filtros**: volta tudo ao padrão.

Os filtros ficam no endereço da página. Atualizar a tela, voltar pelo navegador ou mandar o link para um colega mantém a mesma visão.

## Passo a passo

### Confirmar a conferência de uma cobrança

1. Na aba **Fila de Conferência**, localize a cobrança.
2. Abra o menu de ações da linha e clique em **Confirmar Conferência**.
3. Confira cliente, proposta e valor na janela **Confirmar Liberação Operacional**.
4. Clique em **Confirmar Liberação**.

O que acontece depois:

- A cobrança sai da fila e passa para **Cobranças Confirmadas**, com a data e o seu nome.
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
   - **Alterar**: escolha a **Nova Condição de Pagamento** e clique em **Alterar Condição**. A condição muda, a troca fica registrada no chat da proposta e a cobrança continua aguardando análise.
   - **Reprovar**: preencha o **Motivo da Reprovação (Obrigatório)** e clique em **Reprovar e cancelar cobrança**. A cobrança é cancelada, a proposta volta para **NOVO** e o vendedor é avisado no chat, com o motivo.

Autorizar não é conferir. Depois de autorizado, o faturamento ainda precisa do **Confirmar Conferência** para o pedido andar.

### Trocar a empresa de um faturamento pendente

1. Em uma cobrança com status **Aguardando financeiro**, clique no nome da empresa (ele aparece sublinhado).
2. Na janela **Atualizar empresa**, escolha a empresa correta.
3. Clique em **Salvar empresa**.

### Analisar o crédito do cliente

1. No menu de ações de um faturamento ainda não conferido, clique em **Analisar crédito**.
2. A janela **Análise de Crédito** mostra **Limite de Crédito**, **Utilizado**, **Disponível**, **Saldo de Carteira**, **Faturamentos Vencidos** e **Risco de Crédito**, com a conclusão embaixo: **Crédito Operacional Disponível** ou **Aguardando Análise Financeira**.
3. Para mudar o limite, preencha **Atualizar Limite de Crédito** e clique em **Atualizar Limite**.
4. Se, com o novo limite, o cliente ficar com crédito suficiente e sem impedimento, o faturamento é autorizado na hora ("Faturamento aprovado automaticamente (limite suficiente)!") e segue para a Fila de Conferência. Se não, aparece o aviso "Limite atualizado, mas a cobrança permanece pendente por impedimento financeiro."
5. O botão **Ver Contas a Receber do Cliente** abre a carteira já filtrada pelo cliente.

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

### Cancelar uma cobrança já paga

Só super administrador. Para os demais, a opção fica desabilitada.

O formulário de cobrança paga pede:

1. **Motivo do Cancelamento**, escolhido na lista: Desistencia do cliente, Engano de modalidade, Cobranca duplicada, Valor incorreto ou Outro motivo. Em **Outro motivo**, o campo **Detalhe o motivo** é obrigatório.
2. **Destino do valor**: Valor devolvido ao cliente, Valor lancado como credito na conta corrente ou Valor mantido (cobranca sera refeita). Em E-Amostra e E-Retrabalho só existe a opção de manter o valor, porque nenhum dinheiro entrou.
3. Quando a cobrança foi confirmada em mês anterior, a marcação "Entendo que o faturamento de (mês/ano) será alterado."
4. **Confirmar Cancelamento**.

Se, ao abrir, a janela mostrar **Não é possível cancelar agora** com o aviso de que a cobrança já foi recebida, o formulário não é exibido e o cancelamento não segue por esta tela.

### Abrir o detalhe de uma cobrança

1. No menu de ações da linha, clique em **Ver cobrança**.
2. O detalhe mostra:
   - cabeçalho com o número da cobrança, o cliente, a proposta, o CPF/CNPJ e o status;
   - **Informações Financeiras**: valor (e parcelas, no cartão parcelado), vencimento, data do pagamento, tipo de cobrança, empresa recebedora, vendedor e OS Ideal, além da condição comercial e das observações, quando existem;
   - **Links e Códigos de Pagamento**: link de pagamento (**Abrir** e **Copiar**), **Copiar PIX**, **Copiar Código** da linha digitável e **Baixar PDF**, conforme o tipo da cobrança;
   - **Ações Administrativas**: **Atualizar Status** (recarrega os dados), **Visualizar Checkout** (em alguns tipos de cobrança), **Liberar para pedido** e **Cancelar cobrança**;
   - o mesmo menu de ações da lista, ao lado do status.
3. Avisos que podem aparecer no detalhe: **Gerando código PIX...** (PIX ainda sem código; use **Atualizar status**) e **Vencimento Excedido** (o prazo da cobrança expirou).
4. **Voltar para cobranças** retorna à lista.

### Consultar o histórico

O bloco **Histórico da cobrança**, no detalhe, ainda mostra "Histórico ainda não disponível." O registro do que aconteceu com a cobrança (criação, autorização, alteração de condição, reprovação, conferência e cancelamento, com o autor) fica no chat da proposta. Use **Abrir chat da proposta** no menu de ações.

### Outras ações do menu

- **Abrir proposta** e **Ver cliente**: abrem o pedido e o cadastro.
- **Copiar PIX** e **Copiar linha digitável**: ficam desabilitados quando a cobrança não tem o código.
- **Nova tarefa**: cria uma tarefa para um colega já com o pedido, o cliente e a descrição da cobrança preenchidos.

## Regras e bloqueios

- Não dá para confirmar uma cobrança quando o pedido tem duas ou mais cobranças ativas e a soma das já quitadas com a que está sendo conferida fica abaixo do total do pedido. A tela abre o alerta **Não é possível confirmar esta cobrança**, com o **Total da Proposta**, o **Saldo Pendente (Falta)** e o resumo das cobranças. É preciso cadastrar a cobrança que falta ou corrigir o valor do pedido.
- Pedido com uma única cobrança pode ser confirmado mesmo com valor menor que o total. Nesse caso o pedido fica em **AGUARDANDO** até o restante ser coberto.
- Não dá para confirmar cobrança cancelada.
- Faturamento só entra na fila depois de autorizado. O E-Faturado é autorizado sozinho, na criação, quando o cliente não tem restrição, não tem faturamento vencido e o limite de crédito comporta este e os demais faturamentos pendentes. E-Permuta, E-Amostra e E-Retrabalho sempre esperam a análise do financeiro.
- A empresa da cobrança só pode ser trocada pela lista enquanto o faturamento está **Aguardando financeiro**.
- **Analisar crédito** só fica habilitado em faturamento que ainda não foi conferido.
- Não dá para cancelar uma cobrança enquanto o pedido tem nota fiscal autorizada. Cancele a nota primeiro, em Notas fiscais. A nota é do pedido inteiro: bloqueia todas as cobranças dele.
- Não dá para cancelar uma cobrança de pedido que já está na produção (REVISAO PRODUCAO em diante, ou liberado para a produção). O gerente precisa devolver o pedido para REVISAO ATENDENTE, ou retirá-lo da produção, antes.
- Não dá para cancelar um faturamento com título em aberto. Cancele o título na Carteira primeiro.
- Cobrança com título já pago não é cancelada por aqui: o caso é devolução.
- Cobrança paga com crédito do cliente (E-Crédito) não é cancelada por aqui, porque o cancelamento não devolve o crédito consumido. O caminho é o estorno de crédito.
- A permissão **Cancelar Cobrança Não Paga** só alcança cobrança emitida e ainda não paga, de pedido do próprio usuário, e não alcança cobrança ligada à Conta Corrente. Como a Conferência lista o que já foi pago ou autorizado, essa permissão é usada na prática pela aba Pagamentos da proposta.
- O cancelamento de uma cobrança é irreversível. Para cobrar de novo, gere outra cobrança na proposta.
- A lista mostra no máximo 500 cobranças por vez. Se a que você procura não aparece, use a busca ou reduza o período.
- E-Amostra e E-Retrabalho já conferidos não aparecem na aba **Cobranças Confirmadas**, pelo mesmo motivo de não entrarem no faturamento. Para consultá-los, abra a proposta.
- No detalhe, **Liberar para pedido** não libera o pedido: a tela responde "Liberação de pedido automática desativada nesta etapa de testes." A liberação acontece pela confirmação da conferência.
- O rodapé da lista traz o texto "Esta tela é somente leitura. As ações continuam simuladas nesta fase." As ações descritas nesta página gravam de verdade.

### O que não fica nesta tela

- **Preparar boletos** (lançar os títulos de um faturamento conferido) fica no Registro de recebíveis e em Notas fiscais.
- **Cancelar recebível** e o tratamento de título que o banco já baixou ficam na Carteira. Quando o banco recusa o cancelamento porque o título já está expirado, baixado ou cancelado, o sistema confirma no banco que não houve pagamento e cancela o título só no sistema, registrando isso no chat da proposta. Essa saída vale para a Ideal Gráfica e a E3 Brindes. Título da Ideal Birô nessa situação segue para tratamento manual.
- **Corrigir telefone do pagador** aparece na aba Pagamentos da proposta, na hora de gerar a cobrança, quando o telefone do cadastro não serve para o tipo de pagamento escolhido.
- **Faturado no sistema antigo** fica em Notas fiscais, não na Conferência.

## Erros comuns

| O que aparece | Por que acontece | O que fazer |
|---|---|---|
| "Não é possível confirmar esta cobrança — A soma das cobranças é inferior ao total da proposta." | O pedido tem mais de uma cobrança e, mesmo contando esta, o total não é coberto. | Veja o resumo no alerta. Cadastre a cobrança que falta na proposta ou corrija o valor do pedido, e confirme de novo. |
| "Sem permissão para confirmar cobrança." | O perfil não tem **Confirmar Pagamento**. | Peça a um administrador para ajustar o perfil ou fazer a confirmação. |
| "Não é possível confirmar uma cobrança com status inválido." | A cobrança foi cancelada enquanto a tela estava aberta. | Atualize a tela. |
| "Esta cobrança já foi recebida em (data). Cancelar não devolve o dinheiro — o caso é devolução, não cancelamento." | A cobrança já está paga. | Trate como devolução, com um super administrador. |
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
| "Somente um super administrador pode cancelar uma cobranca ja paga." | Tentativa de cancelar cobrança paga sem ser super administrador. | Peça a um super administrador. |
| "Esta cobranca foi confirmada em mes anterior. Confirme que o faturamento fechado sera alterado." | Cancelamento de cobrança paga de mês já fechado, sem a marcação de confirmação. | Marque "Entendo que o faturamento de ... será alterado." |
| "Erro ao reprovar", com explicação | A reprovação não foi gravada (por exemplo, o pedido já está em uma etapa que não permite voltar). | Nada foi alterado. Leia a explicação e, se for o caso, trate pelo cancelamento da cobrança. |
| "Cliente não identificado para análise de crédito." | A cobrança não tem cliente vinculado. | Corrija o cliente na proposta. |
| "Cobrança não encontrada" no detalhe | A cobrança não está entre as carregadas na tela. | Volte para a lista, localize pela busca e abra de novo. |
| "Nenhuma cobrança encontrada" | Nada bate com os filtros, a aba e a busca. | Troque de aba, ajuste o período ou use **Limpar filtros**. |

## Veja também

- [Proposta: aba Pagamentos](proposta-pagamentos.md)
- [Pedidos (lista)](pedidos.md)
- [Carteira (contas a receber)](carteira.md)
- [Registro de recebíveis](registro-de-recebiveis.md)
- [Notas fiscais](notas-fiscais.md)
- [Produção (ordens de serviço)](producao.md)
- [Tarefas](tarefas.md)
