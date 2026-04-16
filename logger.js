'use strict';

const winston = require('winston');
const { getContext } = require('./tracer');

// ---------------------------------------------------------------------------
// ANSI color helpers
// ---------------------------------------------------------------------------

const A = {
  reset:      '\x1b[0m',
  bold:       '\x1b[1m',
  dim:        '\x1b[2m',
  red:        '\x1b[31m',
  green:      '\x1b[32m',
  yellow:     '\x1b[33m',
  blue:       '\x1b[34m',
  magenta:    '\x1b[35m',
  cyan:       '\x1b[36m',
  white:      '\x1b[37m',
  gray:       '\x1b[90m',
  bgRed:      '\x1b[41m',
  bgGreen:    '\x1b[42m',
};

const c = (code, str) => `${code}${str}${A.reset}`;

function shortId(uuid) {
  return uuid ? uuid.slice(0, 8) : '--------';
}

// ---------------------------------------------------------------------------
// Level badges  (fixed-width so columns line up)
// ---------------------------------------------------------------------------

const LEVEL_BADGE = {
  error:   c(A.bold + A.red,     ' ERROR '),
  warn:    c(A.bold + A.yellow,  '  WARN '),
  info:    c(A.bold + A.green,   '  INFO '),
  debug:   c(A.bold + A.blue,    ' DEBUG '),
  verbose: c(A.bold + A.cyan,    '  VERB '),
};

// ---------------------------------------------------------------------------
// Span status badges
// ---------------------------------------------------------------------------

const SPAN_BADGE = {
  enter: c(A.bold + A.green,   ' → '),
  exit:  c(A.bold + A.cyan,    ' ← '),
  error: c(A.bold + A.red,     ' ✖ '),
};

// ---------------------------------------------------------------------------
// Custom format — getContext() called at emit time, not at logger creation
// ---------------------------------------------------------------------------

const prettyFormat = winston.format.printf((info) => {
  const ctx    = getContext();
  const status = info.status || '';

  // ── Trace IDs ─────────────────────────────────────────────────────────────
  const traceId = ctx
    ? c(A.bold + A.cyan,    shortId(ctx.traceId))
    : c(A.gray,             '--------');

  const spanId = ctx
    ? c(A.magenta,          shortId(ctx.spanId))
    : c(A.gray,             '--------');

  // ── Depth & indentation ───────────────────────────────────────────────────
  const depth  = ctx ? ctx.depth : 0;
  const indent = '  '.repeat(depth);

  // ── Call path (dimmed, at the end of the line) ────────────────────────────
  const pathStr = ctx
    ? c(A.dim + A.gray, ctx.path.join(' › '))
    : c(A.dim + A.gray, 'outside trace');

  // ── Timestamp ─────────────────────────────────────────────────────────────
  const now = new Date();
  const ts = c(A.gray,
    `${String(now.getHours()).padStart(2,'0')}:` +
    `${String(now.getMinutes()).padStart(2,'0')}:` +
    `${String(now.getSeconds()).padStart(2,'0')}.` +
    `${String(now.getMilliseconds()).padStart(3,'0')}`
  );

  // ── Level badge ───────────────────────────────────────────────────────────
  const level = LEVEL_BADGE[info.level] || LEVEL_BADGE.info;

  // ── Duration (shown on exit / error spans) ────────────────────────────────
  const duration = info.duration != null
    ? c(A.bold + A.yellow, ` ${info.duration}ms`)
    : '';

  // ── Compose the message part ──────────────────────────────────────────────
  let msg;
  if (status === 'enter') {
    const badge = SPAN_BADGE.enter;
    msg = `${badge}${indent}${c(A.bold + A.white, info.message)}`;
  } else if (status === 'exit') {
    const badge = SPAN_BADGE.exit;
    msg = `${badge}${indent}${c(A.white, info.message)}${duration}`;
  } else if (status === 'error') {
    const badge = SPAN_BADGE.error;
    msg = `${badge}${indent}${c(A.bold + A.red, info.message)}${duration}`;
  } else {
    // Regular log line — no badge, just indented message
    msg = `   ${indent}${info.message}`;
  }

  // ── Assemble the full line ─────────────────────────────────────────────────
  const ids  = `[${traceId}][${spanId}]`;
  let line = `${ts}  ${level}  ${ids}  ${msg}`;

  // Append the call path in gray (only when inside a trace)
  if (ctx) {
    line += `  ${c(A.dim, `(${pathStr})`)}`;
  }

  // Error detail on the next line
  if (info.errorMessage) {
    line +=
      `\n` +
      `${' '.repeat(12)}` +
      `  ${c(A.bold + A.red, '⚠')}  ` +
      `${c(A.red, info.errorMessage)}`;
  }

  return line;
});

// ---------------------------------------------------------------------------
// Logger instance
// ---------------------------------------------------------------------------

const logger = winston.createLogger({
  level: 'debug',
  format: winston.format.combine(
    winston.format.errors({ stack: true }),
    prettyFormat
  ),
  transports: [
    new winston.transports.Console(),
  ],
});

function logWithContext(level, message, meta = {}) {
  logger.log(level, message, meta);
}

module.exports = { logger, logWithContext };
