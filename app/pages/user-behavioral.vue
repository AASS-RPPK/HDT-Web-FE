<script setup lang="ts">
definePageMeta({
  ssr: false,
  title: 'User Behavioral Dashboard'
})

type AnyRecord = Record<string, unknown>

const apiBase = ref<string>('')

function persistApiBase(value: string) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem('hdt_apiBase', value)
}

function restoreApiBase() {
  if (typeof window === 'undefined') return ''
  return window.localStorage.getItem('hdt_apiBase') ?? ''
}

function resolveApiUrl(path: string) {
  const base = (apiBase.value ?? '').trim().replace(/\/$/, '')
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return base ? `${base}${normalizedPath}` : normalizedPath
}

type UserAction = AnyRecord & {
  id?: string | number
  timestamp?: string | number
  type?: string
}

const actions = ref<UserAction[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

const timeRange = ref<'24h' | '7d' | '30d' | 'all'>('7d')
const actionFilter = ref<string>('all')
const searchQuery = ref<string>('')

const selectedAction = ref<UserAction | null>(null)
const selectedActionIndex = ref<number>(-1)

const uxInsightForm = reactive<{
  category: string
  severity: number
  note: string
}>({
  category: 'confusing',
  severity: 3,
  note: ''
})

const uxCategories = [
  { value: 'confusing', label: 'Confusing / unclear' },
  { value: 'missing', label: 'Missing key info' },
  { value: 'misaligned', label: 'AI suggestion misaligned' },
  { value: 'helpful', label: 'Helpful guidance' }
]

const uxSending = ref(false)
const uxError = ref<string | null>(null)

const recordForm = reactive<{
  type: string
  caseId: string
  slideId: string
  durationSeconds: number
  confidenceDelta?: number
  note: string
}>({
  type: 'annotated',
  caseId: '',
  slideId: '',
  durationSeconds: 60,
  confidenceDelta: undefined,
  note: ''
})

const actionTypes = [
  { value: 'annotated', label: 'Annotated (accepted)' },
  { value: 'corrected', label: 'Corrected AI label' },
  { value: 'revised', label: 'Revised annotation' },
  { value: 'skipped', label: 'Skipped / deferred' },
  { value: 'zoomed', label: 'Zoom / inspected ROI' }
]

function asArray(maybeItems: unknown): UserAction[] {
  if (Array.isArray(maybeItems)) return maybeItems as UserAction[]
  const obj = maybeItems as AnyRecord | null
  if (!obj) return []
  if (Array.isArray(obj.items)) return obj.items as UserAction[]
  if (Array.isArray(obj.actions)) return obj.actions as UserAction[]
  if (Array.isArray(obj.results)) return obj.results as UserAction[]
  return []
}

function parseTs(ts: unknown) {
  const n = typeof ts === 'number' ? ts : Number(ts)
  if (Number.isFinite(n) && n > 0) return new Date(n)
  const d = new Date(String(ts ?? ''))
  return Number.isNaN(d.getTime()) ? null : d
}

const filteredActions = computed(() => {
  const now = Date.now()
  const rangeMs
    = timeRange.value === '24h'
      ? 24 * 60 * 60 * 1000
      : timeRange.value === '7d'
        ? 7 * 24 * 60 * 60 * 1000
        : timeRange.value === '30d'
          ? 30 * 24 * 60 * 60 * 1000
          : Infinity
  const q = searchQuery.value.trim().toLowerCase()
  const typeWanted = actionFilter.value.trim().toLowerCase()
  const cutoff = rangeMs === Infinity ? -Infinity : now - rangeMs

  return actions.value.filter((a) => {
    const d = parseTs(a.timestamp)
    if (!d) return false
    if (d.getTime() < cutoff) return false

    const typeStr = String(a.type ?? a.actionType ?? a.event ?? '')
    const typeOk = typeWanted === 'all' ? true : typeStr.toLowerCase().includes(typeWanted)
    if (!typeOk) return false

    if (!q) return true
    const caseId = String(a.caseId ?? a.case_id ?? '')
    const slideId = String(a.slideId ?? a.slide_id ?? '')
    const note = String(a.note ?? a.notes ?? a.comment ?? '')
    return [typeStr, caseId, slideId, note].some(s => s.toLowerCase().includes(q))
  })
})

const metrics = computed(() => {
  const total = filteredActions.value.length
  const uniqueCases = new Set(filteredActions.value.map(a => String(a.caseId ?? a.case_id ?? a.case ?? 'unknown'))).size

  const typeCounts = filteredActions.value.reduce<Record<string, number>>((acc, a) => {
    const t = String(a.type ?? a.actionType ?? a.event ?? 'unknown')
    acc[t] = (acc[t] ?? 0) + 1
    return acc
  }, {})

  const corrected = filteredActions.value.filter((a) => {
    const t = String(a.type ?? a.actionType ?? '').toLowerCase()
    return t.includes('correct') || t.includes('corrected') || t.includes('revision') || t.includes('revised')
  }).length

  const correctionRate = total ? corrected / total : 0

  const totalDurationSeconds = filteredActions.value.reduce((acc, a) => {
    const v = a.durationSeconds ?? a.duration_seconds
    const n = typeof v === 'number' ? v : Number(v)
    return acc + (Number.isFinite(n) ? n : 0)
  }, 0)

  const avgDurationSeconds = total ? totalDurationSeconds / total : 0

  return { total, uniqueCases, typeCounts, corrected, correctionRate, avgDurationSeconds }
})

const dayBuckets = computed(() => {
  // Last 7 days (including today), for a small behavioral rhythm chart.
  const now = new Date()
  const buckets = new Array(7).fill(0) as number[]

  for (const a of filteredActions.value) {
    const d = parseTs(a.timestamp)
    if (!d) continue
    const diffDays = Math.floor((now.getTime() - d.getTime()) / (24 * 60 * 60 * 1000))
    const idx = 6 - diffDays
    if (idx >= 0 && idx < 7) buckets[idx] = (buckets[idx] ?? 0) + 1
  }
  return buckets
})

const actionDistribution = computed(() => {
  const counts: Record<string, number> = {}
  for (const a of filteredActions.value) {
    const t = String(a.type ?? a.actionType ?? a.event ?? 'unknown')
    counts[t] = (counts[t] ?? 0) + 1
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
})

async function refreshActions() {
  loading.value = true
  error.value = null
  try {
    const res = await $fetch(resolveApiUrl('/users/actions'), { method: 'GET' })
    actions.value = asArray(res)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load user actions.'
  } finally {
    loading.value = false
  }
}

async function recordInteraction() {
  loading.value = true
  error.value = null
  try {
    await $fetch(resolveApiUrl('/users/actions'), {
      method: 'POST',
      body: {
        type: recordForm.type,
        caseId: recordForm.caseId || undefined,
        slideId: recordForm.slideId || undefined,
        durationSeconds: recordForm.durationSeconds,
        confidenceDelta: recordForm.confidenceDelta,
        note: recordForm.note || undefined,
        timestamp: Date.now()
      }
    })
    // Keep UX snappy: refresh list after recording.
    await refreshActions()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to record interaction.'
  } finally {
    loading.value = false
  }
}

function getSelectedCaseId() {
  if (!selectedAction.value) return undefined
  return selectedAction.value.caseId ?? selectedAction.value.case_id
}

function getSelectedSlideId() {
  if (!selectedAction.value) return undefined
  return selectedAction.value.slideId ?? selectedAction.value.slide_id
}

async function sendUxInsight() {
  if (!selectedAction.value) return
  uxSending.value = true
  uxError.value = null
  try {
    const caseId = getSelectedCaseId()
    const slideId = getSelectedSlideId()

    const note = [
      `UX Insight: ${uxInsightForm.category}`,
      `Severity: ${uxInsightForm.severity}/5`,
      uxInsightForm.note ? `Note: ${uxInsightForm.note}` : undefined
    ]
      .filter(Boolean)
      .join('\n')

    await $fetch(resolveApiUrl('/users/actions'), {
      method: 'POST',
      body: {
        type: 'ux_insight',
        caseId: caseId || undefined,
        slideId: slideId || undefined,
        durationSeconds: 1,
        note,
        timestamp: Date.now()
      }
    })

    uxInsightForm.note = ''
    uxSending.value = false
    await refreshActions()
  } catch (e) {
    uxError.value = e instanceof Error ? e.message : 'Failed to send UX insight.'
    uxSending.value = false
  }
}

onMounted(() => {
  apiBase.value = restoreApiBase()
  watch(apiBase, v => persistApiBase(v), { flush: 'post' })
  refreshActions()
})
</script>

<template>
  <div>
    <UPageHero
      title="User Behavioral Monitoring"
      description="Track how histopathologists interact with AI-assisted annotation workflows. Designed for quick insight during annotation sessions."
    />

    <UPageSection>
      <div class="grid gap-4 lg:grid-cols-3">
        <section class="lg:col-span-1">
          <div class="rounded-xl border border-ui-border/60 bg-ui-bg p-4">
            <div class="flex items-start justify-between gap-3">
              <div>
                <h2 class="text-base font-semibold">
                  UX Analytics Controls
                </h2>
                <p class="mt-1 text-sm text-ui-muted">
                  Filter and review behavioral signals to improve the expert experience.
                </p>
              </div>
              <div class="min-w-[240px]">
                <label class="block text-xs font-medium text-ui-muted">API Base (optional)</label>
                <input
                  v-model="apiBase"
                  class="mt-1 w-full rounded-lg border border-ui-border/60 bg-ui-bg px-3 py-2 text-sm outline-none transition-shadow focus:shadow-[0_0_0_4px_rgba(0,220,130,0.15)]"
                  placeholder="e.g. https://your-backend.com"
                >
              </div>
            </div>

            <div class="mt-4 grid gap-3">
              <label class="block text-xs">
                <span class="text-ui-muted">Time range</span>
                <select
                  v-model="timeRange"
                  class="mt-1 w-full rounded-lg border border-ui-border/60 bg-ui-bg px-3 py-2 text-sm outline-none"
                >
                  <option value="24h">Last 24h</option>
                  <option value="7d">Last 7d</option>
                  <option value="30d">Last 30d</option>
                  <option value="all">All</option>
                </select>
              </label>

              <label class="block text-xs">
                <span class="text-ui-muted">Action type</span>
                <select
                  v-model="actionFilter"
                  class="mt-1 w-full rounded-lg border border-ui-border/60 bg-ui-bg px-3 py-2 text-sm outline-none"
                >
                  <option value="all">All</option>
                  <option
                    v-for="t in actionTypes"
                    :key="t.value"
                    :value="t.value"
                  >
                    {{ t.label }}
                  </option>
                </select>
              </label>

              <label class="block text-xs">
                <span class="text-ui-muted">Search</span>
                <input
                  v-model="searchQuery"
                  class="mt-1 w-full rounded-lg border border-ui-border/60 bg-ui-bg px-3 py-2 text-sm outline-none"
                  placeholder="Case, slide, or note..."
                >
              </label>

              <details class="mt-2 rounded-lg border border-ui-border/60 p-3">
                <summary class="cursor-pointer text-sm font-semibold text-ui-primary">
                  Recorder (optional)
                </summary>

                <div class="mt-3 grid gap-3">
                  <label class="block text-xs">
                    <span class="text-ui-muted">Action type</span>
                    <select
                      v-model="recordForm.type"
                      class="mt-1 w-full rounded-lg border border-ui-border/60 bg-ui-bg px-3 py-2 text-sm outline-none"
                    >
                      <option
                        v-for="t in actionTypes"
                        :key="t.value"
                        :value="t.value"
                      >
                        {{ t.label }}
                      </option>
                    </select>
                  </label>

                  <div class="grid gap-2 md:grid-cols-2">
                    <label class="block text-xs">
                      <span class="text-ui-muted">Case ID</span>
                      <input
                        v-model="recordForm.caseId"
                        class="mt-1 w-full rounded-lg border border-ui-border/60 bg-ui-bg px-3 py-2 text-sm outline-none"
                        placeholder="CASE-1024"
                      >
                    </label>
                    <label class="block text-xs">
                      <span class="text-ui-muted">Slide ID</span>
                      <input
                        v-model="recordForm.slideId"
                        class="mt-1 w-full rounded-lg border border-ui-border/60 bg-ui-bg px-3 py-2 text-sm outline-none"
                        placeholder="SLIDE-77A"
                      >
                    </label>
                  </div>

                  <label class="block text-xs">
                    <span class="text-ui-muted">Time spent (seconds)</span>
                    <input
                      v-model.number="recordForm.durationSeconds"
                      type="number"
                      min="1"
                      class="mt-1 w-full rounded-lg border border-ui-border/60 bg-ui-bg px-3 py-2 text-sm outline-none"
                    >
                  </label>

                  <label class="block text-xs">
                    <span class="text-ui-muted">Confidence delta (optional)</span>
                    <input
                      v-model.number="recordForm.confidenceDelta"
                      type="number"
                      step="0.01"
                      class="mt-1 w-full rounded-lg border border-ui-border/60 bg-ui-bg px-3 py-2 text-sm outline-none"
                      placeholder="-0.12 / +0.08"
                    >
                  </label>

                  <label class="block text-xs">
                    <span class="text-ui-muted">Notes (optional)</span>
                    <textarea
                      v-model="recordForm.note"
                      rows="3"
                      class="mt-1 w-full resize-none rounded-lg border border-ui-border/60 bg-ui-bg px-3 py-2 text-sm outline-none"
                      placeholder="e.g. 'uncertain ROI border, corrected after zoom' "
                    />
                  </label>

                  <UButton
                    :disabled="loading"
                    color="primary"
                    variant="solid"
                    block
                    @click="recordInteraction"
                  >
                    <span
                      v-if="loading"
                      class="inline-flex items-center gap-2"
                    >
                      <span class="h-4 w-4 animate-spin rounded-full border-2 border-ui-bg border-t-ui-primary" />
                      Sending...
                    </span>
                    <span v-else>Record interaction</span>
                  </UButton>

                  <p
                    v-if="error"
                    class="text-xs text-red-500"
                  >
                    {{ error }}
                  </p>

                  <p class="text-[11px] text-ui-muted">
                    Endpoint: <span class="font-mono">POST /users/actions</span>
                  </p>
                </div>
              </details>
            </div>
          </div>
        </section>

        <section class="lg:col-span-2">
          <div class="rounded-xl border border-ui-border/60 bg-ui-bg p-4">
            <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 class="text-base font-semibold">
                  Behavioral Statistics
                </h2>
                <p class="mt-1 text-sm text-ui-muted">
                  Metrics are derived from <span class="font-mono">GET /users/actions</span> and shaped by UX expert filters.
                </p>
              </div>
            </div>

            <div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div class="rounded-xl border border-ui-border/60 bg-ui-bg p-3 anim-fade-up">
                <p class="text-xs text-ui-muted">
                  Events
                </p>
                <p class="mt-1 text-2xl font-bold">
                  {{ metrics.total }}
                </p>
              </div>
              <div class="rounded-xl border border-ui-border/60 bg-ui-bg p-3 anim-fade-up">
                <p class="text-xs text-ui-muted">
                  Unique cases
                </p>
                <p class="mt-1 text-2xl font-bold">
                  {{ metrics.uniqueCases }}
                </p>
              </div>
              <div class="rounded-xl border border-ui-border/60 bg-ui-bg p-3 anim-fade-up">
                <p class="text-xs text-ui-muted">
                  Correction rate
                </p>
                <p class="mt-1 text-2xl font-bold">
                  {{ Math.round(metrics.correctionRate * 100) }}%
                </p>
              </div>
              <div class="rounded-xl border border-ui-border/60 bg-ui-bg p-3 anim-fade-up">
                <p class="text-xs text-ui-muted">
                  Avg time spent
                </p>
                <p class="mt-1 text-2xl font-bold">
                  {{ Math.round(metrics.avgDurationSeconds) }}s
                </p>
              </div>
            </div>

            <div class="mt-4 grid gap-4 md:grid-cols-2">
              <div class="rounded-xl border border-ui-border/60 bg-ui-bg p-3">
                <div class="flex items-center justify-between">
                  <p class="text-sm font-semibold">
                    Last 7 days rhythm
                  </p>
                  <span class="text-xs text-ui-muted">Animated bars</span>
                </div>
                <div class="mt-3 flex h-40 items-end gap-2">
                  <div
                    v-for="(n, i) in dayBuckets"
                    :key="i"
                    class="flex-1 overflow-hidden rounded-lg bg-ui-primary/10"
                  >
                    <div
                      class="w-full origin-bottom bg-gradient-to-t from-ui-primary/70 to-green-400/70 anim-fade-up"
                      :style="{
                        height: `${Math.min(100, (n / (Math.max(...dayBuckets) || 1)) * 100)}%`,
                        animationDelay: `${i * 60}ms`
                      }"
                    />
                  </div>
                </div>
                <p class="mt-2 text-[11px] text-ui-muted">
                  Note: based on the `timestamp` field returned by your backend.
                </p>
              </div>

              <div class="rounded-xl border border-ui-border/60 bg-ui-bg p-3">
                <p class="text-sm font-semibold">
                  Action mix
                </p>
                <p class="mt-1 text-xs text-ui-muted">
                  Top event types in the selected range.
                </p>

                <div class="mt-3 space-y-2">
                  <div
                    v-for="(entry, idx) in actionDistribution"
                    :key="entry[0]"
                    class="rounded-lg border border-ui-border/60 p-2 anim-fade-up"
                    :style="{ animationDelay: `${idx * 60}ms` }"
                  >
                    <div class="flex items-center justify-between gap-3">
                      <p class="text-xs font-semibold">
                        {{ entry[0] }}
                      </p>
                      <p class="text-xs text-ui-muted">
                        {{ entry[1] }}
                      </p>
                    </div>
                    <div class="mt-2 h-2 w-full overflow-hidden rounded bg-ui-primary/10">
                      <div
                        class="h-full rounded bg-gradient-to-r from-ui-primary/70 to-green-400/70 transition-[width] duration-700 ease-out"
                        :style="{ width: `${metrics.total ? (entry[1] / metrics.total) * 100 : 0}%` }"
                      />
                    </div>
                  </div>

                  <div
                    v-if="actionDistribution.length === 0"
                    class="text-sm text-ui-muted"
                  >
                    No actions found for this time range.
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="mt-4 rounded-xl border border-ui-border/60 bg-ui-bg p-4">
            <div class="flex items-start justify-between gap-3">
              <div>
                <h2 class="text-base font-semibold">
                  UX Review Queue
                </h2>
                <p class="mt-1 text-sm text-ui-muted">
                  Select an event and add UX insights to understand friction points in AI-assisted annotation.
                </p>
              </div>
              <UButton
                size="xs"
                variant="ghost"
                :disabled="loading"
                @click="refreshActions"
              >
                {{ loading ? 'Refreshing...' : 'Refresh' }}
              </UButton>
            </div>

            <div class="mt-3 grid gap-3 md:grid-cols-2">
              <div class="max-h-[420px] overflow-auto pr-1">
                <div
                  v-if="loading"
                  class="space-y-2"
                >
                  <div class="rounded-lg border border-ui-border/60 p-3 animate-pulse">
                    <div class="h-3 w-1/2 rounded bg-ui-primary/15" />
                    <div class="mt-2 h-3 w-2/3 rounded bg-ui-primary/15" />
                  </div>
                  <div class="rounded-lg border border-ui-border/60 p-3 animate-pulse">
                    <div class="h-3 w-1/3 rounded bg-ui-primary/15" />
                    <div class="mt-2 h-3 w-1/2 rounded bg-ui-primary/15" />
                  </div>
                </div>

                <div
                  v-else-if="filteredActions.length === 0"
                  class="text-sm text-ui-muted"
                >
                  No interaction events to display.
                </div>

                <button
                  v-for="(a, idx) in filteredActions.slice().reverse()"
                  v-else
                  :key="String(a.id ?? idx)"
                  class="mb-2 w-full rounded-xl border border-ui-border/60 bg-ui-bg p-3 text-left transition-shadow hover:shadow-[0_10px_30px_rgba(0,0,0,0.06)] anim-fade-up"
                  :style="{ animationDelay: `${idx * 35}ms` }"
                  :class="selectedActionIndex === idx ? 'ring-2 ring-ui-primary/50' : ''"
                  @click="selectedAction = a; selectedActionIndex = idx"
                >
                  <div class="flex items-center justify-between gap-3">
                    <p class="text-sm font-semibold">
                      {{ a.type ?? a.actionType ?? a.event ?? 'unknown' }}
                    </p>
                    <p class="text-xs text-ui-muted">
                      {{
                        parseTs(a.timestamp)
                          ? parseTs(a.timestamp)?.toLocaleString()
                          : '—'
                      }}
                    </p>
                  </div>
                  <div class="mt-2 grid gap-2 sm:grid-cols-2">
                    <div>
                      <p class="text-[11px] text-ui-muted">
                        Case / Slide
                      </p>
                      <p class="text-sm">
                        {{ a.caseId ?? a.case_id ?? '—' }} / {{ a.slideId ?? a.slide_id ?? '—' }}
                      </p>
                    </div>
                    <div>
                      <p class="text-[11px] text-ui-muted">
                        Duration
                      </p>
                      <p class="text-sm">
                        {{ a.durationSeconds ?? a.duration_seconds ?? '—' }}s
                      </p>
                    </div>
                  </div>
                  <p
                    v-if="a.note"
                    class="mt-2 whitespace-pre-wrap text-sm text-ui-muted"
                  >
                    {{ a.note }}
                  </p>
                </button>
              </div>

              <div class="rounded-xl border border-ui-border/60 bg-ui-bg p-3">
                <div class="flex items-center justify-between gap-3">
                  <h3 class="text-sm font-semibold">
                    Event Details
                  </h3>
                  <button
                    type="button"
                    class="text-xs text-ui-muted underline underline-offset-4 hover:text-ui-primary"
                    :disabled="!selectedAction"
                    @click="selectedAction = null; selectedActionIndex = -1"
                  >
                    Clear
                  </button>
                </div>

                <div
                  v-if="!selectedAction"
                  class="mt-3 text-sm text-ui-muted"
                >
                  Select an event from the queue to add UX insights.
                </div>

                <div
                  v-else
                  class="mt-3"
                >
                  <p class="text-xs text-ui-muted">
                    Type
                  </p>
                  <p class="text-sm font-semibold">
                    {{ selectedAction.type ?? selectedAction.actionType ?? selectedAction.event ?? 'unknown' }}
                  </p>

                  <div class="mt-3 grid gap-2 sm:grid-cols-2">
                    <div>
                      <p class="text-[11px] text-ui-muted">
                        Case / Slide
                      </p>
                      <p class="text-sm">
                        {{ selectedAction.caseId ?? selectedAction.case_id ?? '—' }} / {{ selectedAction.slideId ?? selectedAction.slide_id ?? '—' }}
                      </p>
                    </div>
                    <div>
                      <p class="text-[11px] text-ui-muted">
                        Duration
                      </p>
                      <p class="text-sm">
                        {{ selectedAction.durationSeconds ?? selectedAction.duration_seconds ?? '—' }}s
                      </p>
                    </div>
                  </div>

                  <div class="mt-4 rounded-lg border border-ui-border/60 bg-ui-bg p-3 anim-fade-up">
                    <p class="text-xs font-semibold text-ui-muted">
                      Add UX Insight
                    </p>
                    <div class="mt-3 grid gap-3">
                      <label class="block text-xs">
                        <span class="text-ui-muted">Category</span>
                        <select
                          v-model="uxInsightForm.category"
                          class="mt-1 w-full rounded-lg border border-ui-border/60 bg-ui-bg px-3 py-2 text-sm outline-none"
                        >
                          <option
                            v-for="c in uxCategories"
                            :key="c.value"
                            :value="c.value"
                          >
                            {{ c.label }}
                          </option>
                        </select>
                      </label>

                      <label class="block text-xs">
                        <span class="text-ui-muted">Severity: {{ uxInsightForm.severity }}/5</span>
                        <input
                          v-model.number="uxInsightForm.severity"
                          type="range"
                          min="1"
                          max="5"
                          step="1"
                          class="mt-2 w-full"
                        >
                      </label>

                      <label class="block text-xs">
                        <span class="text-ui-muted">UX note</span>
                        <textarea
                          v-model="uxInsightForm.note"
                          rows="3"
                          class="mt-1 w-full resize-none rounded-lg border border-ui-border/60 bg-ui-bg px-3 py-2 text-sm outline-none"
                          placeholder="Short description of the friction point or improvement."
                        />
                      </label>

                      <UButton
                        :disabled="uxSending"
                        color="primary"
                        variant="solid"
                        block
                        @click="sendUxInsight"
                      >
                        <span
                          v-if="uxSending"
                          class="inline-flex items-center gap-2"
                        >
                          <span class="h-4 w-4 animate-spin rounded-full border-2 border-ui-bg border-t-ui-primary" />
                          Sending...
                        </span>
                        <span v-else>Send UX insight</span>
                      </UButton>

                      <p
                        v-if="uxError"
                        class="text-xs text-red-500"
                      >
                        {{ uxError }}
                      </p>

                      <p class="text-[11px] text-ui-muted">
                        Endpoint: <span class="font-mono">POST /users/actions</span> with <span class="font-mono">type=ux_insight</span>.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div class="mt-6 rounded-xl border border-ui-border/60 bg-ui-bg p-4">
        <div class="flex items-center justify-between gap-3">
          <h3 class="text-sm font-semibold">
            API Endpoints
          </h3>
        </div>
        <div class="mt-2 text-sm text-ui-muted">
          <div><span class="font-mono">GET /users/actions</span> loads events and powers metrics.</div>
          <div class="mt-1">
            <span class="font-mono">POST /users/actions</span> records new interaction events.
          </div>
        </div>
      </div>
    </UPageSection>
  </div>
</template>
