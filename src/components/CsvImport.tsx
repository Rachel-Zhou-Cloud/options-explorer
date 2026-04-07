import { useState, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import type { Position, PositionType } from '@/types'
import { showToast } from '@/components/ui/toast'
import { Upload, X, Check } from 'lucide-react'

interface CsvImportProps {
  onImport: (positions: Omit<Position, 'id' | 'isClosed'>[]) => void
  onClose: () => void
}

interface ParsedRow {
  ticker: string
  type: PositionType
  strikePrice: number
  quantity: number
  premium: number
  currentPrice: number
  costBasis?: number
  expirationDate?: string
  selected: boolean
}

function guessType(row: Record<string, string>): PositionType {
  const desc = (row['Description'] || row['description'] || row['type'] || row['Type'] || '').toLowerCase()
  if (desc.includes('put') && (desc.includes('sell') || desc.includes('short'))) return 'sell_put'
  if (desc.includes('call') && (desc.includes('sell') || desc.includes('short'))) return 'sell_call'
  if (desc.includes('call') && (desc.includes('buy') || desc.includes('long'))) return 'leap_call'
  if (desc.includes('put') && (desc.includes('buy') || desc.includes('long'))) return 'buy_put'
  if (desc.includes('stock') || desc.includes('equity')) return 'stock'
  // Try to guess from other clues
  const qty = parseFloat(row['Quantity'] || row['quantity'] || row['Qty'] || '0')
  if (qty < 0) return 'sell_put' // negative qty usually means short
  return 'stock'
}

function parseNumber(val: string | undefined): number {
  if (!val) return 0
  return parseFloat(val.replace(/[,$]/g, '')) || 0
}

function parseCsv(text: string): ParsedRow[] {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return []

  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''))
  const rows: ParsedRow[] = []

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''))
    if (values.length < 2) continue

    const row: Record<string, string> = {}
    headers.forEach((h, idx) => { row[h] = values[idx] || '' })

    const ticker = (row['Symbol'] || row['symbol'] || row['Ticker'] || row['ticker'] || row['股票代码'] || '').toUpperCase()
    if (!ticker || ticker === 'SYMBOL' || ticker === 'TOTAL') continue

    const type = guessType(row)
    const strike = parseNumber(row['Strike'] || row['strike'] || row['行权价'] || row['Strike Price'])
    const qty = Math.abs(parseNumber(row['Quantity'] || row['quantity'] || row['Qty'] || row['数量'] || row['Position']))
    const premium = parseNumber(row['Premium'] || row['premium'] || row['Avg Price'] || row['Average Price'] || row['权利金'] || row['Cost Basis'])
    const price = parseNumber(row['Market Price'] || row['Last Price'] || row['Price'] || row['Current Price'] || row['现价'] || row['Mark'])
    const costBasis = parseNumber(row['Cost Basis'] || row['Avg Cost'] || row['成本价'])
    const expDate = row['Expiration'] || row['expiration'] || row['Expiry'] || row['到期日'] || row['Exp Date'] || ''

    if (qty === 0) continue

    rows.push({
      ticker,
      type,
      strikePrice: strike,
      quantity: qty || 1,
      premium,
      currentPrice: price,
      costBasis: type === 'stock' ? (costBasis || premium) : undefined,
      expirationDate: expDate || undefined,
      selected: true,
    })
  }

  return rows
}

const TYPE_LABELS: Record<PositionType, string> = {
  sell_put: 'SP',
  sell_call: 'SC',
  leap_call: 'LC',
  buy_call: 'BC',
  buy_put: 'BP',
  stock: 'STK',
  custom: 'OTH',
}

export function CsvImport({ onImport, onClose }: CsvImportProps) {
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [fileName, setFileName] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)

    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      const parsed = parseCsv(text)
      if (parsed.length === 0) {
        showToast('未能解析出有效持仓数据', 'error')
        return
      }
      setRows(parsed)
      showToast(`解析出 ${parsed.length} 条记录`, 'success')
    }
    reader.readAsText(file)
  }

  const toggleRow = (idx: number) => {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, selected: !r.selected } : r))
  }

  const changeType = (idx: number, type: PositionType) => {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, type } : r))
  }

  const handleImport = () => {
    const selected = rows.filter(r => r.selected)
    if (selected.length === 0) {
      showToast('请至少选择一条记录', 'error')
      return
    }

    const positions: Omit<Position, 'id' | 'isClosed'>[] = selected.map(r => ({
      type: r.type,
      ticker: r.ticker,
      strikePrice: r.strikePrice,
      currentPrice: r.currentPrice,
      quantity: r.quantity,
      premium: r.premium,
      costBasis: r.costBasis,
      expirationDate: r.expirationDate,
      openDate: new Date().toISOString(),
    }))

    onImport(positions)
    showToast(`成功导入 ${positions.length} 个持仓`, 'success')
    onClose()
  }

  const selectedCount = rows.filter(r => r.selected).length

  return (
    <Card className="animate-slide-up">
      <CardHeader className="flex-row items-center justify-between pb-3">
        <CardTitle className="text-sm">CSV 导入持仓</CardTitle>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {rows.length === 0 ? (
          <>
            <p className="text-xs text-muted-foreground leading-relaxed">
              支持 IBKR Activity Statement、富途导出等 CSV 格式。
              需包含 Symbol/Ticker 列，可选：Strike, Quantity, Premium, Expiration 等列。
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.txt"
              className="hidden"
              onChange={handleFile}
            />
            <Button variant="outline" onClick={() => fileRef.current?.click()}>
              <Upload className="h-4 w-4 mr-1.5" />
              选择 CSV 文件
            </Button>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{fileName} - {rows.length} 条记录</span>
              <span className="text-xs text-profit font-medium">已选 {selectedCount}</span>
            </div>

            <div className="max-h-64 overflow-y-auto -mx-1 px-1">
              {rows.map((row, idx) => (
                <div
                  key={idx}
                  className={`flex items-center gap-2 py-1.5 px-2 rounded-lg mb-1 text-xs transition-colors ${
                    row.selected ? 'bg-secondary/50' : 'opacity-40'
                  }`}
                >
                  <button onClick={() => toggleRow(idx)} className="shrink-0">
                    <div className={`h-4 w-4 rounded border flex items-center justify-center ${
                      row.selected ? 'bg-primary border-primary' : 'border-muted-foreground'
                    }`}>
                      {row.selected && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                    </div>
                  </button>
                  <select
                    className="bg-transparent text-[10px] font-bold text-primary border-none p-0"
                    value={row.type}
                    onChange={e => changeType(idx, e.target.value as PositionType)}
                  >
                    {Object.entries(TYPE_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                  <span className="font-semibold text-foreground">{row.ticker}</span>
                  {row.strikePrice > 0 && <span className="text-muted-foreground">${row.strikePrice}</span>}
                  <span className="text-muted-foreground">×{row.quantity}</span>
                  {row.expirationDate && <span className="text-muted-foreground ml-auto">{row.expirationDate}</span>}
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <Button className="flex-1" onClick={handleImport} disabled={selectedCount === 0}>
                导入 {selectedCount} 个持仓
              </Button>
              <Button variant="outline" onClick={() => { setRows([]); setFileName('') }}>
                重选
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
