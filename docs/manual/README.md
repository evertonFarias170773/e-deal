# Manual do Vibe

Manual de uso do Vibe, escrito para quem opera o sistema. O Maestro também consulta estas fichas para responder dúvidas de uso.

Cada ficha cobre uma tela ou um fluxo e segue sempre o mesmo formato ([_MODELO.md](_MODELO.md)):

1. última revisão, caminho no menu e endereço;
2. para que serve;
3. quem acessa;
4. botões e ações da tela, com os nomes exatos;
5. passo a passo;
6. regras e bloqueios;
7. o que não confundir;
8. erros comuns;
9. veja também;
10. arquivos de origem (os arquivos de código de onde a ficha saiu).

## Fichas

### Pedidos e proposta

- [Pedidos (lista)](pedidos.md)
- [Proposta: visão geral e abas](proposta.md)
- [Proposta: aba Geral](proposta-geral.md)
- [Proposta: aba Orçamento (produtos)](proposta-produtos.md)
- [Proposta: aba Fretes](proposta-fretes.md)
- [Proposta: aba Pagamentos](proposta-pagamentos.md)
- [Proposta: aba Artes](proposta-artes.md)
- [Proposta: aba Pedido (Boletim Técnico & Lotes)](proposta-pedido.md)
- [Proposta: abas Produção e Histórico, e o boletim](proposta-producao-boletim-historico.md)

### Financeiro

- [Conferência](conferencia.md)
- [Carteira (contas a receber)](carteira.md)
- [Registro de recebíveis](registro-de-recebiveis.md)
- [Notas fiscais](notas-fiscais.md)

### Operação

- [Produção (ordens de serviço)](producao.md)
- [Expedição](expedicao.md)
- [Tarefas](tarefas.md)

## Como manter

- Toda mudança que o usuário percebe (tela, botão, aviso, fluxo ou regra visível) atualiza a ficha correspondente **no mesmo commit**, com a data nova em "Última revisão". A regra completa está no [AGENTS.md](../../AGENTS.md).
- Mudança só interna (refatoração, desempenho, banco sem efeito na tela) não precisa mexer no manual.
- A seção "Arquivos de origem" de cada ficha diz de quais arquivos de código ela saiu. `node scripts/checar-manual.mjs` lê essas listas e avisa quando um arquivo de origem mudou sem a ficha mudar, e quando há tela alterada que não pertence a nenhuma ficha. Ele só avisa; não bloqueia o commit.
- `node scripts/checar-manual.mjs --origens` confere se as listas ainda apontam para arquivos que existem.
- Tela nova ganha ficha nova, copiada do [_MODELO.md](_MODELO.md) e listada aqui.

## Como escrever

- Língua de usuário: nomes de botões, campos e avisos exatamente como aparecem na tela. Sem nome de tabela, função ou arquivo no texto de uso (os arquivos ficam só na última seção).
- Regras reais, do jeito que o usuário as sente: "Cancelar só uma parcela não deixa relançar."
- Só o que o sistema faz hoje. Na dúvida, confira no código antes de escrever.
- Em "O que não confundir", registre os pares que geram dúvida: duas telas, dois botões, dois status ou dois números de nome parecido.
