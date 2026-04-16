'use strict';

const { traceAll } = require('./tracer');
const { logger } = require('./logger');

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// processOrder flow — plain functions, no tracing code inside
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

// Sync function — withTrace handles sync just fine via traceAll
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
      // setTimeout callback — ALS still has the correct context
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
// generateInvoice flow — plain functions
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
// Export — tracing applied once here, not scattered through function bodies
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
});

module.exports = svc;
