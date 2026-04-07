import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import type { Position } from '@/types'
import {
  daysUntilExpiry,
  expiresWithinDays,
  isNearStrike,
  calculateProfitPercent,
  formatCurrency,
  formatDate,
} from '@/lib/calculations'
import { AlertTriangle, TrendingUp, Target, Clock, X, ChevronDown, ChevronUp } from 'lucide-react'

interface PositionCardProps {
  position: Position
  onClose: (id: string, closePremium: number) => void
  onUpdate: (id: string, updates: Partial<Position>) => void
  onDelete: (id: string) => void
}

const TYPE_LABELS: Record<string, string> = {
  sell_put: 'SP',
  sell_call: 'SC',
  leap_call: 'LC',
  buy_call: 'BC',
  buy_put: 'BP',
  stock: 'STK',
  custom: 'OTH',
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
  // buy_call, buy_put, leap_call, custom (buy side)
  if (pos.currentPremium === undefined) return null
  const profitPerShare = pos.currentPremium - pos.premium
  const pnl = profitPerShare * pos.quantity * 100
  const pnlPercent = pos.premium > 0 ? (profitPerShare / pos.premium) * 100 : 0
  return { pnl, pnlPercent }
}

export function PositionCard({ position, onClose, onUpdate, onDelete }: PositionCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [showCloseForm, setShowCloseForm] = useState(false)
  const [closePremium, setClosePremium] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const [editCurrentPrice, setEditCurrentPrice] = useState(position.currentPrice.toString())
  const [editCurrentPremium, setEditCurrentPremium] = useState(
    position.currentPremium?.toString() || ''
  )

  const dte = position.expirationDate ? daysUntilExpiry(position.expirationDate) : null
  const expiringThisWeek = position.expirationDate ? expiresWithinDays(position.expirationDate, 7) : false
  const nearStrike = (position.type === 'sell_put' || position.type === 'sell_call') && isNearStrike(position.currentPrice, position.strikePrice, 5)

  const sellProfitPercent = (position.type === 'sell_put' || position.type === 'sell_call') && position.currentPremium !== undefined
    ? calculateProfitPercent(position.premium, position.currentPremium)
    : null
  const profitOver70 = sellProfitPercent !== null && sellProfitPercent >= 70

  const unrealized = calcUnrealizedPnl(position)

  // Alert badges
  const alerts: { icon: typeof AlertTriangle; label: string; className: string }[] = []
  if (expiringThisWeek) {
    alerts.push({ icon: Clock, label: `${dte}d`, className: 'badge-warning' })
  }
  if (profitOver70) {
    alerts.push({ icon: TrendingUp, label: `${sellProfitPercent?.toFixed(0)}%`, className: 'badge-profit' })
  }
  if (nearStrike) {
    alerts.push({ icon: Target, label: '近行权价', className: 'badge-loss' })
  }

  const borderClass = expiringThisWeek
    ? 'border-warning/40'
    : profitOver70
    ? 'border-profit/40'
    : nearStrike
    ? 'border-loss/40'
    : ''

  const handleClose = () => {
    const cp = parseFloat(closePremium)
    if (isNaN(cp)) return
    onClose(position.id, cp)
    setShowCloseForm(false)
  }

  const handleSaveEdit = () => {
    onUpdate(position.id, {
      currentPrice: parseFloat(editCurrentPrice) || position.currentPrice,
      currentPremium: editCurrentPremium ? parseFloat(editCurrentPremium) : undefined,
    })
    setIsEditing(false)
  }

  const typeLabel = position.type === 'custom'
    ? (position.customTypeName || 'OTH')
    : TYPE_LABELS[position.type]
  const typeColor = TYPE_COLORS[position.type] || TYPE_COLORS.custom

  return (
    <Card className={`transition-all duration-200 ${borderClass}`}>
      <CardContent className="p-0">
        {/* Compact row - always visible */}
        <button
          className="w-full flex items-center gap-2 px-3 py-2.5 text-left"
          onClick={() => setExpanded(!expanded)}
        >
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold shrink-0 ${typeColor}`}>
            {typeLabel}
          </span>
          <span className="font-semibold text-sm text-foreground shrink-0">{position.ticker}</span>
          {position.type !== 'stock' && (
            <span className="text-xs text-muted-foreground">${position.strikePrice}</span>
          )}
          {dte !== null && (
            <span className={`text-[10px] ${expiringThisWeek ? 'text-warning font-bold' : 'text-muted-foreground'}`}>
              {dte}d
            </span>
          )}

          {/* Alert badges inline */}
          {alerts.map((alert, i) => (
            <span key={i} className={`${alert.className} flex items-center gap-0.5 text-[10px] py-0 px-1.5`}>
              <alert.icon className="h-2.5 w-2.5" />
              {alert.label}
            </span>
          ))}

          <span className="ml-auto flex items-center gap-2 shrink-0">
            {/* P&L display */}
            {unrealized && (
              <span className={`text-xs font-semibold ${unrealized.pnl >= 0 ? 'text-profit' : 'text-loss'}`}>
                {unrealized.pnl >= 0 ? '+' : ''}{unrealized.pnlPercent.toFixed(1)}%
              </span>
            )}
            {expanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
          </span>
        </button>

        {/* Expanded details */}
        {expanded && (
          <div className="px-3 pb-3 animate-fade-in">
            <div className="border-t pt-2.5">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                {position.type !== 'stock' && (
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
                <div className="flex justify-between">
                  <span className="text-muted-foreground">数量</span>
                  <span className="text-foreground">×{position.quantity}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">标的</span>
                  <span className="text-foreground">{formatCurrency(position.currentPrice)}</span>
                </div>
                {position.expirationDate && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">到期</span>
                    <span className={`${expiringThisWeek ? 'text-warning font-medium' : 'text-foreground'}`}>
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

              {position.notes && (
                <div className="mt-2 text-xs text-muted-foreground italic">{position.notes}</div>
              )}

              {/* Edit mode */}
              {isEditing && (
                <div className="mt-3 pt-3 border-t flex flex-col gap-2 animate-fade-in">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-muted-foreground">标的现价</label>
                      <input
                        type="number"
                        className="input-field text-xs py-1.5"
                        value={editCurrentPrice}
                        onChange={e => setEditCurrentPrice(e.target.value)}
                        inputMode="decimal"
                      />
                    </div>
                    {position.type !== 'stock' && (
                      <div>
                        <label className="text-[10px] text-muted-foreground">当前权利金</label>
                        <input
                          type="number"
                          className="input-field text-xs py-1.5"
                          value={editCurrentPremium}
                          onChange={e => setEditCurrentPremium(e.target.value)}
                          inputMode="decimal"
                        />
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={handleSaveEdit} className="flex-1">保存</Button>
                    <Button size="sm" variant="outline" onClick={() => setIsEditing(false)}>取消</Button>
                  </div>
                </div>
              )}

              {/* Close form */}
              {showCloseForm && (
                <div className="mt-3 pt-3 border-t flex flex-col gap-2 animate-fade-in">
                  <label className="text-xs text-muted-foreground">
                    {position.type === 'stock' ? '卖出价' : '平仓权利金 / 股'}
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      className="input-field text-xs py-1.5 flex-1"
                      placeholder={position.type === 'sell_put' || position.type === 'sell_call' ? '如 0.05 (到期归零填0)' : '平仓价格'}
                      value={closePremium}
                      onChange={e => setClosePremium(e.target.value)}
                      inputMode="decimal"
                    />
                    <Button size="sm" variant="profit" onClick={handleClose}>确认</Button>
                    <Button size="sm" variant="outline" onClick={() => setShowCloseForm(false)}>
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              )}

              {/* Action buttons */}
              {!isEditing && !showCloseForm && (
                <div className="flex gap-2 mt-3 pt-2.5 border-t">
                  <Button size="sm" variant="ghost" className="flex-1 text-xs" onClick={() => setIsEditing(true)}>
                    更新
                  </Button>
                  <Button size="sm" variant="ghost" className="flex-1 text-xs text-profit" onClick={() => setShowCloseForm(true)}>
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
