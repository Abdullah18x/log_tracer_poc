'use strict';

const { traceAll, logger, createTracer } = require('fn-tracer');

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// processOrder flow
// ---------------------------------------------------------------------------

async function processOrder(orderId) {
  logger.info(`Starting order processing for orderId=${orderId}`);

  await svc.validateOrder(orderId);
  const customer = await svc.loadCustomer(orderId);
  const price = await svc.calculatePrice(orderId);
  await svc.saveOrder(orderId, customer, price);
  await svc.publishOrderEvent(orderId);

  logger.info(`Order ${orderId} fully processed. customer=${customer.name} price=$${price}`);
}

async function validateOrder(orderId) {
  await Promise.resolve();
  logger.debug(`Running validation rules for orderId=${orderId}`);

  if (orderId === 'bad') {
    logger.warn(`Order ${orderId} rejected — invalid order ID`);
    throw new Error(`Order ${orderId} failed validation: invalid order ID`);
  }

  logger.info(`Order ${orderId} passed validation`);
}

async function loadCustomer(orderId) {
  logger.info(`Loading customer for orderId=${orderId}`);
  const customerId = `CUST-${orderId}`;
  const customer = await svc.fetchCustomerFromDb(customerId);
  logger.info(`Customer loaded: id=${customer.id} name=${customer.name}`);
  return customer;
}

async function fetchCustomerFromDb(customerId) {
  logger.debug(`SELECT * FROM customers WHERE id = '${customerId}'`);
  await delay(30);
  const customer = { id: customerId, name: `Alice (${customerId})`, email: 'alice@example.com' };
  logger.debug(`DB returned 1 row for customerId=${customerId}`);
  return customer;
}

function calculatePrice(orderId) {
  logger.info(`Calculating price for orderId=${orderId}`);
  const price = Math.floor(Math.random() * 900) + 100;
  logger.info(`Price calculated: $${price} for orderId=${orderId}`);
  return price;
}

async function saveOrder(orderId, customer, price) {
  logger.info(`Persisting order ${orderId} to database`);

  return new Promise((resolve) => {
    setTimeout(() => {
      logger.debug(`INSERT INTO orders (id, customer_id, price) VALUES ('${orderId}', '${customer.id}', ${price})`);
      logger.info(`Order ${orderId} written to DB — $${price} for ${customer.name}`);
      resolve();
    }, 20);
  });
}

async function publishOrderEvent(orderId) {
  logger.info(`Publishing OrderPlaced event for orderId=${orderId}`);
  await delay(10);
  logger.info(`Event published for orderId=${orderId}`);
}

// ---------------------------------------------------------------------------
// generateInvoice flow
// ---------------------------------------------------------------------------

async function generateInvoice(invoiceId) {
  logger.info(`Starting invoice generation for invoiceId=${invoiceId}`);
  await svc.loadInvoice(invoiceId);
  await svc.renderInvoicePdf(invoiceId);
  await svc.storeInvoice(invoiceId);
  logger.info(`Invoice ${invoiceId} generation complete`);
}

async function loadInvoice(invoiceId) {
  logger.info(`Loading invoice data for ${invoiceId}`);
  await delay(15);
  logger.info(`Invoice data loaded for ${invoiceId}`);
}

async function renderInvoicePdf(invoiceId) {
  logger.info(`Rendering PDF for invoice ${invoiceId}`);
  await Promise.resolve();
  await delay(40);
  logger.info(`PDF rendered for invoice ${invoiceId}`);
}

async function storeInvoice(invoiceId) {
  logger.info(`Uploading invoice ${invoiceId} to object storage`);
  await delay(10);
  logger.debug(`PUT s3://invoices/${invoiceId}.pdf → 200 OK`);
  logger.info(`Invoice ${invoiceId} stored successfully`);
}

// ---------------------------------------------------------------------------
// Deep-trace flow: handleCheckout → processPayment → chargeCard → verifyFunds
//
// Every log line inside verifyFunds carries the full path back to
// handleCheckout, so you can see exactly how deep in the call stack you are.
// ---------------------------------------------------------------------------

async function handleCheckout(cartId) {
  logger.info(`Checkout started for cart=${cartId}`);
  const result = await svc.processPayment(cartId, 149.99);
  logger.info(`Checkout complete for cart=${cartId} — txId=${result.txId}`);
  return result;
}

async function processPayment(cartId, amount) {
  logger.info(`Processing payment of $${amount} for cart=${cartId}`);
  await svc.validatePaymentDetails(cartId);
  const tx = await svc.chargeCard(cartId, amount);
  logger.info(`Payment authorised — txId=${tx.txId}`);
  return tx;
}

async function validatePaymentDetails(cartId) {
  logger.debug(`Checking payment details on file for cart=${cartId}`);
  await delay(10);
  logger.info(`Payment details valid for cart=${cartId}`);
}

async function chargeCard(cartId, amount) {
  logger.info(`Charging card $${amount} for cart=${cartId}`);
  await svc.verifyFunds(cartId, amount);
  await delay(20);
  const txId = `TX-${cartId}-${Date.now()}`;
  logger.info(`Card charged — txId=${txId}`);
  return { txId };
}

// depth=3 — logs here show the full path: handleCheckout › processPayment › chargeCard › verifyFunds
async function verifyFunds(cartId, amount) {
  logger.debug(`Contacting bank to verify $${amount} available for cart=${cartId}`);
  await delay(35);
  logger.info(`Bank confirmed sufficient funds for cart=${cartId}`);
  logger.debug(`Funds verification complete — clearing $${amount}`);
}

// ---------------------------------------------------------------------------
// JSON logging demo — separate tracer instance with logFormat: 'json'
// Runs the same checkout flow so you can compare structured output
// against the pretty-printed version above.
// ---------------------------------------------------------------------------

const jsonTracer = createTracer({ logFormat: 'json' });

async function handleCheckoutJson(cartId) {
  jsonTracer.logger.info(`Checkout started for cart=${cartId}`);
  const result = await jsonSvc.processPaymentJson(cartId, 149.99);
  jsonTracer.logger.info(`Checkout complete for cart=${cartId} — txId=${result.txId}`);
  return result;
}

async function processPaymentJson(cartId, amount) {
  jsonTracer.logger.info(`Processing payment of $${amount} for cart=${cartId}`);
  await jsonSvc.chargeCardJson(cartId, amount);
  const txId = `TX-${cartId}-${Date.now()}`;
  jsonTracer.logger.info(`Payment authorised — txId=${txId}`);
  return { txId };
}

async function chargeCardJson(cartId, amount) {
  jsonTracer.logger.info(`Charging card $${amount} for cart=${cartId}`);
  await jsonSvc.verifyFundsJson(cartId, amount);
  await delay(20);
  jsonTracer.logger.info(`Card charged for cart=${cartId}`);
}

async function verifyFundsJson(cartId, amount) {
  jsonTracer.logger.debug(`Contacting bank to verify $${amount} for cart=${cartId}`);
  await delay(35);
  jsonTracer.logger.info(`Bank confirmed sufficient funds for cart=${cartId}`);
}

const jsonSvc = jsonTracer.traceAll({
  handleCheckoutJson,
  processPaymentJson,
  chargeCardJson,
  verifyFundsJson,
});

// ---------------------------------------------------------------------------
// Export — tracing applied once at the boundary using fn-tracer
// ---------------------------------------------------------------------------

const svc = traceAll({
  processOrder,
  validateOrder,
  loadCustomer,
  fetchCustomerFromDb,
  calculatePrice,
  saveOrder,
  publishOrderEvent,
  generateInvoice,
  loadInvoice,
  renderInvoicePdf,
  storeInvoice,
  handleCheckout,
  processPayment,
  validatePaymentDetails,
  chargeCard,
  verifyFunds,
});

// ---------------------------------------------------------------------------
// Demo
// ---------------------------------------------------------------------------

async function main() {
  logger.info('=== [fn-tracer] Starting concurrent flows ===');

  await Promise.all([
    svc.processOrder('ORD-1'),
    svc.processOrder('ORD-2'),
    svc.generateInvoice('INV-1'),
  ]);

  logger.info('=== [fn-tracer] All concurrent flows completed ===\n');

  logger.info('=== [fn-tracer] Starting error-path demo ===');

  await svc.processOrder('bad').catch((err) => {
    logger.info(`Error-path demo caught expected error: "${err.message}"`);
  });

  logger.info('=== [fn-tracer] Error-path demo complete ===\n');

  // -------------------------------------------------------------------------
  // Deep-trace demo
  //
  // handleCheckout (depth=0) → processPayment (depth=1)
  //   → chargeCard (depth=2) → verifyFunds (depth=3)
  //
  // Every log line emitted inside verifyFunds carries the full call path:
  //   handleCheckout › processPayment › chargeCard › verifyFunds
  // -------------------------------------------------------------------------
  logger.info('=== [fn-tracer] Starting deep-trace demo ===');

  await svc.handleCheckout('CART-99');

  logger.info('=== [fn-tracer] Deep-trace demo complete ===\n');

  // -------------------------------------------------------------------------
  // JSON output demo
  //
  // Same checkout flow, but using a createTracer({ logFormat: 'json' })
  // instance. Every log line is emitted as a structured JSON object with
  // traceId, spanId, depth, path, and message — ready for Datadog / Loki /
  // CloudWatch ingestion.
  // -------------------------------------------------------------------------
  console.log('=== [fn-tracer] Starting JSON-output demo ===');

  await jsonSvc.handleCheckoutJson('CART-42');

  console.log('=== [fn-tracer] JSON-output demo complete ===');
}

main().catch((err) => {
  console.error('Unexpected top-level error:', err);
  process.exit(1);
});
