<script setup lang="ts">
import { onMounted, onUnmounted, inject } from 'vue';
import { useScriptTag } from '@vueuse/core';
import type { Emitter } from "mitt";
import type { Events } from "@/types/emitter";
import type { SaveSchema } from "@/__generated__";
import { getDownloadPath } from '@/utils';
import type { DetailedRom } from '@/stores/roms';
import '@/assets/parchment-scoped.css';
import { injectSaveHooks, prepareCloudSave } from './utils';

const props = defineProps<{
    rom: DetailedRom;
}>();

const emitter = inject<Emitter<Events>>("emitter");

// Manage global scripts via VueUse
// We need jQuery before Parchment
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

async function loadSave(save: SaveSchema) {
    if (!save) return;
    console.log("[RomM] User requested save load:", save.file_name);
    // Use our utility to inject the specific save
    await prepareCloudSave(props.rom, save);
}

function enterFullscreen() {
    const el = document.getElementById('parchment-root');
    if (el) {
        if (el.requestFullscreen) {
            el.requestFullscreen();
        } else if ((el as any).webkitRequestFullscreen) {
            (el as any).webkitRequestFullscreen();
        } else if ((el as any).msRequestFullscreen) {
            (el as any).msRequestFullscreen();
        }
    }
}

function resetGame() {
    window.location.reload();
}

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

        // Inject hooks before Parchment fully initializes or as soon as possible
        injectSaveHooks(props.rom);

        await parchmentScript.load();

        // Start waiting for Parchment to be ready to inject the cloud save
        prepareCloudSave(props.rom);
    } catch (err) {
        console.error('Error loading Parchment scripts:', err);
    }

    // @ts-ignore
    emitter?.on("saveSelected", loadSave);
});

onUnmounted(() => {
    // Unload scripts to clean up DOM
    jqueryScript.unload();
    parchmentScript.unload();

    // @ts-ignore
    emitter?.off("saveSelected", loadSave);

    // Clean up global options
    if ((window as any).parchment_options) delete (window as any).parchment_options;
    // Attempt to cleanup Parchment global instance if it exists
    if ((window as any).parchment) delete (window as any).parchment;
});
</script>

<template>
    <div id="parchment-root" class="parchment-container">
        <!-- Controls Overlay -->
        <div class="parchment-controls">
            <v-btn icon="mdi-restart" variant="text" color="white" @click="resetGame" title="Reset Game"
                class="control-btn" />
            <v-btn icon="mdi-fullscreen" variant="text" color="white" @click="enterFullscreen" title="Fullscreen"
                class="control-btn" />
        </div>

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

.parchment-controls {
    position: absolute;
    top: 10px;
    right: 10px;
    z-index: 1000;
    display: flex;
    gap: 8px;
    opacity: 0.3;
    transition: opacity 0.3s;
}

.parchment-controls:hover {
    opacity: 1;
}

/* Ensure the gameport takes full size */
#gameport {
    width: 100%;
    height: 100%;
    background-color: #f0f0f0;
    flex: 1;
}
</style>
