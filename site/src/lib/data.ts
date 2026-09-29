import type { DirectionData, SiteData } from '@/types'
import rawData from '@/data/results.json'

export const data = rawData as unknown as SiteData

export function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  })
}

/** Render private-use protection tokens as readable ⟨n⟩ markers. */
export function renderTokens(text: string): string {
  return text.replace(/\uE000(\d+)\uE001/g, '⟨$1⟩')
}

/** Heat colour for a 0-100 chrF value: red at ~40, green at 100. */
export function heatHue(value: number): number {
  const clamped = Math.min(100, Math.max(40, value))
  return 25 + ((clamped - 40) / 60) * 120
}

export function heatText(value: number): string {
  return `oklch(0.78 0.14 ${heatHue(value)})`
}

export function heatBackground(value: number): string {
  return `oklch(0.55 0.13 ${heatHue(value)} / 0.18)`
}

export function directionLabel(direction: DirectionData): string {
  return `${direction.src} → ${direction.tgt}`
}
