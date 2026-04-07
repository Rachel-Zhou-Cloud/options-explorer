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
