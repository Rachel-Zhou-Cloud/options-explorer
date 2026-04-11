import { useState, useEffect, useCallback } from 'react'
import type { Position, ClosedTrade, CostRecord } from '@/types'
import { generateId } from '@/lib/calculations'

const STORAGE_KEY_POSITIONS = 'options-explorer-positions'
const STORAGE_KEY_TRADES = 'options-explorer-trades'
const STORAGE_KEY_COST_RECORDS = 'options-explorer-cost-records'
const STORAGE_KEY_API_KEY = 'options-explorer-api-key'

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return fallback
}

function saveToStorage<T>(key: string, data: T) {
  try {
    localStorage.setItem(key, JSON.stringify(data))
  } catch { /* ignore */ }
}

export function useStore() {
  const [positions, setPositions] = useState<Position[]>(() =>
    loadFromStorage(STORAGE_KEY_POSITIONS, [])
  )
  const [closedTrades, setClosedTrades] = useState<ClosedTrade[]>(() =>
    loadFromStorage(STORAGE_KEY_TRADES, [])
  )
  const [costRecords, setCostRecords] = useState<CostRecord[]>(() =>
    loadFromStorage(STORAGE_KEY_COST_RECORDS, [])
  )
  const [apiKey, setApiKeyState] = useState<string>(() => {
    try { return localStorage.getItem(STORAGE_KEY_API_KEY) || '' } catch { return '' }
  })

  useEffect(() => {
    saveToStorage(STORAGE_KEY_POSITIONS, positions)
  }, [positions])

  useEffect(() => {
    saveToStorage(STORAGE_KEY_TRADES, closedTrades)
  }, [closedTrades])

  useEffect(() => {
    saveToStorage(STORAGE_KEY_COST_RECORDS, costRecords)
  }, [costRecords])

  const addPosition = useCallback((pos: Omit<Position, 'id' | 'isClosed'>) => {
    setPositions(prev => {
      // For stocks: merge into existing same-ticker position (weighted avg cost)
      if (pos.type === 'stock') {
        const existing = prev.find(p => !p.isClosed && p.type === 'stock' && p.ticker === pos.ticker)
        if (existing) {
          const totalQty = existing.quantity + pos.quantity
          const avgCost = totalQty > 0
            ? ((existing.costBasis || 0) * existing.quantity + (pos.costBasis || 0) * pos.quantity) / totalQty
            : 0
          return prev.map(p => p.id === existing.id ? {
            ...p,
            quantity: totalQty,
            costBasis: avgCost,
            currentPrice: pos.currentPrice || p.currentPrice,
            notes: p.notes
              ? `${p.notes}; +${pos.quantity}@${pos.costBasis || 0}`
              : `+${pos.quantity}@${pos.costBasis || 0}`,
          } : p)
        }
      }
      const newPos: Position = { ...pos, id: generateId(), isClosed: false }
      return [...prev, newPos]
    })
  }, [])

  const updatePosition = useCallback((id: string, updates: Partial<Position>) => {
    setPositions(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p))
  }, [])

  const closePosition = useCallback((id: string, closePremium: number, closeQty?: number) => {
    setPositions(prev => {
      const pos = prev.find(p => p.id === id)
      if (!pos) return prev

      const qty = closeQty && closeQty > 0 && closeQty < pos.quantity ? closeQty : pos.quantity
      const isPartial = qty < pos.quantity
      const closeDate = new Date().toISOString()
      let pnl: number
      let pnlPercent: number

      if (pos.type === 'sell_put' || pos.type === 'sell_call') {
        pnl = (pos.premium - closePremium) * qty * 100
        pnlPercent = pos.premium > 0 ? ((pos.premium - closePremium) / pos.premium) * 100 : 0
      } else if (pos.type === 'stock') {
        pnl = (closePremium - (pos.costBasis || pos.strikePrice)) * qty
        pnlPercent = pos.costBasis ? ((closePremium - pos.costBasis) / pos.costBasis) * 100 : 0
      } else {
        pnl = (closePremium - pos.premium) * qty * 100
        pnlPercent = pos.premium > 0 ? ((closePremium - pos.premium) / pos.premium) * 100 : 0
      }

      const trade: ClosedTrade = {
        id: generateId(),
        type: pos.type,
        ticker: pos.ticker,
        strikePrice: pos.strikePrice,
        premium: pos.premium,
        closePremium,
        quantity: qty,
        openDate: pos.openDate,
        closeDate,
        expirationDate: pos.expirationDate,
        pnl,
        pnlPercent,
        isWin: pnl > 0,
      }

      setClosedTrades(prevTrades => [...prevTrades, trade])

      if (pos.type === 'sell_call' && pos.linkedPositionId && pnl > 0) {
        const costRecord: CostRecord = {
          id: generateId(),
          parentPositionId: pos.linkedPositionId,
          description: `Sell ${pos.ticker} ${pos.strikePrice}C ${pos.expirationDate ? new Date(pos.expirationDate).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }) : ''}`,
          premiumCollected: pos.premium - closePremium,
          quantity: qty,
          date: closeDate,
          source: 'sell_call',
        }
        setCostRecords(prevRecords => [...prevRecords, costRecord])
      }

      if (isPartial) {
        return prev.map(p => p.id === id ? { ...p, quantity: p.quantity - qty } : p)
      }
      return prev.filter(p => p.id !== id)
    })
  }, [])

  const deletePosition = useCallback((id: string) => {
    setPositions(prev => prev.filter(p => p.id !== id))
  }, [])

  const deleteTrade = useCallback((id: string) => {
    setClosedTrades(prev => prev.filter(t => t.id !== id))
  }, [])

  const addClosedTrade = useCallback((trade: Omit<ClosedTrade, 'id'>) => {
    const newTrade: ClosedTrade = { ...trade, id: generateId() }
    setClosedTrades(prev => [...prev, newTrade])
  }, [])

  const addCostRecord = useCallback((record: Omit<CostRecord, 'id'>) => {
    const newRecord: CostRecord = { ...record, id: generateId() }
    setCostRecords(prev => [...prev, newRecord])
  }, [])

  const deleteCostRecord = useCallback((id: string) => {
    setCostRecords(prev => prev.filter(r => r.id !== id))
  }, [])

  const getCostRecordsForPosition = useCallback((positionId: string) => {
    return costRecords.filter(r => r.parentPositionId === positionId)
  }, [costRecords])

  const setApiKey = useCallback((key: string) => {
    setApiKeyState(key)
    try { localStorage.setItem(STORAGE_KEY_API_KEY, key) } catch { /* ignore */ }
  }, [])

  const openPositions = positions.filter(p => !p.isClosed)

  return {
    positions: openPositions,
    closedTrades,
    costRecords,
    apiKey,
    addPosition,
    updatePosition,
    closePosition,
    deletePosition,
    deleteTrade,
    addClosedTrade,
    addCostRecord,
    deleteCostRecord,
    getCostRecordsForPosition,
    setApiKey,
  }
}
