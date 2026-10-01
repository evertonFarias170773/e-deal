# Proposta: visão geral e abas

> **Última revisão:** 01/10/2026
> **Onde fica:** menu **Pedidos** → botão **+ Nova proposta** (endereço `/orcamentos/novo`) ou, numa proposta que já existe, menu de ações → **Editar proposta** (endereço `/orcamentos/<número>/editar`)

## Para que serve

É a tela onde a proposta nasce e onde o pedido é acompanhado até a entrega. Nela você escolhe o cliente, monta os produtos, define o frete, gera a cobrança, cadastra os modelos, acompanha a arte e lê o histórico.

Esta página explica o que vale para a tela inteira: cabeçalho, abas, como salvar, status, edição de proposta já cobrada ou paga, chat, cancelamento, pedido complementar e link de pagamento. O detalhe de cada aba está na página própria, listada em [Veja também](#veja-também).

## Quem acessa

- Quem tem acesso ao menu **Pedidos** abre a tela. Na lista, o perfil configurado para ver apenas as próprias propostas encontra só as dele.
- Trocar o **Vendedor** da proposta: administrador, gerente ou perfil com a permissão de alterar o vendedor responsável. Para os demais, o vendedor vem do cadastro do cliente.
- Usar o **Desconto geral**: administrador, gerente ou perfil com a permissão de desconto geral.
- Digitar **Valor Unitário (R$)** e **Fixo (R$)** de um item: só administrador.
- Alterar proposta que já tem cobrança ou pagamento: só quem tem a permissão **Editar Proposta Paga**. Quem tem a permissão **Editar Proposta com Faturado a Vencer** altera apenas a proposta cuja cobrança é faturada e ainda não foi recebida.
- Na diferença financeira de uma proposta paga, as opções de devolver, bonificar e registrar débito futuro aparecem só para quem tem a permissão de cada uma.
- **Cancelar proposta**: só quem tem a permissão de cancelar propostas.
- **Criar pedido complementar**: perfis Administrador e Vendedor.
- **Retirar da Produção**: administrador ou perfil com a permissão de liberar para produção.

## Passo a passo

### Entender o cabeçalho

1. O título mostra **Novo pedido** (proposta ainda sem número) ou **N° <número>**, seguido do nome do cliente e do código dele.
2. Ao lado ficam os selos: o **status** da proposta e, quando o pedido já tem arte registrada, o **status da arte** (o mesmo da coluna "Status Arte" da lista de Pedidos).
3. Se a proposta é um pedido complementar, aparece o selo **Complemento do #<número>**, que leva ao pedido principal. No pedido principal aparece **Complemento: #<número> · <status>**.
4. O botão com o ícone do Ideal Imposition abre o pedido no sistema de imposição. Ele só aparece em proposta que já tem número.
5. **Voltar ao detalhe** (ou **Voltar para lista**, em proposta nova) sai da edição.
6. O menu de ações, no canto direito, traz: **Ver proposta**, **Ver chat interno**, **Editar proposta**, **Duplicar proposta**, **Copiar proposta informal**, **Link pgto. externo**, **Gerar PDF da proposta** e, em pedido já liberado para a produção, **Retirar da Produção**.
7. Abaixo do cabeçalho podem aparecer avisos: sobre cobrança gerada, **Saldo na Conta Corrente** (cliente com crédito), **Cliente com débito em aberto** e **Revisão financeira pendente**. Também fica ali o bloco de tarefas da equipe ligadas ao pedido.

### Navegar pelas abas

A barra de abas acompanha a rolagem da tela. A ordem é esta:

| Aba | O que tem | Página |
|---|---|---|
| **Geral** | Cliente, dados da proposta, contato, dados para nota fiscal e endereço de entrega | [Aba Geral](proposta-geral.md) |
| **Orçamento** | Produtos da proposta (seção "6. Produtos") | [Aba Produtos](proposta-produtos.md) |
| **Fretes** | Modalidade, transportadora e cotações | [Aba Fretes](proposta-fretes.md) |
| **Pedido** | Modelos e lotes de cada produto | [Aba Pedido](proposta-pedido.md) |
| **Artes** | Briefing e arquivos de arte | [Aba Artes](proposta-artes.md) |
| **Produção** | Orientação técnica de produção | [Abas Produção, Boletim e Histórico](proposta-producao-boletim-historico.md) |
| **Pagamentos** | Cobranças da proposta | [Aba Pagamentos](proposta-pagamentos.md) |
| **Histórico** | Timeline da proposta e movimentos de crédito | [Abas Produção, Boletim e Histórico](proposta-producao-boletim-historico.md) |

A aba de produtos aparece na tela com o nome **Orçamento**.

Na coluna da direita, em todas as abas, ficam três blocos: **8. Resumo do orçamento** (valores, peso, destino da entrega e o desconto geral), **9. Envio do orçamento** (texto pronto, com o botão **Copiar resumo para WhatsApp**) e **10. Observações e Condições**.

Quando uma aba some ou não abre:

- Em proposta nova, enquanto o cliente não foi escolhido, só o bloco **1. Cliente** aparece.
- Proposta avulsa não mostra as abas **Pedido** e **Artes**.
- Proposta em que todos os produtos são de prateleira não mostra a aba **Artes**.
- A aba **Artes** não abre enquanto houver modelo incompleto na aba Pedido. A tela mostra a lista do que falta em cada modelo.
- A aba **Pagamentos** não abre com alteração por salvar. A tela pede para salvar antes.
- A aba **Pagamentos** não abre enquanto houver diferença financeira pendente.
- Em proposta que ainda não foi salva, as abas **Pagamentos** e **Histórico** pedem para salvar primeiro.

### Salvar a proposta

1. Preencha as abas. O total aparece na barra fixa do rodapé: **Proposta #<número> | Total R$ ...**.
2. Clique em **Salvar proposta** (proposta nova) ou **Salvar alterações** (proposta existente), na barra do rodapé. Esse é o único botão que salva a proposta inteira.
3. Espere a cotação de frete terminar: enquanto ela roda, o botão fica desabilitado.
4. Ao salvar, a tela recarrega no mesmo lugar e mostra **Orçamento criado com sucesso.** ou **Orçamento atualizado com sucesso.** A proposta nova ganha o número nesse momento.
5. **Cancelar**, na mesma barra, volta para a lista ou para o detalhe sem salvar.

O que grava sem passar pelo botão do rodapé:

- **Quantidade**, **Valor Unitário (R$)** e **Fixo (R$)** de um item gravam sozinhos quando você sai do campo com um valor novo e válido. Isso vale só em proposta que já tem número e não tem cobrança. O aviso é **Item salvo.**
- **Salvar item**, dentro do produto, salva a proposta inteira e fecha o cartão do item.
- A troca do pagador em **4. Dados para nota fiscal**, numa proposta que já tem número, grava na hora.
- O endereço criado ou editado na janela de endereço grava na hora, no cadastro do cliente.

Os outros campos (vendedor, empresa, contato, endereço escolhido, observações, modalidade de frete, orientação técnica) só valem depois de salvar.

Ao salvar pela barra do rodapé, os modelos que ainda estavam por gravar na lista rápida da aba Pedido são gravados junto.

### Sair com alterações por salvar

1. Ao clicar em outro menu, em **Cancelar**, em **Voltar ao detalhe** ou no botão voltar do navegador, a tela mostra **Existem alterações não salvas**.
2. Escolha **Continuar editando**, **Sair sem salvar** ou **Salvar e sair**.
3. Ao fechar a aba ou recarregar a página, o próprio navegador pergunta se você quer sair.

### Alterar proposta que já tem cobrança ou pagamento

O que a tela permite depende do aviso amarelo que aparece no topo:

1. **Atenção: Cobranças Geradas** — você não tem permissão para editar proposta cobrada. Os campos das abas Orçamento e Fretes e o desconto geral ficam travados. Salvar grava só as **Observações e Condições** e a orientação técnica da aba Produção, e o aviso é **Salvamento Parcial**.
2. **Cobrança Ativa — Pagamento Ainda Não Confirmado** — você tem permissão, mas a cobrança ainda não foi paga. Não dá para mudar nada que altere o valor: o link de pagamento já está com o cliente e tem valor fixo. Para mudar o valor, cancele a cobrança na aba Pagamentos e gere outra depois.
3. **Modo Edição Autorizada — Proposta com Pagamento Confirmado** — você tem permissão e o pagamento foi confirmado. A proposta salva por inteiro. Se o novo total ficar **abaixo** do que já foi pago, a tela abre a janela **Diferença Financeira — Crédito ao Cliente** e você escolhe o destino do crédito antes de concluir. Se ficar **acima**, a alteração salva direto e a diferença vira saldo a cobrar da própria proposta, resolvido na aba Pagamentos.
4. **Faturado a Vencer — Alteração Liberada** — a cobrança é faturada e o dinheiro ainda não entrou. O pedido pode ser alterado e a cobrança acompanha o novo total. Ao salvar, a janela **Alterar proposta faturada** mostra o valor antigo, o valor novo e os títulos que sairão do Contas a Receber. Confirme em **Excluir títulos e salvar** (ou **Salvar alterações**, quando não há título).
5. **Proposta avulsa já paga não pode ser alterada** — vale para todos os perfis, inclusive administrador.

Na janela de crédito ao cliente, as opções são:

- **Manter crédito para uso futuro**: o valor fica disponível para as próximas propostas do cliente.
- **Devolver ao cliente (solicitar ao Financeiro)**: registra o pedido de devolução. A devolução não é automática; o Financeiro confirma depois.
- **Abater débito existente**: usa o crédito para abater um débito em aberto do mesmo cliente. Escolha o débito e o valor.

Escolha a opção, escreva a observação se quiser e clique em **Confirmar**. A alteração só fica concluída depois disso.

### Resolver uma revisão financeira pendente

1. O aviso vermelho **Revisão financeira pendente** aparece quando a proposta foi alterada depois de paga e a diferença não foi resolvida.
2. Clique em **Resolver agora** e escolha o destino da diferença.
3. Se o botão for **Consolidar Total Oficial**, clique nele e depois em **Confirmar Consolidação**: o sistema recalcula o total pelos itens ativos.
4. Enquanto o aviso estiver na tela, a proposta não aceita novas alterações e a aba Pagamentos não abre.

### Acompanhar o status

O status é definido pelo sistema. Não há campo para escolher.

| Status | O que significa |
|---|---|
| **NOVO** | Proposta criada, sem cobrança ativa. |
| **AGUARDANDO** | Há cobrança ativa, e o valor pago ainda não cobre o total. |
| **LIBERADO** | O pagamento confirmado cobre o total da proposta. |
| **... / EM ARTE** | Acompanha NOVO, AGUARDANDO ou LIBERADO quando há arte em andamento. |
| **NOVO_ARTE_APROVADA** | Sem cobrança confirmada, mas todas as artes já estão aprovadas. Conta como NOVO. |
| **AGUARDANDO_ARTE_APROVADA** | Aguardando o pagamento, com todas as artes já aprovadas. Conta como AGUARDANDO. |
| **REVISAO ATENDENTE** | Pago e com as artes aprovadas (ou sem arte a fazer). Aguarda a conferência do atendente. |
| **REVISAO PRODUCAO**, **EM PRODUCAO**, **EM IMPRESSAO**, **EM ACABAMENTO** | Etapas da produção. |
| **EXPEDICAO**, **A RETIRAR**, **EM TRANSITO**, **ENTREGUE** | Etapas da entrega. |
| **CANCELADO** | Proposta cancelada. |

Como o status muda sozinho:

- Gerar a primeira cobrança leva a proposta de NOVO para AGUARDANDO.
- Quando o pagamento confirmado cobre o total, ela passa para LIBERADO. Pagamento parcial não libera: um centavo em aberto mantém AGUARDANDO.
- Quando todas as artes ficam aprovadas, a proposta liberada passa para REVISAO ATENDENTE. Se ainda não foi paga, ganha o final **_ARTE_APROVADA** e segue esperando o pagamento.
- Proposta só com produtos de prateleira não passa por arte: paga, vai direto para REVISAO ATENDENTE.
- Ao abrir o pedido, o sistema confere o status. Se ele estiver desatualizado, corrige e avisa: **Status Atualizado**.
- A entrada na fila da produção não é automática. Ela depende da ação **Liberar para Produção**, na lista de Pedidos.

### Conversar no chat interno do pedido

1. No menu de ações, clique em **Ver chat interno**. O painel abre na lateral, com as abas **Conversa** e **Tarefas**.
2. Escreva a mensagem e envie com Enter. Use Shift + Enter para pular linha.
3. Para anexar arquivo, use o botão de clipe. O limite é 10 MB por arquivo.
4. Para avisar alguém, digite `@` e escolha a pessoa na lista. Ela recebe a notificação no sino do topo.
5. A mesma conversa aparece na aba **Histórico**, em **Timeline da proposta**, junto com as mensagens automáticas do sistema (cobrança criada, pagamento confirmado, PDF gerado, cancelamento).

O chat é interno. O cliente não vê essas mensagens.

### Cancelar a proposta

O cancelamento não fica no menu de dentro da edição. Faça pela lista de Pedidos ou pelo detalhe da proposta.

1. No menu de ações, clique em **Cancelar proposta**.
2. Leia o quadro **Será cancelado junto**: ele lista as cobranças e os títulos que saem com a proposta.
3. Se a intenção é só refazer a cobrança, use **Cancelar só a cobrança** (ou **Ver cobranças na aba Pagamentos**) em vez de cancelar a proposta.
4. Preencha o **Motivo do Cancelamento**.
5. Clique em **Confirmar Cancelamento**. A ação é irreversível.

### Criar um pedido complementar

Use quando o cliente pede itens a mais para o mesmo evento de um pedido já pago, para os dois saírem juntos.

1. Na lista de Pedidos, abra o menu de ações do pedido original e clique em **Criar pedido complementar**.
2. Confira o resumo e clique em **Criar pedido complementar**.
3. O sistema abre a proposta nova na aba **Orçamento**. Ela nasce sem itens: inclua os produtos e salve.
4. Na aba **Fretes**, cote e aplique o frete complementar. Ele cobra só a diferença do peso somado dos dois pedidos.
5. Siga o fluxo normal: cobrança, arte e produção próprias do complemento.

O complemento herda do pedido original o cliente, o endereço, o contato, o pagador, a modalidade e a transportadora, e esses campos ficam travados com o aviso **Herdado do pedido #<número>**.

### Enviar o link de pagamento ao cliente

1. No menu de ações, clique em **Link pgto. externo**.
2. O aviso **Link de pagamento externo copiado.** confirma que o link está na área de transferência.
3. Cole o link na conversa com o cliente. Ele abre a área do cliente daquele pedido.

### Outras ações do menu

1. **Duplicar proposta**: confirma e abre a cópia já em edição.
2. **Copiar proposta informal**: copia o mesmo texto do bloco **9. Envio do orçamento**.
3. **Gerar PDF da proposta**: abre o PDF em nova aba. Precisa de cliente cadastrado e de empresa válida.
4. **Retirar da Produção**: tira o pedido da fila da produção, depois de confirmar.

## Regras e bloqueios

- Não dá para salvar sem cliente, contato, endereço de entrega, vendedor, empresa, pelo menos um produto e frete definido. A tela diz qual deles falta.
- Não dá para salvar com total zerado. O subtotal dos produtos e o total precisam ser maiores que R$ 0,00.
- Em FOB, não dá para salvar sem transportadora ou sem marcar **Motoboy**: é o dado que a Expedição usa no despacho.
- O status não é editável. Ele muda com as cobranças, os pagamentos, as artes e as etapas da produção e da expedição.
- Com cobrança ativa e sem a permissão de editar proposta paga, produtos, valores, descontos e frete ficam travados.
- Com cobrança enviada e ainda não paga, não dá para alterar o valor da proposta, nem com permissão. Cancele a cobrança antes.
- Proposta avulsa já paga não pode ser alterada por ninguém. A exceção é a avulsa com faturado a vencer, porque o dinheiro ainda não entrou.
- Com cobrança de retrabalho, permuta ou amostra, o total pode subir sem cancelar a cobrança: ela fica como está e a diferença vira saldo a cobrar, com uma segunda cobrança na aba Pagamentos.
- Não dá para trocar o cliente manual por um cadastrado enquanto houver cobrança ativa ou pagamento confirmado.
- Não dá para cancelar a proposta com cobrança já paga ou título já liquidado. A proposta não é cancelada e o motivo aparece na mensagem de erro.
- Não dá para cancelar o pedido original enquanto ele tiver pedido complementar aberto. Cancele ou desvincule o complemento antes.
- O pedido complementar só é aceito quando o original está pago integralmente, não é avulso, não foi despachado, não é ele mesmo um complemento e não tem outro complemento aberto.
- Sair da aba Pedido com modelo ainda não gravado na lista rápida descarta o que foi digitado. A tela pergunta antes.

## Erros comuns

| O que aparece | Por que acontece | O que fazer |
|---|---|---|
| **Cliente obrigatório** | Nenhum cliente foi escolhido. | Escolha o cliente na aba Geral. |
| **Contato obrigatório** | Nenhum contato está selecionado. | Selecione ou adicione um contato na aba Geral. |
| **Endereço obrigatório** | Nenhum endereço de entrega está selecionado. | Selecione o endereço na aba Geral. |
| **Vendedor obrigatório** | A proposta está sem vendedor. | Selecione o vendedor ou peça para cadastrar o vendedor padrão do cliente. |
| **Produtos obrigatórios** | A proposta não tem nenhum produto. | Adicione um produto na aba Orçamento ou marque a proposta como avulsa. |
| **Valor inválido** | O subtotal ou o total está zerado. | Confira quantidades e preços, ou o valor dos produtos da avulsa. |
| **Frete não selecionado** | Em CIF, nenhuma cotação foi escolhida. | Escolha um frete na aba Fretes. |
| **Transportadora obrigatória em FOB** | FOB sem transportadora e sem Motoboy. | Na aba Fretes, escolha a transportadora ou marque Motoboy. |
| **Modelos incompletos na aba Pedido** | Há linha incompleta na lista rápida. Nada foi gravado. | Complete ou remova a linha e salve de novo. |
| **Salvamento Parcial** — "Campos operacionais salvos. Produtos, valores, descontos e frete permanecem bloqueados porque existe cobrança gerada." | A proposta tem cobrança e você não tem permissão para editá-la. | Peça a alteração a quem tem a permissão de editar proposta paga. |
| "Esta proposta tem uma cobrança enviada ao cliente no valor de ..." | A alteração muda o valor e a cobrança ainda não foi paga. | Cancele a cobrança na aba Pagamentos, altere e gere uma nova. |
| **Sem permissão** | A proposta está paga e seu perfil não pode editá-la. | Peça a alteração a quem tem a permissão. |
| **Edição bloqueada** — "Proposta avulsa já paga não pode ser alterada." | Avulsa com pagamento confirmado. | Não há alteração possível. Consulte só Histórico e Pagamentos. |
| **Alteração não permitida** | No faturado a vencer: título já quitado, mais de uma cobrança faturada ou valor que não cabe. | Leia o motivo no aviso e resolva no Contas a Receber ou na aba Pagamentos. |
| "Resolva a diferença financeira pendente antes de acessar Pagamentos." | Há diferença financeira em aberto. | Clique em **Resolver agora** no aviso vermelho. |
| "Você deve salvar as alterações antes de acessar a aba Pagamentos." | Há alteração por salvar. | Clique em **Salvar e continuar**. |
| **Modelos incompletos** — "Antes de acessar Artes, complete os modelos do Pedido." | Falta dado em algum modelo. | Complete os campos listados na aba Pedido. |
| **Sessão expirada** | O login venceu durante a edição. | Entre de novo e repita a operação. |
| **Não foi possível gerar o link.** | O link de pagamento não foi criado. | Tente de novo. Se continuar, avise o administrador. |
| **Geracao de PDF bloqueada** | A proposta é de cliente não cadastrado. | Vincule um cliente cadastrado antes de gerar o PDF. |
| **A proposta não está paga integralmente** | Tentativa de criar complemento de pedido com saldo em aberto. | Conclua o pagamento do pedido original antes. |
| **Já existe um complemento aberto** | O pedido original já tem um complemento em andamento. | Use o complemento existente ou cancele-o antes. |

## Veja também

- [Pedidos (lista)](pedidos.md)
- [Proposta: aba Geral](proposta-geral.md)
- [Proposta: aba Produtos](proposta-produtos.md)
- [Proposta: aba Fretes](proposta-fretes.md)
- [Proposta: aba Pagamentos](proposta-pagamentos.md)
- [Proposta: aba Artes](proposta-artes.md)
- [Proposta: aba Pedido (Boletim Técnico & Lotes)](proposta-pedido.md)
- [Proposta: abas Produção, Boletim e Histórico](proposta-producao-boletim-historico.md)
- [Conferência](conferencia.md)
- [Carteira (contas a receber)](carteira.md)
- [Registro de recebíveis](registro-de-recebiveis.md)
- [Expedição](expedicao.md)
- [Tarefas](tarefas.md)
