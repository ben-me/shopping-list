<template>
  <div class="screen">
    <div v-if="$slots.entry" class="entry">
      <slot name="entry" />
    </div>
    <main class="page">
      <slot />
    </main>
    <footer v-if="$slots.footer" class="screen-footer">
      <slot name="footer" />
    </footer>
  </div>
</template>
