import type {NextConfig} from 'next';

// Set NEXT_PUBLIC_BASE_PATH (e.g. /open-screenshot-generator) when deploying under a sub-path
// such as GitHub Pages. Locally it stays empty and nothing changes.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

const nextConfig: NextConfig = {
  output: 'export',
  basePath,
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    // next/image optimization needs a server; GitHub Pages is static-only.
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;
