#if WASM
// Hands the sound engine's output to the browser. Each frame the engine
// produces 800 stereo samples (48 kHz at 60 frames per second). They go into
// a ring buffer that web/app.js drains after running frames and forwards to
// an AudioWorklet.
#include "global.h"
#include "wasm_audio/platform.h"

#define WASM_AUDIO_RING_FLOATS (48000 * 2) // one second of stereo

static float sAudioRing[WASM_AUDIO_RING_FLOATS];
static u32 sAudioWritten; // total floats ever written (wraps at 2^32)

void Platform_QueueAudio(float *audioBuffer, u32 bufferSizeBytes)
{
    u32 count = bufferSizeBytes / sizeof(float);
    u32 i;

    for (i = 0; i < count; i++)
        sAudioRing[(sAudioWritten + i) % WASM_AUDIO_RING_FLOATS] = audioBuffer[i];
    sAudioWritten += count;
}

float *WasmAudioRing(void)
{
    return sAudioRing;
}

u32 WasmAudioRingFloats(void)
{
    return WASM_AUDIO_RING_FLOATS;
}

u32 WasmAudioWritten(void)
{
    return sAudioWritten;
}

// Sound data (songs, instruments, samples, cries) is linked separately at a
// fixed address and copied into memory by web/app.js before the game starts.
#include "wasm_sound_syms.h"

u32 WasmSoundBlobBase(void)
{
    return WASM_SOUND_BASE;
}
#endif // WASM
