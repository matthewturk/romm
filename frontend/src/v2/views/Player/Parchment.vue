<script setup lang="ts">
// Parchment — v2 shell for Interactive Fiction (Z-machine / Glulx) ROMs.
// The Parchment integration (authenticated story blob + parchment_options,
// script loading, cloud-save sync, in-game dialogs) lives in the v1
// <Player> component and is reused as-is; only the chrome is v2. Text
// adventures are keyboard-driven, so the running session flags `playing` to
// mute global hotkeys / pad-to-UI translation while the game owns input.
import { RBtn, RCard, RSwitch } from "@v2/lib";
import {
  computed,
  defineAsyncComponent,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { ROUTES } from "@/plugins/router";
import romApi from "@/services/api/rom";
import storePlaying from "@/stores/playing";
import storeRoms, { type DetailedRom, type SimpleRom } from "@/stores/roms";
import GameCover from "@/v2/components/shared/GameCover.vue";
import { useBackgroundArt } from "@/v2/composables/useBackgroundArt";
import { useFullscreenPref } from "@/v2/composables/useFullscreenPref";
import { usePageTitle } from "@/v2/composables/usePageTitle";
import { usePlaySession } from "@/v2/composables/usePlaySession";
import storeGalleryRoms from "@/v2/stores/galleryRoms";

// Reuse v1's Parchment integration — do NOT rewrite this. Lazy so the bundle
// doesn't pull in the Parchment shims until we actually mount the player.
const Player = defineAsyncComponent(
  () => import("@/views/Player/Parchment/Player.vue"),
);

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const { fullscreenOnPlay } = useFullscreenPref();
const playingStore = storePlaying();
const playSession = usePlaySession();

const rom = ref<DetailedRom | null>(null);
const gameRunning = ref(false);

// Rom id from the route param (available before `rom` resolves) so the hero
// cover paints its `view-transition-name` immediately and the shared-element
// morph from the gallery / details cover pairs on entry.
const morphRomId = computed(() => {
  const r = route.params.rom;
  return typeof r === "string" ? r : null;
});

// Seed synchronously so the hero cover is in the DOM when the view transition
// captures this view and the morph pairs on entry. From GameDetails the full
// DetailedRom is in `currentRom`; on a direct gallery→play only a SimpleRom
// exists, so seed a cover-only `heroSeed` (`rom` stays null until `onMounted`
// refetches). See EmulatorJS / Ruffle for the same pattern.
const seededRom = storeRoms().currentRom;
if (seededRom && String(seededRom.id) === morphRomId.value) {
  rom.value = seededRom;
}
const heroSeed = ref<SimpleRom | null>(null);
if (!rom.value && morphRomId.value != null) {
  heroSeed.value = storeGalleryRoms().getRomById(Number(morphRomId.value));
}
const heroRom = computed<DetailedRom | SimpleRom | null>(
  () => rom.value ?? heroSeed.value,
);

const setBgArt = useBackgroundArt();

// Background art keeps the plain 2D cover.
const bgCoverUrl = computed(() => {
  const r = rom.value;
  if (!r) return null;
  return r.path_cover_large ?? r.path_cover_small ?? r.url_cover ?? null;
});

watch(
  bgCoverUrl,
  (url) => {
    if (url) setBgArt(url);
  },
  { immediate: true },
);

const title = computed(
  () => heroRom.value?.name || heroRom.value?.fs_name_no_ext || "",
);

usePageTitle(() =>
  title.value ? t("play.page-title", { name: title.value }) : null,
);

const platformLabel = computed(
  () =>
    heroRom.value?.platform_custom_name ||
    heroRom.value?.platform_display_name ||
    "",
);

// "Start in fullscreen" needs the user gesture from the Play click, but the
// running <Player> (and its #parchment-root) only mounts after the async
// import resolves — briefly poll for it rather than racing a single nextTick.
// Caps well inside the browser's transient-activation window.
async function enterFullscreenOnMount() {
  if (!fullscreenOnPlay.value) return;
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const el = document.getElementById("parchment-root");
    if (el?.requestFullscreen) {
      el.requestFullscreen().catch(() => {});
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function onPlay() {
  if (!rom.value) return;
  gameRunning.value = true;
  // Text adventures are keyboard-driven; flag the session so global hotkeys
  // and pad-to-UI translation stay muted while the game owns input.
  playingStore.setPlaying(true);
  // Start timing the session now that playback is booting; flushed on
  // unmount, which is what updates last_played / now_playing / status.
  playSession.start(rom.value);
  await enterFullscreenOnMount();
}

function onlyQuit() {
  window.history.back();
}

function backToRom() {
  router.push({ name: ROUTES.ROM, params: { rom: rom.value?.id } });
}
function backToPlatform() {
  router.push({
    name: ROUTES.PLATFORM,
    params: { platform: rom.value?.platform_id },
  });
}

onMounted(async () => {
  const romResponse = await romApi.getRom({
    romId: parseInt(route.params.rom as string),
  });
  rom.value = romResponse.data;
});

onBeforeUnmount(() => {
  // Every exit path (Quit, back links, route change) unmounts the view, so
  // this is the single choke point for recording the session.
  playSession.flush();
  // Hand the keyboard and gamepad back to the UI on any exit path.
  playingStore.setPlaying(false);
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
});
</script>

<template>
  <section v-if="rom || heroSeed" class="r-v2-parchment">
    <!-- Pre-game configuration -->
    <div v-if="!gameRunning" class="r-v2-parchment__config">
      <!-- Cover column -->
      <aside class="r-v2-parchment__cover">
        <GameCover
          class="r-v2-parchment__cover-box"
          :rom="heroRom"
          :title="title"
          :identified="heroRom?.is_identified ?? true"
          :morph-id="morphRomId"
          style-context="player"
          morph-static
          hover-motion
        />
        <h1 class="r-v2-parchment__title">
          {{ title }}
        </h1>
        <p class="r-v2-parchment__subtitle">
          {{ platformLabel }}
        </p>
      </aside>

      <!-- Settings panel -->
      <RCard class="r-v2-parchment__panel" variant="flat">
        <div class="r-v2-parchment__settings">
          <RSwitch v-model="fullscreenOnPlay" :label="t('play.full-screen')" />

          <RBtn
            size="large"
            variant="flat"
            color="primary"
            block
            prepend-icon="mdi-play-circle"
            class="r-v2-parchment__play"
            :loading="!rom"
            :disabled="!rom"
            @click="onPlay"
          >
            {{ t("play.play") }}
          </RBtn>

          <RBtn
            block
            variant="text"
            size="small"
            prepend-icon="mdi-arrow-left"
            @click="backToRom"
          >
            {{ t("play.back-to-game-details") }}
          </RBtn>
          <RBtn
            block
            variant="text"
            size="small"
            prepend-icon="mdi-view-grid-outline"
            @click="backToPlatform"
          >
            {{ t("play.back-to-gallery") }}
          </RBtn>
        </div>
      </RCard>

      <div class="r-v2-parchment__brand">
        <span>{{ t("play.powered-by") }}</span>
        <span class="r-v2-parchment__brand-name">Parchment</span>
      </div>
    </div>

    <!-- Running state — full bleed minus nav -->
    <div v-else class="r-v2-parchment__stage-wrap">
      <div class="r-v2-parchment__stage">
        <Player v-if="rom" :rom="rom" />
      </div>
      <RBtn
        class="r-v2-parchment__quit"
        variant="translucent"
        prepend-icon="mdi-exit-to-app"
        @click="onlyQuit"
      >
        {{ t("play.quit") }}
      </RBtn>
    </div>
  </section>

  <section v-else class="r-v2-parchment__loading">
    <div class="r-v2-parchment__spinner" :aria-label="t('common.loading')" />
  </section>
</template>

<style scoped>
.r-v2-parchment {
  position: relative;
  min-height: calc(100vh - var(--r-nav-h));
  padding: 24px var(--r-row-pad) 48px;
}

.r-v2-parchment__config {
  display: grid;
  grid-template-columns: 240px 1fr;
  gap: 24px;
  max-width: 820px;
  margin: 0 auto;
}

.r-v2-parchment__cover {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 8px;
}

.r-v2-parchment__cover-box {
  --r-cover-radius: var(--r-radius-lg);
}
/* 2D box art keeps a drop shadow; alt-art floats frame-free. */
.r-v2-parchment__cover-box:not(.game-cover--alt) {
  box-shadow: 0 18px 36px color-mix(in srgb, black 55%, transparent);
}

.r-v2-parchment__title {
  margin: 10px 0 0;
  font-size: var(--r-font-size-xl);
  font-weight: var(--r-font-weight-bold);
  line-height: 1.2;
}

.r-v2-parchment__subtitle {
  margin: 0;
  font-size: var(--r-font-size-sm);
  color: var(--r-color-fg-muted);
}

.r-v2-parchment__panel {
  background: var(--r-color-bg-elevated) !important;
  border: 1px solid var(--r-color-border) !important;
  border-radius: var(--r-radius-lg) !important;
  backdrop-filter: blur(18px);
  display: flex !important;
  flex-direction: column;
  overflow: hidden;
}

.r-v2-parchment__settings {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.r-v2-parchment__play {
  margin-top: 8px;
}

.r-v2-parchment__brand {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
  font-size: var(--r-font-size-xs);
  color: var(--r-color-fg-faint);
  font-style: italic;
}
.r-v2-parchment__brand-name {
  font-style: normal;
  font-weight: var(--r-font-weight-semibold);
  letter-spacing: 0.03em;
}

/* Running state */
.r-v2-parchment__stage-wrap {
  position: fixed;
  inset: var(--r-nav-h) 0 0 0;
  background: var(--r-color-canvas-bg);
  z-index: 1;
}
.r-v2-parchment__stage {
  width: 100%;
  height: 100%;
}
.r-v2-parchment__quit {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 2;
}

.r-v2-parchment__loading {
  min-height: calc(100vh - var(--r-nav-h));
  display: grid;
  place-items: center;
}
.r-v2-parchment__spinner {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 2px solid var(--r-color-surface-hover);
  border-top-color: var(--r-color-brand-primary);
  animation: r-v2-parchment-spin 0.8s linear infinite;
}
@keyframes r-v2-parchment-spin {
  to {
    transform: rotate(360deg);
  }
}

html[data-bp~="xs"] .r-v2-parchment__config {
  grid-template-columns: 1fr;
}
html[data-bp~="xs"] .r-v2-parchment__cover {
  max-width: 240px;
  margin: 0 auto;
}
</style>
