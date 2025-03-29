import { type VNode, h, hydrate } from "preact";

export interface HydrateAttributeData {
  key: string;
  props: any;
}

export type HydrateComponentTable = Record<string, (props: any) => VNode>;

export function hydrateAll(componentTable: HydrateComponentTable): void {
  let hydratableElements = document.querySelectorAll("[data-hydrate]");

  for (let element of hydratableElements) {
    let { key, props } = JSON.parse(element.getAttribute("data-hydrate")!) as HydrateAttributeData;

    let component = componentTable[key];
    if (component == null) {
      throw new Error(`Unknown component: ${key}. Did you forget to add it to StatefulComponents?`);
    }

    hydrate(h(component, props), element);

    // Clean up the data-hydrate attribute to prevent double hydration
    element.removeAttribute("data-hydrate");
  }
}
