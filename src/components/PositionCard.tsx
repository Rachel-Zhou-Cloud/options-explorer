import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import type { Position, PositionType, OptionContract } from '@/types'
import {
  daysUntilExpiry,
  expiresWithinDays,
  isNearStrike,
  calculateProfitPercent,
  formatCurrency,
  formatDate,
  estimateGreeks,
  type OptionSide,
} from '@/lib/calculations'
import { AlertTriangle, TrendingUp, Target, Clock, X, ChevronDown, ChevronUp, Pencil, Activity, Calculator } from 'lucide-react'
import { formatDataAge } from '@/lib/marketData'
import type { PositionAdvice } from '@/lib/decisionEngine'
import type { Alert as AlertEngineAlert } from '@/lib/alertEngine'

interface CostInfoDirect {
  netCostPerShare: number
  reductionPercent: number
  totalCollected: number
}

interface PositionCardProps {
  position: Position
  onClose: (id: string, closePremium: number, closeQty?: number) => void
  onUpdate: (id: string, updates: Partial<Position>) => void
  onDelete: (id: string) => void
  optionChainData?: OptionContract | null
  dataTimestamp?: string
  advice?: PositionAdvice
  onOpenCalculator?: (position: Position) => void
  /** alertEngine 预警 — 优先使用，缺失时回退到 advice.tags */
  alertEngineAlerts?: AlertEngineAlert[]
  /** 独立计算的成本摊薄 — 优先使用，缺失时回退到 advice.costInfo */
  directCostInfo?: CostInfoDirect | null
}

const TYPE_LABELS: Record<string, string> = {
  sell_put: 'SP', sell_call: 'SC', leap_call: 'LC',
  buy_call: 'BC', buy_put: 'BP', stock: 'STK', custom: 'OTH',
}

const TYPE_COLORS: Record<string, string> = {
  sell_put: 'bg-primary/10 text-primary',
  sell_call: 'bg-warning/10 text-warning',
  leap_call: 'bg-profit/10 text-profit',
  buy_call: 'bg-profit/10 text-profit',
  buy_put: 'bg-loss/10 text-loss',
  stock: 'bg-secondary text-secondary-foreground',
  custom: 'bg-secondary text-secondary-foreground',
}

function calcUnrealizedPnl(pos: Position): { pnl: number; pnlPercent: number } | null {
  if (pos.type === 'stock') {
    const cost = pos.costBasis || 0
    if (!cost || !pos.currentPrice) return null
    const pnl = (pos.currentPrice - cost) * pos.quantity
    const pnlPercent = ((pos.currentPrice - cost) / cost) * 100
    return { pnl, pnlPercent }
  }
  if (pos.type === 'sell_put' || pos.type === 'sell_call') {
    if (pos.currentPremium === undefined) return null
    const profitPerShare = pos.premium - pos.currentPremium
    const pnl = profitPerShare * pos.quantity * 100
    const pnlPercent = pos.premium > 0 ? (profitPerShare / pos.premium) * 100 : 0
    return { pnl, pnlPercent }
  }
  if (pos.currentPremium === undefined) return null
  const profitPerShare = pos.currentPremium - pos.premium
  const pnl = profitPerShare * pos.quantity * 100
  const pnlPercent = pos.premium > 0 ? (profitPerShare / pos.premium) * 100 : 0
  return { pnl, pnlPercent }
}

const isSellType = (t: PositionType) => t === 'sell_put' || t === 'sell_call'
const isOptionType = (t: PositionType) => t !== 'stock'

export function PositionCard({
  position, onClose, onUpdate, onDelete, optionChainData, dataTimestamp, advice, onOpenCalculator,
  alertEngineAlerts, directCostInfo,
}: PositionCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [showCloseForm, setShowCloseForm] = useState(false)
  const [closePremium, setClosePremium] = useState('')
  const [closeQty, setCloseQty] = useState(position.quantity.toString())
  // Quick edit: price + premium only
  const [isQuickEdit, setIsQuickEdit] = useState(false)
  const [editCurrentPrice, setEditCurrentPrice] = useState(position.currentPrice.toString())
  const [editCurrentPremium, setEditCurrentPremium] = useState(position.currentPremium?.toString() || '')
  // Full edit: all fields
  const [isFullEdit, setIsFullEdit] = useState(false)
  const [editQty, setEditQty] = useState(position.quantity.toString())
  const [editStrike, setEditStrike] = useState(position.strikePrice.toString())
  const [editPremium, setEditPremium] = useState(position.premium.toString())
  const [editCostBasis, setEditCostBasis] = useState(position.costBasis?.toString() || '')
  const [editExpDate, setEditExpDate] = useState(position.expirationDate || '')
  const [editNotes, setEditNotes] = useState(position.notes || '')
  // Alert badge expanded message index（用于点击展开完整 message）
  const [expandedMsgIdx, setExpandedMsgIdx] = useState<number | null>(null)

  const dte = position.expirationDate ? daysUntilExpiry(position.expirationDate) : null
  const expiringThisWeek = position.expirationDate ? expiresWithinDays(position.expirationDate, 7) : false
  const nearStrike = isSellType(position.type) && isNearStrike(position.currentPrice, position.strikePrice, 5)

  const sellProfitPercent = isSellType(position.type) && position.currentPremium !== undefined
    ? calculateProfitPercent(position.premium, position.currentPremium)
    : null
  const profitOver70 = sellProfitPercent !== null && sellProfitPercent >= 70

  const unrealized = calcUnrealizedPnl(position)

  // Greeks estimation for options — use real IV from Yahoo when available
  const greeks = isOptionType(position.type) && dte !== null && dte > 0 && position.currentPremium !== undefined
    ? estimateGreeks(
        (position.type === 'sell_put' || position.type === 'buy_put') ? 'put' as OptionSide : 'call' as OptionSide,
        position.currentPrice,
        position.strikePrice,
        dte,
        position.currentPremium,
        optionChainData?.iv,
      )
    : null

  // Decision engine tags (preferred) or fallback to hardcoded alerts
  const TAG_CLASS = { red: 'badge-loss', yellow: 'badge-warning', green: 'badge-profit' } as const
  const adviceTags = advice?.tags ?? []

  const alerts: { icon: typeof AlertTriangle; label: string; className: string }[] = adviceTags.length > 0
    ? adviceTags.map(t => ({
        icon: t.level === 'red' ? AlertTriangle : t.level === 'yellow' ? Clock : TrendingUp,
        label: t.label,
        className: TAG_CLASS[t.level],
      }))
    : (() => {
        const fallback: { icon: typeof AlertTriangle; label: string; className: string }[] = []
        if (expiringThisWeek) fallback.push({ icon: Clock, label: `${dte}d`, className: 'badge-warning' })
        if (profitOver70) fallback.push({ icon: TrendingUp, label: `${sellProfitPercent?.toFixed(0)}%`, className: 'badge-profit' })
        if (nearStrike) fallback.push({ icon: Target, label: '近行权价', className: 'badge-loss' })
        return fallback
      })()

  // alertEngine badges — 仅展示 red / orange，防信息过载
  // 条件渲染：alertEngineAlerts 优先，缺失时 engineBadges 为空（不影响现有 alerts 行）
  const engineBadges: { level: string; message: string; priority: number }[] =
    alertEngineAlerts && alertEngineAlerts.length > 0
      ? alertEngineAlerts
          .filter(a => (a.level === 'red' || a.level === 'orange') && a.target === position.id)
          .map(a => ({ level: a.level, message: a.message, priority: a.priority }))
      : []

  const badgeLevelBg: Record<string, string> = {
    red: 'bg-destructive/15 text-destructive border-destructive/30',
    orange: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  }

  // 成本摊薄数据：directCostInfo 优先 → advice.costInfo 回退
  const costToShow: CostInfoDirect | null =
    directCostInfo !== undefined
      ? directCostInfo  // 新的独立计算数据（含 null）
      : advice?.costInfo ?? null  // 回退到 decisionEngine 缓存

  const hasRed = adviceTags.some(t => t.level === 'red')
  const hasYellow = adviceTags.some(t => t.level === 'yellow')
  const borderClass = adviceTags.length > 0
    ? (hasRed ? 'border-loss/40' : hasYellow ? 'border-warning/40' : '')
    : (expiringThisWeek ? 'border-warning/40' : profitOver70 ? 'border-profit/40' : nearStrike ? 'border-loss/40' : '')

  // 考虑 engineBadges 对边框颜色的增强
  const hasEngineRed = engineBadges.some(b => b.level === 'red')
  const finalBorderClass = hasEngineRed ? 'border-destructive/40' : borderClass

  const handleClose = () => {
    const cp = parseFloat(closePremium)
    if (isNaN(cp)) return
    const qty = parseInt(closeQty)
    onClose(position.id, cp, qty > 0 && qty < position.quantity ? qty : undefined)
    setShowCloseForm(false)
  }

  const handleQuickSave = () => {
    onUpdate(position.id, {
      currentPrice: parseFloat(editCurrentPrice) || position.currentPrice,
      currentPremium: editCurrentPremium ? parseFloat(editCurrentPremium) : undefined,
    })
    setIsQuickEdit(false)
  }

  const handleFullSave = () => {
    const updates: Partial<Position> = {
      quantity: parseInt(editQty) || position.quantity,
      strikePrice: parseFloat(editStrike) || position.strikePrice,
      premium: parseFloat(editPremium) || position.premium,
      expirationDate: editExpDate || undefined,
      notes: editNotes || undefined,
      currentPrice: parseFloat(editCurrentPrice) || position.currentPrice,
      currentPremium: editCurrentPremium ? parseFloat(editCurrentPremium) : undefined,
    }
    if (position.type === 'stock') {
      updates.costBasis = parseFloat(editCostBasis) || position.costBasis
    }
    onUpdate(position.id, updates)
    setIsFullEdit(false)
  }

  const startFullEdit = () => {
    setEditQty(position.quantity.toString())
    setEditStrike(position.strikePrice.toString())
    setEditPremium(position.premium.toString())
    setEditCostBasis(position.costBasis?.toString() || '')
    setEditExpDate(position.expirationDate || '')
    setEditNotes(position.notes || '')
    setEditCurrentPrice(position.currentPrice.toString())
    setEditCurrentPremium(position.currentPremium?.toString() || '')
    setIsFullEdit(true)
    setIsQuickEdit(false)
  }

  const isEditing = isQuickEdit || isFullEdit

  const typeLabel = position.type === 'custom' ? (position.customTypeName || 'OTH') : TYPE_LABELS[position.type]
  const typeColor = TYPE_COLORS[position.type] || TYPE_COLORS.custom

  return (
    <Card className={`transition-all duration-200 ${finalBorderClass}`}>
      <CardContent className="p-0">
        {/* Compact row */}
        <button className="w-full flex items-center gap-2 px-3 py-2.5 text-left" onClick={() => setExpanded(!expanded)}>
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold shrink-0 ${typeColor}`}>{typeLabel}</span>
          <span className="font-semibold text-sm text-foreground shrink-0">{position.ticker}</span>
          {isOptionType(position.type) && <span className="text-xs text-muted-foreground">${position.strikePrice}</span>}
          {dte !== null && (
            <span className={`text-[10px] ${expiringThisWeek ? 'text-warning font-bold' : 'text-muted-foreground'}`}>{dte}d</span>
          )}
          {alerts.map((alert, i) => (
            <span key={i} className={`${alert.className} flex items-center gap-0.5 text-[10px] py-0 px-1.5`}>
              <alert.icon className="h-2.5 w-2.5" />{alert.label}
            </span>
          ))}
          <span className="ml-auto flex items-center gap-2 shrink-0">
            {unrealized && (
              <span className={`text-xs font-semibold ${unrealized.pnl >= 0 ? 'text-profit' : 'text-loss'}`}>
                {unrealized.pnl >= 0 ? '+' : ''}{unrealized.pnlPercent.toFixed(1)}%
              </span>
            )}
            <span className="text-[10px] text-muted-foreground">×{position.quantity}</span>
            {expanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
          </span>
        </button>

        {/* alertEngine badges — red/orange 仅，点击展开完整 message */}
        {engineBadges.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 px-3 pb-1.5 -mt-0.5">
            {engineBadges.map((b, i) => (
              <button
                key={i}
                className={`rounded-full border px-2 py-0.5 text-[10px] font-medium leading-tight transition-all ${badgeLevelBg[b.level] || ''}`}
                onClick={(e) => { e.stopPropagation(); setExpandedMsgIdx(expandedMsgIdx === i ? null : i) }}
                title={b.message}
              >
                {b.level === 'red' ? '● ' : '◉ '}
                {b.message.length > 24 ? b.message.slice(0, 22) + '…' : b.message}
              </button>
            ))}
            {expandedMsgIdx !== null && engineBadges[expandedMsgIdx] && (
              <div className="w-full mt-0.5 px-2 py-1.5 rounded-lg bg-secondary/60 text-[10px] text-muted-foreground leading-relaxed animate-fade-in">
                {engineBadges[expandedMsgIdx].message}
              </div>
            )}
          </div>
        )}

        {/* Cost dilution progress (LEAP/Stock) — directCostInfo 优先，advice.costInfo 回退 */}
        {costToShow && (position.type === 'leap_call' || position.type === 'stock') && (
          <div className="flex items-center gap-2 px-3 pb-1.5 -mt-1 text-[10px]">
            <span className="text-muted-foreground">净成本</span>
            <span className="font-medium text-foreground">{formatCurrency(costToShow.netCostPerShare)}</span>
            <span className="text-muted-foreground">/</span>
            <span className={`font-medium ${
              costToShow.reductionPercent >= 50 ? 'text-profit' :
              costToShow.reductionPercent > 0 ? 'text-primary' : 'text-muted-foreground'
            }`}>
              已摊薄 {costToShow.reductionPercent.toFixed(1)}%
            </span>
          </div>
        )}

        {/* Expanded */}
        {expanded && (
          <div className="px-3 pb-3 animate-fade-in">
            <div className="border-t pt-2.5">
              {/* Detail rows */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                {isOptionType(position.type) && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">权利金</span>
                      <span className="text-foreground">{formatCurrency(position.premium)}</span>
                    </div>
                    {position.currentPremium !== undefined && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">当前</span>
                        <span className="text-foreground">{formatCurrency(position.currentPremium)}</span>
                      </div>
                    )}
                  </>
                )}
                {position.type === 'stock' && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">成本</span>
                      <span className="text-foreground">{formatCurrency(position.costBasis || 0)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">现价</span>
                      <span className="text-foreground">{formatCurrency(position.currentPrice)}</span>
                    </div>
                  </>
                )}
                {isOptionType(position.type) && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">标的</span>
                    <span className="text-foreground">{formatCurrency(position.currentPrice)}</span>
                  </div>
                )}
                {position.expirationDate && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">到期</span>
                    <span className={expiringThisWeek ? 'text-warning font-medium' : 'text-foreground'}>
                      {formatDate(position.expirationDate)}
                    </span>
                  </div>
                )}
                {unrealized && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">浮盈</span>
                    <span className={unrealized.pnl >= 0 ? 'text-profit font-medium' : 'text-loss font-medium'}>
                      {unrealized.pnl >= 0 ? '+' : ''}{formatCurrency(unrealized.pnl)} ({unrealized.pnlPercent.toFixed(1)}%)
                    </span>
                  </div>
                )}
                {position.linkedPositionId && (
                  <div className="flex justify-between col-span-2">
                    <span className="text-muted-foreground">已关联持仓</span>
                    <span className="text-primary text-[10px]">成本自动摊薄</span>
                  </div>
                )}
              </div>

              {position.notes && <div className="mt-2 text-xs text-muted-foreground italic">{position.notes}</div>}

              {/* Greeks & Moneyness */}
              {greeks && (
                <div className="mt-2.5 pt-2 border-t border-dashed">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Moneyness</span>
                      <span className={`font-medium ${
                        greeks.moneyness === 'ITM' ? 'text-profit' :
                        greeks.moneyness === 'OTM' ? 'text-loss' : 'text-warning'
                      }`}>
                        {greeks.moneyness} ({greeks.moneynessPercent >= 0 ? '+' : ''}{greeks.moneynessPercent.toFixed(1)}%)
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Delta</span>
                      <span className="text-foreground">{greeks.delta.toFixed(3)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Theta/日</span>
                      <span className={greeks.theta < 0 ? 'text-loss' : 'text-profit'}>
                        {greeks.theta >= 0 ? '+' : ''}{formatCurrency(greeks.theta)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">隐含波动</span>
                      <span className="text-foreground">${greeks.impliedMove.toFixed(1)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">内在价值</span>
                      <span className="text-foreground">{formatCurrency(greeks.intrinsicValue)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">时间价值</span>
                      <span className="text-foreground">{formatCurrency(greeks.timeValue)}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Market data from Yahoo Finance */}
              {optionChainData && isOptionType(position.type) && (
                <div className="mt-2.5 pt-2 border-t border-dashed">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Activity className="h-3 w-3 text-primary" />
                    <span className="text-[10px] font-medium text-muted-foreground">市场数据</span>
                    {dataTimestamp && (
                      <span className="text-[10px] text-muted-foreground ml-auto">{formatDataAge(dataTimestamp)}</span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Bid / Ask</span>
                      <span className="text-foreground">{formatCurrency(optionChainData.bid)} / {formatCurrency(optionChainData.ask)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">IV</span>
                      <span className="text-foreground font-medium">{(optionChainData.iv * 100).toFixed(1)}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">成交量</span>
                      <span className="text-foreground">{optionChainData.volume.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">未平仓</span>
                      <span className="text-foreground">{optionChainData.oi.toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Quick edit: price + premium */}
              {isQuickEdit && (
                <div className="mt-3 pt-3 border-t flex flex-col gap-2 animate-fade-in">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-muted-foreground">标的现价</label>
                      <input type="number" className="input-field text-xs py-1.5" value={editCurrentPrice}
                        onChange={e => setEditCurrentPrice(e.target.value)} inputMode="decimal" />
                    </div>
                    {isOptionType(position.type) && (
                      <div>
                        <label className="text-[10px] text-muted-foreground">当前权利金</label>
                        <input type="number" className="input-field text-xs py-1.5" value={editCurrentPremium}
                          onChange={e => setEditCurrentPremium(e.target.value)} inputMode="decimal" />
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={handleQuickSave} className="flex-1">保存</Button>
                    <Button size="sm" variant="ghost" className="text-xs text-muted-foreground" onClick={startFullEdit}>
                      <Pencil className="h-3 w-3 mr-1" />编辑全部
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setIsQuickEdit(false)}>取消</Button>
                  </div>
                </div>
              )}

              {/* Full edit: all fields */}
              {isFullEdit && (
                <div className="mt-3 pt-3 border-t flex flex-col gap-2 animate-fade-in">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-muted-foreground">数量</label>
                      <input type="number" className="input-field text-xs py-1.5" value={editQty}
                        onChange={e => setEditQty(e.target.value)} inputMode="numeric" />
                    </div>
                    {isOptionType(position.type) ? (
                      <div>
                        <label className="text-[10px] text-muted-foreground">行权价</label>
                        <input type="number" className="input-field text-xs py-1.5" value={editStrike}
                          onChange={e => setEditStrike(e.target.value)} inputMode="decimal" />
                      </div>
                    ) : (
                      <div>
                        <label className="text-[10px] text-muted-foreground">成本价</label>
                        <input type="number" className="input-field text-xs py-1.5" value={editCostBasis}
                          onChange={e => setEditCostBasis(e.target.value)} inputMode="decimal" />
                      </div>
                    )}
                    {isOptionType(position.type) && (
                      <div>
                        <label className="text-[10px] text-muted-foreground">{isSellType(position.type) ? '收取' : '支付'}权利金</label>
                        <input type="number" className="input-field text-xs py-1.5" value={editPremium}
                          onChange={e => setEditPremium(e.target.value)} inputMode="decimal" />
                      </div>
                    )}
                    <div>
                      <label className="text-[10px] text-muted-foreground">标的现价</label>
                      <input type="number" className="input-field text-xs py-1.5" value={editCurrentPrice}
                        onChange={e => setEditCurrentPrice(e.target.value)} inputMode="decimal" />
                    </div>
                    {isOptionType(position.type) && (
                      <>
                        <div>
                          <label className="text-[10px] text-muted-foreground">当前权利金</label>
                          <input type="number" className="input-field text-xs py-1.5" value={editCurrentPremium}
                            onChange={e => setEditCurrentPremium(e.target.value)} inputMode="decimal" />
                        </div>
                        <div>
                          <label className="text-[10px] text-muted-foreground">到期日</label>
                          <input type="date" className="input-field text-xs py-1.5" value={editExpDate}
                            onChange={e => setEditExpDate(e.target.value)} />
                        </div>
                      </>
                    )}
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground">备注</label>
                    <input className="input-field text-xs py-1.5" value={editNotes}
                      onChange={e => setEditNotes(e.target.value)} placeholder="可选" />
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={handleFullSave} className="flex-1">保存全部</Button>
                    <Button size="sm" variant="outline" onClick={() => setIsFullEdit(false)}>取消</Button>
                  </div>
                </div>
              )}

              {/* Close form with quantity */}
              {showCloseForm && (
                <div className="mt-3 pt-3 border-t flex flex-col gap-2 animate-fade-in">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-muted-foreground">
                        {position.type === 'stock' ? '卖出价' : '平仓权利金/股'}
                      </label>
                      <input type="number" className="input-field text-xs py-1.5"
                        placeholder={isSellType(position.type) ? '到期归零填0' : '平仓价格'}
                        value={closePremium} onChange={e => setClosePremium(e.target.value)} inputMode="decimal" />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">
                        平仓数量 (共{position.quantity})
                      </label>
                      <input type="number" className="input-field text-xs py-1.5"
                        value={closeQty} onChange={e => setCloseQty(e.target.value)} inputMode="numeric" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="profit" onClick={handleClose} className="flex-1">
                      {parseInt(closeQty) > 0 && parseInt(closeQty) < position.quantity ? '部分平仓' : '全部平仓'}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setShowCloseForm(false)}>
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              )}

              {/* Decision engine top action hint */}
              {advice?.topAction && (
                <div className="mt-2.5 px-2 py-1.5 rounded-lg bg-secondary/50 text-[11px] text-muted-foreground leading-relaxed">
                  {advice.topAction}
                </div>
              )}

              {/* Actions */}
              {!isEditing && !showCloseForm && (
                <div className="flex gap-2 mt-3 pt-2.5 border-t">
                  {onOpenCalculator && position.type === 'sell_put' && (
                    <Button size="sm" variant="ghost" className="text-xs text-orange-400"
                      onClick={(e) => { e.stopPropagation(); onOpenCalculator(position) }}>
                      <Calculator className="h-3 w-3 mr-0.5" />评估Roll
                    </Button>
                  )}
                  {onOpenCalculator && position.type !== 'sell_put' && (
                    <Button size="sm" variant="ghost" className="text-xs text-primary"
                      onClick={(e) => { e.stopPropagation(); onOpenCalculator(position) }}>
                      <Calculator className="h-3 w-3 mr-0.5" />计算
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" className="flex-1 text-xs"
                    onClick={() => { setIsQuickEdit(true); setEditCurrentPrice(position.currentPrice.toString()); setEditCurrentPremium(position.currentPremium?.toString() || '') }}>
                    更新
                  </Button>
                  <Button size="sm" variant="ghost" className="flex-1 text-xs text-profit"
                    onClick={() => { setShowCloseForm(true); setCloseQty(position.quantity.toString()) }}>
                    平仓
                  </Button>
                  <Button size="sm" variant="ghost" className="text-xs text-destructive" onClick={() => onDelete(position.id)}>
                    删除
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
