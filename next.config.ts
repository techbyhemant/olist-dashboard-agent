import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // DuckDB loads a platform-specific native .node binding at runtime; keep it out
  // of the bundler so the require() of the prebuilt addon resolves on the server.
  serverExternalPackages: ["@duckdb/node-api", "@duckdb/node-bindings"],
  // Two things file tracing can't see and silently drops from the deployed
  // function unless forced in:
  //  1. The sample CSVs (lib/db.ts reads them via a runtime path).
  //  2. DuckDB's actual engine binary. @duckdb/node-bindings-linux-x64/duckdb.node
  //     is a thin wrapper that native-dlopen's a *sibling* ~100MB libduckdb.so in
  //     the same package dir — invisible to JS-level require() tracing. Without
  //     this, the deployed function throws "libduckdb.so: cannot open shared
  //     object file" on first query (fails at runtime, not at build time).
  outputFileTracingIncludes: {
    "/api/generate": [
      "./data/sample/**",
      "./node_modules/@duckdb/node-bindings-linux-x64/**",
    ],
  },
};

export default nextConfig;
