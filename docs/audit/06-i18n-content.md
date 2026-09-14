# i18n / Content Audit

## Verdict

The translation **tables** are in unusually good shape: `src/lib/i18n.tsx` holds 530 keys, and EN / FR / AR have byte-for-byte the same key set — 0 keys missing, 0 empty strings, 0 untranslated placeholder leakage. What is broken is everything around the tables: the **lookup never falls back to EN** (it returns the raw key), so the one key that is referenced but never defined (`prv_menuItemsSub`) is rendered literally to the owner; locale is read from `localStorage` only, so a phone with an `ar-TN` locale gets English and LTR on first paint and `dir="rtl"` is only applied after hydration by a `useEffect`; and the entire auth flow (login / signup / forgot / reset) plus the onboarding step headers are hard-coded English inside a product that ships FR and AR. Currency handling contradicts the README: the guest menu is **not** dinars-only — it renders the same DT/$/€ switcher as the landing page and converts every price with a hard-coded rate table.

Blocked by nothing (the findings are all source-level, verified by reading); this slice is a correctness/content gap, not an infrastructure one.

## Required behaviour

Derived from `README.md` + the code's own intent (`i18n.tsx` tables, `prv_sim3`, `spl_priceLabel`):

1. **Locale**: EN / FR / AR are first-class. A guest or owner on a device whose locale is `ar-*` should get the Arabic UI (`dir="rtl"`, `lang="ar"`) without having to hunt for a switcher, and the choice should persist. Because every DB read is server-side (API routes + `supabaseAdmin`), the server never knows the locale today — direction/language must be resolved server-side (cookie) or accepted as a client-side progressive enhancement with a stated first-paint cost.
2. **Key hygiene**: any key passed to `t()` must exist in all three locales, or the user sees a raw key / English in an AR screen. Missing keys must be detectable, not silent.
3. **Currency**: README:10 states "all prices are shown in dinars on the guest menu; the public landing page switches English / French / Arabic and $ / €". Prices are stored in TND (`spl_priceLabel` = `Price (DT) *`, `spp_dlgAddDesc` = "Prices are stored as Tunisian Dinars (DT)"), the OCR prompt reads TND (`ms_hint`), and `restaurants.currency` exists in the schema. Therefore: the guest menu must show DT only; the landing demo may switch; a restaurant's stored currency must be respected if it is exposed at all.
4. **RTL**: Arabic UI must be laid out RTL. Tailwind v4 is installed (package.json:41 `tailwindcss: ^4.0.14`; resolved 4.3.3), where `pl/pr/ml/mr/left/right/text-left` compile to **physical** CSS (`padding-left`, `margin-left`, `text-align: left`, …) while `ps/pe/ms/me/start/end/text-start` are logical. Physical utilities are the ones that break.
5. **OCR errors**: README §6 (README.md:233-246) documents 9 `ScanErrorCode`s, each with a `ms_error_*` key, mapped by `ERROR_MSG_KEY`. Every code the API can return must have a user-facing message.

## Findings

### I18N-01 · High · Currency (guest menu) · VERIFIED

- Evidence: `README.md:10` claims the guest menu is always dinars. But `src/components/guest-menu.tsx:201` renders `<LangCurSwitcher />`, and `src/components/lang-cur-switcher.tsx:29-41` renders all three currencies (`APP_CURRENCIES`, `src/lib/i18n.tsx:20-24` = TND/USD/EUR). Every guest price goes through `formatPrice` — `src/components/guest-menu.tsx:451, 498, 544, 576, 602, 623, 649` — and `src/lib/i18n.tsx:1872-1876` multiplies the stored amount by `RATES` (`src/lib/i18n.tsx:1797-1801`: `tnd: 1, usd: 0.31, eur: 0.29`). Meanwhile the order total sent to the kitchen is the unconverted TND amount (`src/app/api/orders/route.ts:171-181` computes it from `products.price`, stored at `:268`).
- Impact: a guest who taps `$` on their table sees a coffee listed at `$1.40` while the kitchen receives 4.500 TND and the owner's own card shows whatever currency *their* device last selected (same `localStorage` key `sufra.cur`, `src/lib/i18n.tsx:1817`). The switcher's `$`/`€`/`DT` buttons carry no label, and the choice is per-device, not per-restaurant — two phones at the same table can legitimately show two different currencies for the same dish.
- Fix: the exact inconsistency to remove is `LangCurSwitcher` on the guest path. Render language-only buttons in `GuestMenu` (e.g. `<LangCurSwitcher showCurrency={false} />`, or a `LangSwitcher`), and keep `formatPrice` in DT for `cur === "tnd"`. If currency switching must stay, drive it from `restaurants.currency` (see I18N-14) and label the conversion.

### I18N-02 · High · Locale default & persistence · VERIFIED

- Evidence: `src/lib/i18n.tsx:1819-1821` — `parseLang` returns `"en"` unless the stored value is exactly `"fr"`/`"ar"`; there is **no** `navigator.language` / `Accept-Language` detection anywhere in `src/`. `src/lib/i18n.tsx:1816-1817` stores the choice in `localStorage` (`sufra.lang`), read in the `useState` initialiser at `:1828-1831`, which returns `"en"` when `typeof window === "undefined"` — i.e. always on the server. `src/app/layout.tsx:19` hard-codes `<html lang="en" …>` with no `dir`.
- Impact: **a phone with an `ar-TN` locale gets the English UI, LTR, on first paint** and stays English until the user finds the `AR` pill inside `LangCurSwitcher` (`lang-cur-switcher.tsx:15-27`, labels `EN/FR/AR`, not `العربية/Français`). Every AR/FR visitor also gets a flash of English + a layout flip when the effect lands. `lang="en"` is served to Arabic readers (screen readers, browser translate prompts).
- Fix: on first visit, fall back to `navigator.languages` (`ar*` → `ar`, `fr*` → `fr`) when `sufra.lang` is absent; persist in a cookie (`sufra.lang`) *in addition* to localStorage and resolve it in the root layout so `<html lang dir>` is correct in the server HTML. Keep the explicit switcher as the override.

### I18N-03 · High · RTL — `dir` is never server-rendered · VERIFIED

- Evidence: the only writers of `dir` are `src/lib/i18n.tsx:1843-1844` (`document.documentElement.lang/dir`, inside `useEffect`) and the landing wrapper `src/app/page.tsx:350` (`dir={isAr ? "rtl" : "ltr"}`). `src/app/layout.tsx:19` emits no `dir` attribute. `src/app/globals.css:197-200` keys the Arabic heading font off `[dir="rtl"]`.
- Impact: on the guest menu, the onboarding wizard, both dashboards and the auth pages, the rendered direction is LTR until hydration; `[dir="rtl"] .font-serif` (globals.css:197) cannot match before then, so Arabic headings render in Playfair Display italic for the first frames. On the guest path (`/menu/[slug]/[token]`) there is no wrapper-level `dir` fallback at all — the landing page has one, the actual product surface does not.
- Fix: see I18N-02 (cookie + `dir` in the root layout HTML). As a minimum stop-gap, mirror the landing's pattern (`dir={isAr ? "rtl" : "ltr"}`) on a wrapper inside `GuestMenu`.

### I18N-04 · High · RTL breakage — guest menu · VERIFIED

- Evidence (all are physical-property utilities in Tailwind v4):

| file:line | class | Why it breaks in AR |
|---|---|---|
| `src/components/guest-menu.tsx:291` | `absolute left-3.5 …` | Search icon pinned to the physical left. |
| `src/components/guest-menu.tsx:298` | `pl-10 pr-4` | Input text starts at the right (RTL) with only `1rem` padding, while the `2.5rem` padding is on the far side → icon orphaned, text tight against the edge. |
| `src/components/guest-menu.tsx:583` | `<ArrowLeft>` on "Back to menu" | Arrow points left while "back" is to the right; the landing page already applies the fix (`src/app/page.tsx:172` `isAr && "rotate-180"`) and the guest menu does not. |
| `src/components/ui/dialog.tsx:53` | `sm:text-left` | Cart dialog (`guest-menu.tsx:610-615`) and order-confirm dialog titles stay left-aligned in Arabic. |
| `src/components/ui/dialog.tsx:43` | `absolute right-4 top-4` | Close button stays top-right in Arabic (Radix convention is top-left in RTL). |

- Fix: `left-3.5` → `start-3.5`; `pl-10 pr-4` → `ps-10 pe-4`; add `rotate-180` to the back arrow when `isAr`; `sm:text-left` → `sm:text-start`; `right-4` → `end-4`.

### I18N-05 · High · Missing key renders a raw string to the owner · VERIFIED

- Evidence: `src/components/onboarding/step-preview.tsx:81` calls `t("prv_menuItemsSub")`; that key exists in **none** of the three locales (the EN key list is `i18n.tsx:27-629`; the nearest keys are `prv_menuItems`, `i18n.tsx:568`, and `prv_sim*`). `t()` returns the key itself on a miss — `src/lib/i18n.tsx:1858` (`if (val === undefined) return key;`) — and the value is unconditionally rendered at `src/components/onboarding/step-preview.tsx:163` (`<span …>{item.secondary}</span>`).
- Impact: Step 5 of the onboarding wizard always shows the literal text **`prv_menuItemsSub`** under "6 Menu Items" — in EN, FR and AR alike, on the final step of the first-run flow, immediately before the owner is asked to finish setup.
- Fix: add `prv_menuItemsSub` to all three locales (EN "Add products in Step 4 to populate your menu" — cf. the equivalent guest key `g_addStep4`, `i18n.tsx:114`), or delete the `secondary` line. Also add a test that asserts every key **used** in `src/**` exists in the table (see Open questions).

### I18N-06 · High · Onboarding headers hard-coded English (keys exist) · VERIFIED

- Evidence: `src/components/onboarding/step-preview.tsx:92, 95, 98` are raw JSX text — `Step 05 · Live Preview`, `Ready for the spotlight`, `This is exactly what your customers will see when they scan a QR code at the table.` — and the matching keys already exist in all three locales but are **referenced nowhere** in `src/`: `prv_eyebrow`, `prv_title`, `prv_desc` (`i18n.tsx:558-560` EN, `:1143-1145` FR, `:1724-1726` AR). The four earlier steps hard-code their eyebrow as a default prop: `step-business.tsx:34` (`?? "Step 01 · Identity"`), `step-branding.tsx:47` (`Step 02 · Aesthetics`), `step-categories.tsx:85` (`Step 03 · Categories`), `step-products.tsx:180` (`Step 04 · Products`) — and the wizard never overrides them (`src/app/onboarding/page.tsx:76-79` passes no `headingEyebrow`, unlike the dashboard editor which passes `t("me_eyebrowId")` etc. at `src/app/(owner)/dashboard/menu/page.tsx:103-106`).
- Impact: a French or Arabic café owner building their first menu sees five English section headers, and step 5's headline/description in English.
- Fix: replace the three literals in `step-preview.tsx` with `t("prv_eyebrow")`/`t("prv_title")`/`t("prv_desc")` (keys already translated); add `ob_eyebrow1..4` keys and pass them from `onboarding/page.tsx`, or reuse the existing `ob_stp1t..4t` values.

### I18N-07 · High · Auth surfaces are English-only · VERIFIED

- Evidence: `src/components/auth-form.tsx` has no `useI18n` import; all user text is literal — `:60` `Welcome back` / `Create your account`, `:64-65`, `:72` `Name`, `:77` `Your name`, `:85` `Email`, `:99` `Password`, `:107` `At least 8 characters`, `:121` `Sign in`/`Create account`, `:126` `Forgot password?`, `:136-138` `First time? Create an account`. `src/components/forgot-form.tsx:42, 45-46, 53, 60, 67, 75` likewise. `src/app/auth/reset/page.tsx:125, 144, 150, 152, 155, 162, 164, 169, 184, 200, 217` likewise (`Invalid link`, `Set a new password`, `Loading…`). Metadata is static English too (`src/app/auth/login/page.tsx:5`, `signup/page.tsx:5`, `forgot/page.tsx:5`). No language switcher is rendered on any auth page.
- Impact: the only entry point for an existing owner is unlocalized in a 3-locale product; and because `dir` is set globally (`src/lib/i18n.tsx:1844`), an owner whose device is Arabic gets this English form **mirrored RTL** (labels are `text-[10px] … font-mono` with no explicit alignment, so they inherit `text-align: start` = right), and text typed into the inputs is right-aligned.
- Fix: localize the four auth screens with new `au_*` keys via the existing provider (they are already inside `Providers`, `src/app/layout.tsx:31`), and add the switcher — or, if scope must stay minimal, pin `dir="ltr"` on the auth layout so at least the English layout is not mirrored.

### I18N-08 · Medium · Worker terminal shows the wrong role · VERIFIED

- Evidence: `src/components/dashboard/worker-shell.tsx:75` renders `{t("wk_cashier")}` unconditionally ("Cashier · Server" / "Caissier · Serveur" / "كاشير · نادل") although `workerSession` is in scope at `:12` and its `role` is available (`:31`). The role *is* used for behaviour elsewhere — `src/app/(worker)/worker/dashboard/page.tsx:95` (`workerSession?.role === "Manager"` gates the mark-paid button).
- Impact: a Manager logged into their own terminal is told they are a cashier, in every locale.
- Fix: `t(workerSession?.role === "Manager" ? "wk_manager" : "wk_cashier")` (add the `wk_manager` key; `inv_roleManager`/`inv_roleCashier` already exist and can be reused).

### I18N-09 · Medium · Role names untranslated in the invite UI · VERIFIED

- Evidence: `src/components/dashboard/invite-dialog.tsx:130-131` — `<SelectItem value="Cashier">Cashier</SelectItem>` / `Manager` (raw literals); `:158` `t("inv_readyDesc", { role })` and `:187` `t("inv_expires24Short", { role })` interpolate the raw `WorkerRole` into translated sentences; `:164` `alt={\`${role} invite QR\`}`. Same interpolation at `src/app/(worker)/worker/invite/[token]/page.tsx:162` (`inv_welcomeToastDesc`) and `:213` (`inv_ready`), and `src/app/(owner)/dashboard/workers/page.tsx:131` (`t("wk_inviteFor", { role: invite.role })`). Meanwhile the accept page *does* translate roles: `invite/[token]/page.tsx:248-250` (`role === "Manager" ? t("inv_roleManager") : t("inv_roleCashier")`).
- Impact: Arabic/French sentences read "دعوة Manager" / "Manager · ينتهي خلال 24 ساعة"; the invite dialog's role picker is English in an otherwise translated dashboard.
- Fix: map `WorkerRole` → `t("inv_roleManager")`/`t("inv_roleCashier")` at every interpolation site and in the `SelectItem` labels (keep the English `value` — it is the wire format).

### I18N-10 · Medium · Hard-coded English timestamps stored as data · VERIFIED

- Evidence: `src/lib/onboarding-store.tsx:487` `createdAt: "Just now"`, `:488` `expiresAt: "In 24 hours"`, `:517` `joinedAt: "Just now"`. Rendered at `src/app/(owner)/dashboard/workers/page.tsx:133` (`{invite.token} · {invite.createdAt}`) and read back at `src/app/(worker)/worker/invite/[token]/page.tsx:111` (`storeInvite?.expiresAt ?? t("inv_expires24")`) — so the localized fallback is shadowed by the English literal.
- Impact: worker dashboards in FR/AR show "Just now"; the local invite page shows "In 24 hours" instead of `t("inv_expires24")` ("Dans 24 heures" / "خلال 24 ساعة").
- Fix: store a real ISO timestamp (or nothing) and format with `t()`/`Intl.RelativeTimeFormat` at render time.

### I18N-11 · Medium · Scan error codes with no message · VERIFIED

- Evidence: `ERROR_MSG_KEY` (`src/components/onboarding/menu-scan-dialog.tsx:22-32`) covers all 9 `ScanErrorCode`s (`src/lib/menu-scan.ts:40-49`) — but the route returns codes outside that union: `src/app/api/menu/scan/route.ts:48` `NO_BACKEND`, `:57` `UNAUTHORIZED`, `:93` `BAD_BODY`, `:143` `UNKNOWN`. `:108` falls back to `ERROR_MSG_KEY[data.error] ?? "ms_error_generic"`. The `STATUS` map also declares two codes that are never produced or typed (`route.ts:40-41` `INVALID_MODEL_RESPONSE`, `INVALID_JSON`; not in `ScanErrorCode`).
- Impact: an owner whose session expires mid-scan gets "Something went wrong while scanning. Please try again." (`ms_error_generic`, `i18n.tsx:379`) — retrying can never succeed and they are never told to sign in. The codebase already has the right pattern: `src/components/dashboard/invite-dialog.tsx:74` maps 401 to `t("inv_needLogin")`.
- Fix: map `UNAUTHORIZED`/`NO_BACKEND` to dedicated keys (add `ms_error_UNAUTHORIZED`, `ms_error_NO_BACKEND` in all three locales), keep `ms_error_generic` for `BAD_BODY`/`UNKNOWN`, and delete the two dead `STATUS` entries.

### I18N-12 · Medium · RTL breakage — dashboards & wizard · VERIFIED

Every occurrence of a physical-property utility that produces a visible left/right bias in Arabic (scanned from `src/**/*.tsx`):

| file:line | What | Effect in AR |
|---|---|---|
| `src/components/dashboard/worker-new-order.tsx:192` | `text-left` (item buttons) | Product names pinned left while the row mirrors. |
| `src/components/dashboard/worker-new-order.tsx:260` | `text-right` (line total) | Total pinned right, away from its label. |
| `src/components/dashboard/order-card.tsx:52` | `mr-2` (qty×) | Gap on the wrong side of the quantity. |
| `src/components/dashboard/worker-shell.tsx:71` | `pl-1 pr-3` (role pill) | Asymmetric padding flips → badge text touches the icon. |
| `src/components/dashboard/owner-shell.tsx:61` | `ml-auto` (active-page dot) | Dot lands on the wrong edge of the nav item. |
| `src/components/dashboard/owner-shell.tsx:81` / `:122` | `left-0 border-r` + `lg:pl-60` | Sidebar stays physically left and the content offset stays physical: consistent today, but any later switch to `ps-*`/`end-*` will desynchronise them. |
| `src/components/dashboard/stat-card.tsx:24` | `-right-8` | Decorative glow (`aria-hidden`) — cosmetic only. |
| `src/app/(owner)/dashboard/orders/page.tsx:70` | `ml-1.5` (filter count) | Count gap on the wrong side of the label. |
| `src/app/(owner)/dashboard/orders/page.tsx:75` | `ml-auto` (`OrderStatusPill`) | Pill pinned to the wrong edge of the filter row. |
| `src/app/(owner)/dashboard/page.tsx:115`, `src/components/dashboard/orders-status-pill.tsx:9,11` | `<ArrowRight>` | LTR arrows in AR (the landing already rotates them, `src/app/page.tsx:172`). |
| `src/app/onboarding/page.tsx:86` | `ml-auto` (Back button, step 1) | Button lands on the wrong side. |
| `src/app/onboarding/page.tsx:89,101` | `<ArrowLeft>` / `<ArrowRight>` | Wizard nav arrows not mirrored. |
| `src/components/onboarding/step-preview.tsx:191,199` | `<ArrowLeft>` / `<ArrowRight>` | Same, on the final step. |
| `src/components/onboarding/stepper.tsx:89` | `text-left` (step rows) | Step titles left-aligned in AR. |
| `src/components/onboarding/step-branding.tsx:45,81,151`, `step-business.tsx:32`, `step-categories.tsx:83`, `step-products.tsx:178`, `step-preview.tsx:86` | `text-left` (step containers) | Whole wizard body left-aligned in AR. |
| `src/components/image-dropzone.tsx:88` | `text-left` (uploader) | Uploader copy left-aligned in AR. |
| `src/components/onboarding/navbar.tsx:36` | `ml-4 border-l pl-4` | Separator rule drawn on the wrong side of "Partner Portal". |
| `src/components/ui/select.tsx:67,72` | `pl-2 pr-8` + `absolute right-2` chevron | Select chevron on the far side from the text start (`invite-dialog.tsx:126` role picker, `step-business.tsx` business type, `step-products.tsx` category). |
| `src/components/phone-mockup.tsx:139,175,207,242,249` | `right-3`, `mr-1`, `left-3`, `pl-8 pr-3` | Same search/position bugs inside the phone preview shown on the landing page, the wizard and the owner menu editor. |

Not breaks (checked and explicitly ruled out): `flex-row`/`sm:flex-row` (`dialog.tsx:57`, `page-header.tsx:12`, `settings/page.tsx:46`, `step-heading.tsx:13`, …) mirrors automatically with the writing direction; `space-x-2` (`ui/dialog.tsx:57`) compiles to `margin-inline-start` in Tailwind v4 (verified in the installed compiler, `node_modules/tailwindcss/dist/lib.js`), so it is RTL-safe; `rounded-lg` etc. are not logical-side utilities; `left-1/2 -translate-x-1/2` (`ui/dialog.tsx:37`) is symmetric.

- Fix: mechanically replace `pl/pr/ml/mr/left/right/text-left/text-right` with `ps/pe/ms/me/start/end/text-start/text-end` on the guest + shared UI surfaces first (`guest-menu.tsx`, `ui/dialog.tsx`, `ui/select.tsx`), then the dashboards; add `isAr && "rotate-180"` where an arrow encodes direction. (Tailwind v4 supports all of these natively — no `tailwindcss-rtl` plugin needed, and `tailwind.config.ts` currently has no RTL configuration at all.)

### I18N-13 · Medium · OCR review price ignores the currency setting · VERIFIED

- Evidence: `src/components/onboarding/menu-scan-dialog.tsx:262` renders `` `${it.price.toFixed(3)} DT` `` hard-coded, while the product list in the same wizard uses `formatPrice` (`src/components/onboarding/step-products.tsx:297`, via `useI18n` at `:164`).
- Impact: with `cur = usd` the wizard shows the scanned item as "4.500 DT" in the review and "$1.40" two steps later — the same product, two currencies, in one flow.
- Fix: use `formatPrice(it.price)` (scanned prices are TND by contract, `ms_hint`), or force `cur = "tnd"` for the review list and say so.

### I18N-14 · Medium · `restaurants.currency` is written once and never read · VERIFIED

- Evidence: the only occurrence of the column in the codebase is `src/app/api/menu/route.ts:198` — `currency: "TND"` hard-coded on restaurant `insert` (and not even sent on `update`, `:177-189`). `src/app/menu/[slug]/[token]/page.tsx:20-24` selects `*` but never reads `currency`; `formatPrice` (`i18n.tsx:1872-1876`) decides the currency purely from device `localStorage`. The two currency helpers that *would* have produced the README's behaviour are dead code: `src/lib/format.ts:6` `formatDT` and `:10` `formatDTShort` are imported by nothing.
- Impact: the DB column is decorative; an owner cannot choose a currency, a guest's currency is a device preference, and the round-trip OCR rate (`menu-scan.ts:195`, `1 EUR ~ 3.4 TND`, `1 USD ~ 3.1 TND`) disagrees with the display rate (`i18n.tsx:1799-1800`, `0.31`/`0.29` ⇒ 3.226/3.448 TND) by up to 4% — two hard-coded rate tables, in two files, neither sourced from anything.
- Fix: pick one currency policy and make it single-sourced: either delete the guest currency switcher and route every price through a server-side/README-documented TND formatter (`format.ts` already exists), or read `restaurants.currency` and keep one shared rate constant.

### I18N-15 · Low · Dead keys and a duplicated key family · VERIFIED

- Evidence: 30 of the 530 keys are referenced nowhere in `src/**` — not as a literal and not through any template-literal pattern: `common_copy`, `cur_label`, `lang_label`, the 13 `prv_*` keys listed in I18N-06 (`prv_eyebrow/title/desc/sim1/sim2/sim3/checklist/copyTitle/readyPublish/backToProducts/goDashboard/whatNextTitle/whatNextDesc`), `status_active`, `status_completed`, and 12 of the 14 `w_*` keys (`w_terminal`, `w_desc`, `w_empty`, `w_cashier`, `w_colPending`, `w_hintPending`, `w_hintAccepted`, `w_hintPaid`, `w_paidDesc`, `w_paidToast`, `w_acceptDesc`, `w_dashboardEyebrow`). The `w_*` family duplicates `wd_*`/`wk_*` (`w_terminal` vs the `wk_terminal` actually used at `worker-shell.tsx:62`; `w_dashboardEyebrow` vs `wk_terminal` again); the two live members are `w_orders_one`/`w_orders_other` (`worker-shell.tsx:69`). A further 16 `demo_*` keys (`demo_cat1..4`, `demo_p1n..p6n`, `demo_p1d..p6d`) are unreachable as literals but **do** resolve through the template-literal keys at `src/lib/onboarding-store.tsx:394-399` — that path is fine, it just cannot be caught by a literal-only grep.
- Impact: no runtime impact beyond maintenance risk (it is what let I18N-05 ship silently), plus the unused `cur_label`/`lang_label` are exactly the labels the switchers never show (see I18N-16).
- Fix: delete the unused keys or wire them up; add a key-usage check to CI.

### I18N-16 · Low · Currency/language switcher has no accessible labels · VERIFIED

- Evidence: `src/components/lang-cur-switcher.tsx:16-27` renders `EN`/`FR`/`AR` text buttons and `:29-41` renders bare `DT`/`$`/`€` symbols. No `aria-label`, `title`, `aria-pressed` or `role=radiogroup` anywhere in the component; the `cur_label`/`lang_label`/`APP_CURRENCIES[].label` strings exist (`i18n.tsx:72-73, 20-24`) but are unused. The landing copy (`src/app/page.tsx:48-49, 67-68`) at least prefixes icons, and the owner-shell (`owner-shell.tsx:113`) shows the switcher with no label at all.
- Impact: a screen-reader guest hears "$" and "€" with no context; a guest who does not know `DT` cannot tell what the row does, and there is no visible indication that the currency toggle exists vs the language toggle (they are separated only by a 1px divider, `lang-cur-switcher.tsx:28`).
- Fix: `aria-label={l.label}` / `aria-label={c.label}`, `aria-pressed`, and render `t("cur_label")`/`t("lang_label")` (or drop the currency row entirely — see I18N-01).

### I18N-17 · Low · Static English metadata for every locale · VERIFIED

- Evidence: `src/app/layout.tsx:7-11` (title "Sufra — QR Menu for Restaurants", English description), `src/app/auth/login/page.tsx:5`, `signup/page.tsx:5`, `forgot/page.tsx:5`. There is no `generateMetadata` anywhere in `src/`.
- Impact: browser tab, search results and link previews (WhatsApp is the primary sharing channel for this market) are always English, even for an Arabic café.
- Fix: export `generateMetadata` reading the locale cookie (I18N-02) and translate `title`/`description`.

### I18N-18 · Low · English fallback copy in localized components · VERIFIED

- Evidence: `src/components/dashboard/owner-shell.tsx:110` — literal `<span>Sign out</span>` in a shell that translates everything else. Brand fallbacks hard-coded to a demo venue name: `owner-shell.tsx:37`, `worker-shell.tsx:15`, `settings/page.tsx:28`, `tables/page.tsx:22`, `invite-dialog.tsx:46`, `app/(worker)/worker/invite/[token]/page.tsx:109`, `(worker)/dashboard/page.tsx:55` (all `restaurantName || "Velvet & Stone Coffee"`), plus `src/app/menu/[slug]/[token]/page.tsx:70` `restaurant.name ?? "Our Café"` and `phone-mockup.tsx:64` `|| "Your Café"` — although `t("ob_yourCafe")` (`i18n.tsx:392`) exists for exactly this. Also `phone-mockup.tsx:345, 402, 429` (`?? "Menu"` category fallback), `phone-mockup.tsx:117` (`alt="Cover banner"`), `src/components/ui/dialog.tsx:45` (sr-only `Close`), `src/app/(worker)/worker/invite/[token]/page.tsx:298` (`Loading…`) and `:277` (`"Working…"` — the `??` after `t("inv_working")` is unreachable, `t` never returns null).
- Impact: mostly owner-side; `menu/[slug]/[token]/page.tsx:70` is guest-visible but only when a restaurant has a null name (the wizard requires one). The unreachable `??` fallbacks are dead code that hides the intent.
- Fix: use `t("ob_yourCafe")` for the fallbacks, add keys for "Sign out"/"Close"/"Loading…", and drop the unreachable `?? "Working…"`.

### I18N-19 · Low · Landing demo prices are not dinar prices · INFERENCE

- Evidence: `src/lib/landing-i18n.tsx:91-95` (and FR/AR mirrors, `:99-111`) price the demo menu at `4.75, 4.00, 5.50, 6.00, 5.25` while `cur` defaults to `tnd` (`i18n.tsx:1824, 1833`) and `formatPrice` treats the stored number as TND (`i18n.tsx:1874`).
- Impact: [INFERENCE — judgement about plausible café pricing] the pitch shows "4.750 DT" for an "Oat Cortado" and "$1.47" for the same dish once the visitor taps `$`, which reads as a 3× discount rather than a conversion. The demo numbers were clearly authored as USD/EUR retail amounts. Low because it is marketing data, not product logic.
- Fix: author the demo prices in dinars (e.g. `2.500`) so the three currency buttons read as a conversion.

## Verified-working

- **Key inventory is complete and balanced.** 530 keys in EN (`i18n.tsx:27-629`), FR (`:630-1214`) and AR (`:1215-1795`); the three key sets are identical — **0 missing, 0 empty-string** in FR and AR. No duplicate key within any locale (a duplicate would silently shadow). Parsed from the source, handling multi-line values; see the per-group table under "Key inventory" below.
- **`t()` cannot render `undefined`.** `src/lib/i18n.tsx:1855-1867` returns the key on a miss and does `{name}` substitution otherwise; `{year}` is auto-filled when no vars are passed, which is exactly how `foot_rights` is invoked (`src/app/page.tsx:338` — the only placeholder key called without vars, and it is handled).
- **No placeholder-without-vars defect.** Every `t("…{token}…")` call site passes the matching vars (checked mechanically across `src/**`); `plural()` (`i18n.tsx:1869-1870`) injects `{n}` itself.
- **Dynamic keys all resolve.** `t(\`demo_cat${i+1}\`)` / `t(\`demo_p${i+1}n\`)` / `t(\`demo_p${i+1}d\`)` (`onboarding-store.tsx:394-399`) map onto `DEMO_STATE`'s 4 categories / 6 products (`constants.ts:267-328`) and `demo_cat1..4` / `demo_p1n..p6n` / `demo_p1d..p6d` all exist. The `labelKey`/`titleKey`/`hintKey`/`shortKey` indirections (`owner-shell.tsx:24-29`, `status-badge.tsx:5-18`, `menu/page.tsx:17-20`, `worker/dashboard/page.tsx:20-44`, `orders/page.tsx:15-19`, `stepper.tsx:16-42`, `invite-dialog.tsx:27-30`, `step-branding.tsx`/`step-business.tsx`/`image-dropzone.tsx` presets) all point at defined keys — verified against the full key list.
- **OCR error mapping is complete and 1:1.** `ScanErrorCode` (`menu-scan.ts:40-49`) lists exactly 9 codes; `ERROR_MSG_KEY` (`menu-scan-dialog.tsx:22-32`) has exactly those 9, with `UPLOAD_FAILED → ms_error_OCR_FAILED` as the documented alias (README.md:238-239). All nine `ms_error_*` keys plus `ms_error_generic` exist in EN, FR **and** AR (`i18n.tsx:379-387`, `965-973`, `1546-1554`). README.md:233-242's table matches the code.
- **The guest menu's own copy is fully localized.** `src/components/guest-menu.tsx` contains no hard-coded user-facing string (only `"POST"`/`"Content-Type"`/class names); every visible string goes through `t()`/`plural()`, including the not-live screen (`:156-158`) and the cart (`:611-666`).
- **AR/FR content quality is good.** Of 530 keys, only `spl_pricePh` is identical in EN and AR, and the 26 EN/FR-identical values are genuine cognates/loanwords (`Bar / Lounge`, `Café`, `Restaurant`, `Menu`, `Total`, `Table`, `Minimal`, `Bordeaux Noir`, `Amber Roast`). Corpus-wide, the only Latin text inside AR strings is legitimate (PDF/PNG/QR/HEX/Serif + the `{role}`/`{venue}`/`{name}` placeholders).
- **`space-x-*` and `flex-row` are RTL-safe** in the installed Tailwind v4.3.3 (`node_modules/tailwindcss/dist/lib.js`: `space-x` → `margin-inline-start`; flex direction follows the writing direction) — so `ui/dialog.tsx:57` and friends were checked and cleared rather than reported.

**Key inventory (per group, per locale)** — all 53 key groups, resolved from `copy` in `src/lib/i18n.tsx`. EN/FR/AR counts are identical in every group; the last two columns are the required missing/empty audit for FR and AR.


| Key group | EN | FR | AR | FR missing/empty | AR missing/empty |
|---|---|---|---|---|---|
| `prv_` | 36 | 36 | 36 | 0 / 0 | 0 / 0 |
| `inv_` | 31 | 31 | 31 | 0 / 0 | 0 / 0 |
| `ob_` | 29 | 29 | 29 | 0 / 0 | 0 / 0 |
| `ca_` | 28 | 28 | 28 | 0 / 0 | 0 / 0 |
| `ov_` | 28 | 28 | 28 | 0 / 0 | 0 / 0 |
| `g_` | 24 | 24 | 24 | 0 / 0 | 0 / 0 |
| `wo_` | 24 | 24 | 24 | 0 / 0 | 0 / 0 |
| `tb_` | 20 | 20 | 20 | 0 / 0 | 0 / 0 |
| `ms_` | 19 | 19 | 19 | 0 / 0 | 0 / 0 |
| `st_` | 19 | 19 | 19 | 0 / 0 | 0 / 0 |
| `wk_` | 19 | 19 | 19 | 0 / 0 | 0 / 0 |
| `demo_` | 18 | 18 | 18 | 0 / 0 | 0 / 0 |
| `spl_` | 18 | 18 | 18 | 0 / 0 | 0 / 0 |
| `pre_` | 16 | 16 | 16 | 0 / 0 | 0 / 0 |
| `me_` | 15 | 15 | 15 | 0 / 0 | 0 / 0 |
| `w_` | 14 | 14 | 14 | 0 / 0 | 0 / 0 |
| `sb_` | 13 | 13 | 13 | 0 / 0 | 0 / 0 |
| `br_` | 12 | 12 | 12 | 0 / 0 | 0 / 0 |
| `idz_` | 12 | 12 | 12 | 0 / 0 | 0 / 0 |
| `sp_` | 12 | 12 | 12 | 0 / 0 | 0 / 0 |
| `ord_` | 10 | 10 | 10 | 0 / 0 | 0 / 0 |
| `wd_` | 10 | 10 | 10 | 0 / 0 | 0 / 0 |
| `cl_` | 8 | 8 | 8 | 0 / 0 | 0 / 0 |
| `th_` | 8 | 8 | 8 | 0 / 0 | 0 / 0 |
| `nav_` | 7 | 7 | 7 | 0 / 0 | 0 / 0 |
| `spp_` | 7 | 7 | 7 | 0 / 0 | 0 / 0 |
| `na_` | 6 | 6 | 6 | 0 / 0 | 0 / 0 |
| `bt_` | 5 | 5 | 5 | 0 / 0 | 0 / 0 |
| `cta_` | 5 | 5 | 5 | 0 / 0 | 0 / 0 |
| `save_` | 5 | 5 | 5 | 0 / 0 | 0 / 0 |
| `status_` | 5 | 5 | 5 | 0 / 0 | 0 / 0 |
| `common_` | 4 | 4 | 4 | 0 / 0 | 0 / 0 |
| `hero_` | 4 | 4 | 4 | 0 / 0 | 0 / 0 |
| `oc_` | 4 | 4 | 4 | 0 / 0 | 0 / 0 |
| `how_` | 3 | 3 | 3 | 0 / 0 | 0 / 0 |
| `nd_` | 3 | 3 | 3 | 0 / 0 | 0 / 0 |
| `f_` | 2 | 2 | 2 | 0 / 0 | 0 / 0 |
| `f1_` | 2 | 2 | 2 | 0 / 0 | 0 / 0 |
| `f2_` | 2 | 2 | 2 | 0 / 0 | 0 / 0 |
| `f3_` | 2 | 2 | 2 | 0 / 0 | 0 / 0 |
| `f4_` | 2 | 2 | 2 | 0 / 0 | 0 / 0 |
| `f5_` | 2 | 2 | 2 | 0 / 0 | 0 / 0 |
| `f6_` | 2 | 2 | 2 | 0 / 0 | 0 / 0 |
| `foot_` | 2 | 2 | 2 | 0 / 0 | 0 / 0 |
| `h1_` | 2 | 2 | 2 | 0 / 0 | 0 / 0 |
| `h2_` | 2 | 2 | 2 | 0 / 0 | 0 / 0 |
| `h3_` | 2 | 2 | 2 | 0 / 0 | 0 / 0 |
| `owner_` | 2 | 2 | 2 | 0 / 0 | 0 / 0 |
| `b1_` | 1 | 1 | 1 | 0 / 0 | 0 / 0 |
| `b2_` | 1 | 1 | 1 | 0 / 0 | 0 / 0 |
| `b3_` | 1 | 1 | 1 | 0 / 0 | 0 / 0 |
| `cur_` | 1 | 1 | 1 | 0 / 0 | 0 / 0 |
| `lang_` | 1 | 1 | 1 | 0 / 0 | 0 / 0 |
| **Total** | **530** | **530** | **530** | **0 / 0** | **0 / 0** |

Key-usage delta (not a locale gap, but the table the fixes hang off): 1 key is **used but undefined** (`prv_menuItemsSub` → I18N-05); 30 keys are **defined but never referenced** and 16 more are reachable only through template literals (→ I18N-15); `src/lib/landing-i18n.tsx:9-60` holds a second, parallel label table (`LANDING_PHONE_LABELS`) that duplicates 10 of the `g_*` keys by hand (EN `:25-34` vs `i18n.tsx:93-113`) — a drift risk, not a defect today (values match).

## Open questions

1. **Should the guest menu keep a currency switcher at all?** README:10 says no; `guest-menu.tsx:201` and the whole `RATES` machinery say yes. This is a product decision, not derivable from code — but it must be decided before I18N-01/I18N-13/I18N-14 can be fixed coherently (one policy: TND everywhere, or `restaurants.currency` everywhere).
2. **Origin of the rate constants**: are `0.31/0.29` (`i18n.tsx:1799-1800`) and `3.1/3.4` (`menu-scan.ts:195`) meant to be the same rate? Nothing in the repo sources or dates them.
3. **Is `restaurants.currency` part of the base schema** the DB slice is writing (`0001_init_schema.sql`)? The API inserts it (`api/menu/route.ts:198`) and the README lists it (README.md:91), so it is assumed to exist — flagged here as an **assumption**, not verified (no base schema in the repo).
4. **Tunisian Arabic vs MSA**: the AR table is Modern Standard Arabic (`i18n.tsx:1215-1795`); a Tunisian café's staff may prefer Franco-Arabic or dialect terms. Out of scope for a defect report, but it affects whether "AR" alone is the right fourth option.
5. **`ar-TN` expectations (I18N-02)**: should a device set to `ar-TN` also imply `cur = tnd`, or is currency strictly independent? No code encodes an opinion; the README implies dinar for guests.
6. **Test coverage for i18n**: the existing suite (`src/lib/*.test.ts`) contains no test that touches `i18n.tsx`, so none of the table/usage invariants here (I18N-05, I18N-15) can currently fail a build. Is adding a key-coverage test in scope for the remediation phase?
