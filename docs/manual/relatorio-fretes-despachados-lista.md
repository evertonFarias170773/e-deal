# Relatório: Fretes despachados (lista)

> **Última revisão:** 29/10/2026 (rótulos PEDIDO e tipo de frete sem underline)
> **Caminho no menu:** Relatórios → Expedição → Fretes despachados (lista)
> **Endereço:** `/relatorios/expedicao/fretes-despachados-lista`

## Para que serve

Lista **todos os despachos** de um período, um por linha, sem agrupar: o número do pedido, o tipo de frete, a data do despacho, a cidade de destino, o conhecimento do frete e o frete cobrado do cliente. Serve para conferir despacho a despacho o que o relatório **Frete cobrado por transportadora** mostra somado.

O relatório só mostra números; não altera nada.

## Quem acessa

- Vê o relatório quem tem a permissão **Relatório: Fretes despachados (lista)** no perfil, além de Administrador e Super Admin. Por enquanto nenhum perfil recebe essa permissão: na prática, só administradores.
- Quem não tem a permissão não vê o relatório no menu e, se abrir o endereço, recebe acesso negado. O servidor confere de novo a mesma permissão ao gerar a tela, o CSV e o PDF.

## Botões e ações da tela

Nomes exatamente como aparecem na tela.

| Nome na tela | Onde fica | O que faz |
|---|---|---|
| **Mês atual** | Filtros, período | Do dia 1º do mês até hoje. É o período ao abrir a tela. |
| **Mês anterior** | Filtros, período | O mês anterior inteiro. |
| **Personalizado** | Filtros, período | Abre os campos de data inicial e final. O período máximo é de 366 dias. |
| **Tipo de frete** | Filtros | **Todos** ou um tipo, o do despacho: CORREIOS, MOTOBOY, TRANSPORTADORA, RETIRA NO BALCÃO, SEM CUSTO, INDEFINIDO ou Sem tipo. |
| **Limpar filtros** | Filtros | Volta ao padrão. Só aparece quando há filtro ativo. |
| **Anterior** / **Próxima** | Rodapé da tabela | A tela mostra 100 despachos por vez; estes botões trocam de página. |
| **Baixar PDF** | Topo da tela | Gera o PDF com o período inteiro e os filtros da tela e baixa o arquivo. |
| **Imprimir** | Topo da tela | Gera o mesmo PDF e abre a janela de impressão. |
| **Exportar CSV** | Topo da tela | Baixa a planilha com o período inteiro (todas as páginas), com a linha de total no fim. |

## Passo a passo

### Conferir os despachos do mês

1. No menu, abra **Relatórios** e clique em **Expedição**.
2. Clique em **Fretes despachados (lista)**. A tela abre em **Mês atual**.
3. Leia os cartões (**Despachos**, **Frete cobrado**, **Com frete zero** e **Com conhecimento**) e a tabela, em ordem de data de despacho.
4. Use **Próxima** para ver os demais, ou **Exportar CSV** para ter tudo numa planilha.

## Regras e bloqueios

- **A data usada é a data de despacho**, no dia de São Paulo. A lista sai em ordem de data de despacho e, no mesmo dia, de número do pedido. Os títulos das colunas não reordenam a lista.
- **Um pedido aparece uma vez só.** O despacho tem uma linha por pedido; o pedido reenviado aparece com o despacho atual.
- A coluna **PEDIDO** é o número do pedido.
- **Tipo de frete** é o gravado no despacho, escrito sem underline: RETIRA_BALCAO aparece como **RETIRA NO BALCÃO**, SEM_CUSTO como **SEM CUSTO**; os demais (CORREIOS, MOTOBOY, TRANSPORTADORA, INDEFINIDO) como estão. Tela, CSV, PDF e filtro usam os mesmos nomes.
- **Cidade de destino** é a do endereço gravado no despacho; só quando o despacho não gravou endereço vale o endereço da proposta. Num Retira, é a cidade do endereço do cliente, não um envio. A grafia é a do cadastro (pode haver "Porto Alegre" e "PORTO ALEGRE").
- **Conhecimento do frete** é o número digitado no despacho. Na transportadora e no motoboy é o conhecimento; **nos Correios é o código de rastreio** do objeto. Se o despacho não tem o número, vale o objeto da pré-postagem dos Correios. Um aviso conta os despachos de transportadora ou motoboy sem conhecimento.
- **O valor é o frete gravado na proposta**, sem recalcular, o mesmo do relatório **Frete cobrado por transportadora**: o total de despachos e de frete do mesmo período é igual nos dois. Retira e FOB entram com o frete que a proposta tiver, normalmente zero.
- O total (registros e frete) é do período inteiro, mesmo vendo uma página só. O PDF traz os mesmos números da tela.
- Período acima de 366 dias é recusado.

## O que não confundir

- **Frete cobrado** é o que o cliente pagou de frete na proposta, não o custo pago à transportadora, que o ERP não registra.
- **Com conhecimento** conta também os códigos de rastreio dos Correios.

## Erros comuns

| O que aparece | Por que acontece | O que fazer |
|---|---|---|
| Acesso negado | O perfil não tem a permissão **Relatório: Fretes despachados (lista)** | Pedir a um administrador. |
| Sem permissão para este relatório. | A permissão foi retirada com a tela aberta | Entrar de novo; se persistir, falar com um administrador. |
| Período máximo de 366 dias. | O período personalizado passou de um ano | Escolher um período menor. |
| Há registros demais no período. Escolha um período menor. | Mais de 10 mil despachos no período | Escolher um período menor. |
| Não foi possível gerar o relatório. | Falha ao consultar o banco | Tentar de novo. |

## Veja também

- [Relatório: Frete cobrado por transportadora](relatorio-frete-por-transportadora.md)
- [Expedição](expedicao.md)

## Arquivos de origem

Arquivos de código de onde esta ficha saiu. O `scripts/checar-manual.mjs` lê esta lista: quando um deles muda e a ficha não, ele avisa. Um caminho por item, entre crases, a partir da raiz do repositório; pasta termina com `/` e vale para tudo dentro dela.

- `src/features/relatorios/definicoes/fretes-despachados-lista.ts`
- `src/features/relatorios/lib/paginacao.ts`
- `src/features/relatorios/ReportPage.tsx`
- `src/features/relatorios/registro.ts`
- `src/app/api/relatorios/`
