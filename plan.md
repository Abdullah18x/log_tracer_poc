# Implementation Plan: Function-Level Tracing with AsyncLocalStorage + Winston

## Project Structure
```
log_tracer/
├── package.json
├── index.js
├── tracer.js
├── logger.js
├── services.js
└── README.md
```

## Build Order & Step-by-Step Tasks

### Step 1 — `package.json`
- CommonJS project (no `"type": "module"`)
- Dependencies: `winston` only
- Scripts: `"start": "node index.js"`
- Node engines: `>=18` (AsyncLocalStorage stable, `crypto.randomUUID` available)

### Step 2 — `tracer.js` (core module, build first)
Export a single `AsyncLocalStorage` instance + helpers. Nothing else imports Winston here (avoid circular deps).

**Exports:**
- `asyncLocalStorage` — the singleton `AsyncLocalStorage` instance
- `getContext()` — returns `asyncLocalStorage.getStore()` or `undefined`
- `withTrace(functionName, fn)` — the main wrapper

**`withTrace(functionName, fn)` logic:**
1. Read `parent = getContext()`
2. Build new `context` object:
   - If no parent → root: new `traceId = crypto.randomUUID()`, `depth = 0`, `parentFunctionName = null`, `rootFunctionName = functionName`, `rootSpanId = newSpanId`, `path = [functionName]`
   - If parent exists → child: inherit `traceId`, `rootFunctionName`, `rootSpanId`; `depth = parent.depth + 1`; `parentFunctionName = parent.currentFunctionName`; `path = [...parent.path, functionName]`
   - Always: fresh `spanId = crypto.randomUUID()`, `currentFunctionName = functionName`, `startTime = Date.now()`
3. Run inside `asyncLocalStorage.run(context, async () => { ... })`:
   - Log `status: 'enter'`
   - `try { result = await fn(); log 'exit' with duration; return result }`
   - `catch (err) { log 'error' with duration + err.message/stack; rethrow }`
4. Must handle **both async and sync** `fn` — wrap in `Promise.resolve().then(fn)` or detect with `await` (since `await` on sync value works fine, simplest is to always `await fn()`)

**Key detail:** `AsyncLocalStorage.run` automatically propagates across `await`, `setTimeout`, `Promise.resolve`, nested async — no extra work needed.

### Step 3 — `logger.js`
- Build Winston logger with `transports.Console` + custom `format.printf`
- **Critical:** inside the printf formatter, call `getContext()` from `tracer.js` at format time. Do NOT bake context in at logger-creation time.
- Format: indent message by `depth * 2` spaces, show `[traceId(short)] [spanId(short)] depth=N path=a>b>c status=enter msg="..."`
- Also include a `format.json()` alternative or a `LOG_FORMAT=json` env toggle (nice-to-have)
- Export `logger` and convenience `logWithContext(level, message, meta)` that merges context into meta

**Avoid circular import:** `logger.js` requires `tracer.js`. `tracer.js` requires `logger.js` for entry/exit logs. Resolve by **lazy-requiring** logger inside `withTrace` (`const { logger } = require('./logger')` inside the function body, not at top), OR keep tracer logging minimal and let it require logger at top while logger only requires `getContext` from tracer (one-way data flow works if logger.js doesn't call `withTrace`).

Recommended: `logger.js` → requires `{ getContext }` from `tracer.js`. `tracer.js` → requires `{ logger }` from `logger.js`. This circular require works in CJS because each module only uses the other's exports at call time, not load time. Test it — if it breaks, switch to lazy require in `tracer.js`.

### Step 4 — `services.js`
Implement each function as `const processOrder = (orderId) => withTrace('processOrder', async () => { ... })`.

**Functions to implement:**
- `delay(ms)` helper (not traced — it's a utility)
- `processOrder(orderId)` → calls `validateOrder`, `loadCustomer`, `calculatePrice`, `saveOrder`, `publishOrderEvent`
- `validateOrder(orderId)` — use `Promise.resolve()` pattern
- `loadCustomer(orderId)` → calls `fetchCustomerFromDb(customerId)`
- `fetchCustomerFromDb(customerId)` — use `await delay(...)`
- `calculatePrice(orderId)` — **sync function wrapped with `withTrace`** (requirement 4)
- `saveOrder(orderId)` — use `setTimeout` wrapped in a Promise to prove context propagates across timers
- `publishOrderEvent(orderId)` — simple await
- `generateInvoice(invoiceId)` → calls `loadInvoice`, `renderInvoicePdf`, `storeInvoice`
- Each: at least one `logger.info(...)` call with a meaningful message
- **Error demo:** make one function (e.g., `validateOrder` when `orderId === 'bad'`) throw, so we can show error logging with trace context

### Step 5 — `index.js`
```
Promise.all([
  processOrder('ORD-1'),
  processOrder('ORD-2'),
  generateInvoice('INV-1'),
]).then(...).catch(...)
```
Add a second block afterwards that triggers the error path (`processOrder('bad')`) wrapped in `.catch` so the process doesn't crash, demonstrating error tracing.

### Step 6 — `README.md`
Sections:
1. **What this demonstrates**
2. **Install:** `npm install`
3. **Run:** `npm start`
4. **How AsyncLocalStorage works here** — explain `run()` creating a context bound to the async resource tree
5. **Root vs child detection** — point at `tracer.js` logic
6. **Why Winston alone isn't enough** — child loggers bake context at creation; we need context at log-emit time because the active async context changes per function call
7. **Sample output** — paste real trimmed output showing:
   - Two `processOrder` calls with different `traceId`s interleaving
   - Child spans under each sharing the parent's `traceId`
   - Indentation by depth
   - An error line with full context
8. **Adapting for other entrypoints** — HTTP (wrap handler in `withTrace`), cron (wrap job fn), queue consumer (wrap message handler), background worker (wrap task fn)

## Verification Checklist (for Sonnet to run before declaring done)
- [ ] `node index.js` runs to completion without unhandled rejections (error demo must be caught)
- [ ] Grep the output: all logs under one `processOrder` call share one `traceId`
- [ ] Grep the output: concurrent `processOrder` calls have **different** `traceId`s and do not cross-contaminate (check `path` values)
- [ ] `spanId` is unique per function invocation (no duplicates in output)
- [ ] `depth` increases on nesting, indentation matches
- [ ] Duration appears on every `exit` and `error` log
- [ ] Error log includes `traceId`, `spanId`, `path`, and error message
- [ ] Sync-wrapped function (`calculatePrice`) logs enter/exit correctly
- [ ] `setTimeout`-based function (`saveOrder`) retains context in its inner log line

## Risks / Things to Watch
- **Circular require between `tracer.js` and `logger.js`** — if hit, use lazy require inside `withTrace`
- **Sync function handling** — `await fn()` where `fn` is sync works, but catch blocks must still work; test it
- **`setTimeout` context propagation** — works automatically with ALS, but verify in output
- **Do not** use `async_hooks.createHook()` — spec says avoid unless absolutely necessary, and ALS alone covers everything here

## Deliverable Format (reminder for Sonnet)
Return all six files in separate code blocks with filename headings, then: install command, run command, one-paragraph explanation of expected output.
