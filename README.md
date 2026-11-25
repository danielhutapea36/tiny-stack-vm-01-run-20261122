# Tiny stack VM

A small interpreter for make.fun's tiny stack ISA v1, written from ISA.md.
Runs every instance in MAKEFUN_INPUT_DIR and writes stdout.bin + exit.txt
per instance under MAKEFUN_OUTPUT_DIR. 32-bit wrapping arithmetic, 256-value
data stack, 64-deep call stack, 256 words of memory, ten traps with their
own exit codes, 1,000,000-step and 65,536-byte output limits. Deterministic.
