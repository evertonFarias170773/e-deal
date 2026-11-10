# ChatGuru: trava por conversa compartilhada (proposta)

> **Situação:** proposta de 09/11/2026, **revisão 4**. A equipe do Imposition alinhou o conceito na revisão 3 e pediu a revisão 4 antes de aplicar (seção "Revisão 4", abaixo). Depois, alinhou a revisão 4 e pediu a drenagem e a pausa na troca e na reversão (item 6). **Não aplicada** no banco.
> **Arquivos:** migração única em [CHATGURU-TRAVA-COMPARTILHADA-MIGRACAO.sql](CHATGURU-TRAVA-COMPARTILHADA-MIGRACAO.sql) (com rodapé de reversão) e teste com ROLLBACK em [CHATGURU-TRAVA-COMPARTILHADA-TESTE.sql](CHATGURU-TRAVA-COMPARTILHADA-TESTE.sql). O teste roda no SQL Editor da Supabase pela versão [CHATGURU-TRAVA-COMPARTILHADA-TESTE-EDITOR.sql](CHATGURU-TRAVA-COMPARTILHADA-TESTE-EDITOR.sql). Ela não tem BEGIN: o editor roda o arquivo numa transação implícita, e o erro proposital do fim desfaz tudo e traz na mensagem uma linha por caso (PASSA ou FALHA). **Primeira rodada (09/11/2026): 34 PASSA, 5 FALHA.** Três FALHA eram os R3, esperados. As outras duas:
> - **2c**, chave fora do formato: foi recusada, mas com `invalid input syntax for type uuid`, porque o gatilho convertia para uuid antes de conferir o formato. Corrigido: o gatilho confere o formato primeiro e recusa com "Chave da trava fora do formato". O caso 2c2 cobre o lado da arte.
> - **M1**, margem de 15 s: leu 10 s. O defeito era do teste: o UPDATE e a leitura estavam no mesmo comando (CTE), e a consulta principal enxerga a foto de antes do UPDATE. O teste foi separado em gravar e ler (M1a a M1d, 15 s e depois 20 s), e o M1e confere que `chatguru_trava_margem()` é STABLE.
>
> **Aprovação técnica (09/11/2026):** a equipe do Imposition reproduziu os 46 casos que devem passar. A aplicação será integral e transacional, numa janela com os dois sistemas pausados, pelo roteiro [CHATGURU-TRAVA-JANELA.md](CHATGURU-TRAVA-JANELA.md). A reversão, pronta para rodar, está em [CHATGURU-TRAVA-COMPARTILHADA-REVERSAO.sql](CHATGURU-TRAVA-COMPARTILHADA-REVERSAO.sql).
>
> **Volta no teste (09/11/2026, antes da janela):** o teste do editor passou a rodar também a reversão, depois da ida e na mesma execução: o texto de [CHATGURU-TRAVA-COMPARTILHADA-REVERSAO.sql](CHATGURU-TRAVA-COMPARTILHADA-REVERSAO.sql), comando a comando, e os casos X0 a X11, que comparam o catálogo com uma foto tirada antes da ida. Eles conferem a chave estrangeira original, que nenhuma função, tabela, visão, índice ou gatilho novo ficou, que a coluna livre_em saiu e que o md5 do corpo das três RPCs do Imposition voltou ao de antes. Os corpos no arquivo de reversão já batem em md5 com os do banco (conferido por leitura). **Esperado na nova rodada: 61 casos, 58 PASSA e 3 FALHA (R3).**
>
> **Rodada da volta (10/11/2026):** 55 PASSA e 6 FALHA. Além dos três R3, falharam X7, X8 e X9: as três RPCs recriadas a partir do texto escrito no arquivo de reversão não voltaram iguais, embora esse texto bata em md5 com o banco quando lido direto do arquivo. Correção: a migração guarda, logo depois da drenagem, a definição (pg_get_functiondef), o dono e as permissões das três RPCs na tabela `chatguru_trava_rpcs_originais` (parte 0b, fechada para anon, authenticated e service_role) e aborta se alguma não tiver o md5 da aprovação. A reversão restaura dessa tabela, confere cada RPC contra a cópia (md5 do corpo e da definição, dono e permissões) e só depois apaga a cópia. A drenagem continua no começo dos dois. O teste ganhou os casos G1 e G2 e um diagnóstico da volta, que não conta no resultado: compara o texto antigo do arquivo, do jeito que o editor o entrega, com o corpo no banco, e lista cada função de `public` que mudou entre a foto e a volta. **Esperado na nova rodada: 63 casos, 60 PASSA e 3 FALHA (R3).**
>
> **Rodada da cópia (10/11/2026):** 59 PASSA e 4 FALHA. X7, X8 e X9 passaram, e o diagnóstico deu 0 funções diferentes. G1 falhou por defeito do teste (`pg_get_functiondef` avaliado em função de agregação); corrigido. A causa da diferença de antes, mostrada no diagnóstico ARQUIVO x BANCO: o SQL Editor entrega o texto com CRLF, e os corpos no banco têm LF.
>
> **CRLF depois da janela (aviso para a equipe do Imposition):** como a migração roda pelo editor, as funções que ela cria ou altera ficam com `\r` no fim das linhas. Isso inclui as três RPCs do Imposition na versão rev4. Não muda o funcionamento: 234 das 535 funções de `public` já estão assim, 11 delas do Imposition. Nenhum texto entre aspas nas funções da migração ocupa mais de uma linha, então o `\r` não entra em mensagem nem em comparação. A conferência da aprovação (parte 0b) e a conferência do roteiro depois da reversão tiram o `\r` antes do md5. Quem comparar `pg_get_functiondef` das RPCs com o código do Imposition deve tirar o `\r` antes. Depois de uma reversão, as RPCs voltam da cópia, com LF, iguais às de hoje. **Esperado na nova rodada: 63 casos, 60 PASSA e 3 FALHA (R3).**
>
> **Esperado na segunda rodada:** 49 casos, 46 PASSA e 3 FALHA (R3-1, R3-2 e R3-3). Entraram os casos D1 a D5 da drenagem (item 6). D3 e D5 também dão FALHA se houver envio real em andamento na hora: é a drenagem funcionando, e basta rodar de novo.
> **Alcance:** a trava compartilhada vale para **todos os avisos do Vibe** que usam a Edge Function `expedicao-pedido-pronto`: o aviso de pedido pronto da Expedição (seis diálogos), o "Testar modelo" e o "Pedido em Produção".
> **Enquanto não existir:** o "Pedido em Produção" só envia em modo teste e para o cliente #14; os demais veem "Envio de aviso de produção em ajuste" e só liberam. O aviso de pedido pronto da Expedição está limitado pelo modo teste (só cliente #14). Desligar o modo teste da Expedição antes da trava compartilhada deixa aberta a corrida em `Pedido_Atual` descrita abaixo.

## Por que

Dois campos são gravados pelos dois sistemas na mesma conversa:

- `Link_do_Cliente`: o envio de arte do Imposition e o "Pedido em Produção" do Vibe (o template 6071c6dbe34a18c2cc684747 passou a usar o campo).
- `Pedido_Atual`: o envio de arte do Imposition e os seis diálogos da Expedição do Vibe (Sedex, Motoboy, Retira, Veppo, Azul, Transportadora), inclusive no "Testar modelo".

O ChatGuru guarda o último valor do campo na conversa. Um aviso de pedido pronto e um envio de arte para o mesmo cliente, ao mesmo tempo, podem trocar o número do pedido ou o link na mensagem um do outro. Exemplo real de 09/11/2026: o envio de arte do 24880 às 10:22 gravou o link do 24880 na conversa "Edison Junior - 14", e o aviso Pedido em Produção do 24917 às 10:43, que ainda não gravava o link, saiu com o link do 24880.

Hoje cada sistema tem a própria trava, e um não vê a do outro:

| | Vibe (avisos) | Imposition (envio de arte) |
|---|---|---|
| Onde trava | `expedicao_aviso_pronto`: índice único parcial `expedicao_aviso_pronto_trava_conversa` em `destino_chave`, com estado `preparando` ou `desconhecido` | `imposition_whatsapp_conversas.chave_envio` (uma linha por `destino_chave`) |
| Quem reserva | insert direto pela Edge Function `expedicao-pedido-pronto` | RPCs `imposition_whatsapp_dialogo_reservar` e `imposition_whatsapp_dialogo_reenviar` |
| Quem libera | o próprio estado da linha (sai de `preparando`; `desconhecido` segura até o "Liberar número") | `imposition_whatsapp_dialogo_finalizar` (libera, menos em `desconhecido`) |
| Chave da conversa | SHA-256 de `JSON.stringify([endpoint, account_id, phone_id, numero])` | a mesma fórmula |
| Campos gravados | Expedição: tabela no fim; Produção: `Link_do_Cliente` | `Link_do_Cliente`, `Pedido_Atual` |

O que impede o Vibe de usar a trava do Imposition hoje: `imposition_whatsapp_conversas.chave_envio` tem chave estrangeira para `imposition_whatsapp_artes(chave)`. Só uma linha de envio de arte pode ocupar a conversa.

## Revisão 2: os cinco ajustes da equipe do Imposition

### 1. Validação dos parâmetros

As duas funções recusam parâmetro nulo, de forma explícita. Antes, `p_chave` nulo passava pelo `!~` (nulo não é verdadeiro nem falso) e podia responder "reservado" sem ocupar a conversa. A chave do Vibe é `vibe:` seguido de um UUID no formato 8-4-4-4-12. O gatilho que confere o dono checa esse formato (ou os 64 hexadecimais da arte) antes de converter a chave para uuid e recusa com "Chave da trava fora do formato" (código 23514). Isso é necessário porque o gatilho BEFORE roda antes da CHECK da tabela.

### 2. Integridade no lugar da chave estrangeira

Sai a chave estrangeira e entra um gatilho em `imposition_whatsapp_conversas`. Ele confere que o dono da trava existe:
- `vibe:<id>`: o id precisa existir em `expedicao_aviso_pronto`;
- qualquer outro valor: a chave precisa existir em `imposition_whatsapp_artes`.

A chave estrangeira também impedia apagar uma linha de envio de arte que estivesse segurando a conversa. Para não perder isso, um gatilho de exclusão nas duas tabelas de origem recusa apagar o dono de uma trava ativa. Nenhum fluxo apaga essas linhas hoje.

### 3. Chave da conversa idêntica nos dois sistemas

**Prova com a conversa "Edison Junior - 14" (09/11/2026, dado real do banco):**

| Origem | destino_chave |
|---|---|
| Vibe: `expedicao_aviso_pronto`, 14 avisos para essa conversa, entre eles o Pedido em Produção do 24880 às 11:02 | `c080a41c7e293e552f58168caf3966182d2421e9e9195a233dcf88c81d1ce293` |
| Imposition: `imposition_whatsapp_conversas`, linha criada pela regra do Imposition no envio de arte do `vibe_24880` (o último em 09/11 às 10:22, estado "aguardando") | `c080a41c7e293e552f58168caf3966182d2421e9e9195a233dcf88c81d1ce293` |

A linha é a mesma: as duas regras chegam ao mesmo valor. Os dois sistemas leem os mesmos secrets do projeto (`CHATGURU_ENDPOINT`, `CHATGURU_ACCOUNT_ID`, `CHATGURU_PHONE_ID`) sem alterar o texto, e usam o mesmo número, 555184608848, com DDI e sem o nono dígito, como o Guru guarda. Do lado do Vibe ele vem do `telefone_normalizado` da visão `chatguru_contatos_3478`; do lado do Imposition, de `imposition_arte_guru_ler`.

Hoje a chave sai igual porque os dois usam o texto cru dos mesmos secrets. Para não depender disso, a proposta é uma normalização única, escrita igual nos dois códigos:

| Parte | Regra |
|---|---|
| endpoint | sem espaços nas pontas e sem barra no fim (`https://app.zap.guru/api/v1`) |
| conta e aparelho | sem espaços nas pontas |
| telefone | só dígitos, com o DDI 55, exatamente como o Guru 3478 guarda (sem pôr nem tirar o nono dígito) |

Cuidado na troca: se algum secret tiver hoje barra final ou espaço, a chave muda. A normalização entra nos dois sistemas no mesmo deploy, num momento sem trava ocupada. Também é preciso conferir que não há aviso do Vibe em "preparando" ou "desconhecido".

### 4. Falhas e transição

- **Reserva interrompida:** a reserva ficou em "preparando" e a função caiu antes de chamar o Guru. Ela não é solta sozinha. Depois de 2 minutos em "preparando", aparece como pendência para o "Liberar número" do Vibe, como o "desconhecido". O "Liberar número" passa a aceitar os dois estados e solta a trava compartilhada junto.
- **Resultado desconhecido:** não é solto sozinho. Segue a regra de hoje: o Administrador confere no ChatGuru e usa o "Liberar número", que solta a trava compartilhada.
- **Do lado do Imposition:** a regra já é igual. O `finalizar` não solta em "desconhecido", e a reserva interrompida dele fica com `chave_envio` ocupado até alguém resolver. A proposta não muda isso.
- **Antes de ligar:** um passo único, no mesmo momento do deploy, faz cada aviso do Vibe em "desconhecido" ocupar a conversa ("preparando" de qualquer idade aborta a migração; revisão 4, item 6) em `imposition_whatsapp_conversas` com `vibe:<id>`. Se a conversa já estiver ocupada por um envio de arte, o caso fica listado para conferência manual e não é sobrescrito.

### 5. Quando o Guru lê os campos (testado em 09/11/2026)

**Pergunta:** depois do "Diálogo Executado", o ChatGuru ainda lê os campos da conversa por algum tempo? Se sim, uma gravação de outro sistema logo depois troca o valor da mensagem que acabou de sair.

**Teste:** conversa "Edison Junior - 14", diálogo Retira, pedido 24880. Grava `Pedido_Atual` = 24880, executa o diálogo e, depois da espera, grava `Pedido_Atual` = 99999. Feito por uma ação temporária da função, só modo teste, cliente #14 e ADM, removida em seguida. Mensagens conferidas no WhatsApp:

| Espera antes de gravar 99999 | Diálogo executado (Brasília) | Número que chegou no topo da mensagem |
|---|---|---|
| 0 s | 11:27:53 | **99999** (errado) |
| 2 s | 11:36:17 | 24880 |
| 5 s | 11:30:02 | 24880 |
| 15 s | 11:34:01 | 24880 |

**Conclusão:** o ChatGuru lê os campos logo depois de responder "Diálogo Executado", em menos de 2 segundos. Uma gravação de outro sistema nesse intervalo troca o valor da mensagem que acabou de sair.

**Decisão (revisão 3):** a trava fica presa 5 segundos depois do "Diálogo Executado" (coluna `livre_em`). **Revisão 4:** os 5 s são margem experimental, não garantia; passa a **10 s, configurável**, com registro para conferir (item 4 da revisão 4).

**Rodapé do template Retira:** na mensagem de 0 s, o topo chegou com 99999, mas o rodapé "NÚMERO DO PEDIDO" chegou com 24880. Ou o rodapé não usa `Pedido_Atual`, ou lê o campo em outro momento. **Conferir com a diretoria** qual campo o rodapé usa e quando ele é lido. Se for outro campo que o Vibe não grava, o rodapé pode mostrar o pedido de outro envio.

### 6. Regra dos 120 segundos do ChatGuru (achada em 09/11/2026)

O ChatGuru recusa um segundo diálogo na mesma conversa antes de 120 segundos do anterior. A resposta é HTTP 200 e `code` 200, mas com `result` "error":

> "Diálogo não foi executado pois o tempo mínimo não foi atingido: Tempo decorrido: 63 segs - Mínimo: 120 segs"

- **Nas tentativas recusadas nada sai:** a conta conta a partir da última execução que deu certo, e as recusas não reiniciam o tempo.
- **No Vibe, desde 09/11/2026 (função v18):** essa resposta é recusa explícita. O aviso fica em "falhou", a conversa fica livre, e a tela mostra "O ChatGuru exige 2 minutos entre mensagens para a mesma conversa. Tente de novo em instantes." Antes, ela caía em "resultado desconhecido" e travava a conversa até o "Liberar número".
- **Na trava compartilhada:** dois sistemas mandando para a mesma conversa em menos de 2 minutos fazem o segundo ser recusado pelo ChatGuru, mesmo com a trava livre. A trava não substitui essa regra.
- **Pontos para combinar com o Imposition:**
  1. O Imposition trata essa resposta do mesmo jeito? Hoje, para ele, `result` "error" com `code` 200 também não é recusa (o `rejeitado` dele exige `code` 400), então cai em "desconhecido" e segura a conversa.
  2. Vale guardar o horário da última execução por conversa (por exemplo, em `imposition_whatsapp_conversas`) para os dois sistemas avisarem antes de tentar, em vez de esperar a recusa.

## Revisão 4: pedidos da equipe do Imposition

### 1. Gatilho de exclusão (erro reproduzido e corrigido)

**O erro:** o gatilho `imposition_whatsapp_trava_nao_apagar` da revisão 3 calculava a chave numa única expressão:

```sql
case when tg_table_name = 'expedicao_aviso_pronto' then 'vibe:' || old.id::text else old.chave end
```

O PL/pgSQL resolve **todos** os campos citados ao preparar a expressão, não só o do ramo usado. Na tabela `expedicao_aviso_pronto` não existe `old.chave`, e em `imposition_whatsapp_artes` não existe `old.id`. Com isso, **todo** DELETE nas duas tabelas falhava com `record "old" has no field "chave"` (ou `"id"`), segurando ou não uma conversa. Quando a linha era dona de uma trava, a exclusão também era barrada, mas por esse erro e não pela regra.

**Casos do teste com ROLLBACK (resultado esperado; o teste ainda não rodou no banco):**

| Caso | Revisão 3 (antes) | Revisão 4 (agora) |
|---|---|---|
| Apagar aviso do Vibe que não segura conversa | falha: `record "old" has no field "chave"` (caso R3-1) | apaga (1a) |
| Apagar envio de arte que não segura conversa | falha: `record "old" has no field "id"` (R3-2) | apaga (1b) |
| Apagar envio de arte que segura a conversa | barrado pelo erro de campo, não pela regra (R3-3) | recusado: "Registro … segura a conversa: libere a trava antes de apagar" (1e) |
| Apagar aviso do Vibe que segura a conversa | não testável (a chave estrangeira não aceitava `vibe:`) | recusado com a mesma mensagem (1d) |
| Trocar a chave (`chave`/`id`) de quem segura a conversa | não coberto | recusado (1f) |
| Soltar a trava e depois apagar | — | apaga (1g) |

**Correção:** cada tabela tem o seu ramo de `IF`, e só o ramo executado é preparado. O gatilho também cobre a troca da chave (`update of chave` / `update of id`), que a chave estrangeira impedia, e devolve o código `23503`, o mesmo de violação de chave estrangeira.

### 2. Integridade sob concorrência

**O risco:** a transação T1 grava `chave_envio = X` na conversa e confere que o dono X existe. Ao mesmo tempo, a transação T2 apaga X e confere que nenhuma conversa aponta para X. Cada uma vê o estado de antes da outra, as duas passam, e a trava fica sem dono.

**A solução:** o gatilho que confere o dono lê a linha com `FOR KEY SHARE`, um bloqueio de linha que fica até o fim da transação. Ele é compatível com as atualizações comuns (estado, `atualizado_em`), então não atrapalha o fluxo normal dos dois sistemas. Mas bloqueia DELETE e troca da chave. As duas ordens possíveis:

- **T1 grava a trava primeiro:** o `FOR KEY SHARE` prende a linha de X. O DELETE de T2 espera o fim de T1, porque o PostgreSQL trava a linha antes de rodar o gatilho BEFORE DELETE. Quando T1 confirma, o gatilho de T2 roda com uma leitura nova (READ COMMITTED), vê a trava gravada e recusa. Se T1 desfizer, T2 apaga normalmente.
- **T2 apaga primeiro:** o `FOR KEY SHARE` de T1 espera o fim de T2. Quando T2 confirma, a linha não existe mais, o SELECT volta vazio e T1 recusa com "Trava sem aviso do Vibe" ou "Trava sem envio de arte".

**Por que é seguro:** em nenhuma ordem as duas transações passam juntas. É o mesmo mecanismo que o PostgreSQL usa na chave estrangeira: o lado que referencia trava a linha referenciada com `FOR KEY SHARE`.

**Limites:**
- **Nível de isolamento:**
  - O raciocínio vale em READ COMMITTED, o padrão do PostgREST, das Edge Functions e do SQL Editor.
  - Em SERIALIZABLE, o próprio banco detecta o conflito e aborta uma das duas.
  - Em REPEATABLE READ, a leitura do gatilho de exclusão usaria uma foto antiga. Por isso o gatilho recusa apagar ou trocar a chave nesse nível ("Apague ou troque a chave em READ COMMITTED").
- **Constraint trigger adiada:** foi considerada e descartada. Ela também lê uma foto e não resolve a corrida sem o bloqueio de linha.
- **O que o teste prova:** o teste com ROLLBACK roda numa sessão só. Por isso ele prova que o gatilho prende a linha do dono: o `xmax` da linha passa de 0 para o número da transação depois que a trava é gravada (casos 2d e 2e). A espera entre duas sessões é o comportamento documentado do PostgreSQL para `FOR KEY SHARE`. Um teste com duas sessões de verdade exige a migração aplicada.

### 3. Migração executável e ordem da transição

**Arquivo único:** [CHATGURU-TRAVA-COMPARTILHADA-MIGRACAO.sql](CHATGURU-TRAVA-COMPARTILHADA-MIGRACAO.sql). Ele traz:
- a remoção da chave estrangeira, o check do formato e a coluna `livre_em`;
- os dois gatilhos (dono existe, com `FOR KEY SHARE`; dono não se apaga);
- as duas funções do Vibe:
  - `imposition_whatsapp_conversa_travar(destino, chave)`;
  - `imposition_whatsapp_conversa_soltar(destino, chave, executado)`;
- as três RPCs do Imposition alteradas (mesmas assinaturas e permissões, mudanças marcadas `rev4`):
  - `reservar` e `reenviar` devolvem `ocupado` enquanto `livre_em` estiver no futuro;
  - `finalizar` grava `livre_em = agora + margem` quando o diálogo foi executado (`aguardando`), e não grava margem em `falhou`;
- a margem configurável e o registro (item 4);
- a passagem dos avisos do Vibe em "desconhecido". Em 09/11/2026 não havia nenhum;
- na frente de tudo, a drenagem (item 6): aborta, listando, se houver envio em andamento de qualquer lado.

O rodapé traz a reversão completa: as RPCs voltam da cópia guardada pela migração antes de alterar (parte 0b) e a chave estrangeira volta. Ele começa pela mesma drenagem.

**Ordem, sem janela em que um sistema ignore a trava do outro:**

| Passo | Onde | O que muda | Por que não abre janela |
|---|---|---|---|
| 1 | Código do Vibe (Edge Function `expedicao-pedido-pronto`, v19) | Todo aviso chama `travar` antes de gravar campos. Se a função não existe ou dá erro, o aviso fica `falhou` com "Trava compartilhada indisponível" e **nada sai**. Ao terminar: `soltar(…, executado = true)` só com "Diálogo Executado"; `soltar(…, false)` em `falhou`, inclusive na recusa dos 120 s; em `desconhecido`, não solta. O "Liberar número" passa a soltar a trava compartilhada. | Do deploy até o passo 2, o Vibe não envia nada: ele nunca envia sem a trava. Hoje isso só afeta o modo teste (cliente #14). |
| 2 | Banco | Com os dois lados pausados (item 6), a migração inteira, numa transação, com cerca de 1 s de bloqueio nas três tabelas. Ela começa pela drenagem. | No commit, as duas pontas passam a valer juntas: as RPCs do Imposition já recusam com trava `vibe:` ou com `livre_em` no futuro, e o `travar` do Vibe já recusa com trava do Imposition. |
| 3 | Código do Imposition | A recusa dos 120 s vira `falhou` (item 5). | Não mexe na trava. O código deles não lê `chave_envio` (conferido no `painel` v283), então o prefixo `vibe:` não quebra leitura. Pode vir antes ou depois do passo 2. |
| 4 | Código dos dois | Normalização da chave (item 3 da revisão 2) como **conferência**, não como transformação. Cada lado compara o texto cru dos secrets com o normalizado e, se diferirem, recusa o envio. | A chave nunca muda de valor, então os dois sistemas nunca calculam chaves diferentes para a mesma conversa. |
| 5 | Vibe | Sai o "Envio de aviso de produção em ajuste" e, depois, o modo teste. | Só depois dos passos 1 a 3 no ar e de uma semana de registro sem linha na conferência (item 4). |

**Reversão:** pausar os dois lados, conferir, reverter e retomar. A sequência completa está no item 6. O Imposition não precisa voltar código, e o Vibe volta para a v18 por último.

### 4. Margem: 10 s, configurável, com conferência

- **Margem:** fica em `chatguru_trava_config.margem`, com padrão de **10 segundos** e limite entre 0 e 2 minutos. As duas pontas leem a margem pela função `chatguru_trava_margem()`, então uma mudança vale para Vibe e Imposition ao mesmo tempo, sem deploy:

  ```sql
  update public.chatguru_trava_config set margem = interval '15 seconds';
  ```

  Mudar a margem é escrita em produção e precisa de autorização.

  `chatguru_trava_margem()` é STABLE (não IMMUTABLE) e não guarda valor: cada comando que a chama lê a tabela de novo. Dentro de um mesmo comando ela usa a foto do início dele. Por isso o teste grava e lê em comandos separados.
- **Registro:** cada reserva e cada soltura vai para `chatguru_trava_registro`, com a origem (`vibe` ou `imposition`) e o evento:
  - `reservado`: os campos vão ser gravados em seguida;
  - `executado`: houve "Diálogo Executado" e a margem começou;
  - `solto`: soltura sem diálogo executado.
- **Conferência:** a visão `chatguru_trava_conferencia` lista cada aviso executado em que **outro envio ocupou a mesma conversa (e gravou campos) até 30 s depois**. Essa janela também é configurável, em `janela_conferencia`. Linha nessa visão é o caso a conferir no WhatsApp: a mensagem executada saiu com o próprio pedido, ou com o do envio seguinte?

  ```sql
  select * from public.chatguru_trava_conferencia order by executado_em desc;
  ```

- **Por que a conferência importa mesmo com a regra dos 120 s:** o ChatGuru recusa o segundo diálogo, mas a gravação de campos do segundo envio acontece **antes** da recusa. É exatamente a gravação que troca o valor da mensagem anterior.

### 5. Recusa dos 120 s no Imposition (mudança para a equipe deles aplicar)

**Onde:** Edge Function `painel` (no ar v283), arquivo `supabase/functions/_compartilhado/whatsapp_artes.ts`, linhas 126 a 132:

```ts
const sucesso = (r: any) => r.http >= 200 && r.http < 300 && r.data.result === "success" && r.data.code === 200;
const rejeitado = (r: any) => r.http < 500 && r.data.result === "error" && r.data.code === 400;
...
estado = sucesso(dialogo) ? "aguardando" : rejeitado(dialogo) ? "falhou" : "desconhecido";
```

**O que acontece hoje:** a resposta "Diálogo não foi executado pois o tempo mínimo não foi atingido" chega com HTTP 200, `code` 200 e `result` "error". Ela não é `sucesso` nem `rejeitado`, então cai em `desconhecido`. O `finalizar` não solta a conversa em `desconhecido`, e ela fica presa até alguém conferir, mesmo sem nada ter saído.

**Mudança sugerida** (a mesma regra que o Vibe usa desde a v18):

```ts
const tempoMinimo = (r: any) =>
  r.http < 500 && r.data?.result === "error" &&
  /tempo\s+m[ií]nimo/i.test(`${r.data?.dialog_execution_return ?? ""} ${r.data?.description ?? ""}`);
const rejeitado = (r: any) =>
  r.http < 500 && r.data.result === "error" && (r.data.code === 400 || tempoMinimo(r));
```

Com isso:
- o envio fica `falhou`;
- o `finalizar` solta a conversa sem margem (nada foi executado);
- a tela pode mostrar "O ChatGuru exige 2 minutos entre mensagens para a mesma conversa. Tente de novo em instantes." quando `tempoMinimo(dialogo)` for verdadeiro.

Nada foi alterado no código do Imposition.

### 6. Drenagem e pausa na troca e na reversão (pedido da equipe do Imposition, 09/11/2026)

**Regra:** a migração e a reversão só rodam sem envio em andamento de nenhum dos dois lados. "Em andamento" é:
- **Vibe:** aviso em `preparando` em `expedicao_aviso_pronto`;
- **Imposition:** envio de arte em `preparando` em `imposition_whatsapp_artes`, ou conversa com `chave_envio` ocupada por um envio de arte nesse estado.

**Como a migração confere (parte 0 do arquivo):** a função `chatguru_trava_drenagem(p_reversao)` é a primeira coisa da migração e a primeira linha do rodapé de reversão.
1. Prende a escrita nas três tabelas até o fim da transação (`share row exclusive`, com no máximo 5 s de espera por quem já está escrevendo). Assim, nenhum envio novo começa entre a conferência e a troca.
2. Lista os envios em andamento. Se houver algum, aborta a transação inteira com "Migracao abortada: ha envio em andamento…" (ou "Reversao abortada"), uma linha por envio: lado, aviso ou envio de arte (início da chave), pedido ou OS, e desde quando.
3. Na reversão, também aborta se alguma conversa estiver com a margem correndo (`livre_em` no futuro), porque a margem some junto com a coluna.
4. Sem abortar, avisa (NOTICE) as conversas presas por envio de arte em `desconhecido`. Elas continuam presas do mesmo jeito depois da troca, e o painel do Imposition resolve como hoje. Na reversão, avisa também as travas `vibe:` que o rodapé vai soltar.

Envio em `preparando` de qualquer idade aborta, inclusive o que ficou preso por queda da função. Ele é resolvido à mão antes: no Vibe pelo ADM, depois de conferir no ChatGuru; no Imposition pela equipe deles. Com isso, a passagem da parte 7 ficou só com `desconhecido`.

**Situação em 09/11/2026 (leitura):**
- nenhum aviso do Vibe nem envio de arte em `preparando`;
- uma conversa presa há cerca de 9 h por um envio de arte em `desconhecido`, que entraria só no aviso, sem abortar.

**A pausa é o que garante; a drenagem confere.** Uma chamada do Imposition que comece durante a migração espera o bloqueio. Quando ele cai, pode rodar o texto antigo da RPC, que já tinha sido carregado. Por isso os dois lados param antes, e não só o banco confere.

**Pausar no Vibe:** a v19 ganha um interruptor no servidor, o secret `CHATGURU_AVISOS_PAUSA`.
- Com o valor `ligada`, a Edge Function `expedicao-pedido-pronto` recusa todo aviso novo (pedido pronto, Testar modelo, Pedido em Produção) com "Envio de avisos pausado por alguns minutos. Tente de novo em instantes.".
- A recusa vem antes de reservar a linha, então nada novo vira `preparando`.
- O "Liberar número" continua funcionando.
- Liga e desliga sem deploy. Conferir com uma tentativa no pedido de teste 24880, que deve voltar a mensagem de pausa.
- Na ida, a v19 já não envia antes da migração (fail-closed sem a função `travar`); a pausa troca o "Trava compartilhada indisponível" por uma mensagem clara e não deixa linhas em `falhou`.

**Pausar no Imposition (o que eles teriam de fazer):**
1. Um interruptor equivalente no `painel`, conferido antes de chamar `imposition_whatsapp_dialogo_reservar` e `_reenviar`, com mensagem própria e sem tocar no banco. Pode ser um secret da função deles.
2. Confirmar que nada chama essas RPCs fora do botão, como reenvio automático ou rotina agendada. Se houver, a pausa precisa cobrir também.
3. Sem o interruptor, a alternativa é combinar com a equipe de não enviar arte por alguns minutos. É mais fraca: a drenagem ainda aborta sem estrago se alguém enviar, mas não cobre a chamada que começa durante a migração.

**Sequência da troca:**
1. **Pausar:** o Vibe (`CHATGURU_AVISOS_PAUSA = ligada`) e o Imposition (interruptor deles).
2. **Esperar uns 2 minutos:** o que estava em curso termina, porque a chamada ao ChatGuru tem limite de tempo. Conferir por leitura que nada está em andamento:
   ```sql
   select 'vibe' as lado, id::text, atualizado_em from public.expedicao_aviso_pronto where estado = 'preparando'
   union all
   select 'imposition', left(chave, 12), atualizado_em from public.imposition_whatsapp_artes where estado = 'preparando';
   ```
3. **Rodar a migração inteira**, numa transação. Se abortar, ela lista o que estava em andamento; espere e rode de novo.
4. **Retomar o Imposition primeiro:** o código deles não muda, só as RPCs ganharam a margem. Um envio de arte de teste deve deixar no `chatguru_trava_registro` as linhas `imposition reservado` e `executado`.
5. **Retomar o Vibe por último:** desligar a pausa e testar com o pedido 24880 em modo teste. O registro deve mostrar `vibe reservado` e `executado`. O caminho do Vibe é o novo, então entra sozinho, depois que o lado que não mudou já foi conferido.

**Sequência da reversão:**
1. **Pausar** os dois lados, como na troca.
2. **Conferir:** esperar a margem acabar (padrão 10 s, no máximo 2 min) e o que estiver em curso. A primeira linha do rodapé, `select public.chatguru_trava_drenagem(true)`, aborta e lista se ainda houver envio em andamento ou margem correndo.
3. **Reverter:** o resto do rodapé, na mesma transação. Solta as travas `vibe:`, devolve as RPCs e a chave estrangeira e apaga as funções, inclusive a de drenagem.
4. **Retomar:**
   - primeiro sai a pausa do Imposition, que volta às RPCs de antes sem mudar código;
   - depois o Vibe volta para a v18, que não usa a trava. A v18 não tem a pausa, mas até esse deploy a v19 segue sem enviar: pausada e, sem a função `travar`, fail-closed.

**Teste:** casos D1 a D5 no arquivo de teste.

| Caso | O que faz | Esperado |
|---|---|---|
| D1 | envio de arte de teste em `preparando`, ocupando uma conversa | aborta, "Migracao abortada" |
| D2 | aviso do Vibe de teste em `preparando` | aborta |
| D3 | sem nenhum dos dois | "drenado" |
| D4 | depois da migração, conversa com margem correndo, em modo reversão | aborta, "Reversao abortada" |
| D5 | sem margem correndo | "drenado" |

D3 e D5 também dão FALHA se houver envio real em andamento na hora do teste: é a drenagem funcionando, e basta rodar de novo.

## Lado do Vibe (Edge Function `expedicao-pedido-pronto`, v19: pronta no repositório, sem deploy)

Feita em 09/11/2026 como descrito abaixo, com a pausa `CHATGURU_AVISOS_PAUSA`. Testes da lógica: casos O e P de `scripts/testes/expedicao-aviso-pronto.test.mts`. Deploy só na janela: roteiro em [CHATGURU-TRAVA-JANELA.md](CHATGURU-TRAVA-JANELA.md).

No caminho comum a todos os avisos (`enviarParaConversas` -> `reservarLinha`), o que cobre de uma vez o pedido pronto, o Testar modelo e o Pedido em Produção:

1. Depois de reservar a linha em `expedicao_aviso_pronto`, chamar `imposition_whatsapp_conversa_travar(destino_chave, 'vibe:' || id)`.
   - Se vier `ocupado`, marcar a linha como `falhou`, sem chamar o ChatGuru, e mostrar "Há uma operação pendente para esta conversa".
   - Se a chamada falhar (função inexistente ou erro), marcar `falhou` com "Trava compartilhada indisponível" e não chamar o ChatGuru.
2. Ao terminar:
   - com "Diálogo Executado", `soltar(destino, chave, true)`, que aplica a margem;
   - com `falhou`, inclusive na recusa dos 120 s, `soltar(destino, chave, false)`;
   - em `desconhecido` ou numa reserva interrompida, não soltar: o "Liberar número" solta, com `false`.
3. A trava própria do Vibe (índice em `expedicao_aviso_pronto`) continua.
4. Pausa: o secret `CHATGURU_AVISOS_PAUSA` = `ligada` recusa todo aviso novo antes de reservar a linha, com "Envio de avisos pausado por alguns minutos. Tente de novo em instantes.". O "Liberar número" continua funcionando (item 6).
5. Ordem para ligar: a tabela do item 3 da revisão 4.

## Pontos para combinar com o Imposition

- **Pausa do lado deles:** um interruptor no `painel` antes de `reservar` e `reenviar`, e a confirmação de que nada chama essas RPCs fora do botão (item 6 da revisão 4).
- **A trava é mútua:** o Vibe passa a ocupar linhas de `imposition_whatsapp_conversas` em todo aviso. O envio de arte recebe "Há uma operação pendente para esta conversa" enquanto um aviso do Vibe está em andamento, em resultado desconhecido ou dentro da espera. Na Expedição isso acontece muito mais que no aviso de produção.
- **O `finalizar` do Imposition** só solta a conversa quando ela é dele (`chave_envio = p_chave`), então nunca solta uma trava do Vibe. Com a revisão 4, ele grava `livre_em` (margem) quando o diálogo foi executado.
- **Leituras da coluna:** quem lê `chave_envio` esperando sempre uma chave de `imposition_whatsapp_artes` precisa aceitar o prefixo `vibe:`. Não há leitor assim nas RPCs nem no código do `painel` v283.
- **Normalização do item 3:** entra nos dois códigos como conferência (recusa se o texto cru diferir do normalizado), sem mudar o valor da chave; ver passo 4 da transição.

## Campos que o Vibe grava em cada diálogo

A API do ChatGuru que o Vibe usa (`chat_update_custom_fields`, `dialog_execute`, `message_send`, `message_status`) não lê o texto do template. O que o Vibe grava hoje:

| Diálogo | id | Campos gravados antes de executar |
|---|---|---|
| Sedex | 6aef26a47b47d7256c8924ae | Sedex_Conhecimento, Pedido_Atual, Nota_Fiscal |
| Motoboy | 6aef36709e91cf335ffdf6fd | Pedido_Atual, Nota_Fiscal |
| Retira | 6aef3674e2ff0962de8545fc | Pedido_Atual, Nota_Fiscal |
| Veppo | 6aef3678e11ead8b0e4f40b6 | Cidade_Destino, Pedido_Atual, Nota_Fiscal |
| Azul | 6aef367de2ff0962de8545ff | Pedido_Atual, Nota_Fiscal, Cidade_Destino |
| Transportadora | 6aef36a7eab83021c5d20230 | Cidade_Destino, Pedido_Atual, Nota_Fiscal |
| Pedido em Produção | 6071c6dbe34a18c2cc684747 | Link_do_Cliente (desde 09/11/2026) |
| Envio de arte (Imposition) | 6aef191d04236cee4e7075c1 | Link_do_Cliente, Pedido_Atual |

Se algum template da Expedição usar um campo fora da sua linha, por exemplo `Link_do_Cliente`, a mensagem sai com o último valor gravado na conversa, que pode ser de outro pedido.
