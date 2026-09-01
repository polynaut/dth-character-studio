# dth-products-ingest

The community product-DB **ingest Worker** — phase 1 of the products-database
plan: collect raw submissions from DTH Character Studio, append-only, dedupe
exact duplicates, store nothing about the sender. Aggregation, store scrapers
and the exported DB are separate later phases that read this Worker's table.

Deliberately **outside the pnpm workspace** (own package, no versioning
entanglement with the app's fixed group) and **dependency-free at runtime** —
`wrangler` is the only tooling. It can be extracted to its own repo whenever
the phase-2 project starts.

## Deploy (one time)

```sh
cd services/products-ingest
pnpm install
pnpm exec wrangler d1 create dth-products      # paste the id into wrangler.toml
pnpm exec wrangler d1 execute dth-products --remote --file schema.sql
pnpm exec wrangler secret put INGEST_TOKEN     # must equal PRODUCT_SHARE_TOKEN in the app
pnpm exec wrangler deploy                       # note the workers.dev URL
```

Then flip the app on: set `PRODUCT_SHARE_ENDPOINT` in
`apps/web/src/lib/rom/product-share.ts` to
`https://<worker>.workers.dev/v1/submissions` and release. Until that constant
is set the Settings toggle renders disabled and nothing ever submits.

## API

`POST /v1/submissions` with header `x-dth-token: <INGEST_TOKEN>` and a JSON
body in the app's payload shape (`ProductSharePayload`, v1 — see
`apps/web/src/lib/rom/product-share.ts`, which is the documented contract).
Responses: `201` stored, `200` exact duplicate (already stored), `400/413/422`
rejected, `403` bad token. Malformed bodies are rejected, never repaired — a
row this Worker stored is a row the validator vouched for.

## Looking at the data

```sh
pnpm exec wrangler d1 execute dth-products --remote \
  --command "SELECT COUNT(*), MIN(received_at), MAX(received_at) FROM submissions"
```
