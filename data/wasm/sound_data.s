@ Sound data for the web build. Same as data/sound_data.s, except the music
@ player table: it points at RAM structures, so the web build defines it in C
@ (src/m4a.c). Linked at WASM_SOUND_BASE by tools/wasm_sound.ld.
	.section .rodata

	.include "asm/macros/m4a.inc"
	.include "asm/macros/music_voice.inc"

	.include "sound/voice_groups.inc"
	.include "sound/keysplit_tables.inc"
	.include "sound/programmable_wave_data.inc"
	.include "sound/song_table.inc"
	.include "sound/direct_sound_data.inc"

	.align 2
