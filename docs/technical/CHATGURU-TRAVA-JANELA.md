# ChatGuru: roteiro da janela da trava compartilhada (Vibe + Imposition)

> **Situação (09/11/2026):** a equipe do Imposition aprovou tecnicamente a revisão 4 (reproduziu os 46 testes que devem passar). **Nada aplicado.** A janela será combinada com os dois sistemas pausados. A v19 do Vibe está pronta no repositório, **sem deploy**.
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

1. O Imposition tem a pausa pronta: um interruptor no `painel` conferido antes de chamar `imposition_whatsapp_dialogo_reservar` e `_reenviar`. Ele confirma que nada mais chama essas RPCs, como reenvio automático ou rotina agendada.
2. Autorização nominal do dono para a migração e para o deploy da v19.
3. Abrir em abas, antes de começar, os dois arquivos SQL e as consultas deste roteiro.
4. A janela leva uns 15 minutos, com os avisos do Vibe e o envio de arte parados. Escolher um horário de pouco movimento.

## Ida

**Diferença em relação à lista combinada:** o deploy da v19 vem **antes** da migração, logo depois do secret. A v18, que está no ar hoje, não lê `CHATGURU_AVISOS_PAUSA`, então só a v19 pausa o Vibe. Com o deploy depois da migração, haveria dois problemas:
- durante a migração, o Vibe estaria enviando;
- entre a migração e o deploy, a v18 enviaria sem respeitar a trava compartilhada.

Com o secret gravado antes, a v19 já nasce pausada. Pausada, ela não chama a trava, então pode ir ao ar antes da migração sem risco.

### 1. Pausar o Vibe: secret, depois deploy da v19

| | |
|---|---|
| **Quem** | Vibe (deploy com autorização do dono) |
| **Faz** | (a) No painel da Supabase, Edge Functions → Secrets, grava `CHATGURU_AVISOS_PAUSA` = `ligada`. (b) Faz o deploy da `expedicao-pedido-pronto` (v19) a partir do repositório. |
| **Confere** | A função aparece com a versão nova no painel. No pedido de teste **24880**, "Avisar cliente" (ou "Testar modelo") volta "Envio de avisos pausado por alguns minutos. Tente de novo em instantes." e nenhuma linha nova aparece em `expedicao_aviso_pronto`. |
| **Se não pausar** | Esperar 1 minuto e tentar de novo. Se seguir enviando, parar a janela e voltar a v18 (deploy do commit `46808cb5`). |

Qualquer valor no secret diferente de vazio ou `desligada` também pausa: um erro de digitação deixa o Vibe parado, nunca enviando. O "Liberar número", a lista e "Ver conversas" seguem funcionando.

### 2. Pausar o Imposition

| | |
|---|---|
| **Quem** | Imposition |
| **Faz** | Liga o interruptor de pausa no `painel`. |
| **Confere** | Uma tentativa de envio de arte volta a mensagem de pausa deles, e nenhum envio novo vira `preparando`. |

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
| **Se abortar** | "Migracao abortada: ha envio em andamento…" lista o que estava em curso, e **nada foi aplicado**. Voltar ao passo 3. Um erro de bloqueio (`lock timeout`) também não aplicou nada: rodar de novo. |

```sql
-- 4b. Conferência depois da migração (todas true)
select
  not exists (select 1 from pg_constraint where conname = 'imposition_whatsapp_conversas_chave_envio_fkey') as fk_saiu,
  exists (select 1 from pg_constraint where conname = 'imposition_whatsapp_conversas_chave_envio_check') as check_entrou,
  exists (select 1 from information_schema.columns where table_schema = 'public'
          and table_name = 'imposition_whatsapp_conversas' and column_name = 'livre_em') as livre_em_existe,
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
| **Faz** | O Imposition desliga a pausa e faz **um** envio de arte de teste. |
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
| **Se abortar** | "Reversao abortada…" lista envio em andamento ou margem correndo, e **nada foi desfeito**. Voltar ao V3. |

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
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
     and proname like 'imposition_whatsapp_dialogo_%' and prosrc like '%livre_em%') = 0 as rpcs_voltaram,
  not exists (select 1 from public.imposition_whatsapp_conversas where chave_envio like 'vibe:%') as sem_trava_vibe;
```

### V5. Retomar o Imposition

| | |
|---|---|
| **Quem** | Imposition |
| **Faz** | Desliga a pausa e faz um envio de arte de teste. O código deles não muda: as RPCs voltaram ao texto de antes. |
| **Confere** | O envio chega e a conversa é solta no fim, como antes da trava compartilhada. |

### V6. Retomar o Vibe: deploy da v18

| | |
|---|---|
| **Quem** | Vibe, com autorização do dono para o deploy |
| **Faz** | Deploy da `expedicao-pedido-pronto` no texto da v18 (commit `46808cb5`, que não usa a trava compartilhada). Depois, apaga o secret `CHATGURU_AVISOS_PAUSA`: a v18 não o lê. |
| **Confere** | Um aviso no 24880 (modo teste) chega e fica executado. Até esse deploy, a v19 não envia: está pausada e, sem a função `travar`, recusa tudo. |

## Pontos de atenção

- **Soltar que falha:** se a v19 não conseguir soltar a conversa depois do ChatGuru (duas tentativas), a conversa fica ocupada. Esse é o lado seguro, e o erro vai para o log da função. O "Liberar número" só age em aviso `desconhecido`, então um `executado` com a conversa ainda presa precisa de liberação manual, com autorização: `select public.imposition_whatsapp_conversa_soltar('<destino_chave>', 'vibe:<id>', false);`.
- **A reversão não foi executada em teste.** O arquivo de teste do editor cobre a ida (49 casos), não a volta.
