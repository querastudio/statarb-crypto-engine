/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // ccxt is a heavy Node-only dependency; keep it external to the serverless bundle
  // so it is required at runtime instead of being traced/bundled by webpack.
  experimental: {
    serverComponentsExternalPackages: ["ccxt"],
  },
};

export default nextConfig;
