# Relatório: Frete cobrado por transportadora

> **Última revisão:** 27/10/2026
> **Caminho no menu:** Relatórios → Expedição → Frete cobrado por transportadora
> **Endereço:** `/relatorios/expedicao/frete-por-transportadora`

## Para que serve

Mostra quanto de frete foi **cobrado dos clientes** nos pedidos despachados em um período, separado por transportadora e modalidade (CIF, FOB, Retira): quantos pedidos, quantos tiveram frete zero e o total cobrado.

**Não é o custo pago à transportadora.** O ERP não registra quanto a empresa paga a cada transportadora; o relatório mostra o frete que a proposta cobrou do cliente. O relatório só mostra números; não altera nada.

## Quem acessa

- Vê o relatório quem tem a permissão **Relatório: Frete cobrado por transportadora** no perfil, além de Administrador e Super Admin. Por enquanto nenhum perfil recebe essa permissão: na prática, só administradores.
- Quem não tem a permissão não vê o relatório no menu e, se abrir o endereço, recebe acesso negado. O servidor confere de novo a mesma permissão ao gerar a tela e o PDF.

## Botões e ações da tela

Nomes exatamente como aparecem na tela.

| Nome na tela | Onde fica | O que faz |
|---|---|---|
| **Mês atual** | Filtros, período | Do dia 1º do mês até hoje. É o período ao abrir a tela. |
| **Mês anterior** | Filtros, período | O mês anterior inteiro. |
| **Personalizado** | Filtros, período | Abre os campos de data inicial e final. O período máximo é de 366 dias. |
| **Modalidade** | Filtros | Todas as modalidades ou uma: CIF, FOB, Retira ou Sem modalidade. |
| **Limpar filtros** | Filtros | Volta ao padrão. Só aparece quando há filtro ativo. |
| **Baixar PDF** | Topo da tela | Gera o PDF com o período e os filtros da tela e baixa o arquivo. |
| **Imprimir** | Topo da tela | Gera o mesmo PDF e abre a janela de impressão. |
| **Exportar CSV** | Topo da tela | Baixa a tabela em planilha, com a linha de total no fim. |
| Título de cada coluna | Cabeçalho da tabela | Clique para ordenar; clique de novo para inverter. |

## Passo a passo

### Ver o frete cobrado do mês por transportadora

1. No menu, abra **Relatórios** e clique em **Expedição**.
2. Clique em **Frete cobrado por transportadora**. A tela abre em **Mês atual**.
3. Leia os cartões (**Pedidos despachados**, **Frete cobrado**, **Com frete zero** e **Frete médio**) e a tabela, da transportadora que mais cobrou para a que menos cobrou.
4. Confira o aviso de pedidos CIF com frete zero: parte deles pode ser frete subsidiado.

## Regras e bloqueios

- **A data usada é a data de despacho** do pedido, no dia de São Paulo, escrita no alto da tela e do PDF.
- **Transportadora e modalidade são as do despacho**, e não as do orçamento: se o despacho saiu por outra transportadora, vale a do despacho.
- **O valor é o frete gravado na proposta**, sem recalcular: o mesmo que a Expedição mostra como frete cobrado.
- Cada combinação de transportadora e modalidade aparece em linha própria (por exemplo, a mesma transportadora em CIF e em FOB).
- **Retira e FOB** entram com o frete da proposta, que normalmente é zero (no FOB quem paga a transportadora é o cliente). Se algum pedido Retira ou FOB tiver frete cobrado, a tela avisa.
- A coluna **Com frete zero** conta os pedidos sem frete cobrado. Os pedidos **CIF com frete zero** são listados no aviso, porque parte deles é frete subsidiado.
- Os totais vêm calculados pelo sistema, no servidor, e não somados na tela. O PDF traz os mesmos números da tela.
- Período acima de 366 dias é recusado.

## O que não confundir

- **Frete cobrado** é o que o cliente pagou de frete na proposta. **Custo do frete** é o que a empresa paga à transportadora: esse valor não está no ERP.
- **Com frete zero** não é o mesmo que subsídio: Retira e FOB têm frete zero por natureza; só o CIF com frete zero indica possível subsídio.

## Erros comuns

| O que aparece | Por que acontece | O que fazer |
|---|---|---|
| Acesso negado | O perfil não tem a permissão **Relatório: Frete cobrado por transportadora** | Pedir a um administrador. |
| Sem permissão para este relatório. | A permissão foi retirada com a tela aberta | Entrar de novo; se persistir, falar com um administrador. |
| Período máximo de 366 dias. | O período personalizado passou de um ano | Escolher um período menor. |
| Não foi possível gerar o relatório. | Falha ao consultar o banco, ou despachos demais no período | Tentar de novo ou escolher um período menor. |

## Veja também

- [Expedição](expedicao.md)

## Arquivos de origem

Arquivos de código de onde esta ficha saiu. O `scripts/checar-manual.mjs` lê esta lista: quando um deles muda e a ficha não, ele avisa. Um caminho por item, entre crases, a partir da raiz do repositório; pasta termina com `/` e vale para tudo dentro dela.

- `src/features/relatorios/definicoes/frete-por-transportadora.ts`
- `src/features/relatorios/registro.ts`
- `src/app/api/relatorios/`
