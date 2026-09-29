export interface Sample {
  id: string
  category: string
  source: string
  reference: string
  hypothesis: string
  chrf: number
}

export interface Replication {
  command: string
  base_url?: string
  key_env?: string
  chat_kwargs?: Record<string, unknown> | null
  max_tokens?: number
  request_body?: Record<string, unknown>
  notes?: string[]
}

export interface RunRow {
  label: string
  file: string
  backend: string
  model: string
  prompt_style: string
  provider: string
  hosted: boolean
  pairs: number
  testset: string
  metrics: { chrf: number; chrfpp: number; bleu: number }
  metric_backend: string
  exact_match_rate: number | null
  seconds_per_sentence: number | null
  timestamp: string | null
  chrf_by_category: Record<string, number>
  samples_capped: boolean
  samples: Sample[]
  replication: Replication
  best: { chrf?: boolean; chrfpp?: boolean; bleu?: boolean; speed?: boolean }
}

export interface SurvivalFailure {
  id: string
  failures: string[]
  hypothesis: string
}

export interface SurvivalRow {
  label: string
  file: string
  model: string
  prompt_style: string
  provider: string
  hosted: boolean
  direction: string
  passed: number
  total: number
  verdict: 'PASS' | 'FAIL'
  restored_chrf: number
  restored_chrfpp: number
  restored_bleu: number
  failures: SurvivalFailure[]
  timestamp: string | null
}

export interface DirectionData {
  direction: string
  src: string
  tgt: string
  runs: RunRow[]
  best_run: { label: string; file: string; chrf_by_category: Record<string, number> }
  token_survival: SurvivalRow[]
}

export interface PromptTemplate {
  description: string
  user_message?: string
  system_message?: string | null
  request_body?: Record<string, unknown>
}

export interface Recommendation {
  updated: string
  summary: string
  primary: { model: string; provider: string; prompt: string; why: string[] }
  alternatives: { model: string; provider: string; role: string; why: string }[]
  disqualified: { models: string[]; reason: string }[]
  caveats: string[]
  history: string[]
}

export interface SiteData {
  generated_at: string
  directions: DirectionData[]
  token_survival: SurvivalRow[]
  prompts: Record<string, PromptTemplate>
  recommendation: Recommendation
}
