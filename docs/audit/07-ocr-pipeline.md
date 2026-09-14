# OCR Menu-Scan Pipeline Audit

**Slice:** `src/app/api/menu/scan/route.ts`, `src/lib/menu-scan.ts`, `src/lib/menu-import.ts`,
`src/lib/ocr-quality.ts`, `src/lib/image-utils.ts`,
`src/components/onboarding/menu-scan-dialog.tsx`, `src/lib/onboarding-store.tsx` (scan merge),
`src/lib/menu-import.test.ts`, `src/lib/ocr-quality.test.ts`
**Method:** static reading + execution of the real modules (`menu-scan.ts`, `menu-import.ts`,
`ocr-quality.ts` imported directly and driven from a scratch REPL). **No Mistral call was made**,
per the audit rules; every "executed" result below is the real function's output on a constructed
input. Provider-side behaviour is cited from Mistral's published docs and flagged `[INFERENCE]`
where it could not be observed live.

Prior art read and NOT re-reported: `PERFORMANCE-OCR-REPORT.md` §§6–13 (memory ceiling, retry
budget, no-`AbortSignal`) and `FINAL-AGENT2-AUDIT.md` §7/F9 (auth/limit/cap ordering, 413 probes).
Findings below are beyond those reports unless explicitly noted.

---

## Verdict

The pipeline is architecturally sound and its pure stages are genuinely deterministic and
defensive — no input I could construct produces a `NaN`, negative, or undefined price, an empty
name, a duplicate product, or a product without a category in `MenuImportResult`. But two classes of
defect make it unsafe to ship as the flagship feature: **the price/name parser mis-reads several
real printed price formats and the result of that mis-read reaches a live menu** (OCR-02, OCR-03),
and **the quality gate rejects exactly the menus the deterministic parser was written to rescue and
then fails the whole scan after three paid OCR calls** (OCR-05). On top of that: no provider fetch
has a timeout (OCR-06), table-laid-out menus are either silently emptied or imported as garbage rows
(OCR-04), and the reconciler drops parser products while claiming an invariant it violates (OCR-01).
Nothing here is blocked by the missing base schema — the scan path touches Supabase only for the
owner session check (`route.ts:46-60`) — so this slice is testable and fixable now.

---

## Required behaviour

Derived from the code's own contracts and comments:

1. `prepareUploadFile` sends the smallest faithful representation of each picked file; a file the
   picker offers (including HEIC/HEIF, `dialog.tsx:19`) must either upload or produce an actionable,
   specific error — never a generic failure.
2. `runMenuScan` returns a canonical `MenuImportResult` for any scanned menu the provider could read,
   or a typed `MenuScanError`; the same input always yields the same output (the module is
   documented pure, `menu-import.ts:7-9`).
3. Every dish carries the printed price in TND. An unreadable price is `0` and renders as `—`
   (`dialog.tsx:262`); a price that is *wrong but plausible* must never be produced
   (`menu-import.ts:74-80`).
4. The annotation is a hard schema contract: `additionalProperties:false` and every field the
   builder reads is `required` (`menu-scan.ts:206-236`), so absence is impossible by construction
   and the code need not defend against it (it does anyway).
5. The deterministic parser is the safety baseline: "we ALWAYS run the deterministic parser too and
   keep whichever result is richer … This guards against 'it found fewer categories than last time'"
   (`menu-scan.ts:474-477`). Therefore `final products >= max(ai, parser)`
   (`menu-import.ts:388-390`) except for entries rejected by the final sanitize pass.
6. The quality gate is "PURELY structural … never assumes a minimum number of categories or
   products, so arbitrary real menus pass" (`ocr-quality.ts:9-14`), and a genuine 2-item headingless
   mini-menu must pass (`:70-73`).
7. Behaviour must be bounded: a provider stall cannot hold a request forever, and per-request memory
   must fit the platform's function limit for the maximum accepted upload (6 × 12 MB, `:60-61`).
8. The onboarding merge is deterministic, step-independent, idempotent for a repeated result, and it
   never destroys state the owner already wrote (`menu-import.ts:293-303`, `onboarding-store.tsx:406-416`).

---

## 1. End-to-end pipeline

| # | Stage | Location | Input | Output | Failure mode |
|---|---|---|---|---|---|
| 1 | Pick / filter files | `menu-scan-dialog.tsx:65-85` | `FileList` | ≤6 `File`s, deduped by `name-size` | all-rejected → `ms_error_BAD_TYPE` (:70-73) |
| 2 | `prepareUploadFile` | `image-utils.ts:52-79` | `File` | same `File` (PDF, or ≤2048px & png/jpeg/webp) or a re-encoded JPEG blob | HEIC/undecodable → `loadImage` rejects → generic error (OCR-11) |
| 3 | Multipart POST | `menu-scan-dialog.tsx:93-101` | FormData(`files[]`, `venue`) | POST `/api/menu/scan` | no timeout/abort (OCR-06); non-JSON platform 504 → `res.json()` throws → `ms_error_generic` (:113-116) |
| 4 | Route guards | `route.ts:45-127` | request | `File[]`→`Buffer[]` + venue(≤200 chars) | 503 `NO_BACKEND` → 401 `UNAUTHORIZED` → 429 `RATE_LIMITED`(+`Retry-After`) → 503 `NO_KEY` → 413 `FILE_TOO_LARGE` → 400 `BAD_BODY` → 400 `TOO_MANY_FILES` → 413 per-file |
| 5 | `runMenuScan` validation | `menu-scan.ts:437-448` | files, venue | validated | `TOO_MANY_FILES` / `FILE_TOO_LARGE` / `BAD_TYPE` |
| 6 | Upload to Mistral Files | `menu-scan.ts:166-180` | `Buffer` | `file_id` | `UPLOAD_FAILED` (or `NO_KEY`/`RATE_LIMITED`/`NETWORK` via `errorFromStatus:144-157`) |
| 7 | OCR + document annotation | `menu-scan.ts:249-323` | `file_id`, spec | `{markdown, annotation, pages}` | `OCR_FAILED` (no pages & no annotation, or quality gate exhausted), `RATE_LIMITED`, `NETWORK` |
| 8 | `assessOcrQuality` | `ocr-quality.ts:40-81` | markdown | `{ok, reason, chars, items, headings, priced}` | `ok=false` → retry up to 3× (:254,306-316) then `OCR_FAILED` (:317-320) |
| 9 | AI structure | `menu-scan.ts:479-500` | `annotation` JSON | `MenuImportResult` (`source:"ai"`) | annotation missing/invalid → logged, AI result empty (scan continues) |
| 10 | `parseOcrMarkdown` → `buildMenuImport` | `menu-scan.ts:505-508` | joined markdown | `MenuImportResult` (`source:"fallback"`) | never throws; empty result possible |
| 11 | `reconcileImports` | `menu-import.ts:409-501` | ai, parser | union `MenuImportResult` | can drop parser products (OCR-01) |
| 12 | Empty guard | `menu-scan.ts:511-513,502-504` | best | throw `EMPTY` | `EMPTY` if 0 products; `:502-504` is unreachable (see Open questions) |
| 13 | HTTP 200 `{ok:true,result}` | `route.ts:131-134` | result | JSON + session rotation | `MenuScanError` → `STATUS[code]` (:136-140); anything else → 500 `UNKNOWN` |
| 14 | Review UI | `menu-scan-dialog.tsx:207-209,231-271` | result | ≤8 items/category listed | silently truncates the review (OCR-10) |
| 15 | Merge | `ops`→`importMenuFromScan` | `menu-scan-dialog.tsx:119-122` → `onboarding-store.tsx:406-416` → `mergeMenuImport` | new app state | silent skip on name collision (OCR-09) |

---

## 2. Network calls, timeout posture, honest worst case

There is exactly **one** `fetch` in the whole pipeline — `menu-scan.ts:106` — reached by both provider
operations through `postWithRetry`. `grep -rn "AbortSignal|AbortController" src` returns **zero
matches** (the only `setTimeout`s are the retry sleeps and unrelated UI timers). The prior audit's
claim is confirmed and is now named per call site:

| # | Call site | Reached via | Timing | Per-invocation fetches | Sleep budget | Timeout |
|---|---|---|---|---|---|---|
| 1 | `POST /v1/files` (upload) | `menu-scan.ts:175` → `postWithRetry:106` | 1× per file, serial (`:453-458`) | ≤6 (`:103`) | ≤24 s (2+4+6+6+6, `:121`) | **none** |
| 2 | `POST /v1/ocr` | `menu-scan.ts:255` → `mistralJson:159-163` → `postWithRetry:106` | ≤3× per file (`OCR_QUALITY_ATTEMPTS:69`, `:254`) | ≤18 (6 per attempt) | ≤72 s + 4.5 s quality sleeps (`:314`) | **none** |
| 3 | client `POST /api/menu/scan` | `menu-scan-dialog.tsx:101` | 1× per scan | browser fetch | — | **none** (no cancel on dialog close; `setOpen(false)` at `:212` leaves the request running and the provider spend committed) |
| — | `req.formData()` | `route.ts:90` | 1× per scan | — | — | **none** |

429 handling inside call 1/2 costs 5 s + 10 s and returns the 429 on the third attempt
(`:129-140`) — it cannot stack on top of the 24 s network path.

**Honest worst-case wall clock.** With a provider that *errors* rather than hangs:
6 files × (upload ≤24 s + OCR ≤76.5 s) = **≤603 s of pure `await`-sleeps**, and ≤144 fetch attempts,
all serial. With a provider that *hangs* (no error, no response) there is **no bound at all** — the
root cause is OCR-06. The only real bound today is the platform: `route.ts:17` sets
`maxDuration = 120`, which is **less than the sleep budget of a single 6-file scan**, so a degraded
provider always ends in a platform timeout with no partial result and no typed error; on a
self-hosted Node server the handler hangs indefinitely holding its buffers. Good path for reference:
2 fetches per file, no sleeps.

**Honest worst-case memory per request.** The route parses the entire multipart body into memory
before any per-file check (`route.ts:80-96`; the `Content-Length` guard is skipped when the client
sends `Transfer-Encoding: chunked`, so the real bound is only the `maxRequestSize` of the host), then
`Buffer.from(await f.arrayBuffer())` allocates a second full copy of every file (`:119-127`), then
`uploadDocument` copies the in-flight file twice more — `new Blob([buffer])` (`menu-scan.ts:172`,
Blob construction copies) and the multipart serialization. So **every uploaded byte is live ~3× at
once**:

| Live at peak | Bound |
|---|---|
| `req.formData()` body (undici) | ≤76 MB (`MAX_BODY_BYTES`, `route.ts:28`) — unbounded if chunked |
| `files[].buffer` (6 × `Buffer`) | +72 MB |
| `new Blob([buffer])` + multipart body for the in-flight file | +24 MB |
| OCR markdown for 6 docs × 20 pages | ~1 MB |
| **Peak per request** | **≈170 MB** (`[INFERENCE]` on undici's internal overhead; ≥3 copies of every byte is certain from the code) |

20 concurrent scans (the limiter is 10/min **per IP**, `route.ts:63`, and in-memory per instance, so
different IPs are not gated) ≈ **3.4 GB**. On a 512 MB serverless function the scan dies mid-flight.
[INFERENCE] Prior art quoted ~80 MB; that counted the body + one buffer and missed the `Buffer.from`
and `Blob` copies.

---

## 3. The `json_schema` sent to Mistral

`annotationSpec` (`menu-scan.ts:183-240`) sends
`document_annotation_format = {type:"json_schema", json_schema:{name:"menu", strict:true, schema:{…}}}`
plus `document_annotation_prompt` (`:267-268`).

**Well-formed? Yes.** That object is byte-for-byte the shape the official Mistral SDK itself emits —
`mistralai/client-python` `src/mistralai/extra/utils/response_format.py`
(`response_format_from_pydantic_model` returns `{"type":"json_schema","json_schema":{"name":…,
"schema":…,"strict":True}}`), and the docs confirm `document_annotation_format` +
`document_annotation_prompt` is the supported way to extract a user-provided JSON structure
(https://docs.mistral.ai/studio/document-processing/annotations). Strict-mode requirements are also
satisfied: `additionalProperties:false` on the root, on every category and on every item
(`:225,230,235`) and every declared property is listed in `required` (`:224,229,234`).

**Guaranteed fields vs. what the code reads.** Everything the builder reads *from the annotation* is
`required`:

| Read at | Field | Guaranteed by schema |
|---|---|---|
| `menu-scan.ts:486-489` | `parsed.categories` (array) | root `required:["categories"]` |
| `menu-import.ts:193-198` | `c.name`, `c.items` | `required:["name","items"]` |
| `menu-import.ts:216,219,225,226` | `it.name`, `it.description`, `it.price`, `it.category` | `required:["name","description","price"]`; `category` is injected by the sanitizer itself (`menu-scan.ts:201`) |

**No field is read that the schema does not guarantee**, and the sanitizers are defensive anyway
(`normalizeName` returns `""` for non-strings, `sanitizePrice` returns `0` — `menu-import.ts:60-63,81-91`),
so a non-conforming payload cannot produce `NaN`/`undefined` downstream. Two residual risks:
(i) `strict` is only as good as the provider's decoder — if it is advisory, the guarantee degrades to
"the sanitizer saves us", which it does; (ii) the code reads `document_annotation` as a **string**
(`menu-scan.ts:257,487`) while the provider's response reference documents it as `dict|null` — see
OCR-15.

---

## 4. Determinism, sanitisers, and the price truth table

**Determinism: proven for the pure stages.** `parseOcrMarkdown(md)` twice → byte-identical JSON;
`buildMenuImport` twice → identical; `reconcileImports(a,b)` and `reconcileImports(b,a)` → identical
product sets. Only insertion-ordered `Map`s, `Set`s and array scans are used (`menu-import.ts:414-456,
509-535`), and the only randomness in the whole slice is the caller-supplied `uid()` in
`mergeMenuImport` (`:319,344`). `mergeMenuImport` is also idempotent for a repeated identical result
(state after 1× and 2× = 1 category, 1 product — executed).

**Sanitiser guarantees (executed).** `sanitizePrice` clamps to a finite `0..9999` with 3 decimals and
maps every non-number/non-parsable/negative/`Infinity` input to `0` (`:81-96`; probe: `NaN→0`,
`null→0`, `true→0`, `{}→0`, `-5→0`, `"12.5.6"→0`); `sanitizeImport` drops empty/artifact names
(`:216-217`), resolves every product to a non-empty `categoryName` (falling back to `UNCATEGORIZED`,
`:219-221`), dedupes by `(categoryKey|nameKey)` first-wins (`:230-233`), keeps only categories that
carry products, and adds `Uncategorized` only when orphans exist (`:236-246`). A hostile probe
(`categories:[{name:"  ",items:[{name:"",price:NaN},{name:"  ",price:-3}]},{name:"A",items:[{name:null},{name:123}]}]`,
`products:[{name:"A",price:1}]`) produced **one** valid product, no `NaN`, no empty name, no empty
category — **no input produces a duplicate category, a duplicate product, a product without a
category, a `NaN`/negative/undefined price, or an empty name.** The one place the contract *is*
violated is product loss (OCR-01), not corruption.

### Price parsing truth table (executed through `parseOcrMarkdown` → `buildMenuImport`)

Input line placed under `## Test`; "price" is `MenuImportResult.products[0].price`.

| Input | `PRICE_SPLIT_RE` (`menu-scan.ts:342-343`) | `extractPriceToNumber` (`:366-378`) | Result | Correct? |
|---|---|---|---|---|
| `Cappuccino 12,5` | `("Cappuccino","12,5")` | `,`→`.` → 12.5 | **12.5**, name "Cappuccino" | ✅ |
| `Cappuccino 12.5` | `("Cappuccino","12.5")` | 12.5 | **12.5** | ✅ |
| `Cappuccino 12 DT` | `("Cappuccino","12")` + `DT` eaten | 12 | **12** | ✅ |
| `Couscous 1 200` | `("Couscous 1","200")` | 200 | **200**, name **"Couscous 1"** | ❌ **wrong price + corrupted name** (OCR-02) |
| `Couscous 1\u00A0200` (NBSP) | `\s` matches NBSP → same | 200 | **200**, name "Couscous 1" | ❌ same |
| `Steak $12.50` | **no match** (price must follow the name; `$` blocks it) | — | **0**, name `"Steak $12.50"` | ❌ digits+symbol leak into the name (OCR-03) |
| `Café €12` | **no match** | — | **0**, name `"Café €12"` | ❌ same |
| `عصير ١٢٫٥` | **no match** (`\d` is ASCII-only in JS) | — | **0**, name `"عصير ١٢٫٥"` | ❌ whole price lost (OCR-03) |
| `Espresso 4.500 DT` | `("Espresso","4.500")` | 4.5 | **4.5** | ✅ |
| `Coca 3 E` | `("Coca","3")` + `E` currency token | 3 | **3** | ✅ |
| `Pizza 12.500` | `("Pizza","12.500")` | 12.5 | **12.5** | ✅ |
| `Tarte 12,500 DT` | 12,500 → `,`→`.` | 12.5 | **12.5** | ✅ |
| `Jus 1,5 DT` | 1,5 | 1.5 | **1.5** | ✅ |
| `Salade 6.5€` | `("Salade","6.5")` + `€` eaten | 6.5 | **6.5** | ✅ |
| `1.200` (as `## X` item line) | `("1.200"?)` → price-only branch | 1.2 | **1.2** | ⚠️ ambiguous in TND (1.200 = 1 DT 200) |
| `## Boissons\n2.500\nCafé` | price-only with **no** previous item | — | line **discarded**, Café = **0** | ❌ silent loss (OCR-18; an earlier draft cited this as `OCR-19`, a numbering slip — see `docs/AUDIT.md` §5) |

For completeness, `sanitizePrice` (the path a *string* price takes when the AI annotation is
unavailable) gives: `"12,5"→12.5`, `"12.5"→12.5`, `"12 DT"→12`, `"1 200"→**1200**`,
`"$12.50"→**0**`, `"€12"→12`, `"١٢٫٥"→**0**`, `"16,500"→16.5`. Note the divergence: the parser reads
`1 200` as **200** while `sanitizePrice` reads it as **1200** — the same string, two different prices,
depending on which stage sees it (OCR-02, OCR-14).

---

## 5. `assessOcrQuality` thresholds and boundaries

Constants (`ocr-quality.ts:16-23`): `MIN_NON_WS_CHARS = 8`, `MIN_ITEMS_FOR_STRUCTURE = 3`,
`HEADING_RE = /^#{1,3}\s+\S/`, `NOISE_RE = /^(<!--|===+|-{3,})/`.
`items` counts **every** non-heading, non-noise line (so the venue name, a phone number and an address
each count as an "item", `:60-61`); `chars` counts non-whitespace chars of **all** non-empty lines
including headings and noise (`:52`); `priced` uses `PRICE_ONLY_RE|PRICE_RE` (`:63`).
Decision order (`:68-81`): `EMPTY_TEXT` → `NO_ITEMS` → `NO_STRUCTURE` (`items>=3 && headings===0`) →
`TRUNCATED` (`items>0 && endsOnHeading`) → ok.

| Threshold | Boundary | Result (executed) |
|---|---|---|
| `chars` | 6, 7 → reject; **8 → accept** | 8-char single line `ABCCCCCC` → `ok=true` |
| `items` with `headings=0` | **1, 2 → accept; 3, 4 → `NO_STRUCTURE`** | `Plat0 1\nPlat1 2` ok; +`Plat2 3` rejected |
| `items` with headings | any | `## Petit Déjeuner\nCafé 2\nJus 3` → ok, items=2, headings=1 |
| `endsOnHeading` | only true when the last non-noise line is a heading | `## Boissons\nCafé 2\n## Desserts` → `TRUNCATED` |
| noise lines | do not reset `endsOnHeading` (`:59` `continue`s) | `## A\nCafé 2\n## B\n===` → `TRUNCATED` |

**What a real 1-category/2-product menu does — it passes, as intended.** Executed:
`## Petit Déjeuner\nCafé 2\nJus 3` → `ok=true, reason=null, items=2, headings=1, priced=2`; and the
test at `ocr-quality.test.ts:22-28` asserts exactly this. The documented 2-item headingless case also
passes (`:30-34`).

**Concrete input that wrongly REJECTS a legitimate small menu — three forms (all executed):**

1. A genuine **3-item headingless price board** (a food-truck / small-café menu, a real product
   target): `Café 2\nThé 2\nJus 3` → `NO_STRUCTURE` (items=3, headings=0). The doc comment at
   `:70-73` only protects the 2-item case, so the boundary between "legitimate" and "degraded" is
   drawn at exactly the point where real menus start. Worse, `parseOcrMarkdown` handles this input
   correctly — executed: `[{name:"Menu", items:[Café 2, Thé 2, Jus 3]}]` (the catch-all at
   `menu-scan.ts:420-422`) — so the gate destroys a result the rest of the pipeline could have used (OCR-05).
2. **Bold section headings** (Mistral commonly emits `**Nos Boissons**`): `**Nos Boissons**\nCafé 2\nThé 2\nJus 3`
   → `NO_STRUCTURE`, items=**4** (the heading itself is counted as an item), headings=0.
3. **`####` / `#NoSpace` headings**: `#### Starters\nBrik 4\nSalade 6\nOjja 8` → `NO_STRUCTURE`
   (`HEADING_RE` is `#{1,3}` and requires a space). The parser has the same `#{1,3}` limit, so
   `#### Starters` becomes a **product** named `#### Starters` with price 0 (executed).

In all three the outcome is not "worse extraction" but **`OCR_FAILED` after 3 paid OCR calls**
(`menu-scan.ts:306-320`), surfaced to the owner as `ms_error_OCR_FAILED`.

**Concrete input that wrongly ACCEPTS garbage (executed):**

1. A promotional panel photographed alongside the menu: `## Promotions\nRéduction 20%` →
   `ok=true` (chars=24, items=1, headings=1, priced=0). `parseOcrMarkdown`+`sanitizeImport` then
   import `Réduction 20%` as a **product** (price 0, category `Promotions`; `isOcrArtifact` returns
   `false` for it), and `runMenuScan` returns success because `products.length === 1`
   (`menu-scan.ts:511`).
2. A single 8-char junk line `ABCCCCCC` → `ok=true`, and it imports as a product named `ABCCCCCC`.
3. Any **truncated fragment that still ends on an item line**: `## Boissons\nCafé 2\nThé 2\nJus` →
   `ok=true`. The gate cannot see that this is 3 lines of a 40-item menu; `TRUNCATED` only fires in
   the single case where the document ends on a heading (OCR-13).

---

## 6. `mergeMenuImport` behaviour (`menu-import.ts:304-355`, `onboarding-store.tsx:406-416`)

All three scenarios executed against the real function:

- **Scan run twice with the same result** → **idempotent**: 1 category, 1 product both times
  (`:325-331` dedupes category names by normalized key, `:339-342` skips existing
  `(categoryId, nameKey)`). Good.
- **User has already typed products manually** → the existing row wins and the scan's row is dropped:
  manual `{Espresso @Boissons, price 9, description "mine"}` + scan `{espresso @Boissons, price 3}`
  → **1 product**, price **9**, description "mine". The scan's price/description are silently
  discarded (`:339-342` `continue`), and `applyResult` still closes the dialog as if everything was
  imported (`dialog.tsx:119-122`). Re-scanning after hand-editing a price therefore appears to work
  while silently skipping those rows (OCR-09).
- **Scan returns a name that collides with an existing row in a *different* category** → **a second
  product is created** (executed: manual `Espresso @c_boissons` + scan `Espresso @Chauds` → 2 rows,
  ids `c1`/`id2`). This is defensible (same name, different section) but it means one dish can appear
  twice on the guest menu after a bad OCR category assignment — which OCR-02/OCR-04/OCR-18 make
  likely (e.g. `Couscous` vs `Couscous 1`, executed through `reconcileImports` → **two products, one
  of them at 200 DT**).
- Not handled at all: no update, no per-row conflict report, no way to reject one item in the review
  step (import is all-or-nothing, `dialog.tsx:216-218`).

---

## Findings

### OCR-01 · Critical · `reconcileImports` (reconcile) · VERIFIED
- **Evidence:** `src/lib/menu-import.ts:388-390` states the invariant `final products >= max(ai, parser)`.
  Executed: `reconcileImports(ai={Salade@Starters}, parser={Salade@Starters, Salade@Mains})` → **1 product**
  (name "Salade", price 6, category "Mains"); invariant **false**. Trace: the parser's disambiguated
  slot key `salade\0mains` finds no exact match, so `:447-449` resolves it to the bare AI slot
  `salade`, and `:452` **overwrites** the `parser` already attached there by the `salade` (Starters)
  slot from `:435-455`; no other slot exists for it, so the earlier parser product is gone.
- **Impact:** any dish printed under two sections (a very common Moroccan/Tunisian menu pattern:
  "Salade" under *Entrées* and under *Plats*) loses one listing. The orphaned category is then
  dropped by `sanitizeImport:236-238`, so a whole section can disappear from the imported menu. The
  UI reports success; the comment at `menu-scan.ts:474-477` claims this is exactly what the parser
  baseline prevents.
- **Fix:** in the `else if (!target && psKey.includes("\u0000") && merged.has(nkOf(psKey)))` branch
  (`:447-449`), only attach when the bare slot has **no** `parser` yet; otherwise fall through to
  `merged.set(psKey, { name: ps.name, parser: ps })` (`:454`). Add a unit test asserting
  `products.length >= max(ai.products.length, parser.products.length)` for the a/b/a-case fixture.

### OCR-02 · Critical · `parseOcrMarkdown` price split · VERIFIED
- **Evidence:** `src/lib/menu-scan.ts:342-343` `PRICE_SPLIT_RE = /(.+?)\s+(\d+(?:[,.]\d+)*)\s*(?:DT|…)?\s*$/i`
  matches the **last** whitespace-separated digit run and the lazy `(.+?)` then swallows the preceding
  one. Executed: `Couscous 1 200` → `{name:"Couscous 1", price:200}`; `Couscous 1\u00A0200` (NBSP) →
  same (JS `\s` matches U+00A0). Executed through `reconcileImports` with an AI read of `Couscous 12`:
  **two products** — `{Couscous, 12}` and `{Couscous 1, 200}`.
- **Impact:** a phantom dish with a price ~17× the real one lands in the live menu, in a different
  slot from the correct dish, so the dedupe/merge cannot cancel it. Guests can order it and the
  owner's printed menu will not match. Space-separated prices ("1 200", "4 500") are standard on
  hand-lettered and older printed Tunisian menus, and NBSP is what a PDF/OCR pipeline produces.
- **Fix:** make the price token span internal whitespace (`(\d[\d\s]*(?:[,.]\d+)*)`) and normalise it
  before `extractPriceToNumber` (strip spaces, then apply the TND rule: a trailing 3-digit group after
  a space is the fractional part, so `1 200` → 1.2 and `16 500` → 16.5), **and** refuse a match whose
  captured name ends in a digit (`(.+?[^\d\s])`), so `Couscous 1 200` cannot silently become
  "Couscous 1" — if the line cannot be parsed unambiguously it must stay price-0 rather than wrong.
  Cover every form in the truth table above with a test.

### OCR-03 · High · `parseOcrMarkdown` currency/digit handling · VERIFIED
- **Evidence:** `PRICE_SPLIT_RE:342-343` accepts `DT|TND|د.ت|€|USD|E` only **after** the digits, and
  `\d` is ASCII-only in JS. Executed: `Steak $12.50` → `{name:"Steak $12.50", price:0}`;
  `Café €12` → `{name:"Café €12", price:0}`; `عصير ١٢٫٥` → `{name:"عصير ١٢٫٥", price:0}`. The
  currency-suffix forms do work (`Salade 6.5€` → 6.5; verified test coverage at
  `menu-import.test.ts:52`), so the failure is specifically prefix symbols and non-ASCII digits.
  `sanitizePrice` is inconsistent with this: `"$12.50"` → **0** (bare `$` is not in the alternation
  at `menu-import.ts:85`, unlike `US\$`) while `"€12"` → 12 (symbol stripped, **no FX applied**).
- **Impact:** on a menu printed as `5.500 €` the parser is fine, but on one printed `€ 5.500`, `$5.50`
  or with Arabic-Indic numerals (`١٢`), every price is lost: the product imports at 0, the review
  shows "—" (`dialog.tsx:262`), and a 0-price item ordered through the guest menu prices the ticket
  at 0. Arabic-Indic digits are plausible for a Tunisian venue; the AI annotation can rescue those
  rows when it captures them (the reconciler prefers a valid AI price over an invalid parser price,
  `menu-import.ts:538-547`), which is why this is High rather than Critical — but any dish the AI
  misses is silently free.
- **Fix:** add a price-prefix form to the regex (`(?:\$|€|£)?\s*(\d…)`) and normalise Arabic-Indic /
  Eastern-Arabic numerals (`[\u0660-\u0669\u06F0-\u06F9]` → ASCII, `\u066B`→`.`, `\u066C`→``) before
  parsing, in **both** `parseOcrMarkdown` and `sanitizePrice`; add `\$` to `menu-import.ts:85`.

### OCR-04 · High · table-formatted menus · VERIFIED
- **Evidence:** the request sets `table_format: "markdown"` (`menu-scan.ts:266`). Mistral's OCR docs
  (https://docs.mistral.ai/studio/document-processing/basic_ocr) state that with `markdown`/`html`
  tables are **returned separately** in `page.tables` and the page markdown carries only a placeholder
  such as `[tbl-3.md](tbl-3.md)`; the response schema exposes `pages[].tables`. `OcrOutcome` keeps
  only `{markdown, annotation, pages}` (`menu-scan.ts:243-247`, built at `:271-274`) — **`page.tables`
  is never read anywhere** — and the placeholder is dropped as an artifact
  (`menu-import.ts:100-101,129-138`; the project's own test asserts `[tbl-0.md](tbl-0.md)` is an
  artifact, `menu-import.test.ts:58-59`). Executed: `## Plats\n[tbl-0.md](tbl-0.md)` → **0 products**.
  If a table nevertheless reaches the markdown (the `table_format:null` default behaviour, or a model
  that inlines rows anyway), the parser turns every row into a product — executed:
  `| Plat | Prix |`, `| Café | 2.500 |`, `| Thé | 3.000 |` → **three products named after the raw
  rows, all price 0**.
- **Impact:** most printed Tunisian menus are grid/table layouts, so this is a large share of real
  inputs. Either the entire table body vanishes from the deterministic baseline (leaving only the AI
  annotation — i.e. the exact single-point-of-failure the parser is documented to prevent), or the
  guest menu gains entries literally named `| Café | 2.500 |`.
- **Fix:** either (a) drop `table_format` so tables stay inline **and** add a table-row branch to
  `parseOcrMarkdown` (`^\s*\|` → split on `|`, first non-empty cell = name, last cell matching
  `PRICE_ONLY_RE` = price, middle cells = description; ignore a row whose cells are all
  `-{3,}`/non-alphanumeric), or (b) keep `table_format:"markdown"` and concatenate
  `pages[].tables[*].markdown` into the parser input alongside `page.markdown`. Do not leave both
  halves unimplemented.

### OCR-05 · High · quality gate contradicts the parser · VERIFIED
- **Evidence:** `ocr-quality.ts:70-75` rejects any document with `items>=3 && headings===0`;
  `menu-scan.ts:306-320` converts that into `OCR_FAILED` after `OCR_QUALITY_ATTEMPTS=3` provider
  calls. Executed: `Café 2\nThé 2\nJus 3` → gate `ok=false, reason=NO_STRUCTURE`, while
  `parseOcrMarkdown` on the same string returns `[{name:"Menu", items:[Café 2, Thé 2, Jus 3]}]` — the
  catch-all at `menu-scan.ts:420-422` exists precisely for headingless content and can therefore never
  be reached for a document the gate rejects. Executed false-rejects: `**Nos Boissons**\nCafé 2\nThé 2\nJus 3`
  (bold heading, items=4) and `#### Starters\nBrik 4\nSalade 6\nOjja 8` (4 hashes) — both are
  ordinary OCR renderings of a heading that `HEADING_RE` (`ocr-quality.ts:19`, `menu-scan.ts:341`)
  does not recognise. Independent unit tests currently *assert* the rejection
  (`ocr-quality.test.ts:52-58`), so the contradiction is baked in.
- **Impact:** the flagship feature hard-fails on a legitimate small menu (3-item price board) and on
  any menu whose headings OCR as bold or `####`, after paying for three OCR calls, with the message
  "OCR degraded after 3 attempts" reported to the owner as "couldn't read the menu". The product's
  own stated intent (`ocr-quality.ts:10-13`: "never assumes a minimum number of categories or
  products, so arbitrary real menus pass") is violated.
- **Fix:** make the retry loop *retry-then-use* instead of *retry-then-throw* — on the last attempt
  accept the best markdown seen and let `parseOcrMarkdown`'s catch-all handle it — and widen
  `HEADING_RE` to `/^#{1,6}\s+\S/` plus a fully-bold-line case (`^\*\*[^*]{1,80}\*\*$`) in **both**
  `ocr-quality.ts:19` and `menu-scan.ts:341`. Update `ocr-quality.test.ts:52-58` to assert the
  headingless case is accepted (or accepted-with-retry) rather than fatal.

### OCR-06 · High · no timeout on any provider or client fetch · VERIFIED
- **Evidence:** the single `fetch` at `src/lib/menu-scan.ts:106-113` passes `method/headers/body` and
  **no `signal`**; `grep -rn "AbortSignal|AbortController" src` → **0 matches**. Both `/v1/files`
  (`:175`) and `/v1/ocr` (`:255`) funnel through it, and `ocrDocument` repeats it up to 3× per file.
  The client fetch (`menu-scan-dialog.tsx:101`) has no signal either and the dialog is closable while
  it is in flight (`:212`). `route.ts:17` sets `maxDuration = 120` but nothing inside the handler
  enforces it.
- **Impact:** a hung TLS connection to `api.mistral.ai` (the exact scenario `dns.setDefaultResultOrder`
  at `menu-scan.ts:7` was added to mitigate) parks the request on `await fetch` forever: no typed
  error, no `EMPTY`/`OCR_FAILED`, no owner-facing message beyond the platform's HTML 504 (which the
  dialog can only render as `ms_error_generic`). Self-hosted, the handler never returns while holding
  ~170 MB (see §2). Closing the dialog does not cancel anything, so the provider spend still lands.
- **Fix:** per-attempt `signal: AbortSignal.timeout(30_000)` (combine with a request-scoped signal via
  `AbortSignal.any([req.signal, AbortSignal.timeout(...)])`, threaded `route.ts:130` → `runMenuScan`
  → `postWithRetry`), treat an abort like a network error (retryable, bounded), and return
  `NETWORK`/`OCR_FAILED` with the elapsed time. Mirror it client-side with an `AbortController` tied
  to dialog close.

### OCR-07 · Medium · per-request memory ≈3× the upload cap · VERIFIED
- **Evidence:** `route.ts:88-96` parses the entire multipart body into memory before the per-file
  check; `route.ts:80-86` only applies `MAX_BODY_BYTES` when a `Content-Length` header is present
  (`contentLength > 0`), so a chunked client is unbounded; `route.ts:119-127` copies every file again
  into a `Buffer`; `menu-scan.ts:171-173` copies the in-flight file into a `Blob` and then into the
  multipart body. Arithmetic in §2: **≈170 MB peak** for a legal 6×12 MB scan, ~3.4 GB at 20
  concurrent scans (the 10/min limiter is per-IP and per-instance, `route.ts:63`). [INFERENCE] on
  undici's exact overhead; the three full copies follow from `Buffer.from(arrayBuffer)` and Blob
  construction semantics.
- **Impact:** on a 512 MB serverless function or a small VPS, two or three concurrent scans from
  different IPs OOM the process (killing in-flight orders for other users on the same instance);
  memory is held for the entire provider round-trip, i.e. up to the platform timeout (OCR-06).
- **Fix:** stream the multipart body (`req.body` + a multipart parser writing each part to a temp
  file, or check `f.size` while iterating) instead of `req.formData()`, pass a `ReadableStream`/file
  handle to the upload instead of a `Buffer` + `Blob` copy, and delete the temp file in a `finally`.

### OCR-08 · Medium · uploaded documents are never deleted · VERIFIED
- **Evidence:** `menu-scan.ts:166-180` calls `POST /v1/files` once per file; there is no
  `DELETE /v1/files/{id}` anywhere in `src/` (`grep -rn "v1/files"` returns only `:175-176`), and the
  returned `file_id` is dropped after `runMenuScan` returns (`:452-458`).
- **Impact:** every scan permanently retains the owner's menu photographs in Mistral's storage —
  unbounded growth against the account's file quota, and a data-retention exposure for images that
  may capture staff, customers or the venue. There is also no cleanup path if the process dies
  mid-scan.
- **Fix:** `finally { await fetch(`${MISTRAL_BASE}/v1/files/${fileId}`, { method: "DELETE", headers:{Authorization: \`Bearer ${key}\`} }) }`
  after the document's OCR outcome is produced (best-effort, never failing the scan).

### OCR-09 · Medium · merge silently skips colliding rows · VERIFIED
- **Evidence:** `menu-import.ts:337-342` — a name collision inside an existing category hits
  `continue`, discarding the scanned price and description. Executed: manual `{Espresso@Boissons, 9}`
  + scan `{espresso@Boissons, 3}` → **1 product, price 9**; manual `{Espresso@c1}` + scan
  `{Espresso@Chauds}` → **2 products**. `dialog.tsx:119-122` then closes the dialog with no report of
  what was skipped.
- **Impact:** the owner hand-corrects a price after a bad scan, re-scans, and the UI says the import
  succeeded while those rows were dropped — half-applied state with a success signal. The owner has
  no way to tell which rows came from the scan.
- **Fix:** return per-row outcomes from `mergeMenuImport` (added / reused / skipped) and show them in
  the review step; optionally refresh `price`/`description` for a colliding row that is still
  scan-identical (not hand-edited). At minimum, surface "N items already existed and were kept".

### OCR-10 · Medium · review step hides rows it is about to import · VERIFIED
- **Evidence:** `menu-scan-dialog.tsx:238` — `if (bucket.length < 8) bucket.push(p)` caps each
  category at 8 listed items while `:248` prints the true totals via `ms_reviewCount`; there is no
  "+N more" affordance and no per-item removal (`:251-268`), and Apply imports everything (`:216-218`).
- **Impact:** the owner reviews a 40-item scan, sees 8 rows per section, and imports the rest unseen.
  The wrong-price/wrong-name rows produced by OCR-02, OCR-03, OCR-04 and OCR-18 are beyond the fold —
  this is the last gate before a live menu and it is partially blind.
- **Fix:** render the true per-category count, add an explicit "+N more" row (or a scroll-only cap
  with no silent drop), and show a warning banner when the result contains prices of 0 or names that
  look like OCR rows (e.g. starting with `|` or containing a trailing currency symbol).

### OCR-11 · Medium · HEIC/HEIF accepted then fails to decode · VERIFIED (code) / INFERENCE (browser)
- **Evidence:** the picker accepts `image/heic,image/heif` (`menu-scan-dialog.tsx:19`) but
  `PASSTHROUGH_MIME` excludes them (`image-utils.ts:41`), so `prepareUploadFile` takes the canvas path
  (`:61-76`) and `loadImage` (`:4-11`) relies on the browser decoding the format in an `<img>`.
  Chromium/Edge on Windows cannot decode HEIC → `img.onerror` → `prepareUploadFile` rejects →
  the generic catch at `menu-scan-dialog.tsx:113-116` shows `ms_error_generic`. [INFERENCE] iOS
  Safari normally transcodes library photos to JPEG, so the failure is platform-dependent.
- **Impact:** on Windows/Android Chrome, picking an iPhone HEIC photo is a dead end: a generic error,
  the file stays in the list, and retrying re-fails — while the product's own picker advertised the
  format as supported.
- **Fix:** drop `image/heic,image/heif` from `ACCEPT`, or catch the decode failure and either upload
  the original bytes unchanged (Mistral accepts many image formats) or show a specific message
  ("HEIC photos can't be prepared — export as JPEG").

### OCR-12 · Medium · items before the first heading are discarded · VERIFIED
- **Evidence:** `menu-scan.ts:383` initialises `sink` to a detached array; `:390-396` replaces `sink`
  with the new category's array on the first heading, orphaning everything pushed into it. The
  recovery at `:420-422` only fires when the document has **no** heading at all. Executed:
  `Café 2\n## Boissons\nThé 3` → `[{Boissons:[Thé]}]` — Café is gone, with no log line.
- **Impact:** on a two-column menu, or a photo whose top line is a "Plat du jour" before the first
  section heading, that item is silently dropped from the import — a missing product with no signal
  anywhere in the logs or the UI.
- **Fix:** keep the pre-heading bucket and flush it into the first created category (or into the
  `Menu` catch-all) at `:393-395`.

### OCR-13 · Medium · truncation detection only catches one shape · VERIFIED
- **Evidence:** `ocr-quality.ts:47,62,76-79` — `endsOnHeading` is set only by heading lines and
  cleared only by item lines, and `TRUNCATED` requires `endsOnHeading` on the final non-noise line.
  Executed: `## Boissons\nCafé 2\nThé 2\nJus` (a 3-line fragment) → `ok=true`; a noise line after a
  heading does not clear the flag (`:54-59` `continue` before the reset). There is no comparison
  between OCR item count and annotation item count, and `usage_info` is discarded (`menu-scan.ts:255-258`).
- **Impact:** the 20-page cap (`MAX_PAGES_PER_FILE`, `:62`, `pages:"0-${19}"` at `:263`) or a cut-off
  page produces a fragment that passes every gate and is imported as the complete menu — the owner
  publishes a menu missing items and nothing in the pipeline ever said so.
- **Fix:** after both structure phases run, compare `parser.products.length` with the annotation's
  item count and raise a "read fewer items than the document appears to contain" warning through
  `MenuImportResult.stats` (or a new `warnings` field the review step renders); make TRUNCATED a
  re-run trigger rather than the only truncation signal.

### OCR-14 · Low · `sanitizePrice` mishandles `$` and non-ASCII digits · VERIFIED
- **Evidence:** `menu-import.ts:84-86` strips `DT|TND|TD|EUR|USD|US$|€|د.ت|ت` — `US$` is listed but a
  bare `$` is not, and no Arabic-Indic normalisation exists. Executed: `sanitizePrice("$12.50")` → **0**,
  `sanitizePrice("US$12")` → 12, `sanitizePrice("١٢٫٥")` → **0**, `sanitizePrice("1 200")` → **1200**
  (spaces stripped) — i.e. the same string the parser reads as 200 becomes 1200 here.
- **Impact:** whenever the annotation is missing or fails to parse (OCR-15) the string path is the
  only one left; `$`-prefixed prices then silently become 0 (free items), and the parser/sanitizer
  disagreement on space-separated prices makes the import price depend on which stage happened to see
  the value.
- **Fix:** add `\$` to the alternation, normalise Arabic-Indic digits/decimal separators, and share
  one price-normalisation routine between `extractPriceToNumber` and `sanitizePrice` so the two can
  never disagree.

### OCR-15 · Low · `document_annotation` assumed to be a JSON string · VERIFIED (code) / INFERENCE (provider)
- **Evidence:** `menu-scan.ts:244,257,487` type the field as `string|null` and call `JSON.parse(a)`
  unconditionally; Mistral's OCR response reference documents the field as
  `document_annotation: dict|null` ("Document annotation information when used",
  https://docs.mistral.ai/studio/document-processing/basic_ocr). If the provider returns the object,
  `JSON.parse("[object Object]")` throws, the catch at `:493-495` only logs
  `STRUCTURE JSON PARSE FAIL`, and the entire AI extraction is discarded — the scan continues with the
  parser baseline and no client-visible difference. (The same catch also silently swallows a genuine
  malformed-JSON case, and the sibling log at `:491` is mislabelled "INVALID JSON" for a merely
  missing `categories` array.)
- **Impact:** if the provider's shape differs, the flagship "AI structure" path silently never runs in
  production while every log looks healthy; quality silently degrades to the regex parser (which is
  where OCR-02/03/04 bite).
- **Fix:** `const parsed = typeof a === "string" ? JSON.parse(a) : (a as unknown);` and log
  `typeof a` in the failure branch so a shape change is diagnosable from logs.

### OCR-16 · Low · provider auth failures are reported as a configuration error · VERIFIED
- **Evidence:** `menu-scan.ts:150-155` maps **401 and 403** to `NO_KEY`; `route.ts:32` maps `NO_KEY`
  to HTTP 503; `menu-scan-dialog.tsx:23` maps `NO_KEY` to `ms_error_NO_KEY` ("the reading service is
  not configured").
- **Impact:** an expired, revoked, or plan-limited key (`403`) tells the owner the feature is
  unconfigured — the wrong remediation, and it hides a real operational incident from whoever reads
  the error.
- **Fix:** introduce a distinct code (e.g. `PROVIDER_AUTH`) for 401/403 with its own message, and keep
  `NO_KEY` for the missing-env case only.

### OCR-17 · Low · `isJunkHeading` drops real headings · VERIFIED
- **Evidence:** `menu-scan.ts:351-357` — `v.startsWith(target)` compares against the lowercased venue
  name with **no word boundary**, and the generic list is deleted outright
  (`/^(menu|carte|drinks?|food|beverages?)$/i`). Executed: with venue `"Le"`, the heading
  `Legumes Grilles` is dropped (its items fall into the catch-all "Menu"); with `## Drinks` + `## Food`
  both headings are dropped and all items collapse into one `Menu` category.
- **Impact:** dishes land in a section literally named `Menu` (or in the previous section) instead of
  their printed heading — the category name is what the guest sees as the section header on the QR
  menu, so the imported menu is misleading even when every dish and price is right.
- **Fix:** require a boundary (`new RegExp(`^${escapeRegex(target)}(\\s|$)`)`) and reduce the generic
  drop list to the exact venue-level cases (or remove it — a menu section really can be called "Food").

### OCR-18 · Low · orphan price lines are discarded · VERIFIED
- **Evidence:** `menu-scan.ts:398-404` — a standalone price line is only applied when a previous item
  exists **and** its price is 0; otherwise `continue` drops it with no counter. Executed:
  `## Boissons\n2.500\nCafé` → `Café` price **0**, the `2.500` line gone. The same applies to a
  two-price item (`Café 2` / `4.500`), where the second price is silently discarded.
- **Impact:** a section-heading-plus-price layout ("Menu du jour\n12.500") loses the price, and the
  item imports as free with no visible error.
- **Fix:** buffer an orphan price for one line and apply it to the next item whose price is still 0
  (the layout OCR most often means), and count skipped prices in a debug log instead of dropping them
  silently.

---

## Verified-working

- **Route guard ordering is correct**: `supabaseAdmin` → owner session **before** the body is read →
  per-IP rate limit with `Retry-After` → `NO_KEY` 503 **before** `formData()` → `Content-Length` 413 →
  `BAD_BODY` 400 → `TOO_MANY_FILES` 400 → per-file 413 → typed `MenuScanError` → `STATUS` map
  (`route.ts:45-146`). Unauthenticated callers cause zero provider spend and zero rate-limit
  consumption.
- **`apiKey()` is called outside the retry loop** (`menu-scan.ts:99-102`), so a missing key never
  becomes a 24 s `NETWORK` failure; retries are sequential bounded awaits, so no retry storm is
  possible even under concurrency.
- **The `json_schema` is exactly the shape the official Mistral SDK emits** (`name`/`schema`/`strict`
  inside `json_schema`), with `additionalProperties:false` on every object and full `required` lists —
  well-formed for strict structured output.
- **Every field the builder reads from the annotation is schema-guaranteed**, and the sanitizers are
  defensive regardless (`normalizeName`→`""`, `sanitizePrice`→`0` for non-strings).
- **No input produces a duplicate category, a duplicate product, a product without a category, or a
  `NaN`/negative/undefined price, or an empty name.** Verified by executing a hostile fixture through
  `sanitizeImport`/`buildMenuImport`; only lossless-filter rules apply (`menu-import.ts:216-246`).
- **Determinism**: `parseOcrMarkdown`, `buildMenuImport` and `reconcileImports` produce byte-identical
  output for identical input (executed twice each); iteration is insertion-ordered throughout the
  module. `mergeMenuImport` is idempotent for a repeated identical result (executed).
- **Price coercion for the canonical Tunisian forms is correct**: `4.500 → 4.5`, `16,500 DT → 16.5`,
  `12,5 → 12.5`, `12 DT → 12`, `4.500 € → 4.5`, `6.5€ → 6.5`, `3 E → 3` (all executed).
- **Price-conflict resolution is sound for the single-slot case**: a malformed AI price cannot
  overwrite a valid parser price, and two valid-but-different prices resolve deterministically to the
  literal OCR read (`menu-import.ts:538-547`, unit-tested at `menu-import.test.ts:514-526`).
- **OCR artifacts are filtered** including the pipeline's own separators: `[tbl-0.md](tbl-0.md)`,
  `<!-- page N -->`, `=====`, phone/email/URL lines, pure price lines (executed + unit tests
  `menu-import.test.ts:57-74`).
- **Multi-document scans dedupe correctly**: annotations and parser categories from all documents are
  concatenated and merged by normalized name (`menu-scan.ts:467-470,479-500`).
- **Client hygiene**: object URLs for previews are revoked (`menu-scan-dialog.tsx:60-63`), duplicate
  picks are filtered by `name-size` (`:75-84`), passthrough files keep their real filename and bytes
  (`:95-98`), and only oversized/foreign-format images are re-encoded (`image-utils.ts:61-63`,
  matching the file's own rationale about destroying legibility).
- **The 2048px/0.9 JPEG path preserves originals that already fit** — the destructive
  downscale-everything behaviour the comment warns about is genuinely avoided.

---

## Coverage (item 7)

`menu-import.test.ts` (58 tests) and `ocr-quality.test.ts` (14 tests) are real, non-trivial tests;
`npm run test` was not run (per the audit rules) and the 124-green claim is prior art.

| Behaviour from this report | Covered? | Where |
|---|---|---|
| `sanitizePrice` canonical forms + NaN/negative/undefined | ✅ unit | `menu-import.test.ts:43-53` |
| `$`/Arabic-Indic/space-separated price forms | ❌ **assumed** | — (OCR-02/03/14) |
| `isOcrArtifact` (links, phones, prices, legit names) | ✅ unit | `:57-74` |
| `sanitizeImport` dedupe / uncategorized / price coercion | ✅ unit | `:78-174` |
| `mergeMenuImport` merge/reuse/dedupe/step-independence | ✅ unit | `:195-352` |
| `mergeMenuImport` collision-with-manual-row semantics | ❌ assumed | — (OCR-09) |
| `reconcileImports` basic merge, descriptions, price conflicts | ✅ unit | `:425-599` |
| `reconcileImports` `final >= max(ai, parser)` invariant | ❌ **not tested, and false** | — (OCR-01) |
| Gate: small structured menu passes; empty/no-items/truncated reject | ✅ unit | `ocr-quality.test.ts:7-104` |
| Gate: 3-item headingless menu rejected | ✅ unit — **asserts the wrong behaviour** | `:52-58` (OCR-05) |
| Gate: bold/`####`/`#NoSpace` headings | ❌ assumed | — (OCR-05) |
| Gate: ad panel / single junk line wrongly accepted | ❌ assumed | — (OCR-13/§5) |
| `parseOcrMarkdown` — **the whole deterministic parser** | ❌ **zero tests** | no test imports `menu-scan.ts` (verified by grep + `ls src/lib/*.test.ts`) |
| Table-row markdown → product-with-row-name | ❌ assumed | — (OCR-04) |
| `document_annotation` string-vs-object handling | ❌ assumed | — (OCR-15) |
| Route guard ordering / status mapping | ❌ no route-level test (prior art verified live) | — |

**Highest-value missing test:** a `src/lib/menu-scan.test.ts` covering `parseOcrMarkdown` — it is the
*documented safety baseline for every scan* (`menu-scan.ts:474-477`) and currently has no test at all.
It should contain, at minimum, one case per row of the price truth table in §4 (including
`Couscous 1 200` → **not** 200, `€12`/`$12.50`/`١٢٫٥`, and the orphan-price line), one table-row case,
one pre-heading-item case, and an assertion that
`reconcileImports(ai, parser).products.length >= max(ai.products.length, parser.products.length)`.
Second-highest: flip `ocr-quality.test.ts:52-58` to assert that a headingless 3-item menu is
*accepted* (or accepted after retry) and that bold/`####` headings count as headings.

---

## Open questions

1. **`document_annotation` wire type** — string or object? Cannot be settled without a live call
   (OCR-15). The fix is cheap either way; the risk is silent degradation if it is an object.
2. **Is `strict: true` enforced by the OCR annotator**, or advisory? If advisory, the "no field can be
   missing" conclusion in §3 rests solely on the sanitizers' coercion.
3. **`page.tables` content shape** for `table_format:"markdown"` — needed to choose between the two
   OCR-04 fixes.
4. **Detectability of the 20-page cap** (`MAX_PAGES_PER_FILE`) — does `usage_info` report total pages?
   If not, truncation is undetectable and can only be mitigated by UI warning (OCR-13).
5. **`menu-scan.ts:502-504` (`EMPTY` when `markdown` is blank) is unreachable**: every page
   contributes a `<!-- page N -->` marker (`:273`), so a document with pages always has non-blank
   markdown, and a document with no pages is already rejected at `:283-285` or by `EMPTY_TEXT`. Its
   mirror case — `pages.length === 0` **with** a valid annotation — is thrown away by the gate as
   `EMPTY_TEXT` after 3 attempts instead of using the annotation. Is that intended?
6. **Partial-scan policy**: one unreadable page among six currently fails the entire scan
   (`:464-466` throws per document). Is "all or nothing" the product intent, or should readable
   documents be imported with a warning? No UI or state supports partial import today.
7. **Cost ceiling**: a degraded document costs 3 OCR calls plus up to 6 upload attempts; with the
   per-instance in-memory rate limiter (prior art, `route.ts:63`), what is the intended monthly
   provider-spend ceiling, and is anything enforcing it?
