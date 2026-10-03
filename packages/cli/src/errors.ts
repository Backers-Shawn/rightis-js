/** A failure the CLI reports in one line and exits with `exitCode`. */
export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
    this.name = 'CliError';
  }
}

/** Bad flags or arguments. Exit code 2. */
export class UsageError extends CliError {
  constructor(message: string) {
    super(message, 2);
    this.name = 'UsageError';
  }
}
