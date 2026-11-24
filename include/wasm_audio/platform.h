#ifndef GUARD_WASM_AUDIO_PLATFORM_H
#define GUARD_WASM_AUDIO_PLATFORM_H

#include "gba/types.h"

// Called once per frame by the sound engine with interleaved stereo floats.
void Platform_QueueAudio(float *audioBuffer, u32 bufferSizeBytes);

#endif // GUARD_WASM_AUDIO_PLATFORM_H
