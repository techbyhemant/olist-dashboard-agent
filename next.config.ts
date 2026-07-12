import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // DuckDB loads a platform-specific native .node binding at runtime; keep it out
  // of the bundler so the require() of the prebuilt addon resolves on the server.
  serverExternalPackages: ["@duckdb/node-api", "@duckdb/node-bindings"],
  // The route reads the sample CSVs via a runtime path, so file tracing can't
  // detect them. Force them into the /api/generate serverless bundle so the
  // deployed function has data. (The full data/ set is gitignored + not shipped.)
  outputFileTracingIncludes: {
    "/api/generate": ["./data/sample/**"],
  },
};

export default nextConfig;
