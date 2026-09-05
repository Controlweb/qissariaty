import { execSync } from "node:child_process";

/**
 * Reset the local D1 before every E2E run.
 *
 * The guest-checkout spec places a real order, which permanently consumes a
 * seeded variant's stock. Without this the suite passes twice and then starts
 * failing on "Ajouter au panier" being disabled — a flake that looks like a
 * product bug. seed.sql opens with DELETE FROM on every table, so it is a
 * clean reset rather than an append.
 */
export default function globalSetup() {
  // execSync, not execFileSync: node on Windows refuses to spawn npx.cmd
  // directly (EINVAL) and needs the shell that execSync gives it.
  // Piped, not inherited: wrangler prints the whole result set as JSON, which
  // buries the test reporter's own output.
  execSync("npx wrangler d1 execute qissariaty --local --file=./seed.sql", {
    stdio: "pipe",
  });
}
