/**
 * Yahoo Finance Options Data Fetcher
 * Runs in GitHub Actions to fetch stock quotes + options chains.
 * Writes results to public/data/market-data.json for the PWA to consume.
 */

import YahooFinance from 'yahoo-finance2';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Instantiate yahoo-finance2 v3
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
const ROOT = path.resolve(__dirname, '..');
const WATCHLIST_PATH = path.join(ROOT, 'data', 'watchlist.json');
const OUTPUT_PATH = path.join(ROOT, 'public', 'data', 'market-data.json');

// Config — 3-tier date selection to avoid gaps
const MAX_WEEKLY_EXPIRIES = 2;       // Nearest weekly dates (< 14 days out)
const MAX_MONTHLY_EXPIRIES = 3;      // Monthly dates (14–90 days out, e.g. Jun/Jul monthlies)
const MAX_LEAP_EXPIRIES = 3;         // LEAP dates (90+ days out)
const WEEKLY_THRESHOLD_DAYS = 14;    // < 14 days = weekly
const LEAP_THRESHOLD_DAYS = 90;      // >= 90 days = LEAP
const STRIKE_RANGE_PCT = 0.20;       // ±20% of current price (weekly/monthly)
const STRIKE_RANGE_LEAP_PCT = 0.30;  // ±30% for LEAPs (wider range)
const DELAY_BETWEEN_TICKERS_MS = 1000;
const DELAY_BETWEEN_EXPIRIES_MS = 500;
const QUOTE_TIMEOUT_MS = 10000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function loadWatchlist() {
  const raw = fs.readFileSync(WATCHLIST_PATH, 'utf-8');
  const tickers = JSON.parse(raw);
  if (!Array.isArray(tickers) || tickers.length === 0) {
    throw new Error('watchlist.json is empty or invalid');
  }
  return tickers.map(t => t.trim().toUpperCase());
}

async function fetchQuote(ticker) {
  try {
    const result = await yahooFinance.quote(ticker);
    if (!result || !result.regularMarketPrice) return null;
    return {
      price: result.regularMarketPrice,
      change: result.regularMarketChange || 0,
      changePercent: result.regularMarketChangePercent || 0,
      name: result.shortName || result.longName || ticker,
    };
  } catch (err) {
    log(`  [WARN] Quote failed for ${ticker}: ${err.message}`);
    return null;
  }
}

function filterStrikes(contracts, currentPrice, rangePct) {
  const lo = currentPrice * (1 - rangePct);
  const hi = currentPrice * (1 + rangePct);
  return contracts
    .filter(c => c.strike >= lo && c.strike <= hi)
    .map(c => ({
      strike: round2(c.strike),
      bid: round2(c.bid || 0),
      ask: round2(c.ask || 0),
      last: round2(c.lastPrice || 0),
      iv: round4(c.impliedVolatility || 0),
      volume: c.volume || 0,
      oi: c.openInterest || 0,
    }));
}

function round2(n) { return Math.round(n * 100) / 100; }
function round4(n) { return Math.round(n * 10000) / 10000; }

/**
 * Check if a date string is a standard monthly options expiry (3rd Friday of the month).
 * US equity options standard monthly expiry = 3rd Friday, which falls on days 15–21.
 */
function isStandardMonthly(dateStr) {
  const d = new Date(dateStr);
  const dayOfWeek = d.getUTCDay();   // 5 = Friday
  const dayOfMonth = d.getUTCDate();
  return dayOfWeek === 5 && dayOfMonth >= 15 && dayOfMonth <= 21;
}

/**
 * Select expiry dates in 3 tiers to avoid coverage gaps:
 * - Weekly:  < 14 days out  (up to 2 — nearest weeklies)
 * - Monthly: 14–90 days out (standard monthly expiries only — 3rd Friday of each month)
 * - LEAP:    90+ days out   (up to 3 — far-out dates)
 *
 * By filtering for standard monthlies, we skip the many weekly dates (May 22, May 29, etc.)
 * and directly get the key dates like May 15, Jun 19, Jul 17.
 */
function selectExpiryDates(expiryDates) {
  const now = Date.now();
  const weeklyCutoff = now + WEEKLY_THRESHOLD_DAYS * 86400000;
  const leapCutoff = now + LEAP_THRESHOLD_DAYS * 86400000;

  const weekly = [];
  const monthly = [];
  const leap = [];

  // First pass: pick standard monthly expiries in the 14–90 day range
  for (const d of expiryDates) {
    const ts = new Date(d).getTime();
    if (isNaN(ts)) continue;
    if (ts < weeklyCutoff) {
      if (weekly.length < MAX_WEEKLY_EXPIRIES) weekly.push(d);
    } else if (ts < leapCutoff) {
      // Only pick standard monthly expiry dates (3rd Friday)
      if (monthly.length < MAX_MONTHLY_EXPIRIES && isStandardMonthly(d)) {
        monthly.push(d);
      }
    } else {
      if (leap.length < MAX_LEAP_EXPIRIES) leap.push(d);
    }
    if (weekly.length >= MAX_WEEKLY_EXPIRIES && monthly.length >= MAX_MONTHLY_EXPIRIES && leap.length >= MAX_LEAP_EXPIRIES) break;
  }

  // Fallback: if no standard monthlies found, pick any dates in the range (one per calendar month)
  if (monthly.length === 0) {
    const monthsSeen = new Set();
    for (const d of expiryDates) {
      if (monthly.length >= MAX_MONTHLY_EXPIRIES) break;
      const ts = new Date(d).getTime();
      if (isNaN(ts) || ts < weeklyCutoff || ts >= leapCutoff) continue;
      const monthKey = d.slice(0, 7);
      if (!monthsSeen.has(monthKey)) {
        monthsSeen.add(monthKey);
        monthly.push(d);
      }
    }
  }

  return { weekly, monthly, leap };
}

async function fetchOptionsForTicker(ticker, currentPrice) {
  const chainsByExpiry = {};

  try {
    // First call: get available expiry dates + chain for nearest expiry
    const firstResult = await yahooFinance.options(ticker);
    if (!firstResult) return chainsByExpiry;

    const expiryDates = firstResult.expirationDates || [];
    log(`  Yahoo expiry dates (${expiryDates.length} total): ${expiryDates.map(dateToStr).join(', ')}`);
    const { weekly, monthly, leap } = selectExpiryDates(expiryDates);
    const allExpiries = [...weekly, ...monthly, ...leap];
    log(`  Selected: weekly=[${weekly.map(dateToStr)}] monthly=[${monthly.map(dateToStr)}] leap=[${leap.map(dateToStr)}]`);

    // Process the first expiry's data (included in the initial response)
    if (firstResult.options && firstResult.options.length > 0) {
      const opt = firstResult.options[0];
      const expiryStr = dateToStr(opt.expirationDate);
      const rangePct = isLeapDate(opt.expirationDate) ? STRIKE_RANGE_LEAP_PCT : STRIKE_RANGE_PCT;
      chainsByExpiry[expiryStr] = {
        calls: filterStrikes(opt.calls || [], currentPrice, rangePct),
        puts: filterStrikes(opt.puts || [], currentPrice, rangePct),
      };
    }

    // Fetch remaining selected expiry dates
    for (let i = 0; i < allExpiries.length; i++) {
      const expiryDate = allExpiries[i];
      const expiryStr = dateToStr(expiryDate);
      if (chainsByExpiry[expiryStr]) continue; // Already fetched (first result)
      await sleep(DELAY_BETWEEN_EXPIRIES_MS);
      try {
        const result = await yahooFinance.options(ticker, { date: new Date(expiryDate) });
        if (result && result.options && result.options.length > 0) {
          const opt = result.options[0];
          const str = dateToStr(opt.expirationDate);
          const rangePct = isLeapDate(opt.expirationDate) ? STRIKE_RANGE_LEAP_PCT : STRIKE_RANGE_PCT;
          chainsByExpiry[str] = {
            calls: filterStrikes(opt.calls || [], currentPrice, rangePct),
            puts: filterStrikes(opt.puts || [], currentPrice, rangePct),
          };
        }
      } catch (err) {
        log(`  [WARN] Options expiry ${expiryStr} failed for ${ticker}: ${err.message}`);
      }
    }
  } catch (err) {
    log(`  [WARN] Options chain failed for ${ticker}: ${err.message}`);
  }

  return chainsByExpiry;
}

function isLeapDate(d) {
  const ts = (d instanceof Date ? d : new Date(d)).getTime();
  return ts - Date.now() > LEAP_THRESHOLD_DAYS * 86400000;
}

function dateToStr(d) {
  if (!d) return '';
  const date = d instanceof Date ? d : new Date(d);
  return date.toISOString().split('T')[0]; // YYYY-MM-DD
}

async function main() {
  log('=== Yahoo Finance Data Fetch Start ===');

  const watchlist = await loadWatchlist();
  log(`Watchlist: ${watchlist.length} tickers`);

  const result = {
    timestamp: new Date().toISOString(),
    quotes: {},
    options: {},
    errors: [],
  };

  let successCount = 0;

  for (let i = 0; i < watchlist.length; i++) {
    const ticker = watchlist[i];
    log(`[${i + 1}/${watchlist.length}] Fetching ${ticker}...`);

    // Fetch quote
    const quote = await fetchQuote(ticker);
    if (quote) {
      result.quotes[ticker] = quote;
      successCount++;

      // Fetch options chain (only if we have a price to filter strikes)
      const chains = await fetchOptionsForTicker(ticker, quote.price);
      const expiryCount = Object.keys(chains).length;
      if (expiryCount > 0) {
        result.options[ticker] = chains;
        log(`  OK: $${quote.price} | ${expiryCount} expiries [${Object.keys(chains).sort().join(', ')}]`);
      } else {
        log(`  OK: $${quote.price} | no options data`);
      }
    } else {
      result.errors.push(ticker);
      log(`  FAILED: no quote data`);
    }

    // Rate limit between tickers
    if (i < watchlist.length - 1) {
      await sleep(DELAY_BETWEEN_TICKERS_MS);
    }
  }

  log(`\nResults: ${successCount}/${watchlist.length} quotes, ${Object.keys(result.options).length} with options`);

  if (successCount === 0) {
    log('ERROR: All tickers failed. Not writing output.');
    process.exit(1);
  }

  // Ensure output directory exists
  const outputDir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Write compact JSON (no pretty-print to minimize size)
  const json = JSON.stringify(result);
  fs.writeFileSync(OUTPUT_PATH, json, 'utf-8');
  const sizeKB = (Buffer.byteLength(json) / 1024).toFixed(1);
  log(`Written to ${OUTPUT_PATH} (${sizeKB} KB)`);

  if (result.errors.length > 0) {
    log(`Failed tickers: ${result.errors.join(', ')}`);
  }

  log('=== Done ===');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
