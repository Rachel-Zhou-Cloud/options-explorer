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

// Config
const MAX_EXPIRY_DATES = 3;          // Fetch up to 3 nearest expiry dates
const STRIKE_RANGE_PCT = 0.20;       // ±20% of current price
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

function filterStrikes(contracts, currentPrice) {
  const lo = currentPrice * (1 - STRIKE_RANGE_PCT);
  const hi = currentPrice * (1 + STRIKE_RANGE_PCT);
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

async function fetchOptionsForTicker(ticker, currentPrice) {
  const chainsByExpiry = {};

  try {
    // First call: get available expiry dates + chain for nearest expiry
    const firstResult = await yahooFinance.options(ticker);
    if (!firstResult) return chainsByExpiry;

    const expiryDates = firstResult.expirationDates || [];
    const expiryList = expiryDates.slice(0, MAX_EXPIRY_DATES);

    // Process the first expiry's data (included in the initial response)
    if (firstResult.options && firstResult.options.length > 0) {
      const opt = firstResult.options[0];
      const expiryStr = dateToStr(opt.expirationDate);
      chainsByExpiry[expiryStr] = {
        calls: filterStrikes(opt.calls || [], currentPrice),
        puts: filterStrikes(opt.puts || [], currentPrice),
      };
    }

    // Fetch remaining expiry dates
    for (let i = 1; i < expiryList.length; i++) {
      await sleep(DELAY_BETWEEN_EXPIRIES_MS);
      try {
        const expiryDate = expiryList[i];
        // yahoo-finance2 v3 accepts Date object for date param
        const result = await yahooFinance.options(ticker, { date: new Date(expiryDate) });
        if (result && result.options && result.options.length > 0) {
          const opt = result.options[0];
          const expiryStr = dateToStr(opt.expirationDate);
          chainsByExpiry[expiryStr] = {
            calls: filterStrikes(opt.calls || [], currentPrice),
            puts: filterStrikes(opt.puts || [], currentPrice),
          };
        }
      } catch (err) {
        log(`  [WARN] Options expiry #${i} failed for ${ticker}: ${err.message}`);
      }
    }
  } catch (err) {
    log(`  [WARN] Options chain failed for ${ticker}: ${err.message}`);
  }

  return chainsByExpiry;
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
        log(`  OK: $${quote.price} | ${expiryCount} expiry dates`);
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
