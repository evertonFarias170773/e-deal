# Proposta: visão geral e abas

> **Última revisão:** 08/10/2026
> **Caminho no menu:** Pedidos → **+ Nova proposta** (proposta nova) ou Pedidos → abrir um pedido → **Editar proposta**
> **Endereço:** `/orcamentos/novo` e `/orcamentos/<número>/editar`

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
- **Duplicar proposta**: só o vendedor da proposta, o administrador ou quem vê todas as propostas. Para os demais a cópia é recusada com o aviso "Você só pode duplicar proposta em que é o vendedor".
- **Criar Complemento**: perfis Administrador e Vendedor.
- **Retirar da Produção**: administrador ou perfil com a permissão de liberar para produção.

## Botões e ações da tela

Nomes exatamente como aparecem na tela, inclusive maiúsculas, acentos e erros de grafia. Os botões de dentro de cada aba estão na página da aba.

| Nome na tela | Onde fica | O que faz |
|---|---|---|
| **+ Nova proposta** | Topo da lista de Pedidos | Abre uma proposta em branco. |
| **Acoes** (botão com três pontos; em tela estreita aparece só o ícone) | Canto direito do cabeçalho | Abre o menu de ações da proposta. |
| **Ver proposta** | Menu **Acoes** | Abre o detalhe da proposta, só para leitura. |
| **Ver chat interno** | Menu **Acoes** | Abre o chat interno do pedido na lateral. |
| **Editar proposta** | Menu **Acoes** | Abre a edição da proposta (esta tela). |
| **Duplicar proposta** | Menu **Acoes** | Cria uma cópia da proposta, com os dados da original, e abre a cópia em edição. |
| **Entendi** | Aviso azul **Cópia da proposta #<número>** | Fecha o aviso da cópia neste navegador. |
| **Copiar proposta informal** | Menu **Acoes** | Copia o texto informal da proposta para colar no WhatsApp. |
| **Link pgto. externo** | Menu **Acoes** | Copia o link da área do cliente daquele pedido. |
| **Gerar PDF da proposta** | Menu **Acoes** | Gera o PDF do orçamento e abre em outra aba. |
| **Gerar OC** | Menu **Acoes**, logo abaixo de **Gerar PDF da proposta** (na edição e no detalhe da proposta) | Gera a OC, a autorização de faturamento que o cliente assina, e abre em outra aba. |
| **Retirar da Produção** | Menu **Acoes**, só em pedido já liberado para a produção | Tira o pedido da fila da produção. |
| Botão com o ícone do Ideal Imposition (dica: "Abrir no Ideal Imposition") | Cabeçalho, em proposta que já tem número | Abre o pedido no sistema de imposição. |
| **Voltar ao detalhe** / **Voltar para lista** | Cabeçalho | Sai da edição. Em proposta nova o nome é **Voltar para lista**. |
| **Complemento do #<número>** | Selo no cabeçalho do pedido complementar | Abre o pedido principal. |
| **Complemento: #<número> · <status>** | Selo no cabeçalho do pedido principal | Abre o pedido complementar. |
| **Geral** | Barra de abas | Cliente, dados da proposta, contato, nota fiscal e endereço. |
| **Orçamento** | Barra de abas | Produtos da proposta. |
| **Fretes** | Barra de abas | Modalidade, transportadora e cotações. |
| **Pedido** | Barra de abas | Modelos e lotes de cada produto. |
| **Artes** | Barra de abas | Briefing e arquivos de arte. |
| **Produção** | Barra de abas | Orientação técnica de produção. |
| **Pagamentos** | Barra de abas | Cobranças da proposta. |
| **Histórico** | Barra de abas | Timeline da proposta e movimentos de crédito. |
| **Salvar proposta** / **Salvar alterações** | Barra fixa do rodapé | Salva a proposta inteira. Enquanto grava, mostra **Salvando...** |
| **Cancelar** | Barra fixa do rodapé | Sai da edição sem salvar. Não cancela a proposta. |
| **Copiar resumo para WhatsApp** | Bloco **9. Envio do orçamento**, coluna da direita | Copia o texto informal da proposta. |
| **Tipo** (**%** ou **R$**) e **Desconto geral** | Bloco **8. Resumo do orçamento**, coluna da direita | Aplicam desconto sobre o subtotal dos produtos. |
| **Resolver agora** | Aviso vermelho **Revisão financeira pendente** | Abre a janela para escolher o destino da diferença. |
| **Consolidar Total Oficial** | Aviso vermelho **Revisão financeira pendente** | Abre a confirmação para recalcular o total pelos itens ativos. |
| **Confirmar Consolidação** | Janela **Consolidar Total Oficial** | Recalcula o total e recarrega a tela. |
| **Continuar editando** | Janela **Existem alterações não salvas** | Fecha a janela e mantém a edição. |
| **Sair sem salvar** | Janela **Existem alterações não salvas** | Sai e descarta o que não foi salvo. |
| **Salvar e sair** / **Salvar e continuar** | Janela **Existem alterações não salvas** / janela **Salvar alterações** (ao abrir Pagamentos) | Salva e segue para onde você ia. |
| **Salvar proposta agora** | Aba Pagamentos de proposta ainda sem número | Salva a proposta para liberar as cobranças. |
| **Entendi** | Janela **Modelos incompletos** | Fecha a lista do que falta nos modelos. |
| **Manter crédito para uso futuro** | Janela **Diferença Financeira — Crédito ao Cliente** | Deixa o valor como crédito do cliente. |
| **Devolver ao cliente (solicitar ao Financeiro)** | Mesma janela | Registra o pedido de devolução. |
| **Abater débito existente** | Mesma janela | Usa o crédito para abater um débito do cliente. |
| **Confirmar** | Mesma janela | Conclui a alteração com a opção escolhida. |
| Botão **X** (dica: "Voltar para proposta") | Mesma janela | Fecha a janela sem resolver; a pendência continua aberta. |
| **Excluir títulos e salvar** / **Salvar alterações** | Janela **Alterar proposta faturada** | Tira os títulos do Contas a Receber e salva a proposta. |
| **Voltar** | Janelas **Alterar proposta faturada**, **Cancelar Proposta** e **Criar Complemento** | Fecha a janela sem fazer nada. |
| **Conversa** e **Tarefas** | Abas do painel do chat | Alternam entre as mensagens e as tarefas do pedido. |
| Botão de anexo (dica: "Anexar arquivo (até 10MB)") | Painel do chat | Escolhe arquivos para enviar com a mensagem. |
| Botão de envio (dica: "Enviar mensagem") | Painel do chat | Envia a mensagem. |
| **Cancelar proposta** | Menu **Acoes** da lista de Pedidos (na lista em cartões o botão se chama **Mais**) e do detalhe da proposta | Abre a janela **Cancelar Proposta**. |
| **Cancelar só a cobrança** / **Ver cobranças na aba Pagamentos** | Janela **Cancelar Proposta** | Cancela só a cobrança, ou leva à aba Pagamentos quando há mais de uma. |
| **Confirmar Cancelamento** | Janela **Cancelar Proposta** | Cancela a proposta. |
| **Criar Complemento** | Menu **Acoes** (ou **Mais**) da lista de Pedidos e botão da janela de mesmo nome | Cria a proposta complementar, vinculada ao pedido original. |

## Passo a passo

### Entender o cabeçalho

1. O título mostra **Novo pedido** (proposta ainda sem número) ou **N° <número>**, seguido do nome do cliente e do código dele.
2. Ao lado ficam os selos: o **status** da proposta e, quando o pedido já tem arte registrada, o **status da arte** (o mesmo da coluna "Status Arte" da lista de Pedidos).
3. Se a proposta é um pedido complementar, aparece o selo **Complemento do #<número>**, que leva ao pedido principal. No pedido principal aparece **Complemento: #<número> · <status>**.
4. O botão com o ícone do Ideal Imposition abre o pedido no sistema de imposição. Ele só aparece em proposta que já tem número.
5. **Voltar ao detalhe** (ou **Voltar para lista**, em proposta nova) sai da edição.
6. O botão **Acoes**, no canto direito, abre o menu de ações: **Ver proposta**, **Ver chat interno**, **Editar proposta**, **Duplicar proposta**, **Copiar proposta informal**, **Link pgto. externo**, **Gerar PDF da proposta**, **Gerar OC** e, em pedido já liberado para a produção, **Retirar da Produção**.
7. Abaixo do cabeçalho podem aparecer avisos: sobre cobrança gerada, **Saldo na Conta Corrente** (cliente com crédito), **Cliente com débito em aberto** e **Revisão financeira pendente**. Também fica ali o bloco de tarefas da equipe ligadas ao pedido.

### Navegar pelas abas

A barra de abas acompanha a rolagem da tela. São oito abas, nesta ordem:

| Aba | O que tem | Página |
|---|---|---|
| **Geral** | Cliente, dados da proposta, contato, dados para nota fiscal e endereço de entrega | [Aba Geral](proposta-geral.md) |
| **Orçamento** | Produtos da proposta (seção "6. Produtos") | [Aba Orçamento (produtos)](proposta-produtos.md) |
| **Fretes** | Modalidade, transportadora e cotações | [Aba Fretes](proposta-fretes.md) |
| **Pedido** | Modelos e lotes de cada produto | [Aba Pedido](proposta-pedido.md) |
| **Artes** | Briefing e arquivos de arte | [Aba Artes](proposta-artes.md) |
| **Produção** | Orientação técnica de produção | [Abas Produção, Boletim e Histórico](proposta-producao-boletim-historico.md) |
| **Pagamentos** | Cobranças da proposta | [Aba Pagamentos](proposta-pagamentos.md) |
| **Histórico** | Timeline da proposta e movimentos de crédito | [Abas Produção, Boletim e Histórico](proposta-producao-boletim-historico.md) |

A aba de produtos aparece na tela com o nome **Orçamento**.

**Boletim** não é aba visível: a barra não tem botão com esse nome. Quem abre o endereço da proposta com `?tab=boletim` vê só o quadro "Boletim — Aguarde orientações."

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

### Ler o detalhe da proposta (visualização)

O detalhe é a tela só de leitura, aberta por **Ver proposta**. Ele mostra o mesmo que a edição, sem deixar alterar nada.

1. **Selos do cabeçalho:** o status do pedido e, ao lado, o status da arte, os mesmos da edição.
2. **Aviso amarelo:** é o mesmo aviso da edição, pela mesma regra. Por exemplo, **Faturado a Vencer — Alteração Liberada** quando a cobrança faturada ainda não venceu. Cobrança cancelada não gera aviso.
3. **Frete escolhido:** o frete que o pedido tem de fato.
   - **Retira no balcão**, em pedido de retirada.
   - **Cliente contrata: nome da transportadora** (ou **Motoboy**), em FOB, com R$ 0,00.
   - **Transportadora: nome**, em CIF com transportadora definida que não é os Correios, ou depois que a Expedição despachou por transportadora. Quando a transportadora é os Correios, o nome exibido é **Correios**, e o envio continua mostrando o serviço cotado (SEDEX, PAC).
   - **Motoboy**, em CIF por motoboy.
   - O serviço cotado (por exemplo "Correios SEDEX - 1 dia útil"), nos demais casos de CIF.
   - **Herdado do pedido #N: modalidade**, em pedido complementar.
4. **Fretes disponíveis:** só leva o selo **ESCOLHIDO** a cotação que é de fato o frete. Quando o frete é outro, aparece a nota "Frete definido: ... As cotações abaixo não estão em uso".
5. **Total final → Pagamento:** a forma e o estado das cobranças ativas, como na aba Pagamentos (por exemplo "PIX (Confirmado)"). Sem cobrança ativa: "Sem cobrança".
6. **Cobranças:** antes da liberação mostra a situação da liberação ("Pronta para liberar", "Aguardando pagamento"). Com o pedido já em produção ou depois, mostra o estado real da cobrança ("Confirmado", "A vencer").
7. **Resumo de valores:**
   - **Subtotal bruto** e **Tabela especial do cliente aplicada** só aparecem em pedido com tabela especial, com o valor do desconto.
   - **Desconto geral** só aparece quando há desconto.
   - **Prazo de produção** é o maior prazo, em dias úteis, entre os produtos do pedido.
   - **Prazo de entrega** é o prazo da cotação quando ela é o frete; nos outros casos, "Não se aplica".
8. **Contato responsável:** quando o contato está cadastrado sem nome, aparece "Contato sem nome cadastrado", com o telefone e o e-mail que existirem.
9. **Copiar resumo para WhatsApp:** em pedido com tabela especial, o texto leva o subtotal bruto e o desconto corretos.

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

1. No menu **Acoes**, clique em **Ver chat interno**. O painel abre na lateral, com as abas **Conversa** e **Tarefas**.
2. Escreva a mensagem e envie com Enter. Use Shift + Enter para pular linha.
3. Para anexar arquivo, use o botão de clipe. O limite é 10 MB por arquivo.
4. Para avisar alguém, digite `@` e escolha a pessoa na lista. Ela recebe a notificação no sino do topo.
5. A mesma conversa aparece na aba **Histórico**, em **Timeline da proposta**, junto com as mensagens automáticas do sistema (cobrança criada, pagamento confirmado, PDF gerado, cancelamento).

O chat é interno. O cliente não vê essas mensagens.

### Cancelar a proposta

O cancelamento não fica no menu de dentro da edição. Faça pela lista de Pedidos ou pelo detalhe da proposta.

1. No menu **Acoes**, clique em **Cancelar proposta**.
2. Leia o quadro **Será cancelado junto**: ele lista as cobranças e os títulos que saem com a proposta.
3. Se a intenção é só refazer a cobrança, use **Cancelar só a cobrança** (ou **Ver cobranças na aba Pagamentos**) em vez de cancelar a proposta.
4. Preencha o **Motivo do Cancelamento**.
5. Clique em **Confirmar Cancelamento**. A ação é irreversível.

### Criar um Complemento

Use quando o cliente pede itens a mais para o mesmo evento de um pedido já pago, para os dois saírem juntos. A ação se chamava **Criar pedido complementar**; o nome mudou para **Criar Complemento** em 08/10/2026 (commit `dd9a110`), sem mudar o que ela faz.

**O Complemento está em reformulação.** Está sendo revisto para aceitar mais de um complemento por pedido e para valer também antes da produção. Ainda não há mudança publicada, e não há data definida. Enquanto isso, vale o que esta ficha descreve: só em pedido pago, entre LIBERADO e EXPEDICAO, e com um complemento aberto por pedido. Quando a regra mudar, esta ficha muda junto.

1. Na lista de Pedidos, abra o menu **Acoes** do pedido original e clique em **Criar Complemento**.
2. Confira o resumo e clique em **Criar Complemento**.
3. O sistema abre a proposta nova na aba **Orçamento**. Ela nasce sem itens: inclua os produtos e salve.
4. Na aba **Fretes**, cote e aplique o frete complementar. Ele cobra só a diferença do peso somado dos dois pedidos. Repetir **Aplicar** não duplica.
5. Siga o fluxo normal: cobrança, arte e produção próprias do complemento. A cobrança só sai depois do frete complementar aplicado; antes disso aparece a janela "O frete precisa ser atualizado".

Se ao aplicar aparecer em vermelho que a opção escolhida não está na cotação de agora, recarregue a página e cote de novo: até 08/10/2026 isso acontecia sempre com **Motoboy**, **Transportadora São Miguel** e **VEPPO** (corrigido no commit `2387164`). O passo a passo completo, inclusive o caso do complementar em RETIRA ou FOB, está em [Proposta: aba Fretes](proposta-fretes.md).

O complemento herda do pedido original o cliente, o endereço, o contato, o pagador, a modalidade e a transportadora, e esses campos ficam travados com o aviso **Herdado do pedido #<número>**.

### Enviar o link de pagamento ao cliente

1. No menu **Acoes**, clique em **Link pgto. externo**.
2. O aviso **Link de pagamento externo copiado.** confirma que o link está na área de transferência.
3. Cole o link na conversa com o cliente. Ele abre a área do cliente daquele pedido.

### Duplicar a proposta

1. No menu **Acoes**, clique em **Duplicar proposta** e confirme. A cópia abre em edição, com número novo e status NOVO.
2. Leia o aviso azul **Cópia da proposta #<número>**, no topo. Ele diz o que veio da original e o que falta conferir.
3. Confira o faturado, o endereço de entrega, o contato e as observações. Eles vêm da original.
4. Na aba Fretes, a modalidade (CIF, FOB ou Retira) e a transportadora do FOB vêm da original. A cotação não vem: em CIF, escolha o frete de novo.
5. Na aba Orçamento, os produtos, as quantidades, as variações e o desconto geral vêm da original, com os preços daquela venda. Produto cancelado na original não vem.
6. Na aba Pedido, os modelos vêm da original com o mesmo nome, cor do papel, quantidade e numeração, e com a arte pendente. Confira a numeração: se for o mesmo evento, ela vai se repetir. Modelo criado pelo **Mapa Teatro** continua ligado ao mesmo mapa e ao mesmo setor, e o selo **Mapa: <nome do mapa>** aparece na cópia.
7. Clique em **Salvar alterações**. A cobrança da original não vem: gere a da cópia na aba Pagamentos.

O aviso some quando você clica em **Entendi** ou quando a cópia ganha cobrança.

### Outras ações do menu

1. **Copiar proposta informal**: copia o mesmo texto do bloco **9. Envio do orçamento**.
2. **Gerar PDF da proposta**: abre o PDF do orçamento em nova aba. Precisa de cliente cadastrado e de empresa válida.
3. **Gerar OC**: abre em nova aba a **Autorização de faturamento** do pedido. Tem o mesmo conteúdo do orçamento: empresa emissora com CNPJ e endereço, **Orçado por**, data, validade, cliente, CPF/CNPJ, produtos, subtotal, frete, total, observações e a frase da entrega. Abaixo de CPF/CNPJ, só a OC traz **ENTREGA:** (o endereço de entrega da proposta, ou "Retira no balcão") e **ENVIO:** (a modalidade e o mesmo envio da coluna Envio da lista de Pedidos, por exemplo "CIF — SEDEX" ou "FOB — BRASPRESS"; na retirada, "Retira no balcão", como na linha ENTREGA). Muda também o título, a ordem do bloco de cima e o bloco de assinatura, para o cliente devolver assinado e carimbado. Na OC, **Dados para faturamento:** introduz os dados do cliente (CLIENTE, CPF/CNPJ, ENTREGA e ENVIO); depois vêm **Orçado por** e, por último, a empresa emissora com o endereço. Precisa de cliente cadastrado e de empresa válida, como o PDF.
4. **Retirar da Produção**: tira o pedido da fila da produção, depois de confirmar.

## Regras e bloqueios

- Não dá para salvar sem cliente, contato, endereço de entrega, vendedor, empresa, pelo menos um produto e frete definido. A tela diz qual deles falta.
- Não dá para salvar com total zerado. O subtotal dos produtos e o total precisam ser maiores que R$ 0,00.
- Em FOB, não dá para salvar sem transportadora ou sem marcar **Motoboy**: é o dado que a Expedição usa no despacho.
- O status não é editável. Ele muda com as cobranças, os pagamentos, as artes e as etapas da produção e da expedição.
- Com cobrança ativa e sem a permissão de editar proposta paga, produtos, valores, descontos e frete ficam travados.
- Com cobrança enviada e ainda não paga, não dá para alterar o valor da proposta, nem com permissão. Cancele a cobrança antes. Salvar só arte, observação ou modelos não muda o valor e passa normalmente.
- Proposta avulsa já paga não pode ser alterada por ninguém. A exceção é a avulsa com faturado a vencer, porque o dinheiro ainda não entrou.
- Com cobrança de retrabalho, permuta ou amostra, o total pode subir sem cancelar a cobrança: ela fica como está e a diferença vira saldo a cobrar, com uma segunda cobrança na aba Pagamentos.
- Não dá para trocar o cliente manual por um cadastrado enquanto houver cobrança ativa ou pagamento confirmado.
- Não dá para cancelar a proposta com cobrança já paga ou título já liquidado. A proposta não é cancelada e o motivo aparece na mensagem de erro.
- Não dá para cancelar o pedido original enquanto ele tiver pedido complementar aberto. Cancele ou desvincule o complemento antes.
- Não dá para gerar a cobrança do pedido complementar antes de aplicar o frete complementar na aba **Fretes**. No complementar em RETIRA ou FOB, que não tem frete a aplicar, esse bloqueio é um problema conhecido e sem solução publicada.
- O pedido complementar só é aceito quando o original está pago integralmente, não é avulso, não foi despachado, não é ele mesmo um complemento e não tem outro complemento aberto.
- Sair da aba Pedido com modelo ainda não gravado na lista rápida descarta o que foi digitado. A tela pergunta antes.
- Só duplica a proposta quem é o vendedor dela, o administrador ou quem vê todas as propostas.
- Proposta que já é cópia não pode ser duplicada. Duplique a original.
- A cópia não leva cobrança, status, cotação de frete, bônus de tabela especial, arte dos modelos, dados do evento, chat, tarefas nem histórico. O bônus do cliente entra de novo no primeiro **Salvar alterações**.
- Os modelos da cópia nascem com a arte pendente, sem arquivo e sem amostra, e trazem "Cópia do pedido #<número>" na observação de arte. Modelo de produto cancelado na original não vem.
- A cópia que traz modelos abre como **NOVO / EM ARTE**, como acontece quando os modelos são digitados.
- No PDF da proposta e na OC, as **Observações e Condições** saem inteiras, sem corte. Na OC elas ficam todas à esquerda da assinatura. Texto que não cabe no espaço abaixo do total sai com letra menor, até um limite. Se ainda assim não couber, o PDF ganha uma página **Observações (continuação)** com o resto do texto.

## O que não confundir

- **Menu Pedidos** x título **Orcamentos** x aba **Orçamento**: o menu lateral **Pedidos** abre a lista de propostas, cuja página tem o título **Orcamentos** (sem cedilha); a aba **Orçamento** fica dentro de uma proposta e guarda os produtos dela.
- Aba **Pedido** x aba **Produção** x menu **Produção**: a aba **Pedido** tem os modelos e lotes de cada produto; a aba **Produção** é só o texto da orientação técnica; o menu lateral **Produção** é outra tela, a das ordens de serviço.
- **Salvar alterações** x **Salvar item** x sair do campo: **Salvar alterações** (rodapé) salva tudo e recarrega a tela; **Salvar item** salva tudo e fecha o cartão do produto; sair do campo grava sozinho só Quantidade, Valor Unitário e Fixo, e só em proposta com número e sem cobrança.
- **Cancelar** x **Cancelar proposta** x **Cancelar só a cobrança**: **Cancelar** (rodapé) apenas sai da edição; **Cancelar proposta** encerra o pedido e é irreversível; **Cancelar só a cobrança** mantém o pedido e reabre o saldo para uma cobrança nova.
- **Gerar PDF da proposta** x **Gerar OC**: o primeiro é o orçamento, com validade de 15 dias, para o cliente decidir; o segundo é a autorização de faturamento, que o cliente devolve assinada. Os dois saem com o modelo da empresa da proposta e entram na timeline como "PDF da proposta gerado." e "PDF da OC gerado.".
- **Ver proposta** x **Editar proposta**: a primeira abre o detalhe, só para leitura; a segunda abre esta tela.
- **Duplicar proposta** x **Criar Complemento**: duplicar abre uma cópia independente, com os produtos e os dados da original e frete a cotar; o complementar nasce sem itens, vinculado ao pedido original, e sai junto com ele na Expedição.
- **Link pgto. externo** x **Copiar proposta informal** x **Copiar resumo para WhatsApp**: o primeiro copia o link da área do cliente; os outros dois copiam o mesmo texto informal da proposta.
- Status da proposta x status da arte: são dois selos no cabeçalho. O primeiro diz em que etapa o pedido está; o segundo, em que pé está a arte.
- **NOVO / EM ARTE** x **NOVO_ARTE_APROVADA**: no primeiro a arte ainda está em andamento; no segundo todas as artes já foram aprovadas e só falta o pagamento. O mesmo vale para AGUARDANDO.
- **LIBERADO** x liberado para a produção: **LIBERADO** quer dizer que o pagamento cobre o total; a entrada na fila da produção depende da ação **Liberar para Produção**, na lista de Pedidos.
- **Salvamento Parcial** x salvamento completo: no parcial só as observações e a orientação técnica foram gravadas; produtos, valores, descontos e frete ficaram como estavam.
- Crédito ao cliente x saldo a cobrar: novo total abaixo do que já foi pago gera crédito, e a tela obriga a escolher o destino; novo total acima do pago vira saldo a cobrar, resolvido na aba Pagamentos.
- **Observações e Condições** x **Orientação técnica de produção**: a primeira é comercial e não chega à produção; a segunda é o que a bancada lê.
- Número do pedido x código do cliente: no título, **N° <número>** é o número da proposta; o número depois do nome do cliente é o código do cadastro dele.

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
| **Erro ao duplicar** — "Você só pode duplicar proposta em que é o vendedor. Peça a um administrador ou a quem tem visão geral das propostas." | A proposta é de outro vendedor e o seu perfil vê só as próprias. | Peça a cópia ao vendedor da proposta, a um administrador ou a quem vê todas as propostas. |
| **Erro ao duplicar** — "Não é permitido duplicar uma proposta que já é cópia." | A proposta nasceu de um **Duplicar proposta**. | Abra a proposta original e duplique a partir dela. |
| **Não foi possível gerar o link.** | O link de pagamento não foi criado. | Tente de novo. Se continuar, avise o administrador. |
| **Geracao de PDF bloqueada** | A proposta é de cliente não cadastrado. Vale também para **Gerar OC**. | Vincule um cliente cadastrado antes de gerar o PDF ou a OC. |
| **Erro ao gerar PDF** / **Falha na geração** ao gerar a OC | A empresa da proposta não tem modelo de OC cadastrado. Hoje só Ideal Gráfica, Ideal Birô e E3 Brindes têm. | Peça ao administrador para cadastrar o modelo da empresa. |
| **A proposta não está paga integralmente** | Tentativa de criar complemento de pedido com saldo em aberto. | Conclua o pagamento do pedido original antes. |
| **Já existe um complemento aberto** | O pedido original já tem um complemento em andamento. | Use o complemento existente ou cancele-o antes. |

## Veja também

- [Pedidos (lista)](pedidos.md)
- [Proposta: aba Geral](proposta-geral.md)
- [Proposta: aba Orçamento (produtos)](proposta-produtos.md)
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

## Arquivos de origem

- `src/features/orcamentos/OrcamentoFormPage.tsx`
- `src/app/(erp)/orcamentos/novo/page.tsx`
- `src/app/(erp)/orcamentos/[id]/editar/page.tsx`
- `src/features/orcamentos/OrcamentosListPageReal.tsx`
- `src/features/orcamentos/OrcamentoDetailPage.tsx`
- `src/features/orcamentos/lib/visualizacao-da-proposta.ts`
- `src/features/orcamentos/lib/estado-de-edicao.ts`
- `src/features/orcamentos/services/visualizacao-proposta.service.ts`
- `src/features/orcamentos/mappers.ts`
- `src/features/orcamentos/orcamento-utils.ts`
- `src/features/orcamentos/services/orcamentos.service.ts`
- `src/features/orcamentos/services/status-engine.service.ts`
- `src/features/orcamentos/services/faturado-editavel.ts`
- `src/features/orcamentos/lib/aviso-copia.ts`
- `supabase/migrations/20261002_copiar_proposta_v2_fase1_cabecalho_frete.sql`
- `supabase/migrations/20261002_copiar_proposta_v2_fase2_modelos.sql`
- `src/features/orcamentos/components/DiferencaFinanceiraModal.tsx`
- `src/features/orcamentos/components/LiberarFaturadoModal.tsx`
- `src/features/orcamentos/components/CancelPropostaModal.tsx`
- `src/features/orcamentos/components/CriarComplementoModal.tsx`
- `src/features/orcamentos/components/PropostaChatDrawer.tsx`
- `src/features/orcamentos/components/PropostaChatPanel.tsx`
- `src/features/area-cliente/lib/copiar-link-pagamento.ts`
- `supabase/functions/proposta_comencial/index.ts`
- `supabase/functions/proposta_comencial/gerar.ts`
- `supabase/migrations/20261003_empresas_modelos_pdf_storage.sql`
- `src/app/api/orcamentos/editar-paga/route.ts`
- `src/components/common/ActionsMenu.tsx`
- `src/constants/navigation.ts`

> **Mudanças de 08/10/2026:**
>
> - o identificador das opções de Motoboy, Transportadora São Miguel e VEPPO deixou de mudar a cada cotação, e por isso o frete complementar desses transportes volta a ser aplicado (commit `2387164`);
> - o pedido novo com frete dos Correios passa a apontar para o cadastro da Superintendência Estadual RS dos Correios, e a transportadora aparece como **Correios** em vez da fantasia do cadastro;
> - a ação **Criar pedido complementar** passou a se chamar **Criar Complemento** (commit `dd9a110`), só no nome.
