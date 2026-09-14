import { vi } from "vitest";

/**
 * Shared fake Supabase client for the route-level regression tests.
 *
 * The route handlers under `src/app/api/**` reach the database only through
 * `@/lib/supabase-admin` and (for auth) `auth.getUser` / `auth.signInWithPassword`,
 * so those are the only seams mocked. The fake is deliberately *not* a
 * permissive stub that returns whatever a test wants: it is a small
 * PostgREST-ish evaluator that
 *
 *   1. records EVERY query in order (`calls`), with its filters and the payload
 *      of every write, so a test can assert "no write happened" — the
 *      assertions that catch write-before-validate bugs; and
 *   2. actually applies the query's `eq`/`neq`/`in`/`gt`/`gte`/`lt`/`lte`/`is`
 *      and simple `or` filters to seeded rows.
 *
 * (2) is what keeps the scoping tests honest: if a route drops
 * `.eq("restaurant_id", …)` the foreign row is no longer filtered out, so the
 * fake hands it back and the route's behaviour changes — the test fails.
 *
 * Defaults, stated explicitly so no test depends on them silently:
 *   - a `select` that matches no handler and no `seed()` resolves to
 *     `{ data: [], error: null }` (through `single()`/`maybeSingle()`:
 *     `{ data: null, error: null }`);
 *   - a write that matches no handler resolves to `{ data: [], error: null }`
 *     (through a terminal selector: `{ data: null, error: null }`).
 *
 * Not modelled on purpose: joins/embedded selects, `count`, RLS,
 * unique-constraint enforcement inside `upsert`, and `upsert` mutating seeded
 * rows. Tests that need such a response script it with `on()` / `once()`.
 */

export type FakeOp = "select" | "insert" | "update" | "upsert" | "delete";
export type FakeRow = Record<string, unknown>;

export interface FakeDbError {
  code?: string;
  message: string;
}

/** PostgREST always returns both fields: `data` and `error`. */
export interface FakeResponse {
  data?: unknown;
  error?: FakeDbError | null;
}

export type FakeFilterKind = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "is" | "or";

export interface FakeFilter {
  kind: FakeFilterKind;
  column: string;
  value?: unknown;
}

export interface FakeCall {
  table: string;
  op: FakeOp;
  /** Rows passed to insert/upsert, or the patch object passed to update. */
  payload?: unknown;
  /** Second argument of `upsert` (e.g. `{ onConflict: "id" }`). */
  options?: unknown;
  filters: FakeFilter[];
  order: { column: string; ascending: boolean }[];
  limit: number | null;
  columns: string | null;
  /** Terminal selector used on the builder, if any. */
  terminal: "single" | "maybeSingle" | null;
  /** `op !== "select"` — the flag the "did this route write?" assertions use. */
  isWrite: boolean;
}

/** Returns a response to use, or `undefined` to fall through to the next handler. */
export type FakeHandler = (call: FakeCall, hit: number) => FakeResponse | undefined;

export interface FakeCredentials {
  email: string;
  password: string;
}

export interface FakeUser {
  id: string;
  email: string;
}

export interface FakeSession {
  access_token: string;
  refresh_token: string;
}

export interface FakeSignInResult {
  data: { user: FakeUser | null; session: FakeSession | null };
  error: FakeDbError | null;
}

export interface FakeGetUserResult {
  data: { user: FakeUser | null };
  error: FakeDbError | null;
}

/** Arguments of `auth.verifyOtp` — the recovery path (src/app/api/auth/reset). */
export interface FakeVerifyOtpArgs {
  token_hash: string;
  type: string;
}

/** `verifyOtp` resolves to the same shape `signInWithPassword` does. */
export type FakeVerifyOtpResult = FakeSignInResult;

/** Attributes of `auth.admin.createUser` (src/app/api/auth/signup). */
export interface FakeCreateUserAttrs {
  email: string;
  password: string;
  email_confirm?: boolean;
  user_metadata?: Record<string, unknown>;
}

/** Attributes of `auth.admin.updateUserById` (src/app/api/auth/reset). */
export interface FakeUpdateUserAttrs {
  password?: string;
}

/** Arguments of `auth.admin.listUsers` (src/app/api/auth/signup). */
export interface FakeListUsersArgs {
  page?: number;
  perPage?: number;
}

/** Result of `auth.admin.createUser` / `updateUserById`. */
export interface FakeAdminUserResult {
  data: { user: FakeUser | null };
  error: FakeDbError | null;
}

/** Result of `auth.admin.listUsers`. */
export interface FakeAdminListUsersResult {
  data: { users: { id: string; email: string | null }[] };
  error: FakeDbError | null;
}

function compareValues(a: unknown, b: unknown): number | null {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
  return null;
}

function normalizeIsArgument(value: unknown): unknown {
  if (value === "null") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

/**
 * Evaluates the `or` expressions the routes use — comma-separated
 * `column.op.value` terms where a row matches if ANY term matches, i.e. the
 * `restaurant_id.neq.<id>,restaurant_id.is.null` form in `PUT /api/menu`.
 * An expression that does not parse into those terms matches every row rather
 * than silently matching none (a stricter fake would turn a typo in a route
 * into a false pass here).
 */
function matchesOrExpression(row: FakeRow, expression: string): boolean {
  const terms = expression.split(",").map((t) => t.trim()).filter(Boolean);
  if (terms.length === 0) return true;
  return terms.some((term) => {
    const parts = term.split(".");
    const column = parts[0];
    const op = parts[1];
    if (column === undefined || op === undefined) return true;
    const value = normalizeIsArgument(parts.slice(2).join("."));
    const actual = row[column];
    switch (op) {
      case "eq":
        return actual === value;
      case "neq":
        return actual !== value;
      case "is":
        return (actual ?? null) === value;
      case "gt":
      case "gte":
      case "lt":
      case "lte": {
        const cmp = compareValues(actual, value);
        if (cmp === null) return false;
        if (op === "gt") return cmp > 0;
        if (op === "gte") return cmp >= 0;
        if (op === "lt") return cmp < 0;
        return cmp <= 0;
      }
      default:
        return true;
    }
  });
}

function matchesFilter(row: FakeRow, filter: FakeFilter): boolean {
  const actual = row[filter.column];
  switch (filter.kind) {
    case "eq":
      return actual === filter.value;
    case "neq":
      return actual !== filter.value;
    case "is":
      return (actual ?? null) === normalizeIsArgument(filter.value);
    case "in":
      return Array.isArray(filter.value) && filter.value.includes(actual);
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const cmp = compareValues(actual, filter.value);
      if (cmp === null) return false;
      if (filter.kind === "gt") return cmp > 0;
      if (filter.kind === "gte") return cmp >= 0;
      if (filter.kind === "lt") return cmp < 0;
      return cmp <= 0;
    }
    case "or":
      return matchesOrExpression(row, String(filter.value ?? ""));
    default:
      return true;
  }
}

/** Applies every recorded filter to a candidate row set. */
function applyFilters(rows: FakeRow[], call: FakeCall): FakeRow[] {
  return rows.filter((row) => call.filters.every((filter) => matchesFilter(row, filter)));
}

/** Value of the first filter of the given kind on `column`, if any. */
export function filterValue(
  call: FakeCall,
  column: string,
  kind: FakeFilterKind = "eq",
): unknown {
  return call.filters.find((f) => f.kind === kind && f.column === column)?.value;
}

/** Values of the first `in()` filter on `column` (empty when there is none). */
export function inValues(call: FakeCall, column: string): unknown[] {
  const value = filterValue(call, column, "in");
  return Array.isArray(value) ? value : [];
}

/** Chainable PostgREST query builder; thenable, so `await query` resolves. */
export class FakeQueryBuilder implements PromiseLike<FakeResponse> {
  private op: FakeOp = "select";
  private payload: unknown = undefined;
  private options: unknown = undefined;
  private readonly filters: FakeFilter[] = [];
  private readonly orderBy: { column: string; ascending: boolean }[] = [];
  private limitCount: number | null = null;
  private columns: string | null = null;
  private terminal: "single" | "maybeSingle" | null = null;
  private settled: Promise<FakeResponse> | null = null;

  constructor(
    private readonly client: FakeSupabaseClient,
    private readonly table: string,
  ) {}

  select(columns?: string): this {
    this.columns = columns ?? "*";
    return this;
  }

  insert(payload: unknown): this {
    return this.mutate("insert", payload);
  }

  update(payload: unknown): this {
    return this.mutate("update", payload);
  }

  upsert(payload: unknown, options?: unknown): this {
    this.options = options;
    return this.mutate("upsert", payload);
  }

  delete(): this {
    return this.mutate("delete", undefined);
  }

  eq(column: string, value: unknown): this {
    return this.addFilter("eq", column, value);
  }

  neq(column: string, value: unknown): this {
    return this.addFilter("neq", column, value);
  }

  gt(column: string, value: unknown): this {
    return this.addFilter("gt", column, value);
  }

  gte(column: string, value: unknown): this {
    return this.addFilter("gte", column, value);
  }

  lt(column: string, value: unknown): this {
    return this.addFilter("lt", column, value);
  }

  lte(column: string, value: unknown): this {
    return this.addFilter("lte", column, value);
  }

  is(column: string, value: unknown): this {
    return this.addFilter("is", column, value);
  }

  in(column: string, value: unknown): this {
    return this.addFilter("in", column, value);
  }

  or(expression: string): this {
    return this.addFilter("or", "or", expression);
  }

  order(column: string, options?: { ascending?: boolean }): this {
    this.orderBy.push({ column, ascending: options?.ascending ?? true });
    return this;
  }

  limit(count: number): this {
    this.limitCount = count;
    return this;
  }

  single(): this {
    this.terminal = "single";
    return this;
  }

  maybeSingle(): this {
    this.terminal = "maybeSingle";
    return this;
  }

  then<TResult1 = FakeResponse, TResult2 = never>(
    onfulfilled?: ((value: FakeResponse) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.settle().then(onfulfilled, onrejected);
  }

  private addFilter(kind: FakeFilterKind, column: string, value: unknown): this {
    this.filters.push({ kind, column, value });
    return this;
  }

  private mutate(op: FakeOp, payload: unknown): this {
    // First mutator wins: `.insert(x).select(y)` is still an insert.
    if (this.op === "select") this.op = op;
    this.payload = payload;
    return this;
  }

  private toCall(): FakeCall {
    return {
      table: this.table,
      op: this.op,
      payload: this.payload,
      options: this.options,
      filters: [...this.filters],
      order: [...this.orderBy],
      limit: this.limitCount,
      columns: this.columns,
      terminal: this.terminal,
      isWrite: this.op !== "select",
    };
  }

  private settle(): Promise<FakeResponse> {
    if (!this.settled) this.settled = this.client.execute(this.toCall());
    return this.settled;
  }
}

/** The object injected as `supabaseAdmin` for a whole test file. */
export class FakeSupabaseClient {
  calls: FakeCall[] = [];
  rpcCalls: { fn: string; args: unknown }[] = [];

  readonly auth = {
    signInWithPassword: vi.fn(
      async (_creds: FakeCredentials): Promise<FakeSignInResult> => ({
        data: { user: null, session: null },
        error: { message: "Invalid login credentials" },
      }),
    ),
    verifyOtp: vi.fn(
      async (_args: FakeVerifyOtpArgs): Promise<FakeVerifyOtpResult> => ({
        data: { user: null, session: null },
        error: { message: "Token has expired or is invalid" },
      }),
    ),
    getUser: vi.fn(
      async (_token: string): Promise<FakeGetUserResult> => ({
        data: { user: null },
        error: { message: "invalid JWT: unable to parse or verify signature" },
      }),
    ),
    signOut: vi.fn(async (): Promise<{ error: FakeDbError | null }> => ({ error: null })),
    /**
     * `auth.admin.*` is NOT session-creating — it acts through the service-role
     * key without installing a session on the client — so it legitimately stays
     * on the shared client (src/lib/supabase-admin.ts). It is recorded here so a
     * test can prove the session-creating calls did not also land on it.
     */
    admin: {
      createUser: vi.fn(
        async (_attrs: FakeCreateUserAttrs): Promise<FakeAdminUserResult> => ({
          data: { user: null },
          error: { message: "Could not create user" },
        }),
      ),
      updateUserById: vi.fn(
        async (_id: string, _attrs: FakeUpdateUserAttrs): Promise<FakeAdminUserResult> => ({
          data: { user: null },
          error: null,
        }),
      ),
      listUsers: vi.fn(
        async (_args?: FakeListUsersArgs): Promise<FakeAdminListUsersResult> => ({
          data: { users: [] },
          error: null,
        }),
      ),
    },
  };

  private handlers: { table: string; op: FakeOp; handler: FakeHandler; hits: number }[] = [];
  private seeded = new Map<string, FakeRow[]>();
  private rpcHandler: ((fn: string, args: unknown) => FakeResponse | undefined) | null = null;

  /* ------------------------------- scripting ------------------------------- */

  /** Rows that `select` queries against `table` will filter over. */
  seed(table: string, rows: FakeRow[]): void {
    this.seeded.set(table, rows);
  }

  /** Scripts one (table, op) pair. Return `undefined` to fall through. */
  on(table: string, op: FakeOp, handler: FakeHandler | FakeResponse): void {
    const fn: FakeHandler = typeof handler === "function" ? handler : () => handler;
    this.handlers.push({ table, op, handler: fn, hits: 0 });
  }

  /** Scripts a query whose response is used once, then falls through. */
  once(table: string, op: FakeOp, response: FakeResponse): void {
    let hits = 0;
    this.on(table, op, () => (hits++ === 0 ? response : undefined));
  }

  onRpc(handler: (fn: string, args: unknown) => FakeResponse | undefined): void {
    this.rpcHandler = handler;
  }

  /* ------------------------------- assertions ------------------------------ */

  /** Every recorded write (insert/update/upsert/delete), in order. */
  writes(): FakeCall[] {
    return this.calls.filter((call) => call.isWrite);
  }

  writesTo(table: string): FakeCall[] {
    return this.writes().filter((call) => call.table === table);
  }

  wroteTo(table: string): boolean {
    return this.writesTo(table).length > 0;
  }

  callsTo(table: string, op?: FakeOp): FakeCall[] {
    return this.calls.filter(
      (call) => call.table === table && (op === undefined || call.op === op),
    );
  }

  /** Payload rows of the insert/upsert calls against `table`. */
  insertedRows(table: string): FakeRow[] {
    return this.writesTo(table).flatMap((call) => {
      if (call.op !== "insert" && call.op !== "upsert") return [];
      if (Array.isArray(call.payload)) return call.payload as FakeRow[];
      if (call.payload === undefined || call.payload === null) return [];
      return [call.payload as FakeRow];
    });
  }

  /* -------------------------------- runtime -------------------------------- */

  from(table: string): FakeQueryBuilder {
    return new FakeQueryBuilder(this, table);
  }

  async rpc(fn: string, args?: unknown): Promise<FakeResponse> {
    this.rpcCalls.push({ fn, args });
    const scripted = this.rpcHandler?.(fn, args);
    if (scripted !== undefined) {
      return { data: scripted.data ?? null, error: scripted.error ?? null };
    }
    return { data: null, error: null };
  }

  execute(call: FakeCall): Promise<FakeResponse> {
    this.calls.push(call);
    for (const entry of this.handlers) {
      if (entry.table !== call.table || entry.op !== call.op) continue;
      const response = entry.handler(call, entry.hits);
      if (response !== undefined) {
        entry.hits += 1;
        return Promise.resolve(this.normalize(call, response));
      }
    }
    if (call.op === "select") {
      const rows = this.seeded.get(call.table);
      if (rows) return Promise.resolve(this.normalize(call, { data: applyFilters(rows, call) }));
    }
    return Promise.resolve(this.normalize(call, {}));
  }

  reset(): void {
    this.calls = [];
    this.rpcCalls = [];
    this.handlers = [];
    this.seeded = new Map();
    this.rpcHandler = null;
    this.auth.signInWithPassword.mockReset();
    this.auth.verifyOtp.mockReset();
    this.auth.getUser.mockReset();
    this.auth.signOut.mockReset();
    this.auth.admin.createUser.mockReset();
    this.auth.admin.updateUserById.mockReset();
    this.auth.admin.listUsers.mockReset();
    const { signInWithPassword, verifyOtp, getUser, signOut, admin } = this.auth;
    signInWithPassword.mockImplementation(async () => ({
      data: { user: null, session: null },
      error: { message: "Invalid login credentials" },
    }));
    verifyOtp.mockImplementation(async () => ({
      data: { user: null, session: null },
      error: { message: "Token has expired or is invalid" },
    }));
    getUser.mockImplementation(async () => ({
      data: { user: null },
      error: { message: "invalid JWT: unable to parse or verify signature" },
    }));
    signOut.mockImplementation(async () => ({ error: null }));
    admin.createUser.mockImplementation(async () => ({
      data: { user: null },
      error: { message: "Could not create user" },
    }));
    admin.updateUserById.mockImplementation(async () => ({ data: { user: null }, error: null }));
    admin.listUsers.mockImplementation(async () => ({ data: { users: [] }, error: null }));
  }

  /**
   * Normalizes a scripted response the way PostgREST does: a terminal selector
   * (`single`/`maybeSingle`) unwraps the array, a plain select keeps one, and
   * `error` is never `undefined`.
   */
  private normalize(call: FakeCall, response: FakeResponse): FakeResponse {
    const error = response.error ?? null;
    if (error) return { data: null, error };
    let data = response.data;
    if (call.terminal) {
      if (Array.isArray(data)) data = data.length > 0 ? data[0] : null;
      else if (data === undefined) data = null;
    } else if (data === undefined) {
      data = [];
    }
    return { data, error: null };
  }
}

/**
 * The two fakes — and they MUST stay distinct.
 *
 * The bug this guards against is described at the top of
 * src/lib/supabase-admin.ts: `supabaseAdmin` is a module-level SINGLETON, and in
 * supabase-js `signInWithPassword` / `verifyOtp` install the resulting session
 * ON THE CLIENT THEY ARE CALLED ON, after which that client sends the user's
 * access token as the `Authorization` header on every later PostgREST request.
 * A route that signs in through the shared client therefore re-authenticates
 * the whole server process as that user — every later request included — until
 * the process restarts.
 *
 * While both names resolved to the SAME fake, no test could see that: the
 * sign-in was recorded on the very object the database assertions read, so
 * "the route signed in" and "the route signed in on the shared client" were
 * indistinguishable. The split is what makes the negative assertion possible.
 */

/** The shared `supabaseAdmin` fake: all database work, plus `auth.admin.*`. */
export const supabaseFake = new FakeSupabaseClient();

/**
 * The fake returned by `createSessionAuthClient()` — the throwaway client that
 * exists only to hold a session long enough for the route to read its tokens.
 * One instance per test file, exactly like `supabaseFake`, so a test can assert
 * on the calls a route made through it.
 */
export const sessionAuthFake = new FakeSupabaseClient();

/**
 * Resets BOTH fakes. A suite that only queries the database can keep calling
 * `supabaseFake.reset()`; a suite that signs in must use this, or the session
 * fake's recorded calls and scripted answers leak from one test into the next.
 */
export function resetApiFakes(): void {
  supabaseFake.reset();
  sessionAuthFake.reset();
}

/** Body of `vi.mock("@/lib/supabase-admin", ...)`, shared by every suite. */
export function supabaseAdminMock(): {
  supabaseAdmin: FakeSupabaseClient;
  hasBackend: () => boolean;
  /**
   * The throwaway client the auth routes use for session-creating calls
   * (`signInWithPassword` / `verifyOtp`). A DISTINCT fake from `supabaseAdmin`
   * (see the note above) — that distinctness is what lets a test prove which of
   * the two clients a call landed on.
   */
  createSessionAuthClient: () => FakeSupabaseClient;
} {
  return {
    supabaseAdmin: supabaseFake,
    hasBackend: () => true,
    createSessionAuthClient: () => sessionAuthFake,
  };
}

/** Builds a `Request` with an optional JSON body, forged headers and client IP. */
export function apiRequest(
  path: string,
  init: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    /** Unique per rate-limit test: the limiter keys its bucket on this. */
    ip?: string;
  } = {},
): Request {
  const headers = new Headers(init.headers);
  if (init.ip) headers.set("x-forwarded-for", init.ip);
  let body: string | undefined;
  if (init.body !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.body);
  }
  return new Request(`http://localhost${path}`, {
    method: init.method ?? "POST",
    headers,
    body,
  });
}
