import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { NetlifyDB } from "@netlify/database-dev";

const execFileAsync = promisify(execFile);
const migrationsDirectory = new URL(
  "../netlify/database/migrations/",
  import.meta.url,
).pathname.replace(/^\/(\w:)/, "$1");

async function withDatabase(run) {
  const server = new NetlifyDB({ logger: () => undefined });
  const connectionString = await server.start();
  process.env.NETLIFY_DB_URL = connectionString;
  process.env.NETLIFY_DB_DRIVER = "server";

  try {
    const applied = await server.applyMigrations(migrationsDirectory);
    await run({ server, applied });
  } finally {
    delete process.env.NETLIFY_DB_URL;
    delete process.env.NETLIFY_DB_DRIVER;
    await server.stop();
  }
}

test("native Netlify adapter performs CRUD, rollback, constraint, and job checks", async () => {
  await withDatabase(async ({ server, applied }) => {
    assert.equal(applied.length, 1);

    const { runCompatibilityExercise } = await import(
      "../spikes/price-check-db/exercise.ts"
    );
    const result = await runCompatibilityExercise("civilon-price-check-spike");

    assert.deepEqual(result, {
      adapter: "drizzle-orm/netlify-db",
      inserted: true,
      read: true,
      updated: true,
      duplicateConstraintRejected: true,
      rollback: true,
      job: {
        firstAttemptCompleted: true,
        duplicateAttemptSkipped: true,
      },
    });

    const { rows } = await server.query(
      "select probe_key, probe_value from civilon_db_probe order by probe_key",
    );
    assert.deepEqual(rows, [
      {
        probe_key: "civilon-price-check-spike",
        probe_value: "updated",
      },
      {
        probe_key: "civilon-price-check-spike-job",
        probe_value: "completed",
      },
    ]);

    const { priceCheckProbeDb } = await import(
      "../spikes/price-check-db/index.ts"
    );
    await priceCheckProbeDb.$client.end();
  });
});

test("migration builds an empty database deterministically", async () => {
  await withDatabase(async ({ server, applied }) => {
    assert.equal(applied.length, 1);
    const replayed = await server.applyMigrations(migrationsDirectory);
    assert.deepEqual(replayed, []);
  });
});

test("a failed disposable migration fails safely", async () => {
  const directory = await mkdtemp(join(tmpdir(), "civilon-db-migration-"));
  const server = new NetlifyDB({ logger: () => undefined });
  await server.start();

  try {
    await writeFile(
      join(directory, "99999999999999_failed_probe.sql"),
      [
        "create table civilon_failed_migration_probe (id integer);",
        "this is intentionally invalid sql;",
      ].join("\n"),
    );

    await assert.rejects(server.applyMigrations(directory));
    const { rows } = await server.query(
      "select to_regclass('public.civilon_failed_migration_probe') as table_name",
    );
    assert.equal(rows[0]?.table_name, null);
  } finally {
    await server.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("native adapter fails without a database connection", async () => {
  const childEnvironment = { ...process.env };
  delete childEnvironment.NETLIFY_DB_URL;

  await assert.rejects(
    execFileAsync(
      process.execPath,
      ["tests/helpers/db-unavailable-probe.mjs"],
      { cwd: process.cwd(), env: childEnvironment },
    ),
  );
});

test("runtime probe rejects production, unauthorized, and malformed requests", async () => {
  const originalContext = process.env.CONTEXT;
  const originalToken = process.env.PRICE_CHECK_DB_PROBE_TOKEN;

  try {
    process.env.PRICE_CHECK_DB_PROBE_TOKEN = "synthetic-local-test-token";
    const { default: handler } = await import(
      "../netlify/functions/price-check-db-spike.ts"
    );

    process.env.CONTEXT = "production";
    const productionResponse = await handler(
      new Request("http://localhost/api/__spike/price-check-db", {
        method: "POST",
      }),
    );
    assert.equal(productionResponse.status, 404);

    process.env.CONTEXT = "deploy-preview";
    const unauthorizedResponse = await handler(
      new Request("http://localhost/api/__spike/price-check-db", {
        method: "POST",
      }),
    );
    assert.equal(unauthorizedResponse.status, 401);

    const malformedResponse = await handler(
      new Request("http://localhost/api/__spike/price-check-db", {
        method: "POST",
        body: "not-json",
        headers: {
          authorization: "Bearer synthetic-local-test-token",
          "content-type": "application/json",
        },
      }),
    );
    assert.equal(malformedResponse.status, 400);
  } finally {
    if (originalContext === undefined) delete process.env.CONTEXT;
    else process.env.CONTEXT = originalContext;

    if (originalToken === undefined) delete process.env.PRICE_CHECK_DB_PROBE_TOKEN;
    else process.env.PRICE_CHECK_DB_PROBE_TOKEN = originalToken;
  }
});
