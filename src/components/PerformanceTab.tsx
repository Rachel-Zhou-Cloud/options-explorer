import { useState } from 'react'
import type { ClosedTrade, Position } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { formatCurrency, formatDateFull } from '@/lib/calculations'
import {
  ClipboardList,
  TrendingUp,
  TrendingDown,
  Brain,
  Trash2,
  Target,
  BarChart3,
  Upload,
  PieChart,
} from 'lucide-react'
import { TradeImport } from '@/components/TradeImport'

const TRADE_TYPE_LABELS: Record<string, string> = {
  sell_put: 'Sell Put', sell_call: 'Sell Call', leap_call: 'LEAP Call',
  buy_call: 'Buy Call', buy_put: 'Buy Put', stock: '正股买卖', custom: '其他',
}

const TRADE_TYPE_COLORS: Record<string, string> = {
  sell_put: 'bg-primary/10 text-primary',
  sell_call: 'bg-warning/10 text-warning',
  leap_call: 'bg-profit/10 text-profit',
  buy_call: 'bg-profit/10 text-profit',
  buy_put: 'bg-loss/10 text-loss',
  stock: 'bg-secondary text-secondary-foreground',
  custom: 'bg-secondary text-secondary-foreground',
}

const SHORT_LABEL: Record<string, string> = {
  sell_put: 'SP', sell_call: 'SC', leap_call: 'LC',
  buy_call: 'BC', buy_put: 'BP', stock: 'STK', custom: 'OTH',
}

interface PerformanceTabProps {
  closedTrades: ClosedTrade[]
  onDeleteTrade: (id: string) => void
  onAddTrade: (trade: Omit<ClosedTrade, 'id'>) => void
  positions?: Position[]
  cashBalance?: number
}

// ===== Strategy-level stats =====

interface StrategyStats {
  type: string
  label: string
  color: string
  count: number
  wins: number
  losses: number
  winRate: number
  totalPnL: number
  avgPnL: number
}

function computeStrategyStats(trades: ClosedTrade[]): StrategyStats[] {
  const map: Record<string, { wins: number; losses: number; totalPnL: number }> = {}
  for (const t of trades) {
    if (!map[t.type]) map[t.type] = { wins: 0, losses: 0, totalPnL: 0 }
    if (t.isWin) map[t.type].wins++
    else map[t.type].losses++
    map[t.type].totalPnL += t.pnl
  }
  const result: StrategyStats[] = []
  for (const [type, data] of Object.entries(map)) {
    const count = data.wins + data.losses
    result.push({
      type,
      label: TRADE_TYPE_LABELS[type] || type,
      color: TRADE_TYPE_COLORS[type] || TRADE_TYPE_COLORS.custom,
      count,
      wins: data.wins,
      losses: data.losses,
      winRate: count > 0 ? data.wins / count : 0,
      totalPnL: data.totalPnL,
      avgPnL: count > 0 ? data.totalPnL / count : 0,
    })
  }
  result.sort((a, b) => b.count - a.count)
  return result
}

// ===== Main Component =====

export function PerformanceTab({ closedTrades, onDeleteTrade, onAddTrade, positions, cashBalance }: PerformanceTabProps) {
  const [showImport, setShowImport] = useState(false)
  const totalTrades = closedTrades.length
  const wins = closedTrades.filter(t => t.isWin).length
  const losses = totalTrades - wins
  const winRate = totalTrades > 0 ? wins / totalTrades : 0

  const totalPnL = closedTrades.reduce((sum, t) => sum + t.pnl, 0)
  const avgWin = wins > 0
    ? closedTrades.filter(t => t.isWin).reduce((sum, t) => sum + t.pnl, 0) / wins
    : 0
  const avgLoss = losses > 0
    ? closedTrades.filter(t => !t.isWin).reduce((sum, t) => sum + t.pnl, 0) / losses
    : 0

  const expectation = totalTrades > 0
    ? winRate * avgWin + (1 - winRate) * avgLoss
    : 0

  const grossProfit = closedTrades.filter(t => t.isWin).reduce((sum, t) => sum + t.pnl, 0)
  const grossLoss = Math.abs(closedTrades.filter(t => !t.isWin).reduce((sum, t) => sum + t.pnl, 0))
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0

  let maxConsecWins = 0
  let maxConsecLosses = 0
  let currentConsec = 0
  let lastWin = false
  for (const trade of closedTrades) {
    if (trade.isWin === lastWin && currentConsec > 0) {
      currentConsec++
    } else {
      currentConsec = 1
      lastWin = trade.isWin
    }
    if (trade.isWin) maxConsecWins = Math.max(maxConsecWins, currentConsec)
    else maxConsecLosses = Math.max(maxConsecLosses, currentConsec)
  }

  const strategyStats = computeStrategyStats(closedTrades)

  const sellPutTrades = closedTrades.filter(t => t.type === 'sell_put')
  const sellPutWinRate = sellPutTrades.length > 0
    ? sellPutTrades.filter(t => t.isWin).length / sellPutTrades.length
    : 0

  const accountNav = (() => {
    if (!positions || cashBalance === undefined) return 0
    let stockValue = 0
    for (const pos of positions) {
      if (pos.type === 'stock') stockValue += pos.currentPrice * pos.quantity
    }
    return cashBalance + stockValue
  })()

  const maxSingleLoss = totalTrades > 0
    ? Math.min(...closedTrades.map(t => t.pnl))
    : 0
  const maxLossNavRatio = accountNav > 0 && maxSingleLoss < 0
    ? Math.abs(maxSingleLoss) / accountNav
    : null

  const insights = generateInsights({
    totalTrades,
    winRate,
    expectation,
    avgWin,
    avgLoss,
    profitFactor,
    maxConsecLosses,
    sellPutWinRate,
    sellPutCount: sellPutTrades.length,
    maxLossNavRatio,
    strategyStats,
  })

  return (
    <div className="flex flex-col gap-4 pb-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
            <Clipboard className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">交易复盘</h2>
            <p className="text-xs text-muted-foreground">已平仓记录与策略分析</p>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={() => setShowImport(!showImport)}>
          <Upload className="h-4 w-4 mr-1" />
          导入
        </Button>
      </div>

      {showImport && (
        <TradeImport
          onImport={(trades) => { trades.forEach(t => onAddTrade(t)); setShowImport(false) }}
          onClose={() => setShowImport(false)}
        />
      )}

      {totalTrades === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary mb-4">
            <BarChart3 className="h-8 w-8 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground mb-1">暂无已平仓交易</p>
          <p className="text-xs text-muted-foreground">在持仓中完成平仓操作后，交易记录将显示在这里</p>
        </div>
      )}

      {totalTrades > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <StatCard
              label="胜率"
              value={winRate.toPercent(1)}
              subtitle={wins + '胜 / ' + losses + '负'}
              isPositive={winRate >= 0.5}
            />
            <StatCard
              label="数学期望"
              value={formatCurrency(expectation)}
              subtitle="每笔交易预期收益"
              isPositive={expectation > 0}
            />
            <StatCard
              label="总盈亏"
              value={formatCurrency(totalPnL)}
              subtitle={'共 ' + totalTrades + ' 笔交易'}
              isPositive={totalPnL >= 0}
            />
            <StatCard
              label="盈亏比"
              value={profitFactor === Infinity ? '-' : profitFactor.toFixed(2)}
              subtitle="总盈利 / 总亏损"
              isPositive={profitFactor >= 1}
            />
          </div>

          {/* ═══ 策略分类统计 ═══ */}
          {strategyStats.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground flex items-center gap-1.5">
                  <PieChart className="h-3.5 w-3.5" />
                  策略分类统计
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {strategyStats.map((s) => (
                  <div key={s.type} className="flex items-center justify-between text-xs py-1 border-b last:border-0">
                    <div className="flex items-center gap-2">
                      <span className={'rounded-md px-1.5 py-0.5 text-[10px] font-bold ' + s.color}>
                        {SHORT_LABEL[s.type] || 'OTH'}
                      </span>
                      <span className="text-foreground">{s.label}</span>
                      <span className="text-muted-foreground">{s.count + '笔'}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={s.winRate >= 0.5 ? 'text-profit' : 'text-loss'}>
                        {(s.winRate * 100).toFixed(0) + '%'}
                      </span>
                      <span className={'tabular-nums font-medium ' + (s.totalPnL >= 0 ? 'text-profit' : 'text-loss')}>
                        {(s.totalPnL >= 0 ? '+' : '') + formatCurrency(s.totalPnL)}
                      </span>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">详细统计</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <DetailRow label="平均盈利" value={formatCurrency(avgWin)} isPositive />
              <DetailRow label="平均亏损" value={formatCurrency(avgLoss)} isPositive={false} />
              <DetailRow label="最大连胜" value={maxConsecWins + ' 笔'} isPositive />
              <DetailRow label="最大连亏" value={maxConsecLosses + ' 笔'} isPositive={false} />
              {sellPutTrades.length > 0 && (
                <DetailRow
                  label="Sell Put 胜率"
                  value={(sellPutWinRate * 100).toFixed(1) + '%'}
                  isPositive={sellPutWinRate >= 0.5}
                />
              )}
              {maxLossNavRatio !== null && (
                <DetailRow
                  label="最大单笔亏损/NAV"
                  value={(maxLossNavRatio * 100).toFixed(1) + '%'}
                  isPositive={maxLossNavRatio < 0.05}
                />
              )}
            </CardContent>
          </Card>

          {insights.length > 0 && (
            <Card className="border-primary/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Brain className="h-4 w-4 text-primary" />
                  复盘洞察与建议
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {insights.map((insight, i) => (
                  <div key={i} className="flex gap-3 text-xs">
                    <span className={'mt-0.5 flex-shrink-0 ' +
                      (insight.type === 'positive' ? 'text-profit' :
                       insight.type === 'negative' ? 'text-loss' :
                       'text-warning')}>
                      {insight.type === 'positive' ? (
                        <TrendingUp className="h-3.5 w-3.5" />
                      ) : insight.type === 'negative' ? (
                        <TrendingDown className="h-3.5 w-3.5" />
                      ) : (
                        <Target className="h-3.5 w-3.5" />
                      )}
                    </span>
                    <p className="text-foreground leading-relaxed">{insight.message}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium text-muted-foreground px-1">交易历史</h3>
            {[...closedTrades].reverse().map(trade => (
              <Card key={trade.id}>
                <CardContent className="p-3">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className={'rounded-md px-1.5 py-0.5 text-[10px] font-bold ' +
                        (TRADE_TYPE_COLORS[trade.type] || TRADE_TYPE_COLORS.custom)}>
                        {SHORT_LABEL[trade.type] || 'OTH'}
                      </span>
                      <span className="text-sm font-medium text-foreground">{trade.ticker}</span>
                      {trade.type !== 'stock' && (
                        <span className="text-xs text-muted-foreground">${trade.strikePrice}</span>
                      )}
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      onClick={() => onDeleteTrade(trade.id)}
                    >
                      <Trash2 className="h-3 w-3 text-muted-foreground" />
                    </Button>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      {formatDateFull(trade.openDate)} → {formatDateFull(trade.closeDate)}
                    </span>
                    <span className={'font-semibold ' + (trade.pnl >= 0 ? 'text-profit' : 'text-loss')}>
                      {(trade.pnl >= 0 ? '+' : '') + formatCurrency(trade.pnl)}
                      <span className="ml-1 font-normal">
                        ({(trade.pnlPercent >= 0 ? '+' : '') + trade.pnlPercent.toFixed(1) + '%'})
                      </span>
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ===== Sub-components =====

function StatCard({
  label,
  value,
  subtitle,
  isPositive,
}: {
  label: string
  value: string
  subtitle: string
  isPositive: boolean
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="stat-label mb-1">{label}</div>
        <div className={'stat-value ' + (isPositive ? 'text-profit' : 'text-loss')}>
          {value}
        </div>
        <div className="text-[10px] text-muted-foreground mt-1">{subtitle}</div>
      </CardContent>
    </Card>
  )
}

function DetailRow({
  label,
  value,
  isPositive,
}: {
  label: string
  value: string
  isPositive: boolean
}) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={'font-medium ' + (isPositive ? 'text-profit' : 'text-loss')}>{value}</span>
    </div>
  )
}

// ===== Insights Engine =====

interface InsightParams {
  totalTrades: number
  winRate: number
  expectation: number
  avgWin: number
  avgLoss: number
  profitFactor: number
  maxConsecLosses: number
  sellPutWinRate: number
  sellPutCount: number
  maxLossNavRatio: number | null
  strategyStats: StrategyStats[]
}

interface Insight {
  type: 'positive' | 'negative' | 'neutral'
  message: string
}

function generateInsights(params: InsightParams): Insight[] {
  const insights: Insight[] = []

  if (params.totalTrades < 5) {
    insights.push({
      type: 'neutral',
      message: '交易样本较少，建议积累更多交易数据后再参考统计指标。至少需要 20-30 笔交易才能得到有统计意义的结论。',
    })
    return insights
  }

  // ═══ 策略胜率差异分析 ═══
  const validStrats = params.strategyStats.filter(s => s.count >= 3)
  if (validStrats.length >= 2) {
    const sorted = [...validStrats].sort((a, b) => b.winRate - a.winRate)
    const best = sorted[0]
    const worst = sorted[sorted.length - 1]
    if (best.winRate - worst.winRate > 0.15) {
      insights.push({
        type: 'neutral',
        message: '策略胜率差异明显：' + best.label + '胜率' + (best.winRate * 100).toFixed(0) + '%表现最佳，' +
          worst.label + '仅' + (worst.winRate * 100).toFixed(0) + '%。建议有倾向性地增加' + best.label +
          '类交易占比，并检讨' + worst.label + '策略的选股和时机问题。',
      })
    }
  }

  // Win rate
  if (params.winRate >= 0.7) {
    insights.push({
      type: 'positive',
      message: '胜率 ' + (params.winRate * 100).toFixed(0) + '% 表现优异。Sell Put 策略天然具有高胜率特征，请关注单笔亏损是否可控，防止"小赚大亏"。',
    })
  } else if (params.winRate < 0.5) {
    insights.push({
      type: 'negative',
      message: '胜率不足 50%。建议审视选股标准和行权价选择，考虑选择更深虚值的 Put 来提高胜率。',
    })
  }

  // Expectation
  if (params.expectation > 0) {
    insights.push({
      type: 'positive',
      message: '正数学期望 ' + formatCurrency(params.expectation) + ' / 笔，长期坚持该策略预期能持续盈利。继续保持当前的风控纪律。',
    })
  } else if (params.expectation < 0) {
    insights.push({
      type: 'negative',
      message: '负数学期望 ' + formatCurrency(params.expectation) + ' / 笔，表明当前策略长期会亏损。建议调整：1) 缩小仓位控制单笔亏损；2) 提前止损或滚仓（roll）来限制下行风险。',
    })
  }

  // Profit factor
  if (params.profitFactor < 1 && params.profitFactor > 0) {
    insights.push({
      type: 'negative',
      message: '盈亏比 ' + params.profitFactor.toFixed(2) + ' 低于 1，亏损总额大于盈利总额。考虑提高平仓纪律：在盈利达到 50-70% 时及时止盈，减少持有到期的时间风险。',
    })
  } else if (params.profitFactor >= 2) {
    insights.push({
      type: 'positive',
      message: '盈亏比 ' + params.profitFactor.toFixed(2) + ' 优秀，盈利远大于亏损。当前策略的风险回报配置合理。',
    })
  }

  // Avg win vs avg loss
  if (Math.abs(params.avgLoss) > params.avgWin * 3 && params.avgWin > 0) {
    insights.push({
      type: 'negative',
      message: '平均亏损是平均盈利的 ' + (Math.abs(params.avgLoss) / params.avgWin).toFixed(1) + ' 倍，存在"小赚大亏"问题。建议设置明确的止损线（如权利金翻倍时平仓），或在标的跌破关键支撑位时果断止损。',
    })
  }

  // Max consecutive losses
  if (params.maxConsecLosses >= 3) {
    insights.push({
      type: 'neutral',
      message: '最大连亏 ' + params.maxConsecLosses + ' 笔，注意连亏期间的心理状态管理。建议在连亏后暂停交易，复盘市场环境是否发生变化（如进入熊市或高波动期），而非情绪化加仓。',
    })
  }

  // Sell put specific
  if (params.sellPutCount >= 5) {
    if (params.sellPutWinRate >= 0.8) {
      insights.push({
        type: 'positive',
        message: 'Sell Put 胜率 ' + (params.sellPutWinRate * 100).toFixed(0) + '% 高于策略平均预期。说明行权价选择和时机把握较好。可以考虑逐步增加仓位或尝试更激进的行权价以提高收益。',
      })
    } else if (params.sellPutWinRate < 0.6) {
      insights.push({
        type: 'neutral',
        message: 'Sell Put 胜率偏低，建议：1) 选择更低 Delta（如 0.15-0.20）的行权价；2) 优先在 IV Rank > 50% 时卖出；3) 选择基本面优质、你愿意持有的标的。',
      })
    }
  }

  // Tail risk
  if (params.maxLossNavRatio !== null && params.maxLossNavRatio > 0.05) {
    insights.push({
      type: 'negative',
      message: '最大单笔亏损占账户净值 ' + (params.maxLossNavRatio * 100).toFixed(1) + '%（超过5%警戒线），尾部风险偏高。建议控制单笔最大仓位在 NAV 的5%以内——即使有70%胜率，连续2-3笔超额亏损会让账户遭受显著回撤。',
    })
  }

  // ═══ 最佳策略来源分析 ═══
  if (params.strategyStats.length >= 2) {
    const pnlSorted = [...params.strategyStats].sort((a, b) => b.totalPnL - a.totalPnL)
    const absSum = params.strategyStats.reduce((s, x) => s + Math.abs(x.totalPnL), 0)
    if (pnlSorted[0].totalPnL > 0 && absSum > 0 && pnlSorted[0].count >= 3) {
      const pct = (pnlSorted[0].totalPnL / absSum * 100).toFixed(0)
      insights.push({
        type: 'positive',
        message: pnlSorted[0].label + '是主要盈利来源（累计' + formatCurrency(pnlSorted[0].totalPnL) +
          '，占盈亏贡献' + pct + '%）。建议在该策略上继续深耕、保持优势，同时警惕其他策略的持续亏损。',
      })
    }
  }

  return insights
}
