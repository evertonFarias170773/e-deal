# PADRAO-FILTROS-URL-NAVEGACAO.md

Versão: 1.2  
Status: Oficial  
Última atualização: 29/07/2026  
Projeto: ERP Ideal

---

# Persistência de Filtros e Estado de Navegação

Este documento define como as telas de listagem do ERP Ideal guardam filtros, pesquisa, ordenação, paginação, período e aba.

A regra vale para **toda lista nova**: o estado funcional da tela fica na URL, não em `useState` local.

---

# 1. Por que a URL

O ERP roda no App Router do Next. Ao sair de uma rota, a página é desmontada e todo `useState` morre. Sem persistência, o usuário perde os filtros ao atualizar a página, ao ir para outra tela e voltar, ao usar o histórico do navegador e ao abrir um link que recebeu de um colega.

Guardar o estado na URL resolve os quatro casos de uma vez e ainda torna a tela compartilhável: o link descreve exatamente o que a pessoa está vendo.

---

# 2. Regras do padrão

1. Filtros, pesquisa, ordenação, paginação, período e abas funcionais ficam em query params.
2. A tela inicia seu estado lendo a URL, nunca um valor fixo no código.
3. Alterar um filtro atualiza a URL sem recarregar a página.
4. Valor igual ao padrão não entra na URL. Estado padrão significa URL limpa.
5. Valor inválido cai no padrão seguro, sem quebrar a tela e sem limpar a URL sozinho.
6. Ao mudar qualquer filtro, a paginação volta para a primeira página.
7. "Limpar filtros" remove os parâmetros correspondentes — e apenas eles.
8. Pesquisa por texto responde a cada tecla, mas só grava na URL depois da pausa.
9. Nunca colocar dado sensível na URL: token, sessão, senha ou identificador de autenticação.
10. `sessionStorage` serve apenas para estado visual que não faz sentido em um link compartilhado, como modo compacto, tela cheia e grupos recolhidos.

---

# 3. Utilitário compartilhado

Toda tela usa o mesmo hook. Não criar solução paralela.

| Arquivo | Papel |
|---|---|
| `src/lib/url-state.ts` | Camada pura, sem React: codecs e conversão entre URL e valores |
| `src/hooks/useUrlFilters.ts` | Hook principal: lê a URL, escreve a URL, zera a página |
| `src/hooks/useDebouncedValue.ts` | `useDebouncedValue` e `useDebouncedInput`, para campos de busca |

## 3.1 Codecs disponíveis

| Codec | Uso |
|---|---|
| `codecs.texto()` | Busca e valores livres |
| `codecs.numero({ min, max })` | Página e quantidades |
| `codecs.booleano()` | Sim/não, gravado como `1` e `0` |
| `codecs.enumOf([...] as const)` | Lista fechada: status, aba, ordenação |
| `codecs.enumOpcional([...] as const)` | Lista fechada em que "nenhum selecionado" é válido |
| `codecs.dataIso()` | Data `AAAA-MM-DD` |
| `codecs.dataIsoOuTodas()` | Data que também aceita "sem filtro de data" |
| `codecs.mesIso()` | Mês `AAAA-MM` |

## 3.2 Como aplicar em uma tela

```ts
const { filters, setFilter, setFilters, clearFilters, hasActiveFilters } = useUrlFilters(
  {
    q: { codec: codecs.texto(), default: "" },
    status: { codec: codecs.enumOf(STATUS) , default: "TODOS" },
    aba: { codec: codecs.enumOf(ABAS), default: "CARTEIRA" },
    pag: { codec: codecs.numero({ min: 1 }), default: 1 }
  },
  { pageKey: "pag" }
);

// campo de busca: responde na hora, grava depois da pausa
const [buscaDigitada, setBuscaDigitada] = useDebouncedInput(filters.q, (v) => setFilter("q", v));
```

Pontos de atenção:

- Passe o schema dentro de `useMemo` quando algum padrão for calculado (por exemplo, o mês corrente).
- Informe `pageKey` sempre que a tela tiver paginação; o hook zera a página na mesma escrita, sem passar por uma página inexistente.
- Ao migrar uma tela existente, mantenha os nomes das variáveis locais (`const status = filters.status`). O restante da tela continua igual e o diff fica pequeno.

## 3.3 Suspense é obrigatório

`useSearchParams` exige um limite de Suspense. No `page.tsx` da rota:

```tsx
<Suspense fallback={null}>
  <MinhaListaPage />
</Suspense>
```

Sem isso o build falha com erro explícito.

---

# 4. Nomes dos parâmetros

Minúsculas, sem acento, um valor por parâmetro. Enums usam as constantes internas do código.

| Parâmetro | Significado |
|---|---|
| `q` | Busca por texto |
| `qid` | Busca por identificador numérico |
| `pag` | Página, começando em 1 |
| `ord` / `dir` | Campo de ordenação e sentido (`asc` / `desc`) |
| `aba` | Aba principal da tela |
| `status`, `tipo`, `cat`, `prio`, `setor` | Filtros de domínio |
| `emp` / `vend` | Empresa e vendedor |
| `periodo` | Mês, no formato `AAAA-MM` |
| `ini` / `fim` | Intervalo de datas |
| `card` | Cartão-filtro em destaque |
| `variacoes`, `fotos`, `estoque` | Filtros de sim/não/todos do catálogo de produtos |

Listas aninhadas usam prefixo curto com hífen, para não colidir com os filtros da própria página: `prop-q`, `prop-status`, `prop-pag`.

Nomes reservados, que já têm significado no sistema e não devem ser reaproveitados: `id`, `id_int`, `modo`, `tab`, `search`, `autoRegister`, `resolver-pendencia`, `next`, `t`.

---

# 5. Como a URL é escrita

A escrita usa `window.history.replaceState` mais uma cópia local da query, sempre pelo hook.

Duas medições explicam essa combinação:

- `history.replaceState` sempre atualiza a barra de endereços, mas **não** reprocessa `useSearchParams`. Sozinho, deixaria a tela exibindo filtros diferentes dos que estão na URL — daí a cópia local, que faz a tela reagir na hora.
- `router.replace` reprocessa, mas em telas com carga de dados ele é **engolido** quando a página foi aberta direto por um link com parâmetros. Na prática, quem abrisse uma URL filtrada não conseguia mais trocar de filtro.

A combinação atual não depende de transição de rota e funciona nos dois casos. A cópia local vale apenas enquanto a URL de origem não muda; em link novo, voltar ou avançar, a leitura volta a sair da própria URL.

Nada disso empilha histórico: digitar na busca não deve encher o botão "voltar". Cada entrada do histórico guarda o último estado daquela visita, de modo que voltar e avançar continuam funcionando entre telas.

**Efeito colateral a conhecer:** um `useSearchParams` lido fora do hook, na mesma tela, não enxerga as trocas de filtro até a próxima navegação real. Se a tela precisar desse valor, leia pelo hook.

---

# 6. Comandos de uso único na URL

Nem todo parâmetro é filtro. `autoRegister` é um comando: a preparação de boletos envia o usuário para `/contas-a-receber` já com o modal de registro bancário aberto. Depois de consumido ele precisa sair da URL, senão um F5 reabre o modal.

O tratamento é o mesmo dos filtros: declare no schema (`codecs.booleano()`, padrão `false`), proteja o consumo com um `ref` para não repetir e remova com `setFilter("autoRegister", false)`.

Houve um período em que essa remoção precisou ser feita fora do hook, porque a navegação de router era descartada. Isso deixou de valer quando a escrita passou a usar `history.replaceState`. **Hoje não existe exceção: toda escrita de URL passa pelo `useUrlFilters`.**

---

# 7. Estado da migração

| Tela | Situação |
|---|---|
| Contas a Receber | Migrada (piloto), publicada em 28/07/2026 |
| Orçamentos | Migrada em 28/07/2026 |
| Cadastros (lista e sub-lista do detalhe) | Migrada em 29/07/2026 |
| Produtos | Migrada em 29/07/2026 |
| Demais listas | Ainda em `useState` local |

Telas novas já nascem com o padrão. Telas existentes são migradas uma por vez, em tarefas separadas, sem refatoração ampla.

---

# 8. Checklist para migrar ou criar uma lista

- [ ] Schema declarado com codec e padrão para cada filtro
- [ ] `<Suspense>` no `page.tsx` da rota
- [ ] Campo de busca com `useDebouncedInput`
- [ ] `pageKey` informado quando houver paginação
- [ ] "Limpar filtros" voltando os filtros ao padrão
- [ ] Estado padrão deixando a URL limpa
- [ ] Parâmetro inválido caindo no padrão, sem quebrar
- [ ] Estado apenas visual em `sessionStorage`, fora da URL
- [ ] Nenhum dado sensível na URL
- [ ] Consultas, totais, agrupamentos e ordenação inalterados após a migração

---

# 9. Documentação Relacionada

- `./PADROES-UX-UI.md`
- `../architecture/ARQUITETURA-MODULAR-ERP-IDEAL.md`
- `../DEVELOPMENT.md`
- `../history/DECISOES-TECNICAS.md`

---

# Fonte da Verdade

Este documento define o padrão oficial de persistência de filtros e estado de navegação do ERP Ideal.

Toda lista nova deve usar o hook compartilhado. Criar mecanismo próprio de persistência de filtros não é permitido.

O padrão não autoriza mudança de regra de negócio, de permissão ou de escrita no banco.
