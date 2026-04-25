import type { CalculatorInputs, CalculatorResult } from '@/types'

/**
 * IBKR Reg T margin for short naked put:
 * Margin = max(
 *   25% × Underlying Price - OTM Amount + Premium,
 *   10% × Strike Price + Premium
 * )
 * OTM Amount (for put) = max(0, Underlying Price - Strike Price)
 * Minimum per contract = $2.50 × 100 shares
 */
export function calculateIBKRMargin(
  underlyingPrice: number,
  strikePrice: number,
  premium: number
): number {
  const otmAmount = Math.max(0, underlyingPrice - strikePrice)
  const method1 = 0.25 * underlyingPrice - otmAmount + premium
  const method2 = 0.10 * strikePrice + premium
  const minPerShare = 2.50
  return Math.max(method1, method2, minPerShare)
}

/**
 * Calculate annualized returns for sell put options
 */
export function calculateAnnualizedReturn(inputs: CalculatorInputs): CalculatorResult {
  const { strikePrice, underlyingPrice, daysToExpiry, premium } = inputs

  const marginRequired = calculateIBKRMargin(underlyingPrice, strikePrice, premium)

  const returnByStrike = premium / strikePrice
  const returnByMargin = premium / marginRequired

  const annualFactor = 365 / daysToExpiry
  const annualizedByStrike = returnByStrike * annualFactor
  const annualizedByMargin = returnByMargin * annualFactor

  return {
    annualizedByStrike,
    annualizedByMargin,
    marginRequired,
    returnByStrike,
    returnByMargin,
  }
}

/**
 * Calculate days remaining until expiration
 */
export function daysUntilExpiry(expirationDate: string): number {
  const now = new Date()
  const expiry = new Date(expirationDate)
  const diff = expiry.getTime() - now.getTime()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

/**
 * Check if position expires within N days
 */
export function expiresWithinDays(expirationDate: string, days: number): boolean {
  const remaining = daysUntilExpiry(expirationDate)
  return remaining >= 0 && remaining <= days
}

/**
 * Check if current price is within ±percentage of strike
 */
export function isNearStrike(currentPrice: number, strikePrice: number, percentThreshold: number): boolean {
  const ratio = Math.abs(currentPrice - strikePrice) / strikePrice
  return ratio <= percentThreshold / 100
}

/**
 * Calculate profit percentage for a sell put position
 * Sell Put profit = (premium received - current premium) / premium received
 */
export function calculateProfitPercent(premiumReceived: number, currentPremium: number): number {
  if (premiumReceived === 0) return 0
  return ((premiumReceived - currentPremium) / premiumReceived) * 100
}

/**
 * Format number as percentage
 */
export function formatPercent(value: number, decimals: number = 2): string {
  return `${(value * 100).toFixed(decimals)}%`
}

/**
 * Format number as currency
 */
export function formatCurrency(value: number): string {
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/**
 * Generate a unique ID
 */
export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2)
}

/**
 * Format date string
 */
export function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

export function formatDateFull(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

// ===== Black-Scholes Greeks & Moneyness =====

/** Standard normal CDF approximation (Abramowitz & Stegun) */
function normCdf(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911
  const sign = x < 0 ? -1 : 1
  const t = 1 / (1 + p * Math.abs(x))
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x / 2)
  return 0.5 * (1 + sign * y)
}

/** Standard normal PDF */
function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI)
}

export type OptionSide = 'call' | 'put'

export interface GreeksResult {
  delta: number
  theta: number       // per calendar day
  vega: number        // per 1.0 IV change (per share)
  gamma: number       // rate of change of delta per $1 move
  moneyness: 'ITM' | 'ATM' | 'OTM'
  moneynessPercent: number  // how far OTM/ITM as % of strike
  intrinsicValue: number    // per share
  timeValue: number         // per share
  impliedMove: number       // 1-sigma move in $ by expiry
}

/**
 * Estimate Greeks using Black-Scholes.
 * Uses a default IV of 30% if not provided (typical for equity options).
 * Risk-free rate defaults to 4.5%.
 */
export function estimateGreeks(
  side: OptionSide,
  underlyingPrice: number,
  strikePrice: number,
  daysToExpiry: number,
  optionPrice: number,
  iv?: number,
  riskFreeRate: number = 0.045,
): GreeksResult | null {
  if (underlyingPrice <= 0 || strikePrice <= 0 || daysToExpiry <= 0) return null

  const T = daysToExpiry / 365
  const S = underlyingPrice
  const K = strikePrice
  const r = riskFreeRate

  // Estimate IV from option price if not provided (simplified Newton's method)
  let sigma = iv ?? estimateIV(side, S, K, T, r, optionPrice)
  if (sigma <= 0) sigma = 0.30 // fallback

  const sqrtT = Math.sqrt(T)
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT)
  const d2 = d1 - sigma * sqrtT

  // Delta
  const delta = side === 'call' ? normCdf(d1) : normCdf(d1) - 1

  // Theta (per calendar day)
  const npd1 = normPdf(d1)
  const thetaComponent1 = -(S * npd1 * sigma) / (2 * sqrtT)
  const theta = side === 'call'
    ? (thetaComponent1 - r * K * Math.exp(-r * T) * normCdf(d2)) / 365
    : (thetaComponent1 + r * K * Math.exp(-r * T) * normCdf(-d2)) / 365

  // Vega: per 1.0 IV change (per share)
  const vega = S * npd1 * sqrtT

  // Gamma: same for calls and puts
  const gamma = npd1 / (S * sigma * sqrtT)

  // Moneyness
  const moneynessPercent = ((S - K) / K) * 100
  let moneyness: 'ITM' | 'ATM' | 'OTM'
  if (Math.abs(moneynessPercent) < 2) {
    moneyness = 'ATM'
  } else if (side === 'call') {
    moneyness = S > K ? 'ITM' : 'OTM'
  } else {
    moneyness = S < K ? 'ITM' : 'OTM'
  }

  // Intrinsic & time value
  const intrinsicValue = side === 'call'
    ? Math.max(0, S - K)
    : Math.max(0, K - S)
  const timeValue = Math.max(0, optionPrice - intrinsicValue)

  // 1-sigma implied move
  const impliedMove = S * sigma * sqrtT

  return { delta, theta, vega, gamma, moneyness, moneynessPercent, intrinsicValue, timeValue, impliedMove }
}

/** Simple IV estimation via bisection */
function estimateIV(
  side: OptionSide,
  S: number, K: number, T: number, r: number,
  marketPrice: number,
): number {
  if (marketPrice <= 0) return 0.30

  let lo = 0.01, hi = 3.0
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2
    const price = bsPrice(side, S, K, T, r, mid)
    if (price > marketPrice) {
      hi = mid
    } else {
      lo = mid
    }
    if (Math.abs(price - marketPrice) < 0.001) break
  }
  return (lo + hi) / 2
}

/** Black-Scholes option price */
function bsPrice(side: OptionSide, S: number, K: number, T: number, r: number, sigma: number): number {
  const sqrtT = Math.sqrt(T)
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT)
  const d2 = d1 - sigma * sqrtT
  if (side === 'call') {
    return S * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2)
  }
  return K * Math.exp(-r * T) * normCdf(-d2) - S * normCdf(-d1)
}

