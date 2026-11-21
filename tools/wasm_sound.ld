/* Links the game's sound data for the web build at a fixed address. The
   pointers inside it (songs -> tracks, instruments -> samples) are absolute,
   so web/app.js must copy sound.bin to exactly this address. */
SECTIONS
{
    . = 0x09000000;
    .rodata : { *(.rodata) *(.rodata.*) *(.data) *(.text) }
    /DISCARD/ : { *(.bss) *(.comment) *(.ARM.attributes) }
}
