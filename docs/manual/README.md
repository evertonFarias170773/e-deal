# Manual do Vibe

Manual de uso do Vibe, escrito para quem opera o sistema. O Maestro também consulta estas páginas para responder dúvidas de uso.

Cada página cobre uma tela ou um fluxo e segue sempre o mesmo formato ([_MODELO.md](_MODELO.md)): para que serve, quem acessa, passo a passo, regras e bloqueios, erros comuns e a data da última revisão.

## Páginas

### Pedidos e proposta

- [Pedidos (lista)](pedidos.md)
- [Proposta: visão geral e abas](proposta.md)
- [Proposta: aba Geral](proposta-geral.md)
- [Proposta: aba Produtos](proposta-produtos.md)
- [Proposta: aba Fretes](proposta-fretes.md)
- [Proposta: aba Pagamentos](proposta-pagamentos.md)
- [Proposta: aba Artes](proposta-artes.md)
- [Proposta: aba Pedido (Boletim Técnico & Lotes)](proposta-pedido.md)
- [Proposta: abas Produção, Boletim e Histórico](proposta-producao-boletim-historico.md)

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

- Toda mudança que o usuário percebe (tela, botão, aviso, fluxo ou regra visível) atualiza a página correspondente **no mesmo commit**, com a data nova em "Última revisão". A regra completa está no [AGENTS.md](../../AGENTS.md).
- Mudança só interna (refatoração, desempenho, banco sem efeito na tela) não precisa mexer no manual.
- `node scripts/checar-manual.mjs` avisa quando há arquivo de tela alterado sem nenhuma página do manual alterada. Ele só avisa; não bloqueia o commit.
- Tela nova ganha página nova, copiada do [_MODELO.md](_MODELO.md) e listada aqui.

## Como escrever

- Língua de usuário: nomes de botões, campos e avisos como aparecem na tela. Sem nome de tabela, função ou arquivo.
- Regras reais, do jeito que o usuário as sente: "Cancelar só uma parcela não deixa relançar."
- Só o que o sistema faz hoje. Na dúvida, confira no código antes de escrever.
