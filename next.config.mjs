/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["ffmpeg-static", "@ffprobe-installer/ffprobe", "pdfjs-dist", "playwright-chromium", "undici", "@modelcontextprotocol/sdk", "exceljs"],
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
