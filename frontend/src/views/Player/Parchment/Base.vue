<script setup lang="ts">
import { useLocalStorage } from "@vueuse/core";
import { storeToRefs } from "pinia";
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute } from "vue-router";
import GameCard from "@/components/common/Game/Card/Base.vue";
import { ROUTES } from "@/plugins/router";
import romApi from "@/services/api/rom";
import storeAuth from "@/stores/auth";
import storePlaying from "@/stores/playing";
import { type DetailedRom } from "@/stores/roms";
import Player from "@/views/Player/Parchment/Player.vue";

const { t } = useI18n();
const route = useRoute();
const auth = storeAuth();
const playingStore = storePlaying();
const { playing, fullScreen } = storeToRefs(playingStore);
const rom = ref<DetailedRom | null>(null);
const gameRunning = ref(false);
const fullScreenOnPlay = useLocalStorage("emulation.fullScreenOnPlay", true);

async function onPlay() {
    if (rom.value && auth.scopes.includes("roms.user.write")) {
        romApi.updateUserRomProps({
            romId: rom.value.id,
            data: rom.value.rom_user,
            updateLastPlayed: true,
        });
    }

    gameRunning.value = true;
    fullScreen.value = fullScreenOnPlay.value;
    playing.value = true;
}

function onFullScreenChange() {
    fullScreenOnPlay.value = !fullScreenOnPlay.value;
}

onMounted(async () => {
    const romResponse = await romApi.getRom({
        romId: parseInt(route.params.rom as string),
    });
    rom.value = romResponse.data;

    if (rom.value) {
        document.title = `${rom.value.name} | Play`;
    }
});

onBeforeUnmount(async () => {
    fullScreen.value = false;
    playing.value = false;
});
</script>

<template>
    <v-row v-if="rom" class="align-center justify-center scroll h-100 px-4" no-gutters>
        <v-col v-if="!gameRunning" cols="12" lg="8">
            <v-row class="mt-4" no-gutters>
                <!-- Game Info -->
                <v-col class="game-info-col">
                    <v-container :width="220" class="pa-0 text-wrap text-center mb-6">
                        <GameCard :key="rom.updated_at" :rom="rom" :show-platform-icon="false"
                            :show-action-bar="false" />
                    </v-container>
                </v-col>

                <!-- Configuration & Actions -->
                <v-col class="flex-col pl-4">
                    <v-card variant="flat" rounded="lg" class="mb-6">
                        <v-card-text class="pa-3">
                            <!-- Fullscreen Toggle -->
                            <v-btn block variant="tonal" class="mb-2" :color="fullScreenOnPlay ? 'primary' : ''"
                                @click="onFullScreenChange">
                                <v-icon class="mr-2">
                                    {{
                                        fullScreenOnPlay
                                            ? "mdi-checkbox-outline"
                                            : "mdi-checkbox-blank-outline"
                                    }}
                                </v-icon>
                                {{ t("play.full-screen") }}
                                <v-icon class="ml-auto">
                                    {{
                                        fullScreenOnPlay ? "mdi-fullscreen" : "mdi-fullscreen-exit"
                                    }}
                                </v-icon>
                            </v-btn>

                            <!-- Play Button -->
                            <v-btn block size="large" variant="flat" color="primary" class="mb-3 play-button"
                                prepend-icon="mdi-play-circle" @click="onPlay">
                                <span class="text-h6">{{ t("play.play") }}</span>
                            </v-btn>

                            <!-- Navigation Buttons -->
                            <v-btn block variant="text" size="small" class="mb-2" prepend-icon="mdi-arrow-left" @click="
                                $router.push({
                                    name: ROUTES.ROM,
                                    params: { rom: rom?.id },
                                })
                                ">
                                {{ t("play.back-to-game-details") }}
                            </v-btn>
                        </v-card-text>
                    </v-card>
                </v-col>
            </v-row>
        </v-col>

        <Player v-else-if="rom" :rom="rom" />
    </v-row>
</template>

<style scoped>
.game-info-col {
    display: flex;
    justify-content: center;
}
</style>
