import { type VNode } from "preact";
import { useState, useEffect } from "preact/hooks";

export function HomeNav({ items }: { items: Record<string, string> }): VNode {
  let [currentSectionId, setCurrentSectionId] = useState<string | null>(null);

  useEffect(() => {
    function handleScroll() {
      let sections = document.querySelectorAll("main section");
      let currentSectionId: string | undefined;

      let lastSection = sections[sections.length - 1];
      if (lastSection != null && window.scrollY + window.innerHeight >= document.body.scrollHeight - 50) {
        // Quick check to see if the window is scrolled close to the bottom. If so, just select the last section.
        currentSectionId = lastSection.id;
      } else {
        // Otherwise, find the first section whose header is close to the top of the window.
        for (let section of sections) {
          let rect = section.getBoundingClientRect();

          if (rect.top < 120 && rect.bottom > 40) {
            currentSectionId = section.id;
            break;
          }
        }

        // If we didn't find one, default to the first section.
        if (currentSectionId == null) {
          currentSectionId = sections[0]?.id;
        }
      }

      setCurrentSectionId(currentSectionId);
    }

    // Call it manually once up front
    handleScroll();

    document.addEventListener("scroll", handleScroll);

    return () => document.removeEventListener("scroll", handleScroll);
  }, []);

  let markerTop = 0;
  if (currentSectionId != null) {
    let navItem = document.getElementById(`${currentSectionId}-nav-item`)!;
    markerTop = navItem.offsetTop;
  }

  return (
    <nav class="relative border-l-1 border-gray-300 text-slate-600">
      <div class="absolute w-1 h-6.5 transition-all duration-300 bg-gray-600" style={{ top: markerTop }} />
      <ol>
        {Object.entries(items).map(([id, title]) => (
          <li id={`${id}-nav-item`} class={id === currentSectionId ? "my-2 pl-8 text-slate-900" : "my-2 pl-8"}>
            <a href={`#${id}`}>{title}</a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
