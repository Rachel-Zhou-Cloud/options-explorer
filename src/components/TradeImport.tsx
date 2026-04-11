import { useState } from 'react'
import type { ClosedTrade, PositionType } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Upload, X, Check, FileText } from 'lucide-react'

interface TradeImportProps {
  onImport: (trades: Omit<ClosedTrade, 'id'>[]) => void
  onClose: () => void
}

const TYPE_OPTIONS: { value: PositionType; label: string }[] = [
  { value: 'sell_put', label: 'Sell Put' },
  { value: 'sell_call', label: 'Sell Call' },
  { value: 'leap_call', label: 'LEAP Call' },
  { value: 'buy_call', label: 'Buy Call' },
  { value: 'buy_put', label: 'Buy Put' },
  { value: 'stock', label: 'Stock' },
  { value: 'custom', label: 'Other' },
]

interface ParsedRow {
  type: PositionType
  ticker: string
  strikePrice: number
  premium: number
  closePremium: number
  quantity: number
  openDate: string
  closeDate: string
  expirationDate?: string
  pnl: number
  pnlPercent: number
  selected: boolean
}

function guessType(raw: string): PositionType {
  const s = raw.toLowerCase().trim()
  if (s.includes('sell') && s.includes('put') || s === 'sp') return 'sell_put'
  if (s.includes('sell') && s.includes('call') || s === 'sc') return 'sell_call'
  if (s.includes('leap') || s === 'lc') return 'leap_call'
  if (s.includes('buy') && s.includes('call') || s === 'bc') return 'buy_call'
  if (s.includes('buy') && s.includes('put') || s === 'bp') return 'buy_put'
  if (s.includes('stock') || s === 'stk') return 'stock'
  return 'custom'
}

function parseDate(raw: string): string {
  if (!raw) return new Date().toISOString()
  const trimmed = raw.trim()
  // Try ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return new Date(trimmed).toISOString()
  // Try MM/DD/YYYY
  const parts = trimmed.split(/[\/\-\.]/)
  if (parts.length === 3) {
    const [a, b, c] = parts.map(Number)
    if (a > 31) return new Date(a, b - 1, c).toISOString() // YYYY-M-D
    if (c > 31) return new Date(c, a - 1, b).toISOString() // M/D/YYYY
    return new Date(2000 + c, a - 1, b).toISOString() // M/D/YY
  }
  return new Date().toISOString()
}

function parseCsvRows(text: string): ParsedRow[] {
  const lines = text.trim().split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length < 2) return []

  const header = lines[0].toLowerCase()
  const sep = header.includes('\t') ? '\t' : ','
  const cols = lines[0].split(sep).map(c => c.trim().toLowerCase().replace(/['"]/g, ''))

  const findCol = (...aliases: string[]) => {
    for (const a of aliases) {
      const idx = cols.findIndex(c => c.includes(a))
      if (idx >= 0) return idx
    }
    return -1
  }

  const iType = findCol('type', '类型', '策略')
  const iTicker = findCol('ticker', 'symbol', '代码', '股票')
  const iStrike = findCol('strike', '行权')
  const iPremium = findCol('open_premium', '开仓权利金', 'premium')
  const iClosePremium = findCol('close_premium', '平仓权利金')
  const iQty = findCol('qty', 'quantity', '数量', '手数')
  const iOpenDate = findCol('open_date', '开仓日', '建仓')
  const iCloseDate = findCol('close_date', '平仓日', '了结')
  const iExpDate = findCol('exp', '到期')
  const iPnl = findCol('pnl', '盈亏', 'profit')
  const iPnlPct = findCol('pnl%', 'pnl_pct', '收益率', '盈亏%')

  if (iTicker < 0) return []

  const rows: ParsedRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(sep).map(v => v.trim().replace(/['"]/g, ''))
    if (vals.length < 2) continue

    const ticker = vals[iTicker]?.toUpperCase()
    if (!ticker) continue

    const type = iType >= 0 ? guessType(vals[iType]) : 'sell_put'
    const strikePrice = iStrike >= 0 ? parseFloat(vals[iStrike]) || 0 : 0
    const premium = iPremium >= 0 ? parseFloat(vals[iPremium]) || 0 : 0
    const closePremium = iClosePremium >= 0 ? parseFloat(vals[iClosePremium]) || 0 : 0
    const quantity = iQty >= 0 ? parseInt(vals[iQty]) || 1 : 1
    const openDate = iOpenDate >= 0 ? parseDate(vals[iOpenDate]) : new Date().toISOString()
    const closeDate = iCloseDate >= 0 ? parseDate(vals[iCloseDate]) : new Date().toISOString()
    const expirationDate = iExpDate >= 0 && vals[iExpDate] ? parseDate(vals[iExpDate]) : undefined

    let pnl = iPnl >= 0 ? parseFloat(vals[iPnl]) || 0 : 0
    let pnlPercent = iPnlPct >= 0 ? parseFloat(vals[iPnlPct]) || 0 : 0

    // Auto-calc PnL if not provided
    if (pnl === 0 && premium > 0) {
      if (type === 'sell_put' || type === 'sell_call') {
        pnl = (premium - closePremium) * quantity * 100
      } else if (type === 'stock') {
        pnl = (closePremium - premium) * quantity
      } else {
        pnl = (closePremium - premium) * quantity * 100
      }
    }
    if (pnlPercent === 0 && premium > 0) {
      if (type === 'sell_put' || type === 'sell_call') {
        pnlPercent = ((premium - closePremium) / premium) * 100
      } else {
        pnlPercent = ((closePremium - premium) / premium) * 100
      }
    }

    rows.push({
      type, ticker, strikePrice, premium, closePremium, quantity,
      openDate, closeDate, expirationDate, pnl, pnlPercent, selected: true,
    })
  }
  return rows
}

export function TradeImport({ onImport, onClose }: TradeImportProps) {
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [manualMode, setManualMode] = useState(false)
  // Manual form
  const [mType, setMType] = useState<PositionType>('sell_put')
  const [mTicker, setMTicker] = useState('')
  const [mStrike, setMStrike] = useState('')
  const [mPremium, setMPremium] = useState('')
  const [mClosePremium, setMClosePremium] = useState('')
  const [mQty, setMQty] = useState('1')
  const [mOpenDate, setMOpenDate] = useState('')
  const [mCloseDate, setMCloseDate] = useState('')
  const [mPnl, setMPnl] = useState('')

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      if (text) setRows(parseCsvRows(text))
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const toggleRow = (i: number) => {
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, selected: !r.selected } : r))
  }

  const updateRowType = (i: number, type: PositionType) => {
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, type } : r))
  }

  const handleCsvImport = () => {
    const selected = rows.filter(r => r.selected)
    if (selected.length === 0) return
    onImport(selected.map(({ selected: _, ...r }) => ({ ...r, isWin: r.pnl > 0 })))
  }

  const handleManualAdd = () => {
    const ticker = mTicker.trim().toUpperCase()
    if (!ticker) return
    const premium = parseFloat(mPremium) || 0
    const closePremium = parseFloat(mClosePremium) || 0
    const quantity = parseInt(mQty) || 1
    let pnl = parseFloat(mPnl) || 0
    if (pnl === 0 && premium > 0) {
      if (mType === 'sell_put' || mType === 'sell_call') {
        pnl = (premium - closePremium) * quantity * 100
      } else if (mType === 'stock') {
        pnl = (closePremium - premium) * quantity
      } else {
        pnl = (closePremium - premium) * quantity * 100
      }
    }
    const pnlPercent = premium > 0
      ? (mType === 'sell_put' || mType === 'sell_call'
        ? ((premium - closePremium) / premium) * 100
        : ((closePremium - premium) / premium) * 100)
      : 0

    onImport([{
      type: mType,
      ticker,
      strikePrice: parseFloat(mStrike) || 0,
      premium,
      closePremium,
      quantity,
      openDate: mOpenDate ? new Date(mOpenDate).toISOString() : new Date().toISOString(),
      closeDate: mCloseDate ? new Date(mCloseDate).toISOString() : new Date().toISOString(),
      pnl,
      pnlPercent,
      isWin: pnl > 0,
    }])
  }

  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            导入历史交易
          </CardTitle>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {/* Mode toggle */}
        <div className="flex gap-2">
          <Button size="sm" variant={!manualMode ? 'default' : 'outline'} onClick={() => setManualMode(false)} className="flex-1 text-xs">
            CSV 导入
          </Button>
          <Button size="sm" variant={manualMode ? 'default' : 'outline'} onClick={() => setManualMode(true)} className="flex-1 text-xs">
            手动录入
          </Button>
        </div>

        {!manualMode ? (
          <>
            {rows.length === 0 ? (
              <div className="flex flex-col gap-2">
                <label className="flex flex-col items-center gap-2 border-2 border-dashed rounded-xl p-6 cursor-pointer hover:border-primary/50 transition-colors">
                  <Upload className="h-6 w-6 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">点击上传 CSV 文件</span>
                  <input type="file" accept=".csv,.tsv,.txt" onChange={handleFile} className="hidden" />
                </label>
                <div className="text-[10px] text-muted-foreground leading-relaxed">
                  <p className="font-medium mb-1">CSV 格式要求 (表头列名):</p>
                  <p>必填: ticker/symbol (代码)</p>
                  <p>可选: type (类型), strike (行权价), open_premium (开仓权利金), close_premium (平仓权利金), qty (数量), open_date (开仓日), close_date (平仓日), exp (到期日), pnl (盈亏)</p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="text-xs text-muted-foreground">
                  解析到 {rows.length} 条记录，已选 {rows.filter(r => r.selected).length} 条
                </div>
                <div className="max-h-60 overflow-y-auto flex flex-col gap-1">
                  {rows.map((row, i) => (
                    <div key={i} className={`flex items-center gap-2 p-2 rounded-lg text-xs ${row.selected ? 'bg-primary/5' : 'bg-secondary/50 opacity-60'}`}>
                      <button onClick={() => toggleRow(i)} className="shrink-0">
                        <div className={`h-4 w-4 rounded border flex items-center justify-center ${row.selected ? 'bg-primary border-primary' : 'border-muted-foreground'}`}>
                          {row.selected && <Check className="h-3 w-3 text-primary-foreground" />}
                        </div>
                      </button>
                      <select
                        value={row.type}
                        onChange={e => updateRowType(i, e.target.value as PositionType)}
                        className="bg-transparent text-[10px] font-bold w-14 shrink-0"
                      >
                        {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      <span className="font-medium shrink-0">{row.ticker}</span>
                      {row.strikePrice > 0 && <span className="text-muted-foreground">${row.strikePrice}</span>}
                      <span className={`ml-auto font-semibold ${row.pnl >= 0 ? 'text-profit' : 'text-loss'}`}>
                        {row.pnl >= 0 ? '+' : ''}${row.pnl.toFixed(0)}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleCsvImport} className="flex-1">
                    导入 {rows.filter(r => r.selected).length} 条
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setRows([])}>重选</Button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] text-muted-foreground">类型</label>
                <select value={mType} onChange={e => setMType(e.target.value as PositionType)}
                  className="input-field text-xs py-1.5">
                  {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">代码</label>
                <input className="input-field text-xs py-1.5" value={mTicker}
                  onChange={e => setMTicker(e.target.value)} placeholder="AAPL" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">数量</label>
                <input type="number" className="input-field text-xs py-1.5" value={mQty}
                  onChange={e => setMQty(e.target.value)} inputMode="numeric" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] text-muted-foreground">行权价</label>
                <input type="number" className="input-field text-xs py-1.5" value={mStrike}
                  onChange={e => setMStrike(e.target.value)} inputMode="decimal" placeholder="0" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">开仓权利金</label>
                <input type="number" className="input-field text-xs py-1.5" value={mPremium}
                  onChange={e => setMPremium(e.target.value)} inputMode="decimal" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">平仓权利金</label>
                <input type="number" className="input-field text-xs py-1.5" value={mClosePremium}
                  onChange={e => setMClosePremium(e.target.value)} inputMode="decimal" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] text-muted-foreground">开仓日</label>
                <input type="date" className="input-field text-xs py-1.5" value={mOpenDate}
                  onChange={e => setMOpenDate(e.target.value)} />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">平仓日</label>
                <input type="date" className="input-field text-xs py-1.5" value={mCloseDate}
                  onChange={e => setMCloseDate(e.target.value)} />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">实际盈亏</label>
                <input type="number" className="input-field text-xs py-1.5" value={mPnl}
                  onChange={e => setMPnl(e.target.value)} inputMode="decimal" placeholder="自动" />
              </div>
            </div>
            <Button size="sm" onClick={handleManualAdd} disabled={!mTicker.trim()}>
              添加交易记录
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
