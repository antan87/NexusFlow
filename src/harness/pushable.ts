export class Pushable<T> implements AsyncIterable<T> {
  private buffer: T[] = [];
  private waiters: Array<(r: IteratorResult<T>) => void> = [];
  private done = false;

  push(value: T): void {
    if (this.done) return;
    const w = this.waiters.shift();
    if (w) w({ value, done: false });
    else this.buffer.push(value);
  }

  end(): void {
    this.done = true;
    for (const w of this.waiters.splice(0)) w({ value: undefined, done: true });
  }

  [Symbol.asyncIterator]() {
    return {
      next: (): Promise<IteratorResult<T>> =>
        this.buffer.length > 0
          ? Promise.resolve({ value: this.buffer.shift()!, done: false })
          : this.done
            ? Promise.resolve({ value: undefined, done: true })
            : new Promise((res) => this.waiters.push(res)),
    };
  }
}
