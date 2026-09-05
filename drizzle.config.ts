import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./worker/schema.ts",
  out: "./migrations",
  dialect: "sqlite",
  driver: "d1-http",
});
