import { useState, useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import type { Position, CostRecord } from '@/types'
import { CalendarDays, ChevronDown, ChevronUp, BellRing } from 'lucide-react'
import { generateAlerts, type Alert, type AlertLevel } from '@/lib/alertEngine'
import {
  enrichPositionsWithGreeks,
  computeStressTest,
  formatCompactCurrency,
} from '@/lib/riskCalculations'

interface TodayTabProps {
  positions: Position[]
  cashBalance: number
  getCostRecordsForPosition: (positionId: string) => CostRecord[]
  onNavigateToPosition: (positionId: string) => void
}

// ---- 圆点颜色映射 ----
const LEVEL_DOT: Record<AlertLevel, string> = {
  red: 'bg-loss',
  orange: 'bg-orange-400',
  yellow: 'bg-warning',
  green: 'bg-profit',
}

const LEVEL_TEXT: Record<AlertLevel, string> = {
  red: 'text-loss',
  orange: 'text-orange-400',
  yellow: 'text-warning',
  green: 'text-profit',
}

const PRIORITY_LABEL: Record<number, { icon: string; title: string }> = {
  1: { icon: '🔴', title: '立即处理' },
  2: { icon: '🟠', title: '今日关注' },
  3: { icon: '🟡', title: '本周跟进' },
}

// ---- 本地账户指标快照（与 alertEngine 一致的计算公式）----
function computeAccountSnapshot(positions: Position[], cashBalance: number) {
  let stockValue = 0
  let optionsValue = 0
  let totalMargin = 0

  for (const pos of positions) {
    if (pos.type === 'stock') {
      stockValue += (pos.currentPrice || 0) * pos.quantity
    } else if (pos.currentPremium !== undefined) {
      const val = pos.currentPremium * pos.quantity * 100
      if (pos.type === 'sell_put' || pos.type === 'sell_call') {
        optionsValue -= val
      } else {
        optionsValue += val
      }
    }
    if (pos.type === 'sell_put') {
      const otm = Math.max(0, (pos.currentPrice || 0) - pos.strikePrice)
      const margin = Math.max(
        0.25 * (pos.currentPrice || 0) - otm + pos.premium,
        0.10 * pos.strikePrice + pos.premium,
        2.50,
      )
      totalMargin += margin * pos.quantity * 100
    }
  }

  const nav = cashBalance + stockValue + optionsValue
  return {
    cashRatio: nav > 0 ? cashBalance / nav : 0,
    bprUtilization: nav > 0 ? totalMargin / nav : 0,
  }
}

/** 简化 netTheta（优先用预计算字段，匹配 alertEngine 口径） */
function computeNetThetaSimple(positions: Position[]): number {
  let net = 0
  for (const pos of positions) {
    const isOption = pos.type !== 'stock'
    if (!isOption) continue
    const isSell = pos.type === 'sell_put' || pos.type === 'sell_call'
    const t = pos.theta
    if (t === undefined) continue
    // BS theta 是持有方视角；卖方取反
    net += t * (isSell ? -1 : 1) * pos.quantity * 100
  }
  return net
}

function formatNetTheta(value: number): string {
  const sign = value >= 0 ? '+' : ''
  return `${sign}$${value.toFixed(0)}/天`
}

// ==================== Component ====================

export function TodayTab({
  positions,
  cashBalance,
  getCostRecordsForPosition,
  onNavigateToPosition,
}: TodayTabProps) {
  const [stressOpen, setStressOpen] = useState(false)
  const [stressDropPercent, setStressDropPercent] = useState(20)

  // ---- alertEngine 预警 ----
  const alerts = useMemo(
    () => generateAlerts(positions, cashBalance, getCostRecordsForPosition),
    [positions, cashBalance, getCostRecordsForPosition],
  )

  // ---- 账户指标 ----
  const snapshot = useMemo(
    () => computeAccountSnapshot(positions, cashBalance),
    [positions, cashBalance],
  )
  const netTheta = useMemo(
    () => computeNetThetaSimple(positions),
    [positions],
  )

  // ---- 账户级 alert（用于三灯颜色） ----
  const findAccountAlert = (keyword: string): AlertLevel | null => {
    const a = alerts.find(al => al.target === '账户' && al.message.includes(keyword))
    return a?.level ?? null
  }
  const cashAlertLevel = findAccountAlert('现金比例')
  const bprAlertLevel = findAccountAlert('BPR占用率')
  const thetaAlertLevel = findAccountAlert('净Theta')

  // ---- 需要处理的事项（red / orange，按 priority 分组） ----
  const actionableAlerts = useMemo(
    () => alerts.filter(a => a.level === 'red' || a.level === 'orange'),
    [alerts],
  )
  const groupedByPriority = useMemo(() => {
    const groups: Record<number, Alert[]> = { 1: [], 2: [], 3: [] }
    for (const al of actionableAlerts) {
      groups[al.priority].push(al)
    }
    return groups
  }, [actionableAlerts])

  // ---- 压力测试 ----
  const enriched = useMemo(
    () => enrichPositionsWithGreeks(positions, null),
    [positions],
  )
  const stressTest = useMemo(
    () => computeStressTest(enriched, cashBalance, stressDropPercent),
    [enriched, cashBalance, stressDropPercent],
  )

  const todayStr = new Date().toLocaleDateString('zh-CN', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

  // Empty state
  if (positions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20 animate-fade-in">
        <CalendarDays className="h-12 w-12 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">暂无持仓，请先在持仓页面添加持仓</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 pb-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3 px-1">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
          <CalendarDays className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-foreground">今日</h2>
          <p className="text-xs text-muted-foreground">{todayStr}</p>
        </div>
      </div>

      {/* ═══ 1. 账户健康状态栏（三灯） ═══ */}
      <Card>
        <CardContent className="p-0">
          <div className="px-4 py-2.5 border-b">
            <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              账户健康
            </h3>
          </div>
          <div className="flex divide-x">
            <HealthDot
              label="现金比例"
              value={`${(snapshot.cashRatio * 100).toFixed(0)}%`}
              level={cashAlertLevel}
            />
            <HealthDot
              label="BPR占用率"
              value={`${(snapshot.bprUtilization * 100).toFixed(0)}%`}
              level={bprAlertLevel}
            />
            <HealthDot
              label="净Theta"
              value={formatNetTheta(netTheta)}
              level={thetaAlertLevel}
            />
          </div>
        </CardContent>
      </Card>

      {/* ═══ 2. 需要处理的事项 ═══ */}
      <Card>
        <CardContent className="p-0">
          <div className="px-4 py-2.5 border-b">
            <div className="flex items-center gap-1.5">
              <BellRing className="h-3.5 w-3.5 text-primary" />
              <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                需要处理
              </h3>
              {actionableAlerts.length > 0 && (
                <span className="text-[10px] font-bold text-foreground ml-auto">
                  {actionableAlerts.length} 条
                </span>
              )}
            </div>
          </div>

          {actionableAlerts.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">
              暂无需要处理的事项
            </div>
          ) : (
            <div className="divide-y">
              {[1, 2, 3].map(priority => {
                const items = groupedByPriority[priority]
                if (!items || items.length === 0) return null
                const pInfo = PRIORITY_LABEL[priority]
                return (
                  <div key={priority} className="px-4 py-2">
                    <div className="text-[10px] font-semibold text-muted-foreground mb-1.5">
                      {pInfo.icon} {pInfo.title}
                    </div>
                    <div className="flex flex-col gap-1">
                      {items.map((alert, i) => (
                        <div
                          key={`${alert.target}-${i}`}
                          className={`flex items-start gap-2 rounded-lg px-2.5 py-1.5 text-xs cursor-pointer transition-colors ${
                            alert.target !== '账户'
                              ? 'hover:bg-secondary/50 active:bg-secondary'
                              : ''
                          } ${
                            alert.level === 'red'
                              ? 'bg-loss/5 border border-loss/15'
                              : 'bg-orange-400/5 border border-orange-400/15'
                          }`}
                          onClick={() => {
                            if (alert.target !== '账户') {
                              onNavigateToPosition(alert.target)
                            }
                          }}
                        >
                          <span
                            className={`h-2 w-2 rounded-full shrink-0 mt-1 ${LEVEL_DOT[alert.level]}`}
                          />
                          <span className="text-foreground leading-relaxed">{alert.message}</span>
                          {alert.target !== '账户' && (
                            <span className="text-[10px] text-muted-foreground shrink-0 mt-0.5 ml-auto">
                              查看 →
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ═══ 3. 账户压力测试（折叠卡片） ═══ */}
      <Card>
        <button
          className="w-full px-4 py-3 flex items-center justify-between text-left"
          onClick={() => setStressOpen(!stressOpen)}
        >
          <div className="flex items-center gap-1.5">
            <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              压力测试
            </h3>
            <span className="text-xs font-bold text-foreground">
              下跌 {stressDropPercent}%
            </span>
          </div>
          {stressOpen ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </button>

        {stressOpen && (
          <div className="px-4 pb-4 animate-fade-in">
            <input
              type="range"
              min={10}
              max={50}
              step={5}
              value={stressDropPercent}
              onChange={e => setStressDropPercent(parseInt(e.target.value))}
              className="w-full h-1.5 rounded-full appearance-none bg-secondary cursor-pointer mb-1
                [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5
                [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary
                [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground mb-4">
              <span>10%</span><span>20%</span><span>30%</span><span>40%</span><span>50%</span>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-3">
              <StressMetric
                label="可调动资金"
                value={formatCompactCurrency(stressTest.availableFunds)}
                sublabel={`现金${formatCompactCurrency(cashBalance)} + 残值${formatCompactCurrency(stressTest.stockResidual + stressTest.leapResidual)}`}
              />
              <StressMetric
                label="行权义务"
                value={formatCompactCurrency(stressTest.assignmentObligation)}
                sublabel="全部Sell Put行权"
              />
            </div>

            {/* Safety Ratio */}
            {(() => {
              const safetyStatus =
                stressTest.assignmentObligation > 0
                  ? stressTest.safetyRatio >= 1.0
                    ? 'green'
                    : stressTest.safetyRatio >= 0.6
                      ? 'yellow'
                      : 'red'
                  : 'green'

              const statusBg: Record<string, string> = {
                green: 'bg-profit/10',
                yellow: 'bg-warning/10',
                red: 'bg-loss/10',
              }
              const statusText: Record<string, string> = {
                green: 'text-profit',
                yellow: 'text-warning',
                red: 'text-loss',
              }
              const statusLabel: Record<string, string> = {
                green: '覆盖充足',
                yellow: '需要关注',
                red: '严重不足',
              }

              const shortfall =
                stressTest.assignmentObligation > stressTest.availableFunds
                  ? stressTest.assignmentObligation - stressTest.availableFunds
                  : 0

              return (
                <>
                  <div className={`rounded-xl p-4 text-center ${statusBg[safetyStatus]}`}>
                    <div className="text-[10px] text-muted-foreground mb-1">Safety Ratio</div>
                    <div className={`text-3xl font-bold ${statusText[safetyStatus]}`}>
                      {stressTest.assignmentObligation > 0
                        ? stressTest.safetyRatio.toFixed(2)
                        : '∞'}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-1">
                      {statusLabel[safetyStatus]}
                    </div>
                  </div>

                  {shortfall > 0 && (
                    <div className="mt-3 flex items-center justify-between rounded-lg bg-loss/10 border border-loss/20 px-3 py-2.5">
                      <span className="text-xs text-loss">资金缺口</span>
                      <span className="text-sm font-bold text-loss">
                        {formatCompactCurrency(shortfall)}
                      </span>
                    </div>
                  )}
                </>
              )
            })()}
          </div>
        )}
      </Card>
    </div>
  )
}

// ============ Sub-components ============

function HealthDot({
  label,
  value,
  level,
}: {
  label: string
  value: string
  level: AlertLevel | null
}) {
  const dotColor = level ? LEVEL_DOT[level] : 'bg-muted-foreground/30'
  const valueColor = level ? LEVEL_TEXT[level] : 'text-muted-foreground'
  return (
    <div className="flex-1 flex flex-col items-center gap-1 py-3 px-2">
      <span className={`h-3 w-3 rounded-full ${dotColor}`} />
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className={`text-sm font-bold tabular-nums ${valueColor}`}>{value}</span>
    </div>
  )
}

function StressMetric({
  label,
  value,
  sublabel,
}: {
  label: string
  value: string
  sublabel: string
}) {
  return (
    <div className="rounded-lg bg-secondary/50 p-3">
      <span className="text-[10px] text-muted-foreground mb-1 block">{label}</span>
      <div className="text-sm font-semibold text-foreground">{value}</div>
      <div className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{sublabel}</div>
    </div>
  )
}
