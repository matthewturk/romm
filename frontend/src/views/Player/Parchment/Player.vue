<script setup lang="ts">
import { onMounted, onUnmounted, inject } from 'vue';
import { useScriptTag } from '@vueuse/core';
import type { Emitter } from "mitt";
import type { Events } from "@/types/emitter";
import type { SaveSchema } from "@/__generated__";
import api from '@/services/api';
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

const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    const chunkSize = 0x8000; // 32KB chunks to avoid stack overflow
    for (let i = 0; i < len; i += chunkSize) {
        // @ts-ignore
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return window.btoa(binary);
};

let objectUrl: string | null = null;

onMounted(async () => {
    // Configure Parchment Options
    let romUrl = getDownloadPath({ rom: props.rom });
    // Add emulator=parchment to force direct file serving from backend
    // This is required to get the raw file content instead of an X-Accel-Redirect 
    // when running in dev mode without Nginx, and ensures consistent behavior.
    if (romUrl.includes('?')) {
        romUrl += '&emulator=parchment';
    } else {
        romUrl += '?emulator=parchment';
    }

    let storyPath = romUrl;

    try {
        console.log('[RomM] Fetching ROM from:', romUrl);
        // Fetch the ROM via API client (Axios) to ensure authentication headers are included.
        // We strip /api context because the API client adds it automatically.
        const axiosUrl = romUrl.replace(/^\/api/, '');
        const response = await api.get(axiosUrl, {
            responseType: 'arraybuffer',
            // Ensure we don't follow redirects automatically if we want to catch 302/403 (Axios usually handles this)
        });

        console.log('[RomM] Response status:', response.status);

        if (response.status === 200) {
            const contentType = response.headers['content-type'] || response.headers['Content-Type'];
            if (contentType && (contentType.includes('application/json') || contentType.includes('text/html'))) {
                console.error('[RomM] Invalid content type for ROM:', contentType);
                // If it's JSON, try to read it to show the error
                if (contentType.includes('application/json')) {
                    const dec = new TextDecoder();
                    console.error('[RomM] Response body:', dec.decode(response.data));
                }
                throw new Error('Invalid content type: ' + contentType);
            }

            // Convert to Base64 and wrap in JSONP callback to satisfy Parchment loader
            const buffer = response.data;
            const base64 = arrayBufferToBase64(buffer);
            const wrapped = `processBase64Zcode('${base64}')`;

            // Create Blob as JS file
            const blob = new Blob([wrapped], { type: 'text/javascript' });
            objectUrl = URL.createObjectURL(blob);

            // Append filename fragment to help Parchment identify the file type
            // Force .z5 extension if not present, to avoid Parchment treating it as JS
            let filename = props.rom.fs_name || 'game.z5';
            if (!filename.match(/\.(z[1-8]|zblorb|blb|ulx|gblorb|glulx)$/i)) {
                filename += '.z5';
            }
            storyPath = objectUrl + '#' + filename;
        } else {
            console.error('[RomM] Fetch failed:', response.status);
        }
    } catch (e) {
        console.error("Failed to fetch ROM as Blob via API", e);
    }

    // Set global options for Parchment
    // We attach to window as required by the library
    (window as any).parchment_options = {
        default_story: [storyPath],
        lib_path: '/assets/parchment/',
        story_name: props.rom.name,
    };

    // Load Scripts Sequentially
    try {
        await jqueryScript.load();

        console.log('[RomM] Parchment story path:', storyPath);

        // Inject hooks before Parchment fully initializes or as soon as possible
        // injectSaveHooks(props.rom);

        await parchmentScript.load();

        // Start waiting for Parchment to be ready to inject the cloud save
        // prepareCloudSave(props.rom);
    } catch (err) {
        console.error('Error loading Parchment scripts:', err);
    }

    // @ts-ignore
    emitter?.on("saveSelected", loadSave);
});

onUnmounted(() => {
    // Revoke object URL
    if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
    }
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
    bottom: 10px;
    right: 10px;
    z-index: 1000;
    display: flex;
    gap: 8px;
    opacity: 0.3;
    transition: opacity 0.3s;
    background-color: rgba(0, 0, 0, 0.5);
    padding: 5px;
    border-radius: 5px;
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
