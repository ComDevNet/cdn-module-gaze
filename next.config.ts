import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  transpilePackages: [
    '@radix-ui/react-slot',
    '@radix-ui/react-alert-dialog',
    '@radix-ui/react-avatar',
    '@radix-ui/react-dialog',
    '@radix-ui/react-dropdown-menu',
    '@radix-ui/react-label',
    'class-variance-authority',
    'lucide-react',
    'clsx',
    'tailwind-merge',
  ],
  serverExternalPackages: [],
  experimental: {
    optimizeCss: true,
  },
  webpack: (config) => {
    config.resolve = config.resolve ?? {}
    config.resolve.alias = {
      ...(config.resolve.alias as Record<string, string> | undefined),
      '@': '.',
    }
    return config
  },
  async redirects() {
    return [
      { source: '/home', destination: '/', permanent: false },
    ]
  },
}

export default nextConfig
