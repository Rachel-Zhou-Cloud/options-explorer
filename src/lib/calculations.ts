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
