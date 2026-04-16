'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');
const crypto = require('node:crypto');

// Single shared AsyncLocalStorage instance for the entire process.
// All trace context lives here — no global mutable state beyond this.
const asyncLocalStorage = new AsyncLocalStorage();

/**
 * Returns the currently active trace context, or undefined if no trace is running.
 */
function getContext() {
  return asyncLocalStorage.getStore();
}

/**
 * Wraps a function (sync or async) in a trace span.
 *
 * - If no context is active → becomes the ROOT of a new trace (new traceId)
 * - If a context is already active → becomes a CHILD span (inherits traceId, depth+1)
 *
 * Automatically propagates context across await, Promise, and setTimeout.
 *
 * @param {string} functionName - Human-readable name for this span
 * @param {Function} fn - The function to execute (sync or async)
 * @returns {Promise<any>} Resolves/rejects with fn's return value or thrown error
 */
function withTrace(functionName, fn) {
  // Lazy-require logger to avoid circular dependency issues at module load time.
  const { logger } = require('./logger');

  const parent = getContext();
  const spanId = crypto.randomUUID();
  const startTime = Date.now();

  let context;

  if (!parent) {
    // ROOT span: start a brand-new trace
    context = {
      traceId: crypto.randomUUID(),
      spanId,
      rootSpanId: spanId,
      rootFunctionName: functionName,
      currentFunctionName: functionName,
      parentFunctionName: null,
      depth: 0,
      startTime,
      path: [functionName],
    };
  } else {
    // CHILD span: inherit the trace, increment depth
    context = {
      traceId: parent.traceId,
      spanId,
      rootSpanId: parent.rootSpanId,
      rootFunctionName: parent.rootFunctionName,
      currentFunctionName: functionName,
      parentFunctionName: parent.currentFunctionName,
      depth: parent.depth + 1,
      startTime,
      path: [...parent.path, functionName],
    };
  }

  // asyncLocalStorage.run() binds `context` to the current async resource tree.
  // Any await, Promise chain, or setTimeout started inside the callback
  // will automatically inherit this context — no manual threading needed.
  return asyncLocalStorage.run(context, async () => {
    logger.info(`${functionName}`, { status: 'enter' });

    try {
      // await works for both sync return values and Promises
      const result = await fn();
      const duration = Date.now() - startTime;
      logger.info(`${functionName}`, { status: 'exit', duration });
      return result;
    } catch (err) {
      const duration = Date.now() - startTime;
      logger.error(`${functionName}`, {
        status: 'error',
        duration,
        errorMessage: err.message,
        stack: err.stack,
      });
      throw err;
    }
  });
}

/**
 * Wraps every function in an object with withTrace at the export boundary.
 * Function bodies stay completely plain — no tracing code inside them.
 *
 * @param {Record<string, Function>} fns - Object of named functions to trace
 * @returns {Record<string, Function>} Same shape, every fn wrapped in withTrace
 */
function traceAll(fns) {
  const traced = {};
  for (const [name, fn] of Object.entries(fns)) {
    traced[name] = (...args) => withTrace(name, () => fn(...args));
  }
  return traced;
}

module.exports = { asyncLocalStorage, getContext, withTrace, traceAll };
