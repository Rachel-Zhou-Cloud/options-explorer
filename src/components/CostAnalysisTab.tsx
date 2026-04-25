import { useState } from 'react'
import type { Position, CostRecord } from '@/types'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { formatCurrency, formatDateFull } from '@/lib/calculations'
import { showToast } from '@/components/ui/toast'
import {
  PiggyBank,
  Plus,
  Trash2,
  TrendingDown,
  ChevronDown,
  ChevronUp,
  BarChart3,
} from 'lucide-react'

interface CostAnalysisTabProps {
  positions: Position[]
  costRecords: CostRecord[]
  onAddRecord: (record: Omit<CostRecord, 'id'>) => void
  onDeleteRecord: (id: string) => void
  getRecordsForPosition: (positionId: string) => CostRecord[]
}

export function CostAnalysisTab({
  positions,
  costRecords,
  onAddRecord,
  onDeleteRecord,
  getRecordsForPosition,
}: CostAnalysisTabProps) {
  // Only show LEAP calls and stocks — the positions that have a "cost"
  const longPositions = positions.filter(p => p.type === 'leap_call' || p.type === 'stock')

  return (
    <div className="flex flex-col gap-4 pb-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3 px-1">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
          <PiggyBank className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-foreground">成本分析</h2>
          <p className="text-xs text-muted-foreground">PMCC / Covered Call 成本摊薄追踪</p>
        </div>
      </div>

      {/* Empty state */}
      {longPositions.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary mb-4">
            <BarChart3 className="h-8 w-8 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground mb-1">暂无 LEAP Call 或正股持仓</p>
          <p className="text-xs text-muted-foreground">先在「持仓」中添加 LEAP Call 或正股，即可在此追踪成本摊薄</p>
        </div>
      )}

      {/* Summary card */}
      {longPositions.length > 0 && (
        <CostSummaryCard positions={longPositions} costRecords={costRecords} />
      )}

      {/* Position cost cards */}
      {longPositions.map(pos => (
        <PositionCostCard
          key={pos.id}
          position={pos}
          records={getRecordsForPosition(pos.id)}
          onAddRecord={onAddRecord}
          onDeleteRecord={onDeleteRecord}
        />
      ))}
    </div>
  )
}

function CostSummaryCard({
  positions,
  costRecords,
}: {
  positions: Position[]
  costRecords: CostRecord[]
}) {
  let totalInitialCost = 0
  let totalCollected = 0

  for (const pos of positions) {
    const perShareCost = pos.type === 'stock' ? (pos.costBasis || 0) : pos.premium
    const multiplier = pos.type === 'stock' ? pos.quantity : pos.quantity * 100
    totalInitialCost += perShareCost * multiplier

    const records = costRecords.filter(r => r.parentPositionId === pos.id)
    for (const r of records) {
      totalCollected += r.premiumCollected * r.quantity * (pos.type === 'stock' ? 1 : 100)
    }
  }

  const netCost = totalInitialCost - totalCollected
  const reductionPercent = totalInitialCost > 0 ? (totalCollected / totalInitialCost) * 100 : 0

  return (
    <Card className="border-primary/20 glow-primary">
      <CardContent className="p-4">
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <div className="stat-label mb-1">初始成本</div>
            <div className="text-sm font-semibold text-foreground">{formatCurrency(totalInitialCost)}</div>
          </div>
          <div>
            <div className="stat-label mb-1">已回收</div>
            <div className="text-sm font-semibold text-profit">{formatCurrency(totalCollected)}</div>
          </div>
          <div>
            <div className="stat-label mb-1">净成本</div>
            <div className={`text-sm font-semibold ${netCost <= 0 ? 'text-profit' : 'text-foreground'}`}>
              {formatCurrency(netCost)}
            </div>
          </div>
        </div>
        <div className="mt-3 pt-3 border-t">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">成本回收进度</span>
            <span className="text-profit font-medium">{reductionPercent.toFixed(1)}%</span>
          </div>
          <div className="mt-1.5 h-2 rounded-full bg-secondary overflow-hidden">
            <div
              className="h-full rounded-full bg-profit transition-all duration-500"
              style={{ width: `${Math.min(100, reductionPercent)}%` }}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function PositionCostCard({
  position,
  records,
  onAddRecord,
  onDeleteRecord,
}: {
  position: Position
  records: CostRecord[]
  onAddRecord: (record: Omit<CostRecord, 'id'>) => void
  onDeleteRecord: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)

  const isStock = position.type === 'stock'
  const perShareCost = isStock ? (position.costBasis || 0) : position.premium
  const multiplier = isStock ? 1 : 100

  const totalCollectedPerShare = records.reduce((sum, r) => {
    // Normalize: if record quantity differs, proportionally allocate
    return sum + (r.premiumCollected * r.quantity) / position.quantity
  }, 0)

  const adjustedCostPerShare = perShareCost - totalCollectedPerShare
  const reductionPercent = perShareCost > 0 ? (totalCollectedPerShare / perShareCost) * 100 : 0
  const totalCost = perShareCost * position.quantity * multiplier
  const totalCollected = totalCollectedPerShare * position.quantity * multiplier

  const typeLabel = isStock ? 'STK' : 'LC'
  const typeColor = isStock
    ? 'bg-secondary text-secondary-foreground'
    : 'bg-profit/10 text-profit'

  const sortedRecords = [...records].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  )

  return (
    <Card>
      <CardContent className="p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${typeColor}`}>
              {typeLabel}
            </span>
            <span className="font-semibold text-foreground">{position.ticker}</span>
            {!isStock && (
              <span className="text-sm text-muted-foreground">${position.strikePrice}</span>
            )}
            <span className="text-xs text-muted-foreground">x{position.quantity}</span>
          </div>
          <Button size="sm" variant="ghost" onClick={() => setExpanded(!expanded)}>
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>

        {/* Cost overview */}
        <div className="grid grid-cols-3 gap-2 text-center mb-3">
          <div>
            <div className="text-[10px] text-muted-foreground">初始成本/股</div>
            <div className="text-sm font-semibold text-foreground">{formatCurrency(perShareCost)}</div>
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground flex items-center justify-center gap-0.5">
              <TrendingDown className="h-3 w-3 text-profit" />
              已回收/股
            </div>
            <div className="text-sm font-semibold text-profit">{formatCurrency(totalCollectedPerShare)}</div>
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground">摊薄后/股</div>
            <div className={`text-sm font-semibold ${adjustedCostPerShare <= 0 ? 'text-profit' : 'text-foreground'}`}>
              {formatCurrency(adjustedCostPerShare)}
            </div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
          <span>成本摊薄 {reductionPercent.toFixed(1)}%</span>
          <span>{formatCurrency(totalCollected)} / {formatCurrency(totalCost)}</span>
        </div>
        <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
          <div
            className="h-full rounded-full bg-profit transition-all duration-500"
            style={{ width: `${Math.min(100, reductionPercent)}%` }}
          />
        </div>

        {/* Suggested CC Strike Prices */}
        {adjustedCostPerShare > 0 && position.currentPrice > 0 && (
          <div className="mt-3 pt-3 border-t">
            <div className="text-[10px] font-medium text-muted-foreground mb-1.5">
              建议 Covered Call 行权价
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {[10, 15, 20].map(pct => {
                const strike = isStock
                  ? adjustedCostPerShare * (1 + pct / 100)
                  : position.strikePrice + adjustedCostPerShare * (1 + pct / 100)
                const isOTM = strike > position.currentPrice
                return (
                  <div key={pct} className="rounded-lg bg-secondary/50 p-2 text-center">
                    <div className="text-[10px] text-muted-foreground">{pct}%回报</div>
                    <div className={`text-xs font-semibold ${isOTM ? 'text-foreground' : 'text-warning'}`}>
                      ${strike.toFixed(0)}
                    </div>
                    <div className={`text-[9px] ${isOTM ? 'text-profit' : 'text-warning'}`}>
                      {isOTM ? 'OTM' : 'ITM'}
                    </div>
                  </div>
                )
              })}
            </div>
            <p className="text-[9px] text-muted-foreground mt-1.5 leading-relaxed">
              基于摊薄后成本 {formatCurrency(adjustedCostPerShare)}/股，当前价 ${position.currentPrice.toFixed(1)}
            </p>
          </div>
        )}

        {/* Expanded: records list + add form */}
        {expanded && (
          <div className="mt-3 pt-3 border-t animate-fade-in">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-muted-foreground">
                收入记录 ({records.length})
              </span>
              <Button size="sm" variant="outline" onClick={() => setShowAddForm(!showAddForm)}>
                <Plus className="h-3 w-3 mr-1" />
                添加
              </Button>
            </div>

            {showAddForm && (
              <AddCostRecordForm
                parentPositionId={position.id}
                defaultQuantity={position.quantity}
                onAdd={(record) => {
                  onAddRecord(record)
                  setShowAddForm(false)
                  showToast('收入记录已添加', 'success')
                }}
                onCancel={() => setShowAddForm(false)}
              />
            )}

            {sortedRecords.length === 0 && !showAddForm && (
              <p className="text-xs text-muted-foreground text-center py-4">
                暂无收入记录，点击「添加」录入 Sell Call 或做T收入
              </p>
            )}

            {sortedRecords.map(record => (
              <div
                key={record.id}
                className="flex items-center justify-between py-2 border-b last:border-0 text-xs"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <SourceBadge source={record.source} />
                    <span className="text-foreground truncate">{record.description}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {formatDateFull(record.date)} · x{record.quantity}
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-2">
                  <span className="text-profit font-medium whitespace-nowrap">
                    +{formatCurrency(record.premiumCollected)}/股
                  </span>
                  <button
                    className="text-muted-foreground hover:text-destructive transition-colors"
                    onClick={() => onDeleteRecord(record.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function SourceBadge({ source }: { source: CostRecord['source'] }) {
  const config = {
    sell_call: { label: 'SC', className: 'bg-primary/10 text-primary' },
    day_trade: { label: '做T', className: 'bg-warning/10 text-warning' },
    other: { label: '其他', className: 'bg-secondary text-secondary-foreground' },
  }
  const { label, className } = config[source]
  return (
    <span className={`rounded px-1 py-0.5 text-[9px] font-bold ${className}`}>
      {label}
    </span>
  )
}

function AddCostRecordForm({
  parentPositionId,
  defaultQuantity,
  onAdd,
  onCancel,
}: {
  parentPositionId: string
  defaultQuantity: number
  onAdd: (record: Omit<CostRecord, 'id'>) => void
  onCancel: () => void
}) {
  const [source, setSource] = useState<CostRecord['source']>('sell_call')
  const [description, setDescription] = useState('')
  const [premiumCollected, setPremiumCollected] = useState('')
  const [quantity, setQuantity] = useState(defaultQuantity.toString())
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])

  const handleSubmit = () => {
    const premium = parseFloat(premiumCollected)
    const qty = parseInt(quantity)
    if (!description || isNaN(premium) || premium <= 0 || isNaN(qty) || qty <= 0) {
      showToast('请填写完整信息', 'error')
      return
    }

    onAdd({
      parentPositionId,
      description,
      premiumCollected: premium,
      quantity: qty,
      date,
      source,
    })
  }

  const sourceOptions: { value: CostRecord['source']; label: string }[] = [
    { value: 'sell_call', label: 'Sell Call' },
    { value: 'day_trade', label: '做T' },
    { value: 'other', label: '其他' },
  ]

  return (
    <div className="mb-3 p-3 rounded-lg bg-secondary/30 border flex flex-col gap-2.5 animate-fade-in">
      {/* Source selector */}
      <div className="flex gap-2">
        {sourceOptions.map(opt => (
          <button
            key={opt.value}
            className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-all ${
              source === opt.value
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-secondary-foreground'
            }`}
            onClick={() => setSource(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div>
        <label className="text-[10px] text-muted-foreground mb-0.5 block">描述</label>
        <input
          className="input-field text-xs py-1.5"
          placeholder={source === 'sell_call' ? '如 Sell AAPL 160C 4/18' : '交易描述'}
          value={description}
          onChange={e => setDescription(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="text-[10px] text-muted-foreground mb-0.5 block">收入/股</label>
          <input
            type="number"
            className="input-field text-xs py-1.5"
            placeholder="$"
            value={premiumCollected}
            onChange={e => setPremiumCollected(e.target.value)}
            inputMode="decimal"
          />
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground mb-0.5 block">合约数</label>
          <input
            type="number"
            className="input-field text-xs py-1.5"
            value={quantity}
            onChange={e => setQuantity(e.target.value)}
            inputMode="numeric"
          />
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground mb-0.5 block">日期</label>
          <input
            type="date"
            className="input-field text-xs py-1.5"
            value={date}
            onChange={e => setDate(e.target.value)}
          />
        </div>
      </div>

      <div className="flex gap-2">
        <Button size="sm" onClick={handleSubmit} className="flex-1">确认添加</Button>
        <Button size="sm" variant="outline" onClick={onCancel}>取消</Button>
      </div>
    </div>
  )
}
