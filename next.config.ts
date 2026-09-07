import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: true,
  },
  async headers() {
    return [
      {
        // Página pública do QR de produção: sem indexação, sem referrer, sem cache.
        source: "/os",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
      {
        // Cadastro online. `no-referrer` é mais importante aqui do que em /os:
        // ali o token sai da URL logo após a carga, aqui ele É o caminho
        // (/c/<token>) e sairia no Referer de qualquer link que a página abrisse.
        source: "/c/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
      {
        // Aviso de privacidade: aberto pelo formulário, e por isso também sem
        // referrer — senão o token do link do atendente viajaria até aqui.
        source: "/privacidade",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
};

export default nextConfig;
