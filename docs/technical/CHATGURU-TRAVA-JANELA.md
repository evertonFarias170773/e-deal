# ChatGuru: roteiro da janela da trava compartilhada (Vibe + Imposition)

> **Situação (09/11/2026):** a equipe do Imposition aprovou tecnicamente a revisão 4 (reproduziu os 46 testes que devem passar). **Nada aplicado.** A janela será combinada com os dois sistemas pausados. A v19 do Vibe está pronta no repositório, **sem deploy**.
>
> **Atualização (10/11/2026):** o Imposition publicou a função `painel` v285, com a pausa `CHATGURU_ARTES_PAUSA` e a recusa dos 120 s do ChatGuru tratada como falha. Conferido por leitura no mesmo dia:
> - as três RPCs do Imposition (reservar, reenviar e finalizar) seguem com o md5 de corpo aprovado em 09/11, então a parte 0b da migração não aborta por elas;
> - a v19 do repositório tem tudo da v21 no ar (homologação e Link_do_Cliente só com o final), somado à trava;
> - o `CHATGURU-TRAVA-FICHAS.patch` foi gerado de novo sobre as fichas atuais e aplica com `git apply`.
>
> **Nada aplicado.**
>
> **Produção sem a trava (10/11/2026, 15:30):** decisão do Everton e do Edison, assumindo o risco de colisão de campos com o envio de arte do Imposition. A v22 tirou o bloqueio "Envio de aviso de produção em ajuste", e o modo teste será desligado. A janela fica para depois. Antes dela, revisar o `CHATGURU-TRAVA-FICHAS.patch` e o passo 8, que ainda falam do modo teste e do "em ajuste" ligados.
>
> Arquivos:
> - migração: [CHATGURU-TRAVA-COMPARTILHADA-MIGRACAO.sql](CHATGURU-TRAVA-COMPARTILHADA-MIGRACAO.sql)
> - reversão: [CHATGURU-TRAVA-COMPARTILHADA-REVERSAO.sql](CHATGURU-TRAVA-COMPARTILHADA-REVERSAO.sql)
> - proposta: [CHATGURU-TRAVA-COMPARTILHADA-PROPOSTA.md](CHATGURU-TRAVA-COMPARTILHADA-PROPOSTA.md)
> - função do Vibe: `supabase/functions/expedicao-pedido-pronto` (v19)

## Quem faz

| Papel | Quem |
|---|---|
| **Vibe** | responsável pelo Vibe: secret, deploy da função e consultas de leitura |
| **Dono** | autorização nominal da migração (DDL em produção) e do deploy; roda os arquivos no SQL Editor |
| **Imposition** | equipe do Imposition: pausa, retomada e envio de arte de teste do lado deles |

Todos os SQL rodam no **SQL Editor da Supabase** (projeto de produção): a IDE não roda DDL em produção. Migração e reversão: **o arquivo inteiro numa execução**, sem BEGIN nem COMMIT. O editor roda tudo numa transação implícita; qualquer erro desfaz tudo e não deixa transação aberta.

## Antes do dia

1. O Imposition tem a pausa pronta: o secret `CHATGURU_ARTES_PAUSA`, lido pela função `painel` (v285, no ar desde 10/11/2026) antes de chamar `imposition_whatsapp_dialogo_reservar` e `_reenviar`. Ele confirma que nada mais chama essas RPCs, como reenvio automático ou rotina agendada.
2. Autorização nominal do dono para a migração e para o deploy da v19.
3. Abrir em abas, antes de começar, os dois arquivos SQL e as consultas deste roteiro.
4. A janela leva uns 15 minutos, com os avisos do Vibe e o envio de arte parados. Escolher um horário de pouco movimento.

## Ida

**Diferença em relação à lista combinada:** o deploy da v19 vem **antes** da migração, logo depois do secret. A v21, que está no ar hoje (como a v18 antes dela), não lê `CHATGURU_AVISOS_PAUSA`, então só a v19 pausa o Vibe. Com o deploy depois da migração, haveria dois problemas:
- durante a migração, o Vibe estaria enviando;
- entre a migração e o deploy, a v21 enviaria sem respeitar a trava compartilhada.

Com o secret gravado antes, a v19 já nasce pausada. Pausada, ela não chama a trava, então pode ir ao ar antes da migração sem risco.

### 1. Pausar o Vibe: secret, depois deploy da v19

| | |
|---|---|
| **Quem** | Vibe (deploy com autorização do dono) |
| **Faz** | (a) No painel da Supabase, Edge Functions → Secrets, grava `CHATGURU_AVISOS_PAUSA` = `ligada`. (b) Faz o deploy da `expedicao-pedido-pronto` (v19) a partir do repositório. |
| **Confere** | A função aparece com a versão nova no painel. No pedido de teste **24880**, "Avisar cliente" (ou "Testar modelo") volta "Envio de avisos pausado por alguns minutos. Tente de novo em instantes." e nenhuma linha nova aparece em `expedicao_aviso_pronto`. |
| **Se não pausar** | Esperar 1 minuto e tentar de novo. Se seguir enviando, parar a janela e voltar à versão que estava no ar antes (ver "Versão de volta" abaixo). |

Qualquer valor no secret diferente de vazio ou `desligada` também pausa: um erro de digitação deixa o Vibe parado, nunca enviando. O "Liberar número", a lista e "Ver conversas" seguem funcionando.

**Versão de volta (10/11/2026).** Desde a homologação, a função de antes da janela é a **v22**: a v18 mais o modo homologação, o Link_do_Cliente só com o final (numero_pedido-token, como o Imposition) e sem o bloqueio "em ajuste" (10/11, decisão da diretoria), sem a trava compartilhada. A fonte está em `supabase/edge-no-ar/expedicao-pedido-pronto/` (`index.ts` e `logica.ts`; a cópia de `transportadoras-parceiras.ts` vai como antes). A v22 está no ar desde 10/11/2026 15:30 (versão 21 no painel da Supabase): a volta sobe a v22. A v21 ainda tem o bloqueio "em ajuste". A v20 (commit `2ecbc78b`) grava o link inteiro e não deve voltar. A v18 (commit `46808cb5`) só serve se for preciso tirar também a homologação. A v19 do repositório já traz a homologação, então a ida não a perde.

**Fichas da trava depois das da homologação.** O `CHATGURU-TRAVA-FICHAS.patch` foi gerado de novo em 10/11/2026, sobre as fichas com a homologação e o formato do link já aplicados. Se alguma ficha de Expedição ou Pedidos mudar antes da janela, gerar o patch de novo, conferindo com `git apply --check`.

**Fichas do manual, no mesmo commit do deploy.** As fichas de Expedição e Pedidos com a trava compartilhada estão prontas em [CHATGURU-TRAVA-FICHAS.patch](CHATGURU-TRAVA-FICHAS.patch). Elas não entram antes porque o manual descreve o que está no ar, e o Maestro lê o manual. Logo depois do deploy:

```sh
git apply docs/technical/CHATGURU-TRAVA-FICHAS.patch
# troca {DATA DA JANELA} pela data do dia (dd/mm/aaaa) nas duas fichas, por exemplo:
sed -i 's#{DATA DA JANELA}#dd/mm/aaaa#g' docs/manual/expedicao.md docs/manual/pedidos.md
grep -rn "DATA DA JANELA" docs/manual   # precisa voltar vazio
```

Depois, commit e publicação, como sempre (AGENTS.md). Anotar o hash desse commit, porque a volta o desfaz. Se o `git apply` recusar, alguém mexeu nas fichas desde o patch: aplicar à mão, conferindo o texto do patch.

### 2. Pausar o Imposition

| | |
|---|---|
| **Quem** | Imposition (pausa e tentativa), Vibe (leitura) |
| **Faz** | (a) Liga a pausa: secret `CHATGURU_ARTES_PAUSA` da função `painel` (v285). (b) Anota a hora e faz **uma tentativa autenticada** de envio de arte, com um usuário de verdade do painel, como no uso normal. |
| **Confere** | A tentativa mostra a mensagem de pausa do Imposition. A consulta 2b, com a hora anotada, volta **zero linhas**: nenhuma arte foi criada ou mexida depois da tentativa, nem há registro `preparando`. |
| **Se não pausar** | Se a tentativa enviou, ou se a 2b mostrar linha nova ou `preparando`, a janela para aqui. O Vibe já está pausado e continua assim, sem risco, até o Imposition corrigir a pausa. Uma tentativa sem login, recusada por falta de sessão, não vale como conferência da pausa. |

```sql
-- 2b. Depois da tentativa (precisa voltar vazio). Trocar a hora pela anotada, em Brasília.
select left(chave, 12) || '...' as arte, estado, criado_em, atualizado_em
  from public.imposition_whatsapp_artes
 where estado = 'preparando'
    or criado_em >= timestamptz 'AAAA-MM-DD HH:MI:SS-03'
    or atualizado_em >= timestamptz 'AAAA-MM-DD HH:MI:SS-03';
```

### 3. Conferir a drenagem (leitura)

| | |
|---|---|
| **Quem** | Vibe |
| **Faz** | Espera uns 2 minutos depois das duas pausas, para terminar o que estava em curso (a chamada ao ChatGuru tem limite de 20 s), e roda a consulta abaixo. |
| **Confere** | A primeira consulta volta **zero linhas**. A segunda é só para conhecimento: conversa presa por envio de arte em `desconhecido` não impede a migração e continua presa do mesmo jeito depois dela. |
| **Se houver linhas** | Esperar mais e rodar de novo. Um `preparando` antigo, de função que caiu, é resolvido à mão antes: no Vibe pelo ADM, depois de conferir no ChatGuru; no Imposition pela equipe deles. |

```sql
-- 3a. Envio em andamento (precisa voltar vazio)
select 'vibe' as lado, id::text as item, estado, atualizado_em
  from public.expedicao_aviso_pronto where estado = 'preparando'
union all
select 'imposition', left(chave, 12) || '...', estado, atualizado_em
  from public.imposition_whatsapp_artes where estado = 'preparando'
union all
select 'imposition: conversa', left(c.destino_chave, 12) || '...', a.estado, c.atualizado_em
  from public.imposition_whatsapp_conversas c
  join public.imposition_whatsapp_artes a on a.chave = c.chave_envio
 where a.estado = 'preparando';

-- 3b. Só para conhecimento: conversas presas por arte em desconhecido
select left(c.destino_chave, 12) || '...' as conversa, left(a.chave, 12) || '...' as arte, c.atualizado_em
  from public.imposition_whatsapp_conversas c
  join public.imposition_whatsapp_artes a on a.chave = c.chave_envio
 where a.estado = 'desconhecido';
```

### 4. Aplicar a migração

| | |
|---|---|
| **Quem** | Dono, com a autorização nominal da migração |
| **Faz** | No SQL Editor, cola o conteúdo **inteiro** de `CHATGURU-TRAVA-COMPARTILHADA-MIGRACAO.sql` e clica em Run **uma vez**. Não acrescenta BEGIN nem COMMIT. O rodapé de reversão está todo comentado e não roda. |
| **Confere** | Termina sem erro, em cerca de 1 segundo. Depois roda a consulta 4b; todas as colunas devem dar `true`. |
| **Se abortar** | "Migracao abortada: ha envio em andamento…" lista o que estava em curso, e **nada foi aplicado**. Voltar ao passo 3. Um erro de bloqueio (`lock timeout`) também não aplicou nada: rodar de novo. "Migracao abortada: as RPCs do Imposition nao sao as da aprovacao…" quer dizer que uma das três RPCs mudou desde 09/11; **nada foi aplicado**, a janela para e a migração volta para revisão com a equipe do Imposition. |

```sql
-- 4b. Conferência depois da migração (todas true)
select
  not exists (select 1 from pg_constraint where conname = 'imposition_whatsapp_conversas_chave_envio_fkey') as fk_saiu,
  exists (select 1 from pg_constraint where conname = 'imposition_whatsapp_conversas_chave_envio_check') as check_entrou,
  exists (select 1 from information_schema.columns where table_schema = 'public'
          and table_name = 'imposition_whatsapp_conversas' and column_name = 'livre_em') as livre_em_existe,
  (select count(*) from public.chatguru_trava_rpcs_originais) = 3 as copia_das_rpcs_guardada,
  (select count(*) from pg_trigger where not tgisinternal and tgname in
     ('imposition_whatsapp_conversas_dono', 'expedicao_aviso_pronto_trava_nao_apagar',
      'imposition_whatsapp_artes_trava_nao_apagar')) = 3 as tres_gatilhos,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in
     ('imposition_whatsapp_conversa_travar', 'imposition_whatsapp_conversa_soltar',
      'chatguru_trava_margem', 'chatguru_trava_drenagem')) = 4 as funcoes_novas,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
     and proname like 'imposition_whatsapp_dialogo_%' and prosrc like '%livre_em%') = 3 as tres_rpcs_com_margem,
  (select margem = interval '10 seconds' from public.chatguru_trava_config) as margem_10s;
```

### 5. Deploy da v19

Já feito no passo 1. A v19 está no ar desde então, pausada. Pausada, ela não chama `travar`. Sem a pausa e antes da migração, ela também não enviaria: sem a função `travar`, recusa tudo com "Trava compartilhada indisponível".

### 6. Retomar o Imposition e conferir um envio de arte de teste

| | |
|---|---|
| **Quem** | Imposition (envio), Vibe (leitura) |
| **Faz** | O Imposition desliga a pausa (`CHATGURU_ARTES_PAUSA`) e faz **um** envio de arte de teste. |
| **Confere** | O envio chega. A consulta 6b mostra, para essa conversa, `imposition reservado` e depois `imposition executado`, e a conversa fica com `livre_em` cerca de 10 s no futuro logo após o envio. |

```sql
-- 6b / 7b. Últimos eventos da trava (os dois lados)
select id, origem, evento, left(chave, 18) as chave, left(destino_chave, 12) || '...' as conversa, em
  from public.chatguru_trava_registro order by id desc limit 10;
```

### 7. Retomar o Vibe e conferir um aviso no 24880 (modo teste)

| | |
|---|---|
| **Quem** | Vibe |
| **Faz** | No painel da Supabase, muda `CHATGURU_AVISOS_PAUSA` para `desligada` (ou apaga o secret). No pedido **24880** (modo teste, cliente 14), envia um aviso: "Avisar cliente"/"Reenviar" ou "Testar modelo". |
| **Confere** | A mensagem chega no WhatsApp de teste, a tela mostra o aviso como executado e a consulta 6b mostra `vibe reservado` e depois `vibe executado`, com a chave `vibe:<id do aviso>`. |
| **Atenção** | Se o envio de arte do passo 6 foi para a mesma conversa do 24880, esperar 2 minutos: o ChatGuru recusa mensagens com menos de 120 s de intervalo, e a tela mostraria "O ChatGuru exige 2 minutos…". |

### 8. Depois da janela

- O modo teste e o "Envio de aviso de produção em ajuste" **continuam ligados**. Saem só depois de uma semana de registro sem nenhuma linha em `chatguru_trava_conferencia` (passo 5 da transição na proposta).
- Conferência diária, só leitura: `select * from public.chatguru_trava_conferencia order by executado_em desc;` (deve voltar vazio).

## Volta (reversão)

Só com autorização nominal do dono e com **os dois lados pausados antes**.

### V1. Pausar o Vibe

| | |
|---|---|
| **Quem** | Vibe |
| **Faz** | `CHATGURU_AVISOS_PAUSA` = `ligada` (a v19 lê o secret a cada chamada, sem deploy). |
| **Confere** | No 24880, um aviso volta "Envio de avisos pausado…". |

### V2. Pausar o Imposition

Como no passo 2.

### V3. Conferir a drenagem e guardar o registro

| | |
|---|---|
| **Quem** | Vibe |
| **Faz** | Espera a margem acabar (padrão 10 s, no máximo 2 min) e roda a consulta 3a e a V3b. Exporta o registro: rodar `select * from public.chatguru_trava_registro order by id;` e baixar como CSV, porque a reversão apaga a tabela. |
| **Confere** | 3a e V3b vazias. |

```sql
-- V3b. Margem correndo (precisa voltar vazio)
select left(destino_chave, 12) || '...' as conversa, livre_em
  from public.imposition_whatsapp_conversas where livre_em > clock_timestamp();
```

### V4. Rodar a reversão

| | |
|---|---|
| **Quem** | Dono, com a autorização nominal |
| **Faz** | No SQL Editor, cola o conteúdo **inteiro** de `CHATGURU-TRAVA-COMPARTILHADA-REVERSAO.sql` e clica em Run uma vez. A primeira linha é a drenagem. |
| **Confere** | Sem erro. Depois, a consulta V4b deve dar `true` em todas as colunas. |
| **Se abortar** | "Reversao abortada…" lista envio em andamento ou margem correndo, e **nada foi desfeito**. Voltar ao V3. "Reversao abortada: copia das RPCs…" ou "…nao voltou igual a copia…" também não desfez nada: parar e chamar o suporte, sem rodar de novo. |

```sql
-- V4b. Conferência depois da reversão (todas true)
select
  exists (select 1 from pg_constraint where conname = 'imposition_whatsapp_conversas_chave_envio_fkey') as fk_voltou,
  not exists (select 1 from pg_constraint where conname = 'imposition_whatsapp_conversas_chave_envio_check') as check_saiu,
  not exists (select 1 from information_schema.columns where table_schema = 'public'
              and table_name = 'imposition_whatsapp_conversas' and column_name = 'livre_em') as livre_em_saiu,
  not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in
     ('imposition_whatsapp_conversa_travar', 'imposition_whatsapp_conversa_soltar',
      'chatguru_trava_margem', 'chatguru_trava_drenagem')) as funcoes_sairam,
  (select string_agg(proname || ':' || md5(replace(prosrc, chr(13), '')), ',' order by proname) from pg_proc
    where pronamespace = 'public'::regnamespace and proname like 'imposition_whatsapp_dialogo_%')
    = 'imposition_whatsapp_dialogo_finalizar:0018beec294adc90c673277f2fbefa9d,imposition_whatsapp_dialogo_reenviar:cfbdf0700bea66367eb8bd630f8891d5,imposition_whatsapp_dialogo_reservar:5d0f974f88467b896d9afb998697cb0c' as rpcs_voltaram,
  to_regclass('public.chatguru_trava_rpcs_originais') is null as copia_saiu,
  not exists (select 1 from public.imposition_whatsapp_conversas where chave_envio like 'vibe:%') as sem_trava_vibe;
```

### V5. Retomar o Imposition

| | |
|---|---|
| **Quem** | Imposition |
| **Faz** | Desliga a pausa e faz um envio de arte de teste. O código deles não muda: as RPCs voltaram da cópia guardada pela migração, iguais às de antes (definição, dono e permissões). |
| **Confere** | O envio chega e a conversa é solta no fim, como antes da trava compartilhada. |

### V6. Retomar o Vibe: deploy da versão de volta (v21)

| | |
|---|---|
| **Quem** | Vibe, com autorização do dono para o deploy |
| **Faz** | Deploy da `expedicao-pedido-pronto` na versão de volta (ver "Versão de volta" abaixo; nenhuma delas usa a trava compartilhada). Depois, apaga o secret `CHATGURU_AVISOS_PAUSA`: a versão de volta não o lê. No mesmo commit, desfaz as fichas: `git revert <hash do commit das fichas>`. |
| **Confere** | Um aviso no 24880 (modo teste) chega e fica executado. Até esse deploy, a v19 não envia: está pausada e, sem a função `travar`, recusa tudo. |

## Pontos de atenção

- **Soltar que falha:** se a v19 não conseguir soltar a conversa depois do ChatGuru (duas tentativas), a conversa fica ocupada. Esse é o lado seguro, e o erro vai para o log da função. O aviso volta marcado com a conversa presa, e o Administrador solta pelo **Liberar número** → **Soltar a conversa**, que exige confirmação e registra quem soltou e quando, em `liberado_por`/`liberado_em`. Só solta a chave `vibe:` do próprio aviso: o banco só apaga a trava quando `chave_envio` é exatamente essa, então nunca solta um envio de arte do Imposition.
- **A volta está no teste.** O teste do editor (63 casos) roda a ida, depois o texto de `CHATGURU-TRAVA-COMPARTILHADA-REVERSAO.sql` comando a comando, e compara o catálogo com uma foto tirada antes da ida (casos X0 a X11).
- **As RPCs do Imposition voltam da cópia.** A migração guarda, logo depois da drenagem, a definição, o dono e as permissões das três RPCs em `chatguru_trava_rpcs_originais` (parte 0b), e aborta se alguma não for a da aprovação. A reversão restaura dessa cópia, confere cada uma em md5 e só depois apaga a cópia. Motivo: na rodada de 10/11, as RPCs recriadas a partir do texto escrito no arquivo não voltaram iguais (X7 a X9).
- **CRLF do SQL Editor.** O editor entrega o texto com CRLF. Toda função que a migração cria ou altera fica gravada com `\r` no fim das linhas. Isso inclui as três RPCs do Imposition na versão rev4, as funções novas e os gatilhos. Não muda o funcionamento: 234 das 535 funções de `public` já estão assim. Nenhum texto entre aspas nas funções da migração ocupa mais de uma linha, então o `\r` não entra em mensagem nem em comparação. As conferências de md5 de corpo deste roteiro tiram o `\r` antes do md5. **Para a equipe do Imposition:** depois da janela, `pg_get_functiondef` das três RPCs mostra CRLF. Quem comparar com o código deles deve tirar o `\r` antes. Depois de uma reversão, elas voltam da cópia, com LF, iguais às de hoje.
- **A tela já tem o "Soltar a conversa"** desde a publicação do repositório, mas ele fica sem efeito enquanto a v21 (ou qualquer versão sem a trava) estiver no ar: essas versões nunca marcam uma conversa como presa.
- **Recusa dos 120 s no Imposition (v285).** Desde a v285 do `painel`, a recusa "tempo mínimo" do ChatGuru é falha no envio de arte, e não mais resultado desconhecido. É a mesma regra do Vibe desde 09/11: a arte fica como falhou e a conversa é solta, em vez de ficar presa até alguém conferir.
