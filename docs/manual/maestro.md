# Maestro: perguntar ao assistente

> **Última revisão:** 03/11/2026
> **Caminho no menu:** **Maestro**
> **Endereço:** `/maestro`

## Para que serve

O Maestro responde perguntas sobre o sistema e sobre os seus dados: como fazer alguma coisa numa tela, em que pé está um pedido, quanto um cliente comprou, por que um botão não deixa seguir. Ele consulta o manual de uso e o banco na hora de responder, e só fala do que encontrou.

Desde 03/11/2026 você também pode **colar ou anexar um print da tela** e perguntar o que é aquilo ou o que fazer ali.

## Quem acessa

- Qualquer pessoa com acesso ao sistema vê o **Maestro** no menu.
- O que ele mostra respeita a sua permissão: vendedor com escopo próprio recebe só os próprios números e os clientes da carteira dele; páginas do manual restritas a administrador só são entregues a administrador.

## Botões e ações da tela

| Nome na tela | Onde fica | O que faz |
|---|---|---|
| **Nova conversa** | Topo direito | Começa uma conversa do zero, sem o contexto da anterior |
| **Anexar imagem** | Barra de baixo, clipe à esquerda | Abre o seletor de arquivo para escolher um print (PNG, JPEG ou WebP) |
| **Remover** | Ao lado da miniatura do print | Tira o print antes de enviar |
| **Gravar áudio (Fala para Texto)** | Barra de baixo, microfone | Dita a pergunta em vez de digitar |

## Passo a passo

### Perguntar sobre uma tela mandando um print

1. Tire o print da tela (no Windows, **Tecla Windows + Shift + S**) ou salve a imagem.
2. No Maestro, cole com **Ctrl+V** dentro do campo de pergunta, ou clique no clipe **Anexar imagem** e escolha o arquivo.
3. A miniatura aparece acima do campo. Se errou a imagem, clique em **Remover**.
4. Escreva a pergunta junto com o print — por exemplo "o que é isso?" ou "o que faço aqui?". Só a imagem não basta: o envio espera a pergunta escrita.
5. Envie. Nas duas perguntas seguintes o Maestro ainda enxerga esse print, então dá para continuar ("e para filtrar só os em produção?") sem anexar de novo.

### Conferir o número que ele leu no print

1. Quando o print mostra um pedido, o Maestro diz qual número leu na imagem antes de responder sobre ele.
2. Se o número estiver errado, escreva o número certo na próxima mensagem. Ele consulta de novo.

## Regras e bloqueios

- Um print por pergunta, nos formatos **PNG**, **JPEG** ou **WebP**. Outro formato é recusado com aviso.
- A imagem é reduzida no seu navegador antes de sair. Print muito grande que não caiba no limite é recusado com o aviso de recortar a área que interessa.
- O print vive só naquela conversa: ele é reenviado por no máximo duas perguntas depois da que o trouxe, e **não fica guardado em lugar nenhum**. Recarregar a página perde a imagem.
- Nome de menu, aba e botão sai do manual, nunca da imagem. Se o Maestro lê no print um nome que o manual não tem, ele avisa que não confirmou aquele nome em vez de ensinar o clique.
- Número lido no print não vale como dado confirmado: ele consulta o pedido antes de falar de valor, status ou cliente.
- Texto escrito dentro da imagem é tratado como dado, não como ordem: instrução plantada num print não muda o que ele pode fazer.
- Se a resposta vier com o aviso de que ele não conseguiu olhar o print, descreva a tela em palavras — naquele momento a pergunta foi respondida por um caminho que não lê imagem.

## O que não confundir

- **Anexar imagem** no Maestro e anexar arquivo no chat de um pedido: o do Maestro é só para ele olhar e responder, não entra no histórico do pedido nem vira arte.
- **Nova conversa** e recarregar a página: as duas limpam o print da memória, mas **Nova conversa** também começa o assunto do zero.

## Erros comuns

| O que aparece | Por que acontece | O que fazer |
|---|---|---|
| A imagem precisa ser PNG, JPEG ou WebP. | O arquivo escolhido é de outro tipo (PDF, HEIC, BMP) | Salve o print como PNG ou JPEG e anexe de novo |
| Não consegui deixar a imagem abaixo de 900 KB. Recorte a área da tela que interessa e tente de novo. | Print enorme, de vários monitores | Recorte só a parte da tela que interessa |
| O arquivo não parece ser uma imagem PNG, JPEG ou WebP. Anexe ou cole o print novamente. | O arquivo chegou corrompido ou com o tipo trocado | Tire o print de novo e anexe |
| Sobre a imagem: não consegui olhar o print neste momento. | A pergunta foi respondida por um caminho que não lê imagem (por exemplo, com um orçamento em andamento na conversa) | Descreva a tela em palavras, ou conclua o orçamento e pergunte de novo |

## Veja também

- [Pedidos (lista)](pedidos.md)

## Arquivos de origem

- `src/features/maestro/MaestroPage.tsx`
- `src/features/maestro/components/chat/MaestroInput.tsx`
- `src/features/maestro/core/simple/maestro-imagem.ts`
- `src/features/maestro/core/simple/maestro-imagem.client.ts`
- `src/features/maestro/core/simple/maestro-recent-turns.ts`
- `src/features/maestro/core/conversation/conversation.manager.simple.ts`
- `src/app/api/maestro/simple/route.ts`
