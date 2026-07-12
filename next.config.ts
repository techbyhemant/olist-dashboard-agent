import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // DuckDB loads a platform-specific native .node binding at runtime; keep it out
  // of the bundler so the require() of the prebuilt addon resolves on the server.
  serverExternalPackages: ["@duckdb/node-api", "@duckdb/node-bindings"],
};

export default nextConfig;
