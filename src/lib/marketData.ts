import type { Position, StaticMarketData, OptionContract } from '@/types'

const TWELVE_DATA_BASE = 'https://api.twelvedata.com'

export interface QuoteResult {
  price: number
  change: number
  percentChange: number
  name: string
}

export type QuoteMap = Record<string, QuoteResult>

interface TwelveDataQuote {
  symbol: string
  name: string
  close: string
  previous_close: string
  change: string
  percent_change: string
  is_market_open: boolean
}

interface TwelveDataError {
  code: number
  message: string
  status: string
}

function isTwelveDataError(obj: unknown): obj is TwelveDataError {
  return typeof obj === 'object' && obj !== null && 'code' in obj && 'status' in obj
}

/**
 * Fetch stock quotes from Twelve Data API.
 * Supports batch queries: multiple tickers in one request.
 */
export async function fetchQuotes(
  tickers: string[],
  apiKey: string
): Promise<QuoteMap> {
  if (tickers.length === 0) return {}
  if (!apiKey) throw new Error('请先配置 API Key')

  const uniqueTickers = [...new Set(tickers.map(t => t.toUpperCase()))]
  const symbolParam = uniqueTickers.join(',')
  const url = `${TWELVE_DATA_BASE}/quote?symbol=${symbolParam}&apikey=${apiKey}`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)

  try {
    const response = await fetch(url, { signal: controller.signal })

    if (!response.ok) {
      if (response.status === 401) throw new Error('API Key 无效，请检查设置')
      if (response.status === 429) throw new Error('API 调用次数已达上限，请明天再试')
      throw new Error(`请求失败 (${response.status})`)
    }

    const data = await response.json()

    // Single ticker returns a single object; multiple tickers returns an object keyed by symbol
    const result: QuoteMap = {}

    if (uniqueTickers.length === 1) {
      const quote = data as TwelveDataQuote | TwelveDataError
      if (isTwelveDataError(quote)) {
        throw new Error(`${uniqueTickers[0]}: ${quote.message}`)
      }
      result[quote.symbol.toUpperCase()] = parseQuote(quote as TwelveDataQuote)
    } else {
      // Multiple tickers: data is keyed by symbol
      for (const ticker of uniqueTickers) {
        const quote = data[ticker]
        if (!quote || isTwelveDataError(quote)) continue
        result[ticker] = parseQuote(quote as TwelveDataQuote)
      }
    }

    return result
  } catch (err) {
    if (err instanceof Error) {
      if (err.name === 'AbortError') throw new Error('请求超时，请检查网络')
      throw err
    }
    throw new Error('未知错误')
  } finally {
    clearTimeout(timeout)
  }
}

function parseQuote(quote: TwelveDataQuote): QuoteResult {
  return {
    price: parseFloat(quote.close) || 0,
    change: parseFloat(quote.change) || 0,
    percentChange: parseFloat(quote.percent_change) || 0,
    name: quote.name || '',
  }
}

/**
 * Fetch a single stock quote. Convenience wrapper.
 */
export async function fetchSingleQuote(
  ticker: string,
  apiKey: string
): Promise<QuoteResult | null> {
  const result = await fetchQuotes([ticker], apiKey)
  return result[ticker.toUpperCase()] || null
}

// ===== Static Market Data (Yahoo Finance via GitHub Actions) =====

const STATIC_DATA_URL = `${import.meta.env.BASE_URL}data/market-data.json`

let cachedData: StaticMarketData | null = null
let cacheTimestamp = 0
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Fetch the static market data JSON from GitHub Pages.
 * Caches in memory for 5 minutes to avoid redundant fetches.
 */
export async function fetchStaticMarketData(): Promise<StaticMarketData | null> {
  const now = Date.now()
  if (cachedData && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedData
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)

  try {
    // Cache-bust rounded to 5-min intervals so CDN doesn't cache indefinitely
    const cacheBust = Math.floor(now / (5 * 60 * 1000))
    const response = await fetch(`${STATIC_DATA_URL}?v=${cacheBust}`, {
      signal: controller.signal,
    })
    if (!response.ok) return null
    const data = await response.json() as StaticMarketData
    if (!data || !data.timestamp || !data.quotes) return null
    cachedData = data
    cacheTimestamp = now
    return data
  } catch {
    return cachedData // Return stale cache on error
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Check if the static data is still fresh.
 */
export function isDataFresh(timestamp: string, maxAgeMinutes: number = 120): boolean {
  const dataTime = new Date(timestamp).getTime()
  if (isNaN(dataTime)) return false
  return Date.now() - dataTime < maxAgeMinutes * 60 * 1000
}

/**
 * Get a stock quote from the static market data (same format as QuoteResult).
 */
export function getQuoteFromStaticData(
  ticker: string,
  data: StaticMarketData
): QuoteResult | null {
  const q = data.quotes[ticker.toUpperCase()]
  if (!q) return null
  return {
    price: q.price,
    change: q.change,
    percentChange: q.changePercent,
    name: q.name,
  }
}

/**
 * Match a position to its specific option contract in the static data.
 * Returns the matched OptionContract (with IV, bid, ask, volume, OI) or null.
 */
export function matchOptionData(
  position: Position,
  data: StaticMarketData
): OptionContract | null {
  if (position.type === 'stock' || position.type === 'custom') return null
  if (!position.expirationDate) return null

  const ticker = position.ticker.toUpperCase()
  const tickerOptions = data.options[ticker]
  if (!tickerOptions) return null

  // Find the matching expiry date
  const posExpiry = position.expirationDate.split('T')[0] // YYYY-MM-DD
  const chain = tickerOptions[posExpiry]
  if (!chain) {
    // Try to find the closest expiry within 3 days
    const posDate = new Date(posExpiry).getTime()
    let closest: { key: string; diff: number } | null = null
    for (const key of Object.keys(tickerOptions)) {
      const diff = Math.abs(new Date(key).getTime() - posDate)
      if (diff <= 3 * 86400000 && (!closest || diff < closest.diff)) {
        closest = { key, diff }
      }
    }
    if (!closest) return null
    return findContract(tickerOptions[closest.key], position)
  }

  return findContract(chain, position)
}

function findContract(
  chain: { calls: OptionContract[]; puts: OptionContract[] },
  position: Position
): OptionContract | null {
  const isPut = position.type === 'sell_put' || position.type === 'buy_put'
  const contracts = isPut ? chain.puts : chain.calls

  // Find exact or closest strike within $0.50
  let best: OptionContract | null = null
  let bestDiff = Infinity
  for (const c of contracts) {
    const diff = Math.abs(c.strike - position.strikePrice)
    if (diff < bestDiff) {
      bestDiff = diff
      best = c
    }
  }
  return bestDiff <= 0.5 ? best : null
}

/**
 * Format how long ago the data was updated.
 */
export function formatDataAge(timestamp: string): string {
  const ms = Date.now() - new Date(timestamp).getTime()
  if (isNaN(ms) || ms < 0) return ''
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return '刚刚更新'
  if (mins < 60) return `${mins} 分钟前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}
