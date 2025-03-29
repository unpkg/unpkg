import { createContext } from "preact";

import type { AssetsManifest } from "./assets-manifest.ts";

export const AssetsContext = createContext(new Map() as AssetsManifest);
