import type { NextConfig } from "next";
const config: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `http://127.0.0.1:${process.env.COSPACE_API_PORT || 4027}/api/:path*`,
      },
      ...(process.env.COSPACE_MODE === "pilot"
        ? [
            {
              source: "/ws/events",
              destination: `http://127.0.0.1:${process.env.COSPACE_API_PORT || 4027}/ws/events`,
            },
            {
              source: "/ws/collab",
              destination: `http://127.0.0.1:${process.env.COSPACE_COLLAB_PORT || 4028}/ws/collab`,
            },
          ]
        : []),
    ];
  },
  devIndicators: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
    ];
  },
};
export default config;
