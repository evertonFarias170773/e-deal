import type { Metadata } from "next";

import {
  AVISO_PRIVACIDADE_SECOES,
  CONSENTIMENTO_TEXTO,
  CONSENTIMENTO_VERSAO
} from "@/features/cadastros/lib/consentimento";

export const metadata: Metadata = {
  title: "Aviso de privacidade",
  robots: { index: false, follow: false },
  referrer: "no-referrer"
};

/**
 * Aviso de privacidade do cadastro online.
 *
 * O CONTEUDO NAO MORA AQUI, de proposito: vem de
 * `features/cadastros/lib/consentimento.ts`, o mesmo arquivo que define o texto
 * mostrado ao lado do checkbox e gravado em `cadastros_online`. Assim o aviso e
 * o consentimento nao podem divergir em silencio — quem editar um esbarra no
 * outro.
 *
 * A versao aparece no rodape porque e ela que fica gravada em cada envio. Sem
 * isso, um envio de tres meses atras nao teria como ser confrontado com o texto
 * que a pessoa realmente aceitou.
 */
export default function AvisoPrivacidadePage() {
  return (
    <main className="mx-auto min-h-screen max-w-2xl bg-white px-5 py-10 text-slate-700">
      <h1 className="text-2xl font-semibold text-slate-900">Aviso de privacidade</h1>
      <p className="mt-2 text-sm text-slate-500">
        Como tratamos os dados enviados pelo formulário de cadastro de cliente.
      </p>

      <div className="mt-8 space-y-8">
        {AVISO_PRIVACIDADE_SECOES.map((secao) => (
          <section key={secao.titulo}>
            <h2 className="text-base font-semibold text-slate-900">{secao.titulo}</h2>
            {secao.paragrafos.map((paragrafo) => (
              <p key={paragrafo.slice(0, 40)} className="mt-2 text-sm leading-relaxed">
                {paragrafo}
              </p>
            ))}
          </section>
        ))}

        <section>
          <h2 className="text-base font-semibold text-slate-900">O texto que você aceita</h2>
          <p className="mt-2 text-sm leading-relaxed">
            Ao marcar a caixa no formulário, é este o texto registrado junto com o seu envio, com a
            data e a hora:
          </p>
          <blockquote className="mt-3 rounded-xl border-l-4 border-slate-300 bg-slate-50 px-4 py-3 text-sm italic leading-relaxed">
            {CONSENTIMENTO_TEXTO}
          </blockquote>
        </section>
      </div>

      <footer className="mt-10 border-t border-slate-200 pt-4 text-xs text-slate-500">
        <p>Versão deste aviso: {CONSENTIMENTO_VERSAO}</p>
        <p className="mt-1">
          A versão muda sempre que o texto muda, e a versão vigente no momento do envio fica
          guardada com o seu cadastro.
        </p>
      </footer>
    </main>
  );
}
