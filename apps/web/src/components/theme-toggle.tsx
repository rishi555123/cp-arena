"use client";

import { Moon, Sun } from "lucide-react";

export function ThemeToggle() {
  function toggle() {
    const light = document.documentElement.classList.toggle("light");
    document.cookie = `theme=${light ? "light" : "dark"}; path=/; max-age=31536000; samesite=lax`;
  }
  return (
    <button onClick={toggle} className="rounded-md p-2 hover:bg-accent" aria-label="Toggle light/dark mode" title="Toggle light/dark mode">
      <Sun className="hidden size-4 [.light_&]:block" aria-hidden />
      <Moon className="size-4 [.light_&]:hidden" aria-hidden />
    </button>
  );
}
