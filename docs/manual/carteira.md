# Carteira (contas a receber)

> **Última revisão:** 01/10/2026
> **Onde fica:** menu Financeiro → Carteira (endereço `/contas-a-receber`)

## Para que serve

A Carteira reúne todos os títulos a receber: boletos e depósitos em conta que nasceram de um pedido faturado. Aqui o financeiro acompanha o que está a vencer, vencido, pago e cancelado, registra o boleto no banco, dá baixa quando o cliente paga por fora do boleto, prorroga vencimento e cancela título.

A tela abre com o título **Contas a receber**. Os títulos entram nela pelo [Registro de recebíveis](registro-de-recebiveis.md) (botão **Gerar títulos**) ou pelo lançamento a partir de uma nota fiscal.

## Quem acessa

- Vê a tela quem tem a permissão **Visualizar Títulos** no perfil, além de Administrador e Super Admin. Sem ela, a tela mostra acesso negado.
- **Confirmar recebimento** (dar baixa) aparece só para quem tem a permissão **Registrar Baixa**, Administrador ou Super Admin.
- **Cancelar recebível**, **Cancelar boleto**, **Prorrogar vencimento**, **Refazer boleto**, **Registrar boleto**, **Editar depósito** e **Transformar em boleto** aparecem só para quem tem a permissão **Administrar Contas a Receber**, Administrador ou Super Admin.
- As demais ações do menu (**Detalhe da Cobrança**, **Cadastro do Cliente**, **Registrar boleto no banco** / **Ver boleto registrado**, **Consultar pagamento C6**, **Consultar PDF no C6**, **Visualizar Boleto** / **Gerar PDF do Boleto**) aparecem para todos que veem a tela.
- Cancelar um boleto que já está registrado no banco também exige, do lado do servidor, a permissão de cancelar cobrança. Quem não a tem recebe o aviso "Sem permissão para cancelar título".

## Passo a passo

### Entender a tela

**Cartões do topo**

| Cartão | O que soma |
|---|---|
| **Cobranças Vencidas** | Todos os títulos vencidos, sem olhar os períodos de vencimento e de emissão. Clicar lista todos eles. |
| **Cobranças a Receber** | Todos os títulos a vencer, sem olhar os períodos. Clicar lista todos eles. |
| **Pagos** | Os títulos pagos dentro do período filtrado. |

Os três cartões respeitam a busca, a empresa e o status escolhidos. Nas abas **Boletos** e **Depósitos**, somam só os títulos daquele tipo.

**Filtros**

- **Busca**: por cliente, número da proposta, número do pagamento, NF/OS, CPF/CNPJ ou referência do título.
- **Empresa**: **Todas as empresas** ou uma delas.
- **Status**: **Todos status**, **Previsão futura / E-Faturado (A Vencer)**, **Vencidos**, **Pagos**, **Cancelados** e **Boletos não registrados** (boletos que ainda não têm registro completo no banco).
- **Emissão**: data inicial e final em que o título foi criado. Começa vazio.
- **Vencimento** (ao lado das abas): data inicial e final do vencimento. Começa no mês corrente.
- **Limpar filtros**: volta tudo ao padrão (mês corrente no vencimento), sem trocar de aba.

Os filtros ficam no endereço da página: sobrevivem a atualizar a tela e podem ser enviados por link.

**Abas**

| Aba | O que mostra |
|---|---|
| **Carteira** | Todos os títulos, boletos e depósitos juntos. |
| **Boletos** | Só os boletos. É onde ficam **Prorrogar vencimento** e **Cancelar boleto**. |
| **Depósitos** | Só os depósitos em conta. É onde ficam **Editar depósito** e **Transformar em boleto**. |
| **Cartões a receber** | Ainda não está em uso. Mostra "Cartões a receber ficará disponível em uma fase futura." |
| **Previsão de recebimento** | Resumo do que está a vencer: **Semana atual**, **Quinzena**, **Até 30 dias**, **Até 90 dias**, **Recebidos x a vencer**, **Por empresa** e **Boletos e depósitos**. Não tem ações. |

Nas três primeiras abas os títulos aparecem em quatro grupos, cada um com a quantidade e o **Total**: **Vencidos**, **Previsão futura / E-Faturado**, **Pagos** e **Cancelados**.

**Colunas**

| Coluna | Significado |
|---|---|
| **N°** | Número do pagamento (a cobrança que originou o título). |
| **N° / OS** | Número da proposta e, abaixo, a nota fiscal ou a referência do título. |
| **Parc.** | Parcela e total de parcelas, por exemplo 2/3 (abas Boletos e Depósitos). |
| **Cliente** | Nome do cliente e, na aba Carteira, o CPF/CNPJ. |
| **Empresa** | Empresa que recebe. |
| **Tipo** | **Boleto** ou **Depósito futuro**. |
| **Status** | Situação do título (tabela abaixo). |
| **Dt. Pagto** | Data do pagamento. Só aparece no grupo **Pagos**. |
| **Total** | Valor do título, já atualizado quando houver valor atualizado. |
| **Emissão** | Data em que o título foi criado. |
| **Venc.** | Data de vencimento. |
| **Conf.** | **Confirmado** quando o título foi pago ou baixado por alguém; **Não confirmado** nos demais (aba Carteira). |
| **Linha/Ref.** | Linha digitável do boleto (abas Boletos e Depósitos). |
| **Ações** | Botão **Registrar** (quando o boleto ainda não foi ao banco) e o menu de ações. |

**Status**

| Status | Significado |
|---|---|
| **A receber criado — boleto não registrado** | O título existe, mas o boleto ainda não foi registrado no banco. O cliente não tem como pagar por boleto. |
| **Boleto registrado** | Boleto registrado no banco e a vencer. |
| **Depósito em conta** | Título sem boleto: o cliente paga por depósito, PIX ou outra forma, e a baixa é manual. |
| **Vencido** | Passou do vencimento sem pagamento. |
| **Pago** | Título liquidado. |
| **Cancelado** | Título cancelado. Fica na lista como histórico. Com **Substituído** embaixo, é o boleto antigo de um **Refazer boleto**: a parcela continua ativa em outra linha, com o boleto novo. |

### Registrar o boleto no banco

1. Localize o título com status **A receber criado — boleto não registrado** e clique em **Registrar** (ou, no menu de ações, **Registrar boleto no banco**).
2. Abre a janela **Revisar para Geração Bancária**, com todas as parcelas da mesma proposta.
3. Se aparecer o quadro **Dados Cadastrais Incompletos / Inválidos**, clique em **Editar Cadastro do Cliente**, corrija o que está listado e volte para clicar em **Re-validar Cadastro**.
4. Se aparecer o quadro **E-mail de Cliente Ausente**, confira o **E-mail para envio** e marque **Confirmo o uso deste e-mail para o registro bancário.**
5. Ajuste, se precisar, **Valor**, **Vencimento**, **Descrição**, **Multa (%)** e **Juros/Dia (%)** da parcela.
6. Clique em **Registrar boleto** na parcela e confirme em **Confirmar Registro Bancário**. Para registrar todas de uma vez, use **Registrar todos os boletos desta proposta** (aparece quando há duas ou mais parcelas prontas).
7. A parcela passa a mostrar **Boleto Registrado**, com **Nosso Número**, **Linha Digitável** e os botões **Visualizar PDF**, **Copiar Linha Digitável** e **Copiar Link**.

Para só gravar os ajustes sem registrar no banco, clique em **Salvar Alterações**.

### Abrir a segunda via do boleto

1. No menu de ações do título, clique em **Visualizar Boleto**. O PDF abre em outra aba.
2. Se a opção for **Gerar PDF do Boleto**, o PDF ainda não existe: clique para gerar. Ele abre sozinho ao terminar; se o navegador bloquear, clique no aviso "PDF gerado!" para abrir.
3. Se aparecer **Consultar PDF no C6**, use para buscar o PDF direto no banco.
4. Para copiar a linha digitável ou o link do PDF, abra **Ver boleto registrado** e use **Copiar Linha Digitável** ou **Copiar Link** na parcela. A linha digitável também aparece em **Detalhe da Cobrança**.

### Dar baixa em um título pago por fora do boleto

Use quando o cliente pagou por PIX, dinheiro, cartão ou depósito, e não pelo boleto.

1. No menu de ações, clique em **Confirmar recebimento**.
2. Escolha a **Forma de recebimento**: **PIX**, **Cartão**, **Dinheiro**, **Bonificado** ou **Outros**.
3. Preencha a **Observação**. Ela é obrigatória quando a forma é **Outros**.
4. Clique em **Confirmar recebimento**.

Se o boleto estiver registrado no banco, o sistema primeiro cancela o boleto no banco e só depois marca o título como pago. Isso evita que o cliente pague duas vezes.

### Dar baixa em um boleto pago no banco

1. No menu de ações, clique em **Consultar pagamento C6**.
2. Confira os dados e clique em **Consultar no C6**.
3. Se o banco confirmar o pagamento, aparece "Pagamento encontrado no C6!" com o **Valor Pago** e a **Data do Pagamento**. Clique em **Sim, atualizar recebível**.

O título fica **Pago** com a data oficial do banco.

### Prorrogar o vencimento de um boleto

1. Vá para a aba **Boletos**.
2. No menu de ações, clique em **Prorrogar vencimento**.
3. Informe a **Nova data de vencimento** e, se quiser, o **Motivo**.
4. Clique em **Prorrogar vencimento**.

O boleto atual é cancelado no banco e fica na lista como **Cancelado**. No lugar nasce um título novo, da mesma parcela, com o novo vencimento, já registrado no banco. Valor, cliente, proposta, descrição, multa e juros são mantidos. Envie o boleto novo ao cliente.

### Cancelar um título

Existem dois cancelamentos diferentes. Escolha pelo resultado que você quer. Para trocar só o boleto, sem cancelar nada, veja "Refazer o boleto de uma única parcela".

**Cancelar o título por inteiro (Cancelar recebível)**

1. Na aba **Carteira**, abra o menu de ações e clique em **Cancelar recebível**. Para depósito, a mesma opção existe na aba **Depósitos**.
2. Leia o aviso da janela e clique em **Confirmar cancelamento**.

Se o boleto estiver registrado, ele é cancelado no banco primeiro; se o banco falhar, nada muda. Depois o título fica **Cancelado**. Nos títulos da Ideal Birô (Banco Inter), o título sai da lista em vez de ficar como cancelado. A cobrança que originou o título continua ativa.

Em título faturado com boleto registrado, a janela avisa o que acontece: a parcela sai do Contas a Receber, a cobrança volta para o Registro de recebíveis e os títulos precisam ser lançados de novo. Para só corrigir dados do boleto, use **Refazer boleto**.

**Cancelar só o boleto e manter o valor a receber (Cancelar boleto)**

1. Na aba **Boletos**, abra o menu de ações e clique em **Cancelar boleto**.
2. Na janela **Cancelar boleto e manter como depósito?**, clique em **Cancelar → depósito**.

O boleto é cancelado no banco e o título continua ativo, agora como **Depósito em conta**, com o mesmo valor e vencimento.

### Refazer o boleto de uma única parcela

Use quando o boleto de uma parcela saiu com informação errada ou faltando (número da NF, descrição, vencimento, dados do cliente) e o valor a receber deve continuar como está. Vale para os boletos do C6.

1. Se o erro é no nome, CPF/CNPJ, e-mail ou endereço do cliente, corrija primeiro o cadastro do cliente.
2. Na aba **Carteira** ou **Boletos**, abra o menu de ações da parcela e clique em **Refazer boleto**.
3. A janela **Refazer boleto?** mostra a cobrança, a parcela, o valor e o **Pagador (do cadastro, agora)**. Confira o pagador.
4. Corrija o **Número da NF**, a **Descrição** e o **Vencimento**, se precisar. Parcela e valor não mudam. O vencimento não pode ser no passado.
5. Preencha o **Motivo** (obrigatório) e clique em **Refazer boleto**.

O sistema consulta o C6, cancela o boleto atual e registra um novo para a mesma parcela, com o mesmo valor. O boleto antigo fica na lista como **Cancelado**, marcado **Substituído**. A cobrança não volta para o Registro de recebíveis. A linha digitável muda: envie o boleto novo ao cliente.

Quem refez, quando e por quê ficam em **Detalhe da Cobrança**, no quadro **Histórico do título**.

**Quando o Refazer boleto não serve**

- Títulos da Ideal Birô (Banco Inter), ou quando o **valor** precisa mudar: na aba **Boletos**, use **Cancelar boleto** na parcela (ela vira depósito e continua ativa); depois, na aba **Depósitos**, **Transformar em boleto**, ajuste os dados na janela **Revisar para Geração Bancária** e clique em **Registrar boleto**.
- Se a mudança for só de data em parcela ainda não vencida, **Prorrogar vencimento** também resolve em um passo.

### Trocar um depósito de data ou transformá-lo em boleto

1. Na aba **Depósitos**, abra o menu de ações.
2. Para mudar a data, clique em **Editar depósito**, informe a **Nova data de vencimento** e clique em **Salvar vencimento**. Só o vencimento muda.
3. Para emitir boleto, clique em **Transformar em boleto** e siga o registro na janela **Revisar para Geração Bancária**. Se você não registrar, o título fica como boleto pendente de registro.

### Ver os detalhes de um título

1. No menu de ações, clique em **Detalhe da Cobrança**.
2. A janela **Conferência de Recebível** mostra empresa, tipo, status, valores, vencimento, parcela, multa, juros, dias de atraso, linha digitável, código de barras e nosso número.
3. Quando houver PDF, use **Visualizar PDF do boleto**.

Na aba **Carteira**, o menu também tem **Cadastro do Cliente**, que abre o cadastro.

## Regras e bloqueios

### Cancelar só uma parcela não deixa relançar

- Ao cancelar um título faturado com **Cancelar recebível**, a cobrança é liberada para voltar ao [Registro de recebíveis](registro-de-recebiveis.md). Mas o Registro só mostra a cobrança quando a proposta não tem mais **nenhum** título ativo. Enquanto existir outra parcela a vencer, vencida ou paga na mesma proposta, a cobrança não aparece lá, e não há como gerar a parcela de novo.
- Mesmo quando a cobrança volta ao Registro, o lançamento é sempre do valor inteiro da cobrança: a soma das parcelas novas precisa bater com o total. Não existe lançamento de uma parcela avulsa.
- Por isso, para refazer um parcelamento inteiro, cancele **todas** as parcelas em aberto da proposta. Aí a cobrança reaparece no Registro e você gera os títulos de novo.
- Se alguma parcela da proposta já foi paga, a cobrança não volta ao Registro, porque título pago não pode ser cancelado. Nesse caso não cancele a parcela: use **Refazer boleto**, **Prorrogar vencimento** ou **Cancelar boleto** seguido de **Transformar em boleto** (veja "Refazer o boleto de uma única parcela"). Esses caminhos mantêm a parcela viva.
- Título cancelado não volta: na janela **Revisar para Geração Bancária** ele aparece como "Boleto CANCELADO. Nenhuma ação disponível."

### Demais regras

- Não dá para cancelar título pago. A janela mostra "Cancelamento não permitido".
- Não dá para dar baixa em título já pago ou cancelado.
- Não dá para dar baixa manual em boleto que o banco informa como pago. Use **Consultar pagamento C6** para baixar com a data do banco.
- Não dá para prorrogar boleto que não está registrado no banco, nem título pago ou cancelado. A nova data tem de ser depois do vencimento atual e não pode ser anterior a hoje.
- Não dá para registrar boleto enquanto o cadastro do cliente tiver pendência de CPF/CNPJ, e-mail ou endereço (logradouro, número, cidade, UF e CEP de 8 dígitos).
- Depois de registrado no banco, o boleto fica travado: valor, vencimento, descrição, multa e juros não podem mais ser alterados na revisão. Para mudar, prorrogue ou refaça o boleto.
- Parcela já registrada não é registrada de novo: o sistema bloqueia o registro duplicado.
- **Refazer boleto** só vale para boleto registrado no C6, em aberto e ainda não vencido. Antes de cancelar, o sistema consulta o banco: se o boleto constar como pago, nada é feito. Nunca ficam dois boletos ativos para a mesma parcela.
- Em **Ver boleto registrado** a janela é só de consulta: os campos ficam travados.
- Depósito em conta não vai ao banco. Para emitir boleto dele, use **Transformar em boleto**.
- O registro em lote só vale para parcelas da mesma proposta. Se uma parcela falhar, o lote para naquele ponto; as anteriores continuam registradas.
- Na baixa de boleto registrado e na prorrogação, o cancelamento no banco acontece uma vez só. Se a etapa seguinte falhar, tente de novo: o banco não é acionado outra vez.
- Quando o banco recusa o cancelamento porque o boleto já saiu de circulação (expirado ou baixado depois do vencimento) e confirma que não houve pagamento, o sistema cancela o título só aqui. Isso vale para os boletos do C6.
- O grupo **Pagos**, quando o filtro de status é **Pagos**, mostra os 100 pagamentos mais recentes.
- A tela carrega os 5.000 títulos mais recentes.

## Erros comuns

| O que aparece | Por que acontece | O que fazer |
|---|---|---|
| "Título liquidado não pode ser cancelado." | O título já está pago. | Não cancele. Se o dinheiro precisa voltar ao cliente, o caso é de devolução. |
| "Este título já está baixado." | Alguém já deu baixa. | Nada a fazer. |
| "Título cancelado não pode ser baixado." | O título está cancelado. | Confira se existe outro título ativo da mesma parcela. |
| "Selecione a forma de recebimento." | Faltou escolher a forma na baixa. | Escolha a **Forma de recebimento**. |
| "Descreva a forma em Observação (obrigatório para OUTROS)." | Forma **Outros** sem observação. | Preencha a **Observação**. |
| "O banco informa este boleto como pago." | O cliente pagou o boleto no banco. | Use **Consultar pagamento C6**. |
| "Boleto não está pago no C6." | O banco ainda não registra o pagamento. | Aguarde a compensação ou confirme com o cliente. |
| "Crítico: boleto cancelado no banco, mas a baixa local falhou." | O boleto saiu do banco, mas o título não foi marcado como pago. | Clique de novo em **Confirmar recebimento**. O cancelamento bancário não é repetido. |
| "Somente boletos registrados no banco podem ser prorrogados." | O boleto ainda não foi ao banco. | Ajuste o vencimento em **Registrar boleto no banco** antes de registrar. |
| "A nova data deve ser posterior ao vencimento atual." | Data igual ou anterior ao vencimento. | Escolha uma data mais à frente. |
| "Prorrogado, mas o registro bancário do novo boleto falhou." | O boleto antigo foi cancelado e o novo não entrou no banco. | Registre o título novo em **Registrar boleto no banco**. |
| "Parcela vencida: fale com o Financeiro" | Tentou refazer o boleto de uma parcela que já venceu. | O Refazer boleto não vale para parcela vencida. Combine com o Financeiro como tratar o título. |
| "Boleto pago no banco" (ao refazer) | O C6 informa o boleto como pago. Nada foi cancelado. | Use **Consultar pagamento C6** para dar a baixa. |
| "Pendência no cadastro do cliente" (na janela do Refazer) | Falta e-mail, endereço ou documento no cadastro. O boleto atual não foi tocado. | Corrija o cadastro do cliente e abra **Refazer boleto** de novo. |
| "Boleto anterior cancelado, mas o novo não foi registrado" | O boleto antigo saiu do banco e o banco recusou o novo. O título ficou **A receber criado — boleto não registrado**. | Corrija o que o aviso aponta e use **Registrar boleto no banco**. |
| "Boleto cancelado no banco, mas a troca não terminou" | O boleto foi cancelado no C6 e a gravação falhou no meio. | Clique em **Refazer boleto** de novo, na mesma janela. O cancelamento não se repete. |
| "Dados Cadastrais Incompletos / Inválidos" | Falta documento, e-mail ou endereço no cadastro do cliente. | **Editar Cadastro do Cliente**, corrigir e **Re-validar Cadastro**. |
| "Boleto já registrado" | A parcela já tem registro no banco. | Nada a fazer. Para trocar o boleto, prorrogue ou refaça. |
| "Registro em Lote Interrompido" | Uma parcela do lote falhou. O aviso diz qual. | Corrija o que o aviso aponta e registre as parcelas que faltam. |
| "Boleto registrado, mas sem PDF" | O registro deu certo, mas o PDF não foi gerado. | Use **Gerar PDF do Boleto** no menu de ações. |
| "Campos obrigatórios ausentes" (ao gerar PDF) | O boleto não tem linha digitável, código de barras ou identificador do banco. | Registre o boleto no banco primeiro. |
| "Empresa sem modelo de boleto configurado" | A empresa do título não tem modelo de boleto. | Peça ao administrador para configurar o modelo da empresa. |
| "Título cancelado, mas a cobrança não voltou ao Registro de Recebíveis." | Título antigo, sem vínculo claro com a cobrança, ou falha ao liberar a cobrança. | Peça conferência manual antes de gerar títulos novos. |
| "Sem permissão para cancelar título" | Seu perfil não pode cancelar cobrança no banco. | Peça a um administrador. |
| "Erro no cancelamento bancário" | O banco recusou ou a integração falhou. Nada foi alterado. | Leia o motivo no aviso e tente de novo. Se persistir, acione o administrador. |

## Veja também

- [Registro de recebíveis](registro-de-recebiveis.md)
- [Conferência](conferencia.md)
- [Notas fiscais](notas-fiscais.md)
- [Proposta: aba Pagamentos](proposta-pagamentos.md)
- [Tarefas](tarefas.md)
