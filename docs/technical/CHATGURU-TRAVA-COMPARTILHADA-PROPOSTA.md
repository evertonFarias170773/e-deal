# ChatGuru: trava por conversa compartilhada (proposta)

> **Situação:** proposta de 09/11/2026. A ideia foi aprovada pela equipe do Imposition com cinco ajustes, tratados na revisão 2 (abaixo). **Não aplicada**: nada no banco nem nas funções.
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

As duas funções recusam parâmetro nulo, de forma explícita. Antes, `p_chave` nulo passava pelo `!~` (nulo não é verdadeiro nem falso) e podia responder "reservado" sem ocupar a conversa. A chave do Vibe é `vibe:` seguido de um UUID no formato 8-4-4-4-12.

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
- **Antes de ligar:** um passo único, no mesmo momento do deploy, faz cada aviso do Vibe em "desconhecido" (e em "preparando" há mais de 2 minutos) ocupar a conversa em `imposition_whatsapp_conversas` com `vibe:<id>`. Se a conversa já estiver ocupada por um envio de arte, o caso fica listado para conferência manual e não é sobrescrito.

### 5. Quando o Guru lê os campos (teste pendente)

**Pergunta:** depois do "Diálogo Executado", o ChatGuru ainda lê os campos da conversa por algum tempo? Se sim, uma gravação de outro sistema logo depois troca o valor da mensagem que acabou de sair. Nesse caso a trava precisa ficar presa mais um pouco depois da execução.

**Teste combinado:** conversa "Edison Junior - 14", diálogo Retira, pedido 24880.
1. Gravar `Pedido_Atual` = 24880.
2. Executar o diálogo.
3. Logo depois da resposta, gravar `Pedido_Atual` = 99999.
4. Repetir com 2, 5 e 15 segundos de espera antes da segunda gravação.
5. Conferir no WhatsApp qual número chegou em cada uma das quatro mensagens.

**Situação em 09/11/2026:** o teste não foi feito. A segunda gravação (99999) exige chamar o ChatGuru com a chave da integração. Essa chave só existe dentro das Edge Functions, e o Vibe não tem ação que grave um valor arbitrário. Fazer o teste pede uma ação temporária na função (só modo teste, cliente #14, só ADM, removida depois) ou alguém com acesso ao ChatGuru fazendo as gravações à mão.

**Proposta de espera, até o resultado:** a trava fica presa **30 segundos** depois do "Diálogo Executado". O valor é provisório e conservador. Com o resultado, vira o maior tempo em que a segunda gravação ainda trocou o número, mais uma folga de 2 vezes. Se nenhuma das quatro mensagens chegar com 99999, a espera cai para 2 segundos.

Como segurar sem dormir dentro da função: uma coluna `livre_em` em `imposition_whatsapp_conversas`. Os dois sistemas, ao terminar com sucesso, soltam `chave_envio` e gravam `livre_em = now() + espera`. A conversa conta como ocupada enquanto `chave_envio` não for nulo **ou** `livre_em` estiver no futuro. Isso exige uma linha a mais nas RPCs `reservar` e `reenviar` do Imposition e no `finalizar`, que passa a gravar `livre_em`. Sem isso, o envio de arte soltaria a conversa na hora e a espera valeria só para o Vibe.

## SQL proposta (revisão 2, não aplicada)

```sql
-- A) Sem chave estrangeira; formato da chave conferido.
alter table public.imposition_whatsapp_conversas
  drop constraint imposition_whatsapp_conversas_chave_envio_fkey;
alter table public.imposition_whatsapp_conversas
  add constraint imposition_whatsapp_conversas_chave_envio_check
  check (chave_envio is null
         or chave_envio ~ '^[a-f0-9]{64}$'
         or chave_envio ~ '^vibe:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
alter table public.imposition_whatsapp_conversas add column livre_em timestamptz;

-- B) Integridade: o dono da trava existe (item 2).
create or replace function public.imposition_whatsapp_conversas_dono_existe()
returns trigger language plpgsql set search_path to '' as $$
begin
  if new.chave_envio is null then return new; end if;
  if new.chave_envio like 'vibe:%' then
    if not exists (select 1 from public.expedicao_aviso_pronto where id = substr(new.chave_envio, 6)::uuid) then
      raise exception 'Trava sem aviso do Vibe: %', new.chave_envio;
    end if;
  elsif not exists (select 1 from public.imposition_whatsapp_artes where chave = new.chave_envio) then
    raise exception 'Trava sem envio de arte: %', new.chave_envio;
  end if;
  return new;
end $$;
create trigger imposition_whatsapp_conversas_dono
  before insert or update of chave_envio on public.imposition_whatsapp_conversas
  for each row execute function public.imposition_whatsapp_conversas_dono_existe();

-- B2) Não apagar o dono de uma trava ativa (o que a chave estrangeira garantia).
create or replace function public.imposition_whatsapp_trava_nao_apagar()
returns trigger language plpgsql set search_path to '' as $$
declare v_chave text := case when tg_table_name = 'expedicao_aviso_pronto' then 'vibe:' || old.id::text else old.chave end;
begin
  if exists (select 1 from public.imposition_whatsapp_conversas where chave_envio = v_chave) then
    raise exception 'Registro segura a conversa: libere antes de apagar';
  end if;
  return old;
end $$;
create trigger expedicao_aviso_pronto_trava_nao_apagar before delete on public.expedicao_aviso_pronto
  for each row execute function public.imposition_whatsapp_trava_nao_apagar();
create trigger imposition_whatsapp_artes_trava_nao_apagar before delete on public.imposition_whatsapp_artes
  for each row execute function public.imposition_whatsapp_trava_nao_apagar();

-- C) Ocupar a conversa para um aviso do Vibe (item 1: nada nulo, UUID válido).
create or replace function public.imposition_whatsapp_conversa_travar(p_destino text, p_chave text)
returns text language plpgsql set search_path to '' as $$
declare v record;
begin
  if p_destino is null or p_chave is null then raise exception 'Parametro nulo'; end if;
  if p_destino !~ '^[a-f0-9]{64}$'
     or p_chave !~ '^vibe:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Parametro invalido';
  end if;
  insert into public.imposition_whatsapp_conversas(destino_chave) values (p_destino) on conflict do nothing;
  select chave_envio, livre_em into v from public.imposition_whatsapp_conversas where destino_chave = p_destino for update;
  if v.chave_envio is not null or v.livre_em > now() then return 'ocupado'; end if;
  update public.imposition_whatsapp_conversas set chave_envio = p_chave, livre_em = null, atualizado_em = now()
   where destino_chave = p_destino;
  return 'reservado';
end $$;

-- D) Soltar, só se a conversa ainda é deste aviso; p_espera segura depois do "Diálogo Executado" (item 5).
create or replace function public.imposition_whatsapp_conversa_soltar(p_destino text, p_chave text, p_espera interval)
returns boolean language plpgsql set search_path to '' as $$
begin
  if p_destino is null or p_chave is null or p_espera is null then raise exception 'Parametro nulo'; end if;
  if p_espera < interval '0' or p_espera > interval '5 minutes' then raise exception 'Espera invalida'; end if;
  update public.imposition_whatsapp_conversas
     set chave_envio = null, livre_em = now() + p_espera, atualizado_em = now()
   where destino_chave = p_destino and chave_envio = p_chave;
  return found;
end $$;

revoke all on function public.imposition_whatsapp_conversa_travar(text, text) from public, anon, authenticated;
revoke all on function public.imposition_whatsapp_conversa_soltar(text, text, interval) from public, anon, authenticated;
grant execute on function public.imposition_whatsapp_conversa_travar(text, text) to service_role;
grant execute on function public.imposition_whatsapp_conversa_soltar(text, text, interval) to service_role;

-- E) Imposition: uma linha a mais (só se a espera do item 5 for maior que zero).
--    Em imposition_whatsapp_dialogo_reservar e _reenviar:
--      IF ocupado IS NOT NULL OR (SELECT livre_em FROM ... WHERE destino_chave = p_destino) > now() THEN RETURN 'ocupado'; END IF;
--    Em imposition_whatsapp_dialogo_finalizar, ao soltar com sucesso:
--      SET chave_envio = NULL, livre_em = now() + <espera>, ...

-- F) Passagem (item 4), no momento do deploy: avisos do Vibe em 'desconhecido',
--    ou em 'preparando' há mais de 2 minutos, ocupam a conversa; conversa já ocupada fica listada, não é sobrescrita.
insert into public.imposition_whatsapp_conversas(destino_chave)
  select distinct destino_chave from public.expedicao_aviso_pronto
   where destino_chave is not null
     and (estado = 'desconhecido' or (estado = 'preparando' and atualizado_em < now() - interval '2 minutes'))
  on conflict do nothing;
update public.imposition_whatsapp_conversas c set chave_envio = 'vibe:' || a.id::text, atualizado_em = now()
  from public.expedicao_aviso_pronto a
 where a.destino_chave = c.destino_chave and c.chave_envio is null
   and (a.estado = 'desconhecido' or (a.estado = 'preparando' and a.atualizado_em < now() - interval '2 minutes'));
```

## Lado do Vibe (Edge Function `expedicao-pedido-pronto`)

No caminho comum a todos os avisos (`enviarParaConversas` -> `reservarLinha`), o que cobre de uma vez o pedido pronto, o Testar modelo e o Pedido em Produção:

1. Calcular `destino_chave` com a normalização do item 3.
2. Depois de reservar a linha em `expedicao_aviso_pronto`, chamar `imposition_whatsapp_conversa_travar(destino_chave, 'vibe:' || id)`.
   - Se vier `ocupado`, marcar a linha como `falhou`, sem chamar o ChatGuru, e mostrar "Há uma operação pendente para esta conversa".
3. Ao terminar:
   - com `executado`, chamar `imposition_whatsapp_conversa_soltar` com a espera do item 5;
   - com `falhou`, soltar com espera zero;
   - em `desconhecido`, ou numa reserva interrompida, não soltar: o "Liberar número" solta.
4. A trava própria do Vibe continua e cobre dois avisos do Vibe sem passar pelo Imposition.
5. Ordem para ligar, só com a trava compartilhada no ar e conferida:
   1. passo F (passagem);
   2. a trava passa a valer nos dois sistemas;
   3. sai o "Envio de aviso de produção em ajuste";
   4. o modo teste é desligado.

## Pontos para combinar com o Imposition

- **A trava é mútua:** o Vibe passa a ocupar linhas de `imposition_whatsapp_conversas` em todo aviso. O envio de arte recebe "Há uma operação pendente para esta conversa" enquanto um aviso do Vibe está em andamento, em resultado desconhecido ou dentro da espera. Na Expedição isso acontece muito mais que no aviso de produção.
- **O `finalizar` do Imposition** só solta a conversa quando ela é dele (`chave_envio = p_chave`), então nunca solta uma trava do Vibe. Com a espera do item 5, ele passa a gravar `livre_em`.
- **Leituras da coluna:** quem lê `chave_envio` esperando sempre uma chave de `imposition_whatsapp_artes` precisa aceitar o prefixo `vibe:`. Não achei leitor assim nas RPCs.
- **Normalização do item 3:** entra nos dois códigos no mesmo deploy.

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
