import { spawn } from 'node:child_process';

/**
 * Opens a URL in the default browser. Resolves false when no opener could be
 * started; the caller prints the URL either way.
 */
export function openBrowser(url: string): Promise<boolean> {
  let cmd: string;
  let args: string[];
  if (process.platform === 'darwin') {
    cmd = 'open';
    args = [url];
  } else if (process.platform === 'win32') {
    // Not `cmd /c start`: cmd would treat & in the query string as a command separator.
    cmd = 'rundll32';
    args = ['url.dll,FileProtocolHandler', url];
  } else {
    cmd = 'xdg-open';
    args = [url];
  }
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
      child.once('error', () => resolve(false));
      child.once('spawn', () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}
