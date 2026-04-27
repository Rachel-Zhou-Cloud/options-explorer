import { useState, useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import type { Position, CostRecord } from '@/types'
import { CalendarDays, ChevronDown, ChevronUp, BellRing } from 'lucide-react'
import { generateAlerts, type Alert, type AlertLevel } from '@/lib/alertEngine'
import {
  enrichPositionsWithGreeks,
  computeAccountMetrics,
  computeSellPutRisk,
  computePortfolioGreeks,
  computeStressTest,
  formatCompactCurrency,
} from '@/lib/riskCalculations'
import { showToast } from '@/components/ui/toast'

interface TodayTabProps {
  positions: Position[]
  cashBalance: number
  getCostRecordsForPosition: (positionId: string) => CostRecord[]
  onNavigateToPosition: (positionId: string) => void
  onSetCashBalance?: (value: number) => void
}

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

function formatNetTheta(value: number): string {
  const sign = value >= 0 ? '+' : ''
  return sign + '$' + value.toFixed(0) + '/天'
}

const HEALTH_RECOS: Record<string, string> = {  cashRatio: '建议 ≥40%',  bpr: '建议 <50%',  notional: '常见 >100%',  theta: '建议 +$10~$50/天',  vega: '建议 ≥ -$300',};

export function TodayTab({
  positions,
  cashBalance,
  getCostRecordsForPosition,
  onNavigateToPosition,
  onSetCashBalance,
}: TodayTabProps) {
  const [stressOpen, setStressOpen] = useState(false)
  const [stressDropPercent, setStressDropPercent] = useState(20)
  const [cashInput, setCashInput] = useState(cashBalance > 0 ? cashBalance.toString() : '')

  const alerts = useMemo(
    () => generateAlerts(positions, cashBalance, getCostRecordsForPosition),
    [positions, cashBalance, getCostRecordsForPosition],
  )

  const enriched = useMemo(
    () => enrichPositionsWithGreeks(positions, null),
    [positions],
  )
  const account = useMemo(
    () => computeAccountMetrics(enriched, cashBalance),
    [enriched, cashBalance],
  )
  const sellPutRisk = useMemo(
    () => computeSellPutRisk(enriched, account.nav),
    [enriched, account.nav],
  )
  const greeks = useMemo(
    () => computePortfolioGreeks(enriched),
    [enriched],
  )
  const stressTest = useMemo(
    () => computeStressTest(enriched, cashBalance, stressDropPercent),
    [enriched, cashBalance, stressDropPercent],
  )

  const hasThetaData = useMemo(
    () => enriched.some(p => p.position.type !== 'stock' && p.position.theta !== undefined),
    [enriched],
  )

  const accountAlertMap = useMemo(() => {
    const map: Record<string, Alert | undefined> = {}
    for (const al of alerts) {
      if (al.target !== '账户') continue
      if (al.message.includes('现金比例')) map.cash = al
      else if (al.message.includes('BPR占用率')) map.bpr = al
      else if (al.message.includes('净Theta')) map.theta = al
    }
    return map
  }, [alerts])

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

  const notionalDesc = useMemo(() => {
    const r = sellPutRisk.notionalRatio
    if (r > 2.0) return '杠杆水平较高，需控制敞口'
    if (r > 1.0) return '正常杠杆水平'
    return '敞口可控'
  }, [sellPutRisk.notionalRatio])

  const notionalLevel: AlertLevel = sellPutRisk.notionalRatio > 2.0 ? 'yellow'
    : sellPutRisk.notionalRatio > 1.0 ? 'green'
    : 'green'

  const vegaDesc = useMemo(() => {
    const v = greeks.netVega
    if (v < -300) return '波动率敏感度较高，需关注Vega风险'
    if (v < -100) return '波动率敏感度适中'
    return '波动率敏感度低'
  }, [greeks.netVega])

  const vegaLevel: AlertLevel = greeks.netVega < -300 ? 'yellow'
    : greeks.netVega < -100 ? 'green'
    : 'green'

  const handleSaveCash = () => {
    const val = parseFloat(cashInput)
    if (!isNaN(val) && val >= 0) {
      onSetCashBalance?.(val)
      showToast('现金余额已保存: ' + formatCompactCurrency(val), 'success')
    } else if (cashInput.trim() === '') {
      onSetCashBalance?.(0)
      setCashInput('')
      showToast('现金余额已清零', 'success')
    } else {
      showToast('请输入有效的金额', 'error')
    }
  }

  const todayStr = new Date().toLocaleDateString('zh-CN', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

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

      {/* Cash Balance */}
      {onSetCashBalance && (
        <div className="flex gap-2 items-center">
          <label className="text-xs text-muted-foreground whitespace-nowrap shrink-0">现金</label>
          <input
            type="number"
            className="input-field flex-1 text-sm"
            placeholder="输入现金余额"
            value={cashInput}
            onChange={e => setCashInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                handleSaveCash()
                ;(e.target as HTMLInputElement).blur()
              }
            }}
            inputMode="decimal"
          />
          <button
            onClick={handleSaveCash}
            className="rounded-lg bg-primary px-4 py-2.5 text-xs font-medium text-primary-foreground shrink-0"
          >
            保存
          </button>
        </div>
      )}

      {/* Account Health */}
      <Card>
        <CardContent className="p-0">
          <div className="px-4 py-2.5 border-b">
            <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              账户健康
            </h3>
          </div>
          <div className="divide-y">
            <HealthRow
              label="现金比例"
              value={(account.cashRatio * 100).toFixed(0) + '%'}
              desc={accountAlertMap.cash?.message ?? null}
              recommendation={HEALTH_RECOS.cashRatio}
              alert={accountAlertMap.cash ?? null}
            />
            <HealthRow
              label="BPR占用率"
              value={(account.bprUtilization * 100).toFixed(0) + '%'}
              desc={accountAlertMap.bpr?.message ?? null}
              recommendation={HEALTH_RECOS.bpr}
              alert={accountAlertMap.bpr ?? null}
            />
            <HealthRow
              label="名义敞口率"
              value={(sellPutRisk.notionalRatio * 100).toFixed(0) + '%'}
              desc={notionalDesc}
              recommendation={HEALTH_RECOS.notional}
              alert={{ level: notionalLevel, target: '账户', message: notionalDesc, priority: 3 }}
            />
            <HealthRow
              label="净Theta"
              value={hasThetaData || greeks.netTheta !== 0
                ? formatNetTheta(greeks.netTheta)
                : '数据不可用'}
              desc={accountAlertMap.theta?.message ?? null}
              recommendation={HEALTH_RECOS.theta}
              alert={accountAlertMap.theta ?? null}
            />
            <HealthRow
              label="净Vega敏感度"
              value={'$' + greeks.netVega.toFixed(0) + '/VIX点'}
              desc={vegaDesc}
              recommendation={HEALTH_RECOS.vega}
              alert={{ level: vegaLevel, target: '账户', message: vegaDesc, priority: 3 }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Items Needing Attention */}
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
                          key={alert.target + '-' + i}
                          className={'flex items-start gap-2 rounded-lg px-2.5 py-1.5 text-xs cursor-pointer transition-colors ' +
                            (alert.target !== '账户'
                              ? 'hover:bg-secondary/50 active:bg-secondary'
                              : '') + ' ' +
                            (alert.level === 'red'
                              ? 'bg-loss/5 border border-loss/15'
                              : 'bg-orange-400/5 border border-orange-400/15')}
                          onClick={() => {
                            if (alert.target !== '账户') {
                              onNavigateToPosition(alert.target)
                            }
                          }}
                        >
                          <span
                            className={'h-2 w-2 rounded-full shrink-0 mt-1 ' + LEVEL_DOT[alert.level]}
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

      {/* Stress Test */}
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
                sublabel={'现金' + formatCompactCurrency(cashBalance) + ' + 残值' + formatCompactCurrency(stressTest.stockResidual + stressTest.leapResidual)}
              />
              <StressMetric
                label="行权义务"
                value={formatCompactCurrency(stressTest.assignmentObligation)}
                sublabel="全部Sell Put行权"
              />
            </div>

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
                  <div className={'rounded-xl p-4 text-center ' + statusBg[safetyStatus]}>
                    <div className="text-[10px] text-muted-foreground mb-1">Safety Ratio</div>
                    <div className={'text-3xl font-bold ' + statusText[safetyStatus]}>
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

function HealthRow({
  label,
  value,
  desc,
  alert,
  recommendation,
}: {
  label: string
  value: string
  desc: string | null
  alert: Alert | null
  recommendation?: string
}) {
  const level = alert?.level ?? null
  const dotColor = level ? LEVEL_DOT[level] : 'bg-muted-foreground/30'
  const valueColor = level ? LEVEL_TEXT[level] : 'text-muted-foreground'
  return (
    <div className="px-4 py-2.5">
      <div className="flex items-center gap-2">
        <span className={'h-2.5 w-2.5 rounded-full shrink-0 ' + dotColor} />
        <span className="text-xs text-foreground flex-1">{label}</span>
        <span className={'text-xs font-semibold tabular-nums ' + valueColor}>{value}</span>
      </div>
      {desc && (
        <div className="text-[10px] text-muted-foreground mt-0.5 ml-[18px] leading-relaxed">
          {desc}
        </div>
      )}
      {recommendation && (
        <div className="text-[10px] text-muted-foreground/70 mt-0.5 ml-[18px] leading-relaxed">
          {recommendation}
        </div>
      )}
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