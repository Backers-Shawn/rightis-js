import type { OptionSpec, ParsedArgs } from '../args.js';
import type { Io } from '../io.js';

export interface Command {
  name: string;
  summary: string;
  help: string;
  options: OptionSpec;
  run(io: Io, args: ParsedArgs): Promise<number>;
}
