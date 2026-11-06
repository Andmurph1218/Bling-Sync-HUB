/** @type {import('next').NextConfig} */
const api = process.env.API_INTERNAL_URL || 'http://127.0.0.1:3001';

const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${api}/api/:path*` },
      { source: '/auth/:path*', destination: `${api}/auth/:path*` },
      { source: '/oauth/:path*', destination: `${api}/oauth/:path*` },
      { source: '/webhooks/:path*', destination: `${api}/webhooks/:path*` },
      { source: '/health', destination: `${api}/health` },
      { source: '/operator/:path*', destination: `${api}/operator/:path*` },
    ];
  },
};

export default nextConfig;
