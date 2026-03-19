import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

// Directives are intentionally explicit — no wildcards.
// Update connect-src here if new Horizon endpoints are added.
const csp = [
  "default-src 'none'",
  // Next.js injects inline bootstrap scripts; 'unsafe-inline' is required.
  // 'unsafe-eval' is only enabled in development for HMR.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  // Tailwind and Next.js inject inline styles.
  "style-src 'self' 'unsafe-inline'",
  // next/font/google self-hosts fonts at build time; no CDN needed at runtime.
  "font-src 'self'",
  // data: covers inline SVG icons (Lucide/Radix).
  "img-src 'self' data:",
  // Stellar Horizon endpoints and Friendbot (testnet/futurenet funding).
  // Supabase auth/API (required when NEXT_PUBLIC_SUPABASE_URL is set).
  `connect-src 'self' https://horizon.stellar.org https://horizon-testnet.stellar.org https://horizon-futurenet.stellar.org https://friendbot.stellar.org https://friendbot-futurenet.stellar.org${process.env.NEXT_PUBLIC_SUPABASE_URL ? ` ${process.env.NEXT_PUBLIC_SUPABASE_URL}` : ""}`,
  // Vanity worker is a bundled same-origin chunk via webpack 5 Worker URL transform.
  "worker-src 'self'",
  // Never allow this app to be embedded in a frame (clickjacking protection).
  "frame-ancestors 'none'",
  // Restrict <base> and <form> targets to same origin.
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  // Belt-and-suspenders frame protection for older browsers that ignore CSP.
  { key: "X-Frame-Options", value: "DENY" },
  // Prevent MIME-type sniffing.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // No referrer sent to external origins.
  { key: "Referrer-Policy", value: "no-referrer" },
  // Restrict Permissions-Policy — only clipboard-write is needed (key copy buttons).
  { key: "Permissions-Policy", value: "clipboard-write=(self)" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // better-sqlite3 is a native Node.js module — must not be bundled by webpack.
  serverExternalPackages: ["better-sqlite3", "node-cron"],
  eslint: {
    ignoreDuringBuilds: false,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  // Allow access to remote image placeholder.
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "picsum.photos",
        port: "",
        pathname: "/**", // This allows any path under the hostname
      },
    ],
  },
  // standalone + custom tracing root only for local builds.
  // On Vercel these cause path-doubling errors — Vercel manages its own output.
  ...(!process.env.VERCEL && {
    output: "standalone",
    outputFileTracingRoot: require("path").join(__dirname, "../../"),
  }),
  transpilePackages: [],
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
  webpack: (config, { dev, isServer }) => {
    // HMR is disabled in AI Studio via DISABLE_HMR env var.
    // Do not modify—file watching is disabled to prevent flickering during agent edits.
    if (dev && process.env.DISABLE_HMR === "true") {
      config.watchOptions = {
        ignored: /.*/,
      };
    }

    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        "sodium-native": false,
      };
      // sodium-native emits a "Critical dependency" warning because it uses a
      // dynamic require() internally. We've already stubbed it out above so
      // the warning is a false positive — suppress it.
      config.ignoreWarnings = [
        ...(config.ignoreWarnings ?? []),
        { module: /sodium-native/ },
      ];
    }

    return config;
  },
};

export default nextConfig;
