/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["@vercel/sandbox"],
  // 禁用页面缓存，确保每次获取最新版本
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store, must-revalidate",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
