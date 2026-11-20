import type {NextConfig} from 'next';

// Set NEXT_PUBLIC_BASE_PATH (e.g. /open-screenshot-generator) when deploying under a sub-path
// such as GitHub Pages. Locally it stays empty and nothing changes.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

const nextConfig: NextConfig = {
  output: 'export',
  basePath,
  // Next compiles the app's own code for older browsers but ships packages as
  // they come. three.js (r185) has class static blocks, which WebKit before
  // Safari 16.4 can't parse, so on macOS 10.15 to 12 every 3D device failed to
  // load. Packages listed here are compiled like the app's code;
  // tests/unit/webkitFloor.test.ts fails on a package that needs it and isn't.
  // A change here doesn't reset webpack's cache: delete .next/cache/webpack
  // before checking a local build, or it keeps the old output.
  transpilePackages: ['three'],
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
