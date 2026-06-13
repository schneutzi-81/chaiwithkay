// main.js — entry point. Loads content, boots the UI, registers the PWA.
import "./styles.css";
import { init } from "./ui.js";
import phrases from "./data/phrases.json";

// vite-plugin-pwa injects this. Auto-updates the offline cache in the background.
import { registerSW } from "virtual:pwa-register";
registerSW({ immediate: true });

init(phrases);
