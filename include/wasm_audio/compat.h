#ifndef GUARD_WASM_AUDIO_COMPAT_H
#define GUARD_WASM_AUDIO_COMPAT_H
// Names the portable sound engine expects from pokeemerald-multiplatform.
#include <stdint.h>
typedef int_fast8_t sf8;
typedef uint_fast8_t uf8;
typedef int_fast16_t sf16;
typedef uint_fast16_t uf16;
#ifndef DBGPRINTF
#define DBGPRINTF(...)
#endif
#endif // GUARD_WASM_AUDIO_COMPAT_H
