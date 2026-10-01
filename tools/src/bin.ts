#!/usr/bin/env node
// The bundle's entry point: always run the CLI. Kept apart from cli.ts so
// tests can import `main` without running it, and the bundle never has to
// guess whether it was invoked directly.
import { main } from "./cli.ts";

process.exitCode = await main(process.argv.slice(2));
