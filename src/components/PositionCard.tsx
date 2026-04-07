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
import { AlertTriangle, TrendingUp, Target, Clock, X } from 'lucide-react'

interface PositionCardProps {
  position: Position
  onClose: (id: string, closePremium: number) => void
  onUpdate: (id: string, updates: Partial<Position>) => void
  onDelete: (id: string) => void
}

export function PositionCard({ position, onClose, onUpdate, onDelete }: PositionCardProps) {
  const [showCloseForm, setShowCloseForm] = useState(false)
  const [closePremium, setClosePremium] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const [editCurrentPrice, setEditCurrentPrice] = useState(position.currentPrice.toString())
  const [editCurrentPremium, setEditCurrentPremium] = useState(
    position.currentPremium?.toString() || ''
  )

  const dte = position.expirationDate ? daysUntilExpiry(position.expirationDate) : null
  const expiringThisWeek = position.expirationDate ? expiresWithinDays(position.expirationDate, 7) : false
  const nearStrike = position.type === 'sell_put' && isNearStrike(position.currentPrice, position.strikePrice, 5)
  const profitPercent = position.type === 'sell_put' && position.currentPremium !== undefined
    ? calculateProfitPercent(position.premium, position.currentPremium)
    : null
  const profitOver70 = profitPercent !== null && profitPercent >= 70

  const alerts: { icon: typeof AlertTriangle; label: string; className: string }[] = []
  if (expiringThisWeek) {
    alerts.push({ icon: Clock, label: `${dte}天到期`, className: 'badge-warning' })
  }
  if (profitOver70) {
    alerts.push({ icon: TrendingUp, label: `盈利${profitPercent?.toFixed(0)}%`, className: 'badge-profit' })
  }
  if (nearStrike) {
    alerts.push({ icon: Target, label: '接近行权价', className: 'badge-loss' })
  }

  const hasAlert = alerts.length > 0
  const borderClass = expiringThisWeek
    ? 'border-warning/40 glow-warning'
    : profitOver70
    ? 'border-profit/40 glow-profit'
    : nearStrike
    ? 'border-loss/40 glow-loss'
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

  const typeLabel = position.type === 'sell_put' ? 'SP' : position.type === 'leap_call' ? 'LC' : 'STK'
  const typeColor = position.type === 'sell_put'
    ? 'bg-primary/10 text-primary'
    : position.type === 'leap_call'
    ? 'bg-profit/10 text-profit'
    : 'bg-secondary text-secondary-foreground'

  return (
    <Card className={`transition-all duration-300 ${borderClass} ${hasAlert ? 'animate-pulse-glow' : ''}`}>
      <CardContent className="p-4">
        {/* Header row */}
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${typeColor}`}>
              {typeLabel}
            </span>
            <span className="font-semibold text-foreground">{position.ticker}</span>
            {position.type !== 'stock' && (
              <span className="text-sm text-muted-foreground">
                ${position.strikePrice}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">
              ×{position.quantity}
            </span>
          </div>
        </div>

        {/* Alert badges */}
        {alerts.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {alerts.map((alert, i) => (
              <span key={i} className={`${alert.className} flex items-center gap-1`}>
                <alert.icon className="h-3 w-3" />
                {alert.label}
              </span>
            ))}
          </div>
        )}

        {/* Details */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
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
          {position.expirationDate && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">到期</span>
              <span className={`${expiringThisWeek ? 'text-warning font-medium' : 'text-foreground'}`}>
                {formatDate(position.expirationDate)} ({dte}d)
              </span>
            </div>
          )}
          {profitPercent !== null && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">浮盈</span>
              <span className={profitPercent >= 0 ? 'text-profit font-medium' : 'text-loss font-medium'}>
                {profitPercent.toFixed(1)}%
              </span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted-foreground">标的</span>
            <span className="text-foreground">{formatCurrency(position.currentPrice)}</span>
          </div>
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
                placeholder={position.type === 'sell_put' ? '如 0.05 (到期归零填0)' : '平仓价格'}
                value={closePremium}
                onChange={e => setClosePremium(e.target.value)}
                inputMode="decimal"
              />
              <Button size="sm" variant="profit" onClick={handleClose}>确认平仓</Button>
              <Button size="sm" variant="outline" onClick={() => setShowCloseForm(false)}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          </div>
        )}

        {/* Action buttons */}
        {!isEditing && !showCloseForm && (
          <div className="flex gap-2 mt-3 pt-3 border-t">
            <Button
              size="sm"
              variant="ghost"
              className="flex-1 text-xs"
              onClick={() => setIsEditing(true)}
            >
              更新
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="flex-1 text-xs text-profit"
              onClick={() => setShowCloseForm(true)}
            >
              平仓
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-xs text-destructive"
              onClick={() => onDelete(position.id)}
            >
              删除
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
