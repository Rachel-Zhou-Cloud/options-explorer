/**
 * Risk Calculations Engine
 * Pure calculation functions for the Risk Control tab.
 * Zero UI/React dependencies.
 */

import type { Position, OptionContract, StaticMarketData } from '@/types'
import {
  estimateGreeks,
  calculateIBKRMargin,
  daysUntilExpiry,
  type GreeksResult,
  type OptionSide,
} from '@/lib/calculations'
import { matchOptionData } from '@/lib/marketData'

// ===== Types =====

export interface EnrichedPosition {
  position: Position
  greeks: GreeksResult | null
  optionContract: OptionContract | null
  dte: number | null
}

export interface AccountMetrics {
  cashBalance: number
  stockMarketValue: number
  optionsMarketValue: number
  nav: number
  cashRatio: number
  totalSellPutMargin: number
  bprUtilization: number
}

export interface SellPutPositionRisk {
  positionId: string
  ticker: string
  strikePrice: number
  quantity: number
  notional: number
  effectiveExposure: number
  concentrationPercent: number
  exposurePercent: number
}

export interface SellPutRiskMetrics {
  grossNotional: number
  notionalRatio: number
  effectiveExposure: number
  exposureRate: number
  positions: SellPutPositionRisk[]
}

export interface StressTestResult {
  dropPercent: number
  stockResidual: number
  leapResidual: number
  availableFunds: number
  assignmentObligation: number
  safetyRatio: number
}

export interface PortfolioGreeks {
  netDelta: number
  dollarDelta: number
  netTheta: number
  netVega: number
  netGamma: number
}

export interface PositionMonitor {
  positionId: string
  ticker: string
  type: string
  strikePrice: number
  quantity: number
  pnlProgress: number
  signal: 'take_profit' | 'hold' | 'stop_loss'
  expiryRiskScore: number
  dte: number
  distancePercent: number
}

export type AlertLevel = 'red' | 'yellow' | 'green'

export interface Alert {
  level: AlertLevel
  category: string
  message: string
  positionId?: string
}

// ===== Thresholds =====

export const THRESHOLDS = {
  cashRatio: { healthy: 0.40, warning: 0.25 },
  bprUtilization: { healthy: 0.50, warning: 0.70 },
  singleExposure: { target: 0.20, warning: 0.30 },
  totalExposure: { target: 0.80, warning: 1.00 },
  notionalRatio: { healthy: 1.50, warning: 2.00 },
  safetyRatio: { healthy: 1.0, warning: 0.80, critical: 0.60 },
  dollarDeltaPct: { low: 0.40, high: 0.80, warning: 1.00 },
  netTheta: { idealLow: 10, idealHigh: 50, criticalNeg: -50 },
  netVega: { warning: -300 },
  pnlTakeProfit: 50,
  pnlStopLoss: -100,
  nearStrikePct: 5,
  nearExpiryDTE: 7,
  nakedPutConcentration: 0.30,
} as const

// ===== Helpers =====

const isOptionType = (t: string) => t !== 'stock'
const isSellType = (t: string) => t === 'sell_put' || t === 'sell_call'

function getOptionSide(type: string): OptionSide {
  return (type === 'sell_put' || type === 'buy_put') ? 'put' : 'call'
}

// ===== 1. Enrich Positions with Greeks =====

export function enrichPositionsWithGreeks(
  positions: Position[],
  marketData: StaticMarketData | null,
): EnrichedPosition[] {
  return positions.map(pos => {
    if (!isOptionType(pos.type) || !pos.expirationDate) {
      return { position: pos, greeks: null, optionContract: null, dte: null }
    }

    const dte = daysUntilExpiry(pos.expirationDate)
    const contract = marketData ? matchOptionData(pos, marketData) : null
    const iv = contract?.iv

    let greeks: GreeksResult | null = null
    if (dte > 0 && pos.currentPremium !== undefined) {
      greeks = estimateGreeks(
        getOptionSide(pos.type),
        pos.currentPrice,
        pos.strikePrice,
        dte,
        pos.currentPremium,
        iv,
      )
    }

    return { position: pos, greeks, optionContract: contract, dte }
  })
}

// ===== 2. Account Metrics =====

export function computeAccountMetrics(
  enriched: EnrichedPosition[],
  cashBalance: number,
): AccountMetrics {
  let stockMarketValue = 0
  let optionsMarketValue = 0
  let totalSellPutMargin = 0

  for (const { position: pos } of enriched) {
    if (pos.type === 'stock') {
      stockMarketValue += pos.currentPrice * pos.quantity
    } else if (pos.currentPremium !== undefined) {
      const value = pos.currentPremium * pos.quantity * 100
      if (isSellType(pos.type)) {
        optionsMarketValue -= value // liability
      } else {
        optionsMarketValue += value // asset
      }
    }

    if (pos.type === 'sell_put') {
      const margin = calculateIBKRMargin(pos.currentPrice, pos.strikePrice, pos.premium)
      totalSellPutMargin += margin * pos.quantity * 100
    }
  }

  const nav = cashBalance + stockMarketValue + optionsMarketValue
  const cashRatio = nav > 0 ? cashBalance / nav : 0
  const bprUtilization = nav > 0 ? totalSellPutMargin / nav : 0

  return {
    cashBalance,
    stockMarketValue,
    optionsMarketValue,
    nav,
    cashRatio,
    totalSellPutMargin,
    bprUtilization,
  }
}

// ===== 3. Sell Put Risk =====

export function computeSellPutRisk(
  enriched: EnrichedPosition[],
  nav: number,
): SellPutRiskMetrics {
  const sellPuts = enriched.filter(e => e.position.type === 'sell_put')

  let grossNotional = 0
  let effectiveExposure = 0
  const positions: SellPutPositionRisk[] = []

  for (const { position: pos, greeks } of sellPuts) {
    const notional = pos.strikePrice * 100 * pos.quantity
    const delta = greeks ? Math.abs(greeks.delta) : 0.3 // fallback delta
    const effective = pos.strikePrice * 100 * delta * pos.quantity

    grossNotional += notional
    effectiveExposure += effective

    positions.push({
      positionId: pos.id,
      ticker: pos.ticker,
      strikePrice: pos.strikePrice,
      quantity: pos.quantity,
      notional,
      effectiveExposure: effective,
      concentrationPercent: nav > 0 ? (notional / nav) * 100 : 0,
      exposurePercent: nav > 0 ? (effective / nav) * 100 : 0,
    })
  }

  return {
    grossNotional,
    notionalRatio: nav > 0 ? grossNotional / nav : 0,
    effectiveExposure,
    exposureRate: nav > 0 ? effectiveExposure / nav : 0,
    positions,
  }
}

// ===== 4. Stress Test =====

export function computeStressTest(
  enriched: EnrichedPosition[],
  cashBalance: number,
  dropPercent: number,
): StressTestResult {
  const dropFactor = 1 - dropPercent / 100
  let stockResidual = 0
  let leapResidual = 0
  let assignmentObligation = 0

  for (const { position: pos, greeks } of enriched) {
    if (pos.type === 'stock') {
      stockResidual += pos.currentPrice * dropFactor * pos.quantity
    } else if (pos.type === 'leap_call') {
      // LEAP residual value approximated with delta
      const delta = greeks?.delta ?? 0.7
      const currentValue = (pos.currentPremium ?? 0) * pos.quantity * 100
      leapResidual += currentValue * delta * dropFactor
    } else if (pos.type === 'sell_put') {
      assignmentObligation += pos.strikePrice * 100 * pos.quantity
    }
  }

  const availableFunds = cashBalance + stockResidual + leapResidual
  const safetyRatio = assignmentObligation > 0
    ? availableFunds / assignmentObligation
    : Infinity

  return {
    dropPercent,
    stockResidual,
    leapResidual,
    availableFunds,
    assignmentObligation,
    safetyRatio,
  }
}

// ===== 5. Portfolio Greeks =====

export function computePortfolioGreeks(enriched: EnrichedPosition[]): PortfolioGreeks {
  let netDelta = 0
  let dollarDelta = 0
  let netTheta = 0
  let netVega = 0
  let netGamma = 0

  for (const { position: pos, greeks } of enriched) {
    if (pos.type === 'stock') {
      const contribution = 1.0 * pos.quantity
      netDelta += contribution
      dollarDelta += contribution * pos.currentPrice
      continue
    }

    if (!greeks) continue

    const sign = isSellType(pos.type) ? -1 : 1
    const multiplier = pos.quantity * 100

    netDelta += greeks.delta * sign * multiplier
    dollarDelta += greeks.delta * sign * multiplier * pos.currentPrice
    netTheta += greeks.theta * sign * multiplier
    netVega += greeks.vega * sign * multiplier / 100 // per 1% IV move
    netGamma += greeks.gamma * sign * multiplier
  }

  return { netDelta, dollarDelta, netTheta, netVega, netGamma }
}

// ===== 6. Position Monitoring =====

export function computePositionMonitoring(enriched: EnrichedPosition[]): PositionMonitor[] {
  const monitors: PositionMonitor[] = []

  for (const { position: pos, dte } of enriched) {
    if (!isSellType(pos.type)) continue
    if (pos.currentPremium === undefined || pos.premium <= 0) continue

    const pnlProgress = ((pos.premium - pos.currentPremium) / pos.premium) * 100
    const daysLeft = dte ?? 0
    const distancePercent = pos.currentPrice > 0
      ? ((pos.currentPrice - pos.strikePrice) / pos.currentPrice) * 100
      : 0

    let signal: 'take_profit' | 'hold' | 'stop_loss' = 'hold'
    if (pnlProgress >= THRESHOLDS.pnlTakeProfit) signal = 'take_profit'
    else if (pnlProgress <= THRESHOLDS.pnlStopLoss) signal = 'stop_loss'

    // Expiry risk score (0-100): combines distance to strike + DTE + premium loss
    const distanceScore = Math.max(0, 1 - Math.abs(distancePercent) / 15) * 40
    const dteScore = Math.max(0, 1 - Math.min(daysLeft, 45) / 45) * 35
    const pnlScore = pnlProgress < 0 ? Math.min(Math.abs(pnlProgress) / 100, 1) * 25 : 0
    const expiryRiskScore = Math.round(distanceScore + dteScore + pnlScore)

    monitors.push({
      positionId: pos.id,
      ticker: pos.ticker,
      type: pos.type,
      strikePrice: pos.strikePrice,
      quantity: pos.quantity,
      pnlProgress,
      signal,
      expiryRiskScore,
      dte: daysLeft,
      distancePercent,
    })
  }

  return monitors.sort((a, b) => b.expiryRiskScore - a.expiryRiskScore)
}

// ===== 7. Alert Generation =====

export function generateAlerts(
  account: AccountMetrics,
  sellPutRisk: SellPutRiskMetrics,
  greeks: PortfolioGreeks,
  monitoring: PositionMonitor[],
  stressTest: StressTestResult,
): Alert[] {
  const alerts: Alert[] = []

  // === RED ===
  // ITM sell puts
  for (const m of monitoring) {
    if (m.distancePercent < 0) {
      alerts.push({
        level: 'red',
        category: 'sell_put',
        message: `${m.ticker} ${m.strikePrice}P 已进入实值`,
        positionId: m.positionId,
      })
    }
  }
  // Safety ratio critical
  if (stressTest.safetyRatio < THRESHOLDS.safetyRatio.critical && stressTest.assignmentObligation > 0) {
    alerts.push({
      level: 'red',
      category: 'account',
      message: `Safety Ratio ${stressTest.safetyRatio.toFixed(2)} < 0.6，极端场景现金不足`,
    })
  }
  // Single position over 30% NAV
  for (const p of sellPutRisk.positions) {
    if (p.exposurePercent > THRESHOLDS.singleExposure.warning * 100) {
      alerts.push({
        level: 'red',
        category: 'sell_put',
        message: `${p.ticker} 有效敞口占NAV ${p.exposurePercent.toFixed(1)}% > 30%`,
        positionId: p.positionId,
      })
    }
  }
  // Net theta critical negative
  if (greeks.netTheta < THRESHOLDS.netTheta.criticalNeg) {
    alerts.push({
      level: 'red',
      category: 'greeks',
      message: `净Theta $${greeks.netTheta.toFixed(0)}/天，时间损耗过重`,
    })
  }
  // Stop loss signals
  for (const m of monitoring) {
    if (m.signal === 'stop_loss') {
      alerts.push({
        level: 'red',
        category: 'position',
        message: `${m.ticker} ${m.strikePrice}P 亏损 ${Math.abs(m.pnlProgress).toFixed(0)}%，考虑止损`,
        positionId: m.positionId,
      })
    }
  }

  // === YELLOW ===
  // Near strike < 5%
  for (const m of monitoring) {
    if (m.distancePercent >= 0 && m.distancePercent < THRESHOLDS.nearStrikePct) {
      alerts.push({
        level: 'yellow',
        category: 'sell_put',
        message: `${m.ticker} 距行权价 ${m.distancePercent.toFixed(1)}%，需关注`,
        positionId: m.positionId,
      })
    }
  }
  // BPR utilization > 60%
  if (account.bprUtilization > 0.60) {
    alerts.push({
      level: 'yellow',
      category: 'account',
      message: `BPR利用率 ${(account.bprUtilization * 100).toFixed(0)}%，考虑降低仓位`,
    })
  }
  // Net vega warning
  if (greeks.netVega < THRESHOLDS.netVega.warning) {
    alerts.push({
      level: 'yellow',
      category: 'greeks',
      message: `净Vega $${greeks.netVega.toFixed(0)}/VIX点，波动率上升风险`,
    })
  }
  // Cash ratio < 30%
  if (account.nav > 0 && account.cashRatio < 0.30) {
    alerts.push({
      level: 'yellow',
      category: 'account',
      message: `现金比例 ${(account.cashRatio * 100).toFixed(0)}% < 30%`,
    })
  }
  // Near expiry + near strike
  for (const m of monitoring) {
    if (m.dte <= THRESHOLDS.nearExpiryDTE && m.dte > 0 && m.distancePercent < THRESHOLDS.nearStrikePct) {
      if (!alerts.some(a => a.positionId === m.positionId && a.level === 'red')) {
        alerts.push({
          level: 'yellow',
          category: 'position',
          message: `${m.ticker} ${m.strikePrice}P ${m.dte}天到期且接近行权价`,
          positionId: m.positionId,
        })
      }
    }
  }

  // === GREEN ===
  // Take profit signals
  for (const m of monitoring) {
    if (m.signal === 'take_profit') {
      alerts.push({
        level: 'green',
        category: 'position',
        message: `${m.ticker} ${m.strikePrice}P 盈利 ${m.pnlProgress.toFixed(0)}%，可考虑止盈`,
        positionId: m.positionId,
      })
    }
  }
  // Safety ratio healthy
  if (stressTest.safetyRatio >= THRESHOLDS.safetyRatio.healthy && stressTest.assignmentObligation > 0) {
    alerts.push({
      level: 'green',
      category: 'account',
      message: `Safety Ratio ${stressTest.safetyRatio.toFixed(2)} > 1.0，抗压能力充足`,
    })
  }
  // Theta ideal range
  if (greeks.netTheta >= THRESHOLDS.netTheta.idealLow && greeks.netTheta <= THRESHOLDS.netTheta.idealHigh) {
    alerts.push({
      level: 'green',
      category: 'greeks',
      message: `净Theta +$${greeks.netTheta.toFixed(0)}/天，收益健康`,
    })
  }

  return alerts.sort((a, b) => {
    const order = { red: 0, yellow: 1, green: 2 }
    return order[a.level] - order[b.level]
  })
}

// ===== Status Color Helpers =====

export type StatusLevel = 'green' | 'yellow' | 'red'

/** Lower is worse (e.g., cash ratio, safety ratio) */
export function statusLowerBetter(value: number, healthy: number, warning: number): StatusLevel {
  if (value >= healthy) return 'green'
  if (value >= warning) return 'yellow'
  return 'red'
}

/** Higher is worse (e.g., BPR utilization, exposure) */
export function statusHigherWorse(value: number, healthy: number, warning: number): StatusLevel {
  if (value <= healthy) return 'green'
  if (value <= warning) return 'yellow'
  return 'red'
}

/** Range is best (e.g., theta, dollar delta) */
export function statusInRange(value: number, low: number, high: number, criticalLow?: number): StatusLevel {
  if (value >= low && value <= high) return 'green'
  if (criticalLow !== undefined && value < criticalLow) return 'red'
  return 'yellow'
}

/** Format large currency values compactly */
export function formatCompactCurrency(value: number): string {
  const abs = Math.abs(value)
  const sign = value < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`
  return `${sign}$${abs.toFixed(0)}`
}
