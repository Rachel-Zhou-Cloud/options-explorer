export type PositionType = 'sell_put' | 'sell_call' | 'leap_call' | 'buy_call' | 'buy_put' | 'stock' | 'custom'

export interface Position {
  id: string
  type: PositionType
  ticker: string
  /** For options: strike price; for stocks: buy price */
  strikePrice: number
  /** Current underlying price */
  currentPrice: number
  /** Number of contracts or shares */
  quantity: number
  /** Premium received (sell) or paid (buy), per share */
  premium: number
  /** Cost basis per share (for stocks) */
  costBasis?: number
  /** Expiration date ISO string (for options) */
  expirationDate?: string
  /** Date position was opened ISO string */
  openDate: string
  /** Current market value of the option premium */
  currentPremium?: number
  /** Notes */
  notes?: string
  /** Whether position is closed */
  isClosed: boolean
  /** Close date */
  closeDate?: string
  /** Close premium (for options) or close price (for stocks) */
  closePremium?: number
  /** Linked parent position ID (e.g. sell_call linked to a LEAP/stock) */
  linkedPositionId?: string
  /** Custom type name when type is 'custom' */
  customTypeName?: string
}

export interface ClosedTrade {
  id: string
  type: PositionType
  ticker: string
  strikePrice: number
  premium: number
  closePremium: number
  quantity: number
  openDate: string
  closeDate: string
  expirationDate?: string
  /** Realized P&L per share */
  pnl: number
  /** Realized P&L percentage */
  pnlPercent: number
  /** Whether it's a win */
  isWin: boolean
}

/** A record of premium income that reduces the cost basis of a long position */
export interface CostRecord {
  id: string
  /** The parent position ID (LEAP call or stock) this income is linked to */
  parentPositionId: string
  /** Description, e.g. "Sell AAPL 160C 4/18" */
  description: string
  /** Premium collected per share */
  premiumCollected: number
  /** Number of contracts or shares involved */
  quantity: number
  /** Date this income was realized */
  date: string
  /** Source type */
  source: 'sell_call' | 'day_trade' | 'other'
}

export interface CalculatorInputs {
  strikePrice: number
  underlyingPrice: number
  daysToExpiry: number
  premium: number
}

export interface CalculatorResult {
  /** Premium / Strike annualized */
  annualizedByStrike: number
  /** Premium / Margin annualized */
  annualizedByMargin: number
  /** IBKR margin requirement */
  marginRequired: number
  /** Premium / Strike raw */
  returnByStrike: number
  /** Premium / Margin raw */
  returnByMargin: number
}

// ===== Static Market Data (from Yahoo Finance via GitHub Actions) =====

export interface OptionContract {
  strike: number
  bid: number
  ask: number
  last: number
  /** Implied volatility (decimal, e.g. 0.2845 = 28.45%) */
  iv: number
  volume: number
  /** Open interest */
  oi: number
}

export interface StaticQuote {
  price: number
  change: number
  changePercent: number
  name: string
}

export interface StaticMarketData {
  timestamp: string
  quotes: Record<string, StaticQuote>
  options: Record<string, Record<string, { calls: OptionContract[]; puts: OptionContract[] }>>
  errors?: string[]
}
