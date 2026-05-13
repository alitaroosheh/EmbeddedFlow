/**
 * EmbeddedFlow LVGL configuration.
 * Minimal config for the WASM simulator runtime.
 */

#ifndef LV_CONF_H
#define LV_CONF_H

#include <stdint.h>

/* ── Color depth ──────────────────────────────────────────────────────── */
#define LV_COLOR_DEPTH 32  /* Use 32-bit (ARGB8888) internally */

/* ── Memory ───────────────────────────────────────────────────────────── */
#define LV_MEM_SIZE           (512U * 1024U)  /* 512 KB heap for LVGL */
#define LV_MEM_POOL_INCLUDE   <stdlib.h>
#define LV_MEM_POOL_ALLOC     malloc
#define LV_MEM_POOL_FREE      free

/* ── HAL ──────────────────────────────────────────────────────────────── */
#define LV_TICK_CUSTOM           1
#define LV_TICK_CUSTOM_INCLUDE   <emscripten.h>
#define LV_TICK_CUSTOM_SYS_TIME_EXPR  ((uint32_t)emscripten_get_now())

/* ── Display ──────────────────────────────────────────────────────────── */
#define LV_HOR_RES_MAX  800
#define LV_VER_RES_MAX  600

/* ── Built-in fonts ───────────────────────────────────────────────────── */
#define LV_FONT_MONTSERRAT_8   0
#define LV_FONT_MONTSERRAT_10  0
#define LV_FONT_MONTSERRAT_12  1
#define LV_FONT_MONTSERRAT_14  1
#define LV_FONT_MONTSERRAT_16  1
#define LV_FONT_MONTSERRAT_18  1
#define LV_FONT_MONTSERRAT_20  1
#define LV_FONT_MONTSERRAT_22  0
#define LV_FONT_MONTSERRAT_24  1
#define LV_FONT_MONTSERRAT_26  0
#define LV_FONT_MONTSERRAT_28  0
#define LV_FONT_MONTSERRAT_30  0
#define LV_FONT_MONTSERRAT_32  1
#define LV_FONT_MONTSERRAT_34  0
#define LV_FONT_MONTSERRAT_36  0
#define LV_FONT_MONTSERRAT_38  0
#define LV_FONT_MONTSERRAT_40  0
#define LV_FONT_MONTSERRAT_42  0
#define LV_FONT_MONTSERRAT_44  0
#define LV_FONT_MONTSERRAT_46  0
#define LV_FONT_MONTSERRAT_48  1
#define LV_FONT_DEFAULT        &lv_font_montserrat_14

/* ── Widgets ──────────────────────────────────────────────────────────── */
#define LV_USE_ARC        1
#define LV_USE_BAR        1
#define LV_USE_BUTTON     1
#define LV_USE_CHECKBOX   1
#define LV_USE_DROPDOWN   1
#define LV_USE_IMAGE      1
#define LV_USE_LABEL      1
#define LV_USE_LINE       1
#define LV_USE_ROLLER     1
#define LV_USE_SLIDER     1
#define LV_USE_SWITCH     1
#define LV_USE_TEXTAREA   1
#define LV_USE_SPINNER    1
#define LV_USE_TABLE      0
#define LV_USE_CHART      0

/* ── Theme ────────────────────────────────────────────────────────────── */
#define LV_USE_THEME_DEFAULT  1
#define LV_USE_THEME_SIMPLE   1
#define LV_USE_THEME_MONO     0

/* ── Misc ─────────────────────────────────────────────────────────────── */
#define LV_USE_PERF_MONITOR  0
#define LV_USE_LOG           0
#define LV_USE_ASSERT_NULL          1
#define LV_USE_ASSERT_MALLOC        1
#define LV_USE_ASSERT_STYLE         0
#define LV_USE_ASSERT_MEM_INTEGRITY 0
#define LV_USE_ASSERT_OBJ           0

#endif /* LV_CONF_H */
