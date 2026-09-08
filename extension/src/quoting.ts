/** Execute CLI arguments without invoking a command shell. */
import * as child_process from 'child_process';

export function executeCli(
    command: string,
    args: string[],
    options?: child_process.SpawnOptions
): child_process.ChildProcess {
    return child_process.spawn(command, args, {
        ...options,
        shell: false,
    });
}
