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
  // Disable static optimization for API routes that use streaming
  experimental: {
    serverComponentsExternalPackages: [],
  },
  // Ensure API routes are not statically generated
  async rewrites() {
    return []
  },
  // Skip static generation for streaming routes
  async generateStaticParams() {
    return []
  },
}

export default nextConfig