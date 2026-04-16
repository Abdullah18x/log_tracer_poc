'use strict';

const { processOrder, generateInvoice } = require('./services');
const { logger } = require('./logger');

async function main() {
  // -------------------------------------------------------------------------
  // Part 1: Concurrent happy-path flows
  //
  // Three independent top-level calls run in parallel.
  // Each gets its OWN traceId. Logs from all three will interleave in the
  // console, but every line carries its traceId so you can untangle them.
  // -------------------------------------------------------------------------
  logger.info('=== Starting concurrent flows ===');

  await Promise.all([
    processOrder('ORD-1'),
    processOrder('ORD-2'),
    generateInvoice('INV-1'),
  ]);

  logger.info('=== All concurrent flows completed ===\n');

  // -------------------------------------------------------------------------
  // Part 2: Error path demonstration
  //
  // processOrder('bad') triggers a validation error inside validateOrder().
  // The error is caught and logged WITH full trace context (traceId, spanId,
  // path, depth) before being rethrown — then we catch it here so the
  // process exits cleanly.
  // -------------------------------------------------------------------------
  logger.info('=== Starting error-path demo ===');

  await processOrder('bad').catch((err) => {
    logger.info(`Error-path demo caught expected error: "${err.message}"`);
  });

  logger.info('=== Error-path demo complete ===');
}

main().catch((err) => {
  // Should not reach here — all errors are handled above
  console.error('Unexpected top-level error:', err);
  process.exit(1);
});
