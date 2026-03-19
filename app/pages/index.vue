<template>
  <div>
    <UPageHero
      title="Histopathology Annotation Dashboards"
      description="Monitor the AI feedback loop for model improvement and track how experts interact with AI-assisted annotation workflows."
      :links="[{
        label: 'Active Learning',
        to: '/active-learning',
        trailingIcon: 'i-lucide-arrow-right',
        size: 'xl'
      }, {
        label: 'User Behavioral',
        to: '/user-behavioral',
        trailingIcon: 'i-lucide-arrow-right',
        size: 'xl',
        color: 'neutral',
        variant: 'subtle'
      }]"
    />

    <UPageSection
      id="features"
      title="Designed for fast expert sessions"
      description="Built for histopathologists: clear pipeline states, expert-friendly queue review, and actionable behavioral monitoring."
      :features="[{
        icon: 'i-lucide-shield-check',
        title: 'Human-in-the-loop',
        description: 'Capture expert corrections to improve guidance quality for the next annotation round.'
      }, {
        icon: 'i-lucide-palette',
        title: 'Clean histopath UX',
        description: 'Readable metrics + structured pipeline steps tailored for reviewing and correcting ROI/labels.'
      }, {
        icon: 'i-lucide-timer',
        title: 'Process visibility',
        description: 'Animated step states (upload, retrieve, tune, deploy/rollback) so sessions are never a black box.'
      }, {
        icon: 'i-lucide-chart-line',
        title: 'Behavioral monitoring',
        description: 'Track annotation + correction patterns to validate UX and improve AI assistance over time.'
      }, {
        icon: 'i-lucide-brain',
        title: 'AI feedback loop ready',
        description: 'Wired to backend endpoints so your pipeline can evolve without redesigning the UI.'
      }]"
    />

    <UPageSection>
      <UPageCTA
        title="Start a safe expert review cycle"
        description="Active Learning drives the next model improvement round, while Behavioral Monitoring validates how experts interact with AI-assisted annotation workflows."
        variant="subtle"
        :links="[{
          label: 'Active Learning',
          to: '/active-learning',
          trailingIcon: 'i-lucide-arrow-right',
          color: 'primary',
          variant: 'solid'
        }, {
          label: 'User Behavioral Dashboard',
          to: '/user-behavioral',
          icon: 'i-lucide-heart-pulse',
          color: 'primary',
          variant: 'outline'
        }]"
      />
    </UPageSection>

    <UPageSection title="Dashboards">
      <div class="grid gap-4 md:grid-cols-2">
        <div
          class="rounded-xl border border-ui-border/60 bg-ui-bg p-4 anim-fade-up"
          :style="{ animationDelay: '80ms' }"
        >
          <h3 class="text-lg font-semibold">
            Active Learning
          </h3>
          <p class="mt-1 text-sm text-ui-muted">
            Upload expert feedback, trigger fine-tuning, and deploy/rollback models for next annotation rounds.
          </p>
          <div class="mt-4 flex gap-2">
            <UButton
              to="/active-learning"
              color="primary"
              variant="solid"
              trailing-icon="i-lucide-arrow-right"
            >
              Open
            </UButton>
            <UButton
              to="/active-learning"
              color="primary"
              variant="ghost"
            >
              Pipeline
            </UButton>
          </div>
        </div>

        <div
          class="rounded-xl border border-ui-border/60 bg-ui-bg p-4 anim-fade-up"
          :style="{ animationDelay: '160ms' }"
        >
          <h3 class="text-lg font-semibold">
            User Behavioral
          </h3>
          <p class="mt-1 text-sm text-ui-muted">
            Monitor histopathologist interactions (annotation + corrections) to improve guidance quality and UX.
          </p>
          <div class="mt-4 flex gap-2">
            <UButton
              to="/user-behavioral"
              color="primary"
              variant="solid"
              trailing-icon="i-lucide-arrow-right"
            >
              Open
            </UButton>
            <UButton
              to="/user-behavioral"
              color="primary"
              variant="ghost"
            >
              Insights
            </UButton>
          </div>
        </div>
      </div>
    </UPageSection>
  </div>
</template>
