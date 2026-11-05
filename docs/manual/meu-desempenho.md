# Meu desempenho (painel do vendedor)

> **Última revisão:** 05/11/2026
> **Caminho no menu:** Meu desempenho
> **Endereço:** `/meu-desempenho`

## Para que serve

É o painel do vendedor: faturamento, pedidos faturados, ticket médio e conversão do período, a evolução do faturamento, a curva ABC dos clientes, as propostas por status e os últimos pagamentos. Cada número compara o período escolhido com o período anterior equivalente.

## Quem acessa

- O vendedor vê só os próprios números. É a tela inicial dele, e o Dashboard o traz para cá.
- Administrador e super admin abrem em **Consulta** e escolhem o vendedor numa lista ao lado do período.
- Os outros perfis veem "Página exclusiva do perfil vendedor."

## Botões e ações da tela

| Nome na tela | Onde fica | O que faz |
|---|---|---|
| Lista de período | Canto do título | **Hoje**, **Últimos 7 dias**, **Mês atual**, **Mês anterior**, **Últimos 30 dias**, **Trimestre**, **Semestre**, **Ano** ou **Personalizado**. Escolher um item já atualiza a tela. O padrão é **Mês atual**. |
| Campos de data e **Aplicar** | Só em **Personalizado** | Escreva as duas datas e clique em **Aplicar** (ou Enter). Até lá a tela não recarrega. |
| Lista de vendedores | Ao lado do selo **Consulta**, só para administrador | Troca o vendedor consultado. |

## Passo a passo

### Ver o mês fechado anterior

1. Na lista de período, escolha **Mês anterior**. A tela mostra do dia 1 ao último dia do mês passado e compara com o mês antes dele.

### Escolher um período personalizado

1. Na lista de período, escolha **Personalizado**.
2. Digite ou escolha a data inicial e a data final.
3. Clique em **Aplicar**.

## Regras e bloqueios

- O período e a comparação "vs período anterior" seguem as mesmas regras do [Dashboard](dashboard.md). O **Personalizado** de 01/11 a 05/11 compara com 01/10 a 05/10, igual ao **Mês atual**.
- A venda conta para o vendedor dono da proposta, qualquer que seja quem lançou o pagamento.

## O que não confundir

- **Meu desempenho** × [Dashboard](dashboard.md): o Meu desempenho mostra só as vendas de um vendedor; o Dashboard mostra a empresa inteira, com o mesmo seletor de período.

## Erros comuns

| O que aparece | Por que acontece | O que fazer |
|---|---|---|
| Página exclusiva do perfil vendedor. | O perfil não é de vendedor nem de administrador | Usar o [Dashboard](dashboard.md). |
| A data inicial é depois da final. | No **Personalizado**, o início ficou depois do fim | Corrigir uma das datas. |

## Veja também

- [Dashboard](dashboard.md)
- [Relatório: Pagamento de comissão](relatorio-pagamento-comissao.md)

## Arquivos de origem

Arquivos de código de onde esta ficha saiu. O `scripts/checar-manual.mjs` lê esta lista: quando um deles muda e a ficha não, ele avisa. Um caminho por item, entre crases, a partir da raiz do repositório; pasta termina com `/` e vale para tudo dentro dela.

- `src/features/meu-desempenho/`
- `src/components/common/PeriodSelector.tsx`
- `src/lib/period.ts`
