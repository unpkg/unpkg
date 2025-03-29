import { type VNode } from "preact";

export function NotFound({ message = "Not Found" }: { message?: string }): VNode {
  return (
    <main class="p-4">
      <h1 class="text-3xl text-center font-bold">{message}</h1>
    </main>
  );
}
