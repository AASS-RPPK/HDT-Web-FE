<script setup lang="ts">
definePageMeta({
  ssr: false,
  title: 'Active Learning Dashboard'
})

type StepKey = 'upload' | 'retrieve' | 'tune' | 'deploy'
type StepStatus = 'idle' | 'loading' | 'success' | 'error'

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

    // Keep it flexible: backend can accept JSON or multipart.
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

function statusClasses(status: StepStatus) {
  switch (status) {
    case 'loading':
      return 'border-ui-primary/50 bg-ui-primary/10 text-ui-primary'
    case 'success':
      return 'border-green-400/60 bg-green-400/10 text-green-700 dark:text-green-300 anim-glow-pulse'
    case 'error':
      return 'border-red-400/60 bg-red-400/10 text-red-700 dark:text-red-300'
    default:
      return 'border-ui-border/60 bg-ui-bg text-ui-muted'
  }
}

onMounted(() => {
  apiBase.value = restoreApiBase()
  watch(apiBase, v => persistApiBase(v), { flush: 'post' })

  // Fire-and-forget: queue can also be empty.
  refreshQueue()
})
</script>

<template>
  <div>
    <UPageHero
      title="Active Learning Ops"
      description="AI expert console to manage fine-tuning runs and model deployment based on newly gathered expert annotations and corrections."
    />

    <UPageSection>
      <div class="flex flex-col gap-4 lg:flex-row">
        <section class="w-full lg:w-2/5">
          <div class="rounded-xl border border-ui-border/60 bg-ui-bg p-4">
            <div class="flex items-start justify-between gap-3">
              <div>
                <h2 class="text-base font-semibold">
                  Pipeline
                </h2>
                <p class="mt-1 text-sm text-ui-muted">
                  Trigger backend processes for feedback retrieval, fine-tuning, and model deploy/rollback.
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
              <div class="rounded-lg border border-ui-border/60 p-3">
                <div class="flex items-center justify-between gap-3">
                  <div class="flex items-center gap-3">
                    <span class="h-9 w-9 rounded-lg border border-ui-border/60 bg-ui-bg flex items-center justify-center">
                      <span class="text-sm font-semibold">1</span>
                    </span>
                    <div>
                      <p class="text-sm font-semibold">
                        Upload Text & Revised Annotation
                      </p>
                      <p class="text-xs text-ui-muted">
                        POST <span class="font-mono">/feedback</span>
                      </p>
                    </div>
                  </div>
                  <div
                    class="rounded-full border px-3 py-1 text-xs font-semibold"
                    :class="statusClasses(stepStatus.upload)"
                  >
                    {{ stepStatus.upload }}
                  </div>
                </div>

                <div class="mt-3 grid gap-3">
                  <div class="grid gap-2 md:grid-cols-2">
                    <label class="block text-xs">
                      <span class="text-ui-muted">Case ID</span>
                      <input
                        v-model="uploadForm.caseId"
                        class="mt-1 w-full rounded-lg border border-ui-border/60 bg-ui-bg px-3 py-2 text-sm outline-none"
                        placeholder="e.g. CASE-1024"
                      >
                    </label>
                    <label class="block text-xs">
                      <span class="text-ui-muted">Slide ID</span>
                      <input
                        v-model="uploadForm.slideId"
                        class="mt-1 w-full rounded-lg border border-ui-border/60 bg-ui-bg px-3 py-2 text-sm outline-none"
                        placeholder="e.g. SLIDE-77A"
                      >
                    </label>
                  </div>

                  <label class="block text-xs">
                    <span class="text-ui-muted">Expert-provided text (optional)</span>
                    <textarea
                      v-model="uploadForm.inputText"
                      rows="3"
                      class="mt-1 w-full resize-none rounded-lg border border-ui-border/60 bg-ui-bg px-3 py-2 text-sm outline-none"
                      placeholder="e.g. tumor region description / specimen notes"
                    />
                  </label>

                  <label class="block text-xs">
                    <span class="text-ui-muted">Revised annotation</span>
                    <textarea
                      v-model="uploadForm.revisedAnnotation"
                      rows="4"
                      class="mt-1 w-full resize-none rounded-lg border border-ui-border/60 bg-ui-bg px-3 py-2 text-sm outline-none focus:shadow-[0_0_0_4px_rgba(0,220,130,0.15)]"
                      placeholder="e.g. corrected label, structured markup, or final guidance"
                    />
                  </label>

                  <label class="block text-xs">
                    <span class="text-ui-muted">Optional image/ROI (for context)</span>
                    <input
                      type="file"
                      accept="image/*"
                      class="mt-1 w-full rounded-lg border border-ui-border/60 bg-ui-bg px-3 py-2 text-sm outline-none"
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
                      <span class="h-4 w-4 animate-spin rounded-full border-2 border-ui-bg border-t-ui-primary" />
                      Uploading...
                    </span>
                    <span v-else>Submit feedback</span>
                  </UButton>
                </div>
              </div>

              <div class="rounded-lg border border-ui-border/60 p-3">
                <div class="flex items-center justify-between gap-3">
                  <div class="flex items-center gap-3">
                    <span class="h-9 w-9 rounded-lg border border-ui-border/60 bg-ui-bg flex items-center justify-center">
                      <span class="text-sm font-semibold">2</span>
                    </span>
                    <div>
                      <p class="text-sm font-semibold">
                        Retrieve Text & Revised Feedback
                      </p>
                      <p class="text-xs text-ui-muted">
                        GET <span class="font-mono">/feedback</span>
                      </p>
                    </div>
                  </div>
                  <div
                    class="rounded-full border px-3 py-1 text-xs font-semibold"
                    :class="statusClasses(stepStatus.retrieve)"
                  >
                    {{ stepStatus.retrieve }}
                  </div>
                </div>

                <div class="mt-3 flex flex-col gap-2">
                  <UButton
                    :disabled="stepStatus.retrieve === 'loading'"
                    color="primary"
                    variant="ghost"
                    @click="stepStatus.retrieve = 'loading'; refreshQueue().finally(() => (stepStatus.retrieve = queueError ? 'error' : 'success'))"
                  >
                    <span
                      v-if="queueLoading || stepStatus.retrieve === 'loading'"
                      class="inline-flex items-center gap-2"
                    >
                      <span class="h-4 w-4 animate-spin rounded-full border-2 border-ui-bg border-t-ui-primary" />
                      Retrieving...
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
              </div>

              <div class="rounded-lg border border-ui-border/60 p-3">
                <div class="flex items-center justify-between gap-3">
                  <div class="flex items-center gap-3">
                    <span class="h-9 w-9 rounded-lg border border-ui-border/60 bg-ui-bg flex items-center justify-center">
                      <span class="text-sm font-semibold">3</span>
                    </span>
                    <div>
                      <p class="text-sm font-semibold">
                        Start Mode Fine Tuning
                      </p>
                      <p class="text-xs text-ui-muted">
                        POST <span class="font-mono">/models/annotation/train</span>
                      </p>
                    </div>
                  </div>
                  <div
                    class="rounded-full border px-3 py-1 text-xs font-semibold"
                    :class="statusClasses(stepStatus.tune)"
                  >
                    {{ stepStatus.tune }}
                  </div>
                </div>

                <div class="mt-3 grid gap-3 md:grid-cols-2">
                  <label class="block text-xs md:col-span-2">
                    <span class="text-ui-muted">Mode</span>
                    <input
                      v-model="tuningConfig.mode"
                      class="mt-1 w-full rounded-lg border border-ui-border/60 bg-ui-bg px-3 py-2 text-sm outline-none"
                      placeholder="active-learning"
                    >
                  </label>
                  <label class="block text-xs">
                    <span class="text-ui-muted">Epochs</span>
                    <input
                      v-model.number="tuningConfig.epochs"
                      type="number"
                      min="1"
                      class="mt-1 w-full rounded-lg border border-ui-border/60 bg-ui-bg px-3 py-2 text-sm outline-none"
                    >
                  </label>
                  <label class="block text-xs">
                    <span class="text-ui-muted">Batch Size</span>
                    <input
                      v-model.number="tuningConfig.batchSize"
                      type="number"
                      min="1"
                      class="mt-1 w-full rounded-lg border border-ui-border/60 bg-ui-bg px-3 py-2 text-sm outline-none"
                    >
                  </label>
                  <label class="block text-xs md:col-span-2">
                    <span class="text-ui-muted">Learning Rate</span>
                    <input
                      v-model.number="tuningConfig.learningRate"
                      type="number"
                      step="0.00001"
                      class="mt-1 w-full rounded-lg border border-ui-border/60 bg-ui-bg px-3 py-2 text-sm outline-none"
                    >
                  </label>
                </div>

                <label class="block text-xs mt-3">
                  <span class="text-ui-muted">Auto-deploy after training</span>
                  <div class="mt-2 flex items-start gap-3">
                    <input
                      v-model="autoDeployAfterTrain"
                      type="checkbox"
                      class="mt-1 h-4 w-4 rounded border border-ui-border/60 bg-ui-bg text-ui-primary focus:ring-ui-primary"
                    >
                    <span class="text-sm text-ui-muted">
                      After fine-tuning completes, automatically deploy the updated model for the next annotation round.
                    </span>
                  </div>
                </label>

                <div class="mt-3">
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
                      <span class="h-4 w-4 animate-spin rounded-full border-2 border-ui-bg border-t-ui-primary" />
                      Starting...
                    </span>
                    <span v-else>Start fine-tuning</span>
                  </UButton>
                </div>
              </div>

              <div class="rounded-lg border border-ui-border/60 p-3">
                <div class="flex items-center justify-between gap-3">
                  <div class="flex items-center gap-3">
                    <span class="h-9 w-9 rounded-lg border border-ui-border/60 bg-ui-bg flex items-center justify-center">
                      <span class="text-sm font-semibold">4</span>
                    </span>
                    <div>
                      <p class="text-sm font-semibold">
                        Deploy or Rollback Model
                      </p>
                      <p class="text-xs text-ui-muted">
                        POST <span class="font-mono">/models/annotation/deploy</span>
                      </p>
                    </div>
                  </div>
                  <div
                    class="rounded-full border px-3 py-1 text-xs font-semibold"
                    :class="statusClasses(stepStatus.deploy)"
                  >
                    {{ stepStatus.deploy }}
                  </div>
                </div>

                <div class="mt-3 grid gap-3 md:grid-cols-2">
                  <label class="block text-xs">
                    <span class="text-ui-muted">Action</span>
                    <select
                      v-model="deployConfig.action"
                      class="mt-1 w-full rounded-lg border border-ui-border/60 bg-ui-bg px-3 py-2 text-sm outline-none"
                    >
                      <option value="deploy">Deploy</option>
                      <option value="rollback">Rollback</option>
                    </select>
                  </label>
                  <label class="block text-xs">
                    <span class="text-ui-muted">Model version (optional)</span>
                    <input
                      v-model="deployConfig.modelVersion"
                      class="mt-1 w-full rounded-lg border border-ui-border/60 bg-ui-bg px-3 py-2 text-sm outline-none"
                      placeholder="e.g. v1.2.3"
                    >
                  </label>
                </div>

                <div class="mt-3">
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
                      <span class="h-4 w-4 animate-spin rounded-full border-2 border-ui-bg border-t-ui-primary" />
                      Processing...
                    </span>
                    <span v-else>{{ deployConfig.action === 'rollback' ? 'Request rollback' : 'Deploy model' }}</span>
                  </UButton>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class="w-full lg:w-3/5">
          <div class="rounded-xl border border-ui-border/60 bg-ui-bg p-4">
            <div class="flex items-start justify-between gap-3">
              <div>
                <h2 class="text-base font-semibold">
                  Next-Round Candidates
                </h2>
                <p class="mt-1 text-sm text-ui-muted">
                  Candidates are derived from expert-labeled feedback to improve the model for the next histopathologist session.
                </p>
              </div>
              <div class="text-xs text-ui-muted">
                {{ queueLoading ? 'Loading...' : `${queue.length} item(s)` }}
              </div>
            </div>

            <div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div class="rounded-xl border border-ui-border/60 bg-ui-bg p-3 anim-fade-up">
                <p class="text-xs text-ui-muted">
                  Candidates
                </p>
                <p class="mt-1 text-2xl font-bold">
                  {{ datasetStats.total }}
                </p>
              </div>
              <div class="rounded-xl border border-ui-border/60 bg-ui-bg p-3 anim-fade-up">
                <p class="text-xs text-ui-muted">
                  Unique cases
                </p>
                <p class="mt-1 text-2xl font-bold">
                  {{ datasetStats.uniqueCases }}
                </p>
              </div>
              <div class="rounded-xl border border-ui-border/60 bg-ui-bg p-3 anim-fade-up">
                <p class="text-xs text-ui-muted">
                  Unique slides
                </p>
                <p class="mt-1 text-2xl font-bold">
                  {{ datasetStats.uniqueSlides }}
                </p>
              </div>
              <div class="rounded-xl border border-ui-border/60 bg-ui-bg p-3 anim-fade-up">
                <p class="text-xs text-ui-muted">
                  Avg confidence
                </p>
                <p class="mt-1 text-2xl font-bold">
                  {{ Math.round(datasetStats.avgConfidence) }}%
                </p>
              </div>
            </div>

            <div class="mt-4 grid gap-3">
              <div
                v-if="queueLoading"
                class="rounded-lg border border-ui-border/60 p-3 animate-pulse"
              >
                <div class="h-3 w-3/5 rounded bg-ui-primary/20" />
                <div class="mt-2 flex gap-2">
                  <div class="h-12 w-12 rounded bg-ui-primary/15" />
                  <div class="flex-1">
                    <div class="h-3 w-4/5 rounded bg-ui-primary/15" />
                    <div class="mt-2 h-3 w-2/3 rounded bg-ui-primary/15" />
                  </div>
                </div>
              </div>

              <div
                v-else-if="queue.length === 0"
                class="rounded-lg border border-ui-border/60 p-3"
              >
                <p class="text-sm text-ui-muted">
                  No items in the queue yet. Use <span class="font-semibold">Refresh queue</span> or submit feedback to bootstrap training.
                </p>
              </div>

              <div
                v-for="(item, idx) in queue"
                :key="String(item.id ?? idx)"
                class="rounded-xl border border-ui-border/60 bg-ui-bg p-3 transition-shadow hover:shadow-[0_10px_30px_rgba(0,0,0,0.06)]"
                :class="selectedItem && (selectedItem.id === item.id) ? 'ring-2 ring-ui-primary/50' : ''"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="flex items-start gap-3">
                    <div class="h-12 w-12 overflow-hidden rounded-lg border border-ui-border/60 bg-ui-primary/10">
                      <div
                        class="h-full w-full anim-fade-up"
                        :style="{ animationDelay: `${idx * 60}ms` }"
                      />
                    </div>
                    <div>
                      <div class="flex items-center gap-2">
                        <p class="text-sm font-semibold">
                          {{ item.caseId ?? item.case_id ?? 'Case' }} / {{ item.slideId ?? item.slide_id ?? 'Slide' }}
                        </p>
                      </div>
                      <p class="mt-1 text-xs text-ui-muted">
                        Confidence
                        <span class="font-semibold">{{ Math.round(clamp01(item.confidence) * 100) }}%</span>
                      </p>
                      <div class="mt-2 h-2 w-56 max-w-full overflow-hidden rounded bg-ui-primary/10">
                        <div
                          class="h-full rounded bg-gradient-to-r from-ui-primary/70 via-green-400/70 to-ui-primary/80 transition-[width] duration-700 ease-out"
                          :style="{ width: `${clamp01(item.confidence) * 100}%` }"
                        />
                      </div>
                    </div>
                  </div>

                  <div class="flex flex-col items-end gap-2">
                    <div class="text-[11px] text-ui-muted">
                      {{ item.label ?? item.annotationType ?? 'Review' }}
                    </div>
                    <UButton
                      size="xs"
                      variant="ghost"
                      @click="applySelectionToForm(item)"
                    >
                      Load into form
                    </UButton>
                  </div>
                </div>

                <div
                  v-if="item.suggestedAnnotation || item.suggestion"
                  class="mt-3"
                >
                  <div class="flex items-center justify-between">
                    <span class="text-xs font-semibold text-ui-muted">AI suggestion</span>
                  </div>
                  <p class="mt-1 whitespace-pre-wrap break-words text-sm">
                    {{ item.suggestedAnnotation ?? item.suggestion }}
                  </p>
                </div>
              </div>
            </div>

            <div class="mt-4 rounded-xl border border-ui-border/60 bg-ui-bg p-3">
              <div class="flex items-center justify-between">
                <p class="text-sm font-semibold">
                  Recent Activity
                </p>
                <span class="text-xs text-ui-muted">{{ activity.length }} event(s)</span>
              </div>
              <div class="mt-3 max-h-56 overflow-auto">
                <div
                  v-if="activity.length === 0"
                  class="text-sm text-ui-muted"
                >
                  No events yet.
                </div>
                <div
                  v-for="(evt, idx) in activity.slice(0, 10)"
                  :key="evt.id"
                  class="mb-2 rounded-lg border border-ui-border/60 p-2 anim-fade-up"
                  :style="{ animationDelay: `${idx * 50}ms` }"
                >
                  <div class="flex items-center justify-between gap-3">
                    <span class="text-xs font-semibold">
                      <span
                        v-if="evt.level === 'success'"
                        class="text-green-600 dark:text-green-300"
                      >Success</span>
                      <span
                        v-else-if="evt.level === 'error'"
                        class="text-red-600 dark:text-red-300"
                      >Error</span>
                      <span
                        v-else
                        class="text-ui-muted"
                      >Info</span>
                    </span>
                    <span class="text-[11px] text-ui-muted">{{ new Date(evt.ts).toLocaleTimeString() }}</span>
                  </div>
                  <p class="mt-1 text-sm">
                    {{ evt.message }}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div
        v-if="lastResponse"
        class="mt-6 rounded-xl border border-ui-border/60 bg-ui-bg p-4"
      >
        <div class="flex items-center justify-between gap-3">
          <h3 class="text-sm font-semibold">
            Last API response (raw)
          </h3>
          <button
            class="text-xs text-ui-muted underline underline-offset-4 hover:text-ui-primary"
            @click="lastResponse = null"
          >
            Clear
          </button>
        </div>
        <pre class="mt-3 max-h-72 overflow-auto rounded-lg bg-ui-bg p-3 text-xs text-ui-muted border border-ui-border/60">{{ JSON.stringify(lastResponse, null, 2) }}</pre>
      </div>
    </UPageSection>
  </div>
</template>
