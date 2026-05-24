import type { EmbfProject } from "./types/embf";

export interface DisplayPreset {
    id: string;
    label: string;
    description?: string;
    display: EmbfProject["display"];
}

/** Common embedded panels — used by New Project wizard. */
export const DISPLAY_PRESETS: DisplayPreset[] = [
    {
        id: "custom",
        label: "Custom (320×240 landscape)",
        description: "Default starter size; edit in .embf later",
        display: {
            width: 320,
            height: 240,
            bitDepth: 16,
            colorFormat: "RGB565",
            orientation: "landscape",
            direction: "ltr",
            dpi: 100
        }
    },
    {
        id: "ili9341_240x320",
        label: "240×320 portrait (ILI9341 class)",
        display: {
            width: 240,
            height: 320,
            bitDepth: 16,
            colorFormat: "RGB565",
            orientation: "portrait",
            direction: "ltr",
            dpi: 100
        }
    },
    {
        id: "ili9341_320x240",
        label: "320×240 landscape (ILI9341 rotated)",
        display: {
            width: 320,
            height: 240,
            bitDepth: 16,
            colorFormat: "RGB565",
            orientation: "landscape",
            direction: "ltr",
            dpi: 100
        }
    },
    {
        id: "480x272",
        label: "480×272 landscape (STM32 discovery class)",
        display: {
            width: 480,
            height: 272,
            bitDepth: 16,
            colorFormat: "RGB565",
            orientation: "landscape",
            direction: "ltr",
            dpi: 100
        }
    },
    {
        id: "800x480",
        label: "800×480 landscape (7\" HMI)",
        display: {
            width: 800,
            height: 480,
            bitDepth: 16,
            colorFormat: "RGB565",
            orientation: "landscape",
            direction: "ltr",
            dpi: 100
        }
    },
    {
        id: "128x64_mono",
        label: "128×64 monochrome (SSD1306)",
        display: {
            width: 128,
            height: 64,
            bitDepth: 16,
            colorFormat: "L8",
            orientation: "landscape",
            direction: "ltr",
            dpi: 100
        }
    },
    {
        id: "240x240_round",
        label: "240×240 round (GC9A01)",
        display: {
            width: 240,
            height: 240,
            bitDepth: 16,
            colorFormat: "RGB565",
            orientation: "portrait",
            direction: "ltr",
            dpi: 100,
            round: true
        }
    }
];
