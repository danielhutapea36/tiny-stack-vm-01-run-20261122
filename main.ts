// Tiny stack VM, ISA v1 — written from generator/subject/ISA.md in the kit.
// One run answers every instance in MAKEFUN_INPUT_DIR, writing stdout.bin
// and exit.txt per instance under MAKEFUN_OUTPUT_DIR. Deterministic: no
// clock, no environment, no files outside /bot, /input, /output.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const IN = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUT = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Run one bytecode program. Returns [bytes written, exit code]. A trap ends
// the program at once; its code is the exit code and output written before
// the trap is kept.
function exec(p: Buffer, inp: Buffer): [Buffer, number] {
  const mem = new Int32Array(256); // 256 words, all 0
  const s: number[] = []; // data stack, at most 256 values
  const c: number[] = []; // call stack, at most 64 return addresses
  const o: number[] = []; // output bytes, at most 65536
  let pc = 0; // program counter
  let ip = 0; // next input byte
  let n = 0; // instructions executed
  const fail = (code: number): never => { throw code; };
  const pop = (): number => { if (s.length === 0) fail(2); return s.pop() as number; };
  const push = (v: number): void => { if (s.length >= 256) fail(3); s.push(v | 0); };
  const emit = (bs: number[]): void => {
    if (o.length + bs.length > 65536) fail(11);
    for (const b of bs) o.push(b);
  };
  const done = (code: number): [Buffer, number] => [Buffer.from(o), code];
  try {
    for (;;) {
      if (n >= 1000000) fail(10); // step limit
      if (pc < 0 || pc >= p.length) fail(9); // pc outside program
      const op = p[pc];
      // Immediate must fit before the program ends, else trap 9.
      const need = (k: number): void => { if (pc + 1 + k > p.length) fail(9); };
      const u16 = (): number => p[pc + 1] | (p[pc + 2] << 8);
      const s16 = (): number => { const v = u16(); return v >= 32768 ? v - 65536 : v; };
      n++;
      switch (op) {
        case 0x00: return done(0); // HALT
        case 0x01: need(1); { const v = p[pc + 1]; push(v >= 128 ? v - 256 : v); pc += 2; break; } // PUSH8, sign-extended
        case 0x02: need(4); push(p.readInt32LE(pc + 1)); pc += 5; break; // PUSH32
        case 0x03: pop(); pc += 1; break; // POP
        case 0x04: { const a = pop(); push(a); push(a); pc += 1; break; } // DUP
        case 0x05: { const b = pop(); const a = pop(); push(b); push(a); pc += 1; break; } // SWAP
        case 0x06: { const b = pop(); const a = pop(); push(a); push(b); push(a); pc += 1; break; } // OVER
        case 0x07: { const d = pop(); const b = pop(); const a = pop(); push(b); push(d); push(a); pc += 1; break; } // ROT
        case 0x10: { const b = pop(); const a = pop(); push(a + b); pc += 1; break; } // ADD, wraps via push |0
        case 0x11: { const b = pop(); const a = pop(); push(a - b); pc += 1; break; } // SUB
        case 0x12: { const b = pop(); const a = pop(); push(Math.imul(a, b)); pc += 1; break; } // MUL, low 32 bits
        case 0x13: { const b = pop(); const a = pop(); if (b === 0) fail(4); push(a === -2147483648 && b === -1 ? -2147483648 : Math.trunc(a / b)); pc += 1; break; } // DIV, trunc toward zero
        case 0x14: { const b = pop(); const a = pop(); if (b === 0) fail(4); push(b === -1 ? 0 : a % b); pc += 1; break; } // MOD, sign of a
        case 0x15: { const b = pop(); const a = pop(); if (b === 0) fail(4); push(Math.trunc((a >>> 0) / (b >>> 0))); pc += 1; break; } // DIVU
        case 0x16: { const b = pop(); const a = pop(); if (b === 0) fail(4); push((a >>> 0) % (b >>> 0)); pc += 1; break; } // MODU
        case 0x17: { const a = pop(); push(-a); pc += 1; break; } // NEG, wraps
        case 0x18: { const b = pop(); const a = pop(); push(a & b); pc += 1; break; } // AND
        case 0x19: { const b = pop(); const a = pop(); push(a | b); pc += 1; break; } // OR
        case 0x1a: { const b = pop(); const a = pop(); push(a ^ b); pc += 1; break; } // XOR
        case 0x1b: { const a = pop(); push(~a); pc += 1; break; } // NOT
        case 0x1c: { const b = pop(); const a = pop(); push(a << (b & 31)); pc += 1; break; } // SHL, low 5 bits of count
        case 0x1d: { const b = pop(); const a = pop(); push(a >> (b & 31)); pc += 1; break; } // SHR, arithmetic
        case 0x1e: { const b = pop(); const a = pop(); push((a >>> (b & 31)) | 0); pc += 1; break; } // SHRU, logical
        case 0x20: { const b = pop(); const a = pop(); push(a === b ? 1 : 0); pc += 1; break; } // EQ
        case 0x21: { const b = pop(); const a = pop(); push(a < b ? 1 : 0); pc += 1; break; } // LT, signed
        case 0x22: { const b = pop(); const a = pop(); push((a >>> 0) < (b >>> 0) ? 1 : 0); pc += 1; break; } // LTU, unsigned
        case 0x30: need(2); pc = pc + 3 + s16(); break; // JMP, offset from next instruction
        case 0x31: need(2); { const v = pop(); pc = v === 0 ? pc + 3 + s16() : pc + 3; break; } // JZ
        case 0x32: need(2); { const v = pop(); pc = v !== 0 ? pc + 3 + s16() : pc + 3; break; } // JNZ
        case 0x33: need(2); { if (c.length >= 64) fail(7); c.push(pc + 3); pc = u16(); break; } // CALL
        case 0x34: { if (c.length === 0) fail(8); pc = c.pop() as number; break; } // RET
        case 0x40: { const a = pop(); if (a < 0 || a > 255) fail(6); push(mem[a]); pc += 1; break; } // LOAD
        case 0x41: { const a = pop(); const v = pop(); if (a < 0 || a > 255) fail(6); mem[a] = v; pc += 1; break; } // STORE
        case 0x50: { const v = pop(); emit(Array.from(Buffer.from(String(v), 'ascii'))); pc += 1; break; } // PRINT, decimal ASCII
        case 0x51: { const v = pop(); emit([v & 255]); pc += 1; break; } // PUTC
        case 0x52: push(ip < inp.length ? inp[ip++] : -1); pc += 1; break; // IN, -1 once input is used up
        case 0x53: { const v = pop(); return done(v & 255); } // EXIT, low byte
        default: fail(5); // unknown opcode
      }
    }
  } catch (e) {
    if (typeof e === 'number') return done(e);
    throw e;
  }
}

for (const id of readdirSync(IN).sort()) {
  const prog = readFileSync(join(IN, id, 'program.bin'));
  let inp = Buffer.alloc(0);
  try { inp = readFileSync(join(IN, id, 'input.bin')); } catch { /* no input file: empty input */ }
  const [out, code] = exec(prog, inp);
  mkdirSync(join(OUT, id), { recursive: true });
  writeFileSync(join(OUT, id, 'stdout.bin'), out);
  writeFileSync(join(OUT, id, 'exit.txt'), String(code) + '\n');
}
