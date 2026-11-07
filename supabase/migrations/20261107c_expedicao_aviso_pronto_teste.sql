-- Aviso "pedido pronto": "Testar modelo" (07/11/2026).
--
-- Com o modo teste ligado e só para pedido do cliente #14, o ADM ou quem opera a
-- Expedição escolhe um dos seis diálogos e manda um envio de teste, sem depender
-- da forma de envio do pedido. Cada teste é uma linha nova desta tabela com
-- envio_teste = true e o diálogo usado em dialogo_id. Envio de teste não conta
-- como "aviso já enviado" do pedido (a função ignora essas linhas no Avisar
-- cliente / Reenviar), mas a trava por conversa (destino_chave) vale igual.
alter table public.expedicao_aviso_pronto
  add column if not exists envio_teste boolean not null default false;

alter table public.expedicao_aviso_pronto
  add constraint expedicao_aviso_pronto_envio_teste_check
    check (not envio_teste or (modo_teste and dialogo_id is not null and destino_chave is not null));
