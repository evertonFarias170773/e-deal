import type { Metadata } from "next";

import {
  cadastroOnlineFlagAtiva,
  criarClientServiceRole,
  devolverTentativaDeExibicao
} from "@/features/cadastros/services/cadastro-online.server";

import { CadastroOnlineForm } from "./cadastro-online-form";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Cadastro de cliente",
  robots: { index: false, follow: false },
  referrer: "no-referrer"
};

type Props = { params: Promise<{ token: string }> };

/**
 * Pagina publica do cadastro online.
 *
 * O TOKEN VIAJA NO CAMINHO, e isso e diferente do /os
 * ---------------------------------------------------
 * O /os tira o token da barra de endereco com `history.replaceState`. Aqui nao
 * da: o endereco /c/<token> FOI pedido pelo dono, porque e o que cabe num
 * WhatsApp e continua funcionando se a pessoa salvar o link.
 *
 * A consequencia e real e fica registrada: o token aparece no historico do
 * navegador e no `Referer` de qualquer link que a pagina abrisse. Por isso
 * `Referrer-Policy: no-referrer` esta em next.config.ts para /c/:path*, e o
 * unico link externo desta pagina — o aviso de privacidade — e interno ao mesmo
 * dominio. Se alguem acrescentar um link para fora daqui, o token vaza com ele.
 *
 * A RESOLUCAO ACONTECE NO SERVIDOR
 * --------------------------------
 * O token nunca chega ao browser resolvido, e o `service_role` nunca sai daqui.
 * O client so recebe o primeiro nome do vendedor — nem id, nem e-mail, nem
 * documento.
 *
 * ABRIR A PAGINA NAO GASTA COTA DE ENVIO
 * --------------------------------------
 * `cadastro_link_resolver` conta toda chamada bem sucedida, e o teto e 20 por
 * hora por token. Se a exibicao contasse, abrir mais enviar custaria 2, sobrando
 * ~10 cadastros por hora por link — e o robo de previa do WhatsApp consumiria
 * sem ninguem ter aberto nada.
 *
 * Por isso a tentativa e devolvida logo apos a resolucao de exibicao. Detalhe do
 * porque isso nao afrouxa defesa nenhuma no comentario de
 * `devolverTentativaDeExibicao`.
 */
export default async function CadastroOnlinePage({ params }: Props) {
  const { token } = await params;

  if (!cadastroOnlineFlagAtiva()) {
    return <PaginaNeutra />;
  }

  const service = criarClientServiceRole();
  if (!service) {
    console.error("[cadastro-online] service_role indisponivel ao abrir /c.");
    return <PaginaNeutra />;
  }

  const { data, error } = await service.rpc("cadastro_link_resolver", { p_token: token });
  if (error) {
    console.error("[cadastro-online] resolver falhou ao abrir /c:", error.message);
    return <PaginaNeutra />;
  }

  const resolvido = data as { ok?: boolean; primeiro_nome?: string } | null;
  if (!resolvido?.ok) {
    // Token inexistente, revogado, vendedor que saiu e limite estourado caem
    // todos aqui. Nao se diz qual: quem sonda nao aprende nada.
    return <PaginaNeutra />;
  }

  // Abrir o formulario nao pode gastar cota de ENVIO. Ver o comentario da
  // funcao: o teto por token nao protege contra adivinhacao (token inexistente
  // nem chega ao contador), entao contar a exibicao so estreitaria o uso
  // legitimo — inclusive por causa do robo de previa do WhatsApp.
  await devolverTentativaDeExibicao(service, token);

  return <CadastroOnlineForm token={token} primeiroNomeVendedor={resolvido.primeiro_nome ?? ""} />;
}

function PaginaNeutra() {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
      <h1 className="text-lg font-semibold text-slate-800">Link indisponivel</h1>
      <p className="mt-3 text-sm leading-relaxed text-slate-600">
        Este link não está mais disponível. Fale com seu atendente para receber um link novo.
      </p>
    </div>
  );
}
