import { processIo } from './io.js';
import { main } from './main.js';

main(process.argv.slice(2), processIo()).then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    process.stderr.write(`Error: ${(e as Error)?.message ?? String(e)}\n`);
    process.exitCode = 1;
  },
);
