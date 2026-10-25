# Relatório: Notas fiscais (NF-e)

> **Última revisão:** 25/10/2026
> **Caminho no menu:** Relatórios → Financeiro → Notas fiscais (NF-e)
> **Endereço:** `/relatorios/financeiro/notas-fiscais`

## Para que serve

Entrega à contabilidade o que ela precisa para fechar os impostos do mês: a **relação das notas de venda** emitidas (em PDF, com produtos, frete e total) e o **zip com os XML** das NF-e do mês. Cada geração é de uma empresa emitente e de uma série.

É só NF-e (mercadoria). As notas de serviço (NFS-e) não entram. O relatório só lê o que já está guardado: não emite, não cancela e não consulta o provedor fiscal.

## Quem acessa

- Vê o relatório quem tem a permissão **Relatório: Notas fiscais (NF-e)** no perfil, além de Administrador e Super Admin. Nenhum perfil recebe essa permissão sozinho: um administrador marca em Configurações → Perfis e Permissões.
- Quem não tem a permissão não vê o relatório no menu e, se abrir o endereço, recebe acesso negado. O servidor e o banco conferem de novo a mesma permissão na tela, no PDF e no zip.

## Botões e ações da tela

Nomes exatamente como aparecem na tela.

| Nome na tela | Onde fica | O que faz |
|---|---|---|
| **Mês anterior** | Filtros, período | O mês anterior inteiro. É o período ao abrir a tela. |
| **Mês atual** | Filtros, período | Do dia 1º do mês até hoje. |
| **Personalizado** | Filtros, período | Abre os campos de data inicial e final. O período máximo é de 31 dias. |
| **Empresa emitente** | Filtros | **Ideal Gráfica** (padrão), **Ideal Birô** ou **E3 Brindes**. A empresa é sempre uma só. |
| **Série** | Filtros | **Série 2** (padrão, a de produção) ou **Série 1**. |
| **Limpar filtros** | Filtros | Volta ao padrão. Só aparece quando há filtro ativo. |
| **Baixar PDF** | Topo da tela | Gera a "Relação das notas de venda" do mês e baixa o arquivo. |
| **Imprimir** | Topo da tela | Gera o mesmo PDF e abre a janela de impressão. Se o navegador não abrir a impressão direto, o PDF abre em outra aba, onde há o botão de imprimir. |
| **Baixar XML (zip)** | Topo da tela | Baixa o zip com os XML das NF-e do período (nome `MM-AAAA_serie_N_XMLs.zip`). |
| **Exportar CSV** | Topo da tela | Baixa a tabela em planilha, com a linha de total no fim. |
| Título de cada coluna | Cabeçalho da tabela | Clique para ordenar; clique de novo para inverter. |

## Passo a passo

### Gerar os dois arquivos do mês para a contabilidade

1. No menu, abra **Relatórios** e clique em **Financeiro**.
2. Clique em **Notas fiscais (NF-e)**. A tela abre em **Mês anterior**, na **Ideal Gráfica**, **Série 2**.
3. Escolha a **Empresa emitente** (e o período, se não for o mês anterior).
4. Confira os cartões, a lista e os avisos. Os avisos dizem quais notas ficaram fora da lista e quais arquivos não estão no zip.
5. Clique em **Baixar PDF** e em **Baixar XML (zip)**.

## Regras e bloqueios

- **A data usada é a data de emissão da nota**, no dia de São Paulo, escrita no alto da tela e do PDF.
- **A lista traz só as notas autorizadas de venda**: natureza "Venda de produção do estabelecimento". Notas **canceladas** e as de **outra natureza** (por exemplo, "Outra saída de mercadoria não especificada") ficam fora da lista, mas aparecem no aviso e na nota de critério do PDF, com o número de cada uma.
- **Produtos, frete e total são os da própria nota**; nada é recalculado a partir de pagamentos. A linha final do PDF traz o total de notas e as somas.
- Só entram notas de **produção**. Notas de teste (homologação) ficam de fora.
- **O zip traz o XML de todas as NF-e do período** (autorizadas, inclusive as canceladas e as de outra natureza), com o nome da chave de acesso. Dentro do zip vai também um **LEIAME.txt** com as contagens e com o que não pôde ser incluído.
- **O que não está no zip:** os XML de **cancelamento** e de **carta de correção** só existem no provedor fiscal e não estão guardados no ERP. O relatório mostra quantos há (o rodapé do PDF informa, por exemplo, "45 NF-e, 2 cancelamentos, 1 carta de correção"), mas esses arquivos precisam ser pedidos ao provedor fiscal. O PDF e a tela dizem quais são.
- Se algum XML de NF-e não estiver guardado, o zip sai com os que existem e o PDF e a tela avisam o número das notas que faltam.
- Período acima de 31 dias é recusado ("Período máximo de 31 dias.").

## O que não confundir

- **NF-e** é a nota de mercadoria; **NFS-e** é a de serviço. Este relatório é só da NF-e.
- A **lista** do PDF tem menos notas que o **zip**: a lista é só de vendas autorizadas; o zip leva também as canceladas e as de outra natureza. A diferença está explicada na nota de critério.
- A relação de notas **não** é a tela [Notas fiscais](notas-fiscais.md), onde se emite e se acompanha cada nota; aqui só se lê e se entrega o mês.

## Erros comuns

| O que aparece | Por que acontece | O que fazer |
|---|---|---|
| Acesso negado | O perfil não tem a permissão **Relatório: Notas fiscais (NF-e)** | Pedir a um administrador. |
| Sem permissão para este relatório. | A permissão foi retirada com a tela aberta | Entrar de novo; se persistir, falar com um administrador. |
| Período máximo de 31 dias. | O período personalizado passou de um mês | Escolher um período de até 31 dias. |
| Nenhum arquivo disponível para este período. | Não há NF-e com XML guardado no período | Conferir a empresa, a série e o período. |
| Não foi possível gerar o zip. / o PDF. | Falha ao ler os arquivos ou ao gerar o documento | Tentar de novo; se repetir, avisar o suporte. |

## Veja também

- [Notas fiscais](notas-fiscais.md)
- [Relatório: Contas a receber](relatorio-contas-a-receber.md)

## Arquivos de origem

Arquivos de código de onde esta ficha saiu. O `scripts/checar-manual.mjs` lê esta lista: quando um deles muda e a ficha não, ele avisa. Um caminho por item, entre crases, a partir da raiz do repositório; pasta termina com `/` e vale para tudo dentro dela.

- `src/features/relatorios/definicoes/notas-fiscais.ts`
- `src/features/relatorios/lib/zip.ts`
- `src/features/relatorios/relatorio.server.ts`
- `src/features/relatorios/registro.ts`
- `src/app/api/relatorios/`
- `supabase/migrations/20261025_relatorio_notas_fiscais.sql`
