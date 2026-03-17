import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@smelter-editor/types'],
  eslint: {
    ignoreDuringBuilds: true,
  },
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET, POST, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, X-Game-Id' },
          { key: 'Access-Control-Allow-Private-Network', value: 'true' },
        ],
      },
    ];
  },
};

export default nextConfig;
