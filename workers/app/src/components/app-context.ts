import { createContext } from "preact";
import { useContext } from "preact/hooks";

import { type Context, ContextProvider } from "../context.ts";

export const AppContext = createContext(new ContextProvider());

export function getContext<T>(context: Context<T>): T {
  return useContext(AppContext).get(context);
}
