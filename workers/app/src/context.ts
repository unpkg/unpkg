export interface Context<T = unknown> {
  defaultValue?: T;
}

export function createContext<T>(defaultValue?: T): Context<T> {
  return { defaultValue };
}

export type ContextProviderInit = Iterable<[Context<any>, any]>;

export class ContextProvider {
  #map = new Map<Context<any>, any>();

  constructor(init?: ContextProviderInit) {
    if (init) {
      for (let [context, value] of init) {
        this.set(context, value);
      }
    }
  }

  get<T>(context: Context<T>): T {
    if (this.#map.has(context)) {
      return this.#map.get(context);
    }

    if (context.defaultValue !== undefined) {
      return context.defaultValue;
    }

    throw new Error("No value found for context");
  }

  set<C extends Context>(context: C, value: C extends Context<infer T> ? T : never): void {
    this.#map.set(context, value);
  }
}
