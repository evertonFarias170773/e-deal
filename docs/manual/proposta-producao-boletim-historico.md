# Proposta: abas Produção / Expedição, Boletim e Histórico

> **Última revisão:** 09/10/2026
> **Caminho no menu:** Pedidos → abrir um pedido → Editar proposta → aba Produção / Expedição ou aba Histórico. Não existe aba Boletim na barra de abas: a OS (boletim) abre pelo menu Produção → clicar no pedido.
> **Endereço:** `/orcamentos/[número]/editar?tab=producao` e `/orcamentos/[número]/editar?tab=historico`. A aba se chamava **Produção** até 09/10/2026; só o nome mudou, o endereço `?tab=producao` é o mesmo. A OS fica em `/pedidos/boletim?id_int=[número]&modo=edicao`.

## Para que serve

A aba **Produção / Expedição** guarda a orientação técnica do pedido: o que a bancada precisa saber para fabricar. A aba **Histórico** mostra tudo o que aconteceu com o pedido (mensagens da equipe, registros automáticos do sistema e os movimentos de crédito).

Esta página explica também como o pedido sai do atendimento e entra na fábrica: a liberação para a produção, a passagem de REVISAO ATENDENTE para REVISAO PRODUCAO e a OS (boletim), onde ficam a data e a hora de entrega e a impressão.

## Quem acessa

- Quem abre a edição do pedido vê as abas **Produção / Expedição** e **Histórico**. A aba Produção / Expedição aparece também em proposta avulsa e em pedido só de prateleira.
- **Liberar para Produção** fica na lista de Pedidos e aparece só para Administrador, Super Administrador ou quem tem a permissão **Liberar para Produção** no perfil, quando o pedido está em REVISAO ATENDENTE. O servidor confere a mesma permissão e, depois, pagamento, arte e modelos. A liberação automática de pedido só de prateleira, que acontece quando o pagamento é confirmado, não depende dessa permissão.
- **Retirar da Produção** aparece só para Administrador, Super Administrador ou quem tem a permissão **Liberar para Produção** no perfil. O servidor confere a mesma permissão antes de retirar.
- **Voltar para Revisão Atendente** (tela Produção) aparece só para Administrador, Super Administrador ou quem tem a permissão **Ações Administrativas de OS**.
- A OS (boletim) abre para quem tem a permissão **Visualizar Pedidos e OS**.
- **Data Limite de Entrega** e **Hora do Prazo**, em OS que já existe, só são alteradas por Administrador, Super Administrador ou quem tem a permissão **Editar Datas de Entrega**.
- **Imprimir OS** aparece para Administrador, Super Administrador ou quem tem a permissão **Imprimir OS (PDF de produção)**, e só em pedido já liberado para a produção.

## Botões e ações da tela

Nomes exatamente como aparecem na tela.

| Nome na tela | Onde fica | O que faz |
|---|---|---|
| **Produção / Expedição** | Barra de abas do pedido, entre **Artes** e **Pagamentos** | Abre a aba com o campo **Orientação técnica de produção**. |
| **Histórico** | Barra de abas do pedido, última aba | Abre a **Timeline da proposta** e os movimentos de crédito. |
| **Salvar alterações** | Barra fixa no rodapé do pedido | Grava a orientação técnica junto com o resto do pedido. |
| Ícone de clipe (dica "Anexar arquivo (até 10MB)") | Aba Histórico, rodapé da timeline | Escolhe arquivos para enviar com a mensagem. |
| Ícone de enviar (dica "Enviar mensagem") | Aba Histórico, rodapé da timeline | Envia a mensagem e os anexos. |
| **Ver chat interno** | Menu de ações do cabeçalho do pedido | Abre o mesmo chat da timeline em um painel lateral. |
| **Retirar da Produção** | Menu de ações do cabeçalho do pedido e fim do menu **Ações** da lista de Pedidos, em pedido liberado | Tira o pedido da fila da produção. |
| **Liberar para Produção** | Lista de Pedidos, menu **Ações** da linha, em pedido em REVISAO ATENDENTE | Abre a janela **Liberar proposta para Produção?**. |
| **Confirmar liberação** | Janela **Liberar proposta para Produção?** | Faz as conferências e libera o pedido. Enquanto processa, mostra "Liberando...". |
| **Cancelar** | Janela **Liberar proposta para Produção?** | Fecha a janela sem liberar. |
| **✓ Liberada para produção** | Lista de Pedidos, menu **Ações**, em pedido já liberado | Não é clicável. Só mostra que a liberação já foi feita. |
| **Editar OS / Boletim** / **Criar OS / Boletim** | Tela Produção, menu **Ações** da linha | Abre a OS do pedido. Clicar na linha faz o mesmo. |
| **Imprimir OS (PDF)** / **Imprimir OS reduzida (PDF)** | Tela Produção, menu **Ações** da linha | Gera o PDF da OS, completo ou reduzido. |
| **Voltar para Revisão Atendente** | Tela Produção, menu **Ações** da linha | Abre a janela **Devolver proposta para Revisão?**. |
| **Confirmar devolução** | Janela **Devolver proposta para Revisão?** | Devolve o pedido para REVISAO ATENDENTE e o tira da produção. |
| Abas de setor (PVC, LASER, FLEXO, TEXTIL...) | OS, dentro do **BLOCO 1 — Identificação Comercial** | Abre o boletim daquele setor. A etiqueta **a abrir** marca setor ainda sem boletim. |
| **Imprimir OS · [setor]** | Cabeçalho da OS | Abre o PDF da OS do setor aberto em nova aba. |
| **Baixar todos (N)** | Cabeçalho da OS, quando o pedido tem mais de um boletim | Baixa um PDF por setor. |
| **PDF reduzido** | Cabeçalho da OS | Menu com **PDF reduzido da OS · [setor]** e **Baixar todos reduzidos (N)**. |
| **Salvar Alterações** / **Salvar Boletim** | Cabeçalho da OS e botão verde flutuante | Grava a OS. O nome é **Salvar Boletim** quando a OS ainda está sendo aberta. |
| **Voltar** | Cabeçalho da OS | Volta para a tela Produção. |
| **Abrir para imprimir** / **Abrir os N setores** | Janela **Abrir para imprimir?** (ou **Reimprimir o boletim?**), depois de salvar a OS | Abre o documento pronto para imprimir, um setor por página. |
| **Abrir só [setor]** | Janela **Reimprimir o boletim?** | Abre só o setor que acabou de ser editado. |
| **Agora não** | Mesma janela | Fecha sem imprimir e volta para a tela Produção. O boletim já está salvo. |

## Passo a passo

### Escrever a orientação técnica (aba Produção / Expedição)

1. Abra o pedido e clique na aba **Produção / Expedição**.
2. No campo **Orientação técnica de produção**, escreva o que a bancada precisa saber. Exemplo da própria tela: "pulseira de pino sem o pino; entregar em bobina de 100; conferir a cor contra a amostra aprovada...".
3. Clique em **Salvar alterações**.

É um campo só por pedido. O mesmo texto aparece na OS, em **BLOCO 2 — Orientação Técnica de Produção**, onde a produção pode revisá-lo, e sai por inteiro nos dois PDFs da OS.

### Saber quando o pedido chega em REVISAO ATENDENTE

O pedido passa sozinho para **REVISAO ATENDENTE** quando duas coisas estão resolvidas:

1. O pagamento confirmado cobre o valor total do pedido.
2. A arte de todos os modelos está aprovada. Em pedido só com produtos de prateleira a arte é dispensada, e basta o pagamento.

REVISAO ATENDENTE é a conferência final de quem atende: cliente, produtos, quantidades, modelos, numeração, orientação técnica e frete.

### Liberar o pedido para a produção

1. Vá para a lista de Pedidos (menu **Pedidos**).
2. Na linha do pedido, abra o menu **Ações** e clique em **Liberar para Produção**. O item só aparece em pedido em REVISAO ATENDENTE, que não seja avulso e ainda não tenha sido liberado.
3. Leia a janela **Liberar proposta para Produção?** e clique em **Confirmar liberação**.
4. O sistema confere, nesta ordem: o status (REVISAO ATENDENTE), os pagamentos, a arte e a soma dos modelos de cada produto.
5. Se tudo passar, aparece "Proposta liberada" e o pedido muda para **REVISAO PRODUCAO**. Ele entra na tela Produção, em destaque no topo da lista, e fica habilitado para a fila de faturamento.
6. Se algo barrar, aparece "Erro de Validação" com o motivo. Veja "Erros comuns".

Pedido só com produtos de prateleira pode ser liberado pelo próprio sistema, no momento em que é confirmado o pagamento que o cobre por inteiro. As conferências são as mesmas.

### Passar de REVISAO PRODUCAO para EM PRODUCAO

1. Na tela Produção (menu **Produção**), clique na linha do pedido para abrir a OS.
2. Confira a **Data Limite de Entrega**, a **Hora do Prazo**, a orientação técnica e os produtos de cada aba de setor.
3. Clique em **Salvar Alterações** (ou **Salvar Boletim**, na primeira abertura).
4. Ao salvar, o pedido que estava em REVISAO PRODUCAO passa sozinho para **EM PRODUCAO**. A mudança fica registrada no Histórico.

### Conferir ou mudar a data e a hora de entrega (OS)

1. Abra a OS pela tela Produção.
2. Os campos **Data Limite de Entrega \*** e **Hora do Prazo** ficam no quadro azul do **BLOCO 1 — Identificação Comercial**, logo abaixo das abas de setor.
3. Na abertura da OS a data vem calculada: conta a partir do dia em que o pedido foi liberado para a produção, somando o maior prazo em dias úteis entre os produtos do pedido (sábado, domingo e feriado não contam). Se nenhum produto tem prazo cadastrado, o campo vem vazio e precisa ser preenchido.
4. Cada setor tem o seu boletim, com o seu prazo e a sua hora. Clicar em outra aba de setor mostra o prazo daquele setor.
5. Para alterar, mude a data ou a hora e clique em **Salvar Alterações**. Sem a permissão de editar data, os dois campos aparecem travados, com o aviso do motivo.

### Imprimir a OS

1. Depois de salvar a OS, o sistema pergunta **Abrir para imprimir?**. Clique em **Abrir para imprimir** (ou **Abrir os N setores**, quando há mais de um setor). O documento abre em nova aba.
2. Se o pedido já foi impresso antes, a pergunta vira **Reimprimir o boletim?** e ganha a opção **Abrir só [setor]**.
3. **Agora não** fecha a janela. O boletim já está salvo.
4. A qualquer momento, use **Imprimir OS · [setor]** no cabeçalho da OS, ou **Imprimir OS (PDF)** no menu **Ações** da tela Produção. O aviso "Gerando o PDF na nova aba" indica que o arquivo está sendo montado.
5. Para a versão reduzida, use **PDF reduzido** (na OS) ou **Imprimir OS reduzida (PDF)** (na tela Produção).

### Tirar um pedido da produção

1. **Retirar da Produção** (menu de ações do pedido ou da lista de Pedidos): tira o pedido da fila da produção e **não muda o status** dele. Confirme a pergunta.
2. **Voltar para Revisão Atendente** (tela Produção, menu **Ações**): tira o pedido da produção e volta o status para REVISAO ATENDENTE. Depois é preciso liberar de novo.

### Ler o histórico (aba Histórico)

1. Abra o pedido e clique na aba **Histórico**.
2. O primeiro quadro é a **Timeline da proposta**. Ela mistura, em ordem de data:
   - mensagens escritas pela equipe, com o nome de quem escreveu, o setor e a data e hora;
   - registros automáticos, em uma faixa centralizada com o rótulo **Sistema**, **Financeiro** ou **Produção**, a data e a hora, e a origem (quem fez e em que frente).
3. Abaixo fica **Auditoria e Movimentos de Crédito**, com as colunas **Data**, **Tipo do Fluxo**, **Valor**, **Origem**, **Observação / Justificativa** e **Status / Auditoria**. Sem movimentos, aparece "Nenhum movimento financeiro registrado".

O que a timeline registra: as cobranças criadas para o pedido (com o usuário que criou), as mudanças automáticas de status (por exemplo, de REVISAO PRODUCAO para EM PRODUCAO ao salvar a OS), a troca do cliente do pedido e as mensagens e anexos enviados pela equipe.

O que a tabela de movimentos mostra em **Tipo do Fluxo**: **Pendência Aberta**, **Crédito Utilizado**, **Débito Recebido**, **Devolução**, **Bonificação**, **Baixa de Débito**, **Pendência Cancelada**, **Estorno** e **Crédito Gerado**. Movimento cancelado aparece riscado, com o selo **CANCELADO**, quem cancelou e quando; os demais mostram **ATIVO**.

### Escrever no histórico

1. No rodapé da timeline, escreva no campo "Escreva uma mensagem interna (Shift + Enter para pular linha)...".
2. Para avisar alguém, digite @ e escolha a pessoa na lista.
3. Para anexar, clique no clipe. Entram imagens, PDF, Word, Excel, ZIP, RAR e texto, com até 10 MB cada.
4. Clique no botão de enviar.

As mensagens são internas: o cliente não vê.

## Regras e bloqueios

- Não dá para liberar para a produção um pedido que não esteja em REVISAO ATENDENTE. Proposta avulsa não vai para a produção.
- Não dá para liberar enquanto houver pagamento ativo não confirmado, nem sem nenhum pagamento confirmado. Pagamento cancelado não conta.
- Não dá para liberar enquanto o status da arte do pedido não for APROVADO.
- Não dá para liberar enquanto a quantidade de algum produto for diferente da soma dos modelos dele. Produto sem nenhum modelo também barra, inclusive produto de prateleira. Produto removido do pedido não é conferido.
- As conferências da liberação rodam no servidor. Não há como pular nenhuma pela tela.
- A liberação automática de pedido de prateleira passa pelas mesmas conferências. Se for recusada, o pedido fica em REVISAO ATENDENTE e a liberação é feita pelo botão, depois de acertar o que faltou.
- Liberar de novo um pedido que voltou atualiza a data de liberação. O prazo de entrega calculado na OS conta a partir dessa data.
- Não dá para salvar a OS sem a **Data Limite de Entrega**.
- Em OS que já existe, a data e a hora de entrega só mudam com a permissão **Editar Datas de Entrega**. Elas são a promessa feita ao cliente. A trava vale também fora da tela: o sistema recusa a alteração de quem não tem a permissão.
- Na OS que já existe, cliente, quantidades e especificações dos modelos ficam travados. O que se altera lá é a orientação técnica, as observações e, para quem pode, a data e a hora.
- **Imprimir OS** só aparece em pedido liberado para a produção.
- Não dá para ver o histórico de pedido que ainda não foi salvo: a aba mostra "Salve a proposta para visualizar o histórico.".
- O status do pedido que já está na produção não é mais alterado por pagamento ou por arte. De REVISAO ATENDENTE em diante, ele só anda pelas ações da produção e da expedição.

## O que não confundir

- Menu **Produção** e aba **Produção / Expedição** são coisas diferentes. O menu é a tela da fábrica, com as OS; a aba, dentro do pedido, tem só o campo de orientação técnica.
- Não existe aba **Boletim** no pedido. O endereço com `tab=boletim` mostra só "Boletim — Aguarde orientações.". O boletim de verdade é a OS, que abre pela tela Produção.
- **Boletim Técnico & Lotes** é o título da aba **Pedido** (a divisão em modelos). Não é o boletim da OS.
- **Orientação técnica de produção** (aba Produção / Expedição) não é **Observações e Condições** (aba Geral). A primeira vai para a OS impressa; a segunda é comercial e não chega à produção.
- **REVISAO ATENDENTE** e **REVISAO PRODUCAO** são etapas seguidas, de pessoas diferentes. Na primeira, o atendente confere e libera; na segunda, a produção confere a OS e, ao salvá-la, o pedido vira EM PRODUCAO.
- **Liberar para Produção** não é **LIBERADO**. LIBERADO é o status de pedido pago, ainda no atendimento; a liberação para a produção é a ação que leva o pedido de REVISAO ATENDENTE para REVISAO PRODUCAO.
- **Retirar da Produção** não é **Voltar para Revisão Atendente**. Retirar só tira da fila e mantém o status; voltar para revisão tira da fila e devolve o status para REVISAO ATENDENTE.
- **Retirar da Produção** não desfaz um engano de liberação recém-feita: é a ação oposta. Depois de liberar, o menu mostra **✓ Liberada para produção**.
- **Data Limite de Entrega** (OS) não é **Data do Evento** (briefing da aba Artes). A primeira é o prazo da fábrica; a segunda é o dia da festa.
- **Salvar alterações** (pedido) e **Salvar Alterações** (OS) são botões de telas diferentes. O da OS é o que move o pedido para EM PRODUCAO.
- **Timeline da proposta** (aba Histórico) e **Ver chat interno** mostram as mesmas mensagens. Não são dois históricos.
- A tabela **Auditoria e Movimentos de Crédito** não é a lista de cobranças do pedido. Ela mostra só os movimentos de crédito e débito do cliente gerados por este pedido; as cobranças ficam na aba **Pagamentos**.
- A aba **Revisão** da OS não está disponível na tela. A saída do pedido para a expedição é feita pela tela Expedição.

## Erros comuns

| O que aparece | Por que acontece | O que fazer |
|---|---|---|
| "Status precisa ser REVISAO ATENDENTE." | O pedido mudou de status antes de você confirmar a liberação. | Atualize a lista e confira o status. |
| "Pendências financeiras. Todos os pagamentos ativos precisam estar confirmados (Paid/A Vencer) e deve haver pelo menos um." | Há cobrança ativa ainda não confirmada, ou nenhuma cobrança confirmada. | Confirme o pagamento na Conferência ou cancele a cobrança que sobrou, e libere de novo. |
| "Pendências de arte. Todas as artes devem estar com status APROVADO." | O status da arte do pedido não é APROVADO. | Aguarde a aprovação da arte. Veja a aba **Artes**. |
| "A quantidade vendida não bate com a soma dos lotes. Acerte os lotes antes de liberar para produção:" seguido de "Produto X: vendido N, lotes somam M" | A quantidade de um produto é diferente da soma dos modelos, ou o produto não tem modelo. | Acerte os modelos na aba **Pedido** e grave. |
| "Proposta já está liberada para produção." | Outra pessoa (ou o sistema) já liberou. | Nada a fazer. O pedido já está na produção. |
| "Propostas avulsas não vão para produção." | O pedido é avulso. | Nada a fazer. |
| **Liberar para Produção** não aparece no menu | O pedido não está em REVISAO ATENDENTE, é avulso ou já foi liberado, ou o seu perfil não tem a permissão **Liberar para Produção**. | Confira o status. Se faltar pagamento ou arte, resolva antes. Se for permissão, peça a quem tem. |
| "Sem permissão para liberar para produção (propostas.release_producao)." | Seu perfil não tem a permissão **Liberar para Produção**. | Peça a liberação a quem tem a permissão. |
| "Data e hora de entrega só podem ser alteradas por um administrador. ..." | A OS já existe e o seu perfil não tem a permissão de editar data. | Peça a um administrador para ajustar, ou para incluir a permissão **Editar Datas de Entrega** no seu perfil. |
| "Formulário Incompleto" — "A data de entrega prevista é obrigatória." | A OS foi salva sem a **Data Limite de Entrega**. | Preencha a data e salve. |
| "Erro ao gerar PDF da OS" | O PDF não pôde ser gerado; o motivo vem no aviso. | Leia o motivo. Confira se o pedido está liberado para a produção e tente de novo. |
| "O navegador bloqueou a aba" | O navegador barrou a abertura do PDF. | Clique em **Abrir o documento em nova aba**, na própria janela, ou libere os pop-ups para o sistema. |
| O botão **Imprimir OS** não aparece | O pedido não está liberado para a produção, ou falta a permissão de imprimir. | Confira a liberação e a permissão **Imprimir OS (PDF de produção)**. |
| "Salve a proposta para visualizar o histórico." | O pedido ainda não foi salvo. | Salve o pedido. |
| "Arquivo muito grande" — "O arquivo "..." excede o limite de 10MB." | O anexo do chat passa de 10 MB. | Reduza o arquivo. |
| "Tipo não suportado" — "O tipo de "..." não é permitido no chat." | O tipo do arquivo não é aceito no chat. | Envie em PDF, imagem, Word, Excel, ZIP, RAR ou texto. |
| "Boletim — Aguarde orientações." | O endereço foi aberto com `tab=boletim`, que não tem conteúdo. | Abra a OS pela tela Produção. |

## Veja também

- [Proposta: visão geral e abas](proposta.md)
- [Proposta: aba Geral](proposta-geral.md)
- [Proposta: aba Pagamentos](proposta-pagamentos.md)
- [Proposta: aba Artes](proposta-artes.md)
- [Proposta: aba Pedido (Boletim Técnico & Lotes)](proposta-pedido.md)
- [Pedidos (lista)](pedidos.md)
- [Produção (ordens de serviço)](producao.md)
- [Expedição](expedicao.md)
- [Conferência](conferencia.md)

## Arquivos de origem

- `src/features/orcamentos/OrcamentoFormPage.tsx`
- `src/features/orcamentos/OrcamentosListPageReal.tsx`
- `src/features/orcamentos/components/LiberarProducaoModal.tsx`
- `src/features/orcamentos/components/PropostaChatPanel.tsx`
- `src/features/orcamentos/services/orcamentos.service.ts`
- `src/features/orcamentos/services/status-engine.service.ts`
- `src/features/orcamentos/lib/divergencia-lotes.ts`
- `src/app/api/orcamentos/liberar-producao/route.ts`
- `src/features/pedidos/BoletimFormPage.tsx`
- `src/features/pedidos/PedidosListPage.tsx`
- `src/features/pedidos/prazo-producao.ts`
- `src/features/pedidos/components/GerarPdfBoletimModal.tsx`
- `src/features/pedidos/components/DevolverRevisaoModal.tsx`
- `src/features/pedidos/services/boletim-propostas.service.ts`
- `src/features/usuarios-perfis/catalogo-permissoes.ts`
- `src/app/api/orcamentos/retirar-producao/route.ts`
