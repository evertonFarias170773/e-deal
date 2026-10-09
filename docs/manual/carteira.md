# Carteira (contas a receber)

> **Última revisão:** 09/10/2026
> **Caminho no menu:** Financeiro → Carteira
> **Endereço:** `/contas-a-receber`

## Para que serve

A Carteira reúne todos os títulos a receber: boletos e depósitos em conta que nasceram de um pedido faturado. Aqui o financeiro acompanha o que está a vencer, vencido, pago e cancelado, registra o boleto no banco, refaz um boleto que saiu errado, dá baixa quando o cliente paga por fora do boleto, prorroga vencimento e cancela título.

A tela abre com o título **Contas a receber**. Os títulos entram nela pelo [Registro de recebíveis](registro-de-recebiveis.md) (botão **Gerar títulos**) ou pelo lançamento a partir de uma nota fiscal.

## Quem acessa

- Vê a tela quem tem a permissão **Visualizar Títulos** no perfil, além de Administrador e Super Admin. Sem ela, a tela mostra acesso negado.
- **Confirmar recebimento** (dar baixa) aparece só para quem tem a permissão **Registrar Baixa**, Administrador ou Super Admin.
- **Registrar** (botão da linha), **Registrar boleto no banco**, **Registrar boleto**, **Refazer boleto**, **Cancelar recebível**, **Cancelar boleto**, **Prorrogar vencimento**, **Editar depósito** e **Transformar em boleto** aparecem só para quem tem a permissão **Administrar Contas a Receber**, Administrador ou Super Admin. O registro no banco é feito pelo servidor, que confere de novo a mesma permissão: a tela não fala mais direto com o banco.
- As demais ações do menu (**Detalhe da Cobrança**, **Cadastro do Cliente**, **Ver boleto registrado**, **Consultar pagamento C6**, **Consultar PDF no C6**, **Visualizar Boleto** / **Gerar PDF do Boleto**) aparecem para todos que veem a tela.
- Cancelar no banco um boleto registrado (em **Cancelar recebível**, **Cancelar boleto**, **Prorrogar vencimento**, **Refazer boleto** e na baixa manual) também exige, no servidor, a permissão **Cancelar / Estornar Cobranças** ou **Cancelar Cobrança Não Paga**. Quem não a tem recebe o aviso "Sem permissão para cancelar título".

## Botões e ações da tela

Nomes exatamente como aparecem na tela, inclusive maiúsculas, acentos e erros de grafia.

| Nome na tela | Onde fica | O que faz |
|---|---|---|
| **Cobranças Vencidas** | Cartão do topo (clicável) | Soma todos os títulos vencidos. O clique filtra por **Vencidos** e limpa os períodos de vencimento e de emissão. |
| **Cobranças a Receber** | Cartão do topo (clicável) | Soma todos os títulos a vencer. O clique filtra por a vencer e limpa os dois períodos. |
| **Pagos** | Cartão do topo (não clicável) | Soma os títulos pagos dentro do período filtrado. |
| Campo **Buscar por cliente, id, pagamento, OS ou CPF/CNPJ** | Barra de filtros | Filtra por cliente, número da proposta, número do pagamento, NF/OS, CPF/CNPJ ou referência do título. |
| **Todas as empresas** | Barra de filtros | Filtra pela empresa que recebe. |
| **Todos status** (com **Previsão futura / E-Faturado (A Vencer)**, **Vencidos**, **Pagos**, **Cancelados**, **Boletos não registrados**) | Barra de filtros | Filtra pela situação do título. **Boletos não registrados** mostra os boletos sem registro completo no banco. |
| **Emissão** (duas datas) | Barra de filtros | Filtra pela data em que o título foi criado. Começa vazio. |
| **Limpar filtros** | Barra de filtros | Volta busca, empresa, status e períodos ao padrão (vencimento no mês corrente). Não troca de aba. |
| **Carteira** | Aba | Todos os títulos, boletos e depósitos juntos. |
| **Boletos** | Aba | Só os boletos. É onde ficam **Prorrogar vencimento** e **Cancelar boleto**. |
| **Depósitos** | Aba | Só os depósitos em conta. É onde ficam **Editar depósito** e **Transformar em boleto**. |
| **Cartões a receber** | Aba | Ainda não está em uso. Mostra "Cartões a receber ficará disponível em uma fase futura." |
| **Previsão de recebimento** | Aba | Resumo do que está a vencer, por prazo e por empresa. Não tem ações. |
| **Vencimento** (duas datas, com ícone de calendário) | À direita das abas | Filtra pelo vencimento. Começa no mês corrente. A palavra **Vencimento** só aparece em tela larga. |
| **Registrar** | Na linha do título, coluna **Ações**, quando o status é **A receber criado — boleto não registrado**; só para quem tem **Administrar Contas a Receber** | Abre a janela **Revisar para Geração Bancária**. No celular o botão se chama **Registrar boleto no banco**. |
| **Acoes** (no celular, **Mais**) | Na linha do título, coluna **Ações** | Abre o menu de ações do título. |
| **Detalhe da Cobrança** | Menu de ações | Abre a janela **Conferência de Recebível**, com os dados do título e o **Histórico do título**. |
| **Cadastro do Cliente** | Menu de ações, só na aba **Carteira** | Abre o cadastro do cliente. |
| **Registrar boleto no banco** | Menu de ações, em boleto sem registro no banco; só para quem tem **Administrar Contas a Receber** | Abre a janela **Revisar para Geração Bancária**. |
| **Ver boleto registrado** | Menu de ações, em boleto já registrado (no lugar de **Registrar boleto no banco**) | Abre a mesma janela para consulta. A parcela registrada fica travada. |
| **Refazer boleto** | Menu de ações, abas **Carteira** e **Boletos**, em boleto do C6 registrado e em aberto | Troca o boleto da parcela por um novo, sem cancelar o título. |
| **Registrar boleto** | Menu de ações, aba **Boletos**, em boleto sem registro | Abre a janela **Revisar para Geração Bancária**. |
| **Consultar pagamento C6** | Menu de ações, em boleto registrado e não pago | Consulta o banco e, se o boleto foi pago, dá a baixa com a data do banco. |
| **Consultar PDF no C6** | Menu de ações, em boleto registrado sem PDF | Busca o PDF do boleto no banco e guarda no título. |
| **Visualizar Boleto** | Menu de ações, em boleto com PDF | Abre o PDF em outra aba. |
| **Gerar PDF do Boleto** | Menu de ações, em boleto registrado sem PDF (no lugar de **Visualizar Boleto**) | Gera o PDF e abre. |
| **Confirmar recebimento** | Menu de ações; apagado em título pago ou cancelado | Dá baixa manual em pagamento recebido fora do boleto. |
| **Cancelar recebível** | Menu de ações, aba **Carteira** (qualquer título) e aba **Depósitos**; apagado em título pago ou cancelado | Cancela o título por inteiro. |
| **Prorrogar vencimento** | Menu de ações, aba **Boletos**, em boleto registrado | Cancela o boleto no banco e cria um título novo da mesma parcela, com a nova data. |
| **Cancelar boleto** | Menu de ações, aba **Boletos** | Cancela o boleto no banco e mantém o título ativo como depósito em conta. |
| **Editar depósito** | Menu de ações, aba **Depósitos** | Muda só o vencimento do depósito. |
| **Transformar em boleto** | Menu de ações, aba **Depósitos** | Transforma o depósito em boleto e abre a janela de registro no banco. |
| **Confirmar recebimento** / **Cancelar** | Janela **Confirmar recebimento?** | Conclui a baixa / fecha sem baixar. |
| **Refazer boleto** / **Cancelar** | Janela **Refazer boleto?** | Troca o boleto / fecha sem mexer. |
| **Prorrogar vencimento** / **Cancelar** | Janela **Prorrogar vencimento?** | Conclui a prorrogação / fecha. |
| **Cancelar → depósito** / **Voltar** | Janela **Cancelar boleto e manter como depósito?** | Cancela o boleto e mantém como depósito / fecha. |
| **Salvar vencimento** / **Cancelar** | Janela **Editar depósito** | Grava a nova data / fecha. |
| **Transformar em boleto** / **Cancelar** | Janela **Transformar depósito em boleto?** | Converte e abre o registro / fecha. |
| **Confirmar cancelamento** / **Voltar** | Janela **Cancelar boleto?** ou **Cancelar depósito em conta?** | Cancela o título / fecha. Em título pago só aparece **Fechar**. |
| **Consultar no C6** / **Cancelar** | Janela **Consultar Pagamento C6** | Consulta o banco / fecha. |
| **Sim, atualizar recebível** / **Voltar** | Janela **Confirmar Baixa de Pagamento** | Marca o título como pago com a data do banco / volta um passo. |
| Botão com ícone de X ("Fechar consulta") | Canto da janela **Consultar Pagamento C6** | Fecha a janela. |
| Botão com ícone de X ("Fechar detalhe") | Canto da janela **Conferência de Recebível** | Fecha a janela. |
| **Visualizar PDF do boleto** | Janela **Conferência de Recebível** | Abre o PDF. Sem PDF, aparece **PDF ainda não disponível**, apagado. |
| **Editar Cadastro do Cliente** | Janela **Revisar para Geração Bancária**, quadro de pendências | Abre o cadastro do cliente em outra aba. |
| **Re-validar Cadastro** | Janela **Revisar para Geração Bancária**, quadro de pendências | Confere o cadastro de novo. |
| Caixa **Confirmo o uso deste e-mail para o registro bancário.** | Janela **Revisar para Geração Bancária**, quadro **E-mail de Cliente Ausente** | Libera o registro usando o e-mail informado em **E-mail para envio:**. |
| Caixa **Depósito em conta** | Janela **Revisar para Geração Bancária**, em cada parcela | Marca a parcela como depósito, sem boleto. |
| **Registrar boleto** | Janela **Revisar para Geração Bancária**, em cada parcela sem registro | Abre a confirmação **Confirmar Registro Bancário** e envia a parcela ao banco. |
| **Registrar todos os boletos desta proposta** | Janela **Revisar para Geração Bancária**, quadro **Registro Bancário em Lote** (duas ou mais parcelas prontas) | Abre a confirmação **Confirmar Registro em Lote** e registra as parcelas em sequência. |
| **Visualizar PDF** | Janela **Revisar para Geração Bancária**, parcela registrada | Abre o PDF. Sem PDF, aparece **PDF ainda não disponível**, apagado. |
| **Copiar Linha Digitável** | Janela **Revisar para Geração Bancária**, parcela registrada | Copia a linha digitável. |
| **Copiar Link** | Janela **Revisar para Geração Bancária**, parcela registrada | Copia o endereço do PDF. |
| **Salvar Alterações** / **Cancelar** | Rodapé da janela **Revisar para Geração Bancária** | Grava os ajustes das parcelas sem registrar no banco / fecha. |
| Botão com ícone de X (sem texto) | Canto da janela **Revisar para Geração Bancária** | Fecha a janela. |

## Passo a passo

> Quer cancelar um boleto para corrigir data, NF ou descrição? Use **Refazer boleto**: troca o boleto e mantém o recebível. **Cancelar recebível** é para desistir do título.

### Entender a tela

Os três cartões do topo respeitam a busca, a empresa e o status escolhidos. Nas abas **Boletos** e **Depósitos**, somam só os títulos daquele tipo. Os filtros ficam no endereço da página: sobrevivem a atualizar a tela e podem ser enviados por link.

Nas abas **Carteira**, **Boletos** e **Depósitos** os títulos aparecem em quatro grupos, cada um com a quantidade e o **Total**: **Vencidos**, **Previsão futura / E-Faturado**, **Pagos** e **Cancelados**.

A aba **Previsão de recebimento** mostra **Previsão por semana** (**Semana atual**, **Quinzena**, **Até 30 dias**, **Até 90 dias**), **Recebidos x a vencer**, **Por empresa** e **Boletos e depósitos**.

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
| **Cancelado** | Título cancelado. Fica na lista como histórico. |
| **Cancelado** com **Substituído** embaixo | Boleto antigo de um **Refazer boleto**. A parcela continua ativa em outra linha, com o boleto novo. Passe o mouse para ler quem refez e o motivo. |

### Registrar o boleto no banco

1. Localize o título com status **A receber criado — boleto não registrado** e clique em **Registrar** (ou, no menu de ações, **Registrar boleto no banco**).
2. Abre a janela **Revisar para Geração Bancária**, com todas as parcelas da mesma proposta.
3. Se aparecer o quadro **Dados Cadastrais Incompletos / Inválidos**, clique em **Editar Cadastro do Cliente**, corrija o que está listado e volte para clicar em **Re-validar Cadastro**.
4. Se aparecer o quadro **E-mail de Cliente Ausente**, confira o **E-mail para envio:** e marque **Confirmo o uso deste e-mail para o registro bancário.**
5. Ajuste, se precisar, **Valor**, **Vencimento**, **Descrição**, **Multa (%)** e **Juros/Dia (%)** da parcela.
6. Clique em **Registrar boleto** na parcela e confirme em **Confirmar Registro Bancário**. Para registrar todas de uma vez, use **Registrar todos os boletos desta proposta**.
7. A parcela passa a mostrar **Boleto Registrado**, com **Nosso Número**, **Linha Digitável** e os botões **Visualizar PDF**, **Copiar Linha Digitável** e **Copiar Link**. O PDF é gerado logo depois do registro.

Para só gravar os ajustes sem registrar no banco, clique em **Salvar Alterações**.

### Abrir a segunda via do boleto

1. No menu de ações do título, clique em **Visualizar Boleto**. O PDF abre em outra aba.
2. Se a opção for **Gerar PDF do Boleto**, o PDF ainda não existe: clique para gerar. Ele abre sozinho ao terminar; se o navegador bloquear, clique no aviso "PDF gerado!" para abrir.
3. Se aparecer **Consultar PDF no C6**, use para buscar o PDF direto no banco.
4. Para copiar a linha digitável ou o link do PDF, abra **Ver boleto registrado** e use **Copiar Linha Digitável** ou **Copiar Link** na parcela. A linha digitável também aparece em **Detalhe da Cobrança**.

### Refazer o boleto de uma parcela

Use quando o boleto de uma parcela saiu com informação errada ou faltando (número da NF, descrição, vencimento, dados do cliente) e o valor a receber deve continuar como está. É o caminho indicado para trocar o boleto de uma única parcela.

1. Se o erro é no nome, CPF/CNPJ, e-mail ou endereço do cliente, corrija primeiro o cadastro do cliente. O boleto novo usa o cadastro como está na hora.
2. Na aba **Carteira** ou **Boletos**, abra o menu de ações da parcela e clique em **Refazer boleto**.
3. A janela **Refazer boleto?** mostra **Cobrança**, **Parcela**, **Valor** e o quadro **Pagador (do cadastro, agora)**, com nome, documento, e-mail e endereço. Confira o pagador. Quando o cadastro não tem e-mail válido, o e-mail aparece com a nota "(padrão da empresa: o cadastro não tem e-mail válido)".
4. Corrija o **Número da NF**, o **Vencimento** e a **Descrição**, se precisar. Parcela e valor não mudam.
5. Preencha o **Motivo** (obrigatório) e clique em **Refazer boleto**.

O que o sistema faz, nesta ordem:

1. Consulta o boleto no C6. Se constar como pago, ou se o banco não responder, nada é alterado.
2. Cancela o boleto atual no C6.
3. Guarda o boleto antigo como uma linha de histórico, **Cancelado** e marcada **Substituído**.
4. Grava no título a NF, a descrição, o vencimento e o nome e documento do pagador, e registra o boleto novo, com a mesma parcela e o mesmo valor.
5. Gera o PDF do boleto novo.

Ao terminar aparece "Boleto refeito." A linha digitável muda: envie o boleto novo ao cliente. Quem refez, quando, por quê e o que foi alterado ficam em **Detalhe da Cobrança**, no quadro **Histórico do título**.

O que o Refazer boleto **não** faz:

- Não cancela o título. A parcela continua na Carteira, na mesma linha.
- Não mexe na cobrança e não a devolve ao Registro de recebíveis.
- Não muda o valor nem o número da parcela. Multa e juros do título também são mantidos.
- Não vale para título da Ideal Birô (Banco Inter), depósito em conta, boleto ainda não registrado, título pago ou cancelado. Nesses casos a opção não aparece no menu.
- Não vale para parcela vencida. A opção aparece, mas o clique mostra "Parcela vencida: fale com o Financeiro".

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

Existem dois cancelamentos diferentes. Escolha pelo resultado que você quer. Para trocar só o boleto, sem cancelar nada, use **Refazer boleto**.

**Cancelar o título por inteiro (Cancelar recebível)**

1. Na aba **Carteira**, abra o menu de ações e clique em **Cancelar recebível**. Para depósito, a mesma opção existe na aba **Depósitos**.
2. Leia o aviso da janela e clique em **Confirmar cancelamento**.

Se o boleto estiver registrado, ele é cancelado no banco primeiro; se o banco falhar, nada muda. Depois o título fica **Cancelado**. Nos títulos da Ideal Birô (Banco Inter), o título sai da lista em vez de ficar como cancelado. A cobrança que originou o título continua ativa.

Em título faturado com boleto registrado, a janela avisa: "Esta parcela será cancelada no C6 e sai do Contas a Receber (fica no histórico). A cobrança continua ativa e volta para o Registro de recebíveis, onde os títulos precisam ser lançados de novo. Para só corrigir dados do boleto, use Refazer boleto." Antes de confirmar, leia "Cancelar só uma parcela não deixa relançar", em Regras e bloqueios.

**Cancelar só o boleto e manter o valor a receber (Cancelar boleto)**

1. Na aba **Boletos**, abra o menu de ações e clique em **Cancelar boleto**.
2. Na janela **Cancelar boleto e manter como depósito?**, clique em **Cancelar → depósito**.

O boleto é cancelado no banco e o título continua ativo, agora como **Depósito em conta**, com o mesmo valor e vencimento.

### Trocar um depósito de data ou transformá-lo em boleto

1. Na aba **Depósitos**, abra o menu de ações.
2. Para mudar a data, clique em **Editar depósito**, informe a **Nova data de vencimento** e clique em **Salvar vencimento**. Só o vencimento muda.
3. Para emitir boleto, clique em **Transformar em boleto** e siga o registro na janela **Revisar para Geração Bancária**. Se você não registrar, o título fica como boleto pendente de registro.

### Ver os detalhes de um título

1. No menu de ações, clique em **Detalhe da Cobrança**.
2. A janela **Conferência de Recebível** mostra empresa, tipo, status, valores, vencimento, parcela, multa, juros, dias de atraso, linha digitável, código de barras e nosso número.
3. Quando o título foi refeito ou prorrogado, o quadro **Histórico do título** mostra quem fez, quando e o motivo.
4. Quando houver PDF, use **Visualizar PDF do boleto**.

## Regras e bloqueios

### Referência do título no faturado parcelado

- Referência do título: é o código que identifica cada parcela no banco e no link do boleto, e não pode se repetir entre títulos ativos. Em faturado de duas parcelas ou mais, cada parcela recebe a sua, no formato P + parcela + total de parcelas + número da proposta (a parcela 2 de 3 da proposta 23181 é P2323181), com ou sem nota fiscal; o número da nota continua aparecendo no título. Só o faturado de parcela única usa a referência da nota, quando ela já está autorizada.

### Cancelar só uma parcela não deixa relançar

- Ao cancelar um título faturado com **Cancelar recebível**, a cobrança é liberada para voltar ao [Registro de recebíveis](registro-de-recebiveis.md). Mas o Registro só mostra a cobrança quando a proposta não tem mais **nenhum** título ativo. Enquanto existir outra parcela a vencer, vencida ou paga na mesma proposta, a cobrança não aparece lá, e não há como gerar a parcela de novo. Isso vale mesmo com o aviso dizendo que a cobrança volta para o Registro.
- Mesmo quando a cobrança volta ao Registro, o lançamento é sempre do valor inteiro da cobrança: a soma das parcelas novas precisa bater com o total. Não existe lançamento de uma parcela avulsa.
- Se alguma parcela da proposta já foi paga, a cobrança não volta ao Registro, porque título pago não pode ser cancelado.
- Por isso, para trocar o boleto de **uma** parcela, não cancele o título. Use, nesta ordem de preferência:
  1. **Refazer boleto**: corrige NF, descrição, vencimento e dados do pagador, mantém a parcela e o valor. Vale para boleto do C6 registrado, em aberto e não vencido.
  2. **Prorrogar vencimento**: quando só a data muda. Aceita também boleto vencido. A nova data tem de ser posterior ao vencimento atual.
  3. **Cancelar boleto** seguido de **Transformar em boleto** (aba **Depósitos**): quando o **valor** precisa mudar. A parcela vira depósito, volta a ser boleto sem registro e pode ser ajustada na janela **Revisar para Geração Bancária** antes de **Registrar boleto**.
- Para refazer um parcelamento inteiro, cancele **todas** as parcelas em aberto da proposta com **Cancelar recebível**. Aí a cobrança reaparece no Registro e você gera os títulos de novo.
- Título cancelado não volta: na janela **Revisar para Geração Bancária** ele aparece como "Boleto CANCELADO. Nenhuma ação disponível."

### Demais regras

- Não dá para cancelar título pago. A janela mostra "Cancelamento não permitido".
- Não dá para dar baixa em título já pago ou cancelado.
- Não dá para dar baixa manual em boleto que o banco informa como pago. Use **Consultar pagamento C6** para baixar com a data do banco.
- Não dá para prorrogar boleto que não está registrado no banco, nem título pago ou cancelado. A nova data tem de ser depois do vencimento atual e não pode ser anterior a hoje.
- Não dá para refazer boleto sem **Motivo**, com vencimento no passado ou enquanto o cadastro do cliente tiver pendência. A pendência aparece na janela antes de qualquer chamada ao banco, e o boleto atual não é tocado.
- No **Refazer boleto**, o banco é consultado antes: boleto pago ou banco sem resposta bloqueiam a troca. Nunca ficam dois boletos ativos para a mesma parcela.
- Não dá para registrar boleto enquanto o cadastro do cliente tiver pendência de CPF/CNPJ, e-mail ou endereço (logradouro, número, cidade, UF e CEP de 8 dígitos).
- Depois de registrado no banco, o boleto fica travado: valor, vencimento, descrição, multa e juros não podem mais ser alterados na janela **Revisar para Geração Bancária**. Para mudar, use **Refazer boleto** ou **Prorrogar vencimento**.
- Parcela já registrada não é registrada de novo: o sistema bloqueia o registro duplicado.
- Depósito em conta não vai ao banco. Para emitir boleto dele, use **Transformar em boleto**.
- O registro em lote só vale para parcelas da mesma proposta. Se uma parcela falhar, o lote para naquele ponto; as anteriores continuam registradas.
- Na baixa de boleto registrado, na prorrogação e no **Refazer boleto**, o cancelamento no banco acontece uma vez só. Se a etapa seguinte falhar, tente de novo: o banco não é acionado outra vez.
- Quando o banco recusa o cancelamento porque o boleto já saiu de circulação (expirado ou baixado depois do vencimento) e confirma que não houve pagamento, o sistema cancela o título só aqui e libera a cobrança para o Registro de recebíveis. Isso vale para os boletos do C6 e não acontece no **Refazer boleto**, que só mostra a recusa.
- O grupo **Pagos**, quando o filtro de status é **Pagos**, mostra os 100 pagamentos mais recentes.
- A tela carrega os 5.000 títulos mais recentes.

## O que não confundir

- Quer cancelar um boleto para corrigir data, NF ou descrição? Use **Refazer boleto**: troca o boleto e mantém o recebível. **Cancelar recebível** é para desistir do título. O Refazer mantém o título na Carteira; o Cancelar recebível cancela o título e libera a cobrança para o Registro de recebíveis.
- **Carteira**, **Registro de recebíveis** e **Conferência**: a Conferência confere a cobrança do pedido; o Registro de recebíveis transforma a cobrança faturada já conferida em títulos; a Carteira acompanha e opera esses títulos.
- **Título** (ou recebível, ou parcela) e **cobrança**: a cobrança é o pagamento do pedido, identificada na coluna **N°**; o título é cada parcela lançada a partir dela. Cancelar um título não cancela a cobrança.
- **Refazer boleto** e **Prorrogar vencimento**: o Refazer mantém o mesmo título e deixa corrigir NF, descrição, vencimento e pagador; o Prorrogar só muda a data e cria um título novo, deixando o antigo como **Cancelado**.
- **Cancelar recebível** e **Cancelar boleto**: o primeiro cancela o título; o segundo cancela só o boleto no banco e mantém o título ativo como depósito em conta.
- **Cancelar boleto** (item do menu) e **Cancelar boleto?** (título da janela do **Cancelar recebível**): o item do menu mantém o título como depósito; a janela com esse título cancela o título por inteiro.
- **Excluir boleto do banco** não existe mais nesta tela nem na janela **Revisar para Geração Bancária**. Para trocar o boleto, use **Refazer boleto**; para tirar o boleto e manter o valor, **Cancelar boleto**.
- **Cancelado** e **Cancelado** com **Substituído**: o primeiro é um título cancelado; o segundo é só o boleto antigo de uma parcela que continua ativa em outra linha.
- **Registrar** (botão da linha), **Registrar boleto no banco** e **Registrar boleto** (itens do menu) e **Registrar boleto** (botão da janela): os três primeiros só abrem a janela **Revisar para Geração Bancária**; quem envia ao banco é o botão de dentro da janela.
- **Registrar boleto no banco** e **Ver boleto registrado**: é a mesma posição do menu e a mesma janela; o nome muda conforme o boleto já tenha ou não registro.
- **Gerar títulos** (no Registro de recebíveis) e **Registrar boleto** (aqui): gerar cria o título na Carteira; registrar envia o boleto ao banco. Título gerado ainda não é boleto pagável.
- **A receber criado — boleto não registrado** e **Boleto registrado**: no primeiro o cliente ainda não tem boleto para pagar; no segundo o boleto já existe no banco.
- **Confirmar recebimento** e **Consultar pagamento C6**: o primeiro é a baixa manual de pagamento feito fora do boleto (e cancela o boleto no banco); o segundo baixa o boleto que o cliente pagou, com a data do banco.
- **Visualizar Boleto**, **Gerar PDF do Boleto** e **Consultar PDF no C6**: o primeiro abre um PDF que já existe; o segundo monta o PDF a partir dos dados do boleto; o terceiro busca o PDF no banco.
- **Depósito em conta** (status) e **Depósito futuro** (coluna **Tipo**): é o mesmo título sem boleto, com nomes diferentes em cada coluna.
- Coluna **Conf.** e tela **Conferência**: **Confirmado** aqui quer dizer título pago ou baixado; não é a conferência da cobrança feita pelo financeiro.
- **N°** e **N° / OS**: o primeiro é o número do pagamento; o segundo traz o número da proposta e, embaixo, a nota fiscal ou a referência.
- Filtro **Vencimento** e filtro **Emissão**: um filtra pela data em que o título vence; o outro pela data em que foi criado. Os dois valem ao mesmo tempo.
- Cartões **Cobranças Vencidas** / **Cobranças a Receber** e cartão **Pagos**: os dois primeiros somam a carteira inteira, sem olhar os períodos; **Pagos** soma só o período filtrado.
- **Cancelar** (botão das janelas) e **Cancelar recebível**: **Cancelar** só fecha a janela aberta.

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
| "Crítico: boleto cancelado no banco, mas a baixa local falhou." | O boleto saiu do banco, mas o título não foi marcado como pago. | Clique de novo em **Confirmar recebimento**. O cancelamento bancário não é repetido. Se continuar, confira se o título ficou **Cancelado** e acione o administrador. |
| "Somente boletos registrados no banco podem ser prorrogados." | O boleto ainda não foi ao banco. | Ajuste o vencimento em **Registrar boleto no banco** antes de registrar. |
| "A nova data deve ser posterior ao vencimento atual." | Data igual ou anterior ao vencimento. | Escolha uma data mais à frente. |
| "Prorrogado, mas o registro bancário do novo boleto falhou." | O boleto antigo foi cancelado e o novo não entrou no banco. | Registre o título novo em **Registrar boleto no banco**. |
| "Parcela vencida: fale com o Financeiro" | Tentou refazer o boleto de uma parcela que já venceu. | O Refazer boleto não vale para parcela vencida. Se só a data muda, use **Prorrogar vencimento**. |
| "Informe o motivo para refazer o boleto." | O campo **Motivo** está vazio. | Preencha o **Motivo**. |
| "O vencimento não pode ser no passado." | Vencimento anterior a hoje na janela do Refazer. | Escolha hoje ou uma data futura. |
| "Pendência no cadastro do cliente: ..." (na janela do Refazer) | Falta e-mail, endereço ou documento no cadastro. O boleto atual não foi tocado. | Corrija o cadastro do cliente e abra **Refazer boleto** de novo. |
| "Boleto pago no banco" | O C6 informa o boleto como pago. Nada foi cancelado. | Use **Consultar pagamento C6** para dar a baixa. |
| "Não foi possível refazer o boleto" | O banco não respondeu à consulta, não informou a situação ou recusou o cancelamento. Nada foi alterado. | Leia o motivo no aviso e tente mais tarde. |
| "Boleto cancelado no banco, mas a troca não terminou" | O boleto foi cancelado no C6 e a gravação falhou no meio. A janela continua aberta. | Clique em **Refazer boleto** de novo, na mesma janela. O cancelamento não se repete. Se o aviso disser que o título mudou, recarregue a página e confira antes. |
| "Boleto anterior cancelado, mas o novo não foi registrado" | O boleto antigo saiu do banco e o banco recusou o novo. O título ficou **A receber criado — boleto não registrado**. | Corrija o que o aviso aponta e use **Registrar boleto no banco**. Se o aviso disser "NÃO registre de novo", avise o suporte. |
| "Boleto refeito, mas sem PDF" | A troca deu certo, mas o PDF não foi gerado. | Use **Gerar PDF do Boleto** no menu de ações. |
| "Sem permissão para registrar boleto no banco (contas_receber.admin)." | Seu perfil não tem a permissão **Administrar Contas a Receber**. | Peça o registro a quem tem a permissão. |
| "Dados Cadastrais Incompletos / Inválidos" | Falta documento, e-mail ou endereço no cadastro do cliente. | **Editar Cadastro do Cliente**, corrigir e **Re-validar Cadastro**. |
| "Boleto já registrado" | A parcela já tem registro no banco. | Nada a fazer. Para trocar o boleto, use **Refazer boleto**. |
| "Registro em Lote Interrompido" | Uma parcela do lote falhou. O aviso diz qual. | Corrija o que o aviso aponta e registre as parcelas que faltam. |
| "Boleto registrado, mas sem PDF" | O registro deu certo, mas o PDF não foi gerado. | Use **Gerar PDF do Boleto** no menu de ações. |
| "Campos obrigatórios ausentes" (ao gerar PDF) | O boleto não tem linha digitável, código de barras ou identificador do banco. | Registre o boleto no banco primeiro. |
| "Empresa sem modelo de boleto configurado" | A empresa do título não tem modelo de boleto. | Peça ao administrador para configurar o modelo da empresa. |
| "Título cancelado, mas a cobrança não voltou ao Registro de Recebíveis." | Título antigo, sem vínculo claro com a cobrança, ou falha ao liberar a cobrança. | Peça conferência manual antes de gerar títulos novos. |
| "O título original já não está em situação de prorrogação (pode já ter sido prorrogado). Nenhum novo título foi criado." | O título mudou de situação durante a prorrogação. | Recarregue a página e confira a situação da parcela antes de tentar de novo. |
| "Sem permissão para cancelar título" | Seu perfil não pode cancelar cobrança no banco. | Peça a um administrador. |
| "Erro no cancelamento bancário" | O banco recusou ou a integração falhou. Nada foi alterado. | Leia o motivo no aviso e tente de novo. Se persistir, acione o administrador. |
| "duplicate key value violates unique constraint \"idx_boletos_n_doc_boleto_ativo\"" ou "Duas parcelas deste lançamento ficaram com a mesma referência" | Dois títulos ativos ficariam com a mesma referência. Acontecia em faturado parcelado preparado depois de a nota fiscal sair; corrigido em 09/10/2026. | Nada foi gravado e nenhum boleto foi criado no banco. Recarregue a página e gere os títulos de novo. Se repetir, não insista: avise o suporte com o número da proposta. |
| "O banco não respondeu a tempo. Não é possível afirmar se o título foi cancelado: confira no banco antes de tentar de novo." | O banco demorou mais de 25 segundos para responder ao cancelamento. Nada foi alterado no Vibe. | Confira a situação do boleto no banco. Se ainda estiver ativo, tente de novo. |
| "Não foi possível contatar a integração bancária. Não é possível afirmar se o título foi cancelado: confira antes de tentar de novo." | A chamada ao banco falhou no caminho. Nada foi alterado no Vibe. | Confira a situação do boleto no banco e tente de novo. Se persistir, acione o administrador. |
| "O sistema foi atualizado enquanto esta tela estava aberta. Nada foi cancelado no banco: recarregue a página e tente de novo." | A tela ficou aberta durante uma atualização do Vibe. | Recarregue a página e repita o cancelamento. |

## Veja também

- [Registro de recebíveis](registro-de-recebiveis.md)
- [Conferência](conferencia.md)
- [Notas fiscais](notas-fiscais.md)
- [Proposta: aba Pagamentos](proposta-pagamentos.md)
- [Tarefas](tarefas.md)

## Arquivos de origem

Arquivos de código de onde esta ficha saiu. O `scripts/checar-manual.mjs` lê esta lista: quando um deles muda e a ficha não, ele avisa. Um caminho por item, entre crases, a partir da raiz do repositório; pasta termina com `/` e vale para tudo dentro dela.

- `src/app/(erp)/contas-a-receber/page.tsx`
- `src/features/contas-a-receber/ContasReceberPage.tsx`
- `src/features/contas-a-receber/components/RevisarGeracaoBancariaModal.tsx`
- `src/features/contas-a-receber/services/refazer-boleto.ts`
- `src/features/contas-a-receber/services/contas-receber.service.ts`
- `src/features/contas-a-receber/mappers.ts`
- `src/features/contas-a-receber/registro-recebiveis/services/registro-recebiveis.service.ts`
- `src/features/cobrancas/PrepararBoletosModal.tsx`
- `src/features/cobrancas/lib/referencia-do-boleto.ts`
- `src/features/cobrancas/services/cobranca-do-titulo.ts`
- `src/features/cobrancas/services/pagamentos-v2.service.ts`
- `src/features/cobrancas/recusa-bancaria.ts`
- `src/features/nfe/services/nfe.service.ts`
- `src/app/api/cobrancas/cancelar-boleto-faturado/route.ts`
- `src/features/cobrancas/services/cancelamento-c6.ts`
- `src/app/api/cobrancas/titulo-inativo-no-banco/route.ts`
- `src/components/common/ActionsMenu.tsx`
- `src/components/common/PermissionGuard.tsx`
- `src/lib/formatters/status.ts`
- `src/lib/mocks/contas-receber.mock.ts`
- `src/features/usuarios-perfis/catalogo-permissoes.ts`
- `src/constants/navigation.ts`
- `src/app/api/cobrancas/registrar-boleto-faturado/route.ts`
- `src/features/cobrancas/services/boleto-c6.ts`
- `src/lib/n8n/webhook-segredo.ts`
