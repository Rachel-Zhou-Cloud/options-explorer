/**
 * Decision Engine — per-position actionable advice with configurable thresholds.
 * Pure module, zero React dependencies. Coexists with riskCalculations.ts.
 */

import type { Position, CostRecord, StaticMarketData } from '@/types'
import {
  enrichPositionsWithGreeks,
  computeAccountMetrics,
  type EnrichedPosition,
} from '@/lib/riskCalculations'
import { daysUntilExpiry, calculateProfitPercent } from '@/lib/calculations'

// ===== Types =====

export interface PositionTag {
  level: 'red' | 'yellow' | 'green'
  label: string
  action?: string
}

export interface CostInfo {
  netCostPerShare: number
  reductionPercent: number
  totalCollected: number
}

export interface PositionAdvice {
  positionId: string
  tags: PositionTag[]
  costInfo?: CostInfo
  priority: 1 | 2 | 3
  topAction?: string
}

export interface DecisionThresholds {
  cashRatio: { healthy: number; warning: number }
  bpr: { healthy: number; warning: number }
  thetaWarning: number
  moneyness: { safe: number; watch: number; alert: number }
  dte: { normal: number; watch: number; urgent: number }
  pnl: { takeProfit: number; strongTP: number; stopLoss: number; hardStop: number }
  deltaHigh: number
  deltaLow: number
  costDilutionLow: number
  costDilutionGood: number
}

// ===== Default Thresholds =====

export const DEFAULT_THRESHOLDS: DecisionThresholds = {
  cashRatio: { healthy: 0.40, warning: 0.20 },
  bpr: { healthy: 0.30, warning: 0.50 },
  thetaWarning: -30,
  moneyness: { safe: 5, watch: 2, alert: 0 },
  dte: { normal: 45, watch: 21, urgent: 7 },
  pnl: { takeProfit: 50, strongTP: 75, stopLoss: 100, hardStop: 200 },
  deltaHigh: 0.9,
  deltaLow: 0.6,
  costDilutionLow: 1,
  costDilutionGood: 50,
}

const STORAGE_KEY = 'options-explorer-decision-thresholds'

export function loadThresholds(): DecisionThresholds {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...DEFAULT_THRESHOLDS, ...JSON.parse(raw) }
  } catch { /* ignore */ }
  return DEFAULT_THRESHOLDS
}

export function saveThresholds(t: DecisionThresholds): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(t)) } catch { /* ignore */ }
}

// ===== Helpers =====

const isSellType = (t: string) => t === 'sell_put' || t === 'sell_call'

function computeCostInfo(
  pos: Position,
  getCostRecords: (id: string) => CostRecord[],
): CostInfo | undefined {
  if (pos.type !== 'leap_call' && pos.type !== 'stock') return undefined

  const records = getCostRecords(pos.id)
  const totalCollected = records.reduce(
    (sum, r) => sum + r.premiumCollected * r.quantity * 100, 0,
  )

  let initialCostPerShare: number
  if (pos.type === 'stock') {
    initialCostPerShare = pos.costBasis ?? pos.strikePrice
  } else {
    initialCostPerShare = pos.premium // per-share premium paid for LEAP
  }

  const totalInitialCost = initialCostPerShare * pos.quantity * (pos.type === 'stock' ? 1 : 100)
  const reductionPercent = totalInitialCost > 0 ? (totalCollected / totalInitialCost) * 100 : 0
  const collectedPerShare = pos.quantity > 0
    ? totalCollected / (pos.quantity * (pos.type === 'stock' ? 1 : 100))
    : 0
  const netCostPerShare = initialCostPerShare - collectedPerShare

  return { netCostPerShare, reductionPercent, totalCollected }
}

// ===== Per-Position Evaluation =====

function evaluateSellPosition(
  pos: Position,
  ep: EnrichedPosition,
  th: DecisionThresholds,
): PositionTag[] {
  const tags: PositionTag[] = []
  const dte = ep.dte ?? (pos.expirationDate ? daysUntilExpiry(pos.expirationDate) : null)

  // --- Moneyness (for sell_put) ---
  if (pos.type === 'sell_put' && pos.currentPrice > 0) {
    const distPct = ((pos.currentPrice - pos.strikePrice) / pos.currentPrice) * 100
    if (distPct < 0) {
      tags.push({ level: 'red', label: 'ITM', action: '已进入实值，行权风险高。立即决策：接股 or Roll' })
    } else if (distPct <= th.moneyness.alert) {
      tags.push({ level: 'red', label: 'ATM', action: '已接近行权价，建议评估：Roll Out、Roll Down、或准备接股' })
    } else if (distPct <= th.moneyness.watch) {
      tags.push({ level: 'yellow', label: `OTM ${distPct.toFixed(1)}%`, action: '接近行权价，开始关注标的走势' })
    }
    // OTM > safe% → no tag needed (healthy)
  }

  // --- DTE ---
  if (dte !== null && isSellType(pos.type)) {
    if (dte <= 0) {
      tags.push({ level: 'red', label: '已到期', action: '清理到期合约' })
    } else if (dte < th.dte.urgent) {
      // DTE < 7 and OTM → pin risk
      const distPct = pos.currentPrice > 0 ? ((pos.currentPrice - pos.strikePrice) / pos.currentPrice) * 100 : 0
      if (distPct >= 0) {
        tags.push({ level: 'red', label: `${dte}d`, action: '强烈建议平仓，避免 Pin Risk' })
      } else {
        tags.push({ level: 'red', label: `${dte}d`, action: '即将到期且实值，立即处理' })
      }
    } else if (dte <= th.dte.watch) {
      tags.push({ level: 'yellow', label: `${dte}d`, action: 'Theta 加速衰减阶段，若盈利建议平仓；若亏损评估 Roll' })
    } else if (dte <= th.dte.normal) {
      tags.push({ level: 'green', label: `${dte}d`, action: '可开始关注，若有浮盈考虑提前平仓锁利' })
    }
  }

  // --- PnL ---
  if (isSellType(pos.type) && pos.currentPremium !== undefined && pos.premium > 0) {
    const pnlPct = calculateProfitPercent(pos.premium, pos.currentPremium)
    if (pnlPct <= -th.pnl.hardStop) {
      tags.push({ level: 'red', label: `亏${Math.abs(pnlPct).toFixed(0)}%`, action: '建议直接决策，不建议继续持有' })
    } else if (pnlPct <= -th.pnl.stopLoss) {
      tags.push({ level: 'red', label: `亏${Math.abs(pnlPct).toFixed(0)}%`, action: '进入防守区，评估 Roll 还是止损接股' })
    } else if (pnlPct >= th.pnl.strongTP) {
      tags.push({ level: 'green', label: `盈${pnlPct.toFixed(0)}%`, action: '建议平仓，剩余收益不值得继续占用保证金' })
    } else if (pnlPct >= th.pnl.takeProfit) {
      tags.push({ level: 'green', label: `盈${pnlPct.toFixed(0)}%`, action: '已达到一半收益，可考虑平仓释放 BPR 开新仓' })
    }
  }

  return tags
}

function evaluateLongPosition(
  pos: Position,
  ep: EnrichedPosition,
  costInfo: CostInfo | undefined,
  th: DecisionThresholds,
): PositionTag[] {
  const tags: PositionTag[] = []

  // --- PMCC / Long Call Delta ---
  if ((pos.type === 'leap_call' || pos.type === 'buy_call') && ep.greeks) {
    const delta = Math.abs(ep.greeks.delta)
    if (delta > th.deltaHigh) {
      tags.push({ level: 'yellow', label: `Delta ${delta.toFixed(2)}`, action: '深度实值，时间价值极低，考虑是否继续持有或换月' })
    } else if (delta < th.deltaLow) {
      tags.push({ level: 'yellow', label: `Delta ${delta.toFixed(2)}`, action: 'Delta 偏低，正股替代效果减弱，评估是否换更高 Delta 的合约' })
    }
    // 0.6-0.9 = healthy, no tag
  }

  // --- Cost Dilution Progress ---
  if (costInfo && (pos.type === 'leap_call' || pos.type === 'stock')) {
    if (costInfo.reductionPercent >= th.costDilutionGood) {
      tags.push({ level: 'green', label: `摊薄${costInfo.reductionPercent.toFixed(0)}%`, action: '摊薄良好，可评估是否提高 CC 行权价以换取更多上涨空间' })
    } else if (costInfo.reductionPercent >= th.costDilutionLow) {
      // In progress, no tag (shown in costInfo line)
    } else if (costInfo.reductionPercent === 0) {
      tags.push({ level: 'yellow', label: '未摊薄', action: '尚未开始摊薄，当前价格若高于成本可考虑卖出 Covered Call' })
    }
  }

  return tags
}

// ===== Priority Assignment =====

function assignPriority(
  pos: Position,
  tags: PositionTag[],
  ep: EnrichedPosition,
  accountBprOver: boolean,
  accountCashCritical: boolean,
): 1 | 2 | 3 {
  const hasRed = tags.some(t => t.level === 'red')
  const dte = ep.dte

  // P1: immediate action needed
  if (hasRed) return 1
  if (accountBprOver) return 1
  if (accountCashCritical) return 1

  // P2: today's attention
  if (isSellType(pos.type) && dte !== null && dte <= 21) return 2
  if (pos.type === 'sell_put' && pos.currentPrice > 0) {
    const dist = ((pos.currentPrice - pos.strikePrice) / pos.currentPrice) * 100
    if (dist >= 0 && dist < 2) return 2
  }
  if ((pos.type === 'leap_call' || pos.type === 'buy_call') && ep.greeks) {
    const d = Math.abs(ep.greeks.delta)
    if (d < 0.65 || d > 0.9) return 2
  }

  // P3: weekly follow-up
  return 3
}

// ===== Portfolio Evaluation (main entry point) =====

export function evaluatePortfolio(
  positions: Position[],
  marketData: StaticMarketData | null,
  cashBalance: number,
  getCostRecords: (id: string) => CostRecord[],
  thresholds?: DecisionThresholds,
): Map<string, PositionAdvice> {
  const th = thresholds ?? loadThresholds()
  const result = new Map<string, PositionAdvice>()

  if (positions.length === 0) return result

  // Enrich positions (reuse from riskCalculations)
  const enriched = enrichPositionsWithGreeks(positions, marketData)
  const account = computeAccountMetrics(enriched, cashBalance)

  // Account-level flags for priority
  const accountBprOver = account.bprUtilization > th.bpr.warning
  const accountCashCritical = account.nav > 0 && account.cashRatio < 0.15

  for (const ep of enriched) {
    const pos = ep.position
    const tags: PositionTag[] = []

    // Sell position rules
    if (isSellType(pos.type)) {
      tags.push(...evaluateSellPosition(pos, ep, th))
    }

    // Long position rules
    const costInfo = computeCostInfo(pos, getCostRecords)
    if (pos.type === 'leap_call' || pos.type === 'buy_call' || pos.type === 'stock') {
      tags.push(...evaluateLongPosition(pos, ep, costInfo, th))
    }

    // Stock PnL
    if (pos.type === 'stock' && pos.costBasis && pos.costBasis > 0) {
      const pnlPct = ((pos.currentPrice - pos.costBasis) / pos.costBasis) * 100
      if (pnlPct <= -20) {
        tags.push({ level: 'red', label: `跌${Math.abs(pnlPct).toFixed(0)}%`, action: '正股浮亏较大，评估是否止损或加仓摊低成本' })
      }
    }

    const priority = assignPriority(pos, tags, ep, accountBprOver, accountCashCritical)

    // Top action = first red tag's action, or first yellow, or first green
    const topAction = tags.find(t => t.level === 'red')?.action
      ?? tags.find(t => t.level === 'yellow')?.action
      ?? tags.find(t => t.level === 'green')?.action

    result.set(pos.id, {
      positionId: pos.id,
      tags,
      costInfo,
      priority,
      topAction,
    })
  }

  return result
}
