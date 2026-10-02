# Tarefas

> **Última revisão:** 02/10/2026
> **Caminho no menu:** Tarefas (item direto do menu lateral, sem subitem; fica entre Financeiro e Maestro). O ícone de lista na barra do topo leva para a mesma tela.
> **Endereço:** `/tarefas`

## Para que serve

É a central única de tarefas da equipe: aqui você pede algo a um colega, acompanha o que pediu e resolve o que chegou para você. Cada tarefa tem uma conversa própria, anexos e um histórico de quem criou, assumiu, concluiu ou cancelou.

Administradores também usam a tela para registrar e acompanhar **Melhorias**, que são pedidos de ajuste do sistema feitos ao DEV.

O que entra na lista são somente as tarefas criadas nesta central (pelo botão **Nova tarefa**, daqui ou de outras telas) e as tarefas que o próprio sistema cria quando um pagamento combinado falha. As pendências antigas de proposta não aparecem aqui; elas ficaram na tela antiga, só para consulta (veja "Consultar a Central de Pendências antiga").

## Quem acessa

- O item **Tarefas** aparece no menu para todos os usuários.
- Para criar tarefa, receber tarefa, aparecer na lista **Para quem** e entrar em **Todos da equipe**, o seu perfil precisa ter a permissão **Participar das Tarefas** (em Configurações → Perfis e Permissões, grupo Tarefas). Contas de teste ficam de fora mesmo com a permissão.
- Cada pessoa vê apenas as tarefas em que está envolvida: as que criou, as que recebeu (foi escolhida em **Para quem**), as que assumiu e as enviadas para **Todos da equipe**.
- Administradores veem todas as tarefas, têm as abas **Todas** e **Melhorias** e podem assumir, concluir e cancelar qualquer tarefa.
- Melhorias só são vistas e criadas por administradores.
- Não existe atribuição a um setor. A tarefa vai para uma ou mais pessoas escolhidas pelo nome, ou para todos.

## Botões e ações da tela

Nomes exatamente como aparecem na tela.

### Lista de tarefas

| Nome na tela | Onde fica | O que faz |
|---|---|---|
| **Tarefas** | Menu lateral | Abre esta tela. Ao lado do nome aparece o número das suas tarefas em aberto, que pisca quando há novidade. |
| Ícone de lista (texto ao passar o mouse: "Você tem N tarefa(s) nova(s) para abrir", "Você tem N tarefa(s) em aberto" ou "Sem tarefas em aberto") | Barra do topo, antes do sino | Abre esta tela. Mostra o mesmo número do menu e pisca quando há novidade. |
| **Nova tarefa** | Topo da tela, à direita | Abre a janela **Nova tarefa**. |
| **Nova melhoria** | Topo da tela, à direita, na aba **Melhorias** (só administrador) | Abre a janela **Nova melhoria**. |
| **Minhas** | Abas no topo da lista | Mostra o que você assumiu, o que recebeu e as tarefas para todos ainda sem responsável. |
| **Criadas por mim** | Abas no topo da lista | Mostra as tarefas que você pediu. |
| **Todas** | Abas no topo da lista (só administrador) | Mostra todas as tarefas da equipe. |
| **Melhorias** | Abas no topo da lista (só administrador) | Mostra as melhorias pedidas ao DEV. |
| **Em aberto** | Seletor à direita das abas | Mostra as tarefas Aberta e Em andamento. |
| **Encerradas** | Seletor à direita das abas | Mostra as tarefas Concluída e Cancelada. |
| Linha da tarefa (clicável) | Lista | Abre a janela de detalhe da tarefa. |
| **Pedido N** | Linha da tarefa, à direita, quando há pedido ligado | Abre a proposta daquele pedido. |
| **Cliente N** | Linha da tarefa, à direita, quando há cliente ligado | Abre o cadastro daquele cliente. |
| **Assumir** | Linha da tarefa Aberta, para quem a recebeu ou para administrador | Passa a tarefa para **Em andamento** com você como responsável. Durante a gravação mostra "Assumindo…". |
| **Concluir** | Linha da tarefa Em andamento, para o responsável ou para administrador | Abre a tarefa já na etapa de conclusão. |

### Janela Nova tarefa / Nova melhoria

| Nome na tela | Onde fica | O que faz |
|---|---|---|
| **O que precisa ser feito \*** (na melhoria: **O que melhorar \***) | Primeiro campo | Título da tarefa. Obrigatório. |
| **Normal** / **Alta** / **Urgente** | Campo **Prioridade** | Define a prioridade. Começa em Normal. |
| **Todos da equipe** | Campo **Para quem \***, caixa de marcar | Manda a tarefa para todos que participam das Tarefas e esconde a lista de pessoas. |
| **Buscar pessoa** | Campo **Para quem \*** | Filtra a lista de pessoas pelo nome. |
| Caixa de marcar ao lado de cada nome | Lista de pessoas em **Para quem \*** | Escolhe ou tira a pessoa. As escolhidas aparecem em etiquetas acima da busca. |
| Ícone X na etiqueta da pessoa (texto: "Tirar" e o nome) | Etiquetas das pessoas escolhidas | Tira a pessoa da tarefa. |
| **Detalhes** | Campo de texto | Descrição livre, até 5.000 caracteres. |
| **Nº do pedido** | Campo numérico | Liga a tarefa a um pedido. |
| **Código do cliente** | Campo numérico | Liga a tarefa a um cliente. |
| **Prazo** | Campo de data | Data de referência da tarefa. |
| **Escolher arquivos** | Campo **Anexos (PDF ou imagem, até 10 MB cada)** | Escolhe um ou mais arquivos para subir junto com a tarefa. |
| Ícone X ao lado do arquivo (texto: "Tirar" e o nome do arquivo) | Lista de arquivos escolhidos | Tira o arquivo antes de salvar. |
| **Cancelar** | Rodapé da janela | Fecha sem criar. |
| **Salvar** | Rodapé da janela | Cria a tarefa e envia os anexos. Durante a gravação mostra "Salvando…". |
| Ícone X (texto: "Fechar") | Canto superior direito da janela | Fecha a janela. A tecla Esc e o clique fora da janela fazem o mesmo. |

### Janela de detalhe (título Tarefa ou Melhoria)

| Nome na tela | Onde fica | O que faz |
|---|---|---|
| Número do pedido (link) | Linha **Pedido** | Abre a proposta. |
| Código do cliente (link) | Linha **Cliente** | Abre o cadastro do cliente. |
| **Adicionar anexo** | Bloco **Anexos**, à direita, com a tarefa em aberto | Sobe um arquivo para a tarefa. |
| **Baixar** | Ao lado de cada anexo, inclusive os de mensagens | Baixa o arquivo. |
| **Responder sem mudar a situação** | Campo de mensagem, abaixo de **Histórico e conversa** | Onde se escreve a mensagem da conversa. |
| **Anexar arquivo** | Abaixo do campo de mensagem | Escolhe um arquivo para ir junto com a mensagem. Depois de escolhido, mostra o nome do arquivo. |
| **Enviar** | Abaixo do campo de mensagem, à direita | Grava a mensagem na conversa. |
| **Cancelar tarefa** | Rodapé, em vermelho, para quem criou ou para administrador | Abre a confirmação do cancelamento. |
| **Sim, cancelar a tarefa** | Rodapé, na confirmação | Cancela a tarefa. |
| **Assumir** | Rodapé, com a tarefa Aberta | Passa a tarefa para **Em andamento** com você como responsável. |
| **Concluir** | Rodapé, com a tarefa Em andamento | Abre os campos da conclusão. |
| **Observação (opcional)** | Etapa de conclusão | Texto que fica registrado como "Observação da conclusão". |
| **Escolher arquivo** | Etapa de conclusão, campo **Anexo da conclusão (opcional)** | Escolhe um arquivo para subir ao concluir. |
| **Confirmar conclusão** | Rodapé, na etapa de conclusão | Conclui a tarefa. |
| **Voltar** | Rodapé, na etapa de conclusão e na confirmação do cancelamento | Volta ao detalhe sem mudar nada. |
| Ícone X (texto: "Fechar") | Canto superior direito da janela | Fecha a janela. |

### Em outras telas

| Nome na tela | Onde fica | O que faz |
|---|---|---|
| **Nova tarefa** | Quadro **Tarefas deste pedido**, na proposta | Abre **Nova tarefa** com pedido e cliente preenchidos. |
| **Tarefas** | Aba do chat da proposta, ao lado de **Conversa** | Mostra as tarefas daquele pedido, com o número das que estão em aberto, e o botão **Nova tarefa**. |
| **Nova tarefa** | Menu de ações da cobrança, na Conferência | Abre **Nova tarefa** com pedido, cliente e resumo da cobrança preenchidos. |
| **Nova tarefa** | Topo do cadastro do cliente | Abre **Nova tarefa** com o código do cliente preenchido. |

## Passo a passo

### Ver as tarefas e usar os filtros

1. Abra **Tarefas** no menu. A tela abre na aba **Minhas**, com o filtro **Em aberto**.
2. Escolha a aba:
   - **Minhas**: tarefas que você assumiu, tarefas em que você foi escolhido em **Para quem** e tarefas para todos que ainda estão sem responsável.
   - **Criadas por mim**: tarefas que você pediu a alguém.
   - **Todas** (só administrador): todas as tarefas da equipe.
   - **Melhorias** (só administrador): melhorias pedidas ao DEV.
3. Alterne entre **Em aberto** (situações Aberta e Em andamento) e **Encerradas** (Concluída e Cancelada).
4. Leia a linha da tarefa: selo de prioridade (**Alta** ou **Urgente**; a prioridade Normal não tem selo), título, situação, para quem está (por exemplo "Para Ana e Bruno", "Para todos" ou "Com Carlos", quando alguém já assumiu), quem pediu e quando, e o prazo, se houver.
5. Clique na linha para abrir a tarefa.

A lista mostra primeiro as tarefas de maior prioridade. Em **Em aberto**, dentro da mesma prioridade, as mais antigas vêm primeiro; em **Encerradas**, as mais recentes. A aba e o filtro ficam no endereço da página, então um link copiado abre na mesma visão.

### Criar uma tarefa

1. Clique em **Nova tarefa**.
2. Preencha **O que precisa ser feito** (obrigatório, até 200 caracteres).
3. Escolha a **Prioridade**: **Normal**, **Alta** ou **Urgente**.
4. Em **Para quem** (obrigatório), marque **Todos da equipe** ou escolha uma ou mais pessoas na lista. Use **Buscar pessoa** para achar pelo nome. Você pode escolher a si mesmo; seu nome aparece com "(eu)".
5. Se quiser, escreva os **Detalhes**.
6. Se a tarefa for sobre um pedido ou um cliente, informe o **Nº do pedido** e o **Código do cliente**. A tarefa passa a mostrar os botões **Pedido** e **Cliente**, que abrem a proposta e o cadastro.
7. Se quiser, informe o **Prazo** (uma data).
8. Se quiser, clique em **Escolher arquivos** para anexar PDF ou imagem, até 10 MB cada.
9. Clique em **Salvar**. Aparece o aviso "Tarefa criada", dizendo quem vai ver a tarefa no menu Tarefas.

O botão **Salvar** só fica disponível depois de preencher o título e escolher para quem é a tarefa.

### Criar uma tarefa a partir de um pedido, de uma cobrança ou de um cliente

1. Na proposta, use o botão **Nova tarefa** do quadro **Tarefas deste pedido**, ou abra o chat da proposta, vá na aba **Tarefas** e clique em **Nova tarefa**. O pedido e o cliente já vêm preenchidos.
2. Na Conferência, abra o menu de ações da cobrança e escolha **Nova tarefa**. O pedido, o cliente e um resumo da cobrança (tipo, valor, situação, vencimento e cliente) já vêm preenchidos nos detalhes.
3. No cadastro do cliente, clique em **Nova tarefa**. O código do cliente já vem preenchido.
4. Complete os demais campos e clique em **Salvar**.

O quadro **Tarefas deste pedido** lista as tarefas ligadas àquele pedido que você pode ver, com a contagem "em aberto de total". Clicar em uma delas abre a mesma janela de detalhe da tela Tarefas.

### Assumir uma tarefa

1. Na lista, clique em **Assumir** na linha da tarefa, ou abra a tarefa e clique em **Assumir**.
2. A situação muda para **Em andamento** e você passa a ser o **Responsável**. Quem pediu e os demais envolvidos são avisados.

Em tarefa enviada para várias pessoas ou para todos, quem assume primeiro fica com ela. Enquanto ninguém assume, a tarefa mostra "Ninguém assumiu ainda".

### Concluir uma tarefa

1. Com a tarefa **Em andamento**, clique em **Concluir** na linha ou dentro da tarefa.
2. Se quiser, escreva uma **Observação (opcional)** e escolha um **Anexo da conclusão (opcional)**.
3. Clique em **Confirmar conclusão**. Para desistir, clique em **Voltar**.

A tarefa vai para **Encerradas** com a situação **Concluída**, mostrando quem concluiu, a data e a observação.

### Conversar dentro da tarefa

1. Abra a tarefa clicando na linha.
2. Em **Responder sem mudar a situação**, escreva a mensagem (até 2.000 caracteres).
3. Se quiser, clique em **Anexar arquivo** para mandar um PDF ou imagem junto com a mensagem.
4. Clique em **Enviar**.

A mensagem aparece em **Histórico e conversa**, na ordem em que aconteceu, junto com os registros "Criada por", "Assumida por", "Concluída por" e "Cancelada por". Suas mensagens aparecem como "Você".

### Anexar e baixar arquivos

1. Abra a tarefa.
2. Em **Anexos**, clique em **Adicionar anexo** e escolha o arquivo. Aparece o aviso "Anexo enviado".
3. Para baixar qualquer anexo, clique em **Baixar** ao lado do arquivo.

Cada anexo mostra quem enviou e em que momento: na criação, durante a tarefa ou na conclusão. Os anexos enviados junto com uma mensagem aparecem dentro da própria mensagem.

### Cancelar uma tarefa

1. Abra a tarefa.
2. Clique em **Cancelar tarefa**.
3. Confirme em **Sim, cancelar a tarefa**. Para desistir, clique em **Voltar**.

A tarefa vai para **Encerradas** com a situação **Cancelada**.

### Acompanhar as novidades

1. Observe o item **Tarefas** no menu e o ícone de lista na barra do topo. O número é a quantidade das suas tarefas em aberto: as que você assumiu e as que recebeu e ainda estão sem responsável.
2. Quando o número ou o ícone piscam, há novidade em alguma tarefa que você ainda não abriu.
3. Na lista, a tarefa com novidade mostra um selo piscando: **Nova**, **Nova mensagem**, **Assumida**, **Concluída agora** ou **Cancelada agora**.
4. Abra a tarefa. Abrir já conta como visto: o selo some e o sinal para de piscar.

Com o sistema aberto, você também recebe um aviso na tela quando chega novidade: "Nova tarefa para você", "Nova tarefa para todos", "Nova mensagem na tarefa", "Tarefa assumida", "Tarefa concluída" ou "Tarefa cancelada". Clicar no aviso abre a tela Tarefas.

### Registrar uma melhoria (administradores)

1. Abra a aba **Melhorias**.
2. Clique em **Nova melhoria**.
3. Preencha **O que melhorar**, a **Prioridade** e, se quiser, **Detalhes**, pedido, cliente, **Prazo** e anexos.
4. Clique em **Salvar**. Aparece o aviso "Melhoria registrada".

A melhoria não tem **Para quem**: ela fica visível para a diretoria e os administradores, e qualquer um deles pode assumir.

### Consultar a Central de Pendências antiga

1. Digite o endereço `/pendencias` no navegador. A tela saiu do menu.
2. A tela abre com o título **Central de Pendências (antiga)** e o aviso "Esta tela ficou só para consulta."
3. Use a busca, as abas rápidas e os **Filtros Avançados** para encontrar a pendência. Os botões de chat e de abrir a proposta continuam funcionando.

Essa tela guarda as pendências de proposta do modelo anterior. Não dá mais para assumir, concluir ou cancelar por ali, e essas pendências não aparecem na tela Tarefas. Para qualquer pedido novo a um colega, use **Tarefas**.

## Regras e bloqueios

- Não dá para alterar uma tarefa depois de criada. Título, detalhes, prioridade, para quem, pedido, cliente e prazo ficam como foram salvos; só a situação muda. Se algo ficou errado, cancele e crie outra.
- Não dá para apagar uma tarefa. Ela só pode ser concluída ou cancelada, e o histórico fica guardado.
- Não dá para reabrir uma tarefa encerrada, nem devolver para **Aberta** uma tarefa já assumida.
- Não dá para trocar o responsável. Quem assumiu fica com a tarefa até concluir; um administrador pode concluir no lugar dele.
- Só assume a tarefa quem a recebeu (foi escolhido em **Para quem** ou participa das Tarefas, quando ela é para todos) ou um administrador.
- O botão **Concluir** só aparece com a tarefa **Em andamento**, para o responsável ou para um administrador. Por isso é preciso assumir antes de concluir.
- Só cancela a tarefa quem a criou ou um administrador, e apenas enquanto ela está **Aberta** ou **Em andamento**.
- Conversa e anexos só funcionam com a tarefa **Aberta** ou **Em andamento**. Depois de encerrada, aparece "Tarefa encerrada: a conversa ficou só para leitura." Os anexos continuam disponíveis para baixar.
- Ninguém edita nem apaga mensagem da conversa.
- Anexo aceita somente PDF ou imagem (PNG, JPG, WEBP, GIF), com até 10 MB por arquivo.
- O prazo é só uma data de referência. Quando passa e a tarefa ainda está em aberto, a data fica em vermelho com "(vencido)"; nada é bloqueado nem encerrado por causa disso.
- O pedido e o cliente informados precisam existir. Se não existirem, a tarefa não é criada.
- Quem recebe o sinal de novidade: quem recebeu a tarefa e ainda não abriu; e, a cada mensagem ou mudança de situação feita por outra pessoa, quem criou, o responsável, as pessoas escolhidas em **Para quem** e quem já escreveu na conversa. Em tarefa para **Todos da equipe**, as mensagens e mudanças avisam só quem criou, o responsável e quem já escreveu, para não piscar para a equipe inteira a cada mensagem. Você nunca é avisado da sua própria ação.
- Quando um pagamento combinado falha depois de o crédito já ter sido usado, o sistema cria sozinho uma tarefa de prioridade **Alta**, ligada ao pedido, com o título "Erro no pagamento combinado" (ou "Erro ao gerar ... do pagamento combinado"). Ela vai para os administradores do setor Financeiro; se não houver nenhum, vai para todos os administradores. Quem aparece como autor é o operador que disparou o pagamento.
- A lista mostra até 300 tarefas por visão.
- O sino da barra do topo é das menções no chat das propostas. Ele não mostra tarefas.

## O que não confundir

- **Tarefas** e **Central de Pendências (antiga)**: Tarefas é a central em uso, no menu; a Central de Pendências é a tela anterior, fora do menu, só para consulta, e o que está em uma não aparece na outra.
- **Tarefa** e **Melhoria**: a tarefa é um pedido a colegas, com **Para quem**; a melhoria é um pedido de ajuste do sistema ao DEV, sem destinatário, vista só por administradores.
- **Cancelar** e **Cancelar tarefa**: **Cancelar**, na janela **Nova tarefa**, só fecha a janela sem criar nada; **Cancelar tarefa**, no detalhe, encerra uma tarefa que já existe.
- **Aberta** e **Em aberto**: **Aberta** é a situação da tarefa que ninguém assumiu; **Em aberto** é o filtro, que junta as situações Aberta e Em andamento.
- **Para** e **Responsável**: **Para** é quem recebeu a tarefa; **Responsável** é quem assumiu. Enquanto ninguém assume, a tarefa tem destinatários e nenhum responsável.
- **Minhas** e **Criadas por mim**: **Minhas** é o que está com você ou chegou para você; **Criadas por mim** é o que você pediu aos outros. Uma tarefa que você criou para si mesmo aparece nas duas.
- **Número no menu** e **sinal piscando**: o número conta as suas tarefas em aberto; o piscar avisa que há novidade ainda não aberta. Pode haver número sem piscar e piscar sem número (por exemplo, quando concluem uma tarefa que você pediu).
- **Ícone de lista** e **sino**, na barra do topo: o ícone de lista é das tarefas; o sino é das menções no chat das propostas.
- **Conversa da tarefa** e **Conversa do chat da proposta**: a conversa da tarefa fica dentro da tarefa e é vista só por quem participa dela; a aba **Conversa** do chat é o chat interno da proposta.
- **Aba Tarefas do chat da proposta** e **tela Tarefas**: a aba do chat mostra só as tarefas ligadas àquele pedido; a tela Tarefas mostra as suas tarefas de qualquer pedido, e também as sem pedido.
- **Selo Nova** e **situação Aberta**: **Nova** some assim que você abre a tarefa; **Aberta** continua até alguém assumir.
- **Concluída agora** / **Cancelada agora** e **Concluída** / **Cancelada**: os selos com "agora" são o aviso de novidade e somem quando você abre a tarefa; **Concluída** e **Cancelada** são a situação, que fica.
- **Prazo** da tarefa e prazo de entrega do pedido: o prazo da tarefa é só a data combinada para aquele pedido de ajuda e não altera nada na proposta.
- **Pedido N** na linha da tarefa: é um atalho para a proposta; clicar nele não abre a tarefa.

## Erros comuns

| O que aparece | Por que acontece | O que fazer |
|---|---|---|
| O botão **Salvar** da nova tarefa fica apagado | Falta o título ou falta escolher para quem é a tarefa | Preencha **O que precisa ser feito** e marque **Todos da equipe** ou ao menos uma pessoa |
| "Seu usuário ainda não tem acesso para criar tarefas." | O seu perfil não tem a permissão **Participar das Tarefas**, ou a conta é de teste | Peça a um administrador para marcar a permissão no seu perfil |
| "Uma das pessoas escolhidas não é um usuário ativo da equipe." | A pessoa escolhida deixou de participar das Tarefas | Tire essa pessoa de **Para quem** e salve de novo |
| "Pedido não encontrado. Confira o número." | O número digitado em **Nº do pedido** não existe | Corrija o número ou deixe o campo vazio |
| "Cliente não encontrado. Confira o código." | O código digitado em **Código do cliente** não existe | Corrija o código ou deixe o campo vazio |
| "...: só PDF ou imagem (PNG, JPG, WEBP, GIF)." | O arquivo escolhido é de outro tipo | Converta para PDF ou imagem e anexe de novo |
| "... passa de 10 MB." | O arquivo é maior que o limite | Reduza o arquivo ou divida em partes menores |
| "Tarefa criada, mas há anexo que não subiu" | A tarefa foi salva, mas o envio de um arquivo falhou | Abra a tarefa e use **Adicionar anexo** |
| "Mensagem enviada, mas o anexo não subiu: ..." | A mensagem foi gravada, mas o arquivo falhou | Envie o arquivo de novo por **Adicionar anexo** ou em outra mensagem |
| "Esta tarefa já foi assumida." | Outra pessoa assumiu antes de você | Nada a fazer; a tarefa já tem responsável. Se precisar, escreva na conversa |
| "Só quem recebeu a tarefa ou um administrador pode assumi-la." | Você vê a tarefa (por exemplo, porque a criou), mas não está entre as pessoas que a receberam | Peça a quem recebeu ou a um administrador |
| "Só quem assumiu a tarefa ou um administrador pode concluí-la." | A tarefa está com outro responsável | Fale com o responsável pela conversa, ou peça a um administrador |
| "Só quem criou a tarefa ou um administrador pode cancelá-la." | Você não criou a tarefa | Peça a quem criou ou a um administrador |
| "Esta tarefa já foi encerrada." | A tarefa foi concluída ou cancelada por outra pessoa enquanto você estava com ela aberta | Feche a janela; a tarefa agora está em **Encerradas** |
| "Tarefa encerrada: a conversa ficou só para leitura." | A tarefa já foi concluída ou cancelada | Se o assunto continua, crie uma nova tarefa |
| "Tarefa não encontrada ou sem acesso." | A tarefa não existe ou você não está entre as pessoas que podem vê-la | Confira com quem criou a tarefa |
| "Anexos indisponíveis no momento." | O serviço de arquivos não respondeu | Tente mais tarde; se continuar, avise o administrador do sistema |
| "Sua sessão expirou. Entre novamente para continuar." | O login venceu | Entre de novo e repita a ação |
| "Falha de conexão. Tente de novo." | A internet caiu no meio da ação | Confira a conexão e repita |
| Não vejo as abas **Todas** e **Melhorias** | Elas são exclusivas de administradores | Use **Minhas** e **Criadas por mim** |
| Uma tarefa para todos não aparece para mim | O seu perfil não participa das Tarefas | Peça a um administrador para marcar **Participar das Tarefas** no seu perfil |

## Veja também

- [Proposta: visão geral e abas](proposta.md)
- [Pedidos (lista)](pedidos.md)
- [Conferência](conferencia.md)
- [Proposta: aba Pagamentos](proposta-pagamentos.md)
- [Manual do Vibe (índice)](README.md)

## Arquivos de origem

Arquivos de código de onde esta ficha saiu. O `scripts/checar-manual.mjs` lê esta lista: quando um deles muda e a ficha não, ele avisa.

- `src/features/tarefas/`
- `src/app/(erp)/tarefas/page.tsx`
- `src/app/api/tarefas/`
- `src/app/(erp)/pendencias/page.tsx`
- `src/components/app-shell/ContadorMenu.tsx`
- `src/components/app-shell/Topbar.tsx`
- `src/constants/navigation.ts`
- `src/features/orcamentos/components/PropostaChatDrawer.tsx`
- `src/features/cobrancas/CobrancaActionsMenu.tsx`
- `src/features/cadastros/CadastroDetailPage.tsx`
- `src/app/api/cobrancas/pagamento-combinado/route.ts`
- `src/features/usuarios-perfis/catalogo-permissoes.ts`
