/**
 * EmbeddedFlow lv_conf.h for LVGL v9.5.0 — Emscripten WASM target
 * Place this file next to the lvgl/ folder.
 */

/* clang-format off */
#if 1 /* enabled */

#ifndef LV_CONF_H
#define LV_CONF_H

/* ── Color depth ──────────────────────────────────────────────────────── */
#define LV_COLOR_DEPTH 32  /* 32 = XRGB8888 / ARGB8888 */

/* ── Memory: use system malloc (Emscripten provides it) ───────────────── */
#define LV_USE_STDLIB_MALLOC    LV_STDLIB_CLIB
#define LV_USE_STDLIB_STRING    LV_STDLIB_CLIB
#define LV_USE_STDLIB_SPRINTF   LV_STDLIB_CLIB

#define LV_STDINT_INCLUDE    <stdint.h>
#define LV_STDDEF_INCLUDE    <stddef.h>
#define LV_STDBOOL_INCLUDE   <stdbool.h>
#define LV_INTTYPES_INCLUDE  <inttypes.h>
#define LV_LIMITS_INCLUDE    <limits.h>
#define LV_STDARG_INCLUDE    <stdarg.h>

/* ── HAL ──────────────────────────────────────────────────────────────── */
#define LV_DEF_REFR_PERIOD  16   /* ~60 fps */
#define LV_DPI_DEF          130

/* ── OS: none (single-threaded Emscripten) ────────────────────────────── */
#define LV_USE_OS   LV_OS_NONE

/* ── Rendering ────────────────────────────────────────────────────────── */
#define LV_DRAW_BUF_STRIDE_ALIGN    1
#define LV_DRAW_BUF_ALIGN           4
#define LV_DRAW_TRANSFORM_USE_MATRIX 0
#define LV_DRAW_LAYER_SIMPLE_BUF_SIZE (24 * 1024)
#define LV_DRAW_LAYER_MAX_MEMORY    0
#define LV_DRAW_THREAD_STACK_SIZE   (8 * 1024)
#define LV_DRAW_THREAD_PRIO         LV_THREAD_PRIO_HIGH

#define LV_USE_DRAW_SW  1
#if LV_USE_DRAW_SW
    #define LV_DRAW_SW_SUPPORT_RGB565       1
    #define LV_DRAW_SW_SUPPORT_RGB565_SWAPPED 0
    #define LV_DRAW_SW_SUPPORT_RGB565A8     1
    #define LV_DRAW_SW_SUPPORT_RGB888       1
    #define LV_DRAW_SW_SUPPORT_XRGB8888     1
    #define LV_DRAW_SW_SUPPORT_ARGB8888     1
    #define LV_DRAW_SW_SUPPORT_ARGB8888_PREMULTIPLIED 0
    #define LV_DRAW_SW_SUPPORT_L8           1
    #define LV_DRAW_SW_SUPPORT_AL88         1
    #define LV_DRAW_SW_SUPPORT_A8           1
    #define LV_DRAW_SW_SUPPORT_I1           0
    #define LV_DRAW_SW_I1_LUM_THRESHOLD     127
    #define LV_DRAW_SW_DRAW_UNIT_CNT        1
    #define LV_USE_DRAW_ARM2D_SYNC          0
    #define LV_USE_NATIVE_HELIUM_ASM        0
    #define LV_DRAW_SW_COMPLEX              1
    #if LV_DRAW_SW_COMPLEX
        #define LV_DRAW_SW_SHADOW_CACHE_SIZE  4
        #define LV_DRAW_SW_CIRCLE_CACHE_SIZE  4
    #endif
#endif

#define LV_USE_DRAW_VG_LITE  0
#define LV_USE_DRAW_PXP      0
#define LV_USE_DRAW_DAVE2D   0
#define LV_USE_DRAW_SDL      0
#define LV_USE_DRAW_OPENGLES 0

/* ── GPU ──────────────────────────────────────────────────────────────── */
#define LV_USE_GPU_NXP_VG_LITE   0
#define LV_USE_GPU_NXP_PXP       0
#define LV_USE_GPU_STM32_DMA2D   0
#define LV_USE_GPU_SWM341_DMA2D  0
#define LV_USE_GPU_RENESAS_DAVE2D 0

/* ── Rotate/Mirror (display driver) ──────────────────────────────────── */
#define LV_USE_ROTATION             1

/* ── Image decoders ───────────────────────────────────────────────────── */
#define LV_USE_BMP      0
#define LV_USE_TJPGD    0
#define LV_USE_LIBJPEG_TURBO 0
#define LV_USE_GIF      0
#define LV_USE_PNG      0
#define LV_USE_QRCODE   1
#define LV_USE_BARCODE  0
#define LV_USE_LOTTIE   0
#define LV_USE_FFMPEG   0
#define LV_USE_LODEPNG  0

/* ── Fonts ────────────────────────────────────────────────────────────── */
#define LV_FONT_MONTSERRAT_8    0
#define LV_FONT_MONTSERRAT_10   0
#define LV_FONT_MONTSERRAT_12   1
#define LV_FONT_MONTSERRAT_14   1
#define LV_FONT_MONTSERRAT_16   1
#define LV_FONT_MONTSERRAT_18   1
#define LV_FONT_MONTSERRAT_20   1
#define LV_FONT_MONTSERRAT_22   0
#define LV_FONT_MONTSERRAT_24   1
#define LV_FONT_MONTSERRAT_26   0
#define LV_FONT_MONTSERRAT_28   0
#define LV_FONT_MONTSERRAT_30   0
#define LV_FONT_MONTSERRAT_32   1
#define LV_FONT_MONTSERRAT_34   0
#define LV_FONT_MONTSERRAT_36   0
#define LV_FONT_MONTSERRAT_38   0
#define LV_FONT_MONTSERRAT_40   0
#define LV_FONT_MONTSERRAT_42   0
#define LV_FONT_MONTSERRAT_44   0
#define LV_FONT_MONTSERRAT_46   0
#define LV_FONT_MONTSERRAT_48   1

#define LV_FONT_DEJAVU_16_PERSIAN_HEBREW  0
#define LV_FONT_SIMSUN_14_CJK            0
#define LV_FONT_SIMSUN_16_CJK            0
#define LV_FONT_UNSCII_8    0
#define LV_FONT_UNSCII_16   0

#define LV_FONT_CUSTOM_DECLARE   /* nothing */
#define LV_FONT_DEFAULT &lv_font_montserrat_14

#define LV_FONT_FMT_TXT_LARGE   0
#define LV_USE_FONT_SUBPX       0
#define LV_USE_FONT_PLACEHOLDER 1

/* ── Text ─────────────────────────────────────────────────────────────── */
#define LV_TXT_ENC LV_TXT_ENC_UTF8
#define LV_TXT_BREAK_CHARS " ,.;:-_)]}"
#define LV_TXT_LINE_BREAK_LONG_LEN          0
#define LV_TXT_LINE_BREAK_LONG_PRE_MIN_LEN  3
#define LV_TXT_LINE_BREAK_LONG_POST_MIN_LEN 3
#define LV_TXT_COLOR_CMD "#"
#define LV_USE_BIDI         0
#define LV_USE_ARABIC_PERSIAN_CHARS 0

/* ── Widgets ──────────────────────────────────────────────────────────── */
#define LV_USE_ANIMIMG      1
#define LV_USE_ARC          1
#define LV_USE_BAR          1
#define LV_USE_BUTTON       1
#define LV_USE_BUTTONMATRIX 1
#define LV_USE_CALENDAR     1
#if LV_USE_CALENDAR
    #define LV_CALENDAR_WEEK_STARTS_MONDAY 0
    #define LV_CALENDAR_DEFAULT_DAY_NAMES {"Su","Mo","Tu","We","Th","Fr","Sa"}
    #define LV_CALENDAR_DEFAULT_MONTH_NAMES {"Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"}
    #define LV_USE_CALENDAR_HEADER_ARROW  1
    #define LV_USE_CALENDAR_HEADER_DROPDOWN 1
    #define LV_USE_CALENDAR_CHINESE       0
#endif
#define LV_USE_CANVAS       1
#define LV_USE_CHART        1
#define LV_USE_CHECKBOX     1
#define LV_USE_COLORWHEEL   1
#define LV_USE_DROPDOWN     1
#define LV_USE_IMAGE        1
#define LV_USE_IMAGEBUTTON  1
#define LV_USE_KEYBOARD     1
#define LV_USE_LABEL        1
#if LV_USE_LABEL
    #define LV_LABEL_TEXT_SELECTION 1
    #define LV_LABEL_LONG_TXT_HINT  1
    #define LV_LABEL_WAIT_CHAR_COUNT 3
#endif
#define LV_USE_LED          1
#define LV_USE_LINE         1
#define LV_USE_LIST         1
#define LV_USE_LOTTIE       0
#define LV_USE_MENU         1
#define LV_USE_MSGBOX       1
#define LV_USE_ROLLER       1
#if LV_USE_ROLLER
    #define LV_ROLLER_INF_PAGES 7
#endif
#define LV_USE_SCALE        1
#define LV_USE_SLIDER       1
#define LV_USE_SPAN         1
#if LV_USE_SPAN
    #define LV_SPAN_SNIPPET_STACK_SIZE 64
#endif
#define LV_USE_SPINBOX      1
#define LV_USE_SPINNER      1
#define LV_USE_SWITCH       1
#define LV_USE_TABLE        1
#define LV_USE_TABVIEW      1
#define LV_USE_TEXTAREA     1
#if LV_USE_TEXTAREA
    #define LV_TEXTAREA_DEF_PWD_SHOW_TIME 1500
#endif
#define LV_USE_TILEVIEW     1
#define LV_USE_WIN          1
#define LV_USE_METER        0   /* deprecated in v9.3, use lv_scale instead */
#define LV_USE_QRCODE       1

/* ── Themes ───────────────────────────────────────────────────────────── */
#define LV_USE_THEME_DEFAULT 1
#if LV_USE_THEME_DEFAULT
    #define LV_THEME_DEFAULT_DARK 0
    #define LV_THEME_DEFAULT_GROW 1
    #define LV_THEME_DEFAULT_TRANSITION_TIME 80
#endif
#define LV_USE_THEME_SIMPLE  1
#define LV_USE_THEME_MONO    1

/* ── Layouts ──────────────────────────────────────────────────────────── */
#define LV_USE_FLEX  1
#define LV_USE_GRID  1

/* ── 3rd party libs ───────────────────────────────────────────────────── */
#define LV_USE_FREETYPE  0
#define LV_USE_THORVG    0
#define LV_USE_LZ4       0
#define LV_USE_LIBPNG    0
#define LV_USE_LIBJPEG_TURBO 0
#define LV_USE_FFMPEG    0

/* ── Others ───────────────────────────────────────────────────────────── */
#define LV_USE_SNAPSHOT     1
#define LV_USE_MONKEY       0
#define LV_USE_GRIDNAV      1
#define LV_USE_FRAGMENT     0
#define LV_USE_IMGFONT      0
#define LV_USE_OBSERVER     1
#define LV_USE_IME_PINYIN   0
#define LV_USE_FILE_EXPLORER 0
#define LV_USE_FFMPEG        0

/* ── Drivers (disable all — we provide our own HAL) ──────────────────── */
#define LV_USE_LINUX_FBDEV    0
#define LV_USE_LINUX_DRM      0
#define LV_USE_SDL            0
#define LV_USE_OPENGLES       0
#define LV_USE_X11            0
#define LV_USE_WINDOWS        0
#define LV_USE_NUTTX          0
#define LV_USE_ST_LTDC        0

/* ── Log ──────────────────────────────────────────────────────────────── */
#define LV_USE_LOG      0
/* LV_LOG_LEVEL is set by lv_conf_internal.h when LV_USE_LOG=0; do not redefine */

/* ── Assertions ───────────────────────────────────────────────────────── */
#define LV_USE_ASSERT_NULL          1
#define LV_USE_ASSERT_MALLOC        1
#define LV_USE_ASSERT_STYLE         0
#define LV_USE_ASSERT_MEM_INTEGRITY 0
#define LV_USE_ASSERT_OBJ           0

/* ── Debug / Perf ─────────────────────────────────────────────────────── */
#define LV_USE_PERF_MONITOR 0
#define LV_USE_MEM_MONITOR  0
#define LV_USE_REFR_DEBUG   0
#define LV_USE_SYSMON       0

/* ── Misc ─────────────────────────────────────────────────────────────── */
#define LV_SPRINTF_CUSTOM   0
#define LV_USE_USER_DATA    1
#define LV_ENABLE_GC        0
#define LV_ATTRIBUTE_FAST_MEM   /* nothing */
#define LV_ATTRIBUTE_TIMER_HANDLER  /* nothing */
#define LV_ATTRIBUTE_FLUSH_READY    /* nothing */
#define LV_EXPORT_CONST_INT(int_value) struct _silence_gcc_warning
#define LV_USE_LARGE_COORD  0
#define LV_USE_OBJ_ID       0
#define LV_USE_OBJ_ID_BUILTIN 0
#define LV_USE_OBJ_PROPERTY 0
#define LV_USE_OBJ_PROPERTY_NAME 0
#define LV_USE_OBJ_STYLE_CACHE 0
#define LV_USE_VG_LITE_THORVG   0
#define LV_USE_MATRIX           0
#define LV_USE_VECTOR_GRAPHIC   0

#endif /* LV_CONF_H */

#endif /* enable guard */
