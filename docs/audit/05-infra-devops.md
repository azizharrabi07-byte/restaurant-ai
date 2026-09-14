# Infra & DevOps Audit

**Slice:** `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `.gitignore`, `.env.example`, `next.config.mjs`, `package.json`, `tsconfig.json`, `.eslintrc.json`, `.github/workflows/ci.yml`, `postcss.config.mjs`, `tailwind.config.ts`, `components.json`
**Branch:** `rag-option` @ `3b8ad43` · **Method:** static read of every file in scope + `git ls-files` + `package-lock.json` inspection + Next.js 15.5.25 source (pinned in the lock) for build/runtime env semantics. No `docker`, `npm ci`, `npm install`, `npm test` or `npm run build` was executed (orchestrator owns those gates). Docker/Compose failure wording is therefore marked `[INFERENCE]` on documented behaviour; the repo facts behind it are `VERIFIED`.

## Verdict

This slice **does not work**: the documented one-liner (`README.md:67 docker compose up --build`) fails twice before it can produce a container — Compose aborts on the missing `.env.local` (INFRA-03), and after you create it the image build dies at `COPY --from=builder /app/public ./public` because `public/` does not exist (INFRA-01). Even with both repaired, the container can never report healthy (`/api/health` does not exist — INFRA-04), and CI cannot go green at all because the committed lockfile cannot satisfy `npm ci` (INFRA-02). On top of that, the runtime configuration the app actually needs is undocumented in two places, and the `n8n` service is dead weight with a bind mount into a directory that does not exist. There is no `supabase/config.toml`, so the `supabase start` workflow advertised by both `docker-compose.yml:5` and `.env.example:4` cannot run either.

## Required behaviour

Derived from the in-scope files, `README.md` and the code:

1. A clean clone + `cp .env.example .env.local` + `docker compose up --build` builds an image and serves the app on `:3000` with **all runtime configuration supplied by the environment, never baked into a layer** (`Dockerfile:15-16`).
2. The production entrypoint is the standalone bundle (`next.config.mjs:9 output: "standalone"` → `node server.js`, `Dockerfile:36`); no build-time env may be required (`Dockerfile:17` runs `npm run build` bare).
3. `docker compose ps` must reach `healthy` on the probe the compose file itself declares (`docker-compose.yml:44-49`).
4. `npm ci` must succeed from the committed `package-lock.json` on the pinned Node 20 (`ci.yml:16,19`) — that is the only reproducible install path CI has.
5. CI must actually gate the artefacts that ship: lint/typecheck/test/build **and** the Docker image **and** the SQL migration.
6. Every variable the code reads must be documented in `.env.example` (the handoff contract for the next developer).

## Findings

### INFRA-01 · Critical · Dockerfile runner stage · VERIFIED (absence) / INFERENCE (Docker error)
- **Evidence:** `Dockerfile:28` `COPY --from=builder /app/public ./public`. `git ls-files` contains no `public/` entry, and `test -e public` is false in the working tree; the only static asset in the project is `src/app/icon.svg` (Next file convention, not `public/`). `.dockerignore:30` already tries to `!public/` — an aspiration for a directory that was never created.
- **Impact:** `COPY` with a source path that does not exist in the source stage is a **hard build failure**, not a silent skip (`failed to compute cache key: ... "/app/public": not found` on BuildKit; `COPY failed: stat ...: no such file or directory` on the classic builder). The runner stage is therefore never produced and `docker compose up --build` cannot yield an image at all — the entire documented Docker path is dead. `[INFERENCE]` on the exact message; the missing source path is verified.
- **Fix:** create the directory and commit it: `mkdir public && touch public/.gitkeep` (Next serves `public/` for static assets and the Dockerfile already expects it). Alternatively delete `Dockerfile:28` and add `RUN mkdir -p /app/public` in the runner stage — but keeping a real `public/` is the option the rest of the file (`.dockerignore:30`) already assumes.

### INFRA-02 · Critical · package.json / package-lock.json · VERIFIED
- **Evidence:** `package.json:43` declares `"vitest": "^2.1.9"`. `package-lock.json` has `lockfileVersion: 3` and 493 entries, but **zero** keys matching `vitest` (`jq -r '.packages|keys[]' | grep -ci vitest` → `0`), including `node_modules/.bin/vitest`; `packages[""].devDependencies` lists the 9 other dev deps and omits `vitest`.
- **Impact:** `npm ci` (`.github/workflows/ci.yml:19`) validates lock↔manifest sync and exits non-zero with `EUSAGE: ... Missing: vitest@2.1.9 from lock file`. CI therefore dies on its first real step, so **none** of lint/typecheck/test/build run in CI today — the prior art claim that CI is "Valid (all scripts exist in `package.json`)" (`FINAL-AGENT2-AUDIT.md:167-168`) is wrong; it checked that the scripts exist, not that they can run. Locally the "124/124 vitest passing" result (`FINAL-AGENT2-AUDIT.md:160`) cannot be reproduced from the repository, because the test runner the repo declares is not installable from the committed lock.
- **Fix:** run `npm install` once with the pinned toolchain, confirm `packages[""].devDependencies.vitest` and `packages["node_modules/vitest"]` appear in the lock, and commit the lock. Then add a CI guard (`npm ci` alone is that guard) so drift cannot return.

### INFRA-03 · Critical · docker-compose.yml `env_file` · VERIFIED (file absent) / INFERENCE (Compose error)
- **Evidence:** `docker-compose.yml:34-35` `env_file: - .env.local`; `.env.local` is absent from the working tree, `git ls-files` shows it is not tracked, and `.gitignore:27` ignores it. The compose header (`docker-compose.yml:10`) and `README.md:19` tell the reader to copy `.env.example` first, but `README.md:64-68` ("Docker (optional)") omits that step.
- **Impact:** `env_file` defaults to required, so `docker compose up --build` fails during project load — **before** any container is created and before the build starts — with `env file C:\...\.env.local not found`. A newcomer following only the Docker section of the README sees an error that never mentions `.env.example`. (It also means the *first* error you hit is not INFRA-01; you have to fix this one to discover the next.)
- **Fix:** make the file optional and self-explaining: `env_file: [{ path: .env.local, required: false }]` (Compose ≥ 2.24), or keep it required and add a `preflight` line to `README.md:64-68` plus a `docker compose` error hint. Either way the README Docker section must say `cp .env.example .env.local`.

### INFRA-04 · High · docker-compose.yml healthcheck vs `src/app/api/` · VERIFIED
- **Evidence:** `docker-compose.yml:45` probes `http://localhost:3000/api/health`. The complete route inventory of `src/app/api/` is: `auth/{callback,login,logout,password,recover,reset,session,signup}`, `auth/worker/{accept,invite,invite/[token],me}`, `menu/`, `menu/scan/`, `orders/`, `orders/[id]/`, `upload/`, `workers/`, `workers/[id]/` — there is **no** `health/` route. `grep -i health src/` returns no matches.
- **Impact:** the probe gets HTTP 404, `r.ok` is false, the command exits 1, and after `start_period: 20s` + 3 × 30s the container is permanently `Up (unhealthy)`. `restart: unless-stopped` (`docker-compose.yml:31`) restarts only on process exit, so it never self-heals. Anything that keys off health fails: `docker compose up --wait`, a future `depends_on: condition: service_healthy`, and any external monitor; and a human reading `docker compose ps` reasonably concludes the app is broken when it is serving. `[INFERENCE]` on the container-state wording.
- **Fix:** add the route the compose file already declares — `src/app/api/health/route.ts` with `export const dynamic = "force-dynamic"; export async function GET() { return Response.json({ ok: true }); }` (cheap, no DB, no React render). Changing the probe to `GET /` also returns 200 without env (`src/app/page.tsx:1` is a client component and `src/app/menu/[slug]/[token]/page.tsx:7` is `force-dynamic`), but a dedicated route is the smaller, faster, more honest contract.

### INFRA-05 · High · docker-compose.yml `n8n` service · VERIFIED (unused) / INFERENCE (mount behaviour)
- **Evidence:** `docker-compose.yml:51-66` declares `n8nio/n8n:1.49.2` with `N8N_ENCRYPTION_KEY: "change-me-dev-only"` (line 61) and a read-only bind mount `./n8n:/home/node/n8n-workflows:ro` (line 66). Grep for `n8n|webhook|WEBHOOK|N8N` across the whole `src/` tree returns **no matches**; the only other mentions of n8n anywhere are the compose file itself, `.gitignore:38-39` and `.dockerignore:6,37`. There is no `n8n/` directory on disk and none in `git ls-files`.
- **Impact:** the app never calls n8n, so this is a second container, a second port (`:5678`), a persistent volume and a hardcoded encryption key in the image config that the product does not use — for a newcomer, `docker compose up --build` starts a workflow engine that is not wired to anything (and `web` `depends_on` it, `docker-compose.yml:40-43`, so it always starts). The missing bind source is created as an **empty directory** by Docker/Compose (`create_host_path` defaults to true for short-syntax binds) rather than failing, which quietly drops an untracked `n8n/` folder into the repo — `.gitignore` ignores `.n8n/` (line 39), not `n8n/`. `[INFERENCE]` on the auto-created directory.
- **Fix:** if n8n is genuinely part of the roadmap, gate it: add `profiles: ["automation"]` to the service (keep `web.depends_on.n8n` with its existing `required: false` at lines 41-43, which is exactly what makes profile-gating work), move `N8N_ENCRYPTION_KEY` to `.env.local` instead of a literal, and add `n8n/` to `.gitignore`. If it is not, delete lines 51-66, the `depends_on` block (40-43), the `n8n_data` volume (68-70) and the n8n mentions in the header comment (15, 18-19).

### INFRA-06 · High · `.github/workflows/ci.yml` · VERIFIED
- **Evidence:** the workflow is 23 lines: checkout → Node 20 → `npm ci` → `lint` → `typecheck` → `test` → `build` (`ci.yml:11-23`). `grep -n "docker\|services\|env:" .github/workflows/ci.yml` returns nothing: no `docker build`, no `docker compose config`, no postgres service, no SQL validation, no env stub for the build.
- **Impact:** every defect in this report except INFRA-02 ships unobserved: CI would never have caught the missing `public/`, the phantom `/api/health` probe, the missing `.env.local`, the dead n8n service, or a migration that does not parse. It is also the *only* place the container contract can be checked, since the repo has no other automation. And as of today it cannot even reach those steps (INFRA-02).
- **Fix:** add two jobs.
  - `docker`: `docker build -t sufra:ci .` → `cp .env.example .env.local` → `docker compose config --quiet` (this alone would have failed on INFRA-03/INFRA-05's mount and passes once fixed) → `docker run -d --name smoke -p 3000:3000 --env-file .env.example sufra:ci` → poll `curl -fsS localhost:3000/api/health` (fails on INFRA-04) and `curl -fsS localhost:3000/`. Empty env values are fine here: `supabase-admin.ts:10-15` returns `null` instead of throwing, so the app still answers.
  - `sql`: a `postgres:16` service container, then `psql -v ON_ERROR_STOP=1 -f supabase/migrations/<base>.sql` and `psql -v ON_ERROR_STOP=1 -f supabase/migrations/1002_production_readiness.sql`. Note this can only run once the base schema exists (see Assumption below) — until then the job documents the blocker rather than pretending to be green.
  - Also add `defaults.run.working-directory` or nothing at all — the repo has no scripts/CI shell syntax on POSIX-only paths, so nothing else needs changing for Linux CI.

### INFRA-07 · Medium · `.env.example:44` · VERIFIED
- **Evidence:** `.env.example:44` ships `NEXT_PUBLIC_APP_URL=http://localhost:3000` as a live (uncommented) value. `src/app/api/auth/recover/route.ts:10-13` prefers it over the request origin: `const configured = process.env.NEXT_PUBLIC_APP_URL?.trim(); if (configured) return configured...; return new URL(req.url).origin;`. It is then used as the password-reset base at `recover/route.ts:47` (`redirectTo: ${appBase(req)}/auth/reset`).
- **Impact:** the documented flow is `cp .env.example .env.local` (`README.md:19`) — so the shipped default wins. Any deployment or ngrok session (`README.md:110-153`, which explicitly promises "the app never hard-codes localhost") then emails reset links pointing at `http://localhost:3000/auth/reset`, i.e. the recipient's own machine. Password reset silently breaks outside the developer's browser.
- **Fix:** comment the line out in `.env.example` (`# NEXT_PUBLIC_APP_URL=`) and document that leaving it empty makes the app derive the origin from the request, which is what `README.md:134-139` claims. If a default is wanted, make it the deployment host, not localhost.

### INFRA-08 · Medium · `.env.example` vs `src/app/api/auth/signup/route.ts:21` · VERIFIED
- **Evidence:** `src/app/api/auth/signup/route.ts:21` reads `process.env.SUFRA_PLACEHOLDER_OWNER_EMAIL`. `.env.example` documents 7 variables (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` line 10, `MISTRAL_API_KEY` line 16, `MISTRAL_OCR_MODEL` line 21, `SUFRA_RATE_LIMIT_DISABLED` line 28, `SUFRA_AUTH_DISABLED` line 37, `NEXT_PUBLIC_APP_URL` line 44) and does **not** mention it; only `README.md:33` does. See the diff table below.
- **Impact:** `.env.example` is the enforced contract for handoff (the DB/compose paths both refer to it). A deployer who configures only what `.env.example` lists loses the legacy-placeholder-owner claim path at signup (`signup/route.ts:44-50`) and has no way to know the knob exists without reading the source.
- **Fix:** add to `.env.example`, next to the other `SUFRA_*` switches: `# Legacy placeholder owner email claimed at first signup (optional).` / `# SUFRA_PLACEHOLDER_OWNER_EMAIL=`.

### INFRA-09 · Medium · `supabase/` (no `config.toml`) + migration filename · INFERENCE
- **Evidence:** `git ls-files supabase` → only `supabase/migrations/1002_production_readiness.sql`. No `supabase/config.toml`, no `supabase` CLI in `package.json`. Yet `docker-compose.yml:5` says "Local CLI: `supabase start` → http://localhost:54321" and `.env.example:4` repeats "Local: run `supabase start`". The migration's own header (`1002_production_readiness.sql:4-7`) says it "assumes the tables created by earlier (ad-hoc) migrations exist" and is meant to be pasted into the Supabase SQL editor.
- **Impact:** the locally-hosted-Supabase path that both config files advertise is not runnable: without `supabase/config.toml` the CLI refuses to start a project (`Cannot find project config`), and `supabase db push`/`migration up` only picks up files named `<14-digit-timestamp>_<name>.sql`, so `1002_production_readiness.sql` would be skipped rather than applied. A newcomer following the compose header cannot get a database, and there is no scripted way to apply the one migration that exists. `[INFERENCE]` on the exact CLI behaviour.
- **Fix:** run `supabase init` and commit `supabase/config.toml`, rename the migration to a CLI-recognised timestamp prefix (coordinate with the database slice — see Assumption), and add a `db:migrate` script (`supabase db push` for the CLI path, or `psql -v ON_ERROR_STOP=1 -f supabase/migrations/*.sql` for the hosted path) so the README's "run this in the SQL editor" step becomes a command.

### INFRA-10 · Medium · `package.json` scripts · VERIFIED
- **Evidence:** `package.json:5-12` defines exactly `dev`, `build`, `start`, `lint`, `typecheck`, `test`. There is no `db:migrate`, no `seed`, no `format` (and no Prettier config anywhere in `git ls-files`), and no `start:standalone`. `start` is `next start` (line 8) while the shipped artefact is the standalone bundle (`next.config.mjs:9`, `Dockerfile:29,36`).
- **Impact:** the three things a newcomer must do that are not `npm run dev` — create the database, seed it, verify the production artefact the way Docker runs it — have no entry points. `npm start` does not exercise the standalone `server.js` that production uses, so a locally "working" `npm start` proves nothing about the container (different entrypoint, different env loading: the standalone server does not read `.env.local`, the compose `env_file` supplies it explicitly).
- **Fix:** add `"start:standalone": "node .next/standalone/server.js"`, `"db:migrate": "<psql|supabase db push> ..."`, `"seed": "node scripts/seed.mjs"` and `"format": "prettier --write ."` (plus a `.prettierrc`/`prettier` devDependency if format is wanted) — nothing more; no new product features are implied.

### INFRA-11 · Low · `Dockerfile:24` · VERIFIED
- **Evidence:** `Dockerfile:24` sets `ENV NEXT_STANDALONE_OUTPUT=true`. Grep of the whole repo for `NEXT_STANDALONE_OUTPUT` finds only this line; the actual switch is `next.config.mjs:9 output: "standalone"`, and Next's own flag is the config key, not an env var.
- **Impact:** a maintainer reading the Dockerfile believes the standalone output is toggled at build time by that variable, so moving/removing it looks meaningful and a runner-only env change appears to change the build. It does nothing.
- **Fix:** delete `Dockerfile:24`, or replace it with a comment pointing at `next.config.mjs:9` (`output: "standalone"` is the source of truth; the runner assumes it).

### INFRA-12 · Low · `Dockerfile:8` · VERIFIED
- **Evidence:** `RUN npm ci || npm install` — the fallback exists precisely because `npm ci` fails on this lockfile (INFRA-02). `Dockerfile:7` copies `package.json package-lock.json*` and `.dockerignore:2` excludes `node_modules`, so the deps stage is the only install point.
- **Impact:** two harms. (a) It hides lockfile drift: the image build silently resolves a different dependency tree (`npm install` rewrites the lock inside the layer) than CI's `npm ci` — which is why nobody noticed INFRA-02 until now. (b) The image is not reproducible from the committed lock: the same commit can produce different `node_modules` on different days as ranges (`^`) drift.
- **Fix:** once the lock is repaired (INFRA-02), drop the fallback: `RUN npm ci`. Keep it failing loudly — a broken lock is exactly what should stop a release.

### INFRA-13 · Low · `tailwind.config.ts` under Tailwind v4 · VERIFIED
- **Evidence:** `postcss.config.mjs:4` loads `@tailwindcss/postcss` (v4; lock resolves `tailwindcss@4.3.3`), and `src/app/globals.css:1-2` is `@import "tailwindcss";` + `@import "tw-animate-css";` with **no `@config` directive** anywhere (`grep '@config' src/` → no matches). `tailwind.config.ts:4-6` declares a `content` glob and `tailwind.config.ts:10-22` declares a `brand.*` palette that no `brand-<n>` utility in `src/` uses (the only `brand-` matches are the `@/components/brand-logo` import path).
- **Impact:** Tailwind v4 does not read `tailwind.config.ts` unless the CSS opts in with `@config`, so this file is dead configuration. Any maintainer who adds `text-brand-500` / `bg-brand-700` (the palette the file advertises) gets **no style at all**, with no error — the class simply does not exist. The theme that actually applies is the `@theme inline` block in `globals.css:47+`.
- **Fix:** either delete `tailwind.config.ts` (v4 CSS-first is already in use), or port the `brand` palette into `globals.css` as `@theme { --color-brand-500: #d46324; ... }` and drop the file. Do not leave a v3-shaped config that silently does nothing.

### INFRA-14 · Low · `next.config.mjs:13-18` · INFERENCE
- **Evidence:** `next.config.mjs:14-17` sets `images.remotePatterns` to `{ protocol: "https", hostname: "**" }` and `{ protocol: "http", hostname: "**" }`.
- **Impact:** the Next image optimizer will fetch and re-serve **any** host, so `/_next/image?url=http://<internal-host>/...` becomes an unauthenticated fetch proxy on the deployed origin (internal-network probing / response-cache abuse). The app only needs its own Supabase project host for menu photos (`README.md:169` upload → Supabase Storage). `[INFERENCE]` — I did not exercise the route.
- **Fix:** restrict to the actual storage host, e.g. `{ protocol: "https", hostname: "<project-ref>.supabase.co", pathname: "/storage/v1/object/public/**" }` — or a single `hostname: "**.supabase.co"` — instead of `**` for both protocols.

### INFRA-15 · Low · `package.json:16` · VERIFIED
- **Evidence:** `"@radix-ui/react-progress": "^1.1.2"` is declared, and it is present in the lock. Grep of `src/` for `progress|Progress` matches only i18n copy (`src/lib/i18n.tsx:403,988,1569`) and an `aria-label` (`src/components/onboarding/stepper.tsx:77`) — there is no `src/components/ui/progress.tsx` and no import of the package.
- **Impact:** an unused runtime dependency is installed in every image, every CI run and every developer's `node_modules`, and expands the supply-chain surface for zero product value; it also misleads (a reviewer assumes a progress UI exists).
- **Fix:** `npm uninstall @radix-ui/react-progress` (with the lock repair of INFRA-02 so the lock stays consistent).

### INFRA-16 · Low · toolchain pins · VERIFIED (facts) / INFERENCE (consequence)
- **Evidence:** `Dockerfile:3` and `.github/workflows/ci.yml:16` pin Node 20. `package.json` has **no** `engines` field. The machine this repo was developed on runs Node `v24.18.0` / npm `11.16.0` (`node -v`, `npm -v`), while the lock was produced by an npm that wrote `lockfileVersion: 3`.
- **Impact:** there is no declared runtime, so `npm install` on Node 24/npm 11 (what every local run does) is free to write lockfile content that the Node 20/npm 10 path in CI and Docker reads differently, and `@types/node: ^22` (`package.json:35`) typechecks against a third Node major (`@types/node` 22) — a green `npm run typecheck` locally or in CI does not describe Node 20's runtime API surface.
- **Fix:** add `"engines": { "node": ">=20 <21" }` to `package.json` and align CI/Docker (`node-version: 20`) with whatever the lock was generated by; ideally regenerate the lock on Node 20 so all three agree.

### INFRA-17 · Low · `.gitignore` · VERIFIED
- **Evidence:** `.gitignore` ignores `node_modules`, `.next`, `out`, `build`, `.env*` (including `.env.local`, line 27), `supabase/.temp`, `.n8n/` (line 39) and the dev logs — all correct. It does **not** ignore `n8n/` (the directory `docker-compose.yml:66` mounts and Docker will create), `docs/` (where these audit reports are written — `docs/audit/` exists and is untracked), or `.repowise/` (present in the working tree as an untracked directory). `git ls-files` also still tracks the three prior-audit Markdown files at repo root (`FINAL-AGENT2-AUDIT.md`, `SECURITY-REPORT-ROUND-2.md`, `PERFORMANCE-OCR-REPORT.md`).
- **Impact:** running the documented Docker command drops an untracked `n8n/` directory into the working tree, and the audit deliverables show up as untracked noise next to them — so `git status` offers a commit that mixes generated audit output with a phantom mount point, which is exactly how audit reports end up in a release commit (`README.md:211-215` deliberately treats reports as repo artefacts, so this needs a decision, not a default).
- **Fix:** add `n8n/` (if INFRA-05 keeps the service), `docs/audit/` (if the reports are meant to be regenerated, not shipped) and `.repowise/` to `.gitignore`; if the audit reports *are* meant to be tracked, say so in the README instead of leaving them half-ignored. `node_modules`, `.env.local`, `.next`, `.git` are all correctly ignored already.

### INFRA-18 · Low · `README.md:17` (dev-onboarding path) · VERIFIED
- **Evidence:** `README.md:17` starts local setup with `cd restaurant-ai`, but the repository's package name is `sufra` (`package.json:2`), the compose project name is `restaurant-ai` (`docker-compose.yml:22`) and the working directory is `resto` — there is no `restaurant-ai` directory in or above the tree.
- **Impact:** the first command a newcomer is told to run fails; the mismatch also means the app name in the handoff docs (`Sufra`), the npm package (`sufra`) and the Compose project (`restaurant-ai`) are three different strings, so `docker compose` resource names never match what the docs call the app.
- **Fix:** drop the `cd restaurant-ai` line from `README.md:17` (or name the real path), and align `docker-compose.yml:22 name: restaurant-ai` (and `container_name`s at lines 30, 53) with `sufra`.

## `process.env.*` vs `.env.example` — definitive diff

Every `process.env.X` access in the repository was enumerated (`grep -rn 'process\.env[.\[]' .` including ignored files) and diffed against the seven entries in `.env.example`. Nothing else in the tree reads configuration (notably `next.config.mjs` reads none, and no client component reads `process.env` at all — verified by the same grep).

| Variable | Read at | Purpose | In `.env.example`? | Verdict |
| --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `src/lib/supabase-admin.ts:7`, `src/lib/owner-auth.ts:123,131-132` | Supabase project URL (used server-side only; the browser never talks to Supabase) | Yes — `.env.example:7` | Documented |
| `SUPABASE_SERVICE_ROLE_KEY` | `src/lib/supabase-admin.ts:8`, `src/lib/owner-auth.ts:131` | Server-only service-role key | Yes — `.env.example:10` | Documented |
| `MISTRAL_API_KEY` | `src/app/api/menu/scan/route.ts:72`, `src/lib/menu-scan.ts:86` | Menu OCR / scan | Yes — `.env.example:16` | Documented |
| `MISTRAL_OCR_MODEL` | `src/lib/menu-scan.ts:64` | Optional OCR model override | Yes — `.env.example:21` | Documented |
| `NEXT_PUBLIC_APP_URL` | `src/app/api/auth/recover/route.ts:11` | Password-reset link base | Yes — `.env.example:44` | Documented **but ships `http://localhost:3000` as a live default → INFRA-07** |
| `SUFRA_RATE_LIMIT_DISABLED` | `src/lib/rate-limit.ts:37` | Dev/test kill-switch for the rate limiter | Yes — `.env.example:28` (commented) | Documented |
| `SUFRA_AUTH_DISABLED` | `src/lib/owner-auth.ts:30-31` | Dev-only auth bypass (ignored when `NODE_ENV=production`) | Yes — `.env.example:31-37` (commented) | Documented |
| `SUFRA_PLACEHOLDER_OWNER_EMAIL` | `src/app/api/auth/signup/route.ts:21` | Optional override for the legacy placeholder owner email claimed at signup | **No** | **UNDOCUMENTED → INFRA-08** (only `README.md:33`) |
| `NODE_ENV` | `src/lib/owner-auth.ts:30,218,240`, `src/app/api/auth/worker/accept/route.ts:133` | Cookie `secure` flag + auth-bypass guard | Not needed | Platform-provided (`Dockerfile:22`, `docker-compose.yml:39`) |
| `PORT` | Next standalone `server.js` (invoked at `Dockerfile:36`) | Bind port | Not needed | Platform-provided (`Dockerfile:35`) |
| `NEXT_STANDALONE_OUTPUT` | **Nowhere** | — | Not present | Dead variable, set at `Dockerfile:24` → INFRA-11 |
| `SUFRA_RATE_LIMIT_DISABLED` (test) | `src/lib/rate-limit.test.ts:25,57` | Set/cleared by the unit tests | n/a | Not configuration |

Conversely, every entry in `.env.example` **is** read by code — there are no stale/aspirational entries besides the dead `NEXT_STANDALONE_OUTPUT` (which lives in the Dockerfile, not in `.env.example`).

## Getting this app up in Docker — what to actually run

**Today (needs the three work-arounds marked ⚠).** In order:

```bash
# 1. Runtime config (required — docker-compose.yml:34 aborts without this file)
cp .env.example .env.local
#    then fill in NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MISTRAL_API_KEY
#    ⚠ comment out NEXT_PUBLIC_APP_URL or set it to the public origin  (INFRA-07)

# 2. Database — the repo ships NO base schema (only the incremental 1002 migration,
#    1002_production_readiness.sql:4-7). Apply, in this order, whatever base DDL the
#    database slice produces, then the incremental migration. Hosted Supabase: paste
#    each file into the SQL editor, or:
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f <base schema>.sql                      # ⚠ does not exist yet
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/1002_production_readiness.sql

# 3. Make the image buildable
mkdir -p public && touch public/.gitkeep                                            # ⚠ INFRA-01

# 4. Build + run (n8n is not used by the app; --no-deps avoids it — INFRA-05)
docker compose up --build --no-deps web    # ⚠ --wait fails until INFRA-04 is fixed

# 5. Verify
docker compose ps                                                                    # expect web "Up (unhealthy)" today → INFRA-04
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/                      # 200 (landing page, no DB needed)
curl -s http://localhost:3000/api/health                                             # 404 today → INFRA-04
curl -s http://localhost:3000/api/auth/session                                       # {"cloud":true,"user":null} when signed out
```

Without Compose (single container, same image):

```bash
docker build -t restaurant-ai-web:local .            # ⚠ fails at Dockerfile:28 until public/ exists
docker run --rm -p 3000:3000 --env-file .env.local restaurant-ai-web:local
```

**After the fixes**, the intended flow is: `cp .env.example .env.local` → apply the schema (via `npm run db:migrate` once INFRA-09/INFRA-10 land) → `docker compose up --build --wait` (n8n gated behind `--profile automation`) → `docker compose ps` shows `healthy`. Note the standalone server does not read `.env.local` itself; `env_file` / `--env-file` is what supplies the runtime config, which is why INFRA-03 is fatal even though Next is happy to build without any env (see Verified-working).

## Verified-working

- **The build does not need env vars, and nothing is prerendered with a broken config.** `Dockerfile:17` runs `npm run build` bare; the only module that touches env at module scope is `src/lib/supabase-admin.ts:7-15`, which reads the two Supabase vars and exports `null` (it does **not** throw) when either is empty — explicitly handled by the guest menu page, the one server-rendered data page: `src/app/menu/[slug]/[token]/page.tsx:7` sets `export const dynamic = "force-dynamic"` and lines 16-18 return `<GuestMenu unavailable />` when `supabaseAdmin` is null. The remaining data pages are client components (`"use client"` at the head of `src/app/page.tsx:1`, `src/app/onboarding/page.tsx:1`, `src/app/auth/reset/page.tsx:1` and every `(owner)/dashboard/*` + `(worker)/worker/*` page), and the few real server components are pure redirects that read nothing (`src/app/auth/{forgot,login,signup}/page.tsx:1` import only `redirect` from `next/navigation`; the two dashboard `layout.tsx` files likewise). So the build succeeds with no env and no page is statically rendered against empty config.
- **Runtime `NEXT_PUBLIC_*` injection is not defeated by `output: "standalone"` *for this configuration*.** Next inlines `NEXT_PUBLIC_` variables only when they are present in `process.env` **at build time** (`packages/next/src/lib/static-env.ts` → `getNextPublicEnvironmentVariables()` iterates `process.env`; `packages/next/src/build/define-env.ts` spreads that map unconditionally into every compilation — both read at tag `v15.5.25`, the version pinned in `package-lock.json`). Because `.dockerignore:10` excludes `.env.local` and `docker-compose.yml` supplies env only at runtime, the image is built with neither variable set, so `process.env.NEXT_PUBLIC_SUPABASE_URL` stays a runtime lookup in the server bundle and `env_file` is effective. The corollary belongs to future maintainers: if anyone ever passes these at build time (e.g. `--build-arg` → `ENV` before `npm run build`), the value is baked into **both** client and server bundles and the runtime value is ignored. No client component reads `process.env` today, so nothing leaks to the browser either way.
- **The runner layout matches what the standalone build emits.** `next.config.mjs:12 outputFileTracingRoot: __dirname` pins the tracing root to the project directory, so the standalone entry lands at `.next/standalone/server.js` — `Dockerfile:29 COPY --from=builder /app/.next/standalone ./` puts it at `/app/server.js`, which is what `Dockerfile:36 CMD ["node", "server.js"]` runs (with `.next/static` supplied by `Dockerfile:30`). Pinning via `import.meta.url` + `fileURLToPath` (`next.config.mjs:1-4`) is the correct, Windows-safe way to compute `__dirname` in an ESM config, and it is what protects this tree from the stray lockfile in the parent workspace (comment at lines 10-11).
- **Secrets and repo artefacts do not reach the shipped image.** `.dockerignore:8-14` excludes `.env`, `.env.local`, `.env.*.local` and `.git/`; the runner stage copies only `public/`, `.next/standalone` and `.next/static` (`Dockerfile:28-30`), so the three root audit reports, `docs/`, `.github/`, `supabase/` and `README.md` (which do enter the *builder* context) are absent from the final image. `git ls-files` shows no secrets, keys, dumps or logs tracked (no `.pem`/`.key`/`*.log`), and the only credential-shaped strings in the tree are documented placeholders plus the n8n dev key at `docker-compose.yml:61` (dev-only, and INFRA-05 recommends removing it).
- **`.gitignore` covers the essentials:** `node_modules`, `.next`, `out`, `build`, all `.env*` variants including `.env.local` (line 27), `coverage`, `*.tsbuildinfo`, `next-env.d.ts`, and the Supabase CLI temp dirs.
- **`tsconfig.json` is coherent for this app:** `strict`, `noEmit` (`typecheck` = `tsc --noEmit`, `package.json:10`), `moduleResolution: "bundler"` with `paths: { "@/*": ["./src/*"] }` (`tsconfig.json:11,17-19`) matching the alias used throughout `src/` (and `components.json:7-12`).
- **The unit tests need no vitest config.** `package.json:11 test: "vitest run"` with no `vitest.config.*`/`vite.config.*` in the tree still works because every runtime import in the tested graph is relative or a real dependency: `menu-import.test.ts:15` → `./menu-import`, `menu-sync-guard.test.ts:2-7` → `./menu-sync-guard` (its `./menu-mapping` import is `import type`, erased by esbuild), `order-utils.ts:1` → `zod`, and `ocr-quality/rate-limit/worker-auth/worker-permissions` are self-contained or import only relative paths. (The tests cannot actually be installed until INFRA-02 is fixed.)
- **No POSIX-only script syntax:** all six `package.json` scripts are plain `next`/`tsc`/`vitest` invocations, so they run identically on Windows (dev machines) and on `ubuntu-latest` (CI). The only shell-in-compose construct is the healthcheck (`docker-compose.yml:45`), which uses `node -e` + global `fetch` — available in the pinned `node:20-alpine` (`Dockerfile:3`) — and needs no `curl`/`wget` in the image.
- **`.eslintrc.json` is valid for the pinned linter:** `extends: "next/core-web-vitals"` with `eslint ^8.57.1` / `eslint-config-next ^15.1.2`; `npm run lint` → `next lint` (`package.json:9`) finds the config and does not prompt interactively.
- **`components.json` matches the tree:** `aliases.components/utils/ui/lib` map onto the existing `src/components`, `src/lib/utils.ts` and `src/components/ui/` paths, `rsc: true` + `tsx: true` match the App Router + TSX reality, and `tailwind.config` is deliberately absent (consistent with INFRA-13's conclusion that `tailwind.config.ts` is vestigial).

## Open questions

1. **Assumption carried from the cross-slice contract:** the base schema (`restaurants`, `categories`, `products`, `restaurant_tables`, `orders`, `order_items`, `workers`, `worker_invites` — the exact list is in `1002_production_readiness.sql:5-7`) does not exist in this repository and is owned by the database slice as `supabase/migrations/0001_init_schema.sql`. INFRA-06's SQL job and the "Getting this app up" section are written against that assumption; if the base schema lands under a different name, the `psql -f` lines must be updated. The migration-file rename proposed in INFRA-09 is also a database-slice decision — I did not write any SQL.
2. Is `n8n` genuinely intended for this product (a future automation/webhook feature) or was it copied in from a template? Grep finds zero references in `src/`, so the recommendation is "profile-gate it" if the intent is real, "delete it" if not — that is a product call, not a defect.
3. Are the three root audit reports (`FINAL-AGENT2-AUDIT.md`, `SECURITY-REPORT-ROUND-2.md`, `PERFORMANCE-OCR-REPORT.md`) meant to be tracked release artefacts or scratch output? They are currently tracked while `docs/audit/` is not ignored — INFRA-17 asks for one consistent rule.
4. Does the deployment target have an ingress that terminates TLS in front of the container (`docker-compose.yml` publishes plain `3000:3000` and sets no proxy headers)? This matters for `SUFRA_RATE_LIMIT_DISABLED`/`clientIp` trust in `src/lib/rate-limit.ts`, which is out of this slice's scope but depends on the compose topology audited here.
5. `docker compose up --build --wait` and the health state after INFRA-04's fix were **not** executed (the orchestrator owns the build/run gates and this audit was read-only), so the transition `Up (unhealthy)` → `Up (healthy)` is inferred from the probe's URL and exit-code logic, not observed.
