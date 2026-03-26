<template>
  <UDropdownMenu
    v-slot="{ open }"
    :modal="false"
    :items="[
      { label: 'Overview', to: '/', icon: 'i-lucide-shield-check', color: 'neutral' },
{ label: 'Active Learning', to: '/active-learning', icon: 'i-lucide-brain', color: 'primary' },
      { label: 'User Behavioral', to: '/user-behavioral', icon: 'i-lucide-heart-pulse', color: 'primary' }
    ]"
    :content="{ align: 'start' }"
    :ui="{ content: 'min-w-fit' }"
    size="xs"
  >
    <UButton
      label="Workflows"
      variant="subtle"
      trailing-icon="i-lucide-chevron-down"
      size="xs"
      class="-mb-[6px] font-semibold rounded-full truncate"
      :class="[open && 'bg-primary/15']"
      :ui="{
        trailingIcon: ['transition-transform duration-200', open ? 'rotate-180' : undefined].filter(Boolean).join(' ')
      }"
    />
  </UDropdownMenu>
</template>
