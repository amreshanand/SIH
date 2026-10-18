import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ["localhost:3000", "127.0.0.1:3000", "11.6.3.45:3000", "11.6.3.45"],
};

export default nextConfig;
