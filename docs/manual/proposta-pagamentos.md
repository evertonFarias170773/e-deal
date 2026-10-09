# Proposta: aba Pagamentos

> **Última revisão:** 08/10/2026
> **Caminho no menu:** Pedidos → abrir um pedido → aba Pagamentos
> **Endereço:** `/orcamentos/<número>/editar?tab=pagamentos`

## Para que serve

É onde a cobrança da proposta nasce e é acompanhada: você gera PIX, boleto, cartão, faturado ou usa o crédito do cliente, envia o link ou o código ao cliente e vê o que já foi pago. Também é aqui que se resolve o saldo que sobra quando a proposta muda de valor depois de paga, e que se cancela uma cobrança errada para gerar outra.

## Quem acessa

- Quem abre a proposta vê a aba e pode gerar cobrança. A proposta precisa estar salva e ter cliente cadastrado.
- A forma **E-Crédito** só aparece para administrador ou perfil com a permissão **Usar Crédito Acumulado**, e só quando o cliente tem saldo. O pagamento combinado (crédito mais outra forma) exige também a permissão **Emitir Boleto**.
- O botão **Excluir** (cancelar cobrança) fica apagado para quem não é administrador e não tem a permissão **Cancelar / Estornar Cobranças** nem **Cancelar Cobrança Não Paga**. Com a segunda, só dá para cancelar cobrança emitida e ainda não paga, de proposta que o usuário enxerga, e que não esteja ligada à Conta Corrente.
- **Abonar diferença** só aparece para administrador e super administrador.
- **Analisar condição** (aprovar, alterar ou reprovar o faturamento) aparece para administrador ou perfil com a permissão **Liberar OS / Confirmar**.
- **Confirmar Conferência** e **Voltar para lista principal** aparecem para administrador ou perfil com a permissão **Confirmar Pagamento**.
- Cobrança já paga não é cancelada pela tela. Para quem não é super administrador, o botão **Cancelar cobrança** do detalhe fica apagado, com a dica "Cobrança já paga: cancelamento restrito a super administradores." Para o super administrador a janela abre, mas responde **Não é possível cancelar agora**: o caso é tratado como devolução.
- Alterar uma proposta que já tem pagamento exige a permissão **Editar Proposta Paga**. No aviso de diferença financeira, **Devolver ao cliente** exige **Solicitar Devolução**, **Bonificar** exige **Bonificar Comercial** e **Registrar como débito futuro** exige **Registrar Débito Futuro**.

## Botões e ações da tela

Nomes exatamente como aparecem na tela, inclusive maiúsculas, acentos e erros de grafia.

| Nome na tela | Onde fica | O que faz |
|---|---|---|
| **Pagamentos** | Barra de abas da proposta | Abre esta aba. Com alteração não salva, pede para salvar antes. |
| **Salvar e continuar** | Aviso **Salvar alterações**, ao clicar na aba | Salva a proposta e abre a aba Pagamentos. |
| **Salvar proposta agora** | Aba Pagamentos de proposta ainda não salva | Salva a proposta para liberar a geração de cobrança. |
| **Gerar cobrança** | Painel **Cobranças já geradas**, ao lado de **Saldo restante a cobrar** | Salva a proposta e abre a janela **Criar cobrança**. Só aparece quando há saldo a cobrar. |
| **Abonar diferença (R$ ...)** | Ao lado de **Gerar cobrança** | Registra um desconto no valor exato do saldo pendente de proposta já paga. |
| **Recarregar cobranças** | Aviso "Não foi possível carregar as cobranças desta proposta." | Lê de novo as cobranças da proposta. |
| **Demorando? Tentar novamente** | Enquanto as cobranças carregam | Lê de novo as cobranças da proposta. |
| **Abrir boleto** (ou **Indisponível**) | Linha de cobrança de boleto | Abre o boleto em outra aba. |
| **Pix Copia e cola** | Linha de cobrança PIX | Copia o código PIX. |
| **Abrir checkout** (no celular: **Abrir checkout cartão** ou **Escolher parcelas**) | Linha de cobrança de cartão | Abre a página de pagamento do cartão. |
| **Copiar** | Linha de cobrança com link | Copia o link, o código PIX ou a linha digitável da cobrança. |
| **Ver cobrança** (no celular: **Ver**) | Linha de cobrança | Abre o detalhe da cobrança dentro da aba. |
| **Excluir** | Linha de cobrança | Abre a janela **Cancelar Cobrança**. |
| **Empresa recebedora** | Janela **Criar cobrança** | Escolhe a empresa que recebe: IDEAL GRÁFICA EXPRESSA EIRELI, IDEAL BIRÔ SERV. GRAFICOS ou E3 BRINDES LTDA. |
| **OS Ideal \*** | Janela **Criar cobrança** | Número da OS, só dígitos. Obrigatório. |
| **Valor da cobrança \*** | Janela **Criar cobrança** | Valor desta cobrança. Vem preenchido com o saldo restante. |
| **Observações (opcional)** | Janela **Criar cobrança** | Texto livre gravado na cobrança. |
| **PIX**, **Boleto**, **Cartão de crédito**, **Cartão Asaas**, **Faturado**, **E-Permuta**, **E-Amostra**, **E-Retrabalho**, **E-Crédito** | Quadro **Forma de pagamento** da janela | Escolhe a forma. Forma que a empresa recebedora não aceita aparece como **Indisponível**. |
| **Condição de pagamento \*** | Quadro **Campos mínimos do faturado** | Escolhe a condição (parcelas e prazos) do Faturado e do E-Permuta. |
| **Forma de Pagamento Secundária \*** e **Condição Secundária \*** | Quadro **Campos do E-Crédito** | Definem como cobrar o que o crédito não cobre. |
| **Gerar cobrança** (vira **Gerando cobrança...**) e **Cancelar** | Rodapé da janela **Criar cobrança** | Cria a cobrança, ou fecha a janela sem criar. |
| **Enviar para avaliação** e **Voltar** | **Aviso de Pendência** | Envia o faturado ao financeiro mesmo com faturamento vencido, ou volta. |
| **Incluir no valor**, **Não incluir** e **Cancelar** | Aviso **Cliente com débito em aberto** | Soma (ou não) o débito do cliente a esta cobrança. |
| **Recalcular frete** e **Voltar** | Aviso **O frete precisa ser atualizado** | Leva à aba Fretes, ou fecha o aviso. |
| **Voltar para pagamentos** | Detalhe da cobrança | Volta para a lista de cobranças. |
| **Acoes** | Detalhe da cobrança, ao lado do selo | Abre o menu com: **Ver cobrança**, **Abrir proposta**, **Ver cliente**, **Abrir chat da proposta**, **Analisar condição**, **Confirmar Conferência**, **Voltar para lista principal**, **Analisar crédito**, **Copiar PIX**, **Copiar linha digitável**, **Nova tarefa** e **Cancelar cobrança**. |
| **Atualizar Status** | Detalhe, quadro **Ações Administrativas** | Lê de novo a situação da cobrança. |
| **Abrir**, **Copiar**, **Copiar PIX**, **Copiar Código**, **Baixar PDF** | Detalhe, quadro **Links e Códigos de Pagamento** | Abrem ou copiam o link, o código PIX, a linha digitável e o PDF. |
| **Visualizar Checkout** | Detalhe, quadro **Ações Administrativas** | Abre a página pública da cobrança. Não aparece em boleto, PIX e cartão. |
| **Liberar para pedido** (ou **Pedido já liberado**) | Detalhe, quadro **Ações Administrativas** | No ambiente real responde "Liberação de pedido automática desativada nesta etapa de testes." |
| **Cancelar cobrança** | Detalhe, quadro **Ações Administrativas**, e menu **Acoes** | Abre a janela **Cancelar Cobrança**. |
| **Confirmar Cancelamento** e **Voltar** | Janela **Cancelar Cobrança** | Cancela a cobrança, ou fecha sem cancelar. |
| **Ir para Notas Fiscais**, **Ir para Pedidos**, **Ir para Contas a Receber** | Janela **Cancelar Cobrança**, quando o cancelamento é recusado | Levam à tela onde a pendência se resolve. |
| **Aprovar**, **Alterar**, **Reprovar** | Abas da janela **Análise de Faturamento** | Escolhem o que fazer com a condição pedida pelo vendedor. |
| **Confirmar Autorização**, **Alterar Condição**, **Reprovar e cancelar cobrança** | Rodapé da janela **Análise de Faturamento** | Executam a ação da aba escolhida. |
| **Atualizar Limite**, **Ver Contas a Receber do Cliente**, **Fechar** | Janela **Análise de Crédito** | Gravam o novo limite de crédito, abrem a carteira do cliente, ou fecham. |
| **Confirmar Liberação** e **Cancelar** | Janela **Confirmar Liberação Operacional** | Confirmam a conferência da cobrança, ou desistem. |
| **Entendi, voltar** | Aviso **Não é possível confirmar esta cobrança** | Fecha o aviso. |
| **Resolver agora** (ou **Consolidar Total Oficial**) | Faixa **Revisão financeira pendente**, acima das abas | Abre a janela da diferença financeira. |
| **Confirmar** | Janela **Diferença Financeira** | Grava o destino escolhido para a diferença. |
| **Link pgto. externo** | Menu **Acoes** do topo da proposta e menu de cada linha da lista de Pedidos | Copia o link da área do cliente daquele pedido. |

## Passo a passo

### Gerar uma cobrança por PIX, boleto ou cartão

1. Abra a aba **Pagamentos**. Se houver alteração não salva, clique em **Salvar e continuar**.
2. Clique em **Gerar cobrança**.
3. Na janela **Criar cobrança**, confira o cabeçalho: empresa, total, já cobrado, saldo e situação. O nome no título é o de quem paga, definido na aba Geral.
4. Confira a **Empresa recebedora**. Ela vem da empresa da proposta; se a proposta não tem, do padrão do cliente.
5. Preencha **OS Ideal \***.
6. Confira o **Valor da cobrança \***. Ele vem com o saldo restante; para cobrar só uma parte, digite um valor menor.
7. Escolha a forma em **Forma de pagamento**: **PIX**, **Boleto**, **Cartão de crédito** ou **Cartão Asaas**. A forma padrão do cadastro de quem paga já vem marcada.
8. Clique em **Gerar cobrança**.
9. A cobrança aparece em **Cobranças já geradas**, com os botões para abrir ou copiar o link, o código PIX ou o boleto.

No cartão, o cliente escolhe as parcelas na página de pagamento; depois disso a linha mostra a quantidade de parcelas abaixo do valor.

### Gerar uma cobrança faturada

1. Na janela **Criar cobrança**, escolha **Faturado**.
2. Em **Campos mínimos do faturado**, escolha a **Condição de pagamento \***. A condição do cadastro de quem paga já vem marcada. Ela define a quantidade de parcelas, os dias até a primeira e o intervalo.
3. Leia os quadros de crédito: **Limite de crédito**, **Utilizado**, **Disponível**, **Valor solicitado**, **Faturamentos vencidos** e **Risco de crédito**.
4. Clique em **Gerar cobrança**.
5. Se o cliente tem faturamento vencido, aparece o **Aviso de Pendência**. Clique em **Enviar para avaliação** para seguir, ou em **Voltar**.
6. O sistema responde **Faturamento liberado** (crédito disponível e sem vencidos; a cobrança segue para a Conferência) ou **Faturamento em análise** (o financeiro precisa avaliar).

**E-Permuta** segue o mesmo caminho e também pede condição. **E-Amostra** e **E-Retrabalho** são cortesia: não pedem condição. Os três dependem sempre de liberação manual do financeiro.

Os boletos das parcelas não nascem aqui: depois que a Conferência confirma o faturado, a cobrança aparece no **Registro de recebíveis**, onde o financeiro clica em **Gerar títulos** e lança as parcelas com os vencimentos.

### Dividir o pagamento em mais de uma cobrança

1. Na janela **Criar cobrança**, digite em **Valor da cobrança \*** um valor menor que o saldo e gere a primeira cobrança.
2. Clique de novo em **Gerar cobrança**. A janela abre com o saldo que sobrou e o aviso "Cobrança complementar. Saldo restante: R$ ...".
3. Escolha a forma da segunda cobrança e gere.

### Usar o crédito do cliente (E-Crédito)

1. Quando o cliente tem saldo, a faixa **Saldo na Conta Corrente** aparece no topo da proposta e a forma **E-Crédito** aparece na janela **Criar cobrança**.
2. Escolha **E-Crédito**. O quadro **Campos do E-Crédito** mostra **Saldo de Crédito** e **Saldo Restante OS**.
3. Em **Valor da cobrança \***, informe quanto do crédito usar. Não pode passar do saldo de crédito nem do saldo da proposta.
4. Se o crédito cobre tudo, a tela mostra **Pagamento integral com E-Crédito**. Clique em **Gerar cobrança**.
5. Se o crédito cobre só uma parte, a tela mostra **Cobrança Parcial (Pagamento Combinado)**. Escolha a **Forma de Pagamento Secundária \*** (PIX, Boleto, Cartão de Crédito ou E-Faturado). Em E-Faturado, escolha também a **Condição Secundária \***. Clique em **Gerar cobrança**: as duas cobranças nascem juntas.

O crédito é debitado do saldo do cliente na hora. A cobrança de E-Crédito nasce paga, mas ainda passa pela Conferência para ser confirmada.

### Incluir um débito antigo do cliente na cobrança

1. Se o cliente tem débito na Conta Corrente, ao clicar em **Gerar cobrança** aparece o aviso **Cliente com débito em aberto**.
2. Para cobrar junto, ajuste **Valor do débito a incluir (R$)** e clique em **Incluir no valor**. O máximo é o saldo da pendência mais antiga.
3. Para seguir só com o valor da proposta, clique em **Não incluir**.

O débito fica reservado nesta cobrança e só é baixado na Conta Corrente quando o pagamento for confirmado. O aviso não aparece no E-Crédito.

### Gerar a cobrança de um pedido complementar

1. Antes de tudo, vá à aba **Fretes** do complementar e clique em **Cotar frete complementar**.
2. Confira **A cobrar aqui**, que é a diferença: o frete do peso somado dos dois pedidos menos o que o pedido principal já cobra.
3. Clique em **Aplicar** na opção escolhida. Repetir **Aplicar** não duplica.
4. Volte à aba **Pagamentos** e gere a cobrança normalmente.

Sem esse passo, o clique em **Gerar cobrança** abre a janela "O frete precisa ser atualizado", com **Recalcular frete**, que leva de volta à aba Fretes.

O frete complementar é devido. O crédito do cliente na Conta Corrente pode ser usado para quitar a cobrança, pelo fluxo oficial e com autoria registrada, mas não dispensa o frete nem autoriza editar o valor da cobrança. Não gere a cobrança por outro caminho para driblar o bloqueio: ela sairia sem o frete.

Complementar em **RETIRA** ou **FOB** não tem frete a cobrar e mesmo assim fica bloqueado nessa janela. É problema conhecido e sem solução publicada; peça ajuda em vez de contornar.

### Enviar o pagamento ao cliente

1. Na linha da cobrança, use **Pix Copia e cola**, **Abrir boleto**, **Abrir checkout** ou **Copiar**.
2. Para mandar um link único do pedido, abra o menu **Acoes** no topo da proposta e clique em **Link pgto. externo**. O aviso "Link de pagamento externo copiado." confirma.
3. O cliente abre o link sem login. A página mostra o total do pedido, o que já foi pago, o que falta, os itens e os pagamentos recebidos, e oferece PIX ou cartão para o valor exato que falta.
4. A cobrança que o cliente gera por ali aparece nesta aba como qualquer outra e passa pela Conferência do mesmo jeito.

### Acompanhar a situação

1. No topo do painel, o selo mostra a situação da proposta: **Aguardando pagamento**, **Parcialmente paga**, **Aguardando análise de crédito**, **Pronta para liberar** ou **Liberada para pedido**.
2. Em cada linha, o selo mostra a situação da cobrança: **Não confirmado** (emitida, ainda não paga), **Pago / A liberar** (paga, aguardando a Conferência), **Confirmado**, **A vencer** (faturado) ou **Aguardando análise de crédito**.
3. Para ver detalhes, clique em **Ver cobrança**. Para voltar, clique em **Voltar para pagamentos**.

Cobrança cancelada sai da lista.

### Analisar a condição de um faturado (financeiro)

1. Clique em **Ver cobrança** na cobrança faturada pendente e abra o menu **Acoes**.
2. Clique em **Analisar condição**. A janela **Análise de Faturamento** mostra cliente, proposta, valor e a **Condição Solicitada**.
3. Na aba **Aprovar**, clique em **Confirmar Autorização**. A autorização vale só para esta cobrança; não muda o limite de crédito do cliente. A cobrança segue para a Conferência.
4. Na aba **Alterar**, escolha a **Nova Condição de Pagamento** e clique em **Alterar Condição**. A cobrança continua aguardando análise.
5. Na aba **Reprovar**, preencha o motivo e clique em **Reprovar e cancelar cobrança**. A cobrança é cancelada, a proposta volta para NOVO e o vendedor é avisado no chat da proposta.

### Analisar o crédito e ajustar o limite (financeiro)

1. No detalhe da cobrança, abra **Acoes** e clique em **Analisar crédito**. O item só fica ativo em cobrança com crédito pendente.
2. A janela **Análise de Crédito** mostra **Limite de Crédito**, **Utilizado**, **Disponível**, **Saldo de Carteira**, **Faturamentos Vencidos** e **Risco de Crédito**.
3. Para mudar o limite, digite o valor em **Atualizar Limite de Crédito** e clique em **Atualizar Limite**.
4. Se com o novo limite o cliente fica aprovado, o faturamento é liberado sozinho. Se ainda houver impedimento, a tela avisa: "Limite atualizado, mas a cobrança permanece pendente por impedimento financeiro."

### Confirmar o pagamento (conferência)

1. No detalhe da cobrança paga ou a vencer, abra **Acoes** e clique em **Confirmar Conferência**.
2. Na janela **Confirmar Liberação Operacional**, confira cliente, proposta e valor e clique em **Confirmar Liberação**.
3. A cobrança sai da fila de conferência e fica disponível para boletos, fiscal, expedição e produção.
4. Para desfazer, use **Voltar para lista principal** no mesmo menu.

### Cancelar uma cobrança

1. Na linha da cobrança, clique em **Excluir** (ou, no detalhe, em **Cancelar cobrança**).
2. A janela **Cancelar Cobrança** confere com o servidor se a cobrança pode ser cancelada.
3. Se pode, leia o quadro **Ao confirmar**, preencha **Motivo do Cancelamento \*** e clique em **Confirmar Cancelamento**.
4. Se não pode, a janela mostra **Não é possível cancelar agora**, o motivo e, quando existe, um botão que leva à tela onde resolver.
5. Depois do cancelamento, a cobrança sai da lista, o saldo da proposta reabre e **Gerar cobrança** volta a aparecer.

### Resolver a diferença quando o cliente ficou devendo

1. Quando uma proposta já paga é alterada e o total sobe, a alteração é salva direto e a diferença vira saldo da própria proposta.
2. Abra a aba **Pagamentos**: o valor aparece em **Saldo restante a cobrar**.
3. Clique em **Gerar cobrança** para emitir a cobrança complementar, ou use **E-Crédito** se o cliente tem saldo.
4. Se a empresa vai absorver a diferença, o administrador clica em **Abonar diferença (R$ ...)** e confirma.

### Resolver a diferença quando o cliente ficou com crédito

1. Quando uma proposta já paga é alterada e o total cai abaixo do que foi pago, abre a janela **Diferença Financeira — Crédito ao Cliente**, com **Valor pago**, **Novo total** e **Diferença**.
2. Escolha o destino: **Manter crédito para uso futuro**, **Devolver ao cliente (solicitar ao Financeiro)** ou **Abater débito existente**. Em abatimento, escolha a pendência de débito e o valor.
3. Se quiser, escreva uma observação; ela fica no histórico da proposta.
4. Clique em **Confirmar**.

Se a janela for fechada sem escolher, a proposta fica com a faixa **Revisão financeira pendente**. Clique em **Resolver agora** para voltar à escolha.

## Regras e bloqueios

- Não dá para entrar na aba com alteração não salva: a tela pede **Salvar e continuar**.
- Não dá para entrar na aba enquanto houver diferença financeira pendente: "Resolva a diferença financeira pendente antes de acessar Pagamentos."
- Não dá para gerar cobrança de orçamento rápido, sem cliente cadastrado.
- **Gerar cobrança** só aparece enquanto há saldo. O saldo é o total da proposta menos a soma das cobranças ativas, pagas ou não. O valor de uma cobrança não pode passar do saldo.
- Não dá para gerar cobrança sem **OS Ideal**.
- Não dá para gerar cobrança com o frete desatualizado (peso da proposta diferente do peso cotado) nem, em pedido complementar, sem o frete complementar aplicado. No complementar em RETIRA ou FOB, que não tem frete a aplicar, esse bloqueio é um problema conhecido e sem solução publicada.
- Cobrança real exige nome e CPF/CNPJ do cliente e endereço de entrega com logradouro, cidade, UF e CEP. Boleto exige também e-mail do cliente.
- Boleto e cartão exigem telefone válido no cadastro de quem paga; o cartão exige celular. Sem isso abre a janela **Telefone do cliente impede a cobrança**, onde o telefone é corrigido na hora.
- **Cartão de crédito** existe para a Ideal Gráfica e a E3 Brindes; a Ideal Birô não tem. **Cartão Asaas** é só da IDEAL GRÁFICA EXPRESSA EIRELI. PIX, boleto e a família do faturado valem para as três empresas.
- No pagamento combinado, a Ideal Birô não aceita boleto nem cartão como forma secundária.
- PIX, boleto e cartão nascem com vencimento em 3 dias. No faturado, o primeiro vencimento segue a condição de pagamento escolhida.
- A liberação automática do faturado só vale para **Faturado**, e só quando o limite cobre o valor somado aos faturamentos ainda pendentes do cliente, não há faturamento vencido e o cliente não tem restrição. Fora disso a cobrança espera o financeiro.
- Não dá para confirmar a conferência enquanto as cobranças da proposta somarem menos que o total: aparece **Não é possível confirmar esta cobrança**.
- Depois de confirmado, o faturado continua **A vencer**: quem o quita são os títulos do Contas a receber. E-Permuta, E-Amostra e E-Retrabalho ficam quitados na própria confirmação.
- Cancelar é irreversível e exige motivo. O cancelamento é feito primeiro no banco ou no provedor do cartão; se ele recusar, nada muda no sistema.
- Não dá para cancelar cobrança já recebida pelo **Excluir**: o caso é devolução, não cancelamento.
- Não dá para cancelar cobrança de proposta com nota fiscal autorizada: cancele a nota antes.
- Não dá para cancelar cobrança de proposta que já está em produção: o gerente precisa devolver a proposta para REVISAO ATENDENTE ou retirá-la da produção.
- Não dá para cancelar uma cobrança faturada enquanto ela tiver título em aberto: cancele o título primeiro na Carteira (**Cancelar recebível**). Cancelar o título não cancela a cobrança; são dois passos separados.
- Cancelar só uma parcela de um faturado parcelado não deixa relançar. A cobrança continua ativa pelo valor inteiro, então **Gerar cobrança** não reaparece; e ela só volta ao Registro de recebíveis quando o pedido não tem mais nenhum título ativo. Para lançar de novo é preciso cancelar todas as parcelas em aberto. Para só corrigir um dado do boleto (número da NF, descrição, vencimento), use **Refazer boleto** na Carteira, que troca o boleto e mantém a parcela; ele não vale para a Ideal Birô.
- Se alguma parcela do faturado já foi paga, a cobrança inteira não pode mais ser cancelada: vira caso de devolução.
- Cobrança de E-Crédito não se desfaz pelo cancelamento: o crédito consumido não volta sozinho. O caminho é o estorno de crédito.
- A janela **Cancelar Cobrança** informa que, se não restar nenhuma cobrança ativa, a proposta volta para NOVO.
- **Abonar diferença** só aparece quando a proposta tem pagamento confirmado e ainda há saldo. O valor é sempre o saldo inteiro, calculado pelo sistema; vira desconto, o total é recalculado e a ação fica no Histórico. Não vale para proposta avulsa.
- Proposta avulsa ou sem produto ativo, depois de paga, não pode ser alterada por nenhum perfil. Histórico e Pagamentos continuam disponíveis.
- O link da área do cliente só deixa pagar enquanto o pedido espera pagamento (NOVO, AGUARDANDO, APROVADO ou LIBERADO). Ele não oferece boleto, faturado nem Cartão Asaas, e não vale para proposta avulsa. O link de um pedido é sempre o mesmo.
- Na área do cliente, se já existe uma cobrança aberta de PIX ou cartão com o valor exato que falta e ainda não vencida, a página reaproveita essa cobrança em vez de criar outra.

## O que não confundir

- **Excluir** (na linha) e **Cancelar cobrança** (no detalhe): abrem a mesma janela. A cobrança não é apagada; ela fica cancelada e sai da lista de ativas.
- **Cancelar cobrança** e **Cancelar recebível**: a cobrança é o que nasce nesta aba; o recebível (título) é cada parcela do faturado na Carteira. Cancelar um não cancela o outro.
- **Cancelar recebível** e **Refazer boleto** (Carteira): o primeiro tira a parcela do Contas a receber; o segundo só troca o boleto e mantém a parcela.
- **Não confirmado** e não pago: **Não confirmado** é cobrança emitida e ainda não paga. Cobrança paga que espera a Conferência aparece como **Pago / A liberar**.
- **A vencer** e **Confirmado**: **A vencer** é faturado ainda não conferido; depois da Conferência a linha mostra **Confirmado**, mesmo com os títulos ainda por vencer.
- **Analisar condição** e **Analisar crédito**: a primeira aprova, altera ou reprova a condição de pagamento de um faturado; a segunda mostra o limite do cliente e permite alterá-lo.
- **Confirmar Autorização** e **Confirmar Liberação**: a autorização aprova o faturamento e manda a cobrança para a Conferência; a liberação é a conferência em si.
- **Faturado** e **E-Faturado**: é a mesma forma. Na escolha principal aparece **Faturado**; na forma secundária do pagamento combinado aparece **E-Faturado**.
- **Cartão de crédito** e **Cartão Asaas**: são dois provedores. O Asaas é a segunda opção e só existe para a Ideal Gráfica.
- **E-Crédito** e **Limite de crédito**: E-Crédito é dinheiro que o cliente já tem a favor na Conta Corrente; limite de crédito é quanto ele pode comprar faturado.
- **Saldo restante a cobrar**, **Saldo na Conta Corrente** e **Cliente com débito em aberto**: o primeiro é o que falta cobrar nesta proposta; o segundo é crédito do cliente; o terceiro é dívida do cliente fora desta proposta.
- **Abonar diferença** e **Bonificar (absorver comercialmente)**: o abono é o botão desta aba, só para administrador, e vira desconto na proposta; a bonificação é uma opção da janela **Diferença Financeira**.
- **Link pgto. externo** e o link de uma cobrança: o primeiro é o link do pedido, onde o cliente escolhe como pagar o que falta; o segundo paga só aquela cobrança.
- **Liberar para pedido** (detalhe da cobrança) não é a liberação para a produção.
- Menu **Acoes** do topo da proposta e menu **Acoes** do detalhe da cobrança: o primeiro tem as ações da proposta (**Link pgto. externo**, entre outras); o segundo, as da cobrança.

## Erros comuns

| O que aparece | Por que acontece | O que fazer |
|---|---|---|
| "Você deve salvar as alterações antes de acessar a aba Pagamentos." | A proposta tem alteração não salva. | Clique em **Salvar e continuar**. |
| "Resolva a diferença financeira pendente antes de acessar Pagamentos." | A proposta paga foi alterada e a diferença não foi tratada. | Clique em **Resolver agora** na faixa **Revisão financeira pendente**. |
| "Para gerar ou gerenciar cobranças, precisamos sincronizar os dados da proposta." | A proposta ainda não foi salva. | Clique em **Salvar proposta agora**. |
| "Não foi possível carregar as cobranças desta proposta." | A lista de cobranças não carregou. | Clique em **Recarregar cobranças** antes de gerar qualquer cobrança, para não duplicar. |
| "Cadastre ou vincule um cliente antes de gerar cobrança." | A proposta é orçamento rápido, sem cliente cadastrado. | Vincule um cliente cadastrado na aba Geral. |
| "Esta proposta já foi totalmente cobrada (saldo restante é R$ 0,00)." | As cobranças ativas já somam o total. | Cancele a cobrança errada antes de gerar outra. |
| "Informe a OS Ideal temporária para gerar a cobrança." | **OS Ideal \*** em branco. | Preencha o número da OS. |
| "Selecione uma forma de pagamento." | Nenhuma forma marcada. | Escolha a forma. |
| "Selecione uma condição de pagamento." | Faturado ou E-Permuta sem condição. | Escolha a **Condição de pagamento \***. |
| "O valor da cobrança (R$ ...) não pode ser maior que o saldo restante (R$ ...)." | O valor digitado passa do saldo. | Reduza o valor. |
| "O frete precisa ser atualizado" | O peso mudou depois da cotação, ou falta o frete complementar. | Clique em **Recalcular frete**, cote e aplique o frete na aba **Fretes** e volte para gerar a cobrança. Se ao aplicar aparecer em vermelho que a opção não está na cotação, recarregue a página e cote de novo: isso acontecia sempre com Motoboy, São Miguel e VEPPO até a correção de 08/10/2026 (commit `2387164`). |
| "Cliente sem e-mail cadastrado para geração do boleto." | O contato e o cliente estão sem e-mail. | Preencha o e-mail no cadastro. |
| "Documento (CPF/CNPJ) do cliente é obrigatório para gerar cobrança real." | Cadastro sem documento. | Complete o cadastro do cliente. |
| "CEP do endereço de entrega é obrigatório para gerar cobrança real." (ou logradouro, cidade, UF) | Endereço de entrega incompleto. | Complete o endereço na aba Geral. |
| **Telefone do cliente impede a cobrança** | Boleto ou cartão com telefone inválido no cadastro de quem paga. | Informe o telefone correto na própria janela e gere de novo. |
| "Cartão Asaas indisponível para esta empresa" | A empresa recebedora não é a IDEAL GRÁFICA EXPRESSA EIRELI. | Escolha outra forma de pagamento. |
| "Carregando cobranças da proposta" — "Aguarde alguns instantes e clique em gerar novamente." | As cobranças ainda não terminaram de carregar. | Espere e clique de novo. |
| **Faturamento em análise** | O cliente não tem limite livre, tem faturamento vencido ou restrição. | Aguarde o financeiro analisar a condição. |
| "Falha ao aplicar crédito" — "Saldo insuficiente. Disponível: R$ ... Solicitado: R$ ..." | O saldo de crédito mudou ou é menor que o valor pedido. | Confira o saldo e reduza o valor. |
| "Sua sessão expirou" — "Nada foi cobrado e o crédito do cliente segue intacto. ..." | A sessão caiu antes de aplicar o crédito. | Saia, entre de novo e repita. |
| "Cobrança Parcial" | No pagamento combinado, o crédito foi aplicado, mas a segunda cobrança falhou e ficou pendente. | Não repita o crédito. Leia o aviso, que diz o que falhou, e confira na lista a segunda cobrança, que ficou pendente. |
| "Cobrança criada, mas a lista não recarregou" | A cobrança foi gravada e a releitura falhou. | Atualize a página. |
| "Sem permissão para cancelar cobrança" (dica do botão **Excluir** apagado) | O perfil não pode cancelar cobrança. | Peça a quem tem a permissão. |
| "Esta permissão só cancela cobrança emitida e não paga (A_RECEBER)." | Perfil com cancelamento restrito tentando cancelar cobrança paga ou faturada. | Peça ao financeiro. |
| "Cobrança vinculada à Conta Corrente. Cancelamento restrito ao financeiro." | A cobrança reservou débito do cliente. | Peça ao financeiro. |
| "Acesso negado a esta cobrança." | A proposta está fora do que o seu perfil enxerga. | Peça ao responsável pela proposta ou ao financeiro. |
| "Esta cobrança já foi recebida em ... Cancelar não devolve o dinheiro — o caso é devolução, não cancelamento." | A cobrança está paga. | Trate como devolução com o financeiro. |
| "O título ... desta cobrança ... foi liquidado ... A cobrança inteira vira devolução — não cancele por aqui." | Uma parcela do faturado já foi paga. | Trate como devolução com o financeiro. |
| "A proposta ... tem NF-e nº ... autorizada. Cancele a nota em Fiscal › Notas Fiscais antes de cancelar a cobrança." | Há nota fiscal autorizada na proposta. | Clique em **Ir para Notas Fiscais** e cancele a nota. |
| "Proposta ... está ... Peça ao gerente para devolver a proposta para REVISAO ATENDENTE antes de cancelar a cobrança." | A proposta já entrou na produção. | Peça ao gerente; depois cancele. |
| "Esta cobrança tem o título ... em aberto no banco ... Cancele o título primeiro em Contas a Receber — a cobrança continua ativa e volta para o Registro de Recebíveis." | Faturado com título em aberto. | Clique em **Ir para Contas a Receber**, cancele o título e volte para cancelar a cobrança. |
| "A API bancária recusou o cancelamento do Boleto. Nenhuma alteração local foi feita." | O banco não aceitou cancelar. | Tente de novo mais tarde; a cobrança continua ativa. |
| "Duplicidade detectada! A parcela ... desta origem já possui um boleto ativo no Contas a Receber ..." | Tentativa de lançar de novo uma parcela que ainda tem título ativo. | Cancele o título atual antes de refaturar a parcela. |
| **Não é possível confirmar esta cobrança** — "A soma das cobranças é inferior ao total da proposta." | Falta cobrança para cobrir o total, ou o total mudou. | Gere a cobrança do saldo, ou acerte o total, e confirme de novo. |
| "Somente administradores podem abonar diferença." | Usuário sem perfil de administrador. | Peça ao administrador. |
| "Não há saldo pendente a abonar nesta proposta ..." | A diferença já foi coberta por cobrança, abono anterior ou E-Crédito. | Nada a fazer. |
| "Não foi possível gerar o link." | A área do cliente está desligada no ambiente ou a proposta não foi encontrada. | Leia a descrição do aviso e avise o administrador. |
| Na área do cliente: "O valor deste pedido está em revisão. Fale com seu atendente." | O total gravado do pedido não bate com a soma dos itens. | Abra a proposta, confira os itens e o total e salve. |
| Na área do cliente: "Este pedido já está em andamento." | O pedido já passou da fase de pagamento. | Cobre o saldo por esta aba. |

## Veja também

- [Proposta: visão geral e abas](proposta.md)
- [Proposta: aba Geral](proposta-geral.md)
- [Proposta: aba Fretes](proposta-fretes.md)
- [Proposta: abas Produção / Expedição, Boletim e Histórico](proposta-producao-boletim-historico.md)
- [Conferência](conferencia.md)
- [Carteira (contas a receber)](carteira.md)
- [Registro de recebíveis](registro-de-recebiveis.md)
- [Notas fiscais](notas-fiscais.md)
- [Pedidos (lista)](pedidos.md)

## Arquivos de origem

Arquivos de código de onde esta ficha saiu. O `scripts/checar-manual.mjs` lê esta lista: quando um deles muda e a ficha não, ele avisa. Um caminho por item, entre crases, a partir da raiz do repositório; pasta termina com `/` e vale para tudo dentro dela.

- `src/features/orcamentos/OrcamentoFormPage.tsx`
- `src/features/orcamentos/components/DiferencaFinanceiraModal.tsx`
- `src/features/orcamentos/services/frete-desatualizado.ts`
- `src/features/cobrancas/PropostaCobrancaPanel.tsx`
- `src/features/cobrancas/CobrancaDetail.tsx`
- `src/features/cobrancas/CobrancaActionsMenu.tsx`
- `src/features/cobrancas/CancelCobrancaModal.tsx`
- `src/features/cobrancas/cancelamento-elegibilidade.ts`
- `src/features/cobrancas/cancelamento-pago.ts`
- `src/features/cobrancas/AutorizarFaturamentoModal.tsx`
- `src/features/cobrancas/AnaliseCreditoModal.tsx`
- `src/features/cobrancas/ConfirmarLiberacaoModal.tsx`
- `src/features/cobrancas/ConferenciaFinanceiraAlertaModal.tsx`
- `src/features/cobrancas/CorrigirTelefonePagadorModal.tsx`
- `src/features/cobrancas/PrepararBoletosModal.tsx`
- `src/features/cobrancas/CobrancasProvider.tsx`
- `src/features/cobrancas/cobrancas-utils.ts`
- `src/features/contas-a-receber/registro-recebiveis/RegistroRecebiveisPage.tsx`
- `src/features/contas-a-receber/registro-recebiveis/services/registro-recebiveis.service.ts`
- `src/features/contas-a-receber/ContasReceberPage.tsx`
- `src/features/contas-a-receber/services/refazer-boleto.ts`
- `src/features/area-cliente/lib/copiar-link-pagamento.ts`
- `src/features/area-cliente/services/area-cliente.server.ts`
- `src/app/p/[token]/area-cliente-view.tsx`
- `src/app/api/area-cliente/link/route.ts`
- `src/app/api/cobrancas/pode-cancelar/route.ts`
- `src/app/api/cobrancas/cancelar-externo/route.ts`
- `src/app/api/cobrancas/cancelar-pago/route.ts`
- `src/app/api/cobrancas/cancelar-boleto-faturado/route.ts`
- `src/app/api/cobrancas/confirmar/route.ts`
- `src/app/api/cobrancas/usar-credito/route.ts`
- `src/app/api/cobrancas/pagamento-combinado/route.ts`
- `src/app/api/cobrancas/aprovar-faturado-automatico/route.ts`
- `src/app/api/orcamentos/abonar-diferenca/route.ts`
- `src/lib/formatters/status.ts`
- `src/lib/mocks/pagamentos.mock.ts`

> **Mudança desta revisão:** 08/10/2026 — o identificador das opções de Motoboy, Transportadora São Miguel e VEPPO deixou de mudar a cada cotação, e por isso o frete complementar desses transportes volta a ser aplicado (commit `2387164`).
