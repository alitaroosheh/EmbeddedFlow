/**
 * EmbeddedFlow LVGL WASM Runtime
 *
 * Compiled with Emscripten. Exposes an embf_* C API that the webview JS calls
 * to construct LVGL UI objects from .embf project JSON, tick the renderer, and
 * read back the RGBA framebuffer.
 *
 * Build:  see Makefile in this directory
 * Output: ../media/wasm/embf_runtime.js + embf_runtime.wasm
 */

#include "lvgl/lvgl.h"
#include <stdlib.h>
#include <string.h>
#include <emscripten.h>

/* ── Display buffer ─────────────────────────────────────────────────────── */

static int g_width  = 0;
static int g_height = 0;
static uint8_t *g_framebuffer = NULL; /* RGBA8888, width * height * 4 */

static lv_display_t *g_display = NULL;
static lv_color_t   *g_draw_buf1 = NULL;
static lv_color_t   *g_draw_buf2 = NULL;

/* flush_cb: copy the rendered area into the RGBA framebuffer */
static void flush_cb(lv_display_t *disp, const lv_area_t *area, uint8_t *px_map)
{
    int x1 = area->x1, y1 = area->y1;
    int x2 = area->x2, y2 = area->y2;

    /* px_map is in the format lv_display_get_color_format(disp).
     * We configured LV_COLOR_FORMAT_ARGB8888 so each pixel is 4 bytes: B G R A.
     * We repack to RGBA for the canvas ImageData. */
    for (int y = y1; y <= y2; y++) {
        for (int x = x1; x <= x2; x++) {
            int src_idx = ((y - y1) * (x2 - x1 + 1) + (x - x1)) * 4;
            int dst_idx = (y * g_width + x) * 4;

            uint8_t b = px_map[src_idx + 0];
            uint8_t g = px_map[src_idx + 1];
            uint8_t r = px_map[src_idx + 2];
            uint8_t a = px_map[src_idx + 3];

            g_framebuffer[dst_idx + 0] = r;
            g_framebuffer[dst_idx + 1] = g;
            g_framebuffer[dst_idx + 2] = b;
            g_framebuffer[dst_idx + 3] = a;
        }
    }

    lv_display_flush_ready(disp);
}

/* ── Tick source ────────────────────────────────────────────────────────── */

static uint32_t tick_get_cb(void)
{
    return (uint32_t)emscripten_get_now();
}

/* ── Public API ─────────────────────────────────────────────────────────── */

EMSCRIPTEN_KEEPALIVE
void embf_init(int width, int height, int dark_theme)
{
    g_width  = width;
    g_height = height;

    /* Allocate RGBA framebuffer */
    if (g_framebuffer) free(g_framebuffer);
    g_framebuffer = (uint8_t *)calloc(width * height * 4, 1);

    /* Init LVGL */
    lv_init();
    lv_tick_set_cb(tick_get_cb);

    /* Create display */
    g_display = lv_display_create(width, height);
    lv_display_set_color_format(g_display, LV_COLOR_FORMAT_ARGB8888);

    /* Allocate draw buffers (double buffer, each 1/10 of screen) */
    size_t buf_size = (size_t)(width * height / 10) * sizeof(lv_color_t);
    if (g_draw_buf1) free(g_draw_buf1);
    if (g_draw_buf2) free(g_draw_buf2);
    g_draw_buf1 = (lv_color_t *)malloc(buf_size);
    g_draw_buf2 = (lv_color_t *)malloc(buf_size);
    lv_display_set_buffers(g_display, g_draw_buf1, g_draw_buf2, buf_size,
                           LV_DISPLAY_RENDER_MODE_PARTIAL);

    lv_display_set_flush_cb(g_display, flush_cb);

    /* Apply theme */
    lv_theme_t *theme = dark_theme
        ? lv_theme_default_init(g_display,
              lv_palette_main(LV_PALETTE_BLUE),
              lv_palette_main(LV_PALETTE_CYAN),
              true,  /* dark */
              LV_FONT_DEFAULT)
        : lv_theme_default_init(g_display,
              lv_palette_main(LV_PALETTE_BLUE),
              lv_palette_main(LV_PALETTE_CYAN),
              false, /* light */
              LV_FONT_DEFAULT);
    lv_display_set_theme(g_display, theme);
}

EMSCRIPTEN_KEEPALIVE
void embf_main_loop(void)
{
    lv_timer_handler();
}

EMSCRIPTEN_KEEPALIVE
uint8_t *embf_get_buffer(void)
{
    return g_framebuffer;
}

EMSCRIPTEN_KEEPALIVE
void embf_clear_screen(void)
{
    lv_obj_t *scr = lv_screen_active();
    if (scr) lv_obj_clean(scr);
}

/* ── Screen management ──────────────────────────────────────────────────── */

EMSCRIPTEN_KEEPALIVE
lv_obj_t *embf_create_screen(void)
{
    return lv_obj_create(NULL);
}

EMSCRIPTEN_KEEPALIVE
void embf_load_screen(lv_obj_t *screen)
{
    lv_screen_load(screen);
}

/* ── Object position / size helpers ────────────────────────────────────── */

static void set_pos_size(lv_obj_t *obj, int x, int y, int w, int h)
{
    lv_obj_set_pos(obj, (lv_coord_t)x, (lv_coord_t)y);
    lv_obj_set_size(obj, (lv_coord_t)w, (lv_coord_t)h);
}

/* ── Widget constructors ────────────────────────────────────────────────── */

EMSCRIPTEN_KEEPALIVE
lv_obj_t *embf_create_label(lv_obj_t *parent, int x, int y, int w, int h)
{
    lv_obj_t *obj = lv_label_create(parent);
    set_pos_size(obj, x, y, w, h);
    return obj;
}

EMSCRIPTEN_KEEPALIVE
void embf_label_set_text(lv_obj_t *obj, const char *text)
{
    lv_label_set_text(obj, text);
}

EMSCRIPTEN_KEEPALIVE
lv_obj_t *embf_create_button(lv_obj_t *parent, int x, int y, int w, int h)
{
    lv_obj_t *obj = lv_button_create(parent);
    set_pos_size(obj, x, y, w, h);
    return obj;
}

EMSCRIPTEN_KEEPALIVE
void embf_button_set_label(lv_obj_t *btn, const char *text)
{
    lv_obj_t *lbl = lv_label_create(btn);
    lv_label_set_text(lbl, text);
    lv_obj_center(lbl);
}

EMSCRIPTEN_KEEPALIVE
lv_obj_t *embf_create_slider(lv_obj_t *parent, int x, int y, int w, int h)
{
    lv_obj_t *obj = lv_slider_create(parent);
    set_pos_size(obj, x, y, w, h);
    return obj;
}

EMSCRIPTEN_KEEPALIVE
void embf_slider_set_range(lv_obj_t *obj, int min, int max)
{
    lv_slider_set_range(obj, min, max);
}

EMSCRIPTEN_KEEPALIVE
void embf_slider_set_value(lv_obj_t *obj, int value)
{
    lv_slider_set_value(obj, value, LV_ANIM_OFF);
}

EMSCRIPTEN_KEEPALIVE
lv_obj_t *embf_create_switch(lv_obj_t *parent, int x, int y, int w, int h)
{
    lv_obj_t *obj = lv_switch_create(parent);
    set_pos_size(obj, x, y, w, h);
    return obj;
}

EMSCRIPTEN_KEEPALIVE
void embf_switch_set_state(lv_obj_t *obj, int checked)
{
    if (checked) {
        lv_obj_add_state(obj, LV_STATE_CHECKED);
    } else {
        lv_obj_remove_state(obj, LV_STATE_CHECKED);
    }
}

EMSCRIPTEN_KEEPALIVE
lv_obj_t *embf_create_bar(lv_obj_t *parent, int x, int y, int w, int h)
{
    lv_obj_t *obj = lv_bar_create(parent);
    set_pos_size(obj, x, y, w, h);
    return obj;
}

EMSCRIPTEN_KEEPALIVE
void embf_bar_set_range(lv_obj_t *obj, int min, int max)
{
    lv_bar_set_range(obj, min, max);
}

EMSCRIPTEN_KEEPALIVE
void embf_bar_set_value(lv_obj_t *obj, int value)
{
    lv_bar_set_value(obj, value, LV_ANIM_OFF);
}

EMSCRIPTEN_KEEPALIVE
lv_obj_t *embf_create_spinner(lv_obj_t *parent, int x, int y, int w, int h,
                               uint32_t speed_ms, uint32_t arc_length_deg)
{
    lv_obj_t *obj = lv_spinner_create(parent);
    set_pos_size(obj, x, y, w, h);
    lv_spinner_set_anim_params(obj, speed_ms, arc_length_deg);
    return obj;
}

EMSCRIPTEN_KEEPALIVE
lv_obj_t *embf_create_arc(lv_obj_t *parent, int x, int y, int w, int h)
{
    lv_obj_t *obj = lv_arc_create(parent);
    set_pos_size(obj, x, y, w, h);
    return obj;
}

EMSCRIPTEN_KEEPALIVE
void embf_arc_set_range(lv_obj_t *obj, int min, int max)
{
    lv_arc_set_range(obj, min, max);
}

EMSCRIPTEN_KEEPALIVE
void embf_arc_set_value(lv_obj_t *obj, int value)
{
    lv_arc_set_value(obj, value);
}

EMSCRIPTEN_KEEPALIVE
lv_obj_t *embf_create_checkbox(lv_obj_t *parent, int x, int y, int w, int h)
{
    lv_obj_t *obj = lv_checkbox_create(parent);
    set_pos_size(obj, x, y, w, h);
    return obj;
}

EMSCRIPTEN_KEEPALIVE
void embf_checkbox_set_text(lv_obj_t *obj, const char *text)
{
    lv_checkbox_set_text(obj, text);
}

EMSCRIPTEN_KEEPALIVE
void embf_checkbox_set_state(lv_obj_t *obj, int checked)
{
    if (checked) {
        lv_obj_add_state(obj, LV_STATE_CHECKED);
    } else {
        lv_obj_remove_state(obj, LV_STATE_CHECKED);
    }
}

EMSCRIPTEN_KEEPALIVE
lv_obj_t *embf_create_container(lv_obj_t *parent, int x, int y, int w, int h)
{
    lv_obj_t *obj = lv_obj_create(parent);
    set_pos_size(obj, x, y, w, h);
    return obj;
}

/* ── Style setters ──────────────────────────────────────────────────────── */

/* color is packed as ARGB8888 in a uint32: 0xAARRGGBB */
static lv_color_t unpack_color(uint32_t argb)
{
    uint8_t r = (argb >> 16) & 0xFF;
    uint8_t g = (argb >>  8) & 0xFF;
    uint8_t b = (argb >>  0) & 0xFF;
    return lv_color_make(r, g, b);
}

EMSCRIPTEN_KEEPALIVE
void embf_obj_set_style_bg_color(lv_obj_t *obj, uint32_t argb)
{
    lv_obj_set_style_bg_color(obj, unpack_color(argb), LV_PART_MAIN);
    lv_obj_set_style_bg_opa(obj, LV_OPA_COVER, LV_PART_MAIN);
}

EMSCRIPTEN_KEEPALIVE
void embf_obj_set_style_text_color(lv_obj_t *obj, uint32_t argb)
{
    lv_obj_set_style_text_color(obj, unpack_color(argb), LV_PART_MAIN);
}

EMSCRIPTEN_KEEPALIVE
void embf_obj_set_style_border_width(lv_obj_t *obj, int width)
{
    lv_obj_set_style_border_width(obj, (lv_coord_t)width, LV_PART_MAIN);
}

EMSCRIPTEN_KEEPALIVE
void embf_obj_set_style_radius(lv_obj_t *obj, int radius)
{
    lv_obj_set_style_radius(obj, (lv_coord_t)radius, LV_PART_MAIN);
}

EMSCRIPTEN_KEEPALIVE
void embf_obj_set_style_pad_all(lv_obj_t *obj, int pad)
{
    lv_obj_set_style_pad_all(obj, (lv_coord_t)pad, LV_PART_MAIN);
}

/* ── Input events ───────────────────────────────────────────────────────── */

static lv_indev_t      *g_pointer_indev = NULL;
static lv_indev_t      *g_wheel_indev   = NULL;
static lv_point_t       g_pointer_point = {0, 0};
static lv_indev_state_t g_pointer_state = LV_INDEV_STATE_RELEASED;
static int32_t          g_wheel_delta   = 0;
static lv_indev_state_t g_wheel_state   = LV_INDEV_STATE_RELEASED;

static void pointer_read_cb(lv_indev_t *indev, lv_indev_data_t *data)
{
    data->point = g_pointer_point;
    data->state = g_pointer_state;
}

static void wheel_read_cb(lv_indev_t *indev, lv_indev_data_t *data)
{
    data->enc_diff = (int16_t)g_wheel_delta;
    data->state    = g_wheel_state;
    g_wheel_delta  = 0;
}

static void init_input_devices(void)
{
    g_pointer_indev = lv_indev_create();
    lv_indev_set_type(g_pointer_indev, LV_INDEV_TYPE_POINTER);
    lv_indev_set_read_cb(g_pointer_indev, pointer_read_cb);

    g_wheel_indev = lv_indev_create();
    lv_indev_set_type(g_wheel_indev, LV_INDEV_TYPE_ENCODER);
    lv_indev_set_read_cb(g_wheel_indev, wheel_read_cb);
}

/* Called from embf_init after lv_init() */
static void __attribute__((constructor)) _ensure_input_init(void) {}

EMSCRIPTEN_KEEPALIVE
void embf_on_pointer(int x, int y, int pressed)
{
    if (!g_pointer_indev) {
        g_pointer_indev = lv_indev_create();
        lv_indev_set_type(g_pointer_indev, LV_INDEV_TYPE_POINTER);
        lv_indev_set_read_cb(g_pointer_indev, pointer_read_cb);
    }
    g_pointer_point.x = (lv_coord_t)x;
    g_pointer_point.y = (lv_coord_t)y;
    g_pointer_state = pressed ? LV_INDEV_STATE_PRESSED : LV_INDEV_STATE_RELEASED;
}

EMSCRIPTEN_KEEPALIVE
void embf_on_wheel(int delta, int pressed)
{
    if (!g_wheel_indev) {
        g_wheel_indev = lv_indev_create();
        lv_indev_set_type(g_wheel_indev, LV_INDEV_TYPE_ENCODER);
        lv_indev_set_read_cb(g_wheel_indev, wheel_read_cb);
    }
    g_wheel_delta += delta;
    g_wheel_state = pressed ? LV_INDEV_STATE_PRESSED : LV_INDEV_STATE_RELEASED;
}

EMSCRIPTEN_KEEPALIVE
void embf_on_key(int keycode)
{
    /* Future: keyboard input device */
    (void)keycode;
}
