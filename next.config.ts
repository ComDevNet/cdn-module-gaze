/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // Force include all styling packages
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
    'tailwind-merge'
  ],
  // Updated: moved from experimental.serverComponentsExternalPackages
  serverExternalPackages: [],
  // Ensure CSS is properly processed
  experimental: {
    optimizeCss: true,
  },
  // Make sure all imports are resolved
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@': '.',
    }
    return config
  },
}

export default nextConfig
