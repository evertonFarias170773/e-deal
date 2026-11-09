# ChatGuru: trava por conversa compartilhada (proposta)

> **Situação:** proposta de 09/11/2026, revista no mesmo dia; **não aplicada**. Precisa ser combinada com a equipe do Imposition antes.
> **Alcance:** a trava compartilhada vale para **todos os avisos do Vibe** que usam a Edge Function `expedicao-pedido-pronto`: o aviso de pedido pronto da Expedição (seis diálogos), o "Testar modelo" e o "Pedido em Produção". Não é só o de produção.
> **Enquanto não existir:** o "Pedido em Produção" só envia em modo teste e para o cliente #14; os demais veem "Envio de aviso de produção em ajuste" e só liberam. O aviso de pedido pronto da Expedição está, hoje, limitado pelo modo teste (só cliente #14). Desligar o modo teste da Expedição antes da trava compartilhada deixa aberta a corrida em `Pedido_Atual` descrita abaixo.

## Por que

Dois campos são gravados pelos dois sistemas na mesma conversa:

- `Link_do_Cliente`: o envio de arte do Imposition e o "Pedido em Produção" do Vibe (o template 6071c6dbe34a18c2cc684747 passou a usar o campo).
- `Pedido_Atual`: o envio de arte do Imposition e os seis diálogos da Expedição do Vibe (Sedex, Motoboy, Retira, Veppo, Azul, Transportadora), inclusive no "Testar modelo".

Então a corrida não é exclusiva do aviso de produção: um aviso de pedido pronto e um envio de arte para o mesmo cliente, ao mesmo tempo, podem trocar o número do pedido na mensagem um do outro. O ChatGuru guarda o último valor do campo na conversa. Por isso as duas gravações precisam de uma ordem: "gravar campos e executar o diálogo" de um sistema não pode acontecer no meio do mesmo par de chamadas do outro.

Hoje cada sistema tem a própria trava, e um não vê a do outro:

| | Vibe (avisos) | Imposition (envio de arte) |
|---|---|---|
| Onde trava | `expedicao_aviso_pronto`: índice único parcial `expedicao_aviso_pronto_trava_conversa` em `destino_chave`, com estado `preparando` ou `desconhecido` | `imposition_whatsapp_conversas.chave_envio` (uma linha por `destino_chave`) |
| Quem reserva | insert direto pela Edge Function `expedicao-pedido-pronto` | RPCs `imposition_whatsapp_dialogo_reservar` e `imposition_whatsapp_dialogo_reenviar` |
| Quem libera | o próprio estado da linha (sai de `preparando`; `desconhecido` segura até o "Liberar número") | `imposition_whatsapp_dialogo_finalizar` (libera, menos em `desconhecido`) |
| Chave da conversa | SHA-256 de `JSON.stringify([endpoint, account_id, phone_id, numero])` | a mesma fórmula, com o mesmo remetente 3478 (`phone_id` 6071afff…) |
| Campos gravados | Expedição: os da tabela abaixo; Produção: `Link_do_Cliente` | `Link_do_Cliente`, `Pedido_Atual` |

A chave da conversa é a mesma nos dois sistemas, desde que o número seja escrito igual. O Vibe usa o `telefone_normalizado` da visão `chatguru_contatos_3478`; o Imposition usa o WhatsApp de `imposition_arte_guru_ler`, também do Guru 3478. Isso precisa ser conferido numa conversa real antes de ligar a trava.

O que impede o Vibe de usar a trava do Imposition hoje: `imposition_whatsapp_conversas.chave_envio` tem chave estrangeira para `imposition_whatsapp_artes(chave)`. Só uma linha de envio de arte pode ocupar a conversa.

## Mudança mínima proposta

Uma tabela, nenhuma mudança no código do Imposition. As RPCs dele já recusam com "ocupado" quando `chave_envio` não é nulo, venha de quem vier.

```sql
-- 1) Permitir que a conversa seja ocupada por um aviso do Vibe.
alter table public.imposition_whatsapp_conversas
  drop constraint imposition_whatsapp_conversas_chave_envio_fkey;
alter table public.imposition_whatsapp_conversas
  add constraint imposition_whatsapp_conversas_chave_envio_check
  check (chave_envio is null or chave_envio ~ '^([a-f0-9]{64}|vibe:[0-9a-f-]{36})$');

-- 2) Ocupar a conversa para um aviso do Vibe (id da linha em expedicao_aviso_pronto).
create or replace function public.imposition_whatsapp_conversa_travar(p_destino text, p_chave text)
returns text language plpgsql set search_path to '' as $$
declare ocupado text;
begin
  if p_destino !~ '^[a-f0-9]{64}$' or p_chave !~ '^vibe:[0-9a-f-]{36}$' then raise exception 'parametros invalidos'; end if;
  insert into public.imposition_whatsapp_conversas(destino_chave) values (p_destino) on conflict do nothing;
  select chave_envio into ocupado from public.imposition_whatsapp_conversas where destino_chave = p_destino for update;
  if ocupado is not null then return 'ocupado'; end if;
  update public.imposition_whatsapp_conversas set chave_envio = p_chave, atualizado_em = now() where destino_chave = p_destino;
  return 'reservado';
end $$;

-- 3) Soltar, só se a conversa ainda é deste aviso.
create or replace function public.imposition_whatsapp_conversa_soltar(p_destino text, p_chave text)
returns boolean language plpgsql set search_path to '' as $$
begin
  update public.imposition_whatsapp_conversas set chave_envio = null, atualizado_em = now()
   where destino_chave = p_destino and chave_envio = p_chave;
  return found;
end $$;

revoke all on function public.imposition_whatsapp_conversa_travar(text, text) from public, anon, authenticated;
revoke all on function public.imposition_whatsapp_conversa_soltar(text, text) from public, anon, authenticated;
grant execute on function public.imposition_whatsapp_conversa_travar(text, text) to service_role;
grant execute on function public.imposition_whatsapp_conversa_soltar(text, text) to service_role;
```

Do lado do Vibe (Edge Function `expedicao-pedido-pronto`), no caminho comum a todos os avisos (`enviarParaConversas` -> `reservarLinha`), o que cobre de uma vez o pedido pronto, o Testar modelo e o Pedido em Produção:

1. Depois de reservar a linha em `expedicao_aviso_pronto`, chamar `imposition_whatsapp_conversa_travar(destino_chave, 'vibe:' || id)`. Se vier `ocupado`, marcar a linha como `falhou`, sem chamar o ChatGuru, e mostrar "Há uma operação pendente para esta conversa (envio de arte)".
2. Ao terminar com `executado` ou `falhou`, chamar `imposition_whatsapp_conversa_soltar`. Em `desconhecido`, não soltar: o "Liberar número" do Vibe solta.
3. A trava própria do Vibe continua: ela cobre dois avisos do Vibe sem passar pelo Imposition.
4. Com a trava compartilhada no ar e conferida, sai o bloqueio "Envio de aviso de produção em ajuste" e o modo teste pode ser desligado para os dois avisos, nessa ordem.

## Pontos para combinar com o Imposition

- **A trava agora é mútua:** o Vibe passa a ocupar linhas de `imposition_whatsapp_conversas` em todo aviso (pedido pronto, Testar modelo e produção), e o envio de arte recebe "Há uma operação pendente para esta conversa" enquanto um aviso do Vibe está em andamento ou em resultado desconhecido. Na Expedição isso acontece muito mais vezes que no aviso de produção: vale combinar com a equipe do Imposition o que o atendente de arte vê nesse caso.
- **O `finalizar` do Imposition não muda:** ele só solta a conversa quando ela é dele (`chave_envio = p_chave`), então nunca solta uma trava do Vibe.
- **Leituras da coluna:** quem lê `chave_envio` esperando sempre uma chave de `imposition_whatsapp_artes` precisa aceitar o prefixo `vibe:`. Não achei leitor assim nas RPCs.
- **Passagem para a trava nova:** avisos do Vibe que estiverem em `desconhecido` no dia precisam ocupar a conversa antes de ligar o envio real.
- **Conversa nos dois sistemas:** conferir numa conversa real que os dois escrevem o número igual, para a chave sair a mesma.

## Campos que o Vibe grava em cada diálogo (para confirmar com a diretoria)

A API do ChatGuru que o Vibe usa (`chat_update_custom_fields`, `dialog_execute`, `message_send`, `message_status`) não lê o texto do template. Então não dá para saber por ela se algum template da Expedição passou a usar `Link_do_Cliente` ou outro campo do Imposition. O que o Vibe grava hoje:

| Diálogo | id | Campos gravados pelo Vibe antes de executar |
|---|---|---|
| Sedex | 6aef26a47b47d7256c8924ae | Sedex_Conhecimento, Pedido_Atual, Nota_Fiscal |
| Motoboy | 6aef36709e91cf335ffdf6fd | Pedido_Atual, Nota_Fiscal |
| Retira | 6aef3674e2ff0962de8545fc | Pedido_Atual, Nota_Fiscal |
| Veppo | 6aef3678e11ead8b0e4f40b6 | Cidade_Destino, Pedido_Atual, Nota_Fiscal |
| Azul | 6aef367de2ff0962de8545ff | Pedido_Atual, Nota_Fiscal, Cidade_Destino |
| Transportadora | 6aef36a7eab83021c5d20230 | Cidade_Destino, Pedido_Atual, Nota_Fiscal |
| Pedido em Produção | 6071c6dbe34a18c2cc684747 | Link_do_Cliente (desde 09/11/2026) |
| Envio de arte (Imposition) | 6aef191d04236cee4e7075c1 | Link_do_Cliente, Pedido_Atual |

Se algum template da Expedição usar um campo fora da sua linha, por exemplo `Link_do_Cliente`, a mensagem sai com o último valor gravado na conversa, que pode ser de outro pedido. Isso já aconteceu com o Pedido em Produção em 09/11/2026.

`Pedido_Atual` já é gravado pelos dois sistemas: pelo envio de arte e por todos os diálogos da Expedição. Como cada um grava logo antes de executar, uma mensagem sozinha leva o valor certo. O risco aparece quando os dois mandam para a mesma conversa ao mesmo tempo: um grava, o outro grava por cima e o primeiro executa com o número do pedido errado. Esse é o caso que a trava compartilhada resolve, e por isso ela precisa valer para todos os avisos do Vibe.
