<script setup lang="ts">
definePageMeta({
  ssr: false,
  title: 'User Behavioral Dashboard'
})

type AnyRecord = Record<string, unknown>

const runtimeConfig = useRuntimeConfig()
const apiBase = ref<string>('')

function persistApiBase(value: string) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem('hdt_apiBase', value)
}

function restoreApiBase() {
  if (typeof window === 'undefined') return runtimeConfig.public.apiBase as string
  return window.localStorage.getItem('hdt_apiBase') ?? runtimeConfig.public.apiBase as string
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
const showRecorder = ref(false)

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

const dayLabels = computed(() => {
  const labels: string[] = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    labels.push(d.toLocaleDateString(undefined, { weekday: 'short' }))
  }
  return labels
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
    <section class="hero-gradient px-6 pb-12 pt-16">
      <div class="mx-auto max-w-6xl anim-fade-up">
        <div class="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p class="text-xs font-medium uppercase tracking-widest text-ui-primary">
              UX Expert Console
            </p>
            <h1 class="mt-1 text-3xl font-bold tracking-tight">
              Behavioral Analytics
            </h1>
            <p class="mt-2 max-w-xl text-sm text-ui-muted">
              Analyse gathered user behavioural data and manage insights from the point of view of a UX expert.
            </p>
          </div>
          <div class="flex items-center gap-3">
            <label class="text-xs text-ui-muted">API&nbsp;Base</label>
            <input
              v-model="apiBase"
              class="input-modern w-64"
              placeholder="https://your-backend.com"
            >
          </div>
        </div>
      </div>
    </section>

    <section class="mx-auto max-w-6xl px-6 py-8">
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div
          v-for="(s, i) in [
            { label: 'Total events', value: metrics.total },
            { label: 'Unique cases', value: metrics.uniqueCases },
            { label: 'Correction rate', value: `${Math.round(metrics.correctionRate * 100)}%` },
            { label: 'Avg time spent', value: `${Math.round(metrics.avgDurationSeconds)}s` }
          ]"
          :key="s.label"
          class="stat-card anim-fade-up"
          :style="{ animationDelay: `${i * 60}ms` }"
        >
          <p class="text-[11px] font-medium uppercase tracking-wider text-ui-muted">
            {{ s.label }}
          </p>
          <p class="mt-1 text-2xl font-bold">
            {{ s.value }}
          </p>
        </div>
      </div>

      <div class="mt-6 grid gap-6 lg:grid-cols-5">
        <div class="lg:col-span-2 space-y-4">
          <div class="glass-card p-5 anim-fade-up">
            <h2 class="text-xs font-medium uppercase tracking-widest text-ui-muted">
              Filters
            </h2>
            <div class="mt-3 grid gap-3">
              <label class="block text-xs">
                <span class="text-ui-muted">Time range</span>
                <select
                  v-model="timeRange"
                  class="input-modern mt-1"
                >
                  <option value="24h">
                    Last 24 h
                  </option>
                  <option value="7d">
                    Last 7 days
                  </option>
                  <option value="30d">
                    Last 30 days
                  </option>
                  <option value="all">
                    All time
                  </option>
                </select>
              </label>
              <label class="block text-xs">
                <span class="text-ui-muted">Action type</span>
                <select
                  v-model="actionFilter"
                  class="input-modern mt-1"
                >
                  <option value="all">
                    All
                  </option>
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
                  class="input-modern mt-1"
                  placeholder="Case, slide, or note…"
                >
              </label>
              <UButton
                variant="subtle"
                color="primary"
                block
                :disabled="loading"
                @click="refreshActions"
              >
                {{ loading ? 'Loading…' : 'Refresh data' }}
              </UButton>
            </div>
          </div>

          <div
            class="glass-card p-5 anim-fade-up"
            :style="{ animationDelay: '80ms' }"
          >
            <div class="flex items-center justify-between">
              <h2 class="text-xs font-medium uppercase tracking-widest text-ui-muted">
                7-Day Rhythm
              </h2>
              <span class="text-[11px] text-ui-muted">Events per day</span>
            </div>
            <div class="mt-3 flex h-32 items-end gap-1.5">
              <div
                v-for="(n, i) in dayBuckets"
                :key="i"
                class="flex flex-1 flex-col items-center gap-1"
              >
                <span class="text-[10px] font-medium text-ui-muted">{{ n || '' }}</span>
                <div
                  class="bar-track w-full"
                  style="height: 96px"
                >
                  <div
                    class="bar-fill w-full anim-fade-up"
                    :style="{
                      height: `${Math.min(100, (n / (Math.max(...dayBuckets) || 1)) * 100)}%`,
                      animationDelay: `${i * 60}ms`,
                      marginTop: 'auto'
                    }"
                  />
                </div>
                <span class="text-[10px] text-ui-muted">{{ dayLabels[i] }}</span>
              </div>
            </div>
          </div>

          <div
            class="glass-card p-5 anim-fade-up"
            :style="{ animationDelay: '160ms' }"
          >
            <h2 class="text-xs font-medium uppercase tracking-widest text-ui-muted">
              Action Distribution
            </h2>
            <div class="mt-3 space-y-2.5">
              <div
                v-for="(entry, idx) in actionDistribution"
                :key="entry[0]"
                class="anim-fade-up"
                :style="{ animationDelay: `${idx * 40}ms` }"
              >
                <div class="flex items-center justify-between gap-2">
                  <span class="truncate text-xs font-medium">{{ entry[0] }}</span>
                  <span class="shrink-0 text-xs text-ui-muted">{{ entry[1] }}</span>
                </div>
                <div class="mt-1 h-1.5 overflow-hidden rounded-full bg-ui-primary/10">
                  <div
                    class="h-full rounded-full bg-gradient-to-r from-ui-primary to-blue-400 transition-[width] duration-700 ease-out"
                    :style="{ width: `${metrics.total ? (entry[1] / metrics.total) * 100 : 0}%` }"
                  />
                </div>
              </div>
              <p
                v-if="actionDistribution.length === 0"
                class="text-xs text-ui-muted"
              >
                No data for this range.
              </p>
            </div>
          </div>

          <button
            class="w-full rounded-xl border border-dashed border-ui-border/40 px-4 py-3 text-left text-xs font-medium text-ui-muted transition-colors hover:border-ui-primary/30 hover:text-ui-primary"
            @click="showRecorder = !showRecorder"
          >
            {{ showRecorder ? 'Hide recorder' : 'Record interaction manually…' }}
          </button>

          <div
            v-if="showRecorder"
            class="glass-card p-5 anim-slide-down"
          >
            <h2 class="text-xs font-medium uppercase tracking-widest text-ui-muted">
              Manual Recorder
            </h2>
            <div class="mt-3 grid gap-3">
              <label class="block text-xs">
                <span class="text-ui-muted">Action type</span>
                <select
                  v-model="recordForm.type"
                  class="input-modern mt-1"
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
              <div class="grid gap-2 sm:grid-cols-2">
                <label class="block text-xs">
                  <span class="text-ui-muted">Case ID</span>
                  <input
                    v-model="recordForm.caseId"
                    class="input-modern mt-1"
                    placeholder="CASE-1024"
                  >
                </label>
                <label class="block text-xs">
                  <span class="text-ui-muted">Slide ID</span>
                  <input
                    v-model="recordForm.slideId"
                    class="input-modern mt-1"
                    placeholder="SLIDE-77A"
                  >
                </label>
              </div>
              <div class="grid gap-2 sm:grid-cols-2">
                <label class="block text-xs">
                  <span class="text-ui-muted">Duration (s)</span>
                  <input
                    v-model.number="recordForm.durationSeconds"
                    type="number"
                    min="1"
                    class="input-modern mt-1"
                  >
                </label>
                <label class="block text-xs">
                  <span class="text-ui-muted">Confidence Δ</span>
                  <input
                    v-model.number="recordForm.confidenceDelta"
                    type="number"
                    step="0.01"
                    class="input-modern mt-1"
                    placeholder="-0.12"
                  >
                </label>
              </div>
              <label class="block text-xs">
                <span class="text-ui-muted">Notes</span>
                <textarea
                  v-model="recordForm.note"
                  rows="2"
                  class="input-modern mt-1 resize-none"
                  placeholder="e.g. uncertain ROI border, corrected after zoom"
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
                  <span class="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Sending…
                </span>
                <span v-else>Record interaction</span>
              </UButton>
              <p
                v-if="error"
                class="text-xs text-red-500"
              >
                {{ error }}
              </p>
            </div>
          </div>
        </div>

        <div class="lg:col-span-3">
          <div class="glass-card p-5">
            <div class="flex items-center justify-between">
              <div>
                <h2 class="text-sm font-semibold">
                  UX Review Queue
                </h2>
                <p class="mt-0.5 text-xs text-ui-muted">
                  Select an event to inspect details and add UX insights.
                </p>
              </div>
              <span class="rounded-full bg-ui-primary/10 px-2.5 py-1 text-[11px] font-medium text-ui-primary">
                {{ filteredActions.length }} event{{ filteredActions.length === 1 ? '' : 's' }}
              </span>
            </div>

            <div class="mt-4 grid gap-4 xl:grid-cols-2">
              <div class="max-h-[560px] space-y-1.5 overflow-auto pr-1">
                <div
                  v-if="loading"
                  class="space-y-2"
                >
                  <div
                    v-for="n in 4"
                    :key="n"
                    class="rounded-xl border border-ui-border/30 p-3 animate-pulse"
                  >
                    <div class="h-3 w-2/3 rounded bg-ui-primary/10" />
                    <div class="mt-2 h-3 w-1/2 rounded bg-ui-primary/10" />
                  </div>
                </div>

                <div
                  v-else-if="filteredActions.length === 0"
                  class="flex flex-col items-center py-12 text-center"
                >
                  <div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-ui-primary/10">
                    <UIcon
                      name="i-lucide-inbox"
                      class="h-7 w-7 text-ui-muted"
                    />
                  </div>
                  <p class="mt-4 text-sm font-medium">
                    No events found
                  </p>
                  <p class="mt-1 max-w-xs text-xs text-ui-muted">
                    Adjust filters or press Refresh to fetch events.
                  </p>
                </div>

                <button
                  v-for="(a, idx) in filteredActions.slice().reverse()"
                  v-else
                  :key="String(a.id ?? idx)"
                  class="w-full rounded-xl border p-3 text-left transition-all anim-fade-up"
                  :class="selectedActionIndex === idx
                    ? 'border-ui-primary/40 bg-ui-primary/5 shadow-sm'
                    : 'border-ui-border/30 hover:border-ui-primary/20 hover:bg-ui-primary/[2%]'"
                  :style="{ animationDelay: `${Math.min(idx, 10) * 30}ms` }"
                  @click="selectedAction = a; selectedActionIndex = idx"
                >
                  <div class="flex items-center justify-between gap-2">
                    <div class="flex items-center gap-2">
                      <span class="rounded-full bg-ui-primary/10 px-2 py-0.5 text-[11px] font-medium text-ui-primary">
                        {{ a.type ?? a.actionType ?? a.event ?? 'unknown' }}
                      </span>
                    </div>
                    <span class="text-[11px] text-ui-muted">
                      {{ parseTs(a.timestamp) ? parseTs(a.timestamp)?.toLocaleString() : '—' }}
                    </span>
                  </div>
                  <div class="mt-2 flex items-center gap-4 text-xs text-ui-muted">
                    <span>{{ a.caseId ?? a.case_id ?? '—' }} / {{ a.slideId ?? a.slide_id ?? '—' }}</span>
                    <span>{{ a.durationSeconds ?? a.duration_seconds ?? '—' }}s</span>
                  </div>
                </button>
              </div>

              <div class="rounded-xl border border-ui-border/30 p-4">
                <div
                  v-if="!selectedAction"
                  class="flex flex-col items-center py-16 text-center"
                >
                  <div class="flex h-12 w-12 items-center justify-center rounded-2xl bg-ui-primary/10">
                    <UIcon
                      name="i-lucide-mouse-pointer-click"
                      class="h-5 w-5 text-ui-muted"
                    />
                  </div>
                  <p class="mt-3 text-sm text-ui-muted">
                    Select an event to inspect
                  </p>
                </div>

                <div
                  v-else
                  class="anim-fade-up"
                >
                  <div class="flex items-center justify-between">
                    <h3 class="text-sm font-semibold">
                      Event Details
                    </h3>
                    <button
                      class="text-xs text-ui-muted hover:text-ui-primary"
                      @click="selectedAction = null; selectedActionIndex = -1"
                    >
                      Clear
                    </button>
                  </div>

                  <div class="mt-3 grid gap-2 sm:grid-cols-2">
                    <div class="rounded-lg bg-ui-bg/60 p-2.5">
                      <p class="text-[10px] font-medium uppercase tracking-wider text-ui-muted">
                        Type
                      </p>
                      <p class="mt-0.5 text-sm font-semibold">
                        {{ selectedAction.type ?? selectedAction.actionType ?? selectedAction.event ?? 'unknown' }}
                      </p>
                    </div>
                    <div class="rounded-lg bg-ui-bg/60 p-2.5">
                      <p class="text-[10px] font-medium uppercase tracking-wider text-ui-muted">
                        Duration
                      </p>
                      <p class="mt-0.5 text-sm font-semibold">
                        {{ selectedAction.durationSeconds ?? selectedAction.duration_seconds ?? '—' }}s
                      </p>
                    </div>
                    <div class="rounded-lg bg-ui-bg/60 p-2.5 sm:col-span-2">
                      <p class="text-[10px] font-medium uppercase tracking-wider text-ui-muted">
                        Case / Slide
                      </p>
                      <p class="mt-0.5 text-sm font-semibold">
                        {{ selectedAction.caseId ?? selectedAction.case_id ?? '—' }} / {{ selectedAction.slideId ?? selectedAction.slide_id ?? '—' }}
                      </p>
                    </div>
                  </div>

                  <div class="mt-4 rounded-xl border border-ui-border/30 p-3">
                    <p class="text-[11px] font-medium uppercase tracking-wider text-ui-muted">
                      Add UX Insight
                    </p>
                    <div class="mt-2.5 grid gap-2.5">
                      <label class="block text-xs">
                        <span class="text-ui-muted">Category</span>
                        <select
                          v-model="uxInsightForm.category"
                          class="input-modern mt-1"
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
                          class="mt-1 w-full accent-[var(--ui-primary)]"
                        >
                      </label>
                      <label class="block text-xs">
                        <span class="text-ui-muted">Note</span>
                        <textarea
                          v-model="uxInsightForm.note"
                          rows="2"
                          class="input-modern mt-1 resize-none"
                          placeholder="Describe the friction point or improvement."
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
                          <span class="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                          Sending…
                        </span>
                        <span v-else>Submit insight</span>
                      </UButton>
                      <p
                        v-if="uxError"
                        class="text-xs text-red-500"
                      >
                        {{ uxError }}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
