# log-tracer

Function-level distributed tracing using **AsyncLocalStorage** and **Winston** — no HTTP framework, no middleware, no TypeScript.

Every function exported through `traceAll()` gets a span automatically. Spans under the same top-level call share one `traceId`. Concurrent top-level calls each get their own `traceId` and never bleed into each other.

---

## What this demonstrates

- **Root vs child span detection** — a function called with no active trace becomes the root; any function called from within an existing trace becomes a child that inherits the `traceId`
- **Automatic context propagation** — context flows through `await`, `Promise.resolve`, `Promise.all`, and `setTimeout` without any manual plumbing
- **Zero-intrusion tracing via `traceAll()`** — business logic functions are completely plain; tracing is applied once at the export boundary
- **Sync function tracing** — `traceAll` handles sync functions too (see `calculatePrice`)
- **Concurrent trace isolation** — two `processOrder` calls running in parallel never share a `traceId`
- **Error tracing** — errors are logged with full span context (traceId, path, depth) before being rethrown
- **Colourful, level-aware logs** — `INFO`, `DEBUG`, `WARN`, `ERROR` each rendered in a distinct colour with span badges and duration highlighting

---

## Install

```bash
npm install
```

## Run

```bash
npm start
```

---

## File overview

| File | Purpose |
|------|---------|
| `tracer.js` | `AsyncLocalStorage` singleton + `withTrace()` + `traceAll()` |
| `logger.js` | Winston logger — ANSI colours, reads live trace context at emit time |
| `services.js` | Plain business logic functions; `traceAll()` applied at export |
| `index.js` | Entry point — concurrent flows + error demo |

---

## How AsyncLocalStorage works here

`AsyncLocalStorage` (from `node:async_hooks`) maintains a per-async-execution-context store. When you call `asyncLocalStorage.run(store, callback)`, the `store` is bound to the async resource tree rooted at that callback. Any `await`, `Promise`, or `setTimeout` created inside that callback automatically inherits the same store — Node.js tracks this through its internal async resource IDs.

```js
asyncLocalStorage.run(rootContext, async () => {
  // rootContext is active here
  await someNestedFunction();  // still active here
  setTimeout(() => {
    asyncLocalStorage.getStore(); // still rootContext — even inside setTimeout
  }, 100);
});
```

In `tracer.js`, every call to `withTrace()` calls `asyncLocalStorage.run()` with a new context object. For child spans, that context object contains the same `traceId` as the parent but a new `spanId` and incremented `depth`.

---

## Root vs child detection

Inside `withTrace(functionName, fn)` in [tracer.js](tracer.js):

```js
const parent = getContext();  // asyncLocalStorage.getStore()

if (!parent) {
  // No active context → this is the ROOT of a new trace
  context = { traceId: crypto.randomUUID(), depth: 0, ... };
} else {
  // Active context exists → this is a CHILD span
  context = {
    traceId: parent.traceId,            // inherited — same trace
    depth: parent.depth + 1,
    parentFunctionName: parent.currentFunctionName,
    path: [...parent.path, functionName],
    ...
  };
}
```

---

## Zero-intrusion tracing with `traceAll()`

The original approach required wrapping every function body manually:

```js
// ❌ old — tracing mixed into business logic
async function processOrder(orderId) {
  return withTrace('processOrder', async () => {
    logger.info('...')
    await validateOrder(orderId)
  })
}
```

`traceAll()` moves tracing entirely to the export boundary. Function bodies stay plain:

```js
// ✅ new — pure business logic, no tracing code inside
async function processOrder(orderId) {
  logger.info(`Starting order processing for orderId=${orderId}`)
  await svc.validateOrder(orderId)
}

// tracing applied once, at the bottom of the file
const svc = traceAll({ processOrder, validateOrder, ... })
module.exports = svc
```

`traceAll()` implementation in [tracer.js](tracer.js):

```js
function traceAll(fns) {
  const traced = {};
  for (const [name, fn] of Object.entries(fns)) {
    traced[name] = (...args) => withTrace(name, () => fn(...args));
  }
  return traced;
}
```

**One rule:** inner calls between functions in the same module must go through the `svc` object (the traced version), not the bare function name — otherwise those inner calls won't get a span.

```js
// ✅ correct — goes through the traced wrapper
await svc.validateOrder(orderId)

// ❌ wrong — bypasses traceAll, gets no span
await validateOrder(orderId)
```

---

## Why Winston alone isn't enough

Winston's `logger.child({ traceId })` bakes context at **logger creation time**. If you create a child logger once per request/flow, it works for request-scoped logging — but it breaks for function-level tracing because the active span changes on every function call within the same async execution.

With `AsyncLocalStorage`, the correct span context is only knowable at **log-emit time**, not when the logger was created. That's why `logger.js` calls `getContext()` inside the `printf` formatter — it reads the currently-executing span's context at the moment the log line is being formatted, which is always correct.

---

## Log levels and colours

The logger uses Winston's standard levels, each with a distinct ANSI colour:

| Level | Colour | When to use |
|-------|--------|-------------|
| `ERROR` | Bold red | Span threw an error |
| `WARN` | Bold yellow | Suspicious state, non-fatal |
| `INFO` | Bold green | Normal business events |
| `DEBUG` | Bold blue | Low-level details (SQL, HTTP calls, storage ops) |

Span lifecycle badges appear on every enter/exit/error line:

| Badge | Colour | Meaning |
|-------|--------|---------|
| ` → ` | Bold green | Span entered |
| ` ← ` | Bold cyan | Span exited cleanly (duration shown) |
| ` ✖ ` | Bold red | Span exited with error (duration shown) |

Additional colour coding per line:
- **`[traceId]`** — bold cyan — which top-level execution
- **`[spanId]`** — magenta — which specific function call
- **Duration `Nms`** — bold yellow — on every exit/error line
- **`(path › path)`** — dim gray — call hierarchy, low visual weight
- **Timestamp** — gray — background noise

---

## Sample output

Three concurrent flows — `ORD-1`, `ORD-2`, and `INV-1` — all start at nearly the same time. Their logs interleave in the console, but each line carries its own `[traceId]` so you can filter by trace. Indentation reflects call depth.

```
16:40:40.218  INFO   [0e46383b][9c01f6b9]   →  processOrder                       (processOrder)
16:40:40.218  INFO   [0e46383b][9c01f6b9]      Starting order processing for orderId=ORD-1
16:40:40.218  INFO   [0e46383b][fe53b936]   →    validateOrder                    (processOrder › validateOrder)
16:40:40.219  INFO   [2a646201][93af4150]   →  processOrder                       (processOrder)   ← different traceId!
16:40:40.219  INFO   [2a646201][93af4150]      Starting order processing for orderId=ORD-2
16:40:40.219  INFO   [2a646201][2ee83d0a]   →    validateOrder                    (processOrder › validateOrder)
16:40:40.219  INFO   [650752f7][02e849d1]   →  generateInvoice                    (generateInvoice)  ← third traceId
16:40:40.220  DEBUG  [0e46383b][fe53b936]        Running validation rules for orderId=ORD-1
16:40:40.220  INFO   [0e46383b][fe53b936]        Order ORD-1 passed validation
16:40:40.220  INFO   [0e46383b][fe53b936]   ←    validateOrder  2ms               (processOrder › validateOrder)
16:40:40.220  INFO   [0e46383b][d8a9a22c]   →      fetchCustomerFromDb            (processOrder › loadCustomer › fetchCustomerFromDb)
16:40:40.220  DEBUG  [0e46383b][d8a9a22c]          SELECT * FROM customers WHERE id = 'CUST-ORD-1'
16:40:40.251  INFO   [0e46383b][7a20ceda]   →    calculatePrice                   (processOrder › calculatePrice)
16:40:40.251  INFO   [0e46383b][7a20ceda]   ←    calculatePrice  0ms              ← sync span, 0ms
16:40:40.273  DEBUG  [0e46383b][836b250c]        INSERT INTO orders (id, customer_id, price) VALUES (...)
16:40:40.273  INFO   [0e46383b][836b250c]        Order ORD-1 written to DB — $146 for Alice  ← inside setTimeout, context still correct
16:40:40.284  INFO   [0e46383b][9c01f6b9]   ←  processOrder  66ms
16:40:40.286  DEBUG  [650752f7][9777c63f]        PUT s3://invoices/INV-1.pdf → 200 OK
16:40:40.287  WARN   [7461e5f7][2e66737a]        Order bad rejected — invalid order ID
16:40:40.287  ERROR  [7461e5f7][2e66737a]   ✖    validateOrder  0ms               (processOrder › validateOrder)
                                             ⚠   Order bad failed validation: invalid order ID
16:40:40.287  ERROR  [7461e5f7][5e94f0e8]   ✖  processOrder  1ms
                                             ⚠   Order bad failed validation: invalid order ID
```

---

## Adapting for other entrypoints

The pattern is always the same: pass your entry point functions through `traceAll()`. Everything called from inside inherits the trace automatically.

**HTTP request (Express/Fastify)**
```js
const handlers = traceAll({
  async getOrder(req, res) {
    const order = await orderService.findById(req.params.id);
    res.json(order);
  }
});
app.get('/orders/:id', handlers.getOrder);
```

**Cron job**
```js
const jobs = traceAll({
  async dailyReport() {
    await buildReport();
    await sendReport();
  }
});
cron.schedule('0 9 * * *', jobs.dailyReport);
```

**Queue consumer (SQS, RabbitMQ, BullMQ)**
```js
const consumers = traceAll({
  async processMessage(job) {
    await handleJob(job);
  }
});
queue.process(consumers.processMessage);
```

**Background worker**
```js
const workers = traceAll({
  async processTask(task) {
    await runTask(task);
  }
});

async function workerLoop() {
  while (true) {
    const task = await taskQueue.dequeue();
    await workers.processTask(task);
  }
}
```

No changes to `tracer.js` or `logger.js` are needed for any of these — define your functions, pass them through `traceAll()`, use the returned object.
