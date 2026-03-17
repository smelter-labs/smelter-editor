import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  env: {
    // Convert the server-side HTTP URL to a WebSocket URL so client components
    // can open ws:// / wss:// connections directly to the Fastify server.
    // http://host  →  ws://host
    // https://host →  wss://host
    NEXT_PUBLIC_SMELTER_WS_URL: (
      process.env.SMELTER_EDITOR_SERVER_URL ?? 'http://localhost:3001'
    ).replace(/^http/, 'ws'),
  },
  transpilePackages: ['@smelter-editor/types'],
  outputFileTracingRoot: path.resolve(import.meta.dirname, '../'),
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
