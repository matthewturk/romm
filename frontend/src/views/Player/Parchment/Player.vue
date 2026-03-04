<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import { useScriptTag } from '@vueuse/core';
import { getDownloadPath } from '@/utils';
import type { DetailedRom } from '@/stores/roms';
import '@/assets/parchment-scoped.css';

const props = defineProps<{
    rom: DetailedRom;
}>();

// Manage global scripts via VueUse
// We need jQuery before Parchment
// Note: useScriptTag handles mounting and removing scripts from DOM on component unmount automatically if not manual?
// Documentation says: "Automatically load the script on mount, and unload on unmount."
// BUT since we need sequential loading (jQuery then Parchment), we use manual loading.
// When manual: true, unloading is also manual unless we manage lifecycle.
// However, `useScriptTag` returns an `unload` function. We should call it.

const jqueryScript = useScriptTag(
    '/assets/parchment/jquery.min.js',
    () => { /* Loaded */ },
    { manual: true }
);

const parchmentScript = useScriptTag(
    '/assets/parchment/parchment.js',
    () => { /* Loaded */ },
    { manual: true }
);

onMounted(async () => {
    // Configure Parchment Options
    const romUrl = getDownloadPath({ rom: props.rom });

    // Set global options for Parchment
    // We attach to window as required by the library
    (window as any).parchment_options = {
        default_story: [romUrl],
        lib_path: '/assets/parchment/',
        story_name: props.rom.name,
        // auto_launch: true // Default behavior launches the story
    };

    // Load Scripts Sequentially
    try {
        await jqueryScript.load();
        await parchmentScript.load();
    } catch (err) {
        console.error('Error loading Parchment scripts:', err);
    }
});

onUnmounted(() => {
    // Unload scripts to clean up DOM
    jqueryScript.unload();
    parchmentScript.unload();

    // Clean up global options
    if ((window as any).parchment_options) delete (window as any).parchment_options;
    // Attempt to cleanup Parchment global instance if it exists
    if ((window as any).parchment) delete (window as any).parchment;
});
</script>

<template>
    <div id="parchment-root" class="parchment-container">
        <!-- 
            Parchment expects specific IDs in the DOM.
            We provide the container structure as per manifest.txt
        -->
        <div id="gameport">
            <div id="windowport">
                <noscript>
                    <p>You'll need to turn on Javascript in your web browser to play this game.</p>
                </noscript>
            </div>
            <div id="loadingpane">
                <!-- Adjust image path to absolute asset path -->
                <img src="/assets/parchment/waiting.gif" alt="LOADING"><br>
                <em>&nbsp;&nbsp;&nbsp;Loading...</em>
            </div>
            <div id="errorpane" style="display:none;">
                <div id="errorcontent">...</div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.parchment-container {
    width: 100%;
    height: 100%;
    position: relative;
    overflow: hidden;
    display: flex;
    flex-direction: column;
}

/* Ensure the gameport takes full size */
#gameport {
    width: 100%;
    height: 100%;
    background-color: #f0f0f0;
    flex: 1;
}
</style>
