# Proposta: aba Produtos

> **Última revisão:** 01/10/2026
> **Onde fica:** menu **Pedidos** → abrir ou criar uma proposta → aba **Orçamento** (endereço `/orcamentos/<número>/editar?tab=produtos`)

## Para que serve

É onde você monta o que está sendo vendido: escolhe os produtos do catálogo, informa a quantidade, as variações e a descrição, e vê o subtotal de cada item. Também é aqui que a proposta vira avulsa, quando o valor é digitado à mão, sem produto do catálogo.

Na tela, esta aba aparece com o nome **Orçamento** e o bloco se chama **6. Produtos**.

## Quem acessa

- Quem abre a proposta inclui produtos, quantidades, variações e descrição.
- **Valor Unitário (R$)** e **Fixo (R$)** só são editáveis para administrador. Para os demais, o preço é sempre o do produto ou o da tabela do cliente.
- O **Desconto geral** (bloco **8. Resumo do orçamento**) só é editável para administrador, gerente ou perfil com a permissão de desconto geral.
- Em proposta com cobrança, só mexe nos produtos quem tem a permissão **Editar Proposta Paga**. Quem tem a permissão **Editar Proposta com Faturado a Vencer** mexe apenas quando a cobrança é faturada e ainda não foi recebida.

## Passo a passo

### Adicionar um produto

1. Escolha o cliente na aba Geral antes. O preço e a tabela especial dependem dele.
2. Na aba **Orçamento**, clique numa das etiquetas de categoria (**Ingressos de segurança**, **Pulseiras**, **Cordão Credencial**, **Cartão PVC**, **Credencial**) ou digite em **Pesquisar produto por nome, código ou apelido...**.
3. Clique no produto na lista. Cada linha mostra o nome, o código, os apelidos e o **Valor Unit.** Produto que já está na proposta aparece com a marca **Já adicionado**.
4. O item entra aberto, com a quantidade mínima de venda do produto já preenchida e o cursor no campo **Quantidade**.
5. Ajuste a quantidade, escolha as variações e clique em **Salvar item**.

**Limpar Filtro** desfaz a etiqueta ou a pesquisa.

### Preencher o item

1. **Quantidade**: digite a quantidade vendida. Ela não pode ficar abaixo da mínima do produto.
2. **Valor Unitário (R$)** e **Fixo (R$)**: vêm do cadastro do produto. Só administrador altera.
3. **Subtotal final**: é calculado pela tela. A conta é quantidade × (valor unitário + extras das variações) + valor fixo, menos o abatimento da tabela especial do cliente.
4. **Descrição do produto**: detalhes, modelo, acabamento ou condições daquele item.
5. **Configuração de Variações**: escolha uma opção em cada grupo. Grupo com asterisco é obrigatório. Cada opção mostra quanto soma ao preço unitário e ao peso.
6. Grupo com a nota "pode escolher mais de uma" usa caixas de marcação. Valor e peso somam todas as marcadas.
7. Clique em **Salvar item** ou aperte Enter. O sistema salva a proposta inteira e fecha o cartão do item.

O topo do cartão mostra o **Peso parcial** do item. O peso entra na cotação do frete: mudar produto ou quantidade refaz a cotação.

### Deixar o item gravar sozinho

1. Em proposta que já tem número e não tem cobrança, altere **Quantidade**, **Valor Unitário (R$)** ou **Fixo (R$)**.
2. Saia do campo (Tab ou clique fora). Se o valor mudou e é válido, a proposta é gravada e aparece **Item salvo.**
3. O cartão continua aberto para você seguir para o próximo campo.

Valor inválido (quantidade zero ou abaixo da mínima) não grava e não avisa ao sair do campo. O motivo aparece quando você clica em **Salvar item**.

Variações e descrição não gravam sozinhas: use **Salvar item**.

### Editar, duplicar ou repetir um produto

1. No cartão fechado do item, clique em **Editar** para abri-lo de novo.
2. Clique em **Duplicar** para criar uma linha igual logo abaixo, com a mesma quantidade, preço, descrição e variações. A cópia não leva os modelos da aba Pedido.
3. Ao adicionar um produto que já está na proposta, a tela pergunta o que fazer:
   - **Atualizar quantidade** abre o item que já existe.
   - **Adicionar novo item** cria outra linha do mesmo produto, para outra configuração ou variação.
   - **Cancelar** não faz nada.

### Remover um produto

1. Clique na lixeira do item.
2. Em proposta sem cobrança, a tela pergunta **Excluir produto?** Clique em **Sim, excluir**.
3. Se o item já tinha sido salvo, ele é apagado na hora, junto com os modelos dele na aba Pedido. Não tem como restaurar.
4. Em proposta com cobrança, para quem tem a permissão de editar proposta paga, a pergunta é **Inativar produto?** Clique em **Sim, inativar**.
5. O item inativado sai da lista e do total, mas fica guardado como removido. Salve a proposta para a inativação valer. Se o total mudar, a diferença financeira é tratada no salvamento.

### Ver e restaurar itens removidos

1. Abaixo da lista, clique em **Mostrar removidos (N)**. O link só aparece quando há item removido.
2. Os removidos aparecem riscados, com a marca **Removido (Inativo)**.
3. Clique em **Restaurar** para o item voltar a valer, e salve a proposta.
4. **Ocultar removidos** esconde a lista de novo.

Item removido não entra no total, no peso, na aba Pedido nem na conferência de modelos da aba Artes.

### Entender preço, tabela especial e desconto

1. **Preço do produto**: o valor unitário e o valor fixo vêm do cadastro do produto.
2. **Cliente com preço fixo**: quando o cliente tem preço fixo cadastrado para aquele produto, vale esse preço, e o campo **Fixo (R$)** fica zerado e travado.
3. **Tabela especial (bônus)**: quando o cliente tem tabela especial, cada item mostra a faixa **Tabela especial do cliente aplicada** com o percentual, e o subtotal já sai com o abatimento. O Resumo mostra a mesma linha. Cliente com preço fixo não recebe o percentual.
4. **Tabela especial congelada**: depois do primeiro pagamento confirmado, o percentual da proposta fica como estava. Mudar a tabela no cadastro do cliente não altera a proposta já paga.
5. **Desconto geral**: fica no bloco **8. Resumo do orçamento**, na coluna da direita. Escolha **%** ou **R$** e digite o valor. Ele incide sobre o subtotal dos produtos e nunca passa dele.
6. O item não tem campo de desconto próprio. Desconto é o geral, ou ajuste de valor unitário feito por administrador.

Para quem não é administrador, o preço é reaplicado pelo produto ou pela tabela do cliente a cada alteração do item.

### Fazer uma proposta avulsa

1. Marque **Proposta avulsa (orçamento sem produtos cadastrados)**.
2. Se a proposta já tem produtos, a tela pergunta **Marcar como proposta avulsa?** e avisa que os produtos e os modelos serão removidos. Confirme em **Sim, remover os produtos**.
3. Preencha **Valor total dos produtos (R$) \***. Ao marcar a caixa, o campo já vem com o total que a proposta tinha.
4. Na aba Fretes, informe o serviço e o valor do frete. Ele nasce como "Frete Incluso", com valor zero.
5. Salve.

Proposta avulsa não tem as abas **Pedido** e **Artes** e não vai para a produção.

### Vender produto de prateleira

1. Produto de prateleira é o vendido pronto, marcado assim no cadastro do produto. Na proposta ele é adicionado como qualquer outro.
2. Quando **todos** os produtos ativos da proposta são de prateleira, a aba **Artes** não aparece.
3. Nesse caso, quando o pagamento cobre o total, a proposta passa direto para **REVISAO ATENDENTE**, sem etapa de arte.
4. Basta um produto que não seja de prateleira para a proposta passar por arte normalmente.

A marcação de prateleira é guardada no item no momento em que ele entra na proposta.

## Regras e bloqueios

- Não dá para salvar proposta sem nenhum produto, a não ser que ela seja avulsa.
- Não dá para salvar item com quantidade zero ou abaixo da quantidade mínima de venda do produto.
- Não dá para salvar item sem escolher as variações obrigatórias.
- Não dá para salvar item com subtotal zerado.
- **Salvar item** fica desabilitado enquanto a cotação de frete está rodando, porque salvar o item é salvar a proposta, e a proposta precisa de frete definido.
- Com cobrança ativa e sem a permissão de editar proposta paga, a aba inteira fica travada: produtos, quantidades, valores, variações e a caixa de proposta avulsa. O botão **Duplicar** some.
- Com revisão financeira pendente, a aba também fica travada, mesmo para quem tem permissão. Resolva a diferença antes.
- Com a proposta em AGUARDANDO, a lixeira fica desabilitada para quem não tem a permissão de editar proposta paga: "Item não pode ser removido neste status".
- Com cobrança ativa, não dá para remover produto sem a permissão. Cancele a cobrança pendente antes.
- Mesmo com permissão, não dá para inativar produto que já tem pedido, arte ou produção vinculada. Cancele ou conclua a produção (e a nota, se houver) antes.
- Com cobrança enviada ao cliente e ainda não paga, não dá para mudar quantidade, preço, produto ou desconto: o link de pagamento tem valor fixo. Cancele a cobrança, altere e gere outra.
- Em proposta paga, quem tem permissão altera os produtos, e a diferença de valor é tratada ao salvar. Veja [Proposta: visão geral e abas](proposta.md).
- Proposta avulsa já paga não pode ser alterada por ninguém.
- Com cobrança ativa, os campos do item não gravam sozinhos ao sair do campo. A gravação é pelo **Salvar item**, que mostra os avisos financeiros.
- Trocar a quantidade de um produto que já tem lotes na aba Pedido é permitido. A conferência entre a quantidade do item e a soma dos lotes acontece na liberação para a produção.
- Variação de um grupo que deixou de pertencer ao produto aparece em destaque, com a nota "grupo não vinculado ao produto". Ela continua somando no subtotal até alguém clicar em **Remover** e salvar.

## Erros comuns

| O que aparece | Por que acontece | O que fazer |
|---|---|---|
| **Produtos obrigatórios** — "Adicione pelo menos um produto ao orçamento." | Proposta sem produto e não avulsa. | Adicione um produto ou marque a proposta como avulsa. |
| **Quantidade inválida** — "A quantidade do item deve ser maior que zero." | Item com quantidade zero. | Informe a quantidade. |
| **Quantidade mínima exigida** / **Quantidade mínima não atendida** | Quantidade abaixo da mínima de venda do produto. | Aumente a quantidade até a mínima informada no aviso. |
| **Variação obrigatória** | Falta escolher um grupo obrigatório. | Escolha a opção nos grupos marcados com asterisco. |
| **Subtotal inválido** | Algum produto está com subtotal zerado. | Confira quantidade e preço do item. |
| **Valor inválido** | O subtotal ou o total da proposta está zerado. | Confira os itens ou o valor dos produtos da avulsa. |
| **Valor dos produtos inválido** | Proposta avulsa sem valor dos produtos. | Preencha **Valor total dos produtos (R$)**. |
| **Frete não selecionado** | O item foi salvo sem frete escolhido. | Escolha o frete na aba Fretes e salve de novo. |
| **Remoção bloqueada** — "Não é possível remover produtos pois existe uma cobrança ativa..." | A proposta tem cobrança e seu perfil não pode editá-la. | Cancele a cobrança pendente ou peça a quem tem a permissão. |
| **Inativação bloqueada** — "Este produto já possui pedido/arte/produção vinculada..." | O item já tem modelo, arte ou produção. | Cancele ou conclua a produção (e a nota, se houver) antes. |
| "Item não pode ser removido neste status" | Proposta em AGUARDANDO e perfil sem permissão. | Peça a quem tem a permissão de editar proposta paga. |
| **Erro ao excluir produto** — "O produto não foi encontrado no banco ou a exclusão foi bloqueada. Recarregue a página." | O item já não existe ou a exclusão foi barrada. | Recarregue a página e confira a lista. |
| "Aguarde a cotação do frete terminar" | O **Salvar item** está travado durante a cotação. | Espere alguns segundos e clique de novo. |
| "Esta proposta tem uma cobrança enviada ao cliente no valor de ..." | A alteração muda o valor e a cobrança ainda não foi paga. | Cancele a cobrança na aba Pagamentos, altere e gere uma nova. |
| **Desconto geral não autorizado** | Há desconto geral e seu perfil não pode aplicá-lo. | Zere o desconto ou peça a um gerente ou administrador. |
| "Nenhum produto correspondente encontrado." | A pesquisa não achou produto ativo. | Tente outro nome, o código ou um apelido. |
| **O frete precisa ser atualizado** | A quantidade mudou pela aba Pedido e o peso ficou diferente do cotado. | Atualize o frete na aba Fretes antes de gerar a cobrança. |

## Veja também

- [Proposta: visão geral e abas](proposta.md)
- [Proposta: aba Geral](proposta-geral.md)
- [Proposta: aba Fretes](proposta-fretes.md)
- [Proposta: aba Pagamentos](proposta-pagamentos.md)
- [Proposta: aba Artes](proposta-artes.md)
- [Proposta: aba Pedido (Boletim Técnico & Lotes)](proposta-pedido.md)
- [Pedidos (lista)](pedidos.md)
- [Produção (ordens de serviço)](producao.md)
