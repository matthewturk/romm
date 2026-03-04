<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import { getDownloadPath } from '@/utils';
import type { DetailedRom } from '@/stores/roms';

const props = defineProps<{
    rom: DetailedRom;
}>();

const addedScripts: HTMLScriptElement[] = [];
let addedLink: HTMLLinkElement | null = null;

const loadScript = (src: string): Promise<void> => {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.async = false;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
        document.head.appendChild(script);
        addedScripts.push(script);
    });
};

const loadCSS = (href: string): HTMLLinkElement => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
    return link;
};

// Use defineExpose only if we need to expose methods, otherwise just setup logic
onMounted(async () => {
    // 1. Load CSS
    addedLink = loadCSS('/assets/parchment/parchment.css');

    // 2. Configure Parchment Options
    const romUrl = getDownloadPath({ rom: props.rom });

    // Set global options for Parchment
    (window as any).parchment_options = {
        default_story: [romUrl],
        lib_path: '/assets/parchment/',
        story_name: props.rom.name,
        // auto_launch: true // Default behavior launches the story
    };

    // 3. Load Scripts
    try {
        // jQuery is a dependency for parchment.js
        await loadScript('/assets/parchment/jquery.min.js');
        // Main parchment library
        await loadScript('/assets/parchment/parchment.js');
        // Optional resource map if needed
        // await loadScript('/assets/parchment/resourcemap.js');
    } catch (err) {
        console.error('Error loading Parchment scripts:', err);
    }
});

onUnmounted(() => {
    // Cleanup scripts and styles
    if (addedLink && document.head.contains(addedLink)) {
        document.head.removeChild(addedLink);
    }
    addedScripts.forEach(script => {
        if (document.head.contains(script)) {
            document.head.removeChild(script);
        }
    });

    // Clean up global options
    if ((window as any).parchment_options) delete (window as any).parchment_options;
    // We might want to remove 'parchment' global if it exists, though it might persist
    if ((window as any).parchment) delete (window as any).parchment;
});
</script>

<template>
    <div class="parchment-container">
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
}

/* Ensure the gameport takes full size */
#gameport {
    width: 100%;
    height: 100%;
    background-color: #f0f0f0;
}
</style>
