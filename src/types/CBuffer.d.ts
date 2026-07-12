declare module 'CBuffer' {
  export default class CBuffer<T> {
    constructor(size: number);
    length: number;
    push(item: T): void;
    shift(): T | undefined;
    pop(): T | undefined;
    toArray(): T[];
  }
}
