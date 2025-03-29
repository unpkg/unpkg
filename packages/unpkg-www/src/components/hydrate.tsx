import { type VNode, cloneElement } from "preact";

import { type HydrateAttributeData } from "../hydration.ts";

export function Hydrate({
  children,
  container = <div />,
}: {
  children: VNode<any>;
  container?: VNode<any>;
}): VNode<any> {
  let data: HydrateAttributeData = {
    key: typeof children.type === "string" ? children.type : children.type.name,
    props: children.props,
  };

  return cloneElement(container, {
    children,
    "data-hydrate": JSON.stringify(data),
  });
}
