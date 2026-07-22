/** @type {import('next').NextConfig} */
const nextConfig = {
  // 禁用页面缓存，确保每次获取最新版本
  async headers() {
    return [
      {
        source: "/((?!_next/static|_next/image|favicon.ico|icon|apple-icon|manifest.webmanifest|audio/).*)",
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
