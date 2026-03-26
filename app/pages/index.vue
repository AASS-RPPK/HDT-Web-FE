<template>
  <div>
    <section class="hero-gradient px-6 pb-20 pt-24 text-center">
      <div class="mx-auto max-w-3xl anim-fade-up">
        <div class="mb-6 inline-flex items-center gap-2 rounded-full border border-ui-border/40 bg-ui-bg/60 px-4 py-1.5 text-xs font-medium text-ui-muted backdrop-blur">
          <span class="h-2 w-2 rounded-full bg-blue-400 anim-glow-pulse" />
          Histopathology Annotation Platform
        </div>

        <h1 class="text-4xl font-bold tracking-tight sm:text-5xl">
          AI-Assisted Annotation
          <span class="bg-gradient-to-r from-blue-500 to-blue-300 bg-clip-text text-transparent">
            Dashboards
          </span>
        </h1>

        <p class="mx-auto mt-5 max-w-2xl text-lg text-ui-muted">
          Monitor the AI feedback loop, manage model retraining, and analyse how experts interact with AI-assisted annotation workflows.
        </p>

        <div class="mt-8 flex flex-wrap items-center justify-center gap-3">
          <UButton
            to="/active-learning"
            color="neutral"
            variant="subtle"
            size="lg"
            trailing-icon="i-lucide-arrow-right"
          >
            Active Learning
          </UButton>
          <UButton
            to="/user-behavioral"
            color="neutral"
            variant="subtle"
            size="lg"
            trailing-icon="i-lucide-arrow-right"
          >
            User Behavioral
          </UButton>
        </div>
      </div>
    </section>

    <section class="mx-auto -mt-10 max-w-6xl px-6">
      <div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <div
          v-for="(f, i) in features"
          :key="f.title"
          class="glass-card p-5 anim-fade-up"
          :style="{ animationDelay: `${i * 80}ms` }"
        >
          <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-ui-primary/10 text-ui-primary">
            <UIcon
              :name="f.icon"
              class="h-5 w-5"
            />
          </div>
          <h3 class="mt-3 text-sm font-semibold">
            {{ f.title }}
          </h3>
          <p class="mt-1.5 text-sm leading-relaxed text-ui-muted">
            {{ f.description }}
          </p>
        </div>
      </div>
    </section>

    <section class="mx-auto mt-16 max-w-6xl px-6 pb-20">
      <h2 class="text-center text-2xl font-bold tracking-tight">
        Workspaces
      </h2>
      <p class="mx-auto mt-2 max-w-lg text-center text-sm text-ui-muted">
        Choose a dashboard to get started with model management or behavioural analytics.
      </p>

      <div class="mt-8 grid gap-5 md:grid-cols-2">
        <NuxtLink
          to="/active-learning"
          class="glass-card group flex flex-col justify-between p-6 anim-fade-up"
          :style="{ animationDelay: '80ms' }"
        >
          <div>
            <div class="flex items-center gap-3">
              <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-300">
                <UIcon
                  name="i-lucide-brain"
                  class="h-5 w-5"
                />
              </div>
              <h3 class="text-lg font-semibold">
                Active Learning
              </h3>
            </div>
            <p class="mt-3 text-sm leading-relaxed text-ui-muted">
              Upload expert feedback, trigger fine-tuning runs, and deploy or rollback annotation models for the next session.
            </p>
          </div>
          <div class="mt-5 flex items-center gap-1.5 text-sm font-medium text-ui-primary transition-transform group-hover:translate-x-1">
            Open dashboard
            <UIcon
              name="i-lucide-arrow-right"
              class="h-4 w-4"
            />
          </div>
        </NuxtLink>

        <NuxtLink
          to="/user-behavioral"
          class="glass-card group flex flex-col justify-between p-6 anim-fade-up"
          :style="{ animationDelay: '160ms' }"
        >
          <div>
            <div class="flex items-center gap-3">
              <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-300">
                <UIcon
                  name="i-lucide-activity"
                  class="h-5 w-5"
                />
              </div>
              <h3 class="text-lg font-semibold">
                User Behavioral
              </h3>
            </div>
            <p class="mt-3 text-sm leading-relaxed text-ui-muted">
              Monitor histopathologist interactions, correction patterns, and session timing to improve AI guidance quality.
            </p>
          </div>
          <div class="mt-5 flex items-center gap-1.5 text-sm font-medium text-ui-primary transition-transform group-hover:translate-x-1">
            Open dashboard
            <UIcon
              name="i-lucide-arrow-right"
              class="h-4 w-4"
            />
          </div>
        </NuxtLink>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
const features = [
  {
    icon: 'i-lucide-shield-check',
    title: 'Human-in-the-loop',
    description: 'Capture expert corrections to continuously improve guidance quality for the next annotation round.'
  },
  {
    icon: 'i-lucide-timer',
    title: 'Process visibility',
    description: 'Animated pipeline step states (upload, retrieve, tune, deploy) so sessions are never a black box.'
  },
  {
    icon: 'i-lucide-chart-line',
    title: 'Behavioral analytics',
    description: 'Track annotation and correction patterns to validate UX and improve AI assistance over time.'
  },
  {
    icon: 'i-lucide-brain',
    title: 'AI feedback loop',
    description: 'Wired to backend endpoints so your pipeline can evolve without redesigning the front-end.'
  },
  {
    icon: 'i-lucide-microscope',
    title: 'Histopathology first',
    description: 'Designed for clinical workflows — readable metrics and structured steps tailored for reviewing ROIs and labels.'
  },
  {
    icon: 'i-lucide-lock',
    title: 'Session safety',
    description: 'Rollback support and endpoint visibility ensure every model change is traceable and reversible.'
  }
]
</script>
