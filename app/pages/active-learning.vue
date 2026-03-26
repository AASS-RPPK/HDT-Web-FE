<script setup lang="ts">
definePageMeta({
  ssr: false,
  title: 'Active Learning Dashboard'
})

type StepKey = 'upload' | 'retrieve' | 'tune' | 'deploy'
type StepStatus = 'idle' | 'loading' | 'success' | 'error'

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

type AnyRecord = Record<string, unknown>
type QueueItem = AnyRecord & {
  id?: string | number
  caseId?: string | number
  slideId?: string | number
  confidence?: number
}

const queue = ref<QueueItem[]>([])
const queueLoading = ref(false)
const queueError = ref<string | null>(null)
const selectedItem = ref<QueueItem | null>(null)

const lastResponse = ref<unknown>(null)

const stepStatus = ref<Record<StepKey, StepStatus>>({
  upload: 'idle',
  retrieve: 'idle',
  tune: 'idle',
  deploy: 'idle'
})

const activity = ref<Array<{ id: string, ts: number, level: 'info' | 'success' | 'error', message: string }>>(
  []
)

const openStep = ref<StepKey | null>(null)
const rightTab = ref<'candidates' | 'activity'>('candidates')

function toggleStep(key: StepKey) {
  openStep.value = openStep.value === key ? null : key
}

function addActivity(level: 'info' | 'success' | 'error', message: string) {
  activity.value.unshift({
    id: crypto.randomUUID(),
    ts: Date.now(),
    level,
    message
  })
}

function asArray(maybeItems: unknown): QueueItem[] {
  if (Array.isArray(maybeItems)) return maybeItems as QueueItem[]
  const obj = maybeItems as AnyRecord | null
  if (!obj) return []
  if (Array.isArray(obj.items)) return obj.items as QueueItem[]
  if (Array.isArray(obj.queue)) return obj.queue as QueueItem[]
  if (Array.isArray(obj.results)) return obj.results as QueueItem[]
  return []
}

function clamp01(v: unknown) {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1, n))
}

const uploadForm = reactive<{
  caseId: string
  slideId: string
  inputText: string
  revisedAnnotation: string
  imageFile: File | null
}>({
  caseId: '',
  slideId: '',
  inputText: '',
  revisedAnnotation: '',
  imageFile: null
})

function applySelectionToForm(item: QueueItem) {
  selectedItem.value = item
  uploadForm.caseId = String(item.caseId ?? item.case_id ?? item.id ?? '')
  uploadForm.slideId = String(item.slideId ?? item.slide_id ?? '')
  uploadForm.inputText = String(item.text ?? item.inputText ?? item.prompt ?? '')
  uploadForm.revisedAnnotation = String(item.revisedAnnotation ?? item.annotation ?? item.current ?? '')
  openStep.value = 'upload'
}

const tuningConfig = reactive({
  mode: 'active-learning',
  epochs: 3,
  learningRate: 0.0001,
  batchSize: 8
})

const autoDeployAfterTrain = ref<boolean>(false)

const deployConfig = reactive({
  action: 'deploy' as 'deploy' | 'rollback',
  modelVersion: ''
})

const datasetStats = computed(() => {
  const items = queue.value
  const total = items.length

  const uniqueCases = new Set(
    items.map(i => String(i.caseId ?? i.case_id ?? i.id ?? 'unknown'))
  ).size
  const uniqueSlides = new Set(
    items.map(i => String(i.slideId ?? i.slide_id ?? 'unknown'))
  ).size

  const avgConfidence
    = total > 0
      ? items.reduce((acc, i) => acc + clamp01(i.confidence) * 100, 0) / total
      : 0

  const typeCounts = items.reduce<Record<string, number>>((acc, i) => {
    const t = String(i.label ?? i.annotationType ?? i.type ?? 'unknown')
    acc[t] = (acc[t] ?? 0) + 1
    return acc
  }, {})

  const topTypes = Object.entries(typeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([label, count]) => ({ label, count }))

  return { total, uniqueCases, uniqueSlides, avgConfidence, topTypes }
})

async function refreshQueue() {
  queueLoading.value = true
  queueError.value = null
  try {
    const res = await $fetch(resolveApiUrl('/feedback'), { method: 'GET' })
    lastResponse.value = res
    queue.value = asArray(res)
    addActivity('success', `Retrieved ${queue.value.length} feedback item(s).`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to retrieve feedback.'
    queueError.value = msg
    addActivity('error', msg)
  } finally {
    queueLoading.value = false
  }
}

async function onUploadFeedback() {
  stepStatus.value.upload = 'loading'
  try {
    const url = resolveApiUrl('/feedback')
    const body = new FormData()
    if (uploadForm.caseId) body.append('caseId', uploadForm.caseId)
    if (uploadForm.slideId) body.append('slideId', uploadForm.slideId)
    if (uploadForm.inputText) body.append('text', uploadForm.inputText)
    if (uploadForm.revisedAnnotation) body.append('revisedAnnotation', uploadForm.revisedAnnotation)
    if (uploadForm.imageFile) body.append('image', uploadForm.imageFile)

    const res = await $fetch(url, { method: 'POST', body })
    lastResponse.value = res
    stepStatus.value.upload = 'success'
    addActivity('success', 'Feedback uploaded. Queue refresh pending.')
    await refreshQueue()
  } catch (e) {
    stepStatus.value.upload = 'error'
    addActivity('error', e instanceof Error ? e.message : 'Upload failed.')
  }
}

async function onStartFineTuning() {
  stepStatus.value.tune = 'loading'
  try {
    const res = await $fetch(resolveApiUrl('/models/annotation/train'), {
      method: 'POST',
      body: {
        mode: tuningConfig.mode,
        epochs: tuningConfig.epochs,
        learningRate: tuningConfig.learningRate,
        batchSize: tuningConfig.batchSize
      }
    })

    lastResponse.value = res
    stepStatus.value.tune = 'success'
    addActivity('success', 'Fine-tuning started.')

    if (autoDeployAfterTrain.value) {
      deployConfig.action = 'deploy'
      addActivity('info', 'Auto-deploy enabled: deploying updated model.')
      await onDeployOrRollback()
    }

    await refreshQueue()
  } catch (e) {
    stepStatus.value.tune = 'error'
    addActivity('error', e instanceof Error ? e.message : 'Fine-tuning request failed.')
  }
}

async function onDeployOrRollback() {
  stepStatus.value.deploy = 'loading'
  try {
    const res = await $fetch(resolveApiUrl('/models/annotation/deploy'), {
      method: 'POST',
      body: {
        action: deployConfig.action,
        modelVersion: deployConfig.modelVersion || undefined
      }
    })

    lastResponse.value = res
    stepStatus.value.deploy = 'success'
    addActivity('success', deployConfig.action === 'rollback' ? 'Rollback requested.' : 'Deploy requested.')
  } catch (e) {
    stepStatus.value.deploy = 'error'
    addActivity('error', e instanceof Error ? e.message : 'Deploy/Rollback request failed.')
  }
}

function statusColor(status: StepStatus) {
  switch (status) {
    case 'loading': return 'text-ui-primary'
    case 'success': return 'text-blue-600 dark:text-blue-400'
    case 'error': return 'text-red-500'
    default: return 'text-ui-muted'
  }
}

function statusDot(status: StepStatus) {
  switch (status) {
    case 'loading': return 'bg-ui-primary animate-pulse'
    case 'success': return 'bg-blue-500 anim-glow-pulse'
    case 'error': return 'bg-red-500'
    default: return 'bg-ui-muted/40'
  }
}

const steps: Array<{ key: StepKey, num: number, title: string, endpoint: string }> = [
  { key: 'upload', num: 1, title: 'Upload Feedback', endpoint: 'POST /feedback' },
  { key: 'retrieve', num: 2, title: 'Retrieve Queue', endpoint: 'GET /feedback' },
  { key: 'tune', num: 3, title: 'Fine-Tune Model', endpoint: 'POST /models/annotation/train' },
  { key: 'deploy', num: 4, title: 'Deploy / Rollback', endpoint: 'POST /models/annotation/deploy' }
]

onMounted(() => {
  apiBase.value = restoreApiBase()
  watch(apiBase, v => persistApiBase(v), { flush: 'post' })
  refreshQueue()
})
</script>

<template>
  <div>
    <section class="hero-gradient px-6 pb-12 pt-16">
      <div class="mx-auto max-w-6xl anim-fade-up">
        <div class="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p class="text-xs font-medium uppercase tracking-widest text-ui-primary">
              AI Expert Console
            </p>
            <h1 class="mt-1 text-3xl font-bold tracking-tight">
              Active Learning
            </h1>
            <p class="mt-2 max-w-xl text-sm text-ui-muted">
              Manage fine-tuning runs and model deployment based on newly gathered expert annotations and corrections.
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
      <div class="grid gap-6 lg:grid-cols-5">
        <div class="lg:col-span-2">
          <h2 class="mb-3 text-xs font-medium uppercase tracking-widest text-ui-muted">
            Pipeline
          </h2>
          <div class="space-y-2">
            <div
              v-for="step in steps"
              :key="step.key"
              class="step-card anim-fade-up"
              :class="openStep === step.key ? 'step-active' : ''"
              :style="{ animationDelay: `${step.num * 60}ms` }"
            >
              <button
                class="flex w-full items-center gap-3 text-left"
                @click="toggleStep(step.key)"
              >
                <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ui-primary/10 text-xs font-bold text-ui-primary">
                  {{ step.num }}
                </span>
                <div class="min-w-0 flex-1">
                  <p class="text-sm font-semibold leading-tight">
                    {{ step.title }}
                  </p>
                  <p class="mt-0.5 truncate text-[11px] font-mono text-ui-muted">
                    {{ step.endpoint }}
                  </p>
                </div>
                <div class="flex items-center gap-2">
                  <span
                    class="h-2 w-2 rounded-full"
                    :class="statusDot(stepStatus[step.key])"
                  />
                  <span
                    class="text-[11px] font-medium capitalize"
                    :class="statusColor(stepStatus[step.key])"
                  >
                    {{ stepStatus[step.key] }}
                  </span>
                  <UIcon
                    name="i-lucide-chevron-down"
                    class="h-4 w-4 text-ui-muted transition-transform"
                    :class="openStep === step.key ? 'rotate-180' : ''"
                  />
                </div>
              </button>

              <div
                v-if="openStep === step.key"
                class="mt-3 border-t border-ui-border/30 pt-3 anim-slide-down"
              >
                <!-- Step 1: Upload -->
                <div
                  v-if="step.key === 'upload'"
                  class="grid gap-3"
                >
                  <div class="grid gap-2 sm:grid-cols-2">
                    <label class="block text-xs">
                      <span class="text-ui-muted">Case ID</span>
                      <input
                        v-model="uploadForm.caseId"
                        class="input-modern mt-1"
                        placeholder="e.g. CASE-1024"
                      >
                    </label>
                    <label class="block text-xs">
                      <span class="text-ui-muted">Slide ID</span>
                      <input
                        v-model="uploadForm.slideId"
                        class="input-modern mt-1"
                        placeholder="e.g. SLIDE-77A"
                      >
                    </label>
                  </div>
                  <label class="block text-xs">
                    <span class="text-ui-muted">Expert-provided text</span>
                    <textarea
                      v-model="uploadForm.inputText"
                      rows="2"
                      class="input-modern mt-1 resize-none"
                      placeholder="Tumor region description / specimen notes"
                    />
                  </label>
                  <label class="block text-xs">
                    <span class="text-ui-muted">Revised annotation</span>
                    <textarea
                      v-model="uploadForm.revisedAnnotation"
                      rows="3"
                      class="input-modern mt-1 resize-none"
                      placeholder="Corrected label, structured markup, or final guidance"
                    />
                  </label>
                  <label class="block text-xs">
                    <span class="text-ui-muted">Image / ROI (optional)</span>
                    <input
                      type="file"
                      accept="image/*"
                      class="input-modern mt-1"
                      @change="uploadForm.imageFile = ($event.target as HTMLInputElement)?.files?.[0] ?? null"
                    >
                  </label>
                  <UButton
                    :disabled="stepStatus.upload === 'loading'"
                    color="primary"
                    variant="solid"
                    block
                    @click="onUploadFeedback"
                  >
                    <span
                      v-if="stepStatus.upload === 'loading'"
                      class="inline-flex items-center gap-2"
                    >
                      <span class="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      Uploading…
                    </span>
                    <span v-else>Submit feedback</span>
                  </UButton>
                </div>

                <!-- Step 2: Retrieve -->
                <div
                  v-if="step.key === 'retrieve'"
                  class="grid gap-3"
                >
                  <p class="text-xs text-ui-muted">
                    Pull the latest expert feedback queue from the backend.
                  </p>
                  <UButton
                    :disabled="queueLoading"
                    color="primary"
                    variant="subtle"
                    block
                    @click="stepStatus.retrieve = 'loading'; refreshQueue().finally(() => (stepStatus.retrieve = queueError ? 'error' : 'success'))"
                  >
                    <span
                      v-if="queueLoading"
                      class="inline-flex items-center gap-2"
                    >
                      <span class="h-4 w-4 animate-spin rounded-full border-2 border-ui-primary/30 border-t-ui-primary" />
                      Retrieving…
                    </span>
                    <span v-else>Refresh queue</span>
                  </UButton>
                  <p
                    v-if="queueError"
                    class="text-xs text-red-500"
                  >
                    {{ queueError }}
                  </p>
                </div>

                <!-- Step 3: Fine-tune -->
                <div
                  v-if="step.key === 'tune'"
                  class="grid gap-3"
                >
                  <div class="grid gap-2 sm:grid-cols-2">
                    <label class="block text-xs sm:col-span-2">
                      <span class="text-ui-muted">Mode</span>
                      <input
                        v-model="tuningConfig.mode"
                        class="input-modern mt-1"
                        placeholder="active-learning"
                      >
                    </label>
                    <label class="block text-xs">
                      <span class="text-ui-muted">Epochs</span>
                      <input
                        v-model.number="tuningConfig.epochs"
                        type="number"
                        min="1"
                        class="input-modern mt-1"
                      >
                    </label>
                    <label class="block text-xs">
                      <span class="text-ui-muted">Batch size</span>
                      <input
                        v-model.number="tuningConfig.batchSize"
                        type="number"
                        min="1"
                        class="input-modern mt-1"
                      >
                    </label>
                    <label class="block text-xs sm:col-span-2">
                      <span class="text-ui-muted">Learning rate</span>
                      <input
                        v-model.number="tuningConfig.learningRate"
                        type="number"
                        step="0.00001"
                        class="input-modern mt-1"
                      >
                    </label>
                  </div>
                  <label class="flex items-start gap-2.5 text-xs">
                    <input
                      v-model="autoDeployAfterTrain"
                      type="checkbox"
                      class="mt-0.5 h-4 w-4 rounded border-ui-border/60 text-ui-primary focus:ring-ui-primary"
                    >
                    <span class="text-ui-muted">Auto-deploy after training completes</span>
                  </label>
                  <UButton
                    :disabled="stepStatus.tune === 'loading'"
                    color="primary"
                    variant="solid"
                    block
                    @click="onStartFineTuning"
                  >
                    <span
                      v-if="stepStatus.tune === 'loading'"
                      class="inline-flex items-center gap-2"
                    >
                      <span class="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      Starting…
                    </span>
                    <span v-else>Start fine-tuning</span>
                  </UButton>
                </div>

                <!-- Step 4: Deploy / Rollback -->
                <div
                  v-if="step.key === 'deploy'"
                  class="grid gap-3"
                >
                  <div class="grid gap-2 sm:grid-cols-2">
                    <label class="block text-xs">
                      <span class="text-ui-muted">Action</span>
                      <select
                        v-model="deployConfig.action"
                        class="input-modern mt-1"
                      >
                        <option value="deploy">
                          Deploy
                        </option>
                        <option value="rollback">
                          Rollback
                        </option>
                      </select>
                    </label>
                    <label class="block text-xs">
                      <span class="text-ui-muted">Model version (optional)</span>
                      <input
                        v-model="deployConfig.modelVersion"
                        class="input-modern mt-1"
                        placeholder="e.g. v1.2.3"
                      >
                    </label>
                  </div>
                  <UButton
                    :disabled="stepStatus.deploy === 'loading'"
                    color="primary"
                    variant="solid"
                    block
                    @click="onDeployOrRollback"
                  >
                    <span
                      v-if="stepStatus.deploy === 'loading'"
                      class="inline-flex items-center gap-2"
                    >
                      <span class="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      Processing…
                    </span>
                    <span v-else>{{ deployConfig.action === 'rollback' ? 'Request rollback' : 'Deploy model' }}</span>
                  </UButton>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="lg:col-span-3">
          <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div
              v-for="(s, i) in [
                { label: 'Candidates', value: datasetStats.total },
                { label: 'Unique cases', value: datasetStats.uniqueCases },
                { label: 'Unique slides', value: datasetStats.uniqueSlides },
                { label: 'Avg confidence', value: `${Math.round(datasetStats.avgConfidence)}%` }
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

          <div class="mt-4 glass-card p-5">
            <div class="flex items-center justify-between">
              <div class="flex rounded-lg bg-ui-bg/60 p-0.5">
                <button
                  class="rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
                  :class="rightTab === 'candidates' ? 'bg-ui-primary text-white shadow-sm' : 'text-ui-muted hover:text-ui-fg'"
                  @click="rightTab = 'candidates'"
                >
                  Candidates
                </button>
                <button
                  class="rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
                  :class="rightTab === 'activity' ? 'bg-ui-primary text-white shadow-sm' : 'text-ui-muted hover:text-ui-fg'"
                  @click="rightTab = 'activity'"
                >
                  Activity
                </button>
              </div>
              <UButton
                size="xs"
                variant="ghost"
                :disabled="queueLoading"
                @click="refreshQueue"
              >
                {{ queueLoading ? 'Refreshing…' : 'Refresh' }}
              </UButton>
            </div>

            <div
              v-if="rightTab === 'candidates'"
              class="mt-4 anim-fade-up"
            >
              <div
                v-if="queueLoading"
                class="space-y-3"
              >
                <div
                  v-for="n in 3"
                  :key="n"
                  class="rounded-xl border border-ui-border/30 p-4 animate-pulse"
                >
                  <div class="flex gap-3">
                    <div class="h-10 w-10 rounded-lg bg-ui-primary/10" />
                    <div class="flex-1 space-y-2">
                      <div class="h-3 w-3/5 rounded bg-ui-primary/10" />
                      <div class="h-3 w-2/5 rounded bg-ui-primary/10" />
                    </div>
                  </div>
                </div>
              </div>

              <div
                v-else-if="queue.length === 0"
                class="flex flex-col items-center py-12 text-center"
              >
                <div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-ui-primary/10">
                  <UIcon
                    name="i-lucide-inbox"
                    class="h-7 w-7 text-ui-muted"
                  />
                </div>
                <p class="mt-4 text-sm font-medium">
                  No candidates yet
                </p>
                <p class="mt-1 max-w-xs text-xs text-ui-muted">
                  Submit expert feedback via the pipeline or press Refresh to fetch existing items.
                </p>
              </div>

              <div
                v-else
                class="space-y-2"
              >
                <button
                  v-for="(item, idx) in queue"
                  :key="String(item.id ?? idx)"
                  class="w-full rounded-xl border p-3.5 text-left transition-all anim-fade-up"
                  :class="selectedItem && selectedItem.id === item.id
                    ? 'border-ui-primary/40 bg-ui-primary/5 shadow-sm'
                    : 'border-ui-border/30 hover:border-ui-primary/20 hover:bg-ui-primary/[2%]'"
                  :style="{ animationDelay: `${idx * 40}ms` }"
                  @click="applySelectionToForm(item)"
                >
                  <div class="flex items-start gap-3">
                    <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-ui-primary/10 text-ui-primary">
                      <UIcon
                        name="i-lucide-microscope"
                        class="h-4 w-4"
                      />
                    </div>
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center justify-between gap-2">
                        <p class="truncate text-sm font-semibold">
                          {{ item.caseId ?? item.case_id ?? 'Case' }} / {{ item.slideId ?? item.slide_id ?? 'Slide' }}
                        </p>
                        <span class="shrink-0 rounded-full bg-ui-primary/10 px-2 py-0.5 text-[11px] font-medium text-ui-primary">
                          {{ item.label ?? item.annotationType ?? 'Review' }}
                        </span>
                      </div>
                      <div class="mt-2 flex items-center gap-3">
                        <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-ui-primary/10">
                          <div
                            class="h-full rounded-full bg-gradient-to-r from-ui-primary to-blue-400 transition-[width] duration-700 ease-out"
                            :style="{ width: `${clamp01(item.confidence) * 100}%` }"
                          />
                        </div>
                        <span class="shrink-0 text-[11px] font-medium text-ui-muted">
                          {{ Math.round(clamp01(item.confidence) * 100) }}%
                        </span>
                      </div>
                    </div>
                  </div>
                  <p
                    v-if="item.suggestedAnnotation || item.suggestion"
                    class="mt-2.5 rounded-lg bg-ui-bg/60 p-2 text-xs text-ui-muted"
                  >
                    <span class="font-medium text-ui-fg">AI:</span> {{ item.suggestedAnnotation ?? item.suggestion }}
                  </p>
                </button>
              </div>
            </div>

            <div
              v-else
              class="mt-4 anim-fade-up"
            >
              <div
                v-if="activity.length === 0"
                class="flex flex-col items-center py-12 text-center"
              >
                <div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-ui-primary/10">
                  <UIcon
                    name="i-lucide-scroll-text"
                    class="h-7 w-7 text-ui-muted"
                  />
                </div>
                <p class="mt-4 text-sm font-medium">
                  No events yet
                </p>
                <p class="mt-1 max-w-xs text-xs text-ui-muted">
                  Pipeline actions will appear here as they are executed.
                </p>
              </div>

              <div
                v-else
                class="max-h-[420px] space-y-1.5 overflow-auto"
              >
                <div
                  v-for="(evt, idx) in activity.slice(0, 20)"
                  :key="evt.id"
                  class="flex items-start gap-3 rounded-lg px-3 py-2 anim-fade-up"
                  :class="evt.level === 'error' ? 'bg-red-500/5' : evt.level === 'success' ? 'bg-blue-500/5' : 'bg-ui-bg/40'"
                  :style="{ animationDelay: `${idx * 30}ms` }"
                >
                  <span
                    class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                    :class="evt.level === 'success' ? 'bg-blue-500' : evt.level === 'error' ? 'bg-red-500' : 'bg-ui-muted'"
                  />
                  <div class="min-w-0 flex-1">
                    <p class="text-sm">
                      {{ evt.message }}
                    </p>
                    <p class="mt-0.5 text-[11px] text-ui-muted">
                      {{ new Date(evt.ts).toLocaleTimeString() }}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div
            v-if="lastResponse"
            class="mt-4 glass-card p-4"
          >
            <div class="flex items-center justify-between">
              <p class="text-xs font-medium uppercase tracking-wider text-ui-muted">
                Last API Response
              </p>
              <button
                class="text-xs text-ui-muted hover:text-ui-primary"
                @click="lastResponse = null"
              >
                Clear
              </button>
            </div>
            <pre class="mt-3 max-h-56 overflow-auto rounded-lg bg-ui-bg/60 p-3 text-xs text-ui-muted">{{ JSON.stringify(lastResponse, null, 2) }}</pre>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
