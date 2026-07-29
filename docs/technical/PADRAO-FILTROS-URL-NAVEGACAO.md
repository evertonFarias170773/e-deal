# PADRAO-FILTROS-URL-NAVEGACAO.md

Versão: 2.0  
Status: Oficial — migração encerrada  
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
| `src/hooks/useSessionState.ts` | `useSessionState`, para a preferência visual que não vai para a URL |

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

## 3.4 Estado visual fora da URL

Modo compacto, tela cheia e grupos recolhidos são preferência de quem está olhando, não descrição do que está sendo visto. Em um link compartilhado eles atrapalhariam: o colega receberia a tela no modo do remetente. Esse tipo de estado usa `useSessionState`, que guarda o valor na sessão do navegador.

```ts
const [compacto, setCompacto] = useSessionState("ui:/expedicao:compacto", false);
```

A chave segue a convenção `ui:<rota>:<nome>`. O valor vale enquanto a aba estiver aberta, sobrevive ao F5 e não viaja em um link copiado.

Chaves em uso hoje:

| Chave | Tela |
|---|---|
| `ui:/expedicao:compacto` | Expedição |
| `ui:/pedidos/impressao:compacto` | Fila de impressão |
| `ui:/pedidos/impressao:tela-cheia` | Fila de impressão |
| `ui:/pendencias:filtros-avancados` | Pendências |
| `ui:/configuracoes/perfis:grupos-recolhidos` | Configurações → Perfis |

A leitura usa `useSyncExternalStore`, então servidor e hidratação partem do valor inicial e só depois assumem o que está guardado, sem divergência de marcação. Se o `sessionStorage` estiver indisponível, a preferência simplesmente não persiste — a tela continua funcionando.

Filtro de dados nunca entra aqui.

---

# 4. Nomes dos parâmetros

Minúsculas, sem acento, um valor por parâmetro. Enums usam as constantes internas do código.

| Parâmetro | Significado |
|---|---|
| `q` | Busca por texto |
| `qid` | Busca por identificador numérico |
| `pag` | Página, começando em 1 |
| `ord` / `dir` | Campo de ordenação e sentido (`asc` / `desc`) |
| `sentido` | Direção do lançamento na Conta Corrente (crédito ou débito) — nome distinto de `dir`, que é ordenação |
| `aba` | Aba principal da tela |
| `status`, `tipo`, `cat`, `prio`, `setor` | Filtros de domínio |
| `emp` / `vend` | Empresa e vendedor |
| `periodo` | Mês, no formato `AAAA-MM` |
| `ini` / `fim` | Intervalo de datas |
| `card` | Cartão-filtro em destaque |
| `urg` | Somente urgentes (`1`) |
| `mat` | Material |
| `prio` | Prioridade |
| `perfil` / `origem` | Perfil e origem do perfil (Configurações → Usuários) |
| `variacoes`, `fotos`, `estoque` | Filtros de sim/não/todos do catálogo de produtos |

Listas aninhadas e conjuntos paralelos usam prefixo curto com hífen, para não colidir entre si: `prop-q`, `prop-status`, `prop-pag` na sub-lista de Cadastros; `nfe-*` e `nfse-*` nos dois conjuntos de Notas Fiscais.

Nomes reservados, que já têm significado no sistema e não devem ser reaproveitados: `id`, `id_int`, `modo`, `search`, `autoRegister`, `next`, `t`.

Dois nomes legados seguem em uso, de propósito, porque links antigos apontam para eles: `tab`, a aba do editor de orçamento (hoje bidirecional, pelo hook), e `resolver-pendencia`, comando de uso único do mesmo editor.

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

Houve um período em que essa remoção precisou ser feita fora do hook, porque a navegação de router era descartada. Isso deixou de valer quando a escrita passou a usar `history.replaceState`. **Para comandos novos não existe exceção: declare no schema e remova pelo hook.**

Uma exceção herdada permanece: `resolver-pendencia`, no editor de orçamento, se autolimpa pela History API dentro do próprio efeito que o consome, fora do schema. Funciona porque a limpeza apaga apenas aquele parâmetro — a aba sobrevive — e porque a escrita seguinte do hook parte de `window.location.search`, já sem o comando. Não foi reescrita para não mexer num fluxo financeiro sensível.

---

# 7. Estado da migração

**Encerrada em 29/07/2026.** Dezesseis telas migradas, uma por commit, cada uma publicada e validada em produção antes da seguinte.

| Tela | Parâmetros | Fora da URL |
|---|---|---|
| Contas a Receber (piloto) | `q` (aceita `search`), `aba`, `emp`, `tipo`, `status`, `ini`, `fim` | — |
| Orçamentos | `q`, `status`, `modelo`, `vend`, `cob`, `card`, `periodo`, `pag` | — |
| Cadastros (lista) | `q`, `qid`, `pag` | — |
| Cadastros (sub-lista do detalhe) | `prop-q`, `prop-status`, `prop-pag` | — |
| Produtos | `q`, `cat`, `status`, `variacoes`, `fotos`, `estoque` | — |
| Conferência (Cobranças) | `q`, `tipo`, `emp`, `vend`, `aba`, `ini`, `fim` | mês exibido (derivado) |
| Pedidos (Painel Geral) | `q`, `status`, `vend`, `emp` | — |
| Expedição | `q`, `status` | modo compacto (sessão) |
| Conta Corrente | `q`, `status`, `sentido` | — |
| Pendências | `q`, `status`, `prio`, `cat`, `setor`, `emp`, `aba` | painel avançado (sessão), limite do "carregar mais" (local) |
| Registro de Recebíveis | `q`, `emp` | modal de preparação (local) |
| Configurações → Usuários | `q`, `perfil`, `origem` | usuário selecionado (local) |
| Fila de impressão | `status`, `urg`, `setor`, `mat` | compacto e tela cheia (sessão) |
| Configurações → Perfis | nenhum (a tela não tem filtro) | grupos recolhidos (sessão) |
| Notas Fiscais | `aba`, `nfe-q`, `nfe-emp`, `nfe-status`, `nfse-q`, `nfse-emp`, `nfse-status` | modais e fluxo fiscal (local) |
| Editor de orçamento | `tab` (bidirecional), `resolver-pendencia` (one-shot) | demais estados do editor (local) |

## 7.1 Fora do escopo e pendências

| Item | Situação |
|---|---|
| Kanban de Pedidos (`/pedidos/kanban`, `/os-producao`) | **Descontinuado.** Não migrar. |
| Banco de Variações (`/produtos/variacoes`) | Ainda em `useState` local (`search`, `statusFilter`). Não entrou na última onda. |
| Abas internas do detalhe de NF-e (`/notas-fiscais/[id]`) | Ainda locais. Não entraram na última onda. |
| Fila de impressão — conferência com carga real | Pendente: a fila estava vazia nos dois ambientes na data da migração, então a equivalência de resultados não pôde ser medida. |
| Editor — `resolver-pendencia` ponta a ponta | Pendente: nenhuma proposta elegível (pendência de revisão aberta **com** cobranças) disponível para exercitar a abertura do modal. A autolimpeza e a convivência com a escrita da aba foram validadas. |

Telas novas já nascem com o padrão. Telas existentes que ainda não usam o hook são migradas uma por vez, em tarefas separadas, sem refatoração ampla.

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
