#!/usr/bin/env bun

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureDependenciesInstalled } from "./bootstrap.ts";
import {
  buildRoutes,
  loadRoutes,
  parseSetupInput,
  renderRoutesYaml,
  writeRoutesAtomic,
} from "./herdr-config.ts";

interface Options {
  input: string;
  output: string;
  dryRun: boolean;
  check: boolean;
}

async function main(): Promise<void> {
  ensureDependenciesInstalled();
  const { Command } = await import("commander");
  const program = new Command("configure-herdr")
    .description("Deterministically write pstack Herdr routes from JSON input")
    .requiredOption("--input <path>", "JSON setup input")
    .option("--output <path>", "routes output path", "~/.config/pstack-herdr/routes.yaml")
    .option("--dry-run", "print canonical YAML without writing", false)
    .option("--check", "validate input and existing output without writing", false);

  program.parse(process.argv);
  const options = program.opts<Options>();
  const input = parseSetupInput(readFileSync(resolve(options.input), "utf8"));
  const existing = loadRoutes(options.output);
  const next = buildRoutes(existing, input);
  const yaml = renderRoutesYaml(next);

  if (options.dryRun) {
    process.stdout.write(yaml);
    return;
  }

  if (options.check) {
    const current = renderRoutesYaml(existing);
    if (current !== yaml) {
      throw new Error("routes file is valid but does not match the requested setup input");
    }
    process.stdout.write("routes are valid and current\n");
    return;
  }

  const result = writeRoutesAtomic(options.output, next);
  process.stdout.write(
    `${result.changed ? "updated" : "unchanged"} ${result.path}\n`
  );
}

if (import.meta.main) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
