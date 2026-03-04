<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { getDownloadPath } from "@/utils";
import type { DetailedRom } from "@/stores/roms";

const props = defineProps<{
    rom: DetailedRom;
}>();

const container = ref<HTMLElement | null>(null);

// Declare global variable for Parchment options
declare global {
    interface Window {
        parchment_options?: {
            default_story?: string[];
            container?: HTMLElement | null;
            lib_path?: string;
        };
    }
}

onMounted(() => {
    const gameUrl = getDownloadPath({ rom: props.rom });

    // Configure Parchment
    // See: https://github.com/curiousdannii/parchment
    window.parchment_options = {
        default_story: [gameUrl],
        container: container.value,
        // lib_path: '/assets/parchment/lib/', // Adjust if hosting locally
    };

    // Load Parchment Script
    const script = document.createElement("script");
    // Use a local path or a reliable CDN. 
    // For scaffolding, we point to a potential local location or a placeholder
    script.src = "/assets/parchment/parchment.min.js";
    script.async = true;
    script.onerror = () => {
        console.error("Failed to load Parchment script. Please ensure /assets/parchment/parchment.min.js exists or update the path.");
        if (container.value) {
            container.value.innerHTML = `<div style="color: white; padding: 20px;">
            <h3>Parchment Script Not Found</h3>
            <p>Please install Parchment to <code>/assets/parchment/</code> or update the script source in <code>Player.vue</code>.</p>
        </div>`;
        }
    };
    document.body.appendChild(script);
});

onBeforeUnmount(() => {
    // Cleanup
    delete window.parchment_options;
    // Note: Removing the script tag doesn't unload the code, but Parchment might need specific cleanup if navigating away.
    // Ideally, reload the page or use an iframe if detailed isolation is needed.
});
</script>

<template>
    <div ref="container" class="parchment-container">
        <div class="loading-text">Loading Parchment...</div>
    </div>
</template>

<style scoped>
.parchment-container {
    width: 100%;
    height: 100%;
    background-color: #222;
    /* Default background */
    position: relative;
    overflow: hidden;
}

.loading-text {
    color: #eee;
    text-align: center;
    padding-top: 20%;
}

/* Ensure iframe if Parchment creates one fills the container */
:deep(iframe) {
    width: 100%;
    height: 100%;
    border: none;
}
</style>
