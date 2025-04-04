import { createContext } from "preact";

import type { HrefBuilder } from "./href-builder.ts";

export const HrefsContext = createContext<HrefBuilder | null>(null);
